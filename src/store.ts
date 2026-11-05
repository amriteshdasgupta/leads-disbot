import type { Env, Lead, LeadStatus } from "./types";

const LEAD_TTL_SECONDS = 60 * 60 * 24 * 60;

interface LeadMeta {
  status: LeadStatus;
  dueAt: number;
}

const leadKey = (id: string) => `lead:${id}`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short and stable, so it fits in a Discord button id. */
export async function leadId(email: string): Promise<string> {
  return (await sha256Hex(email.toLowerCase())).slice(0, 20);
}

export async function getLead(env: Env, id: string): Promise<Lead | null> {
  return env.LEADS.get<Lead>(leadKey(id), "json");
}

export async function saveLead(env: Env, lead: Lead): Promise<void> {
  const metadata: LeadMeta = { status: lead.status, dueAt: lead.dueAt };
  await env.LEADS.put(leadKey(lead.id), JSON.stringify(lead), { expirationTtl: LEAD_TTL_SECONDS, metadata });
}

export async function deleteLead(env: Env, id: string): Promise<void> {
  await env.LEADS.delete(leadKey(id));
}

/** Ids of pending leads whose wait is over. Reads only key metadata. */
export async function listDueLeadIds(env: Env, now: number): Promise<string[]> {
  const due: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.LEADS.list<LeadMeta>({ prefix: "lead:", cursor });
    for (const key of page.keys) {
      if (key.metadata?.status === "pending" && key.metadata.dueAt <= now) due.push(key.name.slice(5));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return due;
}

/**
 * Caps automatic emails per day, so a flood of fake submissions can't make the
 * domain email strangers. Past the cap, leads go to Discord instead.
 */
export async function takeAutoSendSlot(env: Env, now: number): Promise<boolean> {
  const limit = Number.parseInt(env.AUTO_SEND_DAILY_LIMIT, 10) || 40;
  const key = `autosend:${new Date(now).toISOString().slice(0, 10)}`;
  const used = Number.parseInt((await env.LEADS.get(key)) ?? "0", 10);
  if (used >= limit) return false;
  await env.LEADS.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}
