import { handleLead } from "./intake";
import { handleInteraction } from "./interactions";
import { processDueLeads } from "./process";
import type { Env } from "./types";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/lead") return handleLead(request, env, ctx);
    if (pathname === "/discord" && request.method === "POST") return handleInteraction(request, env, ctx);
    if (pathname === "/" && request.method === "GET") return new Response("lead-responder is running\n");
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processDueLeads(env));
  },
} satisfies ExportedHandler<Env>;
