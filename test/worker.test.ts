import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { parseSubmission } from "../src/lead";
import { processDueLeads } from "../src/process";
import { scoreLead } from "../src/score";
import { getLead, leadId } from "../src/store";
import type { Env, Lead } from "../src/types";
import { leadRequest, schoolLead, setup, tutorLead } from "./helpers";

const mailer = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("worker-mailer", () => ({ WorkerMailer: { send: mailer.send } }));

let keys: CryptoKeyPair;
let publicKeyHex: string;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKeyHex = hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mailer.send.mockReset();
});

const run = (request: Request, env: Env, ctx: ExecutionContext) =>
  worker.fetch(request as Parameters<typeof worker.fetch>[0], env, ctx);

async function discordRequest(body: unknown, sign = true) {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign
    ? hex(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(timestamp + text)))
    : "0".repeat(128);
  return new Request("https://leads.example/discord", {
    method: "POST",
    headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp },
    body: text,
  });
}

const click = (customId: string, extra: object = {}) => ({
  type: 3,
  token: "tok",
  application_id: "app1",
  member: { user: { id: "u1", username: "alex", global_name: "Alex" } },
  data: { custom_id: customId },
  ...extra,
});

describe("parseSubmission", () => {
  it("drops honeypot hits and bad emails", () => {
    expect(parseSubmission({ email: "a@b.com", _gotcha: "spam" })).toBeNull();
    expect(parseSubmission({ email: "not-an-email" })).toBeNull();
  });

  it("treats the hero email box and half-filled closes as incomplete", () => {
    expect(parseSubmission({ email: "a@b.com", emailCapture: true })?.complete).toBe(false);
    expect(parseSubmission({ ...schoolLead, partial: true })?.complete).toBe(false);
    expect(parseSubmission(schoolLead)?.complete).toBe(true);
  });
});

describe("scoreLead", () => {
  const lead = (fields: Partial<Lead>): Lead =>
    ({ id: "x", email: "a@gmail.com", complete: true, firstSeen: 0, updatedAt: 0, dueAt: 0, status: "pending", ...fields }) as Lead;

  it("sends schools, colleges and tutoring centres to review", () => {
    expect(scoreLead(lead({ organizationType: "School" })).review).toBe(true);
    expect(scoreLead(lead({ organizationType: "Tutoring Center" })).review).toBe(true);
  });

  it("auto-replies to individual tutors on personal email", () => {
    expect(scoreLead(lead({ organizationType: "Individual" })).review).toBe(false);
  });

  it("reviews strong leads of other types", () => {
    const strong = lead({ organizationType: "Other", email: "x@acme.org", institution: "Acme", phone: "123456" });
    expect(scoreLead(strong).review).toBe(true);
  });
});

