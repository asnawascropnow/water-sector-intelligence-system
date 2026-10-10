# WSIS expansion: architecture and phased plan

Status: Phases 1 (foundation), 2 (data model), 3 (organization taxonomy in the UI), 4 (project API) and 5 (Projects UI and built-environment intelligence) complete. Phases 3 to 12 are proposals that each need approval before implementation.

WSIS (Water Sector Intelligence System) extends the Bengaluru Water Intelligence and CRM MVP so it also covers the built environment: architects, developers, contractors, consultants and construction projects. It extends the existing system. It is not a separate application.

## 1. Current architecture (as of Phase 1)

| Layer | Technology | Location |
| --- | --- | --- |
| Client | React 19, Vite, Tailwind 4, React Router (hash), Leaflet + markercluster | `src/` |
| API | Express 4, TypeScript run with tsx | `server/app.ts` (app factory), `server/index.ts` (startup) |
| Shared contract | Types and constants used by client and server | `shared/` |
| Database | PostgreSQL + PostGIS when `DATABASE_URL` is set; otherwise PGlite + PostGIS in `.data/pglite` | `server/db/` |
| Schema | Versioned SQL migrations | `server/db/migrations/` |
| Agents | Rule-based by default; Gemini optional for extraction and web research | `server/agents/`, `server/extraction/` |

### Database

| Table | Role |
| --- | --- |
| `organizations` | Master record. PostGIS point, per-field provenance (`field_sources`), AI intelligence (`intelligence`), `merged_into` for merged duplicates. |
| `contacts` | People at an organization. |
| `sources` | Where data came from: manual, file upload, API, website, geocoder, AI inference, seed. |
| `imports` | Staged records awaiting human review (JSONB). |
| `crm_opportunities` | The relationship the team is pursuing. Currently one per organization (`UNIQUE organization_id`) with a fixed stage list. |
| `activities` | Append-only timeline. |
| `tasks` | Follow-ups. An opportunity's `next_follow_up` is derived from its earliest pending task. |
| `agent_recommendations` | Every agent's output: next actions, opportunity suggestions, import reviews, enrichment suggestions. |
| `audit_logs` | Every write, with the acting user. |
| `schema_migrations` | Applied migration versions and checksums. |

### Principles already enforced in code

- **Organization ≠ CRM opportunity.**
- **No invented data.** Every value carries a provenance label (Verified, Unverified, Estimated, AI Inference or Unknown) and a source.
- **Human review** before imported or AI-suggested data becomes trusted.
- **One record per organization.** Duplicate detection runs on entry, on import and again at approval. Merges fill empty fields only.
- **Append-only timeline.**
- **No automated outreach.** Agents only recommend.

## 2. Approved decisions

- **One master organization table.** Architects, developers, contractors, consultants, water-technology firms and so on are organization *types*, never separate tables.
- **Projects are a first-class entity**, linked many-to-many with organizations through a role-bearing relationship.
- **Multiple CRM opportunities per organization.**
- **Two CRM pipelines:**
  1. *Organization / Relationship:* New → Contacted → Call → Proposal Sent → Follow-up → Pilot → Converted, with outcomes Not Interested, Lost and Nurture. This is today's pipeline, unchanged.
  2. *Project Opportunity:* Identified → Research → Contacted → Meeting → Technical Discussion → Proposal → Negotiation → Pilot/Project → Won.
- **PostgreSQL + PostGIS** relational modelling. No graph database.

## 3. Migration design (implemented in Phase 1)

