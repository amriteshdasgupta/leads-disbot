import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { emailDrafts, parseEmailTemplate, parseSenderName, renderEmailTemplate } from "../src/discord-templates";
import { autoReply, personalDraft } from "../src/templates";
import { getLead, leadId } from "../src/store";
import type { Lead } from "../src/types";
import { leadRequest, schoolLead, setup, tutorLead } from "./helpers";

const config = {
  DISCORD_TEMPLATES_CHANNEL_ID: "templates",
};
const automatic = "AUTO_REPLY <@123>\nSubject: A demo for {{first_name}}\n\nHello {{first_name}},\n\nThanks,\n{{sender_name}}";
const personal = "PERSONAL_DRAFT <@123>\nSubject: Demo{{institution_suffix}}\n\n{{greeting}}\nThanks for reaching out{{on_behalf_of}}. Let's build {{paper_owner}} exam papers.{{note_acknowledgement}}\n\n{{sender_name}}";
const lead = (fields = {}): Lead => ({
  ...schoolLead, id: "lead", complete: true, firstSeen: 0, updatedAt: 0, dueAt: 0, status: "pending", ...fields,
});

function configured() {
  const t = setup(config);
  t.template("auto", automatic);
  t.template("personal", personal);
  t.template("sender", "SENDER_NAME <@123>\nAmritesh");
  return t;
}

afterEach(() => vi.unstubAllGlobals());

describe("Discord email templates", () => {
  it("keeps the original email wording when Discord templates aren't configured", async () => {
    const t = setup();
    const person = lead();
    const drafts = await emailDrafts(t.env, person);
    expect(drafts.automatic).toEqual({ ...autoReply(person, "Alex"), senderName: "Alex" });
    expect(drafts.personal).toEqual({ ...personalDraft(person, "Alex"), senderName: "Alex" });
    expect(t.calls).toHaveLength(0);
  });

  it("uses the three exact messages, fills placeholders, and snapshots the sender", async () => {
    const t = configured();
    const drafts = await emailDrafts(t.env, lead());
    expect(drafts.personal.subject).toBe("Demo for Northgate High School");
    expect(drafts.personal.body).toContain("Hi Priya,");
    expect(drafts.personal.body).toContain("on behalf of Northgate High School");
    expect(drafts.personal.body).toContain("Northgate High School's exam papers");
    expect(drafts.personal.body).toContain("Thanks for the note as well.");
    expect(drafts.automatic.senderName).toBe("Amritesh");
    expect(drafts.warnings).toEqual([]);
    expect(t.discord().map((c) => c.url)).toEqual(["https://discord.com/api/v10/channels/templates/messages/pins?limit=50"]);
    expect(t.discord().every(c => c.headers.Authorization === "Bot bot-token")).toBe(true);
  });

  it("reads edits for the next lead without changing an existing review draft", async () => {
    const t = configured();
    const submit = async (payload: object) => {
      await worker.fetch(leadRequest(payload) as Parameters<typeof worker.fetch>[0], t.env, t.ctx);
      await t.settle();
    };
    await submit(schoolLead);
    const original = (await getLead(t.env, await leadId(schoolLead.email)))!.draft;
    t.template("personal", personal.replace("Subject: Demo", "Subject: Updated demo"));
    t.template("sender", "SENDER_NAME <@123>\nAcme team");
    await submit({ ...schoolLead, email: "next.school@gmail.com" });
    expect((await getLead(t.env, await leadId(schoolLead.email)))!.draft).toEqual(original);
    const next = (await getLead(t.env, await leadId("next.school@gmail.com")))!.draft!;
    expect(next.subject).toBe("Updated demo for Northgate High School");
    expect(next.senderName).toBe("Acme team");
    t.template("auto", automatic.replace("Hello", "Welcome"));
    await submit(tutorLead);
    expect(t.resend()[0].body.text).toBe("Welcome Sam,\n\nThanks,\nAcme team");
  });

  it("uses a validated saved version during Discord errors or invalid edits, with a visible warning", async () => {
    const t = configured();
    const good = await emailDrafts(t.env, lead());
    t.failTemplates(429);
    const offline = await emailDrafts(t.env, lead());
    expect(offline.personal).toEqual(good.personal);
    expect(offline.warnings).toHaveLength(3);
    t.failTemplates(0);
    t.template("auto", "AUTO_REPLY <@123>\nSubject: Broken\n\n{{unknown}}");
    const invalid = await emailDrafts(t.env, lead());
    expect(invalid.automatic).toEqual(good.automatic);
    expect(invalid.warnings[0]).toContain("unknown placeholder");
    await worker.fetch(leadRequest(tutorLead) as Parameters<typeof worker.fetch>[0], t.env, t.ctx);
    await t.settle();
    const saved = await getLead(t.env, await leadId(tutorLead.email));
    expect(saved!.note).toContain("Check #email-templates");
  });

  it("falls back safely for deleted or unreadable messages without a saved copy", async () => {
    const t = setup(config);
    t.template("auto", "");
    const drafts = await emailDrafts(t.env, lead());
    expect(drafts.automatic.subject).toBe("Thanks for your interest in Acme");
    expect(drafts.warnings).toHaveLength(3);
  });

  it("rejects duplicate pinned templates and ignores messages from other channels", async () => {
    const t = configured();
    const good = await emailDrafts(t.env, lead());
    t.template("duplicate", automatic.replace("Hello", "Duplicate"));
    const duplicate = await emailDrafts(t.env, lead());
    expect(duplicate.automatic).toEqual(good.automatic);
    expect(duplicate.warnings).toEqual([expect.stringContaining("exactly one pinned AUTO_REPLY")]);
    t.template("duplicate", automatic, "unrelated-channel");
    expect((await emailDrafts(t.env, lead())).warnings).toEqual([]);
  });

  it("handles missing names, institutions and notes without leaking placeholder syntax", () => {
    const draft = renderEmailTemplate(parseEmailTemplate(personal, "PERSONAL_DRAFT"), lead({ name: undefined, institution: undefined, message: undefined }), "Team");
    expect(draft.subject).toBe("Demo");
    expect(draft.body).toBe("Hi there,\nThanks for reaching out. Let's build your exam papers.\n\nTeam");
  });

  it("does not interpret placeholder-like lead data or permit header injection", () => {
    const draft = renderEmailTemplate(parseEmailTemplate(automatic, "AUTO_REPLY"), lead({ name: "{{sender_name}}" }), "Team");
    expect(draft.body).toContain("Hello {{sender_name}},");
    const subject = renderEmailTemplate({ subject: "{{institution}}", body: "Hello" }, lead({ institution: "School\r\nBcc: stranger@example.com" }), "Team").subject;
    expect(subject).not.toMatch(/[\r\n]/);
    expect(() => parseSenderName("SENDER_NAME <@123>\nTeam\nBcc: other@example.com")).toThrow();
    expect(() => parseEmailTemplate("AUTO_REPLY <@123>\nSubject: Demo\n\n{{first_name}", "AUTO_REPLY")).toThrow();
  });
});
