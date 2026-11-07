import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { ConfigError, loadConfig } from "./config";
import { handleLead } from "./intake";
import { handleInteraction } from "./interactions";
import { processDueLeads } from "./process";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

// Every route needs the config, and a bad one should fail loudly rather than half-work.
app.use(async (c, next) => {
  c.set("config", loadConfig(c.env));
  await next();
});

app.get("/", (c) => c.text("lead-responder is running\n"));

app.on(
  ["POST", "OPTIONS"],
  "/lead",
  // Only your own websites can send leads. Anyone else gets a 403, preflight included.
  async (c, next) => {
    const origin = c.req.header("Origin");
    if (!origin || !c.get("config").ALLOWED_ORIGINS.includes(origin)) return c.text("Forbidden", 403);
    await next();
  },
  cors({ origin: (origin) => origin, allowMethods: ["POST", "OPTIONS"], allowHeaders: ["Content-Type"], maxAge: 86400 }),
  bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text("Too large", 413) }),
  handleLead,
);
app.all("/lead", (c) => c.text("Method not allowed", 405));

// The Interactions Endpoint URL set in the Discord Developer Portal.
app.post("/discord", handleInteraction);

app.notFound((c) => c.text("Not found", 404));

app.onError((err, c) => {
  console.error(err);
  if (err instanceof ConfigError) {
    return c.text("lead-responder is misconfigured. Run `npx wrangler tail` to see why.\n", 500);
  }
  return c.text("Internal error", 500);
});

export default {
  fetch: app.fetch,

  // Picks up unfinished forms once their wait is over, and retries failures.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processDueLeads(loadConfig(env)));
  },
} satisfies ExportedHandler<Env>;