- **Files:** `server/db/migrations/NNNN_description.sql`, for example `0002_organization_types.sql`. The name pattern is enforced, and duplicate versions are rejected.
- **Runner:** `server/db/migrate.ts`. It is called by `initDb()` at every server start, and also by `npm run migrate` and `npm run migrate:status`.
- **Transactions:** each pending migration runs in its own transaction, together with its `schema_migrations` row. A failing migration rolls back completely and is not recorded.
- **Immutability:** `schema_migrations` stores a SHA-256 checksum of each applied file. If an applied file is edited or deleted, startup fails with a clear error. Fix forward with a new migration.
- **Concurrency:** on PostgreSQL each migration takes `pg_advisory_xact_lock` and re-checks whether it is already applied. PGlite is single-process, so no lock is needed.
- **Baseline (`0001_baseline.sql`):** the exact MVP schema, still fully idempotent. A database created before the runner existed adopts it safely: the file runs, changes nothing, and version 0001 is recorded. The developer database was adopted this way with no data change. `GET /api/system` reports `schemaVersion`.
- **Rules for future migrations:**
  - Be additive first: new tables, nullable columns and backfills.
  - Change or remove constraints only after the code that depends on them is updated. For example, drop `UNIQUE (organization_id)` on `crm_opportunities` only in the same phase that updates every one-opportunity query.
  - Every migration must work on both PostgreSQL and PGlite. Keep to plain PostgreSQL + PostGIS, with no pg_trgm and no extensions PGlite lacks.
- **Running `npm run migrate` locally:** PGlite allows a single process. The API server records its PID in `.data/pglite.server.pid`, and `npm run migrate` / `npm run migrate:status` refuse to open the database while that server is alive (Phase 2). Stop the dev server first, or rely on the automatic migration at startup and read `schemaVersion` from `GET /api/system`.

## 4. Phase 2: data-model foundation (implemented)

Phase 2 laid the schema for the whole expansion (the table rows for Phases 2, 3, 4, 6 and 7 below) without changing the existing UI or user-facing behaviour. No UI, project pages, map layers or CRM board changes were made.

| Migration | What it adds |
| --- | --- |
| `0002_organization_types_and_facts.sql` | `organization_type_groups` (7 groups) and `organization_types` (34 types: the 12 MVP types with unchanged names, plus water-ecosystem, built-environment, public-sector, research and civil-society types). Any type already in use that is not in the catalog is preserved as an inactive "legacy" type. `organizations.org_type` gets a foreign key to the catalog. `fact_definitions` (keys, value type, allowed values, single/multi-valued, intended type groups) and `organization_facts`. |
| `0003_projects_and_stakeholders.sql` | `project_types`, `stakeholder_roles`, `projects` (mirrors organizations: normalised name, PostGIS point, lifecycle stage, scale, built-up area, buildings, units, field provenance, confidence, `merged_into`), `project_facts` and project fact definitions, `project_organizations`. |
| `0004_water_opportunities.sql` | `water_intervention_types` and `water_opportunities` for a project, an organization, or both. |
| `0005_pipelines_and_crm.sql` | `pipelines`, `pipeline_stages` (kind open/won/lost, outcome flag, milestone tag) and `opportunity_types`. `crm_opportunities` gains `pipeline`, `opportunity_type`, `project_id` and `title`; the one-per-organization UNIQUE and the fixed status CHECK are replaced by a composite foreign key `(pipeline, status) → pipeline_stages`. |

### Rules enforced by the database

- **Facts and stakeholder links** must carry a provenance (Verified, Unverified, Estimated, AI Inference). Anything not Verified must cite a source. "Unknown" is the absence of a row. Facts are never deleted: replacing or withdrawing one sets `retired_at`. An active value is stored once per entity and key.
- **Stakeholders:** one row per project, organization and role; at most one primary organization per role on a project.
- **Water opportunities:** status starts at `suggested`. Moving past it requires a named reviewer (`reviewed_by`, `reviewed_at`). AI output (`origin = 'ai'`) must be labelled AI Inference. A CRM link is allowed only on reviewed, live opportunities. One live opportunity per target and intervention type. *This replaces the earlier plan of keeping AI suggestions in `agent_recommendations`: suggestions live here with status `suggested`, so the approval rule is enforced by the database rather than by convention.*
- **Pipelines:** a CRM stage must belong to the opportunity's pipeline; exactly one default pipeline; one stage per milestone per pipeline; the won milestone sits on the won stage. No duplicate *open* CRM opportunity of the same type for the same organization and project.

### Data preservation

- Existing rows are not modified by any migration (proven by a test that snapshots every MVP table before and after upgrading a populated 0001 database).
- Existing CRM opportunities become relationship-pipeline `Customer` opportunities with their status untouched. `Customer` is the default because the MVP CRM tracked prospective customers.
- Nothing is backfilled: no facts, projects, stakeholders or water opportunities are created for existing data.

