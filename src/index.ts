import { Hono } from "hono";
import { registerSnapHandler } from "@farcaster/snap-hono";
import { createTursoDataStore } from "@farcaster/snap-turso";

const app = new Hono();
const store = createTursoDataStore();

// The legendary scribble prompt
const SCRIBBLE_PROMPT = `Redraw the attached image in the most clumsy, scribbly, and utterly pathetic way possible. Use a white background, and make it look like it was drawn in MS Paint with a mouse. It should be vaguely similar but also not really, kind of matching but also off in a confusing, awkward way, with that low-quality pixel-by-pixel feel that really likes how ridiculous bad it is. Actually, you know what, whatever, just draw it however you want.`;

function getBaseUrl(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const host = (forwardedHost ?? hostHeader)?.split(",")[0].trim();
  const isLoopback =
    host !== undefined &&
    /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto
    ? forwardedProto.split(",")[0].trim().toLowerCase()
    : isLoopback
      ? "http"
      : "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT ?? "3003"}`;
}

// Fetch Farcaster user PFP via Neynar
async function fetchFarcasterPfp(fid: number): Promise<string | null> {
  try {
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) {
      console.warn("NEYNAR_API_KEY not set, using placeholder pfp");
      return null;
    }
    const res = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          accept: "application/json",
          "x-api-key": neynarKey,
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ pfp_url?: string }>;
    };
    return data.users?.[0]?.pfp_url ?? null;
  } catch {
    return null;
  }
}

// Fetch image as base64
async function imageToBase64(
  url: string
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const mediaType = contentType.split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { data: base64, mediaType };
  } catch {
    return null;
  }
}

// Call Claude to generate scribble version
async function generateScribblePfp(
  pfpUrl: string,
  anthropicKey: string
): Promise<string | null> {
  try {
    const imgData = await imageToBase64(pfpUrl);
    if (!imgData) return null;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imgData.mediaType,
                  data: imgData.data,
                },
              },
              {
                type: "text",
                text: SCRIBBLE_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    // Claude can't generate images - we'll use the image generation API instead
    // For image generation, use claude with tools or an image gen API
    // Here we call the Anthropic image generation endpoint via the beta
    return null;
  } catch {
    return null;
  }
}

// Generate scribble image via Anthropic image generation
async function generateScribbleImage(
  pfpUrl: string,
  anthropicKey: string
): Promise<string | null> {
  try {
    const imgData = await imageToBase64(pfpUrl);
    if (!imgData) return null;

    // Use Claude to generate the scribble image using the images API
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "images-2025-05-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        tools: [
          {
            type: "image_generation",
            name: "generate_image",
            description: "Generate an image based on a description",
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imgData.mediaType,
                  data: imgData.data,
                },
              },
              {
                type: "text",
                text: `Use the generate_image tool to create: ${SCRIBBLE_PROMPT}`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("Image gen API error:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{
        type: string;
        name?: string;
        input?: { image_base64?: string; url?: string };
      }>;
    };

    const toolResult = data.content?.find(
      (c) => c.type === "tool_use" && c.name === "generate_image"
    );
    if (toolResult?.input?.url) return toolResult.input.url;
    if (toolResult?.input?.image_base64) {
      return `data:image/png;base64,${toolResult.input.image_base64}`;
    }
    return null;
  } catch (e) {
    console.error("generateScribbleImage error:", e);
    return null;
  }
}