describe("POST /lead", () => {
  it("rejects other websites", async () => {
    const t = setup();
    const res = await run(leadRequest(schoolLead, "https://evil.example"), t.env, t.ctx);
    expect(res.status).toBe(403);
  });

  it("puts a school in Discord with a draft and buttons, without emailing", async () => {
    const t = setup();
    const res = await run(leadRequest(schoolLead), t.env, t.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    await t.settle();

    expect(t.resend()).toHaveLength(0);
    const [post] = t.discord();
    expect(post.url).toBe("https://discord.com/api/v10/channels/chan1/messages");
    expect(post.headers.Authorization).toBe("Bot bot-token");
    const card = post.body;
    expect(card.embeds[0].title).toBe("Priya Sharma · Northgate High School");
    expect(card.embeds[0].description).toContain("Needs a reply");
    expect(card.embeds[0].description).toContain("Your Acme demo for Northgate High School");
    expect(card.components[0].components.map((b: any) => b.label)).toEqual(["Send", "Edit", "Skip"]);

    const lead = await getLead(t.env, await leadId(schoolLead.email));
    expect(lead?.status).toBe("review");
    expect(lead?.discordMessageId).toBe("msg_1");
  });

  it("auto-replies to an individual tutor and notes it in Discord", async () => {
    const t = setup();
    await run(leadRequest(tutorLead), t.env, t.ctx);
    await t.settle();

    const [email] = t.resend();
    expect(email.body.to).toEqual(["sam.tutor@gmail.com"]);
    expect(email.body.reply_to).toBe("me@example.com");
    expect(email.body.text).toMatch(/^Hi Sam,/);
    expect(email.headers["Idempotency-Key"]).toMatch(/-auto$/);
    expect(t.discord()[0].body.embeds[0].description).toContain("Auto-replied");
  });

  it("doesn't email someone twice when they submit again", async () => {
    const t = setup();
    await run(leadRequest(tutorLead), t.env, t.ctx);
    await t.settle();
    await run(leadRequest(tutorLead), t.env, t.ctx);
    await t.settle();
    expect(t.resend()).toHaveLength(1);
  });

  it("waits on the hero email box, then merges in the details", async () => {
    const t = setup();
    await run(leadRequest({ email: schoolLead.email, emailCapture: true, demoRequest: true }), t.env, t.ctx);
    await t.settle();
    expect(t.calls).toHaveLength(0);

    await run(leadRequest(schoolLead), t.env, t.ctx);
    await t.settle();
    expect(t.discord()).toHaveLength(1);
    expect(t.resend()).toHaveLength(0);
  });

  it("handles unfinished forms on the cron once the wait is over", async () => {
    const t = setup();
    await run(leadRequest({ email: "lee@gmail.com", emailCapture: true }), t.env, t.ctx);
    await t.settle();
    await processDueLeads(t.env, Date.now() + 60_000);
    expect(t.calls).toHaveLength(0);

    await processDueLeads(t.env, Date.now() + 16 * 60_000);
    expect(t.resend()).toHaveLength(1);
    expect(t.resend()[0].body.text).toMatch(/^Hi there,/);
  });

  it("sends to Discord instead once the daily auto-reply cap is hit", async () => {
    const t = setup({ AUTO_SEND_DAILY_LIMIT: "1" });
    await run(leadRequest(tutorLead), t.env, t.ctx);
    await run(leadRequest({ ...tutorLead, email: "other@gmail.com" }), t.env, t.ctx);
    await t.settle();
    expect(t.resend()).toHaveLength(1);
    const second = await getLead(t.env, await leadId("other@gmail.com"));
    expect(second?.status).toBe("review");
  });
});

describe("POST /discord", () => {
  async function reviewLead() {
    const t = setup({ DISCORD_PUBLIC_KEY: publicKeyHex });
    await run(leadRequest(schoolLead), t.env, t.ctx);
    await t.settle();
    t.calls.length = 0;
    return { t, id: await leadId(schoolLead.email) };
  }

  it("answers Discord's ping and rejects bad signatures", async () => {
    const t = setup({ DISCORD_PUBLIC_KEY: publicKeyHex });
    const ok = await run(await discordRequest({ type: 1 }), t.env, t.ctx);
    expect(await ok.json()).toEqual({ type: 1 });
    const bad = await run(await discordRequest({ type: 1 }, false), t.env, t.ctx);
    expect(bad.status).toBe(401);
  });

  it("Send emails the draft and marks the card sent", async () => {
    const { t, id } = await reviewLead();
    const res = await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    expect(await res.json()).toEqual({ type: 6 });
    await t.settle();

    const [email] = t.resend();
    expect(email.body.to).toEqual([schoolLead.email]);
    expect(email.body.subject).toBe("Your Acme demo for Northgate High School");
    const [patch] = t.discord();
    expect(patch.url).toBe("https://discord.com/api/v10/webhooks/app1/tok/messages/@original");
    expect(patch.body.embeds[0].description).toContain("Sent by Alex");
    expect(patch.body.components).toEqual([]);
  });

  it("a second Send on a sent lead doesn't email again", async () => {
    const { t, id } = await reviewLead();
    await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    await t.settle();
    const again = await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    expect(((await again.json()) as { type: number }).type).toBe(7);
    expect(t.resend()).toHaveLength(1);
  });

  it("Edit opens the draft, and submitting sends the edited email", async () => {
    const { t, id } = await reviewLead();
    const res = await run(await discordRequest(click(`edit:${id}`)), t.env, t.ctx);
    const modal = (await res.json()) as any;
    expect(modal.type).toBe(9);
    expect(modal.data.components[1].components[0].value).toMatch(/^Hi Priya,/);

    const submit = click(`compose:${id}`, {
      type: 5,
      data: {
        custom_id: `compose:${id}`,
        components: [
          { components: [{ custom_id: "subject", value: "Quick demo?" }] },
          { components: [{ custom_id: "body", value: "Hi Priya, how's Thursday?" }] },
        ],
      },
    });
    await run(await discordRequest(submit), t.env, t.ctx);
    await t.settle();
    expect(t.resend()[0].body.subject).toBe("Quick demo?");
    expect((await getLead(t.env, id))?.sentEmail?.body).toBe("Hi Priya, how's Thursday?");
  });

  it("Skip closes the lead without emailing", async () => {
    const { t, id } = await reviewLead();
    const res = await run(await discordRequest(click(`skip:${id}`)), t.env, t.ctx);
    const body = (await res.json()) as any;
    expect(body.type).toBe(7);
    expect(body.data.embeds[0].description).toContain("Skipped by Alex");
    expect(t.resend()).toHaveLength(0);
  });

  it("a failed send shows Retry and keeps the draft", async () => {
    const { t, id } = await reviewLead();
    t.failResend();
    await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    await t.settle();
    const patch = t.discord()[0].body;
    expect(patch.embeds[0].description).toContain("didn't send");
    expect(patch.components[0].components[0].label).toBe("Retry");
    expect((await getLead(t.env, id))?.status).toBe("failed");
  });

  it("only lets allowed people press the buttons when a list is set", async () => {
    const { t, id } = await reviewLead();
    t.env.ALLOWED_USER_IDS = "someone-else";
    const res = await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    expect(((await res.json()) as any).data.flags).toBe(64);
    expect(t.resend()).toHaveLength(0);
  });
});

describe("sending from Gmail", () => {
  const gmail = { EMAIL_PROVIDER: "gmail" as const, GMAIL_USER: "owner@example.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" };

  it("auto-replies through Gmail's SMTP from the Gmail address", async () => {
    const t = setup({ ...gmail, REPLY_TO: undefined });
    await run(leadRequest(tutorLead), t.env, t.ctx);
    await t.settle();

    expect(t.resend()).toHaveLength(0);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const [server, email] = mailer.send.mock.calls[0] as [any, any];
    expect(server).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true });
    expect(server.credentials).toEqual({ username: "owner@example.com", password: "abcdefghijklmnop" });
    expect(email.from).toEqual({ name: "Alex", email: "owner@example.com" });
    expect(email.to).toEqual({ email: "sam.tutor@gmail.com" });
    expect(email.reply).toBeUndefined();
  });

  it("a fast double click on Send emails once", async () => {
    const t = setup({ ...gmail, DISCORD_PUBLIC_KEY: publicKeyHex });
    await run(leadRequest(schoolLead), t.env, t.ctx);
    await t.settle();
    const id = await leadId(schoolLead.email);
    let release = () => {};
    mailer.send.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    const second = await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    expect(((await second.json()) as any).data.content).toContain("already on its way");
    release();
    await t.settle();
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect((await getLead(t.env, id))?.status).toBe("sent");
  });

  it("says so on the card when the Gmail settings are missing", async () => {
    const t = setup({ EMAIL_PROVIDER: "gmail", DISCORD_PUBLIC_KEY: publicKeyHex });
    await run(leadRequest(schoolLead), t.env, t.ctx);
    await t.settle();
    const id = await leadId(schoolLead.email);
    t.calls.length = 0;

    await run(await discordRequest(click(`send:${id}`)), t.env, t.ctx);
    await t.settle();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(t.discord()[0].body.embeds[0].description).toContain("Gmail isn't set up");
  });
});
