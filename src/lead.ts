import type { Lead, Submission } from "./types";

/** Finished details dialog: process right away (the delay is only a retry fallback). */
export const COMPLETE_RETRY_MS = 5 * 60_000;
/** Email-only or half-filled: wait in case the person finishes the details dialog. */
export const INCOMPLETE_WAIT_MS = 15 * 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIELDS = ["name", "institution", "organizationType", "phone", "message"] as const;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Turns a website payload (lib/leads.ts in your-website) into a Submission.
 * Returns null for anything that isn't a usable lead, including honeypot hits.
 */
export function parseSubmission(body: unknown): Submission | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (str(b._gotcha, 200)) return null;

  const email = str(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return null;

  const sub: Submission = {
    email,
    sourceForm: str(b.sourceForm, 100) || undefined,
    sourceUrl: str(b.sourceUrl, 200) || undefined,
    complete: b.partial !== true && b.emailCapture !== true && str(b.name, 200).length >= 2,
  };
  for (const field of FIELDS) {
    const value = str(b[field], field === "message" ? 2000 : 200);
    if (value) sub[field] = value;
  }
  const captured = str(b.capturedEmail, 254).toLowerCase();
  if (EMAIL_RE.test(captured) && captured !== email) sub.capturedEmail = captured;
  return sub;
}

export function mergeLead(existing: Lead | null, sub: Submission, id: string, now: number): Lead {
  const lead: Lead = existing
    ? { ...existing }
    : { id, email: sub.email, complete: false, firstSeen: now, updatedAt: now, dueAt: now, status: "pending" };
  for (const field of FIELDS) {
    if (sub[field]) lead[field] = sub[field];
  }
  lead.sourceForm = sub.sourceForm ?? lead.sourceForm;
  lead.sourceUrl = sub.sourceUrl ?? lead.sourceUrl;
  lead.complete = lead.complete || sub.complete;
  lead.updatedAt = now;
  lead.dueAt = now + (lead.complete ? COMPLETE_RETRY_MS : INCOMPLETE_WAIT_MS);
  return lead;
}

export function firstName(lead: Lead): string | undefined {
  const first = lead.name?.split(/\s+/)[0];
  return first && first.length >= 2 ? first : undefined;
}