### Compatibility with the existing API

- `POST /api/crm` still allows one opportunity per organization (409 otherwise) until the multi-opportunity CRM is built in Phase 7.
- Where the MVP shows "the" opportunity of an organization (organization list, organization detail, task attachment), a stable primary is chosen: relationship pipeline first, open before closed, then the oldest. Lists never show an organization twice; they also report `crm_opportunity_count`.
- `PATCH /api/crm/:id` validates a stage against the opportunity's own pipeline (identical to before for the relationship pipeline).
- Organization create and edit accept any active catalog type by exact, case-insensitive name (for example "Architect"); other input keeps the MVP heuristics. Imports are unchanged. The UI still uses the MVP `ORG_TYPES` list.
- Merging organizations also moves facts, project links and water opportunities; rows that would collide with the surviving record stay on the merged record instead of being deleted.
- Not yet pipeline-aware (Phase 7): dashboard counts and the Next Action rules assume relationship-pipeline stage names. No project-pipeline opportunities can be created through the API yet.

### New capabilities

- `GET /api/meta`: all catalogs (organization types and groups, project types, lifecycle stages, scales, stakeholder roles, intervention types, opportunity types, pipelines with stages, fact definitions).
- Service layer for later phases' routes and agents: `server/lib/catalog.ts`, `facts.ts` (add with validation and canonical values, retire, list), `projects.ts` (validated create, stakeholders, an organization's projects), `waterOpportunities.ts` (AI suggestion, manual create, human review).

### Phase 3: organization taxonomy in the existing UI (implemented)

- **Migration `0006_organization_views.sql`:** `organization_views` and `organization_view_types` define the saved Discover views (Architects, Developers, Contractors, Water Ecosystem) as sets of catalog types. Members are foreign keys to `organization_types`.
- **API:** `GET /api/meta/organization-types` returns groups, every type (key, label, group, group label, sort order, active, map colour, description) in group → type → name order, and the views with their member types. `GET /api/meta` also includes `organizationViews`. `GET /api/organizations?view=<key>` restricts the list to a view's types and combines with `q`, `type`, `area`, `crm` and `potential`; an unknown view is a 400.
- **UI:** the sidebar lists the views under Organizations (from the API, not hard-coded). Each opens `/organizations?view=<key>`, which applies the view's types to the Organizations page; other filters work on top, and choosing different types leaves the view. The type filter is a grouped multi-select built from the catalog. The add/edit form offers catalog types grouped. Map markers for new types use the existing fallback colour.
- **Fix:** clearing the type in the edit form now stores "Other" labelled Unknown instead of failing.

### Phase 4: project and stakeholder API (implemented, no new UI)

