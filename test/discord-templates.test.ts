import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { emailDrafts, parseEmailTemplate, parseSenderName } from "../src/discord-templates";
import { DEFAULT_TEMPLATES, renderEmailTemplate } from "../src/templates";
import { getLead, leadId } from "../src/store";
import type { Lead } from "../src/types";
import { companyLead, individualLead, leadRequest, setup, TEMPLATES_CHANNEL } from "./helpers";

const config = {
  DISCORD_TEMPLATES_CHANNEL_ID: TEMPLATES_CHANNEL,
};
const automatic = "AUTO_REPLY <@123>\nSubject: A call for {{first_name}}\n\nHello {{first_name}},\n\nThanks,\n{{sender_name}}";
const personal = "PERSONAL_DRAFT <@123>\nSubject: {{product_name}}{{institution_suffix}}\n\n{{greeting}}\nThanks for reaching out{{on_behalf_of}}. Let's set up {{org_possessive}} account.{{note_acknowledgement}}\n\n{{sender_name}}";
const lead = (fields = {}): Lead => ({
  ...companyLead, id: "lead", complete: true, firstSeen: 0, updatedAt: 0, dueAt: 0, status: "pending", ...fields,
});

function configured() {
  const t = setup(config);
  t.template("auto", automatic);
  t.template("personal", personal);
  t.template("sender", "SENDER_NAME <@123>\nCasey");
  return t;
}

afterEach(() => vi.unstubAllGlobals());

describe("built-in email templates", () => {
  it("are used when Discord templates aren't configured", async () => {
    const t = setup();
    const drafts = await emailDrafts(t.config, lead());
    expect(drafts.automatic).toEqual(renderEmailTemplate(DEFAULT_TEMPLATES.AUTO_REPLY, lead(), "Jordan", "Example Co"));
    expect(drafts.personal.subject).toBe("Getting started with Example Co for Northgate Logistics");
    expect(drafts.personal.body).toContain("how Example Co could work for Northgate Logistics' team.");
    expect(drafts.personal.body).toMatch(/Thanks for the note as well\. .*\n\nCould you/);
    expect(drafts.personal.body).toMatch(/\nJordan\nExample Co$/);
    expect(drafts.personal.senderName).toBe("Jordan");
    expect(t.calls).toHaveLength(0);
  });

  it("read naturally without a name, organization or note", () => {
    const bare = lead({ name: undefined, institution: undefined, message: undefined });
    const draft = renderEmailTemplate(DEFAULT_TEMPLATES.PERSONAL_DRAFT, bare, "Jordan", "Example Co");
    expect(draft.subject).toBe("Getting started with Example Co");
    expect(draft.body).toMatch(/^Hi there,\n\nThanks for reaching out\. .* for your team\.\n\nCould you/);
  });

  it("only use known placeholders", () => {
    for (const [label, template] of Object.entries(DEFAULT_TEMPLATES)) {
      expect(() => parseEmailTemplate(`${label} <@1>\nSubject: ${template.subject}\n\n${template.body}`, label)).not.toThrow();
    }
  });
});

