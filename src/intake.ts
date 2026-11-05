import { mergeLead, parseSubmission } from "./lead";
import { processLead } from "./process";
import { deleteLead, getLead, leadId, saveLead } from "./store";
import type { Env, Submission } from "./types";

const MAX_BODY = 16_000;

function corsHeaders(env: Env, origin: string | null): Record<string, string> | null {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** POST /lead, called from the website's lib/leads.ts alongside Formspree. */
export async function handleLead(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cors = corsHeaders(env, request.headers.get("Origin"));
  if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!cors) return new Response("Forbidden", { status: 403 });

  const text = await request.text();
  if (text.length > MAX_BODY) return new Response("Too large", { status: 413, headers: cors });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response("Bad JSON", { status: 400, headers: cors });
  }

  // Rejected submissions (honeypot, bad email) still get a 200, so bots learn nothing.
  const submission = parseSubmission(body);
  if (submission) await acceptSubmission(env, ctx, submission, Date.now());
  return Response.json({ ok: true }, { headers: cors });
}

export async function acceptSubmission(env: Env, ctx: ExecutionContext, sub: Submission, now: number): Promise<void> {
  // They typed one email in the hero box and another in the details dialog:
  // the details win, so drop the hero-only lead if it hasn't been handled.
  if (sub.capturedEmail) {
    const hero = await getLead(env, await leadId(sub.capturedEmail));
    if (hero?.status === "pending") await deleteLead(env, hero.id);
  }

  const id = await leadId(sub.email);
  const existing = await getLead(env, id);
  // Already replied to or in Discord: a repeat submission doesn't email them again.
  if (existing && existing.status !== "pending") return;

  const lead = mergeLead(existing, sub, id, now);
  await saveLead(env, lead);
  if (lead.complete) {
    ctx.waitUntil(processLead(env, lead, now).catch((err) => console.error(`[lead ${id}]`, err)));
  }
}