- **Migration `0007_project_api_foundation.sql`:** `imports.kind` (organizations / projects / mixed, existing imports default to organizations); `replaces_fact_id` on both fact tables so a changed fact keeps its history; `updated_by` on projects and stakeholder links; pincode and type indexes on projects.
- **Projects** (`server/routes/projects.ts`): `GET /api/projects` (filters `q`, `stage`, `type`, `scale` as comma lists, `area`, `pincode`, `organization_id`, `role`, `near=lat,lng` + `radius` in metres, `limit`), `POST /api/projects` (409 `{ duplicate }` unless `force`), `POST /api/projects/check-duplicates`, `GET /api/projects/:id` (project, stakeholders, facts, CRM and water opportunities; `{ merged_into }` for a merged project), `PATCH /api/projects/:id` (changed values labelled Verified, cleared values Unknown), `POST /api/projects/:id/merge-into/:targetId` (explicit human merge).
- **Stakeholders:** `GET|POST /api/projects/:id/stakeholders`, `PATCH|DELETE /api/projects/:id/stakeholders/:linkId`. Removal deletes the link but records the full row in the audit log and a timeline entry on the organization.
- **Project facts:** `GET /api/projects/:id/facts` (`?include_retired=1` for history), `POST`, `PATCH /:factId` (versioned: the current row is retired, a new row records `replaces_fact_id`; omitted fields keep provenance, confidence and source), `DELETE /:factId` (retire).
- **Organizations:** `GET /api/organizations/:id/projects`; the detail response adds `projects` and `opportunities` (all CRM opportunities). The list and existing fields are unchanged.
- **Duplicate detection** (`server/lib/projectDuplicates.ts`): normalised name with phase/tower/block designators separated, PostGIS distance, address, pincode, project type and website. Names differing only in phase/tower/block are capped at `possible_duplicate` and flagged `separate_part`. Nothing is merged automatically.
- **CRM:** `POST /api/crm` accepts `opportunity_type`, `pipeline` (default: the type's pipeline), `project_id`, `title`, `status` (default: first stage). Only a second *open* opportunity of the same type for the same project conflicts; the default call behaves as before. `GET /api/crm` accepts `pipeline` and `project_id`. Made pipeline-aware in Phase 7.
- **Imports:** staged records carry `entity_type`; file uploads stage organizations exactly as before. `POST /api/imports/json` can stage `entity_type: "project"` records, validated and duplicate-checked like the projects API; approve / keep separate create the project, edit re-validates, merge is not supported yet. Summaries report `kind` and organization / project counts.

### Phase 5: Projects UI and built-environment intelligence (implemented)

- **Migration `0008_fact_profiles_and_project_activity.sql`:** `fact_definitions.profiles` ties each organization fact to saved views (architects, developers, contractors), so the intelligence section shown for an organization is configuration; adds contractor facts (construction project types, specialties, MEP / water-system involvement, water systems executed); adds the append-only `project_activities` timeline.
- **API additions:** `GET|POST /api/organizations/:id/facts`, `PATCH|DELETE /api/organizations/:id/facts/:factId` (versioned like project facts); organization detail adds `facts`, and its `opportunity` is now the relationship-pipeline opportunity only (project opportunities are in `opportunities`); `GET /api/projects/facets` (areas and stakeholder organizations for filters); `GET /api/projects/:id/activity` (project timeline plus CRM activity of linked opportunities); project list rows add `water_opportunity_count` and `crm_opportunity_count` (computed in the same query).
- **UI:** `/projects` (server-side search and filters: stage, type, scale, area, stakeholder organization, role) and `/projects/:id` with Overview, Stakeholders, Water Intelligence, Opportunities (read-only), CRM and Activity tabs. Create/edit project with duplicate review requiring an explicit "Keep separate". Organization Details adds a Projects card, project/other opportunities, and a Built Environment Intelligence section shown only for organization types in a profile (or when facts exist). One reusable `FactsPanel` serves organization and project facts.
- **Testing:** pure UI logic lives in `src/lib/projectUtils.ts` with unit tests; there is no component-rendering test harness yet, so UI flows were verified by driving the app in headless Chrome against an isolated database copy.

### Phase 6: water intelligence and opportunity engine (implemented)

Facts are evidence; a water opportunity is an interpretation of that evidence. Rules may suggest; only a person's approval makes an opportunity trusted.

- **Migration `0009_water_opportunity_engine.sql`:** `water_intervention_groups` plus `key` / `group_key` / description / order on `water_intervention_types` (labels unchanged; adds Alternative Water Supply and Integrated Water Management). `water_opportunities` gains `context_key`, `rule_key`, `evidence_refs` (JSON snapshot of the facts / fields used, each with provenance, source and the exact fact version id), `evidence_signature`, `evidence_current`, `refreshed_at`, `outcome`, `updated_by`. Status model: `suggested → needs_review → approved | rejected`, `approved → converted (CRM linked) → closed (outcome)`. Phase 2 statuses are mapped (pursuing → converted/approved; won/lost/dropped → closed with an outcome). Database checks: decisions need a named reviewer; `converted` needs a CRM link; one live opportunity per target + intervention + context.
- **Design change from the original plan:** suggestions live in `water_opportunities` with status `suggested` (as Phase 2 already modelled), not in `agent_recommendations`. "Trusted" means status `approved` or `converted`. `agent_recommendations` carries only the follow-up nudges.
- **Rule engine** (`server/agents/waterOpportunity.ts`, part of the Opportunity Agent): pure functions over a project's or organization's *current* facts. Each rule needs specific evidence, quotes it in the reason ("…has sourced evidence of an STP…, but no sourced evidence of wastewater reuse. Wastewater reuse may therefore be worth investigating."), and never states a requirement as fact. AI-inferred facts are never triggers. Confidence comes from the triggering evidence (all Verified → High; Unverified/Estimated → Medium; free-text → at most Medium; inferred organization type → Low). Organization rules cover architects (water-design evidence + influence), developers (several projects), and facility organizations' own water evidence; water-ecosystem vendors and built-environment firms get no facility-level rules. Project suggestions stay on the project; stakeholders never inherit them.
- **Applying results** (`generateWaterOpportunities`): runs only on a person's request (`POST /api/water-opportunities/generate`). New hypotheses become `suggested`; an open AI suggestion is refreshed in place; approved / converted / manual ones are left as decided; a hypothesis rejected or closed on the same evidence is not resurfaced; open suggestions whose rule no longer fires are flagged `evidence_current = false`, never deleted.
- **Review and CRM:** `POST /:id/review` (start / approve / reject — reject needs a reason), `PATCH /:id` (owner, potential, close with outcome, reopen, reconsider), `POST /:id/convert` (project → Project Opportunity pipeline for a stakeholder the person chooses, project kept; organization → relationship pipeline; or link an existing compatible CRM opportunity; double conversion refused). CRM creation is shared with `POST /api/crm` (`createCrmOpportunity`). Every step is in `audit_logs` (`GET /:id` returns the history) and on the project / organization timeline.
- **Agents / dashboard:** the Opportunity Agent adds "Review N water suggestions for X" and "Decide the next step for <approved intervention>" recommendations (the latter names the project's stakeholders and whether each is already in the CRM). `GET /api/dashboard/summary` and the daily brief add a `water` count object (to review, approved in 7 days, high potential open, project opportunities awaiting next action); the dashboard UI is unchanged. `GET /api/water-opportunities/map` prepares trusted opportunities as map metadata; no map layer yet.
- **UI:** Project → Opportunities shows AI suggestions, Needs review, Approved, Rejected / closed (always listed), each with intervention, potential, status, provenance, confidence, reason, evidence chips (marked "changed since" when the fact version was replaced), source, reviewer, owner, CRM link and history. Organization Details adds a Water opportunities card: organization-level opportunities (actionable) and, separately, those on the organization's projects (read-only, with its role, linking to the project).

### Phase 7: CRM for both pipelines (implemented)

A relationship opportunity and a project opportunity are different CRM records, even with the same organization.

- **Migration `0010_crm_pipelines.sql`:** project pipeline outcomes `Lost` (lost) and `Nurture` (open, outcome). `crm_opportunities.potential` (the team's rating; the organization's AI potential is shown separately and labelled) and `source_water_opportunity_id` (link back to the converted water opportunity, backfilled from existing conversions). `tasks.project_id` and `activities.project_id`, backfilled only from each row's own opportunity.
- **Pipelines from the database:** stages, order, outcome flags and milestones come from `pipeline_stages` everywhere (board, detail, dashboard, Next Action Agent, automatic stage movement). The hard-coded `advance()` was replaced by `advanceByMilestone()`: interactions and proposal / pilot changes move an opportunity forward along *its own* pipeline's main track only (e.g. "meeting held" → Meeting in the project pipeline; nothing in the relationship pipeline, which has no meeting stage). People can move stages forward, backward (`stage_step`) or to any stage of the same pipeline; other pipelines' stages are rejected. Every change, including automatic ones, is on the timeline.
- **Creation rules:** relationship opportunities as before (default Customer; other relationship types allowed). Project opportunities need a project and a customer that is a stakeholder on it; the type must belong to the pipeline. Duplicate rules unchanged.
- **API:** `GET /api/crm` filters (combinable, server-side): pipeline, stage, owner, type, organization_id, project_id, potential, intervention, lifecycle, open, and `q` (organization, project, title, contact person, intervention). `GET /api/crm/facets`, `GET /api/crm/:id` (opportunity + stages, organization + contacts + its other opportunities, project + stakeholders, linked water opportunities, tasks, timeline), `GET /api/crm/map` (map-ready, located by project or organization; not used by the map yet). PATCH adds `stage_step`, `potential`, `title`, `opportunity_type`. Interaction type `meeting_held`. `POST /api/tasks` accepts `opportunity_id` (organization and project derived) or `project_id`; organization-only tasks attach to the organization's *relationship* opportunity only. `GET /api/tasks` filters by opportunity, project, organization.
- **Activities:** an entry about an opportunity carries its project, so one row appears on the opportunity, organization and project timelines (the separate project copy written on CRM creation / water conversion was removed). Project merges move task / activity project links with their opportunities.
- **Agents and counts:** the Next Action Agent covers open opportunities in both pipelines using stage kinds and milestones; relationship wording is unchanged; project actions always name the project (and can suggest contacting the project's MEP / plumbing / green-building consultant during technical discussion). Dashboard and daily brief add per-pipeline counts (open, needing action, follow-ups due, in proposal, proposals awaiting response, pilots, won). Existing counts now use stage kinds, so a won project opportunity is not "active".
- **One-opportunity assumptions removed:** the organization list's CRM column is the organization's *relationship* status only (project-only organizations show a "project opps" badge; "in CRM" means any opportunity); the map popup and Organization Details separate relationship and project opportunities; tasks never attach an organization task to a project opportunity.
- **UI:** CRM board with a pipeline switcher, database-driven columns, filters and search; labelled project cards (title, project, customer and role, type, stage, potential, intervention, owner, next task). New opportunity detail page `/crm/:id`. Project CRM tab links to opportunities and lists project tasks. Project opportunity creation requires choosing the customer when there are several stakeholders. Add to CRM can choose a relationship type, title and potential.

## 5. Proposed design for Phases 6 to 12

The schema in the table below for Phases 2, 3, 4, 6 and 7 now exists (section 4); those phases deliver the API, UI and behaviour on top of it.
Each phase gets its own numbered migration, tests and approval.

| Phase | Schema | Notes |
| --- | --- | --- |
| 2. Organization types | `organization_types` (key, label, group, colour, map_layer, sort, active), seeded with today's 12 types plus water-ecosystem and built-environment types. `organization_facts` (organization, key, value, provenance, source, confidence, author) for sourced attributes. | `org_type` stays a text column, so existing values remain valid. `GET /api/meta` serves the catalog; the UI stops hard-coding `ORG_TYPES`. Architects, Developers, Contractors and Water Ecosystem become saved Organizations filters, not new pages. |
| 3. Projects | `projects`, mirroring organizations: name, normalised name, project type, description, address, area, pincode, PostGIS point, website, lifecycle stage (Concept to Operations, or Unknown), built-up area, buildings, units, scale, source, confidence, field provenance, `merged_into`. `project_facts` holds sourced water and sustainability facts. | Project duplicate detection handles phases, towers and location. |
| 4. Stakeholders | `project_organizations` (project, organization, role, primary flag, source, provenance, confidence, notes), unique per project, organization and role. A shared, extensible roles catalog. | Many-to-many in both directions. |
| 5. Project UI | Projects list and detail with tabs: Overview, Stakeholders, Water Intelligence, Opportunities, Activity. | Progressive disclosure. |
| 6. Water intelligence | `water_opportunities` (project and/or organization, intervention type, potential, reason, evidence, source, provenance, confidence, status, owner, optional CRM link). | Implemented — see Phase 6 above. AI suggestions are `suggested` rows here; only approved / converted rows are trusted. |
| 7. CRM expansion | `pipelines` and `pipeline_stages` (key, label, order, outcome flag, milestone tag). `crm_opportunities` gains title, opportunity type, pipeline and optional project. `UNIQUE (organization_id)` and the fixed status check are dropped; stages are validated against the pipeline. | Highest-risk phase: about 14 one-opportunity queries, organization-list joins, task attachment by organization, and merge rules. Existing rows move to the Relationship pipeline unchanged. Milestone tags keep auto-advance and Next Action rules working in both pipelines. |
| 8. Map layers | `GET /api/map?bbox&layers=` | Organizations on by default. Projects, CRM and type groups are opt-in toggles. |
| 9. AI agents | Project Intelligence, Architect Intelligence, Construction Opportunity, Water Intervention | Deterministic rules plus optional LLM. Every output goes to the review queue with sources and labels. |
| 10. Relationship intelligence | Queries over `project_organizations`, `crm_opportunities` and `water_opportunities` | "Who is connected to whom, through which projects." |
| 11. Document intelligence | `imports.kind` (organizations, projects or mixed); staged records gain an entity type (organization, project or relationship). | Same review-before-save rule. |
| 12. Hardening | Paging and map-area queries, UX polish, real-PostgreSQL CI | |

## 6. Testing strategy

`npm test` runs every `server/**/*.test.ts` file with Node's built-in test runner, through tsx.

| Suite | Covers |
| --- | --- |
| `server/db/migrate.test.ts` | Fresh install, idempotent re-run, adopting a pre-runner database, ordering, rollback on failure, edited or missing applied files, file naming. |
| `server/test/system.api.test.ts` | System info and schema version, users, the legacy seed (Rule 2: no invented contact data, unverified/low confidence), map data, 404 and malformed JSON, dashboard summary. |
| `server/test/organizations.api.test.ts` | Manual create and normalisation, provenance, timeline, audit, validation, duplicate block/merge/keep-separate, edits, filters, contacts, water info, agents, record merge, bad ids. |
| `server/test/imports.api.test.ts` | Upload validation, CSV extraction, duplicate classification, review-before-save, approve/merge/edit/reject, completion, API feed, failed import. |
| `server/test/crm.api.test.ts` | CRM create and uniqueness, interactions and auto-advance, PATCH validation, append-only timeline, tasks and overdue detection, next-follow-up sync, dashboard counts, daily brief and recommendations. |
| `server/db/wsis-migration.test.ts` | Upgrading a populated 0001 database preserves every row; existing CRM opportunities land in the relationship pipeline; catalog covers every MVP type and preserves unknown legacy types; nothing is backfilled; pipeline stage lists and integrity constraints. |
| `server/test/wsis.api.test.ts` | `/api/meta`; architect/developer/contractor organizations via the existing API; project creation and validation; many-to-many stakeholders and role uniqueness; organization and project facts; water-opportunity approval rules; multiple CRM opportunities with unchanged API behaviour; merges carrying the new data. |
| `server/test/orgtypes.api.test.ts` | Organization-type metadata, saved views, type and view filtering. |
| `server/test/projects.api.test.ts` | Projects create/validate/list/filter/detail/update, duplicate detection, stakeholders (add, many-to-many, roles, primary, duplicates, update, remove), project facts (create, versioned change, withdraw), organization ↔ project data, CRM with projects/types/pipelines, project merge, organization/project/mixed imports. |
| `server/test/phase5.api.test.ts` | Fact profiles, organization facts API with history, project list counts, filter facets, organization ↔ project detail, project activity timeline, relationship-only CRM panel opportunity, saved views and CRM unchanged. |
| `src/lib/projectUtils.test.ts` | Projects query building, stakeholder grouping by role, intelligence profile selection, fact grouping and history, value formatting. |
| `server/agents`, `server/extraction`, `server/lib` | Agents, duplicate detection, extraction (xlsx, csv, docx, pdf) and normalisation unit tests. |

- **Database targets:** API tests run against a fresh in-memory PGlite + PostGIS database per file. With `TEST_DATABASE_URL` set, they run against real PostgreSQL + PostGIS instead, inside a throwaway schema that is dropped afterwards. No PostgreSQL server is available on the current development machine, so that path needs a database URL or CI.
- **Per phase:** each phase adds tests for its own features and must keep every earlier test passing. Every phase must pass `npm run lint`, `npm test` and `npm run build`.

## 7. Risks

- **Removing one-opportunity-per-organization (Phase 7)** touches many queries. The regression suite added in Phase 1 is the safety net.
- **Sparse automatic intelligence without an LLM key.** Rule-based agents only reason over data that exists and never fill gaps.
- **Data-collection terms of service.** Scraping builder sites or the Karnataka RERA portal raises legal questions. Prefer uploads, manual entry and user-triggered website reads.
- **Scale.** The client loads all organizations at once. Paging and map-area queries are needed once projects arrive.
- **No authentication yet.** The audit trail relies on the "working as" selector.
