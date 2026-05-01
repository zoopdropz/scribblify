# ScribblePFP Snap 🎨

A Farcaster Snap that turns your PFP into a gloriously bad MS Paint scribble.

## What it does

1. Fetches your Farcaster PFP via Neynar
2. Sends it to Claude with a prompt to redraw it as a clumsy, pathetic MS Paint disaster
3. Shows you the result — downloadable and usable as your new PFP

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set environment variables

Create a `.env` file (or set on your host):

```env
# Required: Your Anthropic API key (for Claude image generation)
ANTHROPIC_API_KEY=sk-ant-...

# Required: Neynar API key (to fetch Farcaster PFPs)
# Get one free at https://neynar.com
NEYNAR_API_KEY=...

# Set automatically on host.neynar.app — set manually for other hosts
SNAP_PUBLIC_BASE_URL=https://your-snap-name.host.neynar.app
```

### 3. Run locally

```bash
SKIP_JFS_VERIFICATION=true pnpm dev
```

Test it:
```bash
curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:3003/
```

Test a button press (simulates a user tapping "Scribblify My PFP"):
```bash
PAYLOAD=$(echo -n '{"fid":1,"inputs":{},"audience":"http://localhost:3003","timestamp":'"$(date +%s)"',"user":{"fid":1},"surface":{"type":"standalone"}}' \
  | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

curl -sS -X POST \
  -H 'Accept: application/vnd.farcaster.snap+json' \
  -H 'Content-Type: application/json' \
  -d '{"header":"dev","payload":"'"$PAYLOAD"'","signature":"dev"}' \
  'http://localhost:3003/?action=generate'
```

### 4. Deploy to host.neynar.app

```bash
# Build first to catch any TypeScript errors
pnpm build

# Archive (exclude server.ts — it uses Node.js builtins incompatible with Edge)
tar czf /tmp/scribble-pfp-snap.tar.gz \
  --exclude='node_modules' \
  --exclude='src/server.ts' \
  --exclude='.env' \
  -C /path/to/scribble-pfp-snap .

# First deploy (creates project + returns API key — save it!)
curl -X POST https://api.host.neynar.app/v1/deploy \
  -F "files=@/tmp/scribble-pfp-snap.tar.gz" \
  -F "projectName=scribble-pfp-snap" \
  -F "framework=hono" \
  -F 'env={"SNAP_PUBLIC_BASE_URL":"https://scribble-pfp-snap.host.neynar.app","ANTHROPIC_API_KEY":"YOUR_KEY","NEYNAR_API_KEY":"YOUR_KEY"}'

# Verify it's live
curl -fsSL -H 'Accept: application/vnd.farcaster.snap+json' \
  'https://scribble-pfp-snap.host.neynar.app/'
```

### 5. Share on Farcaster

Cast the live URL: `https://scribble-pfp-snap.host.neynar.app`

## How it works

### Snap flow

```
GET /           → Landing screen with user's current PFP preview + "Scribblify" button
POST /?action=generate → Fetch PFP → Claude image gen → Show scribble + Download button
GET /download?fid=N    → Redirect/serve the generated scribble image
```

### Image generation

Uses Claude's image generation API with a vision input — your PFP is sent as a base64
image alongside the legendary scribble prompt. The result is cached in Turso KV so you
can re-download without regenerating.

### Neynar API

Used to fetch the user's current Farcaster PFP URL from their FID (Farcaster ID),
which is always available on POST requests (JFS-verified).

## Notes

- Image generation may take 10–30 seconds; the snap will show a loading state
- Each user's latest scribble is cached — tap "Regenerate" for a fresh disaster
- The download endpoint serves the image directly (or redirects to the URL)
- Claude's image generation is non-deterministic — every run is a new adventure in badness
