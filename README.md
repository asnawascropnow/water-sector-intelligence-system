# Bengaluru Water Intelligence & CRM (MVP)

Discover organizations in Bengaluru → collect their data → show them on a Bengaluru map → identify potential customers → manage outreach → track follow-ups → let AI recommend the next action.

This MVP is **Bengaluru only**. The earlier India-wide map, dashboards and modules were removed. Geography lives in `shared/constants.ts` (`CITY`) so other cities can be added later.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev          # API on :3001, web app on :3000 (set WEB_PORT to change)
```

Open http://localhost:3000. On first start the database is created and seeded with two users (Fayaas, Akash) and 145 Bengaluru organizations carried over from the old prototype. Those records are labelled *Legacy prototype dataset (unverified)* with Low confidence. Only name, type, address, location and website were kept. Set `SEED_DEMO_DATA=false` to start empty.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests (extraction, normalisation, duplicate detection, agents, email outreach) |
| `npm run lint` | TypeScript type-check of client, server and shared code |
| `npm run build && npm start` | Production build; the API serves the built client |

## Database

PostgreSQL + PostGIS. Schema: `server/db/schema.sql`. It is applied idempotently on every start.

- **Production:** set `DATABASE_URL` to a PostgreSQL server with the PostGIS extension available.
- **Local default:** with no `DATABASE_URL`, the server uses PGlite (PostgreSQL compiled to WASM, with PostGIS) stored in `.data/pglite`. Delete that folder to reset.

Core tables: `organizations`, `contacts`, `sources`, `imports`, `crm_opportunities`, `activities`, `tasks`, `users`, `agent_recommendations`, `audit_logs`, plus the `email_*` outreach tables.

## Configuration

See `.env.example`. All settings are optional.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL + PostGIS connection string |
| `GEOCODER` | `nominatim` (default) geocodes imported addresses with OpenStreetMap; `none` disables it |
| `GEMINI_API_KEY` | Enables AI extraction of unstructured PDF/DOCX files and AI web research in the enrichment agent |
| `GEMINI_MODEL` | Model for the above (default `gemini-2.5-flash`) |
| `VITE_MAP_TILE_URL` | Custom basemap tiles. Default is Esri World Street Map, which needs no key |
| `EMAIL_*`, `BREVO_*`, `PUBLIC_BASE_URL` | Email outreach (server-side only). See [docs/email-automation.md](docs/email-automation.md#configuration) |

## How it fits together

```
File upload / manual entry / API (POST /api/imports/json)
  → Data Extraction Agent (xlsx, csv, pdf, docx)
  → normalise (phone, website, pincode, area, type) + geocode
  → duplicate check (name, address, phone, website, location)
  → human review (approve / edit / merge / reject)
  → organizations ─┬─ Bengaluru map (discovery)
                   └─ Add to CRM → opportunity → contact / call / proposal / follow-up / pilot / converted
  → agents: Opportunity, Next Action, Daily Reminder, Enrichment → recommendations with reasons
```

### Rules enforced in code

- **Do not invent data.** Every field carries provenance: Verified, Unverified, Estimated, AI Inference or Unknown, plus its source. Missing values show as Unknown. Geocoded locations are marked Estimated with their precision.
- **Human review.** Imported records are staged and only saved once approved. "Approve all new" skips anything with a possible duplicate.
- **One organization record.** Duplicates are checked on manual entry, on import and again at approval. Merge fills empty fields only and notes conflicts in the timeline.
- **Organization ≠ CRM opportunity.** An organization enters the CRM only through "Add to CRM", and has at most one opportunity.
- **Timeline is append-only.** Status changes, calls, proposals and follow-ups add activities. Nothing is deleted.
- **Outreach is human-approved.** Agents only recommend. Email sequences (below) send only after an approver reviews the content and activates the campaign, and they start in dry-run mode.

### AI agents

Agents are in `server/agents/`, and AI extraction is in `server/extraction/llm.ts`.

| Agent | Behaviour |
| --- | --- |
| Data Extraction | Rule-based parsing of spreadsheets, document tables and free text. Uses Gemini for unstructured files when a key is set. |
| Organization Enrichment | Reads the organization's own website, geocodes the address, and runs AI web research when a key is set. Results are suggestions with sources that a person must accept. |
| Opportunity | Transparent scoring from type, sector, recorded water information and industrial-cluster location. Gives High, Medium, Low or Unknown with reasons and a confidence level. |
| Next Action | One recommended next step per open opportunity, such as assign, first contact, retry, send proposal, follow up on proposal, check pilot, or re-engage. |
| Daily Reminder | Today's follow-ups, calls, proposals awaiting response, new and unassigned opportunities, and records awaiting review. |

Recommendations refresh on server start, hourly, and whenever the dashboard or AI page loads. They resolve themselves once their condition clears.

### Email outreach

Approval-gated email sequences to CRM contacts, sent through Brevo, under **Engage → Email Outreach**. Sequences stop on reply, unsubscribe, bounce or CRM outcome, and every email is logged on the organization timeline. The module runs in dry-run mode (nothing is sent) until `EMAIL_DRY_RUN=false` and Brevo is configured. See [docs/email-automation.md](docs/email-automation.md) for setup, webhooks, reply detection and the safe-activation checklist.

## Not in this MVP

India-wide map or analytics, login/authentication, OCR for scanned PDFs, advanced reporting.
