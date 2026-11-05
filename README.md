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

Emails come from the Gmail in `GMAIL_USER`. The pinned `SENDER_NAME` message in `#email-templates` sets the Gmail display name and the name used in new email drafts. They appear in that Gmail's Sent folder, and replies come back to its inbox.

Buttons are used instead of emoji reactions because reactions need a bot that stays connected to Discord all the time. Buttons work with nothing running in between.

## Safety limits

- Only the website's own domains can submit leads (`ALLOWED_ORIGINS`), and the form's honeypot field is honoured.
- Each email address is handled once. Submitting again doesn't email them again.
- At most `AUTO_SEND_DAILY_LIMIT` automatic emails a day (40). Past that, leads wait in Discord.
- Anyone who can see the Discord channel can press the buttons. To limit that to certain people, set `ALLOWED_USER_IDS` to their Discord user IDs, comma-separated.
- A double click sends once.

## Changing things

### Edit emails in Discord — no deployment needed

Open `#email-templates` and edit the three pinned messages you own (right-click → **Edit Message**):

- `AUTO_REPLY`: the email small leads receive automatically.
- `PERSONAL_DRAFT`: the draft for leads that wait for review in `#requests`.
- `SENDER_NAME`: the name used in the signature and Gmail's From display name. Replace the name on its second line.

Keep each message's first line, including the **@Acme Leads** mention, and keep `Subject: ` on the second line of the two email templates. Everything below the subject is the email body. Save the existing message rather than posting a second copy. The bot reads the pinned messages for each new lead; changes do not rewrite drafts that are already waiting for review. Discord's lead-card **Edit** button still edits just that lead's email.

Common placeholders are `{{first_name}}`, `{{name}}`, `{{email}}`, `{{institution}}`, and `{{sender_name}}`. `{{greeting}}` becomes "Hi Sam," or "Hi there," when no name was supplied. The original personal draft also uses `{{institution_suffix}}` (" for Northgate"), `{{on_behalf_of}}` (" on behalf of Northgate"), `{{paper_owner}}` ("Northgate's" or "your"), and `{{note_acknowledgement}}` (the acknowledgement paragraph, only when the lead wrote a note). These optional phrases are empty when not needed. You can replace placeholders with your own wording.

If a message is missing, duplicated, unreadable, or has an invalid placeholder, the worker uses its last valid saved version (or the original built-in default before one has been saved) and adds a warning to the lead card. Keep this channel to the three template pins and fewer than 50 pins in total.

The channel is configured by `DISCORD_TEMPLATES_CHANNEL_ID`. The bot needs View Channel and Read Message History there. Its mention on each pinned message lets it read those messages [without enabling the privileged Message Content intent](https://docs.discord.com/developers/events/gateway#message-content-intent).

### Other settings

| To change | Edit |
| --- | --- |
| Email wording | Pinned messages in `#email-templates`; save the message, no deploy |
| Who gets auto-replied vs. reviewed | `src/score.ts` |
| Sender name | Pinned `SENDER_NAME` message in `#email-templates`; no deploy |
| Daily limit, fallback sender name | `[vars]` in `wrangler.toml` |
| Which Gmail sends | `npx wrangler secret put GMAIL_USER`, then `GMAIL_APP_PASSWORD` |
| Send from a example.com address instead | `EMAIL_PROVIDER = "resend"`. See the end of RUNBOOK.md |

For code or `wrangler.toml` changes, run `npm test`, `npm run typecheck`, and `npm run deploy`. The built-in fallback wording remains in `src/templates.ts`.

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
