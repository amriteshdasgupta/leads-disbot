# lead-responder

Replies to demo requests from the Acme website, and lets you handle the rest from Discord.

## What happens to a lead

1. Someone fills in the demo form on example.com or example.org. The website sends it to Formspree (as before) and to this worker's `/lead`.
2. The worker scores the lead:
   - **School, college or tutoring centre**, or any lead scoring 4+ (work email +2, institution +1, phone +1, a message +1, "Other" type +1): a card appears in Discord with a drafted email.
   - **Everyone else** (individual tutors, personal email, no details): they get an automatic reply straight away, and Discord shows a card saying so.
3. If someone only typed their email in the hero box, or closed the details dialog half way, the worker waits 15 minutes in case they finish, then handles what it has.

## Using it in Discord

Each lead card has buttons:

| Button | What it does |
| --- | --- |
| ✉️ **Send** | Emails the draft shown on the card. The card turns green and says who sent it. |
| ✏️ **Edit** | Opens the draft in a pop-up. Change anything, press Submit, and it sends. |
| ⏭️ **Skip** | Closes the lead without emailing. |
| ✏️ **Write follow-up** | On auto-replied leads: write a personal email on top of the automatic one. |
| 🔁 **Retry** | Shows if an email failed to send. |

Emails come from the Gmail in `GMAIL_USER` (Alex's), shown as `SENDER_NAME`. They appear in that Gmail's Sent folder, and replies come back to its inbox.

Buttons are used instead of emoji reactions because reactions need a bot that stays connected to Discord all the time. Buttons work with nothing running in between.

## Safety limits

- Only the website's own domains can submit leads (`ALLOWED_ORIGINS`), and the form's honeypot field is honoured.
- Each email address is handled once. Submitting again doesn't email them again.
- At most `AUTO_SEND_DAILY_LIMIT` automatic emails a day (40). Past that, leads wait in Discord.
- Anyone who can see the Discord channel can press the buttons. To limit that to certain people, set `ALLOWED_USER_IDS` to their Discord user IDs, comma-separated.
- A double click sends once.

## Changing things

| To change | Edit |
| --- | --- |
| Email wording | `src/templates.ts` |
| Who gets auto-replied vs. reviewed | `src/score.ts` |
| Sender name, daily limit | `[vars]` in `wrangler.toml` |
| Which Gmail sends | `npx wrangler secret put GMAIL_USER`, then `GMAIL_APP_PASSWORD` |
| Send from a example.com address instead | `EMAIL_PROVIDER = "resend"`. See the end of RUNBOOK.md |

Then run `npm test` and `npm run deploy`.

## Setup

See [RUNBOOK.md](RUNBOOK.md).

## Development

```sh
npm ci
npm test          # unit + end-to-end tests with mocked Discord, Gmail and Resend
npm run typecheck
npm run dev       # local worker on http://localhost:8787 (needs a .dev.vars file)
```

The worker stores leads in Workers KV for 60 days. There is no other database.
