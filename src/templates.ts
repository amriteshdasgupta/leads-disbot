import { firstName } from "./lead";
import type { Email, Lead } from "./types";

/** Sent straight away to leads that don't need a personal reply. */
export function autoReply(lead: Lead, sender: string): Email {
  const hi = firstName(lead) ? `Hi ${firstName(lead)},` : "Hi there,";
  return {
    subject: "Thanks for your interest in Acme",
    body: [
      hi,
      "",
      "Thanks for getting in touch about Acme. We build complete exam papers in your own format, with a matching marking scheme, and can run them online too.",
      "",
      "To set up a demo, just reply to this email with:",
      "- a couple of days and times that suit you, and your time zone",
      "- the subjects and year levels you'd like to see",
      "- a sample paper if you have one handy, so we can show it in your format",
      "",
      "Thanks,",
      sender,
      "Acme",
    ].join("\n"),
  };
}

/** The personal draft that waits in Discord for a Send click. */
export function personalDraft(lead: Lead, sender: string): Email {
  const hi = firstName(lead) ? `Hi ${firstName(lead)},` : "Hi there,";
  const org = lead.institution;
  const lines = [
    hi,
    "",
    `Thanks for reaching out${org ? ` on behalf of ${org}` : ""}. I'd love to show you how Acme can build ${org ? `${org}'s` : "your"} exam papers in your own format, with matching marking schemes, and run them online if you'd like.`,
  ];
  if (lead.message) {
    lines.push("", "Thanks for the note as well. I'll make sure the demo covers it.");
  }
  lines.push(
    "",
    "Could you reply with a couple of times that work for a 30-minute call this week or next, and your time zone? If you have a sample paper, send it along and I'll use it in the demo.",
    "",
    "Best,",
    sender,
    "Acme",
  );
  return { subject: `Your Acme demo${org ? ` for ${org}` : ""}`, body: lines.join("\n") };
}