describe("Discord email templates", () => {
  it("uses the three exact messages, fills placeholders, and snapshots the sender", async () => {
    const t = configured();
    const drafts = await emailDrafts(t.config, lead());
    expect(drafts.personal.subject).toBe("Example Co for Northgate Logistics");
    expect(drafts.personal.body).toContain("Hi Priya,");
    expect(drafts.personal.body).toContain("on behalf of Northgate Logistics");
    expect(drafts.personal.body).toContain("Northgate Logistics' account");
    expect(drafts.personal.body).toContain("Thanks for the note as well.");
    expect(drafts.automatic.senderName).toBe("Casey");
    expect(drafts.warnings).toEqual([]);
    expect(t.discord().map((c) => c.url)).toEqual([`https://discord.com/api/v10/channels/${TEMPLATES_CHANNEL}/messages/pins?limit=50`]);
    expect(t.discord().every(c => c.headers.Authorization === "Bot bot-token")).toBe(true);
  });

  it("writes the possessive without a doubled s", () => {
    const template = parseEmailTemplate(personal, "PERSONAL_DRAFT");
    const draft = renderEmailTemplate(template, lead({ institution: "Studio Nine" }), "Team", "Example Co");
    expect(draft.body).toContain("Let's set up Studio Nine's account.");
  });

  it("still accepts the deprecated paper_owner placeholder", () => {
    const old = personal.replace("{{org_possessive}}", "{{paper_owner}}");
    const draft = renderEmailTemplate(parseEmailTemplate(old, "PERSONAL_DRAFT"), lead(), "Team", "Example Co");
    expect(draft.body).toContain("Let's set up Northgate Logistics' account.");
    const withoutOrg = renderEmailTemplate(parseEmailTemplate(old, "PERSONAL_DRAFT"), lead({ institution: undefined }), "Team", "Example Co");
    expect(withoutOrg.body).toContain("Let's set up your account.");
  });

  it("reads edits for the next lead without changing an existing review draft", async () => {
    const t = configured();
    const submit = async (payload: object) => {
      await worker.fetch(leadRequest(payload) as Parameters<typeof worker.fetch>[0], t.env, t.ctx);
      await t.settle();
    };
    await submit(companyLead);
    const original = (await getLead(t.config, await leadId(companyLead.email)))!.draft;
    t.template("personal", personal.replace("Subject: ", "Subject: Updated: "));
    t.template("sender", "SENDER_NAME <@123>\nExample Co team");
    await submit({ ...companyLead, email: "next.lead@gmail.com" });
    expect((await getLead(t.config, await leadId(companyLead.email)))!.draft).toEqual(original);
    const next = (await getLead(t.config, await leadId("next.lead@gmail.com")))!.draft!;
    expect(next.subject).toBe("Updated: Example Co for Northgate Logistics");
    expect(next.senderName).toBe("Example Co team");
    t.template("auto", automatic.replace("Hello", "Welcome"));
    await submit(individualLead);
    expect(t.resend()[0].body.text).toBe("Welcome Sam,\n\nThanks,\nExample Co team");
  });

  it("uses a validated saved version during Discord errors or invalid edits, with a visible warning", async () => {
    const t = configured();
    const good = await emailDrafts(t.config, lead());
    t.failTemplates(429);
    const offline = await emailDrafts(t.config, lead());
    expect(offline.personal).toEqual(good.personal);
    expect(offline.warnings).toHaveLength(3);
    t.failTemplates(0);
    t.template("auto", "AUTO_REPLY <@123>\nSubject: Broken\n\n{{unknown}}");
    const invalid = await emailDrafts(t.config, lead());
    expect(invalid.automatic).toEqual(good.automatic);
    expect(invalid.warnings[0]).toContain("unknown placeholder");
    await worker.fetch(leadRequest(individualLead) as Parameters<typeof worker.fetch>[0], t.env, t.ctx);
    await t.settle();
    const saved = await getLead(t.config, await leadId(individualLead.email));
    expect(saved!.note).toContain(`Check the email templates in <#${TEMPLATES_CHANNEL}>`);
  });

  it("falls back safely for deleted or unreadable messages without a saved copy", async () => {
    const t = setup(config);
    t.template("auto", "");
    const drafts = await emailDrafts(t.config, lead());
    expect(drafts.automatic.subject).toBe("Thanks for your interest in Example Co");
    expect(drafts.warnings).toHaveLength(3);
  });

  it("rejects duplicate pinned templates and ignores messages from other channels", async () => {
    const t = configured();
    const good = await emailDrafts(t.config, lead());
    t.template("duplicate", automatic.replace("Hello", "Duplicate"));
    const duplicate = await emailDrafts(t.config, lead());
    expect(duplicate.automatic).toEqual(good.automatic);
    expect(duplicate.warnings).toEqual([expect.stringContaining("exactly one pinned AUTO_REPLY")]);
    t.template("duplicate", automatic, "200000000000000002");
    expect((await emailDrafts(t.config, lead())).warnings).toEqual([]);
  });

  it("handles missing names, organizations and notes without leaking placeholder syntax", () => {
    const draft = renderEmailTemplate(parseEmailTemplate(personal, "PERSONAL_DRAFT"), lead({ name: undefined, institution: undefined, message: undefined }), "Team", "Example Co");
    expect(draft.subject).toBe("Example Co");
    expect(draft.body).toBe("Hi there,\nThanks for reaching out. Let's set up your account.\n\nTeam");
  });

  it("does not interpret placeholder-like lead data or permit header injection", () => {
    const draft = renderEmailTemplate(parseEmailTemplate(automatic, "AUTO_REPLY"), lead({ name: "{{sender_name}}" }), "Team", "Example Co");
    expect(draft.body).toContain("Hello {{sender_name}},");
    const subject = renderEmailTemplate({ subject: "{{institution}}", body: "Hello" }, lead({ institution: "Company\r\nBcc: stranger@example.com" }), "Team", "Example Co").subject;
    expect(subject).not.toMatch(/[\r\n]/);
    expect(() => parseSenderName("SENDER_NAME <@123>\nTeam\nBcc: other@example.com")).toThrow();
    expect(() => parseEmailTemplate("AUTO_REPLY <@123>\nSubject: Hello\n\n{{first_name}", "AUTO_REPLY")).toThrow();
  });
});
