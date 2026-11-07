import type { Config } from "./config";
import { mergeLead, parseSubmission } from "./lead";
import { processLead } from "./process";
import { deleteLead, getLead, leadId, saveLead } from "./store";
import type { Submission } from "./types";

const MAX_BODY = 16_000;

function corsHeaders(config: Config, origin: string | null): Record<string, string> | null {
  if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** POST /lead, called from your website's form. */
export async function handleLead(request: Request, config: Config, ctx: ExecutionContext): Promise<Response> {
  const cors = corsHeaders(config, request.headers.get("Origin"));
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
  if (submission) await acceptSubmission(config, ctx, submission, Date.now());
  return Response.json({ ok: true }, { headers: cors });
}

export async function acceptSubmission(config: Config, ctx: ExecutionContext, sub: Submission, now: number): Promise<void> {
  // They typed one email in an email-capture box and another in the full form:
  // the form wins, so drop the email-only lead if it hasn't been handled.
  if (sub.capturedEmail) {
    const captured = await getLead(config, await leadId(sub.capturedEmail));
    if (captured?.status === "pending") await deleteLead(config, captured.id);
  }

  const id = await leadId(sub.email);
  const existing = await getLead(config, id);
  // Already replied to or in Discord: a repeat submission doesn't email them again.
  if (existing && existing.status !== "pending") return;

  const lead = mergeLead(existing, sub, id, now);
  await saveLead(config, lead);
  if (lead.complete) {
    ctx.waitUntil(processLead(config, lead, now).catch((err) => console.error(`[lead ${id}]`, err)));
  }
}
