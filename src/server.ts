import { serve } from "@hono/node-server";
import app from "./index.js";

const port = parseInt(process.env.PORT ?? "3003", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`🎨 ScribblePFP snap running at http://localhost:${port}`);
  console.log(`   Test: curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:${port}/`);
});
