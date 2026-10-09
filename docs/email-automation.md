# Email outreach and sequences

WSIS can send short, approval-gated email sequences to CRM prospects through Brevo. Every sequence stops when the recipient replies, unsubscribes, bounces, or becomes ineligible. Every email is recorded on the organization's CRM timeline.

The module starts in **dry-run mode**. Sequences run end to end, but nothing leaves the server until `EMAIL_DRY_RUN=false` is set and Brevo is configured.

## Contents

1. [Architecture](#architecture)
2. [Database schema](#database-schema)
3. [Sequence semantics](#sequence-semantics)
4. [Scheduler and delivery guarantees](#scheduler-and-delivery-guarantees)
5. [Stop rules, replies and unsubscribes](#stop-rules-replies-and-unsubscribes)
6. [AI drafting](#ai-drafting)
7. [API](#api)
8. [Authentication and permissions](#authentication-and-permissions)
9. [Configuration](#configuration)
10. [Brevo setup](#brevo-setup)
11. [Local development and testing](#local-development-and-testing)
12. [Production deployment](#production-deployment)
13. [Safe activation checklist](#safe-activation-checklist)
14. [Known limitations](#known-limitations)

## Architecture

```
React (src/pages/EmailCampaigns.tsx, EmailCampaign.tsx, src/components/email/*)
   │  /api/email/*  (X-User-Id)
   ▼
server/routes/email.ts ── validation, roles, rate limits
   │
   ├─ server/email/service.ts    campaigns, steps, eligibility, enrollment, suppression, approval, analytics
   ├─ server/email/draft.ts      Gemini drafts from CRM facts (suggestions only)
   ├─ server/email/template.ts   variables, escaping, footer + unsubscribe link, HTML sanitising
   ├─ server/email/scheduler.ts  background worker: claim → re-check → send → record
   ├─ server/email/webhooks.ts   Brevo events, inbound replies, unsubscribe
   └─ server/email/provider.ts   EmailProvider interface, dry-run provider, factory
          └─ server/email/brevo.ts   Brevo implementation
```

Brevo sits behind the `EmailProvider` interface (`send`, `verifyWebhook`, `parseEvents`, `parseInbound`, `suppress`), so it can be replaced later. Provider credentials are read only in `server/email/config.ts` and are never returned by any endpoint. The client sees `/api/email/status`, which reports what is configured but never the values.

The scheduler is started once from `server/index.ts`, after the existing hourly recommendations timer, which is unchanged. On `SIGINT`/`SIGTERM` the server stops the email scheduler, waits up to 30 s for an in-flight tick, closes the database, and exits.

## Database schema

All tables are in `server/db/schema.sql`. They are created idempotently on start with `CREATE TABLE/INDEX IF NOT EXISTS`, so existing data is untouched. All timestamps are `TIMESTAMPTZ`.

| Table | Purpose |
| --- | --- |
| `email_campaigns` | Name, description ("what we offer"), status (`draft`, `scheduled`, `active`, `paused`, `completed`, `cancelled`), `send_mode` (`dry_run`/`live`, fixed at first activation), `settings` (send window, CRM stop statuses), `content_version`/`approved_version`, approval and lifecycle timestamps. |
| `email_sequence_steps` | `step_order` (unique per campaign), `subject_template`, `text_template`, optional `html_template`, `delay_minutes`, `active`. |
| `email_sequence_enrollments` | One recipient in one campaign: contact, organization and opportunity references, email snapshot, `current_step` (last step sent), status (`pending`, `active`, `paused`, `replied`, `completed`, `unsubscribed`, `bounced`, `cancelled`, `failed`), `next_send_at`, retry count, worker lease (`claim_token`, `claimed_at`), `last_error`, `stop_reason`, unsubscribe and reply tokens. Partial unique indexes allow only one live (`pending`/`active`/`paused`) enrollment per contact, and per address, per campaign. |
| `email_messages` | One row per logical email (enrollment × step), with `UNIQUE (enrollment_id, step_id)`. This is the duplicate-send guard. Status: `sending`, `sent`, `failed_transient`, `failed_permanent`, `ambiguous`. |
| `email_send_events` | Every attempt, outcome, provider webhook event, reply and test email. `dedupe_key` is unique, which makes webhook processing idempotent. `metadata` holds sanitized fields only, never credentials, IPs, or user agents. |
| `email_suppressions` | Normalized address, reason (`unsubscribed`, `hard_bounce`, `complaint`, `invalid`, `blocked`, `manual`), source. Checked on the server immediately before every send. |
| `email_personalized_drafts` | Optional per-recipient, per-step override (AI or manual). Used only after an approver approves it. |

**Schema upgrades.** `CREATE TABLE IF NOT EXISTS` does not alter existing tables. Future column changes must be added to `schema.sql` as `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`.

**PostgreSQL vs PGlite.** The SQL uses only standard PostgreSQL features: partial unique indexes, `FOR UPDATE … SKIP LOCKED`, `ON CONFLICT`, JSONB, and `FILTER`. The test suite runs on PGlite, including a test that re-applies the whole schema. No PostgreSQL server was available while this was built, so the module has **not yet been run against `pg.Pool`**. Run `npm test` with a scratch `DATABASE_URL` database, or do a smoke test on staging, before production.

## Sequence semantics

- **Delays.** Step 1's delay counts from when the enrollment starts: activation, the scheduled start time, or enrollment into an already-running campaign. Each later step's delay counts from when the previous step was actually sent. "Day 1 / Day 4 / Day 8" means delays of 0, 3 days and 4 days. The editor shows the approximate day of each step.
- **Send window.** By default emails go out only between 09:00 and 18:00 India Standard Time, Monday to Friday. A due email outside the window moves to the next window opening. The window is configurable per campaign or can be turned off.
- **Sender name.** `{{sender.name}}` always resolves: `EMAIL_SENDER_NAME` if set, otherwise “WSIS Team”, so steps that end with `{{sender.name}}` are never held for a missing value.
- **Variables.** `{{contact.first_name}}`, `{{contact.name}}`, `{{contact.designation}}`, `{{organization.name}}`, `{{organization.org_type}}`, `{{organization.sector}}`, `{{organization.area}}`, `{{sender.name}}`, `{{sender.company}}`. Add a fallback with `{{contact.first_name|there}}`. Unknown variables are rejected when a step is saved. If a recipient has no value for a variable and no fallback is given, their email is held, not sent with a gap.
- **Placeholders.** `[[…]]` marks something a person must fill in. A campaign cannot be approved while any step contains one, and a personalized draft cannot be approved with one.
- **Footer.** Every email gets a sender block (name, company, postal address) and an unsubscribe link, in both HTML and plain text. When the header is enabled, it also gets `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.
- **HTML.** Bodies are written as plain text and converted to simple HTML. Variable values are HTML-escaped. Optional custom HTML is stripped of scripts, event handlers and `javascript:` URLs, and previews render in a fully sandboxed `<iframe sandbox="">`.

### Creating a campaign and choosing recipients

**New campaign** is a two-step dialog:

1. **Details:** name and "what we offer". This creates the draft.
2. **Recipients:** choose contacts from the CRM.

Step 2 uses the same selector as the campaign's **Recipients** tab:

- **What's listed:** every contact of an organization in the CRM, with name, designation, email, organization, CRM stage and eligibility.
- **Search and filters:** search by contact name, email or organization; filter by CRM stage and by eligibility (Eligible / Not eligible / All).
- **Selecting:** only eligible contacts have a checkbox. Select individually, select all eligible on the page, or **Select all N eligible**, which takes every eligible contact matching the current filters across all pages. The selected count is always shown, and selections survive filter changes.
- **Why a contact is ineligible:** no email address, invalid address, suppressed (unsubscribed, bounced, spam complaint, invalid, blocked, manual), CRM stage in the campaign's stop list, organization merged, already enrolled (or previously replied, unsubscribed, bounced or completed) in this campaign, or outside `EMAIL_RECIPIENT_ALLOWLIST`.
- **Finishing:** **Add N recipients & continue** enrolls them and opens the Sequence tab. **Skip for now** opens the draft without recipients. Closing the dialog after step 1 keeps the draft and opens it.

The list is advisory. The enrollment endpoint re-checks each contact and reports any it skips with a reason, and the worker re-checks suppression, contact email, CRM stage, merge status and `EMAIL_RECIPIENT_ALLOWLIST` immediately before every send. Recipients go into the existing `email_sequence_enrollments` table. Approval, dry-run and scheduling are unchanged.

### Lifecycle

```
draft ──approve──▶ (approved draft) ──activate (typed recipient count)──▶ active | scheduled
active/scheduled ──pause──▶ paused ──resume (needs current approval)──▶ active
any non-final ──cancel (confirm)──▶ cancelled      active with no live recipients ──▶ completed
```

- Steps can only be edited while the campaign is `draft` or `paused`. Any edit increments `content_version` and clears the approval, so a changed sequence must be approved again before it is activated or resumed.
- Recipients added to a running campaign start immediately (step-1 delay applies). Recipients added while it is paused start when it resumes.
- **Dry-run vs live is fixed per campaign.** The worker only sends campaigns whose `send_mode` matches the server's current mode. A campaign tested in dry run can never start sending real email when the flag is flipped. Use **Duplicate** to make a fresh draft for the live run.

## Scheduler and delivery guarantees

`runEmailWorker` runs every `EMAIL_SCHEDULER_INTERVAL_SECONDS`, using a `setTimeout` chain so ticks never overlap. Each tick:

1. Moves `scheduled` campaigns whose start time has passed to `active`.
2. Calculates how many emails are left under `EMAIL_DAILY_SEND_LIMIT` for the current IST day.
3. **Claims** up to `EMAIL_WORKER_BATCH_SIZE` due enrollments with one atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. A claim is a lease (`claim_token`, `claimed_at`) valid for `EMAIL_CLAIM_LEASE_SECONDS`. While the lease is valid no other worker or process can claim the row, even across several API instances on one PostgreSQL database.
4. For each claimed enrollment, in a **short transaction with no network calls**:
   - re-checks campaign status and mode, enrollment status, suppression, that the contact's email is unchanged, organization not merged, CRM stage not in the stop list, `EMAIL_RECIPIENT_ALLOWLIST`, pending personalized drafts, unfilled placeholders and missing variables;
   - reserves the message with `INSERT INTO email_messages … ON CONFLICT (enrollment_id, step_id) DO NOTHING`.
5. Calls the provider **outside any transaction** (30 s timeout).
6. Records the outcome in a second short transaction: message status, event row, enrollment advance or retry, CRM timeline entry, and in live mode `last_contact_at` plus New → Contacted.
7. Marks campaigns with no remaining live enrollments as `completed`.

### Outcome classes

| Provider result | Examples | Handling |
| --- | --- | --- |
| accepted | Brevo 201/202 | Message `sent`. Next step scheduled, or the enrollment is completed. |
| transient | 429, 503, DNS failure, connection refused (request never reached Brevo) | Retried with exponential backoff (`EMAIL_RETRY_BASE_SECONDS` × 2ⁿ⁻¹, capped at 24 h), up to `EMAIL_MAX_SEND_ATTEMPTS`. After that the enrollment is `failed`. |
| permanent | other 4xx (invalid address, bad request, auth) | Message `failed_permanent`, enrollment `failed`. No retry. |
| ambiguous | timeout after sending, connection reset mid-request, 500/502/504 | Message `ambiguous`, enrollment **paused** with `stop_reason = ambiguous_send`. **Never retried automatically.** |

**Why ambiguous sends are held.** Brevo's `/v3/smtp/email` documents no idempotency key, so a retry after a timeout could send the email twice. WSIS holds the recipient instead. The hold clears in one of two ways:

- automatically, when a Brevo webhook for that message arrives. Every send carries `X-Mailin-custom: wsis-msg-<id>`, which Brevo echoes back in events. WSIS then marks the message sent and continues the sequence.
- manually, when an approver checks Brevo's logs and resumes with **"It was sent"** or **"Not sent — send again"**.

**Crash safety.**
- A crash before the message row is reserved leaves nothing behind; the claim expires and the email is sent normally later.
- A crash after reserving but before recording leaves the message in `sending`. The next worker treats that as ambiguous and holds the recipient, so the email is never resent blindly.
- A crash after Brevo accepted but before the enrollment advanced is repaired: the message row is `sent`, so the next worker just advances.

## Stop rules, replies and unsubscribes

A sequence stops (terminal status) when:

| Signal | Source | Status |
| --- | --- | --- |
| Reply | Brevo inbound parsing webhook (see below) or **Mark replied** in the UI | `replied` |
| Unsubscribe | Footer link or one-click header, Brevo `unsubscribed` event, or `spam` complaint | `unsubscribed`, address suppressed |
| Permanent bounce | Brevo `hard_bounce`, `invalid_email`, `blocked` | `bounced`, address suppressed |
| Campaign cancelled or recipient removed | User | `cancelled` |
| Ineligible | Contact's email changed or removed, organization merged, CRM stage became Converted / Not Interested / Lost (configurable) | `cancelled` with reason |
| All steps sent | Worker | `completed` |

Suppressions apply to **every** campaign. Adding one stops all live enrollments for that address. Unsubscribe, bounce and complaint suppressions cannot be lifted from the UI; manual ones can.

### Reply detection

Brevo's delivery webhooks do **not** report replies. WSIS detects replies with Brevo's **inbound parsing** feature:

1. Every outgoing email sets `Reply-To: reply-<40-hex token>@EMAIL_REPLY_DOMAIN`, a unique address per enrollment.
2. MX records for that subdomain point to Brevo, which parses incoming mail and POSTs it to `/api/email/webhooks/brevo/inbound`.
3. WSIS matches the reply, most reliable first: (a) the token in the recipient address, (b) `In-Reply-To`/`References` matching a stored Brevo message ID, (c) the sender address matching a live enrollment.
4. A matched reply stops the sequence, adds a timeline entry with an excerpt, and creates a **High-priority follow-up task** for the opportunity owner.
5. Auto-replies (`Auto-Submitted`, `X-Autoreply`, `Precedence: bulk/auto_reply`, "Out of office" subjects) are recorded but **do not** stop the sequence.
6. Because replies now go to Brevo rather than a person's inbox, set `EMAIL_REPLY_FORWARD_TO` so each reply is also forwarded to the team (live mode only).

If `EMAIL_REPLY_DOMAIN` is not set, Reply-To is not overridden and replies go to the sender's normal mailbox. WSIS cannot see them, so the team must use **Mark replied** on the recipient. Connecting a mailbox directly (IMAP/Gmail/Microsoft Graph) is a possible future provider and is not implemented.

### Unsubscribe

- `GET /api/email/unsubscribe/:token` shows a confirmation page. It deliberately does not unsubscribe, because link scanners prefetch GETs.
- `POST` to the same URL unsubscribes. This covers the form button and RFC 8058 one-click via `List-Unsubscribe-Post`.
- The result is a WSIS suppression, which is authoritative and checked before every send. If `BREVO_SYNC_SUPPRESSIONS=true`, WSIS also blocklists the address as a Brevo contact (`PUT /v3/contacts/{email}` with `emailBlacklisted: true`). Brevo documents no API for adding an address to its *transactional* blocklist, and the docs don't say whether `emailBlacklisted` blocks transactional sends, so treat that sync as best effort.

## AI drafting

`POST /api/email/campaigns/:id/ai-draft` uses the existing Gemini integration (`GEMINI_API_KEY`, `GEMINI_MODEL`).

- **Template mode** (no recipient): writes a reusable step using variables only.
- **Personal mode** (`contact_id`): uses facts already in WSIS. The prompt separates them into:
  - **known facts:** contact name and designation, organization, location, website, and *Verified* fields;
  - **unconfirmed items:** *Unverified*, *Estimated* and *AI Inference* data such as website-scraped water information or the Opportunity Agent's assessment. The model may only phrase these as possibilities;
  - **recent CRM interactions.**
- The model is told never to invent projects, stages, water demand, technical requirements or responsibilities, and to use `[[placeholders]]` where something is missing. The campaign description is the only source for "what we offer".
- Output is validated. The reviewer is warned about figures that don't appear in WSIS records, unknown variables, fake `Re:`/`Fwd:` subjects, and remaining placeholders.
- Drafts are **never sent automatically**. They go into the step editor, which needs campaign approval, or become a personalized draft, which needs approver approval. A personalized draft awaiting review holds that recipient's email.
- The prompt is not returned to the client.

## API

All endpoints are under `/api/email`. Authenticated endpoints need `X-User-Id` of an active user. "Approver" means the user's role is in `EMAIL_APPROVER_ROLES`. List endpoints take `limit`/`offset` and return `{ items, total, limit, offset }`.

| Method & path | Who | Purpose |
| --- | --- | --- |
| `GET /status` | user | Mode, readiness problems, limits, sent today, whether the caller can approve (no secrets) |
| `GET /campaigns?status=` | user | List campaigns with audience, sent, replies, meetings |
| `POST /campaigns` | user | Create draft `{ name, description?, settings? }` |
| `GET /campaigns/:id` | user | Campaign, steps, readiness (blocking issues and warnings), live recipient count |
| `PATCH /campaigns/:id` | user | Update name, description, settings |
| `POST /campaigns/:id/duplicate` | user | Copy steps into a new draft |
| `POST /campaigns/:id/approve` | approver | Approve the current content version (422 with issues if not ready) |
| `POST /campaigns/:id/activate` | approver | `{ confirm_recipients, start_at? }`. The count must match exactly |
| `POST /campaigns/:id/pause` | user | Pause sending |
| `POST /campaigns/:id/resume` | approver | Resume (needs current approval and matching mode) |
| `POST /campaigns/:id/cancel` | user | `{ confirm: true }`. Stops every recipient permanently |
| `POST /campaigns/:id/steps` | user | Add step `{ subject_template, text_template, html_template?, delay_minutes, active? }` |
| `PATCH /campaigns/:id/steps/:stepId` | user | Edit step (clears approval) |
| `DELETE /campaigns/:id/steps/:stepId` | user | Delete a never-sent step |
| `POST /campaigns/:id/steps/reorder` | user | `{ step_ids: [...] }` before anything is sent |
| `POST /campaigns/:id/preview` | user | Render `{ step_id \| subject+text, contact_id? \| enrollment_id? }` |
| `POST /campaigns/:id/ai-draft` | user | `{ step_order, purpose?, contact_id? }` |
| `GET /campaigns/:id/eligible-contacts?search=&crm_status=&eligibility=eligible\|ineligible&include_ids=` | user | CRM contacts with eligibility and reasons. Also returns `eligible_total`, `ineligible_total`, `crm_contacts`, and with `include_ids=true`, `eligible_ids` (all eligible ids matching the filters, capped at 1000) for "select all eligible". `only_eligible=true` is still accepted |
| `GET /campaigns/:id/enrollments?status=` | user | Recipients and progress |
| `POST /campaigns/:id/enrollments` | user | `{ contact_ids }` (max 500 per call). Returns enrolled and skipped with reasons |
| `GET /enrollments/:id` | user | Recipient detail: messages, events, drafts |
| `POST /enrollments/:id/pause` | user | Pause one recipient |
| `POST /enrollments/:id/resume` | user (approver if `ambiguous_resolution`) | `{ ambiguous_resolution?: "mark_sent" \| "resend" }` |
| `POST /enrollments/:id/remove` | user | Stop one recipient |
| `POST /enrollments/:id/mark-replied` | user | Manual reply signal |
| `PUT /enrollments/:id/drafts/:stepId` | user | Save a personalized draft for review |
| `POST /enrollments/:id/drafts/:stepId/approve\|reject` | approver | Review a personalized draft |
| `GET /test-recipient?to=` | user | `{ email, authorized, via, reason }` — whether an address may receive test emails, and why not |
| `POST /campaigns/:id/test-email` | approver | `{ step_id, to, contact_id? }`. `to` must be an active team member's email or match `EMAIL_TEST_RECIPIENTS` (and `EMAIL_RECIPIENT_ALLOWLIST` if set). 403 with the reason otherwise; 409 if the same user already has a test email in flight |
| `GET /campaigns/:id/events` | user | Send log and provider events |
| `GET /campaigns/:id/analytics` | user | Metrics (definitions below) |
| `GET/POST /suppressions`, `DELETE /suppressions/:id` | user / approver for delete | Suppression list. Only `manual` suppressions can be deleted |
| `POST /webhooks/brevo` | webhook token | Brevo transactional events |
| `POST /webhooks/brevo/inbound` | webhook token | Brevo inbound parsing (replies) |
| `GET/POST /unsubscribe/:token` | public | Unsubscribe confirmation / action |

**Rate limits** (in memory, per process): approve/activate/resume 30/h per user, test email 10/h, AI drafts 40/h, webhooks 600/min per IP, unsubscribe 30/min per IP. Behind a reverse proxy, configure Express `trust proxy` so per-IP limits see the client address.

### Analytics definitions

- **Emails attempted:** logical emails (recipient × step) that reached the send stage.
- **Accepted:** accepted by Brevo, or recorded in dry run.
- **Delivered:** messages with a Brevo `delivered` webhook.
- **Reply rate:** replies ÷ recipients who were sent at least one email.
- **Unsubscribe rate:** unsubscribes ÷ the same denominator.
- **Bounce rate:** hard bounces ÷ accepted emails.
- **Meetings:** Meeting tasks created for enrolled organizations after their enrollment. This is a proxy, since WSIS has no calendar integration.
- Opens are recorded but not reported, because mail privacy features make them unreliable.

## Authentication and permissions

WSIS has **no login yet**. The client names the acting user in `X-User-Id`, chosen in the sidebar. The email module:

- requires a valid, active user on every non-public endpoint (`401` otherwise);
- restricts approving, activating, resuming, deciding ambiguous sends, approving personalized drafts, sending tests, and lifting manual suppressions to roles in `EMAIL_APPROVER_ROLES` (default `admin,outreach`, which matches the seeded *Akash/outreach* user);
- lets any team member *stop* things (pause, cancel, remove, suppress).

`X-User-Id` is **not proof of identity**: anyone who can reach the API can claim to be an approver. Until real authentication is added, run WSIS only on a trusted network or behind an authenticating reverse proxy (VPN, SSO proxy, IP allowlist) that exposes only `/api/email/webhooks/*` and `/api/email/unsubscribe/*` publicly. Adding real authentication is the most important pre-production task for live sending.

## Configuration

All variables are server-side. Never prefix them with `VITE_`. Placeholders are in `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMAIL_DRY_RUN` | `true` | Anything but `false` keeps dry-run: nothing is sent |
| `EMAIL_PROVIDER` | `brevo` | Provider for live mode |
| `BREVO_API_KEY` | – | Brevo API key (SMTP & API → API keys) |
| `BREVO_API_BASE` | `https://api.brevo.com/v3` | Override only for testing |
| `BREVO_WEBHOOK_TOKEN` | – | Shared secret every webhook must present |
| `BREVO_SYNC_SUPPRESSIONS` | `false` | Also blocklist suppressed addresses as Brevo contacts |
| `EMAIL_SENDER_EMAIL` / `EMAIL_SENDER_NAME` | – / `WSIS Team` | Verified Brevo sender. `{{sender.name}}` and the footer use `EMAIL_SENDER_NAME`, falling back to “WSIS Team”; live sending still requires it to be set |
| `EMAIL_SENDER_COMPANY` | – | Shown in footer and `{{sender.company}}` |
| `EMAIL_SENDER_ADDRESS` | – | Postal address in every footer (required for live) |
| `PUBLIC_BASE_URL` | – | Public **https** URL of the API, used for unsubscribe links (required for live) |
| `EMAIL_REPLY_DOMAIN` | – | Inbound-parsing subdomain for reply detection |
| `EMAIL_REPLY_FORWARD_TO` | – | Team mailbox that receives a copy of each detected reply |
| `EMAIL_LIST_UNSUBSCRIBE_HEADER` | `true` | Add `List-Unsubscribe` / one-click headers |
| `EMAIL_SCHEDULER_ENABLED` | `true` | Run the background worker in this process |
| `EMAIL_SCHEDULER_INTERVAL_SECONDS` | `60` | Tick interval (min 5) |
| `EMAIL_WORKER_BATCH_SIZE` | `10` | Max emails per tick |
| `EMAIL_MAX_SEND_ATTEMPTS` | `4` | Attempts for transient failures |
| `EMAIL_RETRY_BASE_SECONDS` | `300` | Backoff base |
| `EMAIL_CLAIM_LEASE_SECONDS` | `600` | Worker lease length |
| `EMAIL_DAILY_SEND_LIMIT` | `100` | Max emails per IST day, all campaigns |
| `EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN` | `200` | Enrollment cap |
| `EMAIL_TEST_RECIPIENTS` | – | Comma list of addresses / `@domains` allowed to receive **test emails** (in addition to active team members' addresses). Does not affect sequences |
| `EMAIL_RECIPIENT_ALLOWLIST` | – | Comma list of addresses / `@domains`. When set, **every** email (test or sequence) must match — use it for the first live run |
| `EMAIL_APPROVER_ROLES` | `admin,outreach` | Roles that may approve and send |

Live activation and resume are refused while any of the required live settings are missing. `/api/email/status` and the UI banner list what is missing.

## Brevo setup

Checked against Brevo's developer documentation in October 2026. Re-check the current docs before going live.

1. **Account and policy.** Make sure Brevo's terms and anti-spam policy allow your use case. B2B prospecting to contacts who have not opted in may be restricted. Brevo may also ask for account validation before sending.
2. **Sender domain.** Brevo → *Senders, domains & dedicated IPs*: add and authenticate your sending domain (DKIM, DMARC, Brevo code), then add the sender address used in `EMAIL_SENDER_EMAIL`.
3. **API key.** *SMTP & API → API keys*: create a key and set `BREVO_API_KEY`. WSIS sends via `POST /v3/smtp/email` with the `api-key` header.
4. **Transactional webhook.** Pick a long random `BREVO_WEBHOOK_TOKEN` and create a webhook (UI or `POST /v3/webhooks`):
   ```json
   {
     "type": "transactional",
     "url": "https://<PUBLIC_BASE_URL host>/api/email/webhooks/brevo",
     "events": ["request", "delivered", "softBounce", "hardBounce", "invalid", "blocked", "spam", "unsubscribed", "deferred"],
     "auth": { "type": "bearer", "token": "<BREVO_WEBHOOK_TOKEN>" }
   }
   ```
   Brevo webhooks are not signed. WSIS accepts the token in any of three forms:
   - `Authorization: Bearer <token>`;
   - a custom header `X-Webhook-Token: <token>`, using Brevo's `headers` option;
   - HTTP Basic auth with the token as the password (`https://wsis:<token>@host/...`).

   Brevo's docs don't spell out exactly how the bearer token is delivered. After creating the webhook, send a test event and check that the API logs `200`, not `401`. If it fails, switch to the custom-header option. Optionally also allowlist Brevo's published webhook IP ranges at your proxy.
5. **Reply detection (optional but recommended).**
   - Choose a subdomain *different* from your sending domain, e.g. `reply.yourcompany.com`.
   - Add MX records: `inbound1.sendinblue.com.` priority 10 and `inbound2.sendinblue.com.` priority 20. Check Brevo's inbound-parsing page for the current values.
   - Create an inbound webhook:
     ```json
     { "type": "inbound", "events": ["inboundEmailProcessed"], "domain": "reply.yourcompany.com",
       "url": "https://<host>/api/email/webhooks/brevo/inbound", "auth": { "type": "bearer", "token": "<BREVO_WEBHOOK_TOKEN>" } }
     ```
   - Set `EMAIL_REPLY_DOMAIN` and `EMAIL_REPLY_FORWARD_TO`.
   - Test: send yourself a test sequence email (see below), reply to it, and confirm the recipient shows **Replied** in WSIS.

## Local development and testing

```bash
npm install
npm run dev        # dry-run by default; scheduler ticks every 60 s
npm test           # includes server/email/email.test.ts — mocked provider, no network, no API keys
npm run lint && npm run build
```

- In dry-run the whole flow works: create, enroll, approve, activate, scheduler "sends" (recorded as *Dry run*), CRM timeline entries, analytics. Use a 0-minute or 1-hour delay to watch steps progress, and turn off the send window to test outside business hours.
- To send a test email, add your address to `EMAIL_TEST_RECIPIENTS` in `.env` and restart the API, or give a team member that email address. The **Send test** card checks the address as you type and says whether it is authorized and why not. Only one test per user runs at a time, and refused attempts don't count towards the 10-per-hour test limit.
- To try webhooks locally, POST sample payloads with `Authorization: Bearer $BREVO_WEBHOOK_TOKEN`:
  ```bash
  curl -X POST localhost:3001/api/email/webhooks/brevo -H "content-type: application/json" \
    -H "authorization: Bearer $BREVO_WEBHOOK_TOKEN" \
    -d '{"event":"hard_bounce","email":"someone@example.com","message-id":"<id>","ts_epoch":1760000000000}'
  ```
- First live test: set `EMAIL_DRY_RUN=false`, all live variables, **and** `EMAIL_RECIPIENT_ALLOWLIST=you@yourcompany.com`, so no other address can receive mail. Create a campaign with only yourself as a CRM contact and run it.

The tests cover campaign validation, step ordering and delays, IST send windows, enrollment and duplicate prevention, suppression and unsubscribe enforcement, test-email allowlisting, due-job selection, parallel workers, lease expiry and interrupted sends, transient retry and give-up, permanent failures, ambiguous holds and webhook reconciliation, webhook auth and duplicate events, hard bounces, reply detection and auto-replies, pause/resume/cancel, activation guards, personalized-draft approval, AI-draft fact handling, Brevo request shape and error classes (mocked `fetch`), HTTP 401/403 role checks, and schema idempotency on PGlite.

## Production deployment

- Use PostgreSQL (`DATABASE_URL`). Run the test suite or a staging smoke test against it first (see *PostgreSQL vs PGlite*).
- Put the API behind HTTPS. Set `PUBLIC_BASE_URL` to that origin. Restrict everything except webhooks and unsubscribe to trusted users (see *Authentication*).
- Several API instances can run the scheduler safely against one PostgreSQL database, because claims are atomic. The in-memory rate limits and daily-limit check are per process, so with several instances keep `EMAIL_SCHEDULER_ENABLED=true` on **one** instance only.
- Logs never include API keys, webhook tokens, email bodies or recipient lists; they show counts and sanitized provider errors only.
- Watch the **Activity** tab and Brevo's logs for bounces and complaints after each launch, and pause immediately if the bounce rate climbs above a few percent.

## Safe activation checklist

1. Sender domain authenticated in Brevo. `EMAIL_SENDER_*`, `PUBLIC_BASE_URL` (https) and webhook token set. `/api/email/status` shows `live_ready: true`.
2. Webhooks tested (delivered, bounce, and reply if configured).
3. Recipients are lawfully contactable business contacts with a genuine reason to hear from you. No scraped or purchased lists.
4. Each step reviewed in **Preview** for several real recipients. No missing values, no placeholders, honest subject lines.
5. Test email received and checked (rendering, footer, unsubscribe link, Reply-To).
6. Approved by an approver, then activated by typing the exact recipient count.
7. Start small, e.g. 10–20 recipients, and watch bounces and replies for a day before enrolling more.

## Known limitations

- No real user authentication. `X-User-Id` is trusted (see above).
- The module has only been run on PGlite here, not yet on a PostgreSQL server.
- Brevo has no documented send idempotency, so a timed-out send is held for review rather than retried. Duplicate sends are prevented, but a human sometimes has to decide.
- Brevo's bearer-token delivery details and the per-event payload fields were taken from its docs, which are inconsistent in places. The parser accepts the documented variants; verify against live payloads.
- Reply detection needs the inbound-parsing subdomain. Without it, replies must be marked manually. Mailbox (IMAP/Graph) integration is not implemented.
- Suppression sync to Brevo is best effort; WSIS's own list is authoritative.
- The Day-N labels in the editor assume every email is sent on time. Send windows, retries and holds can push later steps back.
- External email delivery and reply detection have **not** been tested against a real Brevo account; only the mocked provider and dry run have been exercised.