registerSnapHandler(
  app,
  async (ctx: any) => {
    const base = getBaseUrl(ctx.request);
    const url = new URL(ctx.request.url);
    const action = url.searchParams.get("action");
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";

    // ── GENERATE action: user tapped "Scribblify My PFP" ──
    if (action === "generate" && ctx.action.type === "post") {
      const fid = ctx.action.user.fid;

      // Show generating state immediately, kick off generation
      const pfpUrl = await fetchFarcasterPfp(fid);
      let scribbleUrl: string | null = null;

      if (pfpUrl && anthropicKey) {
        scribbleUrl = await generateScribbleImage(pfpUrl, anthropicKey);
      }

      if (scribbleUrl) {
        // Cache the result
        await store.set(`scribble:${fid}`, scribbleUrl);

        return {
          version: "2.0" as const,
          theme: { accent: "pink" as const },
          ui: {
            root: "page",
            elements: {
              page: {
                type: "stack" as const,
                props: {},
                children: ["title", "subtitle", "img", "actions"],
              },
              title: {
                type: "text" as const,
                props: {
                  content: "✨ Your Scribble PFP is Ready!",
                  weight: "bold" as const,
                  align: "center" as const,
                },
              },
              subtitle: {
                type: "text" as const,
                props: {
                  content:
                    "A masterpiece in the most pathetic way possible 🎨",
                  size: "sm" as const,
                  align: "center" as const,
                },
              },
              img: {
                type: "image" as const,
                props: {
                  src: scribbleUrl,
                  aspectRatio: 1,
                },
              },
              actions: {
                type: "stack" as const,
                props: { direction: "horizontal" as const },
                children: ["download-btn", "again-btn"],
              },
              "download-btn": {
                type: "button" as const,
                props: { label: "⬇ Download", variant: "primary" as const },
                on: {
                  press: {
                    action: "open_url" as const,
                    params: {
                      target: `${base}/download?fid=${fid}`,
                    },
                  },
                },
              },
              "again-btn": {
                type: "button" as const,
                props: { label: "🎲 Regenerate" },
                on: {
                  press: {
                    action: "submit" as const,
                    params: { target: `${base}/?action=generate` },
                  },
                },
              },
            },
          },
        };
      }

      // Error state
      return {
        version: "2.0" as const,
        theme: { accent: "red" as const },
        ui: {
          root: "page",
          elements: {
            page: {
              type: "stack" as const,
              props: {},
              children: ["title", "err", "retry"],
            },
            title: {
              type: "text" as const,
              props: { content: "Oops! 😅", weight: "bold" as const },
            },
            err: {
              type: "text" as const,
              props: {
                content:
                  "Couldn't scribblify your PFP right now. Make sure ANTHROPIC_API_KEY and NEYNAR_API_KEY are set, then try again.",
                size: "sm" as const,
              },
            },
            retry: {
              type: "button" as const,
              props: { label: "Try Again", variant: "primary" as const },
              on: {
                press: {
                  action: "submit" as const,
                  params: { target: `${base}/?action=generate` },
                },
              },
            },
          },
        },
      };
    }

    // ── DEFAULT: landing screen ──
    const fid = ctx.action.user?.fid;
    const pfpUrl = fid ? await fetchFarcasterPfp(fid) : null;

    // Check if we have a cached scribble
    const cached = fid ? await store.get(`scribble:${fid}`) : null;

    if (cached && typeof cached === "string") {
      return {
        version: "2.0" as const,
        theme: { accent: "pink" as const },
        ui: {
          root: "page",
          elements: {
            page: {
              type: "stack" as const,
              props: {},
              children: ["title", "img", "actions"],
            },
            title: {
              type: "text" as const,
              props: {
                content: "Your Last Scribble 🖼️",
                weight: "bold" as const,
              },
            },
            img: {
              type: "image" as const,
              props: { src: cached, aspectRatio: 1 },
            },
            actions: {
              type: "stack" as const,
              props: { direction: "horizontal" as const },
              children: ["download-btn", "new-btn"],
            },
            "download-btn": {
              type: "button" as const,
              props: { label: "⬇ Download", variant: "primary" as const },
              on: {
                press: {
                  action: "open_url" as const,
                  params: { target: `${base}/download?fid=${fid}` },
                },
              },
            },
            "new-btn": {
              type: "button" as const,
              props: { label: "🎨 Make New One" },
              on: {
                press: {
                  action: "submit" as const,
                  params: { target: `${base}/?action=generate` },
                },
              },
            },
          },
        },
      };
    }

    // Fresh landing page
    return {
      version: "2.0" as const,
      theme: { accent: "pink" as const },
      ui: {
        root: "page",
        elements: {
          page: {
            type: "stack" as const,
            props: {},
            children: pfpUrl
              ? ["title", "desc", "pfp", "generate-btn"]
              : ["title", "desc", "generate-btn"],
          },
          title: {
            type: "text" as const,
            props: {
              content: "ScribblePFP 🎨",
              weight: "bold" as const,
              size: "lg" as const,
            },
          },
          desc: {
            type: "text" as const,
            props: {
              content:
                "Turn your Farcaster PFP into a glorious MS Paint disaster. It'll be bad. Beautifully bad.",
              size: "sm" as const,
            },
          },
          ...(pfpUrl
            ? {
                pfp: {
                  type: "image" as const,
                  props: { src: pfpUrl, aspectRatio: 1 },
                },
              }
            : {}),
          "generate-btn": {
            type: "button" as const,
            props: {
              label: "🖱️ Scribblify My PFP",
              variant: "primary" as const,
            },
            on: {
              press: {
                action: "submit" as const,
                params: { target: `${base}/?action=generate` },
              },
            },
          },
        },
      },
    };
  },
  {
{}
);

// Download redirect endpoint — redirects to the cached scribble URL
app.get("/download", async (c) => {
  const fid = c.req.query("fid");
  if (!fid) return c.text("Missing fid", 400);

  const cached = await store.get(`scribble:${parseInt(fid, 10)}`);
  if (!cached || typeof cached !== "string") {
    return c.text("No scribble found for this user", 404);
  }

  // If it's a data URL, serve as image
  if (cached.startsWith("data:")) {
    const [header, b64] = cached.split(",");
    const mimeType = header.replace("data:", "").replace(";base64", "");
    const buf = Buffer.from(b64, "base64");
    c.header("Content-Type", mimeType);
    c.header(
      "Content-Disposition",
      `attachment; filename="scribble-pfp-${fid}.png"`
    );
    return c.body(buf);
  }

  return c.redirect(cached);
});

export default app;
