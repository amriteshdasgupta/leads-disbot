import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";
import type { Env } from "../src/types";

const env = (vars: Partial<Env> = {}): Env => ({
  LEADS: {} as KVNamespace,
  PRODUCT_NAME: "Example Co",
  SENDER_NAME: "Jordan",
  ALLOWED_ORIGINS: "https://example.com",
  ...vars,
});

const problems = (vars: Partial<Env>) => {
  try {
    loadConfig(env(vars));
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error("Expected loadConfig to fail");
};

describe("loadConfig", () => {
  it("fills in defaults", () => {
    const config = loadConfig(env());
    expect(config).toMatchObject({
      EMAIL_PROVIDER: "gmail",
      AUTO_SEND_DAILY_LIMIT: 40,
      REVIEW_SCORE: 4,
      REVIEW_ORGANIZATION_TYPES: [],
      ORGANIZATION_TYPE_LABELS: {},
      ALLOWED_USER_IDS: [],
    });
    expect(config.DISCORD_TEMPLATES_CHANNEL_ID).toBeUndefined();
    expect(config.REPLY_TO).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    const config = loadConfig(env({ EMAIL_PROVIDER: "", AUTO_SEND_DAILY_LIMIT: "", DISCORD_TEMPLATES_CHANNEL_ID: "", REPLY_TO: "" }));
    expect(config.EMAIL_PROVIDER).toBe("gmail");
    expect(config.AUTO_SEND_DAILY_LIMIT).toBe(40);
    expect(config.DISCORD_TEMPLATES_CHANNEL_ID).toBeUndefined();
    expect(config.REPLY_TO).toBeUndefined();
  });

  it("parses lists, numbers and labels", () => {
    const config = loadConfig(env({
      ALLOWED_ORIGINS: "https://example.com, https://www.example.com,",
      AUTO_SEND_DAILY_LIMIT: 0,
      REVIEW_SCORE: "6",
      REVIEW_ORGANIZATION_TYPES: "Company, Nonprofit",
      ORGANIZATION_TYPE_LABELS: '{"Company": "Company / business"}',
      ALLOWED_USER_IDS: "1, 2",
    }));
    expect(config.ALLOWED_ORIGINS).toEqual(["https://example.com", "https://www.example.com"]);
    expect(config.AUTO_SEND_DAILY_LIMIT).toBe(0);
    expect(config.REVIEW_SCORE).toBe(6);
    expect(config.REVIEW_ORGANIZATION_TYPES).toEqual(["Company", "Nonprofit"]);
    expect(config.ORGANIZATION_TYPE_LABELS).toEqual({ Company: "Company / business" });
    expect(config.ALLOWED_USER_IDS).toEqual(["1", "2"]);
  });

  it("names every missing required setting", () => {
    const message = problems({ PRODUCT_NAME: undefined, SENDER_NAME: " ", ALLOWED_ORIGINS: "" });
    expect(message).toContain("PRODUCT_NAME is missing");
    expect(message).toContain("SENDER_NAME is missing");
    expect(message).toContain("ALLOWED_ORIGINS is empty");
  });

  it("explains malformed values", () => {
    expect(problems({ ALLOWED_ORIGINS: "https://example.com/" })).toContain(`"https://example.com/" isn't an origin`);
    expect(problems({ EMAIL_PROVIDER: "smtp" })).toContain("EMAIL_PROVIDER");
    expect(problems({ AUTO_SEND_DAILY_LIMIT: "lots" })).toContain("AUTO_SEND_DAILY_LIMIT must be a whole number");
    expect(problems({ REVIEW_SCORE: "-1" })).toContain("REVIEW_SCORE can't be negative");
    expect(problems({ ORGANIZATION_TYPE_LABELS: "{nope" })).toContain("ORGANIZATION_TYPE_LABELS isn't valid JSON");
    expect(problems({ ORGANIZATION_TYPE_LABELS: '["Company"]' })).toContain("must be a JSON object of labels");
    expect(problems({ ORGANIZATION_TYPE_LABELS: '{"Company": 1}' })).toContain("ORGANIZATION_TYPE_LABELS.Company must be a string");
    expect(problems({ DISCORD_TEMPLATES_CHANNEL_ID: "#email-templates" })).toContain("must be a Discord channel ID");
    expect(problems({ LEADS: undefined as unknown as KVNamespace })).toContain("LEADS is missing");
  });
});
