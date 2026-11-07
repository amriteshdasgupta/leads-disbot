import type { Context } from "hono";
import type { Config } from "./config";
import { mergeLead, parseSubmission } from "./lead";
import { processLead } from "./process";
import { deleteLead, getLead, leadId, saveLead } from "./store";
import type { AppEnv, Submission } from "./types";

/**
 * POST /lead, called from your website's form. The origin check, CORS and the
 * size limit run first, in index.ts.
 */
export async function handleLead(c: Context<AppEnv>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text("Bad JSON", 400);
  }

  // Rejected submissions (honeypot, bad email) still get a 200, so bots learn nothing.
  const submission = parseSubmission(body);
  if (submission) await acceptSubmission(c.get("config"), c.executionCtx, submission, Date.now());
  return c.json({ ok: true });
}

export async function acceptSubmission(config: Config, ctx: Pick<ExecutionContext, "waitUntil">, sub: Submission, now: number): Promise<void> {
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
