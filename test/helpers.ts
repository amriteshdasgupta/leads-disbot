import { vi } from "vitest";
import type { Env } from "../src/types";

class MemoryKV {
  data = new Map<string, { value: string; metadata?: unknown }>();

  async get(key: string, type?: string) {
    const entry = this.data.get(key);
    if (!entry) return null;
    return type === "json" ? JSON.parse(entry.value) : entry.value;
  }

  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.data.set(key, { value, metadata: options?.metadata });
  }

  async delete(key: string) {
    this.data.delete(key);
  }

  async list({ prefix = "" }: { prefix?: string } = {}) {
    const keys = [...this.data.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, entry]) => ({ name, metadata: entry.metadata }));
    return { keys, list_complete: true, cursor: "" };
  }
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export function setup(overrides: Partial<Env> = {}) {
  const kv = new MemoryKV();
  const env = {
    LEADS: kv as unknown as KVNamespace,
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_PUBLIC_KEY: "",
    DISCORD_CHANNEL_ID: "chan1",
    RESEND_API_KEY: "re_test",
    REPLY_TO: "me@example.com",
    FROM_EMAIL: "Alex from Acme <hello@example.com>",
    SENDER_NAME: "Alex",
    ALLOWED_ORIGINS: "https://example.com,https://example.org",
    AUTO_SEND_DAILY_LIMIT: "40",
    ...overrides,
  } as Env;

  const calls: Call[] = [];
  let failResend = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (url.includes("resend.com")) {
        return failResend ? new Response("boom", { status: 500 }) : Response.json({ id: "email_1" });
      }
      return Response.json({ id: "msg_1" });
    }),
  );

  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  return {
    env,
    kv,
    ctx,
    calls,
    resend: () => calls.filter((c) => c.url.includes("resend.com")),
    discord: () => calls.filter((c) => c.url.includes("discord.com")),
    failResend: (fail = true) => {
      failResend = fail;
    },
    settle: async () => {
      while (pending.length) await pending.shift();
    },
  };
}

export function leadRequest(body: unknown, origin = "https://example.com") {
  return new Request("https://leads.example/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

export const schoolLead = {
  organizationType: "School",
  name: "Priya Sharma",
  institution: "Northgate High School",
  email: "priya@northgate.edu.au",
  phone: "+61 400 000 000",
  message: "We'd like to try this for our Year 10 science exams.",
  demoRequest: true,
  sourceForm: "hero_details",
  sourceUrl: "https://example.com",
};

export const tutorLead = {
  organizationType: "Individual",
  name: "Sam",
  institution: "",
  email: "sam.tutor@gmail.com",
  phone: "",
  message: "",
  demoRequest: true,
  sourceForm: "hero_details",
  sourceUrl: "https://example.com",
};
