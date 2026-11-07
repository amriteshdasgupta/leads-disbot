import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { scoreLead, typeLabel } from "../src/score";
import type { Env, Lead } from "../src/types";

const config = (vars: Partial<Env> = {}) =>
  loadConfig({ LEADS: {} as KVNamespace, PRODUCT_NAME: "Example Co", SENDER_NAME: "Jordan", ALLOWED_ORIGINS: "https://example.com", ...vars });

const lead = (fields: Partial<Lead>): Lead =>
  ({ id: "x", email: "a@gmail.com", complete: true, firstSeen: 0, updatedAt: 0, dueAt: 0, status: "pending", ...fields }) as Lead;

describe("scoreLead", () => {
  it("auto-replies to individuals on personal email", () => {
    const result = scoreLead(lead({ organizationType: "Individual" }), config());
    expect(result).toEqual({ score: 0, reasons: ["Individual", "Personal email (gmail.com)"], review: false });
  });

  it("reviews strong leads of any type", () => {
    const strong = lead({ organizationType: "Other", email: "x@company.example", institution: "Company", phone: "123456" });
    const result = scoreLead(strong, config());
    expect(result.score).toBe(5);
    expect(result.reasons).toEqual(["Other (+1)", "Named organization (+1)", "Work email (company.example) (+2)", "Phone number (+1)"]);
    expect(result.review).toBe(true);
  });

  it("always reviews the types in REVIEW_ORGANIZATION_TYPES", () => {
    const vars = { REVIEW_ORGANIZATION_TYPES: "Enterprise,Agency" };
    expect(scoreLead(lead({ organizationType: "Agency" }), config(vars))).toMatchObject({ score: 3, review: true });
    expect(scoreLead(lead({ organizationType: "Startup" }), config(vars))).toMatchObject({ score: 1, review: false });
    expect(scoreLead(lead({ organizationType: "Agency" }), config()).review).toBe(false);
  });

  it("uses REVIEW_SCORE as the review threshold", () => {
    const fair = lead({ email: "x@company.example", phone: "123456" });
    expect(scoreLead(fair, config()).review).toBe(false);
    expect(scoreLead(fair, config({ REVIEW_SCORE: "3" })).review).toBe(true);
    expect(scoreLead(lead({}), config({ REVIEW_SCORE: "0" })).review).toBe(true);
  });

  it("shows types with ORGANIZATION_TYPE_LABELS", () => {
    const labelled = config({ ORGANIZATION_TYPE_LABELS: '{"Agency": "Marketing agency"}' });
    expect(typeLabel("Agency", labelled)).toBe("Marketing agency");
    expect(typeLabel("Startup", labelled)).toBe("Startup");
    expect(typeLabel(undefined, labelled)).toBe("Not given");
    expect(scoreLead(lead({ organizationType: "Agency" }), labelled).reasons[0]).toBe("Marketing agency (+1)");
  });
});
