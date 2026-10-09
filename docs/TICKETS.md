# Implementation Tickets

Implement in small vertical slices.

Do not attempt to build the whole application in one pass.

For each ticket, Codex should return:
- What changed
- Files changed
- Tests added/updated
- Commands run
- Risks/TODOs

Before a ticket is complete, run:

```bash
npm run agents:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
```

If a command does not exist yet, add it or explicitly state why it does not exist.
For UI/design-system changes, also run `npm run design-system:check`.

Every new or materially changed product/design ticket includes a Platform
impact table for web, desktop, marketing, and future mobile. Each entry must
name an implementation reference, a follow-up ticket, or an explicit
not-applicable reason. Existing interaction IDs and the design-system catalog
own shared intent and evidence; do not add a parallel decision system.

---

## Ticket 001: Initialize app

Create a Next.js App Router TypeScript project with Tailwind, linting, typecheck, Vitest, and a basic app shell.

Do not implement product features yet.

Acceptance criteria:
- `npm run lint` works
- `npm run typecheck` works
- `npm run test` works
- `npm run build` works
- App has placeholder routes:
  - Timeline
  - Behaviors
  - Analytics
  - Export
  - Settings
- Basic responsive layout exists
- No database work yet
- No auth work yet

Suggested files:
- `package.json`
- `next.config.*`
- `tsconfig.json`
- `vitest.config.*`
- `app/layout.tsx`
- `app/page.tsx`
- `app/(app)/timeline/page.tsx`
- `app/(app)/behaviors/page.tsx`
- `app/(app)/analytics/page.tsx`
- `app/(app)/export/page.tsx`
- `app/(app)/settings/page.tsx`
- `components/layout/AppShell.tsx`

---

## Ticket 002: Add Supabase Auth

Add Supabase client/server setup and Google login.

Acceptance criteria:
- User can sign in with Google
- Protected app routes redirect unauthenticated users
- Authenticated user can access Timeline page
- No service-role key is exposed to browser
- `.env.example` is updated if needed
- Auth setup is documented if needed

Suggested files:
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `middleware.ts`
- `app/(auth)/login/page.tsx`
- `app/auth/callback/route.ts`

---

## Ticket 003: Create database schema

Create Supabase migrations for:
- profiles
- categories
- behaviors
- occurrences
- reminder_deliveries
- push_subscriptions

Add RLS policies for all user-owned tables.

Acceptance criteria:
- Migrations apply cleanly
- RLS prevents access to other users' records
- Seed or onboarding mechanism creates default categories
- Schema matches `/docs/DATA_MODEL.md`
- Types are generated or manually defined

Suggested files:
- `supabase/migrations/*`
- `supabase/seed.sql`
- `lib/types/*.ts`

---

## Ticket 004: Recurrence resolver

Implement `recurrence.resolver.ts` and tests.

Supported:
- Daily
- Every N days
- Weekly selected weekdays
- Every N weeks
- Monthly day N with last-day fallback

Acceptance criteria:
- Resolver is pure
- Tests cover all supported recurrence types
- Tests cover America/New_York and midnight boundary
- No database calls in resolver
- No UI code in resolver

Suggested files:
- `lib/resolvers/recurrence.resolver.ts`
- `lib/types/recurrence.ts`
- `tests/recurrence.resolver.test.ts`

---

## Ticket 005: Behavior CRUD

Implement behavior create/edit/archive.

Acceptance criteria:
- Create behavior with:
  - title
  - description
  - category
  - recurrence
  - scheduled time
  - browser reminder
  - email reminder
  - reminder offset
- Edit behavior
- Archive behavior
- Archived behavior no longer generates new occurrences
- History remains intact
- UI is mobile responsive

Suggested files:
- `lib/db/behaviors.repo.ts`
- `lib/services/behavior.service.ts`
- `components/behaviors/BehaviorForm.tsx`
- `components/behaviors/BehaviorList.tsx`
- `components/behaviors/RecurrenceEditor.tsx`
- `components/behaviors/ReminderEditor.tsx`
- `app/(app)/behaviors/page.tsx`

---

## Ticket 006: Occurrence generation

Implement `occurrence.resolver.ts` and `occurrence.service.ts`.

Generate occurrences for today + next 30 days.

Acceptance criteria:
- Occurrences are idempotent
- No duplicates
- Editing behavior refreshes future unresolved occurrences according to documented behavior
- Existing resolved history is not destroyed
- Archived behaviors generate no new occurrences
- Tests cover missing occurrence detection

Rule:
When a behavior changes, future unresolved occurrences may be regenerated. Past occurrences and resolved occurrences are preserved.

Suggested files:
- `lib/resolvers/occurrence.resolver.ts`
- `lib/db/occurrences.repo.ts`
- `lib/services/occurrence.service.ts`
- `tests/occurrence.resolver.test.ts`

---

## Ticket 007: Timeline

Implement `timeline.resolver.ts` and Timeline screen.

Acceptance criteria:
- Needs decision group shows unresolved occurrences before today
- Current day is prominent and starts the forward timeline
- Current-day unresolved occurrences show Completed and Not Completed actions
- Resolved current-day occurrences show a distinct resolved state
- Timeline shows the next 7 days by default
- A control lets the user show more future days
- Day sections with no occurrences show "No behaviors on this day"
- Items are ordered by scheduled time
- Categories and descriptions are hidden until a card is expanded
- Mobile layout works
- Timeline grouping logic is tested

Suggested files:
- `lib/resolvers/timeline.resolver.ts`
- `components/timeline/Timeline.tsx`
- `components/timeline/TimelineGroup.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `app/(app)/timeline/page.tsx`
- `tests/timeline.resolver.test.ts`

---

## Ticket 008: Status marking and notes

Implement `status.resolver.ts` and status buttons.

Acceptance criteria:
- User can mark Completed
- User can mark Not Completed
- User can edit status later
- User can add/edit note
- Status changes update `status_marked_at`
- `completed_at` is set when status is `completed`
- Status transition logic is tested

Suggested files:
- `lib/resolvers/status.resolver.ts`
- `lib/services/occurrence.service.ts`
- `components/timeline/StatusButtons.tsx`
- `tests/status.resolver.test.ts`

---

## Ticket 009: Browser push

Implement push subscription and browser notification delivery.

Acceptance criteria:
- User can enable notification permission
- Push subscription stored
- Settings can trigger the browser notification permission prompt
- Browser reminders are generated for behaviors by default
- App still works if permission denied
- No secrets exposed to browser except public VAPID key

Suggested files:
- `app/api/push/subscribe/route.ts`
- `lib/db/pushSubscriptions.repo.ts`
- `lib/services/reminder.service.ts`

---

## Ticket 010: Email reminders

Implement Sequenzy email reminders.

Acceptance criteria:
- Email reminders only send when enabled on behavior
- Reminder offset respected
- Pending reminders cancelled when occurrence is resolved
- Failed reminders logged
- No duplicate sends
- Reminder processing route is protected by a secret or appropriate server-only mechanism
- Sequenzy provider setup, template inspection, and test sends use the CLI workflow in `docs/SEQUENZY_WORKFLOW.md`
- Runtime sending uses server-only code and never exposes `SEQUENZY_API_KEY` to the browser

Suggested files:
- `lib/resolvers/reminder.resolver.ts`
- `lib/services/reminder.service.ts`
- `lib/db/reminders.repo.ts`
- `lib/services/sequenzy.service.ts`
- `app/api/reminders/process/route.ts`
- `tests/reminder.resolver.test.ts`

---

## Ticket 011: Analytics

Implement `analytics.resolver.ts` and basic Analytics screen.

Acceptance criteria:
- Completion counts by behavior
- Overall adherence at top
- 30-day default view with 7/30/90 day options
- Binary calendar heatmap for overall adherence
- Per-behavior chart or calendar heatmap
- Full and partial completion can be represented for behaviors that happen multiple times in a day
- Not completed occurrences can be inspected for a selected day
- Optional compact counts by category
- Unresolved shown separately
- Default adherence excludes unresolved
- Analytics logic is tested

Suggested files:
- `lib/resolvers/analytics.resolver.ts`
- `components/analytics/CompletionSummary.tsx`
- `components/analytics/CategorySummary.tsx`
- `app/(app)/analytics/page.tsx`
- `tests/analytics.resolver.test.ts`

---

## Ticket 012: Export

Implement JSONL, CSV, full JSON backup, and AI summary.

Acceptance criteria:
- Export includes categories, behaviors, occurrences, notes
- JSONL is one record per line
- CSV opens cleanly in spreadsheet software
- AI summary is readable Markdown-compatible text
- AI summary can be copied and downloaded as `.md`
- Export range can be selected
- Archived behaviors can be included as an option
- Export resolver is tested
- CSV escaping is tested

Suggested files:
- `lib/resolvers/export.resolver.ts`
- `lib/services/export.service.ts`
- `app/api/export/jsonl/route.ts`
- `app/api/export/csv/route.ts`
- `app/api/export/json/route.ts`
- `components/export/ExportPanel.tsx`
- `tests/export.resolver.test.ts`

---

## Ticket 013: Vercel production deployment

Deploy the completed v1 app to the existing Vercel project and harden the production runtime.

Current Vercel context:
- Existing Vercel project: `cadence` under team `Emi's projects`.
- Connected GitHub repository: `emixd12/habit-tracking-app` on `main`.
- At draft time, the latest production deployment in Vercel was ready but pointed at commit `d2c4c4985bb1a5a141713e4e38fa3c65193f3fd9` (`Implement browser push and email reminders`), before the completed Analytics and Export work in Tickets 011 and 012. Treat the completed Ticket 012 repo state as the deployment target.

Acceptance criteria:
- Use the Vercel plugin or Vercel CLI to confirm the existing `cadence` project is still connected to `emixd12/habit-tracking-app`; do not create a duplicate Vercel project.
- Confirm project settings for the Next.js app, including framework detection, repository root, Node runtime, build command, and production branch.
- Configure Vercel production and preview environment variables for the current app:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or the supported legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SITE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SEQUENZY_API_KEY`
  - `SEQUENZY_REMINDER_TEMPLATE_SLUG`
  - `SEQUENZY_API_URL` only if the default needs an override
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `REMINDER_PROCESS_SECRET`
- Keep server-only secrets server-only; never expose service-role, Sequenzy, VAPID private, or reminder process secrets to browser code.
- Configure Supabase Auth for the production app URL, including the production `/auth/callback` redirect URL. Add preview callback URLs only if preview OAuth QA is intentionally supported.
- Add Vercel Cron configuration for due email reminder processing, or document a different scheduled trigger if Vercel Cron is not used.
- Verify `/api/reminders/process` is compatible with the scheduled trigger. If Vercel Cron is used, add the route method and tests needed for Vercel's scheduled request behavior while preserving the existing protected manual invocation path.
- Deploy the completed v1 code through Ticket 012 to production and confirm the latest Vercel deployment points at the expected Git commit.
- Smoke test the production app:
  - `/login`
  - `/timeline`
  - `/behaviors`
  - `/settings`
  - `/analytics`
  - `/export`
  - desktop viewport
  - narrow mobile viewport around 390px
- Run an authenticated production smoke test for Google login, behavior/timeline status marking, settings notification state, analytics render, and export download links.
- Verify reminder processing in production with a safe manual or scheduled run. Do not send real emails unless the user explicitly approves the recipient.
- Verify browser push subscription behavior with production `NEXT_PUBLIC_VAPID_PUBLIC_KEY` where browser permission allows it. Do not add PWA offline caching, route caching, background sync, or offline writes.
- Inspect Vercel deployment status/logs and record any runtime warnings or failures.
- Document the deployment workflow, canonical production URL, environment-variable ownership, and rollback path.
- Update `STATUS.md` with the production deployment URL, verification results, known risks, and any follow-up items.

Suggested files:
- `vercel.json`
- `docs/VERCEL_WORKFLOW.md`
- `docs/OPERATIONS.md`
- `.env.example`
- `.gitignore`
- `app/api/reminders/process/route.ts`
- `tests/reminder-process-route.test.ts`
- `STATUS.md`

---

## Ticket 014: BehaviorLog import validation dry-run

Add a BehaviorLog import/validation pathway that can read a `.behaviorlog.zip`
bundle, validate it, and produce a safe import preview. This ticket must not
write imported data to the database.

Context:
- BehaviorLog export and internal `occurrence_status_events` history are already implemented.
- Hosted Supabase has migration `20260612075036_add_occurrence_status_events.sql`.
- Import work should preserve the distinction between occurrence current-status
  snapshots and append-only status-event history.

Acceptance criteria:
- Add a pure BehaviorLog import resolver that accepts parsed bundle files and returns a validation/import preview plan.
- Parse `.behaviorlog.zip` contents through a service or utility layer before passing structured records to the resolver.
- Validate required files:
  - `manifest.json`
  - `schema.json`
  - `README.md`
  - `AGENTS.md`
  - `data/behaviors.jsonl`
  - `data/schedules.jsonl`
  - `data/occurrences.jsonl`
  - `data/status_events.jsonl`
- Validate manifest SHA-256 hashes for every listed file.
- Validate supported schema version and required record types.
- Validate JSONL parsing errors with actionable row/file errors.
- Map BehaviorLog behavior, schedule, occurrence, status-event, and optional note records into an internal import plan.
- Detect likely conflicts against existing local behaviors, occurrences, and status events without mutating them.
- Preserve status semantics including `explicit_user_mark`, `explicit_user_correction`, imported source confidence, and `revises_event_id`.
- Treat `current_status` in `occurrences.jsonl` as a snapshot; status history comes from `status_events.jsonl`.
- Use `local_date` and IANA `timezone` for day grouping and conflict preview.
- Return a dry-run summary including counts, warnings, conflicts, unsupported fields, and records that would be created or skipped.
- Do not add destructive merge, restore, overwrite, delete, or deduplication writes in this ticket.
- Do not create a new primary navigation route unless product docs are explicitly updated first; a service-level dry-run or internal test harness is enough for this milestone.
- Resolver logic is tested with a small fixture bundle produced by the existing export resolver.

Suggested files:
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import.service.ts`
- `lib/services/zip.ts`
- `lib/types/behaviorlog-import.ts`
- `tests/behaviorlog-import.resolver.test.ts`
- `tests/fixtures/behaviorlog/*.jsonl`
- `docs/EXPORT_FORMATS.md`
- `docs/DATA_MODEL.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 015: BehaviorLog core conformance harness

Add a BehaviorLog core conformance harness that proves Cadence can produce and
read Level 1 core-compatible BehaviorLog bundles against the upstream
`emixd12/BehaviorLog-Bundle` draft specification. This ticket should tighten
validation and test infrastructure only. It must not add import writes,
merge/restore behavior, user-facing import UI, or optional profile expansion.

Context:
- BehaviorLog export exists and emits `.behaviorlog.zip` bundles.
- Ticket 014 added import validation dry-run logic.
- The upstream BehaviorLog Bundle draft defines required core files, hashable
  manifests, JSONL authority, app-neutral status vocabulary, append-only status
  events, local-date/timezone semantics, and conformance levels.
- The next alignment risk is drift between Cadence's generated bundles and the
  upstream reference validator/conformance expectations.

Acceptance criteria:
- Add a conformance test or harness that generates a Cadence BehaviorLog bundle
  from the existing export resolver and materializes it as a temporary
  `.behaviorlog/` directory.
- Run a local or vendored snapshot of the upstream BehaviorLog reference
  validator against the generated bundle during tests.
- Record the upstream source and exact commit or snapshot date used by the
  harness, so future agents can intentionally update it.
- Assert Cadence output passes core Level 1 checks for:
  - required files
  - manifest format and schema version
  - required file hashes
  - JSON and JSONL parseability
  - duplicate ID detection
  - behavior/schedule/occurrence/status-event references
  - `occurrence_state`
  - core status vocabulary
  - `current_status` as snapshot only
  - append-only status event history
  - `local_date` plus IANA `timezone`
  - app-specific fields only under `extensions`
- Tighten Cadence import validation to match upstream conformance where needed.
  In particular, unknown top-level fields in core records should be validation
  errors, not silently importable records.
- Preserve Ticket 014's dry-run boundary: the harness may validate and preview,
  but it must not insert, update, delete, merge, restore, overwrite, or
  deduplicate database rows.
- Do not add optional BehaviorLog Intervention, Context, Review, Analytics, CSV,
  PROV, RO-Crate, iCalendar, FHIR, or xAPI profile support in this ticket.
- Update `docs/EXPORT_FORMATS.md` and `docs/AGENT_RESOLVERS.md` if the
  conformance contract or import validation behavior changes.
- Update `STATUS.md` with verification results when the ticket is implemented.

Suggested files:
- `tests/behaviorlog-conformance.test.ts`
- `tests/fixtures/behaviorlog-reference/*`
- `scripts/behaviorlog-conformance.mjs`
- `lib/resolvers/export.resolver.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `tests/behaviorlog-import.resolver.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 016: BehaviorLog Level 2 CSV views

Add optional CSV migration views to Cadence's BehaviorLog bundle so the app can
advance from core Level 1 alignment toward the upstream
`emixd12/BehaviorLog-Bundle` Level 2 conformance target. JSONL remains the
authoritative data source; CSV files are compatibility views only.

Context:
- Ticket 015 added a pinned upstream reference validator snapshot and proves
  Cadence can produce and dry-run read a Level 1 core-compatible bundle.
- Cadence already has app-native occurrence CSV export, but the
  `.behaviorlog.zip` bundle does not yet include BehaviorLog CSV migration
  views.
- Upstream BehaviorLog conformance defines Level 2 as core plus CSV views.

Acceptance criteria:
- Generate optional CSV files inside the BehaviorLog bundle:
  - `csv/behaviors.csv`
  - `csv/schedules.csv`
  - `csv/occurrences.csv`
  - `csv/status_events.csv`
- Generate CSV rows from the same normalized BehaviorLog records used for the
  corresponding JSONL files.
- Preserve stable IDs in CSV columns so CSV rows can join back to JSONL records.
- Keep JSONL authoritative. Import validation may ignore CSV files or validate
  them as optional views, but it must not rely on CSV over JSONL.
- Add all emitted CSV files to `manifest.json` with:
  - `media_type: "text/csv"`
  - `required: false`
  - SHA-256 hashes
  - a clear schema reference or null when no core JSON Schema definition exists
- Ensure app-specific fields remain under `extensions` in JSONL; if extension
  data appears in CSV, encode it as a single JSON string column rather than
  expanding arbitrary producer fields into top-level CSV concepts.
- Preserve the Ticket 015 conformance harness. The upstream Level 1 validator
  should still pass when optional CSV files are present.
- Add tests that compare each CSV view against its authoritative JSONL source
  for record count and stable IDs.
- Add CSV escaping tests for commas, quotes, and newlines in BehaviorLog CSV
  views.
- Do not add import writes, merge/restore behavior, user-facing import UI,
  optional Intervention/Context/Review/Analytics profiles, PROV, RO-Crate,
  iCalendar, FHIR, or xAPI support in this ticket.
- Update `docs/EXPORT_FORMATS.md` and `docs/AGENT_RESOLVERS.md` if the
  BehaviorLog bundle contract changes.
- Update `STATUS.md` with verification results when the ticket is implemented.

Suggested files:
- `lib/resolvers/export.resolver.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 017: BehaviorLog Intervention Profile export

Add export-only BehaviorLog Intervention Profile support for Cadence reminder
deliveries. This should map existing browser and email reminder-delivery records
into optional `data/interventions.jsonl` records inside the `.behaviorlog.zip`
bundle. This ticket must not add import writes, reminder behavior changes,
message-body export, user-facing import UI, or notification-provider side
effects.

Context:
- Ticket 015 proves Cadence can produce and dry-run read Level 1 core-compatible
  BehaviorLog bundles.
- Ticket 016 is planned to add optional Level 2 CSV migration views.
- Upstream BehaviorLog maps browser/email reminder delivery into the
  Intervention Profile and defines that profile as `data/interventions.jsonl`.
- Cadence already stores reminder delivery facts in `reminder_deliveries`,
  linked to occurrences.

Acceptance criteria:
- Export optional `data/interventions.jsonl` when the BehaviorLog bundle input
  includes reminder deliveries.
- Add emitted intervention files to `manifest.json` with:
  - `media_type: "application/jsonl"`
  - `required: false`
  - SHA-256 hashes
  - a schema reference for Intervention records when the local schema includes
    one, otherwise a documented null reference
- Map reminder deliveries without changing reminder processing behavior:
  - `occurrence_id` links to the exported occurrence
  - `behavior_id` links through the occurrence's behavior
  - channel distinguishes browser push from email
  - scheduled send time, sent time, delivery status, and failure reason are
    preserved when present
  - provider-specific or Cadence-specific values live under `extensions`
- Do not export email bodies, push payload bodies, API keys, provider secrets,
  raw endpoints, browser subscription keys, or other sensitive delivery
  transport details.
- Keep intervention records optional and profile-scoped; core JSONL remains
  valid without them.
- Preserve the Level 1 conformance harness. The pinned core validator should
  still pass when optional intervention records are present.
- Add tests that verify:
  - reminder deliveries are exported as interventions
  - intervention records reference existing behaviors and occurrences
  - pending, sent, failed, and cancelled delivery statuses are represented
  - sensitive transport details are not exported
  - `manifest.json` lists and hashes `data/interventions.jsonl`
- Add or update the BehaviorLog schema copy used in exported bundles so
  Intervention records are self-described.
- Do not add import handling for interventions beyond ignoring or warning about
  the optional profile if current import validation encounters it.
- Do not add Context, Review, Analytics, PROV, RO-Crate, iCalendar, FHIR, xAPI,
  or research-profile support in this ticket.
- Update `docs/EXPORT_FORMATS.md` and `docs/AGENT_RESOLVERS.md` if the
  BehaviorLog bundle contract changes.
- Update `STATUS.md` with verification results when the ticket is implemented.

Suggested files:
- `lib/types/export.ts`
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 018: BehaviorLog import persistence foundation

Add the database and service foundation needed for auditable, idempotent
BehaviorLog imports. This ticket should not import user data yet; it only
creates the local persistence primitives that later create/merge/write tickets
will use.

Context:
- Ticket 014 added BehaviorLog import validation dry-run.
- Ticket 015 added a pinned upstream core conformance harness.
- Ticket 016 added optional Level 2 CSV views.
- Ticket 017 added export-only Intervention Profile support.
- Upstream BehaviorLog reader guidance requires manifest-first validation,
  privacy awareness, JSONL authority over CSV, unresolved preservation, and
  clear explanation before destructive normalization.

Acceptance criteria:
- Add Supabase migrations for import tracking tables, likely:
  - `behaviorlog_import_runs`
  - `behaviorlog_import_record_mappings`
- `behaviorlog_import_runs` records user-owned import metadata:
  - bundle format and schema version
  - manifest SHA-256 or bundle fingerprint
  - producer name/version when present
  - subject id strategy/privacy redaction level when present
  - import mode
  - dry-run summary snapshot
  - status such as `previewed`, `applied`, `failed`, or `cancelled`
  - started/completed timestamps
- `behaviorlog_import_record_mappings` maps external BehaviorLog ids to local
  Cadence ids by record type and import run.
- Mapping rows support behavior, schedule, occurrence, status event, note, and
  intervention record types even if later tickets only write a subset.
- Add RLS policies for all new user-owned tables.
- Add repository/service helpers for creating import runs and mappings.
- Make mapping inserts idempotent for repeated import attempts from the same
  bundle/import run.
- Update `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, and generated database
  types.
- Do not write imported behaviors, schedules, occurrences, status events, notes,
  or interventions in this ticket.
- Do not add destructive restore, overwrite, delete, or deduplication writes.
- Tests cover migration type shape or repository behavior where practical.

Suggested files:
- `supabase/migrations/*_add_behaviorlog_import_tracking.sql`
- `lib/db/behaviorLogImports.repo.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/types/behaviorlog-import.ts`
- `lib/db/database.types.ts`
- `tests/behaviorlog-import-write.service.test.ts`
- `docs/DATA_MODEL.md`
- `docs/EXPORT_FORMATS.md`
- `STATUS.md`

---

## Ticket 019: BehaviorLog create-only core import

Implement a create-only BehaviorLog core import write path. This ticket may
insert records that are clearly new, but it must not merge into existing local
records, overwrite local data, delete data, or rely on CSV over JSONL.

Context:
- Ticket 018 provides import run and record mapping persistence.
- BehaviorLog JSONL files remain authoritative over optional CSV views.
- `status_events.jsonl` is authoritative for status history;
  `occurrences.jsonl.current_status` is a convenience snapshot only.

Acceptance criteria:
- Add a service-level import apply path for mode `create_missing_only`.
- Require a valid dry-run preview before applying writes.
- Create missing behaviors from `data/behaviors.jsonl`.
- Create compatible schedule slots from `data/schedules.jsonl`.
- Create missing occurrences from `data/occurrences.jsonl`.
- Append imported status events from `data/status_events.jsonl` into
  `occurrence_status_events`.
- Update `occurrences.status`, `completed_at`, and `status_marked_at` only after
  appending imported status events and only according to the latest imported
  event for that occurrence.
- Preserve `unresolved` as `unresolved`; never convert silence into
  `not_completed`.
- If an occurrence snapshot is resolved but no supporting status event exists,
  skip status writes or create an import warning unless source confidence and
  status semantics safely support an imported explicit event.
- Store all external-to-local id mappings in
  `behaviorlog_import_record_mappings`.
- Preserve source/provenance fields that Cadence can represent directly, and
  record unmapped fields in preview warnings rather than silently dropping them.
- Unsupported recurrence profiles are skipped with actionable warnings.
- Imported schedules should stay within Cadence's supported recurrence and
  schedule-slot model.
- The write path is idempotent for repeated application of the same accepted
  create-only plan.
- Do not create merge behavior, overwrite behavior, restore behavior, user-facing
  import UI, intervention writes, Context/Profile writes, Analytics Profile
  writes, or CSV-only import.
- Resolver/service tests cover behavior, schedule, occurrence, status-event,
  mapping, idempotence, unresolved preservation, and unsupported recurrence
  handling.

Suggested files:
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/db/behaviorLogImports.repo.ts`
- `lib/db/behaviors.repo.ts`
- `lib/db/occurrences.repo.ts`
- `lib/db/occurrenceStatusEvents.repo.ts`
- `tests/behaviorlog-import-write.service.test.ts`
- `tests/behaviorlog-import.resolver.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/DATA_MODEL.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 020: BehaviorLog conflict-aware merge preview

Extend the dry-run import planner into a merge planner that can identify likely
matches and conflicts before any merge writes are allowed. This ticket should
produce a user-reviewable plan only; it must not mutate product data.

Context:
- Ticket 014 dry-run can validate bundles and detect basic likely conflicts.
- Ticket 019 creates only clearly new records.
- Upstream BehaviorLog reader guidance says receiving apps should explain
  destructive normalization before import.

Acceptance criteria:
- Add a merge-preview mode that compares imported records against local records.
- Compare behaviors by external mapping id, title/category identity, source
  original id, archive state, and compatible schedule shape.
- Compare schedules by behavior mapping, recurrence profile, recurrence payload,
  timezone, active dates, and schedule slot/window.
- Compare occurrences by mapped behavior/schedule plus `scheduled_for_utc`,
  `local_date`, and timezone.
- Compare status events by external event id, occurrence mapping, recorded time,
  status, semantics, and revision target.
- Produce deterministic actions such as:
  - `create_new`
  - `map_to_existing`
  - `skip_existing`
  - `conflict_requires_decision`
- Produce deterministic conflict codes and human-readable reasons.
- Preserve BehaviorLog semantics:
  - JSONL authority over CSV
  - `status_events.jsonl` authority over `current_status`
  - `unresolved` is not failure
  - append-only status-event history
- Include privacy profile and redaction-level summary in the preview output.
- Preview optional notes and interventions but do not write them.
- Save the accepted or generated merge preview to `behaviorlog_import_runs` only
  if this can be done without mutating product records.
- Do not insert, update, delete, merge, restore, overwrite, or deduplicate
  product records in this ticket.
- Tests cover each preview action, conflict reason stability, and status-event
  authority over occurrence snapshots.

Suggested files:
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import.service.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/types/behaviorlog-import.ts`
- `tests/behaviorlog-import.resolver.test.ts`
- `tests/behaviorlog-import-merge-preview.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 021: BehaviorLog user-approved merge write

Apply a previously generated, user-approved BehaviorLog merge plan. This ticket
may create or map records according to explicit plan decisions, but it must not
perform blind overwrite, destructive restore, deletion, or automatic conflict
resolution.

Context:
- Ticket 020 produces conflict-aware merge previews.
- Upstream BehaviorLog expects receiving apps to preserve source semantics and
  explain destructive normalization before import.
- Cadence stores status history append-only in `occurrence_status_events`.

Acceptance criteria:
- Add apply support for mode `merge_by_user_approved_plan`.
- Require an import run and accepted merge plan generated by Ticket 020.
- Refuse to apply plans with unresolved `conflict_requires_decision` actions.
- For `create_new`, insert records using the same safeguards as Ticket 019.
- For `map_to_existing`, create mapping rows without overwriting local behavior,
  schedule, or occurrence fields unless the plan explicitly allows a safe field
  fill such as setting an empty local note from an imported occurrence note.
- Append imported status events that are not already mapped or duplicated.
- Update occurrence current-status snapshots only after appending status events
  and only when the imported event is the latest effective/recorded event by the
  documented ordering rule.
- Do not downgrade or replace an existing local explicit high-confidence status
  event with an ambiguous or lower-confidence imported event.
- Preserve `revises_event_id` when both source and target events are mapped.
- Record every applied action and mapping in import tracking tables.
- Make applying the same accepted plan idempotent.
- Fail safely: a partial failure should leave an import run marked failed and
  should not silently continue with inconsistent mappings.
- Do not add blind overwrite, destructive restore, delete, intervention writes,
  Context/Profile writes, Analytics Profile writes, CSV-only import, or provider
  side effects.
- Tests cover accepted-plan enforcement, conflict refusal, append-only status
  history, snapshot update rules, idempotence, and lower-confidence event
  protection.

Suggested files:
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/db/behaviorLogImports.repo.ts`
- `lib/db/occurrenceStatusEvents.repo.ts`
- `lib/services/occurrence.service.ts`
- `tests/behaviorlog-import-merge-write.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/DATA_MODEL.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

---

## Ticket 022: BehaviorLog optional notes import

Add limited note import support after core create/merge behavior is safe. This
ticket should import only note shapes Cadence can represent without expanding
the product into a general notes system.

Context:
- BehaviorLog notes can attach to behavior, occurrence, status event, or review.
- Cadence currently supports notes on occurrences.
- Upstream privacy guidance treats notes as sensitive attributed context.

Acceptance criteria:
- Parse and preview `data/notes.jsonl` with privacy/sensitivity labels.
- Import occurrence-attached notes only when the target occurrence is created,
  mapped, or otherwise safely identified.
- If the local occurrence note is empty, allow the imported note body to fill it.
- If the local occurrence note is non-empty and differs, require an explicit
  merge-plan decision before changing it.
- Do not import behavior notes, status-event notes, review notes, or AI-generated
  notes into product data unless the data model and product docs are explicitly
  expanded.
- Preserve imported note source metadata in import mapping or import-run details
  where possible.
- Never treat notes as objective fact in analytics, status, or adherence logic.
- Do not add a generalized notes table unless this ticket updates
  `docs/DATA_MODEL.md` and the product docs accordingly.
- Do not import restricted/high-sensitivity notes without surfacing the privacy
  warning in the preview.
- Tests cover empty-note import, existing-note conflict, unsupported note target
  skip, sensitivity warnings, and no analytics/status side effects.

Suggested files:
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/db/occurrences.repo.ts`
- `tests/behaviorlog-import-notes.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/DATA_MODEL.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

---

## Ticket 023: BehaviorLog Intervention Profile import preview

Add import-preview support for optional BehaviorLog Intervention Profile
records. This ticket should validate and preview `data/interventions.jsonl`, but
it must not create active reminders, send notifications, call providers, or
write to `reminder_deliveries`.

Context:
- Ticket 017 exports Cadence reminder deliveries as optional BehaviorLog
  Intervention Profile records.
- Upstream BehaviorLog defines interventions as reminders, prompts,
  notifications, suppressions, snoozes, dismissals, delivery failures, and
  related burden signals.
- Cadence `reminder_deliveries` are operational delivery records, not passive
  imported history.

Acceptance criteria:
- Parse optional `data/interventions.jsonl` when present in a BehaviorLog bundle.
- Validate intervention JSONL parsing, supported record type, manifest hash,
  delivery status, channel, and references to behavior/occurrence records.
- Preview intervention counts by channel, delivery status, and linked behavior.
- Mark interventions as `preview_only` unless a later ticket adds passive
  imported intervention-history storage.
- Warn if intervention records contain message bodies, raw endpoints, provider
  secrets, subscription keys, recipient identifiers, or other sensitive
  transport data.
- Do not write interventions into `reminder_deliveries`.
- Do not schedule, cancel, or send reminders.
- Do not call Sequenzy, Web Push, browser APIs, provider SDKs, or notification
  processing routes.
- Do not add `csv/interventions.csv` unless a later ticket changes scope.
- Tests cover valid intervention preview, missing references, unsupported
  channel/status, sensitive-field warnings, and no import-write actions.

Suggested files:
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/types/behaviorlog-import.ts`
- `tests/behaviorlog-import-interventions.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/NOTIFICATION_SPEC.md`
- `docs/AGENT_RESOLVERS.md`
- `STATUS.md`

---

## Ticket 024: User-facing BehaviorLog import UI

Add a first-class import entry point so the user can upload a `.behaviorlog.zip`,
review validation output, inspect merge actions, and intentionally apply a safe
import plan.

Context:
- Tickets 018-023 added import persistence, preview, create-only apply,
  user-approved merge apply, limited note import, and intervention preview.
- The remaining gap is an end-user workflow that exposes those service paths
  without requiring direct service calls.

Acceptance criteria:
- Add an authenticated import screen or export/import screen section.
- Accept `.behaviorlog.zip` uploads and reject unsupported files with clear
  validation errors.
- Show dry-run summary counts, warnings, errors, conflicts, privacy notes,
  note sensitivity warnings, and intervention preview counts.
- Let the user choose create-only import only when the dry-run plan is valid and
  contains no unsafe merge decisions.
- Let the user review merge actions and approve only supported safe actions.
- Require explicit confirmation before any write operation.
- Persist import runs and show their status, mode, timestamps, and failure
  message when present.
- Do not add destructive overwrite, full restore, generalized notes, or
  intervention-to-reminder writes in this ticket.
- UI is sparse, mobile-responsive, and avoids product-sprawl language.
- Tests cover upload validation, invalid bundle display, dry-run summary
  rendering, apply gating, and no accidental writes from preview.

Suggested files:
- `app/(app)/export/page.tsx`
- `app/(app)/export/actions.ts`
- `components/export/*`
- `lib/services/behaviorlog-import.service.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `tests/behaviorlog-import-ui.test.ts`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/ROUTE_MAP.md`
- `STATUS.md`

---

## Ticket 025A: BehaviorLog restore preview

Add a restore-preview-only mode for users who want to understand what a trusted
BehaviorLog backup would do before any destructive restore is allowed. This
ticket must not mutate product records.

Context:
- Current import modes are create-only and user-approved merge.
- Existing merge preview is non-destructive and intentionally avoids
  overwrite/delete decisions.
- Full restore is materially more dangerous than merge because it can archive,
  replace, or delete local records.
- BehaviorLog is a behavior-data portability bundle, not a complete account
  image. Restore preview must be clear about what is and is not restorable.
- Current import apply services are multi-call Supabase workflows. Destructive
  apply is deferred to Ticket 025B and needs a stronger partial-failure plan.

Acceptance criteria:
- Add a separate restore preview resolver; do not reuse merge preview for
  destructive decisions.
- Add a restore-preview import mode to the import-run ledger, such as
  `restore_preview`, using a Supabase migration and generated database types if
  the preview is persisted.
- The resolver accepts parsed BehaviorLog bundle files plus the full current
  user-owned local graph needed for comparison.
- The preview shows exactly which local records would be created, replaced,
  archived, deleted, kept, or skipped for:
  - behaviors
  - behavior schedule slots
  - occurrences
  - occurrence status events
  - inline occurrence notes
  - passive imported note records
  - passive imported intervention-history records
- The preview distinguishes destructive actions from non-destructive actions in
  machine-readable output suitable for UI review.
- The preview states that profile data, auth identity, browser push
  subscriptions, browser permissions, provider accounts, and external provider
  state are not restored from BehaviorLog.
- Preserve BehaviorLog semantics:
  - `status_events.jsonl` is authoritative for status history.
  - `occurrences.jsonl.current_status` is a snapshot only.
  - `unresolved` is never converted into `not_completed`.
  - CSV files are optional views and do not drive restore decisions.
- Include explicit status-history policy planning:
  - default `preserve_append_only_history`
  - optional future `replace_status_history` only as a previewed decision, not
    an apply behavior in this ticket.
- Include privacy and sensitivity warnings for high/restricted imported notes
  and redacted intervention fields.
- Detect stale or unsupported restore inputs, including unsupported schema
  version, unsupported recurrence/schedule shapes, missing references, unknown
  core top-level fields, and current local records that cannot be safely mapped.
- Return a stable preview fingerprint that Ticket 025B can require before
  destructive apply.
- Do not create, update, archive, delete, restore, overwrite, deduplicate, send
  reminders, create reminder deliveries, call Sequenzy, call Web Push, or call
  notification-processing routes in this ticket.
- Update docs so the restore preview contract is distinct from create-only and
  merge import.
- Tests cover preview action classification, destructive count reporting,
  non-restorable account/provider fields, unresolved preservation,
  status-history policy planning, sensitivity warnings, unsupported records, and
  preview fingerprint stability.

Suggested files:
- `lib/resolvers/behaviorlog-restore.resolver.ts`
- `lib/services/behaviorlog-restore.service.ts`
- `lib/types/behaviorlog-restore.ts`
- `lib/db/behaviorLogImports.repo.ts`
- `lib/db/database.types.ts`
- `supabase/migrations/*_add_behaviorlog_restore_preview_mode.sql`
- `tests/behaviorlog-restore.resolver.test.ts`
- `tests/behaviorlog-restore.service.test.ts`
- `docs/DATA_MODEL.md`
- `docs/EXPORT_FORMATS.md`
- `docs/AGENT_RESOLVERS.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused restore resolver/service tests first.
- Run `npm run supabase -- db reset` and regenerate database types if a
  migration is added.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.

---

## Ticket 025B: BehaviorLog restore apply and UI

Add the destructive restore apply path and user-facing review flow after Ticket
025A restore preview is implemented and verified. This ticket may archive,
replace, or delete local user-owned product records, but it must never perform
silent or hidden destructive writes.

Context:
- Ticket 025A must provide a stable restore preview, destructive action list,
  and preview fingerprint.
- Restore apply is higher risk than create-only or merge apply because partial
  failure can leave a user's tracker in a mixed state.
- Current create-only and merge apply paths are multi-call Supabase workflows.
  Do not blindly copy that approach for destructive restore without addressing
  atomicity or resumability.

Acceptance criteria:
- Add a restore apply mode to the import-run ledger, such as `restore_apply`,
  using a Supabase migration and generated database types if it was not added in
  Ticket 025A.
- Require:
  - a valid Ticket 025A restore preview,
  - an accepted preview snapshot stored on the import run,
  - a matching preview fingerprint at apply time,
  - explicit typed confirmation,
  - explicit acknowledgement that the user downloaded or created a fresh backup,
  - explicit acknowledgement for high/restricted imported notes when present.
- Refuse apply when the local data fingerprint no longer matches the accepted
  preview or when unsupported/conflict actions remain unresolved.
- Preserve Supabase RLS and user ownership for every restored row.
- Prefer a transaction-safe or resumable restore strategy. If implementation
  uses multiple Supabase client calls, the service must make partial failure
  visible, mark the import run failed, and be safe to retry without duplicate or
  contradictory rows.
- Preserve append-only status history by default. Only replace status history
  when the accepted preview explicitly selected full status-history replacement.
- Apply restore decisions in dependency order so referential integrity is
  preserved across behaviors, schedule slots, occurrences, status events,
  reminder deliveries, imported notes, and imported interventions.
- Cancel or remove operational reminder deliveries only according to the
  accepted restore plan. Do not call Sequenzy, Web Push, browser APIs, provider
  SDKs, or notification-processing routes during restore.
- Recreate only data represented by the accepted BehaviorLog restore contract.
  Do not claim to restore auth identity, profile email, browser permissions,
  push subscriptions, provider accounts, provider secrets, or external provider
  state.
- Make applying the same accepted restore run idempotent.
- Failed restore attempts must mark the import run `failed` and surface partial
  work clearly in the UI.
- Add a sparse authenticated UI, likely on the Export screen, that:
  - uploads or reuses a `.behaviorlog.zip`,
  - shows the Ticket 025A restore preview,
  - highlights destructive actions,
  - forces backup acknowledgement,
  - forces typed confirmation,
  - shows apply result or failure details,
  - remains mobile-responsive.
- Do not add admin dashboards, collaboration, social features, billing,
  offline/PWA writes, provider sends, or support tooling.
- Tests cover typed confirmation, backup acknowledgement, stale-preview refusal,
  destructive-action refusal without confirmation, replacement/archive/delete
  semantics, status-history preservation and explicit replacement, reminder
  side-effect prevention, idempotence, partial-failure reporting, RLS ownership,
  and UI gating.

Suggested files:
- `lib/services/behaviorlog-restore.service.ts`
- `lib/db/behaviorLogImports.repo.ts`
- `lib/db/behaviors.repo.ts`
- `lib/db/occurrences.repo.ts`
- `lib/db/occurrenceStatusEvents.repo.ts`
- `lib/db/notes.repo.ts`
- `lib/db/importedInterventions.repo.ts`
- `lib/db/reminderDeliveries.repo.ts`
- `components/export/*`
- `app/(app)/export/actions.ts`
- `tests/behaviorlog-restore.service.test.ts`
- `tests/behaviorlog-restore-ui.test.tsx`
- `docs/DATA_MODEL.md`
- `docs/EXPORT_FORMATS.md`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/ROUTE_MAP.md`
- `STATUS.md`

Verification:
- Run focused restore service/UI tests first.
- Run `npm run supabase -- db reset` and regenerate database types if a
  migration is added.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- For UI work, run `npm run design-system:check` when reusable UI or design
  inventory changes, then browser-check `/export` at desktop and around 390px.
  Do not apply a destructive restore against the user's real account during QA.

---

## Ticket 026: General BehaviorLog notes data model and import

Expand Cadence from occurrence-only notes to a small general imported-note model
that can represent BehaviorLog notes attached to behaviors, occurrences, status
events, and reviews.

Context:
- Ticket 022 intentionally imports only occurrence-attached notes into
  `occurrences.note`.
- BehaviorLog supports richer note attachments.
- Notes remain sensitive attributed context and must not become objective
  analytics facts.

Acceptance criteria:
- Update product docs before schema work to define which note attachment types
  Cadence will display and how.
- Add a user-owned notes table or equivalent schema that can store imported
  behavior, occurrence, status-event, and review notes.
- Preserve note role, sensitivity, source metadata, source original id, created
  and updated timestamps, and attachment target.
- Do not feed imported notes into adherence, status, reminder, or analytics
  calculations unless a later ticket explicitly changes that.
- Update import preview to distinguish inline occurrence-note fills from general
  imported note records.
- Add UI surfaces only where they are useful and sparse.
- Require privacy warnings before importing high or restricted sensitivity
  notes.
- Tests cover each supported attachment type, unsupported/AI-generated handling,
  sensitivity warnings, RLS ownership, and no analytics/status side effects.

Suggested files:
- `supabase/migrations/*_add_imported_notes.sql`
- `lib/db/notes.repo.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `components/timeline/*`
- `components/behaviors/*`
- `tests/behaviorlog-import-general-notes.test.ts`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT_SPEC.md`
- `docs/UI_SPEC.md`
- `STATUS.md`

---

## Ticket 027: Imported intervention history storage

Add passive storage for imported BehaviorLog Intervention Profile records so
Cadence can retain historical reminder/prompt delivery context without turning
those imported rows into active reminders.

Context:
- Ticket 023 previews interventions but does not store them.
- Cadence `reminder_deliveries` are operational delivery records.
- Imported intervention history should be passive provenance unless a later
  ticket explicitly promotes selected records into operational reminders.

Acceptance criteria:
- Add a user-owned imported intervention history table or equivalent passive
  storage model.
- Store BehaviorLog intervention id, behavior/occurrence mappings, intervention
  type, channel, delivery status, scheduled/sent timestamps, failure reason,
  source metadata, and redacted sensitivity indicators.
- Do not store raw provider secrets, raw push endpoints, subscription keys,
  recipient identifiers, or message bodies unless product/privacy docs are
  explicitly expanded.
- Import preview must show what will be stored and what sensitive fields will be
  dropped or redacted.
- Applying the same accepted import run must be idempotent.
- Stored intervention history must not schedule, send, cancel, retry, or claim
  reminders.
- Tests cover storage, redaction/drop behavior, idempotence, RLS ownership, and
  no writes to `reminder_deliveries`.

Suggested files:
- `supabase/migrations/*_add_imported_intervention_history.sql`
- `lib/db/importedInterventions.repo.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `tests/behaviorlog-import-intervention-history.test.ts`
- `docs/DATA_MODEL.md`
- `docs/NOTIFICATION_SPEC.md`
- `docs/EXPORT_FORMATS.md`
- `STATUS.md`

---

## Ticket 028: Promote imported interventions into reminder deliveries

Add an explicit opt-in flow to convert selected imported intervention records
into operational `reminder_deliveries` rows.

Context:
- This is intentionally separate from import preview and passive intervention
  history.
- Writing to `reminder_deliveries` can create active operational work, so it
  must be narrowly scoped and user-approved.

Acceptance criteria:
- Only eligible future pending reminder interventions can be promoted.
- Sent, failed, cancelled, dismissed, historical, or ambiguous intervention
  records remain passive history and must not become operational deliveries.
- Require explicit user selection and confirmation for every promoted group.
- Create `reminder_deliveries` idempotently and avoid duplicate sends.
- Do not call Sequenzy, Web Push, browser APIs, provider SDKs, or notification
  processing routes during promotion.
- Normal reminder processing may later send promoted pending deliveries only if
  they remain due, valid, unresolved, and consistent with current behavior
  reminder settings.
- Preserve provenance linking the reminder delivery back to the imported
  intervention record/import run.
- Tests cover eligibility filtering, explicit confirmation, duplicate
  prevention, provenance, no provider calls, and no promotion for historical or
  resolved occurrences.

Suggested files:
- `lib/resolvers/imported-intervention-promotion.resolver.ts`
- `lib/services/imported-intervention-promotion.service.ts`
- `lib/db/reminderDeliveries.repo.ts`
- `lib/db/importedInterventions.repo.ts`
- `tests/imported-intervention-promotion.test.ts`
- `docs/NOTIFICATION_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

---

## Ticket 029: Public web hardening account safety baseline

Harden the current authenticated web app with the first public-launch account
safety baseline.

Acceptance criteria:
- Keep Google-only login for launch.
- Add a durable RLS policy registry test for user-owned tables.
- Add practical abuse controls to sensitive current endpoints.
- Bound reminder-process batch limits.
- Validate malformed occurrence mutation ids before repository lookup.
- Add Settings-based account deletion with export acknowledgement and typed
  confirmation.
- Keep account deletion server-only with Supabase service-role access and
  database cascades.
- Add public Terms, Privacy, and Trust routes linked from Login and Settings.
- Preserve export/account portability before deletion.
- Preserve the small tracker scope and avoid collaboration/social features.

Suggested docs:
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/PRODUCT_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/USER_FLOWS.md`
- `docs/NOTIFICATION_SPEC.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

Out of scope for this baseline:
- Ticket 025A/025B restore preview and restore apply/UI work.
- Marketing site or workspace restructuring.
- Billing, AI, desktop/mobile, PWA/offline, or admin/support surfaces.
- Full first-run onboarding and monitoring/error-reporting integration, which
  remain public-launch follow-up work.

---

## Ticket 030: Public web hardening follow-up

Complete the remaining public-launch hardening items after Ticket 029:

- Add minimal first-run onboarding:
  - create first behavior,
  - notification permission,
  - import entry when import exists.
- Add basic monitoring/error reporting without sensitive behavior payloads.
- Add hosted many-independent-user RLS smoke QA beyond the static policy
  registry test.

Acceptance criteria:
- Keep onboarding thin, optional, and routed into existing Behaviors, Settings,
  and Export controls rather than a separate setup wizard.
- Do not request notification permission on page load.
- Treat import as optional and non-blocking.
- Keep monitoring provider-free unless separately scoped; structured runtime
  logs must avoid behavior titles, notes, descriptions, email addresses, push
  endpoints, keys, secrets, tokens, request bodies, and uploaded payloads.
- Add a repeatable RLS smoke command that uses two ordinary authenticated
  Supabase sessions for data access and proves one user cannot read, insert, or
  update another user's rows.
- Use service-role credentials only for smoke-test user setup and cleanup.

Suggested docs:
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/PRODUCT_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/UI_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

---

## Ticket 031: Astro marketing site

Add a simple public marketing site for Cadence and the BehaviorLog Bundle
standard.

Acceptance criteria:
- Implement as Astro, not inside the authenticated app shell.
- Support launch routes:
  - `/`
  - `/cadence`
  - `/standard`
  - `/docs`
  - `/examples`
  - `/about`
- Homepage leads with Cadence as the product and site brand.
- BehaviorLog is presented as the open bundle standard and portability layer
  behind Cadence exports and imports.
- Use the existing Cadence square ledger visual system and keep the current
  Cadence mark.
- Use only the Cadence mark and name in the marketing header.
- Use real Cadence product screenshots or static captures where possible,
  using demo or sanitized data only.
- `/docs` is agent-first technical documentation, useful to agents first and
  humans second.
- `/about` covers philosophy, governance, scope boundaries, and open-source
  posture for launch.
- Include primary CTAs:
  - Try Cadence
  - Read BehaviorLog
  - Download Example Bundle
  - View on GitHub
  - Log in
- Use SEO-conscious static pages with metadata, canonical URLs, sitemap/robots,
  accessible headings, and fast rendering.
- Include Open Graph and Twitter metadata.
- Keep primary content available in raw static HTML.
- Do not add marketing cookies or analytics.
- Share Cadence design tokens or token outputs where practical.
- Do not tease desktop/mobile apps before they are real or intentionally
  announced.
- Preserve existing authenticated Next.js app behavior unless a minimal
  npm-workspace adjustment is required.
- Update route, public-product architecture, design, status, and ticket docs.

Suggested files:
- `apps/marketing/*`
- `packages/ui/*` if tokens/primitives are extracted
- `docs/ROUTE_MAP.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/CRAWL_POLICY.md`
- `DESIGN.md`
- `STATUS.md`

---

## Ticket 032: Needs Decision same-day correction retention

Keep prior-day occurrences that were just decided from the Needs Decision modal
visible in that same modal for the rest of the current local day, using the same
row behavior and visual treatment as the Timeline.

Context:
- The current Timeline service reads prior unresolved occurrences and
  current/future occurrences. When a prior unresolved occurrence is marked
  Completed or Not Completed from the Needs Decision modal, it no longer
  qualifies for the modal after refresh.
- The existing occurrence status service can already change an owned occurrence
  by id and writes `explicit_user_correction` status events when a resolved
  occurrence is changed later.
- The user need is immediate correction for accidental Needs Decision taps,
  without turning Needs Decision into a general past-history browser.
- Interpret "lasts for a day" as "visible through the current local day until
  the next local midnight" in the user's timezone, matching the app day-boundary
  model.

Acceptance criteria:
- Needs Decision remains opened from the existing floating Timeline button.
  Do not add a new route, past Timeline sections, dashboard, or history page.
- Recently decided prior-day rows stay in their original prior local-day group
  in the modal. Do not create a separate `Decided just now`, `Recently decided`,
  or similar section.
- A prior unresolved occurrence marked from Needs Decision remains visible in the
  modal when its `status_marked_at` falls on the current local date in the
  user's timezone.
- Retained rows stop appearing in Needs Decision after the next local midnight
  without writing a separate stored flag, status, or audit marker.
- Completed retained rows use the same full blue Completed row treatment as
  Timeline completed rows. Collapsed primary status actions stay hidden, and
  expanding the row exposes Change status plus Note editing.
- Not Completed retained rows use the same Timeline Not Completed behavior:
  they return to the ordinary row treatment and continue exposing Completed and
  Not Completed actions in the collapsed row.
- Notes remain editable while a retained row is visible.
- The Needs Decision count continues to count only prior unresolved occurrences,
  not retained resolved rows. The button can still open when the count is zero
  if retained rows exist.
- The modal empty state appears only when there are no prior unresolved rows and
  no retained same-day decided rows.
- Preserve the existing completion chime behavior: a successful change into
  Completed may chime once, and refresh/revalidation must not unmount the row
  before that feedback can run.
- Do not add a stored `missed` status, automatic status changes, bulk edit,
  confirmation step before a correction, or offline pending mutation behavior.
- Keep date-boundary and row-visibility planning in resolvers/services. UI
  components must not implement local-day retention logic directly.
- Update `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and any relevant tests/docs so
  the intended modal behavior is explicit.

Suggested files:
- `lib/resolvers/timeline.resolver.ts`
- `lib/services/timeline.service.ts`
- `lib/types/timeline.ts`
- `components/timeline/Timeline.tsx`
- `components/timeline/NeedsDecisionDialog.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `components/timeline/StatusButtons.tsx`
- `app/(app)/timeline/actions.ts`
- `tests/timeline.resolver.test.ts`
- `tests/completion-feedback.test.ts`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused Timeline resolver/component tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- For UI changes, run `npm run design-system:check` if reusable UI or design
  inventory changes, then browser-check `/timeline` at desktop and around 390px.

---

## Ticket 033: Analytics selected-day occurrence correction

Add a later correction path for submitted occurrence decisions from the
Analytics calendar, using selected calendar dates to review and correct
individual occurrences.

Context:
- Ticket 032 handles immediate accidental taps from the Needs Decision modal for
  the current local day only.
- After that same-day retention expires, the app still needs a deliberate path
  to correct past submitted occurrence decisions.
- The Timeline should stay forward-looking and should not become a past-history
  browser.
- Analytics already has calendar date selection and selected-day inspection, but
  the current selected-day panel is read-only and only lists Not Completed
  occurrences.
- This surface should have enough information scent to be discoverable, without
  making historical edits feel like the primary logging flow.

Acceptance criteria:
- Keep the route as `/analytics`; do not add `/history`, `/dashboard`, or a new
  primary navigation item.
- Selecting a calendar date shows a sparse `Review selected day` panel when that
  date has occurrences in the active Analytics range.
- The selected-day panel lists all occurrences for the selected date, not only
  Not Completed occurrences.
- Each listed occurrence shows scheduled time, behavior title, category, current
  status, and note state using the established occurrence-row vocabulary.
- The user can change a submitted occurrence decision from Completed to Not
  Completed or from Not Completed to Completed.
- Unresolved occurrences in the selected-day panel can be marked Completed or
  Not Completed, but Needs Decision remains the stronger prompt for prior-day
  unresolved items.
- The user can add or edit the occurrence note from the selected-day panel.
- Corrections reuse the existing occurrence status service and status resolver
  so status events continue to record `explicit_user_correction` when a resolved
  status changes.
- Analytics counts, adherence, heatmaps, and selected-day rows refresh after a
  correction.
- The panel should provide clear information scent, for example by naming the
  area `Review selected day` and adding concise calendar helper text such as
  `Select a day to review its occurrences`.
- Do not rely on onboarding copy as the only way to teach this correction path.
- Keep historical correction deliberate: no bulk edit, no all-time search, no
  automatic correction suggestions, no AI coaching, and no gamified language.
- Do not change the default Analytics range behavior unless required for the
  selected-day review.
- No schema migration should be necessary unless implementation discovers a
  missing persisted field. If schema changes become necessary, follow the
  Supabase migration/data-model/type-generation rules.
- Update `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and resolver docs if the
  selected-day data contract changes.

Suggested files:
- `lib/resolvers/analytics.resolver.ts`
- `lib/services/analytics.service.ts`
- `lib/types/analytics.ts`
- `components/analytics/AnalyticsScreen.tsx`
- `components/timeline/OccurrenceRow.tsx` or a shared occurrence-row component
  if reuse is cleaner than duplicating row behavior
- `components/timeline/StatusButtons.tsx` or a shared status-action component
- `components/timeline/OccurrenceNoteForm.tsx` or a shared note form component
- `app/(app)/analytics/actions.ts`
- `app/(app)/analytics/page.tsx`
- `tests/analytics.resolver.test.ts`
- Analytics UI/component tests if added
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/AGENT_RESOLVERS.md` if resolver contracts change
- `STATUS.md`

Verification:
- Run focused Analytics resolver/UI tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- For UI changes, run `npm run design-system:check` if reusable UI or design
  inventory changes, then browser-check `/analytics` at desktop and around
  390px.

---

## Ticket 034: Multi-account Supabase launch readiness sign-off

Close the remaining readiness gates before inviting additional public accounts
onto the hosted Cadence web app.

Context:
- The app and database are already designed for many independent single-player
  accounts, with user-owned rows scoped by Supabase Auth and RLS.
- The remaining work is sign-off work, not a new product surface: verify hosted
  isolation, confirm hosted auth/account settings, and fix any readiness defects
  found by that verification.
- A prior readiness review found one restore-apply migration defect to address:
  `public.apply_behaviorlog_restore` attempts to upsert `behaviors` with
  `on conflict (import_run_id, external_id)`, but those columns do not exist on
  `behaviors`.
- Hosted Supabase commands and smoke checks are mutating operations. Run them
  only after the target project is explicit and the user authorizes the hosted
  verification/deployment step.

Implementation strategy:
1. Reconfirm the target hosted Supabase project and deployment domain.
2. Review current Supabase changelog/docs for Auth redirect settings, RLS,
   security-definer functions, and CLI commands relevant to the work.
3. Fix the restore-apply database defect locally with a new migration:
   - create the migration through `npm run supabase -- migration new ...`;
   - correct the invalid `behaviors` upsert conflict target while preserving
     per-user ownership checks;
   - review `public.apply_behaviorlog_restore` as a privileged function,
     including explicit execute grants/revokes so it is callable only by the
     intended role;
   - add or update tests that would fail if the invalid conflict target or
     unsafe function permissions return.
4. Verify local database rebuild and schema safety:
   - run `npm run supabase -- db reset`;
   - run Supabase advisors if the installed CLI supports them, or document the
     fallback if not;
   - regenerate database types if the effective schema changes;
   - run focused restore/RLS tests before the full verification suite.
5. Check hosted schema congruence before changing hosted state:
   - run `npm run supabase -- migration list` against the authorized project;
   - stop and document drift if hosted history does not match git;
   - push migrations with `npm run supabase -- db push` only after explicit
     user authorization.
6. Run hosted many-user RLS smoke QA:
   - point `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` at the
     authorized hosted project;
   - run `npm run smoke:rls`;
   - record only sanitized pass/fail counts in `STATUS.md`, never keys,
     temporary emails, user ids, or auth responses.
7. Audit hosted Auth/account settings for launch:
   - Google provider enabled and tested;
   - canonical production callback URL allow-listed at `/auth/callback`;
   - localhost callback URLs retained only where appropriate for development;
   - public signup intentionally enabled for Google accounts;
   - anonymous sign-ins disabled;
   - email/password signup either disabled for hosted public launch or
     explicitly justified as non-user-facing operational/test support;
   - provider-level abuse protections, captcha/bot protection, and rate limits
     reviewed against current Supabase capabilities;
   - service-role, Sequenzy, VAPID, and cron/process secrets accounted for in
     hosted environment ownership without printing secret values.
8. Perform a minimal production account smoke:
   - sign in with Google on the canonical production domain;
   - verify profile/default categories are created;
   - create a behavior and confirm Timeline generation works;
   - verify Export and account deletion remain available.

Acceptance criteria:
- The restore-apply migration defect is fixed by a git-tracked migration, not a
  hosted dashboard edit.
- Any `SECURITY DEFINER` restore function remains scoped to the authenticated
  user and has explicit execute permissions that do not expose it to anonymous
  callers.
- Local migrations rebuild cleanly from scratch.
- Static RLS policy tests cover every user-owned public table.
- Hosted migration history is checked and documented before any hosted push.
- Hosted `npm run smoke:rls` passes against the intended project after any
  required migration deployment.
- Hosted Auth/provider/account settings are audited and recorded without
  secrets.
- Minimal production Google sign-in and first-account data creation pass.
- `STATUS.md` records exact commands run, whether they targeted local or
  hosted Supabase, and any remaining launch risk.
- No collaboration, shared workspaces, social features, billing, admin
  dashboards, offline/PWA behavior, AI coaching, or desktop/mobile work is
  added.

Suggested files:
- `supabase/migrations/*`
- `lib/db/database.types.ts` if generated types change
- `tests/rls-policy-registry.test.ts`
- `tests/behaviorlog-restore-apply.service.test.ts`
- a focused migration/static test for restore RPC safety if useful
- `docs/OPERATIONS.md`
- `docs/SUPABASE_WORKFLOW.md` if the hosted readiness checklist changes
- `STATUS.md`

Verification:
- Run focused restore/RLS tests first.
- Run `npm run supabase -- db reset` locally after migration changes.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Run hosted `npm run smoke:rls` only after target-project authorization.
- If hosted migrations are pushed, run a post-push hosted smoke pass and record
  the sanitized result in `STATUS.md`.

---

## Ticket 035: Performance server timing instrumentation

Add privacy-safe timing evidence for authenticated app route loads before
making larger performance architecture changes.

Context:
- `docs/PERFORMANCE_SPEED_LOG.md` shows the current local production-build
  medians after Batch 3 are still too slow for a small app:
  - `/timeline`: about 2107ms
  - `/analytics`: about 1915ms
  - `/export`: about 2206ms
  - Timeline -> Behaviors client navigation: about 748ms
  - Settings -> Timeline client navigation: about 1489ms
- The same log found scripting, style, and layout work are near zero on warm
  loads; route time is dominated by server/data work.
- The current strongest hypothesis is that read routes are blocked by auth,
  Supabase REST round trips, occurrence sync, reminder planning, and repeated
  repository reads.
- This ticket is evidence-gathering only. It should not rewrite route data
  ownership, database schema, auth strategy, or occurrence generation.

Acceptance criteria:
- Add a small server timing utility that can measure named spans without
  logging behavior titles, notes, emails, UUIDs, cookies, tokens, provider
  responses, or other sensitive user data.
- Instrument at least:
  - protected app layout auth/user lookup
  - `/timeline` page bundle load
  - `/behaviors` page data load
  - `/analytics` page data load
  - `/export` page data load
  - `syncUserOccurrences`
  - major occurrence-sync phases: behavior list reuse, existing occurrence
    reads, schedule-slot resolution, generation planning, occurrence writes,
    reminder planning/writes
  - primary repository calls used by Timeline, Behaviors, Analytics, and Export
- Keep instrumentation server-only and disabled or low-noise by default. Use an
  explicit environment flag such as `CADENCE_PERF_LOG=1` for detailed local and
  production sampling.
- Emit structured logs that include route/span name, duration, status, and
  aggregate counts only. Counts may include number of behaviors, occurrences,
  created/deleted/updated rows, and reminders planned.
- Add or update a repeatable measurement harness if needed so local and
  authenticated production route timings can be captured consistently.
- Record before/after timings and the slowest server spans in
  `docs/PERFORMANCE_SPEED_LOG.md`.
- Do not add user-facing UI in this ticket.
- Do not add database indexes, RPCs, caching, background jobs, or auth-strategy
  changes in this ticket.
- Update `STATUS.md` with current ticket state and verification results.

Suggested files:
- `lib/services/performance-timing.ts`
- `lib/services/timeline.service.ts`
- `lib/services/behavior.service.ts`
- `lib/services/analytics.service.ts`
- `lib/services/export.service.ts`
- `lib/services/occurrence.service.ts`
- `lib/db/*.repo.ts` where lightweight timing wrappers are useful
- `scripts/performance-route-harness.mjs` if a durable harness is added
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Verification:
- Run focused tests for any touched services.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Run at least one local production-build measurement pass with
  `CADENCE_PERF_LOG=1`.
- If production timing is sampled, record sanitized results only.

---

## Ticket 036: App route loading boundaries and navigation response

Make route switches feel immediate while deeper server work is being reduced.
This is a user-perceived speed improvement, not a substitute for reducing the
actual server time in later tickets.

Context:
- The app currently has no `loading.tsx` route boundaries under the
  authenticated app routes.
- Next.js App Router dynamic routes can wait on the server response before the
  new page appears. Official Next.js guidance recommends loading boundaries and
  streaming for dynamic routes so shared layouts stay interactive and the
  fallback can be prefetched.
- User feedback specifically calls out page switching, such as Timeline to
  Behaviors, as feeling too slow.
- Keep the interface sparse and consistent with Cadence's existing app shell.

Acceptance criteria:
- Add route-level loading UI for the authenticated app routes, using a shared
  sparse skeleton that matches the current screen frames.
- At minimum cover:
  - `/timeline`
  - `/behaviors`
  - `/analytics`
  - `/export`
  - `/settings`
- Keep the app shell and navigation interactive during route transitions.
- Avoid spinners-only loading if a stable skeleton better preserves layout.
- Ensure loading UI does not introduce layout shift, oversized marketing-style
  placeholders, or dense dashboard treatment.
- Confirm nav links still use Next `Link` and do not disable default prefetch
  behavior unless evidence requires it.
- If needed, split slow page sections behind local `Suspense` boundaries so the
  first usable route frame appears before all route data is ready. Do not move
  resolver or database logic into client components.
- Do not change stored data, resolver behavior, occurrence generation, reminder
  delivery, or auth semantics.
- Update `DESIGN.md` or design-system files only if reusable UI inventory or
  design contracts change.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with click-to-loading and
  click-to-target timings.
- Update `STATUS.md` with verification results.

Suggested files:
- `app/(app)/loading.tsx`
- route-specific `app/(app)/*/loading.tsx` files if one shared loading boundary
  is too generic
- `components/layout/ScreenLoading.tsx` or equivalent shared component
- `components/layout/AppShell.tsx` if navigation pending state is added
- `docs/PERFORMANCE_SPEED_LOG.md`
- `DESIGN.md` if reusable UI guidance changes
- `STATUS.md`

Verification:
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- For UI changes, run `npm run design-system:check` if reusable UI or design
  inventory changes.
- Browser-check `/timeline`, `/behaviors`, `/analytics`, `/export`, and
  `/settings` at desktop and around 390px.
- Measure at least:
  - Timeline -> Behaviors click-to-loading
  - Timeline -> Behaviors click-to-target
  - Settings -> Timeline click-to-loading
  - Settings -> Timeline click-to-target

---

## Ticket 037: Occurrence sync freshness state

Create a persisted per-user freshness contract so read routes can know whether
occurrences are already generated for the required horizon without running the
full sync job on every page load.

Context:
- Current read-heavy routes call `syncUserOccurrences` before rendering.
- `syncUserOccurrences` plans generation for all behaviors, reads occurrences,
  resolves schedule slots, performs missing occurrence upserts, deletes stale
  future unresolved occurrences, and syncs reminder deliveries.
- Earlier optimization batches parallelized and batched parts of this work, but
  the read routes remain server-bound.
- The desired architecture is: write paths and background jobs keep occurrence
  rows ready; read routes render from ready data and only trigger repair when
  the freshness state is stale.

Acceptance criteria:
- Add a Supabase migration for a user-owned occurrence sync state table, likely
  `occurrence_sync_state`.
- The table should track enough information to decide whether the user's
  occurrence horizon is fresh, such as:
  - `user_id`
  - timezone or timezone version used for the last sync
  - last synced local date
  - synced-through local date or horizon end
  - last successful sync timestamp
  - stale flag or stale reason
  - optional aggregate counts for observability
  - created/updated timestamps
- Add RLS policies and explicit grants for the new user-owned table.
- Add repository and service helpers for:
  - reading sync state
  - marking sync stale after behavior, schedule, timezone, import, restore, or
    other occurrence-affecting writes
  - marking sync fresh after a successful sync
  - deciding whether a given route's required local-date horizon is covered
- Keep resolver logic pure. Freshness decision helpers may live in services or a
  small pure resolver if useful, but database access must stay in repositories.
- Update occurrence-affecting write paths to mark freshness stale or fresh as
  appropriate:
  - behavior create/edit/archive/restore
  - settings timezone update
  - BehaviorLog import/restore apply paths that create/update occurrences
  - future occurrence-affecting write paths if present
- Do not remove `syncUserOccurrences` from read routes in this ticket. This is
  the state foundation only.
- Update `docs/DATA_MODEL.md`, generated database types, and relevant service
  tests.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with implementation notes, not speed
  claims unless measured.
- Update `STATUS.md`.

Suggested files:
- `supabase/migrations/*_add_occurrence_sync_state.sql`
- `lib/db/occurrenceSyncState.repo.ts`
- `lib/services/occurrence-sync-state.service.ts`
- `lib/services/occurrence.service.ts`
- `lib/services/behavior.service.ts`
- `lib/services/settings.service.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/services/behaviorlog-restore.service.ts`
- `lib/db/database.types.ts`
- `docs/DATA_MODEL.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`
- focused service tests for freshness decisions and stale marking

Verification:
- Create the migration through `npm run supabase -- migration new ...`.
- Run `npm run supabase -- db reset`.
- Regenerate database types if schema changes.
- Run focused occurrence/behavior/settings/import tests.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.

---

## Ticket 038: Move occurrence sync off hot read routes

Use the freshness state from Ticket 037 to stop doing full occurrence sync on
every Timeline, Analytics, and Export page render.

Context:
- This is the core architectural change for the current performance problem.
- Timeline, Analytics, and Export currently run `syncUserOccurrences` before
  reading route data.
- The app is small and single-player per account; a rolling generated horizon is
  acceptable as long as behavior changes, timezone changes, imports/restores,
  and daily horizon extension keep rows correct.
- The system must still preserve the domain rules:
  - no automatic `not_completed` or missed status
  - past/resolved occurrence history is preserved
  - Needs decision remains derived from unresolved prior-day occurrences
  - recurrence and day-boundary logic stays in resolvers/services

Acceptance criteria:
- Add a service-level `ensureUserOccurrencesFresh` or equivalent that:
  - checks `occurrence_sync_state`
  - runs `syncUserOccurrences` only when stale or insufficient for the route's
    required horizon
  - marks sync fresh on success
  - records sanitized timing and count data when performance logging is enabled
- Replace unconditional route-load `syncUserOccurrences` calls in Timeline,
  Analytics, and Export with freshness-aware logic.
- Choose route horizons deliberately:
  - Timeline must cover current local day plus the documented future timeline
    horizon.
  - Analytics must cover the selected analytics range through the current local
    day without deleting future rows outside its view.
  - Export must cover through the exported end local date, with all-time export
    still including occurrences through the current local day and excluding
    generated future rows.
- Fix the occurrence planner contract if needed so smaller read-route horizons
  cannot delete valid future unresolved rows outside the requested view.
- Add or update a daily/background horizon extension path. This may use the
  existing protected process route pattern or a new protected route, but it
  must be secret-protected and idempotent.
- Ensure behavior create/edit/archive/restore and timezone save still produce
  correct future unresolved occurrences immediately for the affected behavior or
  account.
- If sync is stale and fails, choose a conservative failure mode:
  - do not show silently incorrect data as fresh;
  - surface a route-safe error or fallback consistent with current error
    handling.
- Keep Supabase RLS in normal app code. Do not use service-role clients for
  ordinary authenticated user route reads.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with before/after route timings.
- Update `docs/OPERATIONS.md` and `docs/ROUTE_MAP.md` if a new process route or
  cron workflow is added.
- Update `STATUS.md`.

Suggested files:
- `lib/services/occurrence.service.ts`
- `lib/services/occurrence-sync-state.service.ts`
- `lib/services/timeline.service.ts`
- `lib/services/analytics.service.ts`
- `lib/services/export.service.ts`
- `lib/resolvers/occurrence.resolver.ts` if planner contract changes
- `app/api/occurrences/sync/route.ts` or an existing process route if a
  background sync endpoint is added
- `vercel.json` if Vercel Cron is used for horizon extension
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/OPERATIONS.md`
- `docs/ROUTE_MAP.md`
- `STATUS.md`
- focused occurrence service/resolver tests

Verification:
- Run focused occurrence resolver/service tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Run local production-build route timing for `/timeline`, `/analytics`,
  `/export`, `/behaviors`, and `/settings`.
- Verify behavior create/edit/archive/restore, timezone save, Timeline status
  actions, Analytics selected-day correction, and Export downloads still use
  correct occurrence data.

---

## Ticket 039: Decouple reminder planning from read-route rendering

Move reminder-delivery planning fully onto occurrence/behavior mutation paths
and reminder processing repair paths so ordinary page reads do not create or
cancel reminder deliveries.

Context:
- `syncUserOccurrences` currently calls `syncReminderDeliveriesForBehaviors`
  after occurrence generation planning.
- Browser reminders are enabled by default; email reminders are optional per
  behavior.
- Pending reminders must still be cancelled when an occurrence is resolved
  before the send time.
- Reminder processing must remain idempotent and must avoid duplicate sends.
- This ticket follows Ticket 038 because read-route occurrence sync must first
  have a freshness contract.

Acceptance criteria:
- Make behavior create/edit/archive/restore, timezone changes, import/restore
  apply, and occurrence-generation jobs responsible for planning/cancelling
  pending reminder deliveries for affected future occurrences.
- Keep status resolution cancellation in the existing occurrence status service
  path.
- Add a safe reminder processor repair step if needed:
  - before sending a due reminder, re-check occurrence/behavior eligibility;
  - create or cancel missing/stale pending deliveries only when needed and only
    for the due window;
  - never send duplicate reminders.
- Remove reminder planning writes from ordinary fresh read-route rendering.
- Preserve inactive-behavior cancellation semantics.
- Preserve all Sequenzy and Web Push server-only secret boundaries.
- Add tests for:
  - behavior changes plan expected reminder deliveries
  - route reads do not create reminder deliveries when sync state is fresh
  - resolving an occurrence cancels pending deliveries
  - reminder processor remains idempotent
  - duplicate sends are not introduced
- Update `docs/NOTIFICATION_SPEC.md` and `docs/PERFORMANCE_SPEED_LOG.md` if the
  reminder planning lifecycle changes.
- Update `STATUS.md`.

Suggested files:
- `lib/services/reminder.service.ts`
- `lib/services/occurrence.service.ts`
- `lib/services/behavior.service.ts`
- `lib/services/settings.service.ts`
- `lib/db/reminderDeliveries.repo.ts`
- `app/api/reminders/process/route.ts`
- `tests/reminder.service.test.ts`
- `tests/occurrence.service.test.ts`
- `docs/NOTIFICATION_SPEC.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Verification:
- Run focused reminder and occurrence service tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- If production reminder behavior is smoke-tested, do not send real emails
  without explicit user-approved recipient instructions.

---

## Ticket 040: Auth and app-shell latency reduction

Reduce protected-route auth and shell overhead after measuring it, without
weakening Supabase Auth, RLS, or route protection.

Context:
- The protected proxy currently calls Supabase Auth `getUser` for matched app
  routes, and the protected app layout also verifies the user server-side.
- Supabase documents that `getUser` performs a network request to the Auth
  server. Supabase also documents `getClaims`, which can verify JWT claims
  faster when the project uses an asymmetric signing key, with fallback behavior
  when it does not.
- The app must keep Google login, cookie-backed SSR auth, RLS, and server-side
  route protection.
- This ticket must be evidence-driven. Do not switch auth methods blindly.

Acceptance criteria:
- Use Ticket 035 instrumentation to measure protected proxy auth time, app
  layout auth time, and total shell render time.
- Check current Supabase docs/changelog before changing auth behavior.
- Determine whether the hosted Supabase project supports a safe `getClaims`
  path for route gating. Document the result in
  `docs/PERFORMANCE_SPEED_LOG.md`.
- If safe, replace one or more redundant route-gating `getUser` calls with a
  lower-latency claims/session-validation path while preserving:
  - server-side route protection
  - cookie refresh correctness
  - redirect behavior for unauthenticated users
  - RLS-backed database access for user-owned rows
  - no trust in user-editable metadata for authorization decisions
- Keep strict `getUser` or equivalent authoritative user lookup where the code
  needs full user details, email/display metadata, or security-sensitive account
  actions.
- Consider splitting app-shell account display from route gating if full user
  metadata is the only reason every navigation waits on Auth network I/O.
- Add tests or smoke coverage for:
  - unauthenticated protected route redirect
  - authenticated route access
  - `/login` redirect for already-authenticated users
  - OAuth callback flow remains unchanged
  - account/settings paths that require authoritative user data still work
- Do not bypass Supabase RLS or use service-role clients for normal app pages.
- Update `docs/OPERATIONS.md` or auth notes if the auth validation approach
  changes.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with before/after timings.
- Update `STATUS.md`.

Suggested files:
- `proxy.ts`
- `lib/supabase/proxy.ts`
- `lib/auth/current-user.ts`
- `app/(app)/layout.tsx`
- `lib/services/settings.service.ts`
- `tests/*auth*.test.ts` if auth tests exist or are added
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/OPERATIONS.md`
- `STATUS.md`

Verification:
- Run focused auth/proxy tests or route smoke tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-smoke authenticated and unauthenticated access to `/timeline`,
  `/behaviors`, `/settings`, and `/login`.

---

## Ticket 041: Query evidence, indexes, and optional Timeline read RPC

After the hot-route sync and auth work, use concrete query evidence to decide
whether database indexes or a narrow RLS-safe read RPC are needed.

Context:
- Existing occurrence indexes cover common user/local-date and user/status/date
  reads, but current repository query shapes include additional filters such as
  `behavior_id`, `scheduled_for`, `status_marked_at`, and reminder status.
- The previous speed loop intentionally deferred index changes until hosted
  route timing and Supabase query evidence showed a clear need.
- The app should remain simple. Do not add database views or RPCs as a generic
  abstraction layer.

Acceptance criteria:
- Measure query timings for the post-Ticket-040 app on local production build
  and, if authorized, hosted production.
- Use Supabase/Postgres evidence such as `EXPLAIN` plans, slow query logs,
  repository timing spans, or local seeded data tests before adding indexes.
- Evaluate at least these query families:
  - Timeline forward local-date range reads
  - Needs decision prior unresolved reads
  - same-day retained prior resolved reads using `status_marked_at`
  - Analytics local-date range reads
  - Export through-current-day reads
  - per-behavior occurrence sync reads when sync does run
  - due pending reminder delivery reads
- Add indexes only when evidence shows an expected benefit, through Supabase
  migrations with updated `docs/DATA_MODEL.md`.
- Candidate indexes may include, but are not limited to:
  - `(user_id, behavior_id, scheduled_for)` for per-behavior sync reads
  - a partial or composite index for prior unresolved occurrence reads
  - `(user_id, status, status_marked_at, local_date)` or another measured shape
    for retained same-day prior decisions
- If route timing is dominated by multiple network round trips rather than
  individual query plans, consider one narrow Timeline read RPC that returns the
  three Timeline occurrence sets in one call.
- Any RPC must:
  - preserve per-user ownership checks
  - avoid `SECURITY DEFINER` unless there is a documented, reviewed reason
  - have explicit grants/revokes
  - return only the fields needed by the service
  - keep Timeline grouping logic in the resolver/service layer, not SQL
- Do not move recurrence generation, status semantics, adherence math, export
  formatting, or reminder planning into SQL.
- Update generated database types after schema changes.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with query evidence and route timing
  deltas.
- Update `STATUS.md`.

Suggested files:
- `supabase/migrations/*_add_performance_indexes.sql`
- `lib/db/occurrences.repo.ts`
- `lib/db/reminderDeliveries.repo.ts`
- `lib/services/timeline.service.ts` only if a narrow read RPC is added
- `lib/db/database.types.ts`
- `docs/DATA_MODEL.md`
- `docs/SUPABASE_WORKFLOW.md` only if workflow guidance changes
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`
- focused repository/service tests

Verification:
- Create migrations through `npm run supabase -- migration new ...`.
- Run `npm run supabase -- db reset`.
- Regenerate database types if schema changes.
- Run focused repository/service tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Re-run the route timing matrix for `/timeline`, `/behaviors`, `/analytics`,
  `/export`, and `/settings`.

---

## Ticket 042: Production region and database round-trip latency evidence

Verify whether hosted app and Supabase region placement is adding avoidable
latency before introducing more complex caching or database aggregation.

Context:
- The follow-up speed pass found that app shells can respond under 100 ms, but
  full authenticated data loads and form actions remain bounded by hosted
  Supabase round trips measured at roughly 155-200 ms each from the test
  machine.
- Prior measurements showed production functions running in `iad1`; the
  Supabase project region and function-to-database latency need explicit
  confirmation.
- Region changes can involve downtime, data migration, provider limits, or
  OAuth/domain follow-up, so this ticket is evidence and recommendation only
  unless a later ticket explicitly authorizes an environment change.

Acceptance criteria:
- Confirm the production Vercel function region and current Supabase project
  region without exposing secrets or provider tokens.
- Measure authenticated server-side Supabase round-trip timing from the
  production deployment using existing timing instrumentation where possible.
- Measure the same page-load route matrix used in the performance speed loop:
  `/timeline`, `/behaviors`, `/analytics`, `/export`, and `/settings`.
- Record whether observed latency appears dominated by region distance, cold
  start, individual query plans, multiple sequential Supabase calls, or
  post-action re-render work.
- If region mismatch is found, document the lowest-risk options and tradeoffs:
  moving Supabase, pinning or moving Vercel functions, accepting the current
  placement, or using cache/RPC mitigation instead.
- Do not move production infrastructure, rotate secrets, or change provider
  settings in this ticket unless a separate user instruction explicitly
  authorizes that mutation.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with measurements and the final
  recommendation.
- Update `STATUS.md`.

Suggested files:
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/VERCEL_WORKFLOW.md` only if deployment-region guidance changes
- `docs/SUPABASE_WORKFLOW.md` only if project-region guidance changes
- `STATUS.md`
- `vercel.json` only if a separate approved implementation ticket changes
  region configuration

Verification:
- Re-run the route timing matrix under the same repeatable test conditions.
- Run `npm run agents:check`.
- If provider config files change, also run `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.

---

## Ticket 043: Page-level authenticated read RPC aggregation

Collapse repeated Supabase network round trips for page data where measurements
show that batching reads is more valuable than another client or framework
optimization.

Context:
- Ticket 041 allows one narrow Timeline read RPC if route timing is dominated
  by network round trips rather than individual query plans.
- The follow-up speed pass indicates the remaining full data loads are often
  bounded by multiple hosted Supabase calls, not by the app shell itself.
- This ticket generalizes that investigation to all primary authenticated pages
  while preserving resolver-first boundaries.

Acceptance criteria:
- Start with the highest-value page shown by current measurements, likely
  `/export` or `/timeline`, and prove the pattern before applying it elsewhere.
- For each page considered, capture before/after counts for Supabase calls,
  server timing spans, and full page-load timing.
- Any PostgreSQL function must be narrow and page-specific. Do not introduce a
  generic database abstraction layer.
- Preserve user ownership through RLS or explicit `auth.uid()` ownership
  checks. Avoid `SECURITY DEFINER` unless there is a documented, reviewed
  reason, a pinned `search_path`, and explicit grants/revokes.
- Return only the fields needed by the service for the page.
- Keep recurrence generation, timeline grouping, status semantics, adherence
  math, export formatting, and reminder planning in resolvers/services rather
  than SQL.
- Add Supabase migrations for any RPCs or indexes.
- Update generated database types after schema changes.
- Update `docs/DATA_MODEL.md` if database functions or indexes become part of
  the documented data-access contract.
- Update `docs/PERFORMANCE_SPEED_LOG.md` after each significant page change.
- Update `STATUS.md`.

Suggested files:
- `supabase/migrations/*_add_page_read_rpc.sql`
- `lib/db/*`
- `lib/services/timeline.service.ts`
- `lib/services/analytics.service.ts`
- `lib/services/export.service.ts`
- `lib/services/behavior.service.ts`
- `lib/services/settings.service.ts`
- `lib/db/database.types.ts`
- `docs/DATA_MODEL.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`
- focused repository/service tests

Verification:
- Create migrations through `npm run supabase -- migration new ...`.
- Run `npm run supabase -- db reset`.
- Regenerate database types if schema changes.
- Run focused repository/service tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Re-run the route timing matrix after each page-level RPC change.

---

## Ticket 044: Per-user read-through cache for stable authenticated data

Add explicit, user-scoped caching for stable authenticated read bundles so
unchanged private data does not require a hosted Supabase round trip on every
page render.

Context:
- The app repeatedly reads stable per-user data such as settings, categories,
  behavior lists, and import/restore metadata.
- Authenticated caching is only acceptable if keys are scoped to the current
  user and invalidation is tied to the mutations that change that data.
- This must not become PWA/offline caching; offline mutation and sync conflict
  handling remain deferred from v1.

Acceptance criteria:
- Define a small cache contract for user-owned read bundles, including key
  shape, tags or invalidation handles, TTL expectations, and allowed data
  categories.
- Cache only low-volatility authenticated data where stale reads are either
  invalidated by known mutations or have a documented short TTL.
- Include `userId` in cache keys and tags. Do not include emails, provider
  tokens, or secrets in keys, tags, logs, or timing output.
- Preserve normal RLS-protected Supabase access on cache misses. Do not use a
  service-role client for normal app reads.
- Invalidate affected cache entries on behavior create/update/archive/restore,
  category changes, settings timezone changes, import/restore apply, and
  account deletion.
- Keep occurrence rows, status histories, and reminder delivery state uncached
  unless a later measurement proves a specific safe cache boundary.
- Measure before/after page loads for every primary authenticated route under
  the same speed-loop test conditions.
- Add focused tests or low-level assertions that prove cache keys are
  user-scoped and mutations invalidate the intended data.
- Update `docs/PERFORMANCE_SPEED_LOG.md`.
- Update `STATUS.md`.

Suggested files:
- `lib/cache/*`
- `lib/services/settings.service.ts`
- `lib/services/behavior.service.ts`
- `lib/services/categories.service.ts` if present
- `lib/services/import*.ts` or restore services if present
- related server actions that mutate cached data
- focused cache/service tests
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Verification:
- Run focused cache/service tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Re-run the route timing matrix for `/timeline`, `/behaviors`, `/analytics`,
  `/export`, and `/settings`.

---

## Ticket 045: Optimistic UI for common Timeline actions

Make common occurrence actions feel immediate by updating the visible UI before
the hosted Supabase mutation finishes, while still reconciling against the
server result.

Context:
- True server completion remains bounded by hosted Supabase round trips, but
  user-perceived action response can be under 100 ms for local UI feedback.
- The highest-value actions are Timeline status changes and note edits because
  they are frequent and small.
- This ticket is not offline support. It must not add background mutation
  queues, persistent local writes, or sync conflict handling.

Acceptance criteria:
- Implement optimistic UI first for occurrence `Completed` and `Not Completed`
  actions on the Timeline.
- Include note save only if the same pattern remains small and low risk after
  status actions are working.
- Show an accessible pending state for actions whose server confirmation has
  not returned.
- Revert the optimistic change and surface the existing error path if the
  server action fails.
- Keep stored occurrence statuses authoritative on the server. The optimistic
  state is visual until confirmed.
- Preserve the domain language: Unresolved, Completed, Not Completed, and
  Needs decision.
- Measure click-to-visible-feedback separately from server action completion.
- Re-run page-load measurements after the change to ensure optimistic state
  does not regress initial loads.
- Add focused tests for the optimistic state transition and rollback behavior
  if the component structure supports it.
- Update `docs/PERFORMANCE_SPEED_LOG.md`.
- Update `STATUS.md`.

Suggested files:
- Timeline occurrence row components
- Timeline action state hooks or reducers
- status/note server actions only if response shapes need to change
- focused component or reducer tests
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Verification:
- Run focused component or action-state tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-smoke status changes, note edits if included, action failure handling,
  and mobile Timeline layout.

---

## Ticket 046: Small mutation responses and targeted route refresh

Reduce form-action latency by returning small server-confirmed view models and
refreshing only the data that actually needs to be reloaded.

Context:
- The follow-up speed pass found that behavior create/edit/archive actions are
  still affected by hosted Supabase writes plus post-action route re-render
  work.
- Prior performance work already moved occurrence sync off hot read paths and
  allowed behavior mutations to mark occurrence sync state stale instead of
  synchronously generating all future occurrences.
- Broad route revalidation is still useful for correctness in some places, but
  it should not be the default when the client can update a local list from a
  small server-confirmed response.

Acceptance criteria:
- Audit current server actions for behavior create/update/archive/restore,
  Timeline status/note changes, Analytics correction actions, and Settings
  timezone changes.
- Identify which actions require `revalidatePath`, which can use targeted cache
  invalidation, and which can return a small confirmed result for local UI
  update.
- Start with behavior create because it is a visible form workflow and currently
  pays for both database work and page refresh behavior.
- Return enough validated server data for the UI to insert or update the
  affected row without forcing a full route re-render.
- Preserve server-side validation, ownership checks, RLS, and the occurrence
  sync freshness contract.
- Keep cross-route consistency explicit. If another route may be stale until
  navigation or refresh, document why that is acceptable or add targeted
  invalidation.
- Do not introduce a broad client-side data framework solely for this ticket.
- Measure form submit-to-visible-result and server action completion separately.
- Re-run page-load measurements for every primary authenticated route after
  each significant change.
- Update `docs/PERFORMANCE_SPEED_LOG.md`.
- Update `STATUS.md`.

Suggested files:
- behavior server actions
- behavior list/form components
- Timeline and Analytics action handlers if included after the behavior flow
- `lib/services/behavior.service.ts`
- `lib/services/timeline.service.ts`
- focused action/component tests
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Verification:
- Run focused action/component tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-smoke create, edit, archive, and restore behavior flows plus Timeline
  and Analytics action flows if they are changed.

---

## Ticket 047: Production performance timing log sampling

Enable the existing privacy-safe server timing instrumentation in production
long enough to capture authenticated route span evidence for the current
performance architecture.

Context:
- Ticket 035 added `CADENCE_PERF_LOG=1` gated server timing spans for
  protected app layout auth, route data loads, occurrence freshness checks,
  reminder planning/writes, and primary repository reads.
- Ticket 042 could not capture production server span evidence because
  `CADENCE_PERF_LOG` was not configured in the hosted production environment.
- Tickets 043-046 added RPC, read-through cache, optimistic UI, and targeted
  mutation improvements. A production log sample is needed to distinguish
  route/server work, Supabase round trips, and cache behavior from browser
  wall-clock timing variance.

Acceptance criteria:
- Configure `CADENCE_PERF_LOG=1` for the Vercel Production environment without
  exposing secrets or changing public runtime config.
- Redeploy production so the runtime receives the new environment variable.
- Run an authenticated production route matrix for `/timeline`, `/behaviors`,
  `/analytics`, `/export`, and `/settings`.
- Query production Vercel logs for sanitized `performance_timing` events and
  record representative route/page/auth/repository spans.
- Confirm that timing output contains route/span names, duration, status, and
  aggregate counts only. Do not record cookies, emails, behavior titles, notes,
  push endpoints, provider tokens, request bodies, or response bodies.
- Record whether cache hits are visible through missing or reduced repository
  spans on repeated route loads. Treat the cache as best-effort per instance,
  not durable shared infrastructure.
- Update `docs/PERFORMANCE_SPEED_LOG.md` with production span evidence,
  browser timing notes, and any remaining risk.
- Update `docs/VERCEL_WORKFLOW.md` so `CADENCE_PERF_LOG` is documented as an
  optional production sampling flag.
- Update `STATUS.md`.

Suggested files:
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

Verification:
- Confirm `vercel env ls production` includes `CADENCE_PERF_LOG`.
- Confirm the post-change production deployment is `READY`.
- Confirm `vercel logs --query performance_timing` returns sanitized timing
  events after authenticated route loads.
- Run `npm run agents:check`.
- Run `git diff --check`.

---

## UX backlog posture

The following UX tickets come from `docs/UX_RESEARCH_LOG.md` and
`docs/UX_JOURNEY_INVENTORY.md`.

Product stance:
- Cadence optimizes first for efficient visual use, sparse interaction, and
  readability for the primary abled-user workflow.
- Cadence should still preserve baseline web correctness: unique ids, valid
  labels, keyboard-safe close behavior for overlays, reliable mobile layout,
  factual state copy, and no unreachable core controls.
- Cadence is not pursuing a comprehensive screen-reader remediation or WCAG
  compliance program in this ticket set unless a later product decision changes
  that posture.
- BehaviorLog export/import remains the strategic portability path for users
  who need a different interface or interaction model.
- Avoid granular accessibility changes that materially compromise the sparse
  visual workflow. Prefer interventions that also improve general robustness,
  mobile usability, implementation clarity, or safety comprehension.

Adjusted UX priority:
1. Fix duplicate ids, broken anchors/labels, and any confirmed layout overlap.
2. Preserve the efficient visual UI while adding low-cost robustness such as
   correct buttons, labels, focus return, and Escape close behavior.
3. Improve mobile tap reliability only where it affects daily status marking,
   note editing, or high-risk confirmation flows.
4. Treat keyboard-only and 200 percent zoom checks as smoke tests for impossible
   or overlapped workflows, not as a full assistive-technology program.
5. Treat screen-reader-specific announcements, exhaustive ARIA descriptions,
   and specialized screen-reader journey tuning as optional unless they also
   improve maintainability or general usability.
6. Prioritize import, restore, reminder, deletion, and trust comprehension
   where confusion can cause unsafe data decisions.

---

## Ticket 048: UX research reproduction and triage pass

Turn the source-review findings in `docs/UX_RESEARCH_LOG.md` into a verified UX
backlog, separating confirmed implementation bugs from optional design
refinements.

Context:
- The first UX research pass logged findings UX-001 through UX-035.
- Many findings are marked `Needs reproduction` because they came from source
  review rather than browser observation.
- The current product posture favors efficient visual operation and baseline
  web correctness over comprehensive assistive-technology remediation.

Acceptance criteria:
- Run a browser-based reproduction pass for the highest-risk journeys:
  - J04 First-run activation
  - J07 Daily timeline use
  - J09 Needs decision
  - J12 Browser reminders
  - J14 Timezone management
  - J16 Import BehaviorLog bundle
  - J17 Restore backup
  - J19 Account deletion
  - J21 Mobile navigation and task flow
- Test at desktop and narrow mobile widths around 390px and 320px where
  relevant.
- Treat keyboard-only and 200 percent zoom as smoke checks for impossible,
  overlapped, or hidden workflows rather than a full accessibility audit.
- Update each reproduced finding in `docs/UX_RESEARCH_LOG.md` with:
  - observed result,
  - whether the issue is confirmed, not reproduced, deferred, or fixed,
  - which follow-up ticket owns it.
- Do not change product behavior in this ticket except for tiny documentation
  corrections needed to record the triage result.
- Do not add new product scope, new routes, dashboards, social features,
  gamification, AI coaching, calendar sync, or offline behavior.

Suggested files:
- `docs/UX_RESEARCH_LOG.md`
- `docs/UX_JOURNEY_INVENTORY.md` only if journey wording needs clarification
- `docs/TICKETS.md` only if follow-up tickets need scope adjustment
- `STATUS.md`

Verification:
- Run `npm run agents:check`.
- Run `git diff --check`.
- If any UI code is changed despite the expected doc-only scope, also run the
  standard UI verification for the affected route.

---

## Ticket 049: Settings baseline web correctness

Fix low-risk Settings issues that affect ordinary browser behavior, anchors,
labels, and destructive-action affordances without redesigning the Settings
surface.

Context:
- UX-015 flags duplicate `timezone` ids in Settings.
- UX-027 flags that timezone-save impact may be unclear before submit.
- UX-028 flags that account deletion server gates may not be mirrored in the
  client button state.
- These are baseline correctness and safety issues, not a broad accessibility
  redesign.

Acceptance criteria:
- Ensure the timezone section anchor and timezone input have unique ids.
- Preserve `/settings#timezone` as a stable route target unless a documented
  redirect or compatibility strategy is added.
- Ensure labels point to the intended controls after the id fix.
- Add concise pre-save timezone impact text if browser testing confirms users
  cannot predict that future unresolved occurrences and active behavior
  timezones are affected.
- Mirror account deletion gates in the client affordance if testing confirms
  the enabled button implies permission to proceed before acknowledgement and
  typed confirmation are complete.
- Preserve server-side account deletion validation regardless of client button
  state.
- Do not add account recovery, provider-account deletion claims, admin support
  tooling, or broad account-management scope.

Suggested files:
- `app/(app)/settings/page.tsx`
- Settings client components, if split from the page
- `components/*` only if Settings uses shared form controls
- `docs/UI_SPEC.md` if the Settings contract changes
- `docs/USER_FLOWS.md` if timezone or deletion copy requirements change
- `STATUS.md`

Verification:
- Run focused Settings tests if present or added.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check `/settings`, `/settings#timezone`, and account deletion gates
  at desktop and around 390px.

---

## Ticket 050: First-run mobile layout robustness

Verify and fix first-run setup layout issues that can block or obscure the
Timeline on mobile.

Context:
- UX-013 flags that the first-run setup pop-up may collide with the sticky
  mobile header.
- UX-016 flags that setup dismissal is browser-local rather than account-scoped.
- UX-017 flags that the non-modal setup panel may be missed by some non-pointer
  users, but the product posture does not require a screen-reader-specific
  onboarding redesign unless it improves general use.

Acceptance criteria:
- Reproduce first-run setup with a clean account at desktop, 390px, and 320px.
- If the setup pop-up overlaps the header, drawer trigger, Needs decision
  control, or primary Timeline content, adjust layout or positioning.
- Preserve the setup prompt as optional and non-blocking.
- Do not request notification permission on page load.
- Decide whether browser-local dismissal remains acceptable for v1 or whether
  account-scoped dismissal is worth implementing. Record the decision in
  `docs/USER_FLOWS.md` or `docs/UI_SPEC.md` if it changes product behavior.
- Keep focus behavior simple: no focus stealing from the Timeline unless a
  confirmed general usability problem requires it.
- Do not add a setup wizard, dashboard, checklist route, or multi-step
  onboarding product surface.

Suggested files:
- `components/timeline/*`
- `components/layout/*`
- `app/(app)/timeline/page.tsx`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused Timeline/component tests if present or added.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check first-run `/timeline` at desktop, 390px, and 320px.
- Run `npm run design-system:check` if reusable UI or design inventory changes.

---

## Ticket 051: Timeline daily workflow usability pass

Improve the primary daily Timeline workflow where issues affect fast visual use,
mobile taps, or implementation clarity.

Context:
- UX-002 flags quiet text actions and mobile/hurry-state tap reliability.
- UX-019 flags possible scroll-context loss after Show more days.
- UX-020 flags implicit row-expansion semantics.
- UX-035 flags possible duplicate titles in multi-slot Timeline groups.
- The goal is not to make the Timeline verbose. Preserve the sparse, efficient
  visual workflow.

Acceptance criteria:
- Verify unresolved current-day rows expose Completed, Not Completed, and Note
  affordances clearly enough on desktop and mobile.
- Confirm primary daily actions have reliable tap targets on mobile without
  making the row visually heavy.
- Prefer invisible hit-area padding or spacing changes before replacing quiet
  text actions with heavier controls.
- If row expansion is confusing to visual users or fragile in implementation,
  clarify the toggle area using native disclosure semantics or a simple button
  pattern while preserving the no-dashboard, no-chevron-heavy visual style.
- Verify Show more days preserves or restores useful scroll context on long
  Timelines. Add an anchor or targeted scroll behavior only if context loss is
  confirmed.
- Test a multi-slot behavior on mobile and reduce repeated title noise only if
  it materially slows scanning.
- Do not add bulk status updates, streaks, gamified feedback, past-history
  browsing, AI suggestions, or a dense dashboard.

Suggested files:
- `components/timeline/Timeline.tsx`
- `components/timeline/TimelineGroup.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `components/timeline/StatusButtons.tsx`
- `components/timeline/OccurrenceNoteForm.tsx`
- `app/(app)/timeline/page.tsx`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused Timeline/component tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check `/timeline` at desktop, 390px, and 320px, including 200 percent
  zoom as a smoke test.
- Run `npm run design-system:check` if reusable UI or design inventory changes.

---

## Ticket 052: Needs Decision interaction correctness

Make the Needs Decision modal reliable for ordinary keyboard and mobile use
without turning it into a broad accessibility redesign.

Context:
- UX-003 flags that a zero-count Needs Decision button can still open retained
  same-day decided rows, which may read as broken.
- UX-018 flags possible missing focus trap and focus restoration.
- UX-021 flags ambiguity around whether same-day retained rows are specifically
  Needs-decision-origin rows or any prior-day row resolved today.
- The adjusted posture prioritizes close behavior, focus return, and factual
  state clarity over exhaustive screen-reader tuning.

Acceptance criteria:
- Confirm the modal can be opened, used, and closed on desktop and mobile.
- Ensure `Escape` and the visible close action work consistently.
- Return focus to the Needs Decision launcher after close when the launcher
  remains mounted.
- Add a simple focus trap only if testing confirms keyboard users can tab into
  obscured page content or lose operational context.
- Clarify the zero-count retained-row state if users read it as empty or
  broken. Prefer concise label/state copy over adding a new modal section.
- Decide and document whether same-day retention includes only rows decided
  inside Needs Decision or any prior-day row resolved today.
- Keep Needs decision as a derived UI group, not a stored status.
- Do not add a past-history route, bulk decision flow, dashboard, stored missed
  status, or automatic status changes.

Suggested files:
- `components/timeline/NeedsDecisionDialog.tsx`
- `components/timeline/Timeline.tsx`
- `lib/resolvers/timeline.resolver.ts` if retention semantics change
- `lib/services/timeline.service.ts` if retention semantics change
- `tests/timeline.resolver.test.ts` if resolver behavior changes
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused Timeline resolver/component tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check Needs Decision at desktop, 390px, keyboard-only smoke, and 200
  percent zoom.
- Run `npm run design-system:check` if reusable UI or design inventory changes.

---

## Ticket 053: Browser reminder readiness clarity

Separate reminder intent from delivery readiness so users understand permission,
subscription, and behavior-level reminder state.

Context:
- UX-005 flags browser permission recovery paths.
- UX-014 and UX-024 flag that notification permission can look complete even
  when a saved push subscription is missing or unverified on revisit.
- UX-025 flags that behavior-level browser reminders can overpromise delivery.
- UX-026 flags that clicking a browser notification may focus the wrong page.

Acceptance criteria:
- Distinguish, in concise UI state, between:
  - browser notification support,
  - browser permission,
  - saved active push subscription,
  - per-behavior browser reminder intent.
- Show saved subscription state on Settings revisit if the data is available
  without adding heavy polling or provider complexity.
- Make behavior-level browser reminder copy clear that delivery requires global
  browser permission and a saved subscription.
- Keep browser reminders enabled by default at the behavior level.
- Keep email reminders opt-in per behavior.
- Ensure clicking a reminder notification focuses or opens the intended
  Timeline URL instead of leaving the user on an unrelated same-origin page.
- Keep tracking usable when push is unavailable, denied, blocked, expired, or
  failed.
- Do not add provider test-send buttons, reminder dashboards, notification
  troubleshooting wizards, or PWA/offline behavior.

Suggested files:
- `app/(app)/settings/page.tsx`
- Settings notification components, if split from the page
- `components/behaviors/ReminderEditor.tsx`
- `public/push-service-worker.js`
- `lib/services/push-subscription.service.ts` if page data needs saved state
- `lib/db/pushSubscriptions.repo.ts` if page data needs saved state
- `docs/NOTIFICATION_SPEC.md`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused push subscription/reminder tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check `/settings#notifications` and behavior reminder controls at
  desktop and around 390px.
- Test at least allowed, denied, and unavailable/unsupported notification
  states where practical. Do not send real emails without explicit recipient
  approval.

---

## Ticket 054: Later correction and review discoverability

Clarify deliberate correction paths without turning Timeline into a history
browser or Analytics into a dense dashboard.

Context:
- UX-004 flags that behavior heatmap interactivity may be undiscoverable.
- UX-022 flags that the resolver supports returning to Unresolved, but the UI
  exposes only Completed and Not Completed corrections.
- UX-023 flags that the selected-day correction area heading is too vague.
- Ticket 033 already scopes Analytics selected-day occurrence correction; this
  ticket should refine discoverability and decide any remaining correction
  model gaps.

Acceptance criteria:
- Verify discovery of behavior/date review from behavior heatmap cells through
  realistic owner-approved agent proxy browser walkthrough(s) without
  prompting, with structured, documented evidence clearly labeled as not
  real-user evidence. Human TS07 testing remains the future requirement before
  claiming externally validated discoverability.
- Improve information scent for actionable behavior heatmap cells if needed,
  without making the overall passive calendar look actionable.
- Rename vague selected-day review copy if needed, for example toward `Review
  selected day` or similarly explicit date-specific language.
- Decide whether v1 should expose `Clear decision` back to Unresolved in
  Timeline, Needs Decision, or later review. If yes, update product docs before
  implementation and add service/UI tests.
- Preserve manual status language: Unresolved, Completed, Not Completed.
- Preserve Needs decision as the stronger prompt for prior-day unresolved
  occurrences.
- Do not add a global history route, all-time occurrence search, bulk edit,
  automatic correction suggestions, AI coaching, or streak/gamification
  language.

Suggested files:
- `components/behaviors/BehaviorList.tsx`
- Analytics or behavior review components currently owning selected-day review
- `lib/resolvers/analytics.resolver.ts` only if data contracts change
- `lib/resolvers/status.resolver.ts` only if Clear decision behavior changes
- `tests/analytics.resolver.test.ts`
- `tests/status.resolver.test.ts` if status transitions change
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/PRODUCT_SPEC.md` if status correction scope changes
- `STATUS.md`

Verification:
- Run focused Analytics/status tests first when code changes.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check the relevant review path at desktop and around 390px.
- Run `npm run design-system:check` if reusable UI or design inventory changes.

---

## Ticket 055: Portability flow comprehension hardening

Make export, import, and restore choices easier to understand at the moments
where confusion can cause unsafe data decisions.

Context:
- UX-006 flags that users may not know which export format to choose.
- UX-007 flags that import and restore density is necessary but high risk.
- UX-029 through UX-033 flag restore history, import preview binding, full JSON
  backup labeling, hidden import details, and sensitivity summary clarity.
- Cadence's portability posture depends on users trusting these flows.

Acceptance criteria:
- Add concise task-based guidance for export formats:
  - spreadsheet review,
  - full backup,
  - BehaviorLog portability,
  - Markdown summary.
- Verify whether Full JSON backup includes status event history. If not, revise
  label/copy or docs so BehaviorLog is clearly the complete interoperability
  and restore-oriented path.
- Reproduce whether restore previews can appear as `Open` after completion and
  fix status/timestamp handling if confirmed.
- Bind import apply to the exact persisted accepted `merge_preview` run and its
  bundle, local-data, and combined preview fingerprints. Apply must reject
  stale, altered, mismatched, or unaccepted preview data rather than silently
  recomputing a replacement plan, and the applied run must retain an auditable
  accepted-preview link and fingerprint.
- Surface unsupported fields, intervention counts, sensitivity counts, and
  redaction summaries enough for a user to make an informed import/restore
  decision.
- Keep high-risk flows explicit and auditable, with stale-preview refusal and
  destructive-action confirmation preserved.
- Do not add broad restore automation, hidden destructive writes, provider
  sends, admin repair tools, AI interpretation, or new product data categories
  outside existing BehaviorLog import/restore scope.

Suggested files:
- `components/export/*`
- `app/(app)/export/actions.ts`
- `lib/services/behaviorlog-import.service.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/services/behaviorlog-restore.service.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/resolvers/behaviorlog-restore.resolver.ts`
- focused import/restore/export tests
- `docs/EXPORT_FORMATS.md`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `STATUS.md`

Verification:
- Run focused export/import/restore tests first.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser-check `/export` at desktop and around 390px with valid, invalid,
  warning-heavy, and destructive-preview fixtures.
- Browser-check import preview/apply with fixture data, including stale-preview
  rejection and a valid accepted-preview success case.
- Do not apply a destructive restore against the user's real account during QA.

---

## Ticket 056: Public trust and marketing comprehension

Tighten public-facing trust, legal, and BehaviorLog explanation paths without
expanding the marketing surface beyond the current launch scope.

Context:
- UX-001 flags that first-time users may not understand BehaviorLog before they
  have data.
- UX-009 flags that Terms, Privacy, and Trust appear late in the pre-auth
  journey.
- UX-010 flags that public legal pages lack a clear marketing return path.
- UX-011 flags that Trust copy may understate the implemented RLS-backed
  account-isolation posture.
- UX-012 flags that marketing machine-file links may omit `/docs.md`.

Acceptance criteria:
- Test whether marketing users can explain Cadence and BehaviorLog in their
  own words before sign-in. Owner-approved agent-driven browser persona
  walkthroughs are accepted proxy evidence for this ticket, but must be
  labeled as proxy testing rather than real-user evidence and retain a future
  human-validation follow-up before any externally validated claim.
- Add low-priority footer access to Terms, Privacy, and Trust from marketing if
  users look for trust material before clicking Log in.
- Add a clear Cadence overview return path from public legal/trust pages if
  users expect it.
- Tune Trust copy so account isolation is factual and confidence-building
  without overclaiming support, security guarantees, or provider behavior.
- Verify marketing `/docs` machine-readable file index includes generated
  Markdown mirrors such as `/docs.md` when those files exist.
- Preserve the narrow marketing navigation model and avoid turning legal pages
  into marketing-heavy landing pages.
- Do not add analytics cookies, tracking scripts, billing language, desktop or
  mobile promises, AI coaching claims, social positioning, or admin/support
  surfaces.

Suggested files:
- `apps/marketing/*`
- public legal/trust route files
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/CRAWL_POLICY.md`
- `docs/USER_FLOWS.md`
- `docs/UI_SPEC.md`
- `STATUS.md`

Verification:
- Run `npm run marketing:build`.
- Run `npm run marketing:check`.
- Run `npm run agents:check`.
- Run the standard app checks if public legal/trust routes in the Next.js app
  change.

---

## Ticket 057: Behavior title and description history export context

Capture append-only history for behavior title and description changes so
exports can preserve how the user's definition of a behavior changed over time.

Context:
- Promoted from `docs/FEATURE_IDEAS.md` "Behavior Title And Description
  History".
- `behaviors.title` and `behaviors.description` currently store only the latest
  behavior definition.
- `behaviors.updated_at` proves the row changed, but does not record which
  fields changed or what the prior values were.
- App-native and BehaviorLog exports currently include behavior title and
  description snapshots, not a first-class behavior-definition revision trail.
- The goal is export and agent context first, not an in-app revision browser.

Acceptance criteria:
- Add a Supabase migration for an append-only user-owned behavior definition
  history table, such as `behavior_definition_events`.
- The table must include `user_id`, `behavior_id`, prior and next title and
  description values, changed field names, `recorded_at`, source metadata, and
  timestamps.
- The table must have RLS policies and explicit authenticated Data API grants
  matching the repository's current Supabase posture.
- Backfill one baseline event for existing behaviors so exports have a starting
  definition. Use `behaviors.created_at` as the baseline `recorded_at` unless a
  better existing timestamp is available.
- On behavior create, write an initial definition event.
- On behavior edit, append an event only when the normalized title or
  description changes. Schedule, reminder, category, archive, or timezone-only
  edits must not create definition events.
- Preserve current behavior CRUD behavior and occurrence sync semantics.
- Keep event planning resolver-first: add a small pure resolver or equivalent
  pure planning function for behavior definition event creation, and update
  `docs/AGENT_RESOLVERS.md` if a new resolver is introduced.
- Add repository and service paths for reading/writing definition events without
  querying Supabase from UI components.
- Include behavior definition history in export context:
  - Full JSON backup should include the history records.
  - BehaviorLog bundle should include the history as a Cadence extension or
    optional app-specific file without violating the BehaviorLog core schema.
  - Markdown AI summary should mention that definition history exists when
    included, and should give agents guidance to account for behavior renames
    or description changes.
- Add import/restore planning notes or implementation for the new export shape.
  If full import/restore support is too large for this ticket, document the
  limitation clearly in `docs/EXPORT_FORMATS.md` and the export UI copy.
- Historical title and description text can be sensitive. Add an explicit
  privacy decision in docs about whether definition history is included by
  default or behind a separate export option.
- Update `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/USER_FLOWS.md`, and `docs/FEATURE_IDEAS.md` as needed.
- Add focused tests for create, edit, no-op edit, schedule-only edit, export
  formatting, RLS/static policy coverage, and resolver/event planning.
- Do not add multi-user audit logs, approval workflows, AI-generated behavior
  rewrites, automatic behavior splitting/merging, or broad account activity
  logs.

Settled implementation decisions:
- Full JSON and BehaviorLog include behavior definition history by default;
  there is no separate history option.
- Events include full previous/next title and description text plus canonical
  `changed_fields`; the exporter does not synthesize a text diff.
- `reason` support is schema-only for normal Behavior form changes. Import and
  restore paths may record machine-readable provenance.
- Import and restore create local baselines or transitions from the current
  exported definition. They validate but do not replay the earlier
  Cadence-specific revision trail.

Suggested files:
- `supabase/migrations/*`
- `docs/DATA_MODEL.md`
- `docs/EXPORT_FORMATS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/AGENT_RESOLVERS.md`
- `lib/db/database.types.ts`
- `lib/db/*behavior*`
- `lib/services/behavior.service.ts`
- `lib/resolvers/*behavior*`
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `components/export/*`
- `tests/*behavior*`
- `tests/export.resolver.test.ts`
- RLS/static policy tests
- `STATUS.md`

Verification:
- Run `npm run supabase -- db reset` after the migration.
- Regenerate database types.
- Run focused behavior/history/export tests.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.

---

## Ticket 058: Status timestamp and status history export hardening

Harden status timestamp and status-history capture, then make sure the history
is available as useful export context for agents.

Context:
- Promoted from `docs/FEATURE_IDEAS.md` "Status Action Capture And Correction
  History".
- Current occurrence snapshots already store `status_marked_at` and
  `completed_at`.
- Current `occurrence_status_events` rows store append-only status history for
  first marks, corrections, unmarking back to Unresolved, source metadata,
  confidence, and `revises_event_id`.
- BehaviorLog exports already treat `status_events.jsonl` as the status-history
  authority.
- This ticket should audit, close gaps, and make the status-history context
  consistently available. It should not create a new status vocabulary or a
  user-facing audit log unless explicitly scoped later.

Acceptance criteria:
- Audit the current manual status flow from Timeline, Behaviors review, import,
  restore, export, and tests.
- Confirm or fix that every explicit status change appends one
  `occurrence_status_events` row:
  - Unresolved to Completed,
  - Unresolved to Not Completed,
  - Completed to Not Completed,
  - Not Completed to Completed,
  - resolved status back to Unresolved.
- Confirm repeated taps of the already-current resolved status do not create
  duplicate status events.
- Confirm note-only edits do not mutate status timestamps or create status
  events.
- Confirm `completed_at` means completion timestamp for current Completed
  snapshots, while `status_marked_at` means latest current-status mark time for
  the current snapshot.
- Confirm unmarking to Unresolved clears current snapshot timestamps but leaves
  the append-only event with its own `recorded_at`.
- Confirm corrections link to the latest prior event through `revises_event_id`
  when available.
- Confirm RLS and Data API grants keep `occurrence_status_events` append-only
  for normal authenticated app access.
- Close export gaps:
  - BehaviorLog bundle must include authoritative `data/status_events.jsonl`.
  - Full JSON backup includes occurrence status-event history in addition to
    unchanged current occurrence snapshots.
  - Markdown AI summary gives concise correction and logging guidance: use
    status events over current occurrence snapshots for correction, late-log,
    and adherence-timing analysis.
  - App-native JSONL/CSV should keep existing `status_marked_at` fields and
    should not silently imply that snapshots are full history.
- Add or update tests for timestamp preservation, correction history, unmarking,
  legacy resolved rows without status events, export context, and BehaviorLog
  conformance.
- Update `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/USER_FLOWS.md`, `docs/DECISIONS.md`, and `docs/FEATURE_IDEAS.md` where
  the hardened contract needs to be explicit.
- Do not add a `missed` status, automatic missed marking, AI coaching, broad
  audit-log UI, or status-history editing.

Settled implementation decisions:
- Full JSON includes `occurrence_status_events` as an additive
  `status_events` root array; BehaviorLog remains the interoperable and
  restore-oriented format.
- Markdown includes concise static correction and logging guidance.
- Status history remains export/context only; this ticket adds no UI surface.
- No future source values are added. Existing source-capture fields retain an
  extension path for a later scoped feature.

Suggested files:
- `docs/DATA_MODEL.md`
- `docs/EXPORT_FORMATS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/DECISIONS.md`
- `lib/resolvers/status.resolver.ts`
- `lib/services/occurrence.service.ts`
- `lib/db/occurrenceStatusEvents.repo.ts`
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `components/export/*`
- `tests/status.resolver.test.ts`
- `tests/occurrence.service.test.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- RLS/static policy tests
- `STATUS.md`

Verification:
- Run focused status, occurrence service, export, and BehaviorLog conformance
  tests first.
- If schema or RLS changes are needed, run `npm run supabase -- db reset` and
  regenerate database types.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.

---

## Ticket 059: BehaviorLog restore apply for Cadence schedule IDs

Make destructive restore apply work for BehaviorLog bundles exported by Cadence
itself when schedule records use stable BehaviorLog external IDs such as
`sch_<uuid>` instead of local database UUIDs.

Context:
- Follow-up hosted browser QA on 2026-07-09 exported a real Cadence
  `.behaviorlog.zip` bundle, accepted it in restore preview, and successfully
  applied the same bundle through create-only import into a second disposable
  account.
- Destructive restore apply stayed disabled because the restore preview
  contained skipped actions. The confirmed compatibility issue is that Cadence
  export emits `data/schedules.jsonl` `schedule_id` values like `sch_<uuid>`,
  while the restore apply payload builder currently requires schedule IDs to be
  database UUIDs when an accepted preview action has no existing local ID.
- `sch_<uuid>` is a valid BehaviorLog external identifier. The restore path
  should map external schedule IDs to safe local UUID schedule-slot IDs instead
  of changing the export format to make schedule IDs look like database IDs.

Acceptance criteria:
- Add a regression fixture or test path using a Cadence-generated BehaviorLog
  bundle with:
  - at least one `data/schedules.jsonl` row whose `schedule_id` is
    `sch_<uuid>`,
  - at least one occurrence that references that schedule,
  - at least one status event for the occurrence.
- Restore preview must not classify schedules, occurrences, status events, or
  notes as skipped solely because the referenced schedule ID is a non-UUID
  BehaviorLog external ID.
- Restore apply must generate or resolve safe local UUIDs for schedule-slot
  rows when accepted preview actions lack a local ID, then use those mapped
  UUIDs for occurrence `behavior_schedule_slot_id` values.
- Preserve the original BehaviorLog external schedule IDs in import/restore
  provenance so later import, merge, or restore previews can map
  `sch_<uuid>` back to the restored local schedule slot.
- Applying the same accepted restore run must remain idempotent.
- Keep the existing restore gates intact:
  - accepted `restore_preview` run,
  - matching preview fingerprint,
  - matching local-data fingerprint,
  - typed `RESTORE` confirmation,
  - fresh-backup acknowledgement,
  - sensitivity acknowledgement when needed,
  - no validation errors,
  - no skipped or unsupported restore actions.
- Keep restore apply transaction-scoped and user-owned. Do not bypass Supabase
  RLS expectations, widen RPC execute privileges, or perform direct hosted
  database edits.
- Update any misleading user-facing error copy that currently suggests a
  Cadence-generated BehaviorLog backup should avoid this failure.
- Update docs if the restore compatibility contract or provenance behavior
  becomes more explicit.
- Do not change BehaviorLog export schedule IDs just to satisfy restore apply.
- Do not add category restore, provider sends, reminder scheduling, PWA/offline
  behavior, broad restore automation, hidden destructive writes, AI
  interpretation, or new product data categories.

Suggested files:
- `lib/services/behaviorlog-restore.service.ts`
- `lib/resolvers/behaviorlog-restore.resolver.ts` if preview skip behavior
  changes
- `lib/services/behaviorlog-import.service.ts` or import mapping helpers if
  restore provenance should reuse existing mapping utilities
- `supabase/migrations/*` only if the restore RPC payload or mapping writes
  need database changes
- `lib/db/database.types.ts` if schema or RPC types change
- `docs/EXPORT_FORMATS.md`
- `docs/USER_FLOWS.md`
- `docs/DATA_MODEL.md` if provenance persistence changes
- `tests/behaviorlog-restore.service.test.ts`
- `tests/behaviorlog-restore-apply.service.test.ts`
- `tests/behaviorlog-restore.resolver.test.ts` if resolver behavior changes
- `tests/behaviorlog-conformance.test.ts` if export/restore fixture
  generation changes
- RLS/static policy tests if schema or privileges change
- `STATUS.md`

Verification:
- Run focused restore preview/apply tests first, including the new
  Cadence-exported `sch_<uuid>` regression.
- If schema, RPC, RLS, grants, or migrations change, run
  `npm run supabase -- db reset` and regenerate database types.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Browser QA `/export` with disposable hosted or local test-login accounts:
  export a BehaviorLog bundle from one account, restore-preview it in another
  account, verify the apply controls unlock only after all restore gates are
  satisfied, and apply only against disposable data.
- After browser QA, delete disposable accounts or data and run the appropriate
  test-login cleanup command when test-login users were used.

---

## Ticket 060: Schedule integrity and missing occurrence repair

Repair empty behavior schedules, restore the occurrences they suppressed, and
prevent occurrence sync from silently treating structurally invalid schedules
as fresh.

Context:
- A read-only hosted investigation on 2026-07-17 found one active weekly
  behavior whose `behavior_schedules` parent was valid but had no
  `behavior_schedule_slots` child. The compatibility columns on `behaviors`
  still held its Friday recurrence and 11:30 AM time, so the Behaviors UI
  synthesized a valid-looking editor row while occurrence generation produced
  no rows.
- The affected behavior has one preserved Completed occurrence on 2026-06-26.
  Its scheduled 2026-07-03, 2026-07-10, and 2026-07-17 occurrences were absent
  rather than stored as Unresolved. Any additional scheduled dates that pass
  before this ticket is deployed must be detected from recurrence, not listed
  manually.
- Account occurrence sync still recorded a fresh 30-day horizon even though
  this behavior produced no plan. Needs decision and the behavior heatmap were
  downstream symptoms of missing occurrence rows, not Timeline or analytics
  grouping defects.
- The hosted audit found 36 behaviors, 37 schedules, and 36 slots. Only one of
  27 active behaviors had an empty schedule. One archived behavior also had an
  empty schedule. No orphaned or cross-owner schedule-slot links were found,
  all relevant tables had RLS enabled, and hosted migration history matched
  the repository.
- `20260626140000_add_behavior_schedules.sql` backfilled schedule parents and
  attached existing legacy slots, but it did not create a compatibility slot
  when an older behavior had no slot row. Current behavior create/update also
  commits the behavior/definition write separately from schedule replacement,
  so a failed follow-on schedule write can still leave a partial graph.

Implementation order:
1. Add failing resolver/service and migration regression fixtures for a single
   empty legacy schedule, a multi-schedule graph with one empty schedule, and a
   schedule-write failure after the behavior write.
2. Add a git-tracked, idempotent Supabase migration that repairs every empty
   schedule from its owning behavior's compatibility recurrence/time fields;
   do not hardcode hosted behavior, user, schedule, or occurrence IDs.
3. In the same repair contract, insert only genuinely missing scheduled
   occurrences for repaired active schedules from their stable local anchor
   through the normal future horizon. Preserve all existing occurrences and
   statuses. Mark affected account sync state stale so normal reminder
   planning and horizon verification run afterward.
4. Harden occurrence schedule normalization and freshness decisions so an
   active schedule with no time entry cannot produce an empty plan and then be
   recorded as fresh.
5. Move manual behavior create/update plus definition-event, schedule-parent,
   schedule-slot, and occurrence-sync-stale writes behind owner-scoped atomic
   database functions. Keep repositories responsible for persistence and
   resolvers responsible for planning/validation.
6. Update contracts, generated database types, drift checks, and operational
   deployment notes. Verify locally before requesting authorization for hosted
   migration deployment.

Acceptance criteria:

Data repair:
- Create the migration with `npm run supabase -- migration new
  <descriptive_name>`; do not invent a filename or edit the hosted database
  directly.
- Before adding any stricter write guard, identify every
  `behavior_schedules` row with zero owned `behavior_schedule_slots` rows.
- For each empty schedule, insert one exact-time compatibility slot using:
  - the same `user_id` and `behavior_id`,
  - the empty schedule's `id` as `behavior_schedule_id`,
  - `behaviors.scheduled_time` as `start_time`,
  - `kind = 'exact'`, `preset = null`, `end_time = null`, and
    `sort_order = 0`.
- The slot backfill must be idempotent and owner-consistent. Existing valid
  schedules and slots must remain byte-for-byte unchanged except for normal
  trigger timestamps on rows intentionally updated by the migration.
- Repair missing occurrences only for schedules repaired by this migration.
  Recurrence expansion must match the existing recurrence resolver for daily,
  every-N-days, weekly/every-N-weeks, and monthly-last-day rules in the
  behavior timezone.
- Use the behavior's stable local creation date as the interval anchor unless
  a more specific existing anchor contract is present. Do not parse local
  dates through JavaScript `Date` or use the database/server timezone as the
  behavior timezone.
- Insert missing occurrences idempotently with the repaired slot snapshot and
  stored status `unresolved`. Do not update, delete, relabel, or recreate any
  existing occurrence, including the preserved 2026-06-26 Completed row.
- The known 2026-07-03, 2026-07-10, and 2026-07-17 Friday instances must exist
  after repair. Also generate any later scheduled instances that become due
  before deployment and maintain the documented 30-day future horizon.
- Repaired historical rows must have no synthetic completion timestamps and
  no fabricated status-history events. They must enter Needs decision through
  the existing derived `unresolved` plus prior-`local_date` rule.
- Do not create, send, or retry reminders for past repaired occurrences.
  Normal resolver/service reminder planning may create pending deliveries only
  for still-eligible future occurrences after the account is marked stale and
  resynced.
- The archived empty schedule may receive its missing compatibility slot, but
  it must not generate new occurrences or reminders while archived.
- Record aggregate, privacy-safe migration verification counts only. Do not
  put hosted user IDs, emails, behavior IDs, schedule IDs, occurrence IDs, or
  private notes in committed docs or logs.

Runtime integrity and sync freshness:
- `lib/services/occurrence.service.ts` must not filter an active empty schedule
  into a successful no-op plan.
- Define one explicit normalization result for schedule graphs, including a
  typed invalid-schedule outcome. Do not let UI fallback rendering become the
  occurrence-generation source of truth.
- A single legacy-compatible empty schedule may use the behavior compatibility
  fields only through the documented normalization/repair path. An ambiguous
  graph, including one empty schedule among multiple schedules, must fail
  loudly, keep `occurrence_sync_state.stale = true`, and surface a safe error
  instead of marking the horizon fresh.
- `markOccurrenceSyncFreshForPlans` may run only after every active behavior
  has at least one valid schedule time entry and all planned occurrence writes
  have succeeded.
- A failed generation, schedule validation, occurrence write, or reminder-plan
  write must not leave a false fresh horizon. Preserve the original error while
  best-effort marking sync state `sync_failed`.
- Keep recurrence generation and repair planning resolver-first. UI, API
  routes, repositories, SQL query layers, and reminder adapters must not
  duplicate ongoing recurrence rules. Any SQL recurrence expansion used only
  for the one-time migration must have parity fixtures against
  `recurrence.resolver.ts` for every supported recurrence type and DST/local
  date boundary relevant to the repaired data.

Atomic behavior schedule writes:
- Manual behavior create must commit or roll back the behavior row, initial
  definition event, all schedule parents, all schedule slots, and stale sync
  state as one owner-scoped transaction.
- Manual behavior update, including schedule-only edits, must commit or roll
  back the behavior definition/category/reminder fields, optional definition
  event, complete schedule graph replacement, and stale sync state as one
  owner-scoped transaction.
- Validate in the transaction that there is at least one schedule and at least
  one time entry for every schedule. Reject empty, duplicate, malformed,
  cross-owner, or stale schedule graphs before any partial product write is
  committed.
- Preserve the existing stale-definition/ABA guards and definition-event no-op
  behavior. Schedule-only edits must not append definition-history events.
- Database functions must validate `auth.uid()`, pin a safe `search_path`, use
  minimum required privileges, and have explicit `EXECUTE` grants/revokes.
  Do not add a general service-role bypass or broaden table access.
- Document and test a deployment sequence that does not strand the currently
  deployed app between an RPC/schema migration and the application code that
  calls it. Any temporary compatibility fallback must be narrow, observable,
  and removed or explicitly ticketed for removal after rollout.

Verification and hosted proof:
- Add resolver tests proving weekly Friday generation for the repaired shape,
  every supported recurrence type, interval anchoring, monthly day-31
  fallback, timezone boundaries, idempotence, and existing-status
  preservation.
- Add service/repository tests proving an empty or ambiguous schedule cannot be
  marked fresh, write failures leave sync stale, and valid schedules retain
  current generation behavior.
- Add database/RPC tests proving behavior create/update schedule writes are
  atomic, cross-owner calls fail, stale writes fail, and a forced schedule-slot
  failure rolls back the behavior and definition event.
- Add migration tests with at least:
  - the confirmed weekly Friday empty-schedule shape,
  - one archived empty schedule,
  - one valid schedule that must remain untouched,
  - one pre-existing Completed occurrence,
  - one pre-existing Unresolved occurrence,
  - an idempotent second repair run.
- Run `npm run supabase -- db reset` from a clean local database and regenerate
  `lib/db/database.types.ts` after schema/RPC changes.
- Run a rollback-only local SQL smoke for repair counts, atomic create/update,
  RLS ownership refusal, and idempotent replay.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Before hosted mutation, require explicit owner authorization, confirm local
  and hosted migration histories, and create a fresh user-owned export/backup.
- Deploy only through `npm run supabase -- db push`; do not use Dashboard SQL
  or Table Editor repairs.
- After hosted deployment, run the occurrence sync/reminder planning path once
  for affected stale accounts, then verify with privacy-safe aggregate queries:
  - zero active empty schedules,
  - zero cross-owner/orphan schedule slots,
  - the preserved Completed occurrence is unchanged,
  - all expected repaired occurrences exist exactly once,
  - prior repaired occurrences are Unresolved and counted by Needs decision,
  - the current/future Friday occurrences appear on Timeline,
  - no past reminder deliveries were created,
  - the account's fresh horizon is recorded only after successful repair.
- Browser QA the affected production account at `/timeline` and `/behaviors`:
  verify Needs decision, current/future occurrences, heatmap/review visibility,
  status actions, and no duplicate rows. Do not alter the preserved Completed
  occurrence during QA.
- Re-run hosted migration-list congruence and the Supabase security advisor
  after deployment. Classify unrelated pre-existing advisor warnings
  separately rather than expanding this ticket.

Documentation updates required during implementation:
- `docs/DATA_MODEL.md`: make the non-empty schedule invariant, atomic write
  boundary, compatibility fallback, and repair behavior explicit.
- `docs/RECURRENCE_RULES.md`: define repair range/anchor semantics and confirm
  that prior missing occurrences remain Unresolved rather than being marked
  automatically.
- `docs/AGENT_RESOLVERS.md`: record schedule normalization/repair ownership and
  the rule that freshness cannot bypass invalid schedules.
- `docs/SUPABASE_WORKFLOW.md` or `docs/OPERATIONS.md`: record the gated hosted
  repair and post-deploy verification sequence if it is reusable.
- `STATUS.md`: mark Ticket 060 in progress before implementation and record
  sanitized repair counts, verification, deployment, and remaining risk when
  complete.

Suggested files:
- `supabase/migrations/*`
- `lib/db/behaviors.repo.ts`
- `lib/db/occurrences.repo.ts`
- `lib/db/occurrenceSyncState.repo.ts`
- `lib/db/behaviorDefinitionEvents.repo.ts`
- `lib/services/behavior.service.ts`
- `lib/services/occurrence.service.ts`
- `lib/services/occurrence-sync-state.service.ts`
- `lib/resolvers/occurrence.resolver.ts`
- `lib/resolvers/recurrence.resolver.ts` only if a reusable range contract is
  required; do not change supported recurrence semantics
- `lib/services/behavior-form.ts` for server-side schedule graph validation
- `lib/db/database.types.ts`
- `tests/behavior-create.service.test.ts`
- `tests/behavior-definition.service.test.ts`
- `tests/occurrence.resolver.test.ts`
- `tests/occurrence.service.test.ts`
- `tests/occurrence-sync-state.service.test.ts`
- `tests/recurrence.resolver.test.ts`
- new focused migration/RPC tests under `tests/`
- `docs/DATA_MODEL.md`
- `docs/RECURRENCE_RULES.md`
- `docs/AGENT_RESOLVERS.md`
- `docs/SUPABASE_WORKFLOW.md` or `docs/OPERATIONS.md`
- `STATUS.md`

Out of scope:
- New stored statuses, automatic Not Completed/missed decisions, bulk status
  actions, admin repair dashboards, user-facing database diagnostics, schedule
  history reconstruction, reminder sends for past occurrences, calendar sync,
  PWA/offline work, AI coaching, or unrelated Supabase advisor cleanup.

---

## Ticket 061: Export prompt library for external AI analysis

Add a copyable prompt library to the Export & Import screen so users can hand
a Cadence export to their own AI assistant with prompts that use the full
breadth of exported data correctly.

Context:
- Promoted from `docs/FEATURE_IDEAS.md` "Export Prompt Library For External AI
  Analysis".
- Exports already carry more analyzable structure than most users will think
  to ask about: occurrence snapshots, append-only `status_events` with
  `recorded_at`, `effective_at`, and `revises_event_id`, behavior definition
  history, schedules and time slots, categories, opt-in occurrence notes, and
  reminder delivery records in BehaviorLog `data/interventions.jsonl`.
- The Markdown AI summary already teaches agents core semantics (snapshots vs
  status history, Unresolved is not failure). The prompt library is the
  user-facing counterpart: ready-made questions that respect those semantics.

Product decisions for this ticket:
- V1 templates are static text. No template is generated from user data and no
  template interpolates per-user values. The selected export already carries
  the range.
- Templates stay provider-generic. They may reference "your calendar, email,
  sleep, or location context your assistant already has" but must not name
  external services or imply Cadence connects to them.
- Prompt templates are UI-only. They are not added to exported bundles, the
  BehaviorLog manifest, or the AI summary in this ticket.
- Every template that touches status data must encode the core semantics:
  Unresolved is missing decision data rather than failure, occurrence rows are
  current snapshots, `status_events` is the correction/chronology source of
  truth, and local analysis uses `local_date` plus the IANA timezone.
- Templates that depend on optional data (notes, interventions, definition
  history) must say which export option or format provides it, so users are
  not confused when a JSONL/CSV export lacks that data.

Prompt template set (final copy authored during implementation; each template
must cover the listed intent and data grounding):

1. Notes-explained failures: find recurring reasons in occurrence notes for
   Not Completed occurrences, cluster them into themes, and rank themes by
   frequency and by which behaviors they affect. Requires include-notes.
2. Weekday and time-of-day dips: compare adherence by weekday and by schedule
   slot label to find systematic low windows, using `local_date` and the
   exported timezone rather than UTC.
3. Category comparison: compare adherence and Unresolved counts across
   categories and identify which category carries the most undecided
   occurrences rather than the most failures.
4. Logging chronology and batching: use `status_events.recorded_at` versus
   occurrence scheduled times to determine whether decisions are logged near
   the occurrence or batched later, and whether batching correlates with more
   Not Completed or corrected decisions.
5. Correction patterns: follow `revises_event_id` chains to find which
   behaviors get corrected most, in which direction, and how long after the
   first decision corrections happen.
6. Reminder effectiveness: using BehaviorLog `data/interventions.jsonl`,
   compare resolution and completion on occurrences with delivered reminders
   versus without, split by channel, without treating correlation as proof.
7. Definition drift: use behavior definition history to segment a behavior's
   occurrences by definition period before comparing adherence across time,
   instead of treating a renamed behavior as one unchanged behavior.
8. Decision debt: profile Unresolved occurrences by behavior and age to show
   where Needs decision items accumulate, treating them as missing data and
   suggesting which behaviors need an easier decision moment.
9. Schedule load and overcommitment: relate the number of scheduled
   occurrences per day to that day's adherence and identify whether heavier
   days degrade completion, suggesting candidates to reschedule or drop.
10. Behavior lifecycle: compare each behavior's early adherence after creation
    (using its baseline definition event time) against later periods to
    detect novelty decay or slow-start patterns.
11. Realistic timing: where `effective_at` is present, compare stated
    completion times against scheduled times and suggest schedule times that
    match when the user actually does the behavior.
12. Cross-source context: ask the user's own assistant to compare adherence
    dips against calendar, travel, sleep, or similar context it already has
    access to, explicitly scoped to user-approved sources and with Cadence
    data as the adherence source of truth.

Acceptance criteria:

UI structure and design conventions (per `DESIGN.md` and the existing
`components/export/ExportPanel.tsx` vocabulary):
- The prompt library renders as one more subsection of the Export
  super-section, after AI summary, inside the existing `gap-8` subsection
  stack: `text-xl leading-tight` heading ("Analysis prompts" or similar
  factual label), with an `mt-2`/`mt-3` muted intro (`text-sm
  text-muted-readable`, `max-w-3xl`) explaining that prompts are copied into
  the user's own external assistant alongside an export.
- The sensitivity disclosure is one plain muted sentence in that intro area,
  matching the Downloads section's existing definition-history note. No
  warning boxes, no Rust Signal (informational, not caution), no icons
  (Export page controls remain icon-free).
- The twelve templates render as unboxed list rows separated by single inner
  1px Ash Line dividers (`divide-y`, no outer border, per the
  One-Line-Per-Boundary Rule) at the 16px airy row tier used by export
  download rows.
- Each row is a native `details`/`summary` disclosure using the shared
  disclosure-trigger class, per the product's standard disclosure pattern.
  Collapsed rows show the template title (`text-sm font-bold
  text-foreground`) and a one-line muted purpose sentence, mirroring the
  download rows' label/description rhythm.
- Expanded content shows: a muted requirements line stating which export
  format and options the prompt needs (sentence case, factual), the full
  prompt text in a bordered Cold Surface preformatted panel matching the AI
  summary preview treatment (`border border-line bg-surface p-4 text-sm
  whitespace-pre-wrap`), and a Copy prompt control.
- Copy prompt uses the underlined text-action vocabulary
  (`product-action`, min 44px tap target on mobile) and the
  MarkdownSummaryActions clipboard pattern: async clipboard write with an
  adjacent `aria-live="polite"` status showing Copied or Copy unavailable.
  No filled or boxed button chrome.
- Square corners, no shadows, no new colors, IBM Plex Sans only; body and
  helper copy in sentence case per the Uppercase Limit Rule. The section
  stacks single-column on mobile like the rest of the Export screen.
- Template content is defined in one typed module, not inline in the panel
  component, so copy review and future reuse stay simple.
- All templates use Cadence status vocabulary exactly: Unresolved, Completed,
  Not Completed, Needs decision.
- No database schema, migration, export resolver output, or API route changes.
- Tests cover template invariants: required semantics phrases for
  status-touching templates, required format/option guidance for
  optional-data templates, no external service names, and stable template ids.
- Component tests cover render and copy behavior of the new section.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build`.

Documentation updates required during implementation:
- `docs/EXPORT_FORMATS.md`: add a prompt library section describing placement,
  static-template posture, and the sensitivity disclosure.
- `docs/UI_SPEC.md`: describe the Export & Import prompt library section.
- `DESIGN.md`: add the prompt library rows to the Export Panels component
  section.
- `docs/FEATURE_IDEAS.md`: mark the idea implemented by Ticket 061.
- `STATUS.md`: track progress and completion.

Suggested files:
- `lib/export-prompts.ts` (new typed template module)
- `components/export/PromptLibraryPanel.tsx` (new)
- `components/export/ExportPanel.tsx` or `app/(app)/export/page.tsx` for
  placement
- `tests/export-prompts.test.ts` (new)
- `docs/EXPORT_FORMATS.md`
- `docs/UI_SPEC.md`
- `DESIGN.md`
- `docs/FEATURE_IDEAS.md`
- `STATUS.md`

Out of scope:
- Prompt generation from user data, per-user interpolation, embedding prompts
  in exported bundles or the AI summary, in-app AI analysis or chat, direct
  integrations with calendar/email/wearables, provider-specific instructions,
  and any change to export content or adherence semantics.

---

## Ticket 062: Interaction audit P3 traceability and narrow-screen follow-up

Close the locally actionable P3 findings from the 2026-07-22 exhaustive
interaction audit without making the separate product decision about
account-specific onboarding dismissal.

Context:
- Tickets 001-061 are complete.
- The interaction-audit remediation pass intentionally stopped after P0-P2
  findings and preserved IA-024 through IA-028 as a research backlog.
- IA-024 is human-gated because changing the browser-local onboarding
  dismissal key to account-specific storage changes the product contract.
- IA-025 through IA-028 can be corrected locally without provider writes,
  schema changes, new routes, or product-scope expansion.

Scope:
- IA-025: align registered trigger and variant labels with the visible controls
  and the task-based user guides.
- IA-026: map `INT-MKT-010` to every source-inventory entry that implements it,
  including the marketing footer in `BaseLayout.astro`.
- IA-027: audit direct test-coverage declarations against the cited tests.
  Add focused UI assertions where they are small and valuable; otherwise
  classify coverage honestly as indirect or manual and cite the real evidence
  owner.
- IA-028: prevent the Settings Profile email from causing document-level
  horizontal overflow at the supported 320px minimum viewport.
- Reconcile stale status text for the already-deployed IA-002 migration and
  already-ready app and marketing deployments using read-only provider
  evidence.

Acceptance criteria:
- Registry labels name controls users can find verbatim, while grouped variants
  remain explicit where one interaction has multiple visible controls.
- The `BaseLayout.astro` source inventory includes `INT-MKT-010`.
- Every `direct` coverage declaration is backed by a cited test that renders or
  activates the registered interaction. Adjacent resolver, service, route, or
  artifact checks are labeled `indirect` unless a focused UI test closes the
  gap.
- Settings remains within a 320px viewport with a long account identifier and
  still follows the single-column Settings design contract.
- IA-024 remains unchanged and is recorded as the only product-decision-gated
  audit item.
- No database migration, hosted mutation, provider send, new route, stored
  status, or onboarding behavior change is introduced.
- Update `interaction-registry.json`, the interaction-audit remediation ledger,
  `docs/OPERATIONS.md`, and `STATUS.md` to match the verified current state.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run resolvers:check`, `npm run design-system:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, and `npm run build`.
- Run focused Settings/registry tests and inspect Settings at 320px and 390px
  when a local authenticated browser fixture is available. If browser QA is
  environment-blocked, record the exact limitation and retain automated layout
  evidence.

Out of scope:
- Deciding or implementing account-specific onboarding dismissal (IA-024),
  rewriting the frozen pre-remediation finding report, changing provider
  configuration, redeploying an already-ready production build, or expanding
  the product beyond the existing v1 surfaces.

---

## Ticket 063: Locust load-test contract and authenticated protocol spike

Establish the repository contract for registry-derived load testing and prove
that Locust can exercise Cadence's real authenticated HTTP paths without
adding a permanent product API for test traffic.

Context:
- Tickets 001-062 are complete.
- `interaction-registry.json` is the canonical inventory of implemented user
  interaction intents, while `docs/UX_JOURNEY_INVENTORY.md` and
  `docs/USER_FLOWS.md` define realistic journey order and success semantics.
- The live registry currently contains 85 interactions. Some interactions
  produce network traffic, while form drafts, disclosures, focus movement,
  clipboard writes, local preferences, browser permission prompts, and other
  client-only effects do not.
- Locust's `HttpUser` preserves cookies and makes HTTP requests but is not a
  browser: it does not render the page, execute Cadence client JavaScript, or
  automatically load page assets.
- Cadence mutations use Next.js Server Actions. Their generated action
  identifiers must not be hard-coded because they may change between builds.
- Ticket 062 already occupies the number originally proposed for this slice;
  the Locust roadmap therefore starts at Ticket 063.

Product and architecture decisions:
- Keep `interaction-registry.json` focused on user intent. Store HTTP
  workload metadata in a separate load-test manifest keyed by stable
  interaction ID.
- Classify every live interaction as exactly one of:
  `loadable_http`, `browser_only`, `external_provider`,
  `destructive_serial_only`, or `not_load_bearing`.
- Permit one interaction to map to zero, one, or multiple HTTP requests.
  Conversely, permit one shared HTTP request to support multiple interaction
  variants when the registry says they have the same user intent.
- Use request names that include the interaction ID and normalized operation,
  such as `INT-TIMELINE-005 POST /timeline server-action`, so Locust statistics
  remain traceable to the canonical registry.
- Do not add a general `/api/load-test/*` route, service-role browser path, RLS
  bypass, stable mutation API, or production authentication shortcut solely
  to simplify Locust.
- Keep browser-only behavior in the existing browser/UX testing layer. The
  load suite must not claim to verify rendering, hydration, focus, clipboard,
  sound, notification permission, mobile layout, or accessibility.
- Pin the selected Locust version and every direct Python dependency. Do not
  use an unbounded dependency range.

Scope:
- Add a concise load-testing architecture document that defines:
  - purpose and non-goals;
  - registry-to-workload classification;
  - environment safety levels;
  - identity, secret, and artifact handling;
  - request naming and semantic response assertions;
  - provisional performance and integrity gates;
  - provider approval boundaries;
  - the dependency graph for Tickets 064-066.
- Add a Python/Locust directory that can be installed independently from the
  Next.js workspace and invoked through project-local npm scripts.
- Add a machine-readable interaction workload manifest and a validator that:
  - loads the live registry;
  - requires exactly one load classification for every interaction ID;
  - rejects unknown or duplicate IDs;
  - requires a reason for every non-loadable entry;
  - requires route, method, expected result, environment, data
    preconditions, and cleanup ownership for every loadable entry;
  - rejects destructive interactions from ordinary mixed-workload profiles;
  - does not duplicate the registry's intent, risk, effect, or user-guidance
    prose.
- Prove four request types locally:
  1. one public document request;
  2. one authenticated protected-page document request;
  3. one authenticated structured-export download;
  4. one authenticated Timeline occurrence-status Server Action submission.
- For the Server Action proof:
  - fetch the current server-rendered page or action metadata;
  - discover the current build's generated action fields dynamically;
  - submit the exact user-owned occurrence ID, expected current state, and
    status payload through the real action;
  - verify both the action response and the persisted occurrence/status-event
    result;
  - prove a stale or cross-owner payload is rejected through normal auth,
    service, resolver, RPC, and RLS boundaries.
- Record the exact limitation if current React/Next.js form output cannot be
  replayed safely from Locust. In that case, stop before adding a test-only
  product route and revise the mutation-load design through a follow-up
  decision.

Acceptance criteria:
- A documented local command starts Locust in web-UI mode for exploration and
  a separate headless command runs the protocol smoke.
- The smoke uses one disposable synthetic account and leaves no product data
  or auth user after cleanup.
- Protected-page validation fails when the response is a login redirect or
  login document even if an intermediate response has a successful status.
- Export validation checks content type, disposition, non-empty body, and a
  small format-specific semantic marker rather than accepting HTTP status
  alone.
- Server Action validation proves the requested status transition and the
  resulting append-only event, not merely a sub-400 response.
- Locust logs and generated reports contain no cookies, passwords, access
  tokens, refresh tokens, service-role keys, user IDs, emails, behavior
  titles, occurrence notes, push endpoints, provider payloads, or uploaded
  bundles.
- Generated run artifacts are ignored by git. Only sanitized aggregate
  summaries may be committed.
- The manifest validator passes against the current interaction registry and
  fails when a fixture removes, duplicates, or misclassifies an interaction.
- A pull-request-safe smoke command is bounded to one user and local targets.
  No default script can point at production.
- `npm run agents:check`, `npm run interactions:check`,
  `npm run resolvers:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, `npm run build`, the Python manifest tests, and the local
  Locust protocol smoke pass.

Documentation updates required during implementation:
- Create `docs/LOAD_TESTING_PLAN.md`.
- Add the local installation and smoke workflow to `docs/OPERATIONS.md`.
- Add load-test artifact and secret handling to `.gitignore` and the runbook.
- Update `docs/INTERACTION_REGISTRY.md` with the companion-manifest rule,
  without adding load metadata to the canonical interaction schema.
- Update `STATUS.md` when the ticket starts and completes.

Suggested files:
- `load-tests/requirements.txt`
- `load-tests/locustfile.py`
- `load-tests/cadence_load/__init__.py`
- `load-tests/cadence_load/assertions.py`
- `load-tests/cadence_load/forms.py`
- `load-tests/cadence_load/registry.py`
- `load-tests/scenarios/interaction-map.json`
- `load-tests/tests/test_interaction_map.py`
- `load-tests/tests/test_response_assertions.py`
- `scripts/check-load-test-interactions.mjs` if the canonical drift check is
  kept in the existing Node governance layer
- `package.json`
- `.gitignore`
- `docs/LOAD_TESTING_PLAN.md`
- `docs/INTERACTION_REGISTRY.md`
- `docs/OPERATIONS.md`
- `STATUS.md`

Out of scope:
- High-concurrency runs, hosted Supabase writes, Vercel load, distributed
  workers, Google OAuth automation, real email or browser-push sends,
  destructive import/restore/account deletion load, UI rendering assertions,
  performance optimization, database migrations, and new product routes.

---

## Ticket 064: Synthetic load identities and read-workload baseline

Build the disposable many-account fixture lifecycle and the first realistic
public/authenticated read workloads, then establish a repeatable local capacity
baseline.

Dependency:
- Ticket 063 must be complete, including a passing authenticated protocol smoke
  and a validated interaction workload manifest.

Context:
- Cadence supports many independent accounts, but each account is
  single-player. Sharing one account across a large swarm would distort RLS,
  per-user cache behavior, occurrence freshness, and realistic query shapes.
- Supabase Auth applies endpoint and IP-based rate limits. Account creation and
  sign-in traffic must therefore be provisioned before the timed workload
  unless a separate run is explicitly measuring Auth.
- The existing `/auth/test-login` route is local/dev-only and blocked by
  production runtime guards. Load provisioning must not weaken those guards.
- `npm run smoke:rls` already proves a two-user ownership boundary. Load
  fixtures should reuse its safety posture: service-role access only for
  setup/cleanup, and ordinary signed-in clients plus RLS for product access.

Product and architecture decisions:
- Assign one disposable Supabase Auth identity and one cookie jar to each
  active Locust user.
- Provision accounts, sessions, and data before starting Locust statistics.
  Do not include user creation, password sign-in, or initial cookie generation
  in normal route-capacity measurements.
- Store temporary session material only in a run-specific file outside tracked
  source, with owner-only filesystem permissions. Delete it during cleanup
  even when the workload fails.
- Name disposable auth accounts with an exact run-scoped
  `cadence-load-...@example.invalid` pattern that cannot match ordinary users.
- Require an explicit target classification: `local`, `hosted_staging`, or
  `hosted_production`. Ticket 064 supports `local` only.
- Use a production build of the Next.js app where practical. Document any
  difference between local persistent Node execution and Vercel serverless
  behavior.

Fixture cohorts:
- Empty account:
  - profile and default categories;
  - no behaviors or occurrences.
- Typical daily account:
  - 8-12 active behaviors;
  - 1-2 archived behaviors;
  - daily, weekly, every-N-day, every-N-week, and monthly recurrence coverage;
  - exact and range schedule slots;
  - current Completed, Not Completed, and Unresolved occurrences;
  - prior Unresolved occurrences for Needs decision;
  - sparse synthetic notes;
  - email reminders disabled and no push subscription.
- Review-heavy account:
  - at least 90 local days of occurrence/status history;
  - status corrections with valid `revises_event_id` chains;
  - behavior-definition history;
  - behavior-date review data across 7-, 30-, and 90-day ranges.
- Export-heavy account:
  - active and archived behaviors;
  - one year of bounded synthetic history;
  - enough status events, notes, reminder history, and definition history to
    produce non-trivial JSONL, CSV, JSON, BehaviorLog, and Markdown outputs;
  - no real personal or provider data.
- Heavy schedule account:
  - 30-50 behaviors and multiple schedule slots;
  - still within supported product contracts;
  - used only in explicitly tagged capacity profiles, not the default mix.

Scope:
- Add run-scoped provision, session preparation, seed, integrity, and cleanup
  scripts.
- Make provisioning idempotent for one run ID and cleanup exact-targeted:
  - repeated provisioning does not create uncontrolled duplicates;
  - cleanup refuses an empty, malformed, wildcard, or overly broad run ID;
  - cleanup deletes only users and rows owned by the exact synthetic run;
  - aggregate counts are reported without identifiers.
- Add Locust users for:
  - public Login/Terms/Privacy/Trust documents;
  - protected Timeline, Behaviors, Export, and Settings document loads;
  - Timeline future-day query states;
  - Behaviors review range and selected-day reads;
  - JSONL, CSV, full JSON, and BehaviorLog download reads.
- Use realistic task weights and think time from the documented personas and
  journeys, while labeling the weights as initial product assumptions rather
  than observed user analytics.
- Add local load shapes:
  - smoke: 1 user for 2-5 minutes;
  - baseline: 5 and 10 users for 10 minutes each;
  - read ramp: 10, 25, 50, and 100 users with bounded plateaus;
  - recovery: return to the initial user count and confirm latency/error
    recovery.
- Name variable query paths consistently so dynamic IDs and dates do not
  fragment Locust statistics.
- Capture CSV history, failures, exceptions, and an HTML report under one
  ignored run directory.

Acceptance criteria:
- Provisioning produces the requested number of independent accounts and
  reports only cohort/count summaries.
- Every timed protected request uses an ordinary authenticated session and
  product RLS. No service-role key is available to Locust workers.
- A virtual user fails fast when no unique identity is available; identities
  are not silently shared.
- Default profiles never enable email sends, create push subscriptions, invoke
  process secrets, or submit destructive actions.
- Route assertions distinguish expected redirects, authenticated content, and
  semantic page failures.
- Exports contain only synthetic data belonging to the assigned account.
- The initial report records achieved requests per second, p50/p75/p95/p99
  latency, failure ratio, response bytes, cohort mix, local hardware/runtime,
  Next.js mode, Supabase mode, and warm/cold caveats.
- Provisional nominal gates are:
  - zero cross-account data;
  - zero unexpected `5xx` responses;
  - less than 0.5% unexpected request failures;
  - p95 no worse than twice the calibrated one-user warm baseline;
  - recovery to within 10% of the pre-ramp baseline after load returns to the
    initial level.
- Post-run integrity finds no duplicate occurrences, invalid owner
  relationships, false-fresh occurrence horizons, or unexpected reminder
  deliveries.
- `npm run smoke:rls` passes against the local target after the run.
- Cleanup removes every run-created auth user, product row, session artifact,
  and report copy containing sensitive session material. Sanitized aggregate
  result artifacts remain.
- Full repository verification plus Python unit tests and the local smoke,
  baseline, and bounded ramp pass.

Documentation updates required during implementation:
- Expand `docs/LOAD_TESTING_PLAN.md` with cohorts, weights, load shapes, gates,
  and local-vs-hosted interpretation.
- Create `docs/LOAD_TESTING_RUNBOOK.md` with setup, preflight, run, abort,
  integrity, cleanup, and failure-recovery procedures.
- Document the reusable local load lifecycle in `docs/OPERATIONS.md`.
- Update `docs/SUPABASE_WORKFLOW.md` with the synthetic-load rule: service role
  for exact setup/cleanup only, ordinary clients for timed access, no hosted
  use without authorization.
- Append the sanitized baseline to `docs/PERFORMANCE_SPEED_LOG.md`.
- Update `STATUS.md` when the ticket starts and completes.

Suggested files:
- `load-tests/cadence_load/auth.py`
- `load-tests/cadence_load/data.py`
- `load-tests/cadence_load/shapes.py`
- `load-tests/cadence_load/users/public.py`
- `load-tests/cadence_load/users/reader.py`
- `load-tests/scenarios/profiles.json`
- `load-tests/tests/test_identity_pool.py`
- `load-tests/tests/test_profiles.py`
- `scripts/load-test-provision.mjs`
- `scripts/load-test-seed.mjs`
- `scripts/load-test-integrity.mjs`
- `scripts/load-test-cleanup.mjs`
- `tests/load-test-lifecycle.test.ts`
- `package.json`
- `docs/LOAD_TESTING_PLAN.md`
- `docs/LOAD_TESTING_RUNBOOK.md`
- `docs/OPERATIONS.md`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `STATUS.md`

Out of scope:
- Mutating user workloads, Auth-capacity testing, hosted targets, Vercel,
  provider processing, production data, schema changes made only to support
  fixtures, performance remediation, destructive interactions, and claims
  about production capacity.

---

## Ticket 065: Mixed mutation, contention, and integrity load profiles

Extend the proven read harness to the common write paths and system contention
cases, with automatic integrity verification and strictly local provider
isolation.

Dependencies:
- Tickets 063 and 064 must be complete.
- The authenticated Server Action protocol must be proven against the current
  Next.js build.
- The synthetic identity lifecycle, baseline gates, and cleanup must be
  reliable before mutation load begins.

Context:
- The registry currently identifies twelve interactions with database-write
  effects. Ordinary load should focus on status decisions, occurrence notes,
  Behavior lifecycle changes, timezone saves, and synthetic exports.
- Cadence's reminder, occurrence, status-event, and behavior-definition
  contracts are idempotent or append-only in specific ways. Load testing must
  validate those contracts after concurrent execution rather than evaluating
  latency alone.
- Needs decision remains derived from Unresolved plus local date. No load
  scenario may invent or persist a `needs_decision` or missed status.
- Real Sequenzy email, Web Push, Google OAuth, and third-party repository
  traffic must remain outside the workload.

Workload coverage:
- Daily tracker:
  - read Timeline;
  - mark an Unresolved occurrence Completed or Not Completed;
  - Clear decision back to Unresolved when the scenario owns a suitable row;
  - save or edit a bounded synthetic occurrence note;
  - verify the refreshed row and status-event result.
- Behavior maintainer:
  - create a minimal valid behavior;
  - update title, recurrence, or one schedule field;
  - archive and restore the same run-owned behavior;
  - verify occurrence sync remains stale until repair and becomes fresh only
    after valid successful repair.
- Reflective reviewer:
  - open a selected behavior/date;
  - change one status or note through the Behaviors action;
  - verify counts and review data reconcile.
- Settings:
  - save an unchanged timezone as the common low-write path;
  - run changed-timezone synchronization only in a separately tagged,
    low-frequency profile because it updates active behaviors and future
    Unresolved occurrences.
- Portability:
  - mix structured export downloads at a low rate against concurrent
    Timeline/Behaviors activity;
  - keep import preview/apply, restore preview/apply, and account deletion out
    of the ordinary swarm.
- System overlap:
  - run one fixed-count operator user for protected occurrence-horizon sync;
  - test reminder-processing claim/idempotence only against seeded synthetic
    deliveries and a local fake Sequenzy endpoint;
  - create no active browser-push subscriptions, so Web Push is never called.
- Same-account contention:
  - use two independent sessions for one synthetic account to submit
    coordinated writes to the same occurrence;
  - require one valid transactional result and the documented idempotent,
    stale, or concurrent-duplicate outcome for the competing request;
  - verify no lost status event, invalid revision chain, duplicate reminder
    cancellation, or cross-owner effect.

Load shapes:
- Mixed baseline: realistic read/write weights at 5 and 10 users.
- Ramp: 10, 25, 50, and 100 users with a minimum stable plateau at each step.
- Spike: stable baseline followed by a rapid 10x increase, bounded hold, and
  recovery.
- Soak: 25-50 users for 1-2 hours, sized below the proven breakpoint.
- Breakpoint: increase in bounded steps until an automatic gate fails or the
  authorized local ceiling is reached.
- Contention: coordinated small-user scenarios that maximize write collision
  rather than raw request volume.
- Operator overlap: run occurrence sync and fake-provider reminder processing
  during a stable mixed workload.

Automatic abort conditions:
- Any cross-account data exposure or write.
- Any real provider request attempt.
- Unexpected account deletion, restore apply, or import apply.
- Sustained unexpected `5xx` ratio above the documented threshold.
- Repeated database connection refusal, false-fresh occurrence horizon, or
  integrity-check failure.
- Run-directory/session leakage or inability to identify the exact cleanup
  target.
- A configured maximum request count, runtime, users, or requests-per-second
  ceiling is reached.

Acceptance criteria:
- Each mutation is performed against state owned by that Locust user and is
  semantically verified after submission.
- Normal task weights keep reads dominant. Mutation weights, think times, and
  achieved requests per second are recorded in the report.
- Dynamic occurrence, behavior, and date identifiers are grouped under stable
  interaction-ID request names while the exact IDs remain out of reports.
- Status transitions preserve the stored vocabulary:
  `unresolved`, `completed`, and `not_completed`.
- Occurrence generation remains unique and preserves past/resolved history.
- Status-event history remains append-only, owner-consistent, ordered, and
  valid under idempotent and competing submissions.
- Pending reminders cancel when an occurrence resolves; eligible strictly
  future reminders may reconcile when a decision is cleared; due/past rows do
  not reactivate.
- Behavior create/update/archive/restore leaves an owner-consistent,
  non-empty schedule graph and does not create definition-history events for
  schedule-only changes.
- Changed-timezone scenarios preserve past and resolved occurrences.
- Reminder processing against the local fake provider proves claim,
  duplicate-send avoidance, and final status without contacting Sequenzy or
  Web Push.
- Soak runs show no unbounded growth in failures, memory, open database
  connections, pending processing claims, or orphaned synthetic rows.
- The result identifies the highest sustainable local user count and achieved
  requests per second under the calibrated nominal gates. It does not label
  that result as production capacity.
- Post-run aggregate checks prove:
  - zero cross-owner rows;
  - zero unexpected duplicate occurrences or deliveries;
  - zero invalid status-event or definition-event chains;
  - zero false-fresh horizons;
  - zero provider sends;
  - exact cleanup counts.
- Full repository verification, Python tests, focused existing resolver/service
  tests, local database integrity checks, and every new bounded load profile
  pass.

Documentation updates required during implementation:
- Expand `docs/LOAD_TESTING_PLAN.md` with the final workload mix, state
  machines, contention rules, and abort gates.
- Expand `docs/LOAD_TESTING_RUNBOOK.md` with fake-provider setup and recovery
  from interrupted mutation runs.
- Add the resulting local capacity curve and bottleneck evidence to
  `docs/PERFORMANCE_SPEED_LOG.md`.
- Update `docs/NOTIFICATION_SPEC.md` only if a reusable fake-provider
  operations seam is introduced; do not change reminder product semantics.
- Update `docs/AGENT_RESOLVERS.md` only if new test orchestration touches an
  owning service boundary; load code must not become an allowed product caller
  of resolvers or repositories.
- Update `STATUS.md` when the ticket starts and completes.

Suggested files:
- `load-tests/cadence_load/actions.py`
- `load-tests/cadence_load/integrity.py`
- `load-tests/cadence_load/users/daily.py`
- `load-tests/cadence_load/users/maintainer.py`
- `load-tests/cadence_load/users/reviewer.py`
- `load-tests/cadence_load/users/exporter.py`
- `load-tests/cadence_load/users/operator.py`
- `load-tests/tests/test_action_payloads.py`
- `load-tests/tests/test_load_shapes.py`
- `scripts/load-test-fake-sequenzy.mjs`
- `scripts/load-test-integrity.mjs`
- `tests/load-test-lifecycle.test.ts`
- focused existing resolver/service/route tests as required
- `docs/LOAD_TESTING_PLAN.md`
- `docs/LOAD_TESTING_RUNBOOK.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/NOTIFICATION_SPEC.md` if required
- `docs/AGENT_RESOLVERS.md` if required
- `STATUS.md`

Out of scope:
- Real provider sends, Google OAuth load, permanent load-test APIs, production
  traffic, provider rate-limit tuning, schema changes without product need,
  import apply swarms, restore apply swarms, account deletion swarms, browser
  rendering, accessibility conclusions, and implementing performance fixes
  discovered by the test.

---

## Ticket 066: Authorized hosted capacity run and evidence report

Execute the proven Locust suite against a production-like hosted staging
environment only after provider authorization, then publish a sanitized
capacity and bottleneck report.

Dependencies:
- Tickets 063-065 must be complete with passing local smoke, baseline, mixed,
  spike, soak, contention, integrity, and cleanup evidence.
- The owner must identify the exact Vercel plan, Supabase project/tier,
  hostname, cost ceiling, and staging isolation posture.
- The hosted target must use synthetic accounts and data only.

Hard provider gates:
- Current Vercel policy permits load testing only on Enterprise plans and
  requires prior coordination with Vercel. If the target plan is not
  Enterprise or approval is not documented, do not run Locust against any
  Vercel Preview, Staging, or Production deployment.
- The Vercel approval request must provide the planned start/end time,
  estimated maximum requests per second, target hostname, source geography,
  source IPs, distributed/localized posture, and Fluid Compute posture when
  applicable.
- Current Supabase production guidance recommends staging for load tests. For
  heavy or prolonged hosted load on Team/Enterprise, contact Supabase support
  with at least two weeks notice and provide the expected traffic window and
  profile.
- Provider approval does not authorize real email, Web Push, Google OAuth, or
  unrelated third-party traffic.
- A user request to "run the test" does not waive these provider gates. Record
  a blocked ticket state when approval or an isolated target is missing.

Hosted environment contract:
- Prefer a dedicated application staging hostname and dedicated Supabase
  staging project with migration history congruent to git.
- Match production-relevant regions, environment variables, runtime mode,
  schema, RLS, indexes, and synthetic data volume without copying real user
  records.
- Use local or isolated fake provider endpoints for Sequenzy-dependent paths
  and no active browser-push subscriptions.
- Keep service-role and process secrets outside Locust source, reports, command
  history, and worker output.
- Pre-provision identities and sessions outside timed statistics.
- Protect the staging deployment from unrelated traffic while allowing only
  the approved load-generator sources.

Preflight:
- Record git commit, deployment ID, target hostname, Vercel region/runtime,
  Supabase project ref in private task notes, Supabase region/compute tier,
  migration congruence, fixture cohort counts, Locust version, worker count,
  source regions/IPs, maximum users/RPS/runtime, cost ceiling, and approval
  references.
- Run repository verification, local protocol smoke, local integrity, hosted
  `npm run smoke:rls`, hosted migration-list comparison, Supabase advisors,
  unauthenticated route smoke, authenticated one-user smoke, and exact cleanup
  dry run.
- Confirm monitoring retention and collection before traffic starts:
  - Locust CSV/HTML artifacts;
  - sanitized Cadence `performance_timing` spans;
  - Vercel request/function status, duration, invocation, memory/CPU, and cost
    evidence available on the plan;
  - Supabase CPU, memory, disk IOPS/throughput, database connections,
    PostgREST/Auth signals, and slow-query evidence.
- Establish a fresh one-user and ten-user hosted baseline before any ramp.

Execution:
- Run one bounded stage at a time: public/read baseline, authenticated read
  ramp, mixed mutation ramp, spike/recovery, soak, and contention/operator
  overlap.
- Require a human checkpoint between major stages. Do not automatically move
  from a safe baseline into breakpoint traffic.
- Start below the approved ceiling and stop at the first application,
  database, provider, integrity, cost, or policy gate.
- Record achieved requests per second rather than inferring capacity from
  virtual-user count.
- Separate cold/warm, cache-hit/miss, freshness-repair, and provider-stub
  samples where evidence permits.
- Do not change infrastructure size, indexes, queries, caches, or application
  code during the measurement run. File separate remediation tickets from the
  evidence afterward.

Acceptance criteria:
- Provider authorization and the exact hosted target are recorded before the
  first Locust request.
- No request reaches the current public production hostname unless the owner
  explicitly authorizes that hostname and Vercel approves it.
- No real user record, personal behavior data, personal note, provider
  subscription, or real recipient is created, read, mutated, exported, or
  logged.
- Nominal hosted gates are calibrated from the fresh hosted baseline and
  include:
  - zero cross-account access;
  - zero unexpected `5xx` at target load;
  - less than 0.5% unexpected failures at target load;
  - p95 within the documented route/action budget;
  - bounded p99 and timeout rate;
  - recovery to within 10% of baseline after a spike;
  - no sustained connection, CPU, memory, IOPS, throughput, or cost saturation;
  - zero data-integrity violations.
- The run identifies:
  - maximum tested and maximum sustainable virtual users;
  - achieved requests per second for each workload mix;
  - p50/p75/p95/p99 by interaction ID and route/action group;
  - failure/status distribution;
  - first breached gate and likely owning layer;
  - Vercel versus Supabase versus application bottleneck evidence;
  - cold-start, cache, occurrence-freshness, export-size, and contention
    observations;
  - recovery behavior and remaining headroom;
  - the limits of extrapolating staging evidence to production.
- Post-run hosted integrity, `npm run smoke:rls`, migration congruence, provider
  no-send proof, exact synthetic cleanup, and a final one-user recovery smoke
  pass.
- All raw artifacts remain ignored/private. Commit only aggregate,
  privacy-safe evidence.
- Create narrowly scoped follow-up tickets for proven bottlenecks. Do not
  implement fixes opportunistically in Ticket 066.

Documentation updates required during implementation:
- Finalize `docs/LOAD_TESTING_RUNBOOK.md` with provider approval templates,
  hosted preflight, human checkpoints, abort, rollback, and cleanup.
- Add the hosted environment and approval rules to `docs/VERCEL_WORKFLOW.md`,
  `docs/SUPABASE_WORKFLOW.md`, and `docs/OPERATIONS.md`.
- Append the sanitized capacity report to
  `docs/PERFORMANCE_SPEED_LOG.md` or create a dated report under
  `docs/qa/load-testing/` and link it from the performance log.
- Update `STATUS.md` with provider gates, execution state, results, cleanup,
  follow-up tickets, and remaining uncertainty.

Suggested files:
- `load-tests/cadence_load/shapes.py`
- `load-tests/scenarios/profiles.json`
- `load-tests/tests/test_hosted_guards.py`
- `scripts/load-test-preflight.mjs`
- `scripts/load-test-integrity.mjs`
- `scripts/load-test-cleanup.mjs`
- `docs/LOAD_TESTING_RUNBOOK.md`
- `docs/PERFORMANCE_SPEED_LOG.md`
- `docs/qa/load-testing/<YYYY-MM-DD>-hosted-capacity.md`
- `docs/VERCEL_WORKFLOW.md`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/OPERATIONS.md`
- `STATUS.md`

Out of scope:
- Unapproved Vercel traffic, copying production user data, real provider sends,
  changing hosted schema outside migrations, production performance claims
  from local-only evidence, automatic infrastructure upgrades, opportunistic
  performance fixes, admin dashboards, product analytics/tracking, and
  expansion beyond Cadence's existing single-account product scope.

---

## Ticket 067: Launch cost guardrails and traffic-surge operations

Protect the owner from runaway infrastructure and provider charges, and create
a rehearsed protocol for legitimate usage surges, abusive traffic, provider
incidents, and application regressions before broad public launch.

Context:
- Ticket 065 proved local correctness, integrity, recovery, and bounded resource
  growth. Latency was the first local stress signal. It did not establish hosted
  cost or capacity.
- Ticket 066 remains the source of hosted staging capacity evidence when its
  target and provider approvals exist. Ticket 067 may implement conservative
  launch guardrails before Ticket 066 runs; later hosted evidence may tune them
  through a separate reviewed change.
- Current Vercel Spend Management can provide spend notifications and an
  optional hard limit that pauses projects. Exact availability, scope, pricing,
  default values, notification channels, and pause behavior must be rechecked
  against the owner's current plan before configuration.
- Current Supabase Pro cost controls include a Spend Cap for specific variable
  usage items. The cap does not cover every charge, including compute and some
  add-ons, and it does not provide fine-grained per-item budgets or threshold
  notifications. Recheck the current billing documentation and changelog before
  configuration.
- Platform DDoS, firewall, rate-limit, and challenge controls have distinct
  plan, billing, false-positive, and regional-counter behavior. Treat them as
  traffic controls, not as a complete billing guarantee.
- No provider control can guarantee zero unexpected charges. The ticket must
  document alert latency, already-incurred usage, uncovered billing categories,
  provider outages, and owner-approved availability-versus-cost tradeoffs.

Dependencies:
- Tickets 029-030 public hardening and privacy-safe runtime monitoring must
  remain intact.
- Tickets 063-065 local load and integrity evidence must remain passing.
- The owner must identify the current Vercel, Supabase, Sequenzy, domain, and
  any other billable provider plans and name the billing/incident contact.
- Provider-setting mutations, production firewall publication, project pauses,
  plan changes, purchases, and real incident actions require explicit owner
  authorization for the exact target.

Implementation strategy:
1. Build a sanitized launch cost inventory:
   - record each provider, plan, billing cycle, fixed cost, metered dimensions,
     included quota, overage rate, current baseline, billing owner, and official
     documentation URL;
   - include Vercel requests, transfer, function execution, builds, monitoring,
     firewall features, and project count;
   - include Supabase compute, database/disk, egress, Auth MAU, logs, backups,
     add-ons, project count, and every Spend Cap coverage gap;
   - include Sequenzy email delivery and any domain, logging, or alerting cost;
   - keep account identifiers, invoice details, payment data, secrets, and user
     data out of git-tracked artifacts.
2. Obtain an explicit owner risk policy:
   - monthly normal-operating budget;
   - warning, urgent, and emergency USD thresholds;
   - maximum acceptable unplanned spend;
   - acceptable outage duration if a hard cap pauses the app;
   - who may acknowledge alerts, enable emergency controls, pause service,
     change a limit, or resume traffic;
   - which notification channels have a tested human recipient and backup.
3. Configure provider-native cost controls where the current plan supports
   them:
   - Vercel spend alerts at every supported threshold, a tested notification or
     webhook path, and the owner-approved hard-limit/pause posture;
   - Supabase Spend Cap enabled when the owner chooses availability restriction
     over covered overage, plus explicit tracking of compute and other uncovered
     charges;
   - Sequenzy/provider sending limits or account alerts where available;
   - no automatic plan upgrade, add-on purchase, compute resize, or budget
     increase.
4. Add a privacy-safe cost and surge preflight/report command:
   - verify required cost-policy fields and provider-control evidence without
     reading or printing payment data or secrets;
   - report request/error/latency, function, database, Auth, egress, reminder,
     and provider-send signals needed by the response protocol;
   - fail closed on missing owners, thresholds, notification tests, rollback
     steps, or known uncovered-cost acknowledgement;
   - keep raw provider exports and alert payloads private. Commit only sanitized
     aggregate evidence.
5. Audit and implement bounded traffic controls for current expensive or
   sensitive paths:
   - inventory public documents, OAuth start/callback, protected app reads,
     export downloads, push subscription writes, Next.js Server Actions, and
     occurrence/reminder process routes separately by method and cost;
   - preserve the process routes' secret checks and batch ceilings;
   - replace reliance on per-runtime in-memory failure limits where distributed
     enforcement is required;
   - prefer provider-edge enforcement for anonymous abusive traffic when it is
     available and cheaper than executing application code;
   - stage candidate firewall rules in log-only mode, measure legitimate
     traffic, test Google OAuth and cron bypasses, then require a human review
     before publish;
   - use per-account or action-aware controls for authenticated expensive work.
     Do not apply one broad IP limit that can block households, schools, VPNs,
     accessibility tools, or shared networks;
   - return stable `429` and `Retry-After` behavior where application rate
     limiting applies. Do not silently drop successful user mutations.
6. Add narrowly scoped server-side circuit breakers for cost-amplifying work:
   - independently stop real email sends, browser-push sends, reminder batches,
     occurrence-sync batches, and large/repeated exports without disabling
     account access or ordinary Timeline decisions;
   - default every breaker to normal product behavior and keep it server-only;
   - log only a privacy-safe breaker name, state, reason code, and aggregate
     count;
   - document exact enable, verification, rollback, and recovery procedures;
   - update user-facing copy and the interaction registry only when a breaker
     changes a visible response.
7. Create a four-level surge and cost incident runbook:
   - Level 0, normal: review usage and alert delivery on a fixed cadence;
   - Level 1, warning: identify the source, compare against expected launch
     traffic, and increase observation without changing limits;
   - Level 2, urgent: enable scoped throttles or circuit breakers for the proven
     cost source while preserving core tracking when safe;
   - Level 3, emergency: enable provider attack controls or the owner-approved
     spend hard stop/project pause, notify users if availability changes, and
     contact provider support;
   - every level names entry/exit thresholds, decision owner, maximum response
     time, evidence to capture, prohibited actions, rollback, and escalation;
   - resumption requires costs to stop accelerating, traffic and latency to
     stabilize, integrity/RLS checks to pass, queues to be understood, and one
     owner to record the go decision.
8. Run a non-production tabletop and technical drill:
   - simulate a legitimate traffic spike, anonymous abuse, export amplification,
     reminder backlog, provider-send surge, cost alert, hard-stop decision, and
     false-positive throttle;
   - prove the owner can find current spend, identify the owning layer, stop the
     scoped cost source, preserve data integrity, roll back the control, and
     recover normal service;
   - do not generate billable stress traffic merely to test billing controls.

Acceptance criteria:
- A sanitized provider cost inventory identifies every known fixed and metered
  cost, current plan, included quota, overage path, billing owner, and control
  coverage gap.
- The owner approves concrete USD thresholds, notification recipients,
  availability tradeoffs, escalation authority, and the hard-stop posture.
- Vercel spend notifications are enabled and tested. The selected hard-limit
  behavior is verified or explicitly declined with the residual exposure
  documented.
- Supabase Spend Cap posture is verified. Covered and uncovered usage items are
  listed explicitly; the ticket does not describe the cap as protection from
  compute or all possible charges.
- Sequenzy and every other billable provider has a verified usage-limit, alert,
  or manual review protocol. Missing provider controls are recorded as residual
  risk rather than assumed.
- Cost and surge monitoring has warning, urgent, and emergency signals with a
  tested human delivery path and a backup contact.
- Anonymous, authenticated, export, provider, and protected process traffic use
  separate controls based on measured cost and legitimate behavior.
- Firewall rules are tested in log-only or preview form before enforcement.
  OAuth callbacks, Vercel Cron, ordinary authenticated tracking, exports under
  the declared limit, and accessibility/shared-network scenarios remain usable.
- Circuit breakers can stop each cost-amplifying subsystem independently. No
  breaker weakens Auth, RLS, audit history, status integrity, or exact reminder
  idempotency.
- Every throttled application response has deterministic tests for status,
  retry guidance, monitoring, and no partial mutation.
- The incident runbook covers surge triage, cost containment, attack response,
  provider escalation, rollback, queue recovery, integrity/RLS verification,
  user communication, and safe resumption.
- A non-production drill produces sanitized evidence that the owner can detect,
  contain, roll back, and recover from each declared incident class.
- `npm run agents:check`, `npm run interactions:check`,
  `npm run resolvers:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build` pass.

Documentation updates required during implementation:
- Add the owner-approved cost policy and incident protocol to
  `docs/OPERATIONS.md` without committing private billing data.
- Add Vercel spend, firewall, deployment-pause, and rollback procedures to
  `docs/VERCEL_WORKFLOW.md`.
- Add Supabase Spend Cap coverage, usage review, compute/add-on exposure, and
  recovery procedures to `docs/SUPABASE_WORKFLOW.md`.
- Add provider-send caps and emergency disable/recovery behavior to
  `docs/SEQUENZY_WORKFLOW.md` and `docs/NOTIFICATION_SPEC.md` when reminder
  delivery behavior changes.
- Update `docs/ROUTE_MAP.md`, `docs/INTERACTION_REGISTRY.md`, and
  `interaction-registry.json` when a route or visible interaction changes.
- Add a sanitized dated drill report under `docs/qa/launch-safety/`.
- Update `STATUS.md` when implementation starts, blocks, or completes.

Suggested files:
- `scripts/launch-cost-preflight.mjs`
- `scripts/launch-surge-drill.mjs`
- `lib/security/rate-limiter.ts`
- `lib/security/launch-circuit-breakers.ts`
- `lib/monitoring.ts`
- `app/api/export/*/route.ts`
- `app/api/push/subscribe/route.ts`
- `app/api/reminders/process/route.ts`
- `app/api/occurrences/sync/route.ts`
- focused Server Action adapters only when their measured cost requires it
- `tests/launch-cost-preflight.test.ts`
- `tests/launch-circuit-breakers.test.ts`
- focused route, action, monitoring, reminder, and export tests
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/SEQUENZY_WORKFLOW.md`
- `docs/NOTIFICATION_SPEC.md` when provider delivery behavior changes
- `docs/ROUTE_MAP.md` and interaction registry files when required
- `docs/qa/launch-safety/<YYYY-MM-DD>-cost-surge-drill.md`
- `STATUS.md`

Official references to recheck during implementation:
- <https://vercel.com/docs/spend-management>
- <https://vercel.com/docs/vercel-firewall>
- <https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing>
- <https://supabase.com/docs/guides/platform/cost-control>
- <https://supabase.com/docs/guides/platform/billing-on-supabase>
- <https://supabase.com/changelog.md>

Out of scope:
- Payment or subscription infrastructure for Cadence users.
- An admin dashboard, product analytics platform, marketing tracking, or social
  features.
- Guaranteed zero charges, automatic refunds, or assumptions that provider
  alerts arrive before usage is billed.
- Automatic project pause, production firewall publication, attack-mode
  activation, plan changes, purchases, compute resizing, or budget increases
  without exact owner authorization.
- Broad throttles that make ordinary Timeline decisions unreliable, silently
  discard mutations, weaken RLS, or prevent export/account portability without
  an explicit emergency state.
- New monitoring, queue, rate-limit, or incident-management vendors without a
  separate privacy, security, reliability, and recurring-cost decision.
- Opportunistic capacity tuning or implementation of Ticket 066 hosted load.

---

## Ticket 068: Occurrence stopwatch capture, reset, and persistence

Add a small stopwatch to the existing expanded Timeline occurrence row so a
user can record how long one occurrence takes, stop the timer, and reset the
recorded time when it was captured by mistake.

Context:
- Cadence currently stores scheduled times and status timestamps, but it does
  not store elapsed time spent on an occurrence.
- `docs/DECISIONS.md` and `docs/PRODUCT_SPEC.md` currently defer structured
  measurements. This ticket intentionally creates one narrow duration-only
  exception. It must not create a general measurement-template system.
- Timeline already uses an expanded native disclosure for Description,
  Category, Schedule, status correction, and Note. Time tracking belongs in
  that disclosure and does not need a new route, modal, or card treatment.
- Tickets 066 and 067 concern hosted load and launch operations. Their provider
  gates do not block this local product slice.

Dependencies:
- Existing Timeline, occurrence, status, Supabase Auth, and RLS behavior must
  remain passing.
- Run the project-local impeccable context workflow before editing the
  Timeline UI. Use existing product actions, spacing, and typography.
- Hosted migration deployment remains separately authorization-gated. This
  ticket may be implemented and verified locally without resolving Tickets 066
  or 067.

Settled product decisions:
- This is an elapsed-time stopwatch, not a countdown timer.
- A timing session is one persisted start/stop interval attached to one
  occurrence and its owning behavior.
- Starting persists the session before the visible stopwatch begins. Refreshing
  or reopening the page restores a still-running session from its saved
  `started_at` instant.
- One occurrence may have at most one running timing session. Different
  occurrences may run concurrently.
- An occurrence may have multiple stopped timing sessions. Stop followed by a
  later Track Time action creates another session.
- Duration is derived from `stopped_at - started_at`. Do not duplicate it in a
  mutable database column.
- Stop records time only. It does not mark the occurrence Completed, Not
  Completed, or Unresolved and does not change reminder eligibility.
- Start is available for active-behavior occurrences on the current local day
  or still visible in Needs decision. A previously started session may still be
  stopped or reset after the occurrence leaves Needs decision.
- Reset tracked time deletes every timing session for that occurrence,
  including a running session. It returns the row to the idle Track Time state.
- Reset uses a clearly named inline text action without a confirmation modal.
  It is an explicit user correction, not an automatic cleanup rule.
- Countdown configuration, pause/resume state, manual duration entry,
  individual-session editing, and individual-session deletion are out of
  scope.

Implementation order:
1. Update the product, data, UI, user-flow, decision, resolver-ownership, route,
   and interaction contracts before implementation.
2. Add one additive migration for `occurrence_time_sessions`. The migration
   creates only the new table, its indexes, ownership constraints, updated-at
   trigger, RLS policies, and authenticated grants.
3. Regenerate Supabase database types and add explicit timing-session domain
   types.
4. Write the failing pure resolver tests for start, stop, elapsed duration,
   multiple stopped sessions, running state, formatting, invalid timestamps,
   and reset planning.
5. Implement the resolver, repository, and service boundaries.
6. Add Timeline Server Actions for start, stop, and reset. Keep authentication,
   user ownership, occurrence lookup, and date/behavior eligibility in the
   service layer.
7. Add the Track Time line to the existing expanded occurrence disclosure and
   cover its idle, saving, running, stopping, stopped, resetting, and error
   states.
8. Register the new user intent, update the load-test companion
   classification, add user guidance, and run full verification.

Data and migration requirements:
- Create exactly one additive migration named with the project-local Supabase
  workflow, such as `add_occurrence_time_sessions`.
- The new table should contain:
  - `id uuid` primary key;
  - `user_id uuid` with account-deletion cascade;
  - `occurrence_id uuid`;
  - `behavior_id uuid`;
  - `started_at timestamptz`;
  - nullable `stopped_at timestamptz`;
  - `created_at` and `updated_at` timestamps.
- Enforce one owner-consistent foreign key from
  `(user_id, occurrence_id, behavior_id)` to the existing occurrence ownership
  tuple. Deleting the occurrence or account must cascade to its timing
  sessions.
- Enforce `stopped_at is null or stopped_at >= started_at`.
- Add one partial unique index on `(user_id, occurrence_id)` where
  `stopped_at is null` so duplicate starts cannot create two running sessions
  for the same occurrence.
- Add behavior-history and occurrence-lookup indexes without introducing a
  generalized analytics table.
- Add owner-scoped select, insert, update, and delete RLS policies and minimum
  authenticated grants. Reset requires owner-scoped delete access.
- Do not alter, backfill, rewrite, or recalculate any existing behavior,
  occurrence, status event, note, reminder, import, or export row.
- Existing occurrences begin with zero timing sessions. No data conversion is
  required.
- Do not modify the existing Export-page read RPC in this ticket.
- Do not deploy the migration to hosted Supabase without explicit owner
  authorization for the exact linked project.

Resolver, repository, and service requirements:
- Add `lib/resolvers/time-tracking.resolver.ts` and register it in
  `docs/AGENT_RESOLVERS.md` with paired tests.
- Resolvers must receive `now` explicitly and must not read browser APIs,
  environment variables, Supabase, or the system clock.
- Use Temporal instants for authoritative start, stop, and duration math. Do
  not parse local dates with JavaScript `Date`.
- Keep persistence in `lib/db/timeSessions.repo.ts` and orchestration in
  `lib/services/time-tracking.service.ts`.
- Start must be idempotent for an already-running occurrence. A race must
  resolve to one running row rather than a duplicate session.
- Stop must update only the current user's still-running session. A repeated
  stop submission must return the saved stopped result or a stable no-op
  result instead of creating another session.
- Reset must delete all current-user sessions for the occurrence atomically
  from the application's perspective. A repeated reset must be an idempotent
  success.
- Server-side eligibility must reject a start for a future local date, an
  archived behavior, a prior resolved occurrence outside the Needs decision
  retention window, a missing occurrence, or another user's occurrence. Crafted
  form submissions must not bypass the UI gate.
- Stop and reset must not reject only because midnight passed after a valid
  start.
- Time tracking must not mutate occurrence status, `completed_at`,
  `status_marked_at`, status-event history, notes, or reminder deliveries.

Timeline UI requirements:
- Add the control inside `components/timeline/OccurrenceRow.tsx` after Schedule
  details and before status/note correction content.
- Reuse an isolated `TimeTracker` component if it keeps action state and the
  one-second visual counter out of `OccurrenceRow`.
- Idle state shows only the exact underlined action label `Track Time`, without
  a duplicate static heading.
- Running state shows a static, non-underlined `Track time` label, an elapsed
  `HH:MM:SS` value, and the exact action label `Stop`.
- After stopping, show the combined recorded time for the occurrence plus
  `Track Time` and `Reset tracked time` actions.
- Reset immediately returns the component to its idle state after confirmed
  persistence.
- The client counter may update once per second for display, but the saved
  duration must use persisted server instants. Page suspension or timer drift
  must not change the final duration.
- Do not announce every timer tick through a live region. Announce start, stop,
  reset, and failure results only.
- Preserve 44px mobile action targets, keyboard operation, reduced-motion
  expectations, and the existing unboxed disclosure treatment.
- Do not add a new page, API route, modal, floating timer, chart, design token,
  card border, or permanent Timeline column.

Acceptance criteria:
- A signed-in user can open a current-day or visible Needs decision occurrence,
  select Track Time, see a running counter, select Stop, and see the persisted
  combined duration.
- Refreshing during a running session restores the running state and elapsed
  value from the persisted `started_at` instant.
- Starting again after a stop creates a second session and the occurrence total
  equals the sum of its stopped sessions.
- Reset tracked time removes every session for that occurrence, discards a
  running session when present, and returns the UI to Track Time.
- Stop and reset remain user-owned and idempotent under double submission or
  stale UI state.
- Two accounts cannot read, start, stop, update, reset, or infer each other's
  timing sessions through normal authenticated clients.
- A user may run timers for two different occurrences, but cannot create two
  simultaneous running sessions for the same occurrence.
- Stop and reset do not alter occurrence status or reminder state.
- Existing rows are preserved. A clean migration produces an empty timing
  table for existing fixtures without backfill work.
- Timeline remains mobile-responsive and uses the existing design system.
- Interaction registry, user guide, load-test companion classification, RLS
  policy registry, and resolver registry checks cover the new feature.

Documentation updates required during implementation:
- `docs/PRODUCT_SPEC.md`: add duration-only occurrence time tracking and keep
  general structured measurements out of scope.
- `docs/DECISIONS.md`: record the narrow exception to the existing measurement
  decision and the separate timing/status semantics.
- `docs/DATA_MODEL.md`: document the table, constraints, RLS, cascades, and
  derived-duration contract.
- `docs/UI_SPEC.md` and `docs/USER_FLOWS.md`: document Track Time, Stop,
  persistence, reset, conditional availability, and accessibility.
- `docs/AGENT_RESOLVERS.md`: register time-tracking resolver ownership and
  forbidden UI/service duplication.
- `docs/ROUTE_MAP.md`: note the added Timeline interaction without creating a
  route.
- `docs/INTERACTION_REGISTRY.md`, `interaction-registry.json`,
  `load-tests/scenarios/interaction-map.json`, and
  `docs/user-guide/timeline.md`: register and explain the interaction.
- `STATUS.md`: mark Ticket 068 in progress before implementation and record
  verification, migration deployment state, and remaining risks at completion.

Suggested files:
- `supabase/migrations/*_add_occurrence_time_sessions.sql`
- `lib/db/database.types.ts`
- `lib/types/database.ts`
- `lib/types/time-tracking.ts`
- `lib/resolvers/time-tracking.resolver.ts`
- `lib/db/timeSessions.repo.ts`
- `lib/services/time-tracking.service.ts`
- `lib/types/timeline.ts`
- `lib/services/timeline.service.ts`
- `app/(app)/timeline/actions.ts`
- `app/(app)/timeline/page.tsx`
- `components/timeline/Timeline.tsx`
- `components/timeline/TimelineGroup.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `components/timeline/TimeTracker.tsx`
- `tests/time-tracking.resolver.test.ts`
- `tests/time-tracking.service.test.ts`
- `tests/time-sessions.repo.test.ts`
- `tests/time-tracking-migration.test.ts`
- `tests/timeline-time-tracking-ui.test.tsx`
- `tests/rls-policy-registry.test.ts`
- product, resolver, route, interaction, and user-guide docs listed above
- `STATUS.md`

Verification:
- Run focused resolver, service, repository, migration, RLS, and Timeline UI
  tests first.
- Run `npm run supabase -- db reset` from a clean local database.
- Regenerate `lib/db/database.types.ts` from the local schema.
- Run `node .agents/skills/impeccable/scripts/context.mjs` before UI edits and
  verify the result against `.agents/skills/impeccable/reference/product.md`.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.

Out of scope:
- General measurements, expected-duration targets, countdowns, pause/resume,
  manual duration entry, automatic Completed status, automatic reminder
  changes, per-session editing, per-session deletion, a global active-timer
  dashboard, charts, history tables, new routes, offline timers, PWA sync,
  background native timers, desktop/mobile implementation, social timing, or
  AI coaching.

---

## Ticket 069: Behavior timing averages and selected-day review

Show compact timing context on Behaviors after Ticket 068 has reliable timing
sessions: one conditional average per behavior and one conditional tracked-time
row for the selected occurrence day.

Dependencies:
- Ticket 068 must be complete with passing migration, resolver, RLS, service,
  Timeline, reset, and interaction tests.
- Use the existing 7, 30, and 90-day Behaviors range. Do not add a separate
  time-tracking range selector.
- Run the project-local impeccable context workflow before UI edits and reuse
  the existing behavior metadata and selected-day review patterns.

Settled product decisions:
- A stopped timing session contributes to recorded time. A running session does
  not contribute to a finalized duration or average.
- One occurrence's recorded tracked time is the sum of all its stopped timing
  sessions.
- The behavior average is the arithmetic mean of recorded occurrence totals
  for timed occurrences in the selected 7, 30, or 90-day range.
- Untimed occurrences and occurrences with only a running session are excluded
  from the denominator.
- The `Average tracked time` line is conditionally hidden when the selected
  range has no recorded occurrence totals. Do not render `No tracked time`.
- In Review selected day, `Tracked time` appears only for an occurrence with
  recorded time or a running session.
- A selected-day occurrence with stopped time shows its combined recorded
  duration. A running-only occurrence shows `In progress`. An occurrence with
  both stopped time and a running session shows its recorded duration plus an
  In progress label.
- Review selected day exposes `Reset tracked time` inside the existing Review
  disclosure and reuses Ticket 068's reset service/action semantics.
- No behavior-level time history disclosure, chart, pop-up, table, empty
  placeholder, or new report section is included.

Implementation order:
1. Add failing analytics resolver tests for per-occurrence totals, behavior
   averages, range boundaries, multiple sessions, active sessions, reset-empty
   state, and deterministic duration formatting.
2. Extend the analytics input/output types and resolver with timing-session
   summaries. Reuse the Ticket 068 duration helpers instead of duplicating
   elapsed-time math.
3. Load timing sessions for the already selected occurrence range and selected
   day without per-row database queries.
4. Add the conditional Average tracked time row to the existing behavior
   outcome metadata.
5. Add the conditional Tracked time row to each selected-day occurrence summary
   between Time of behavior and Status.
6. Add Reset tracked time to the existing per-occurrence Review disclosure and
   refresh Behaviors and Timeline after success.
7. Update UI/product docs, interaction traceability, user guidance, and tests.

Acceptance criteria:
- A behavior with recorded timing in the selected range shows one line such as
  `Average tracked time  2m 14s` in its existing outcome metadata.
- A behavior without recorded timing in the selected range renders no Average
  tracked time line and consumes no placeholder space.
- Changing between 7, 30, and 90 days recalculates the average from occurrences
  inside that selected local-date range.
- Multiple stopped sessions on one occurrence are summed before that occurrence
  contributes one value to the behavior average.
- An occurrence with an active session and no stopped session does not affect
  the average.
- Selecting a non-empty behavior calendar day keeps the existing Review
  selected day panel and adds Tracked time only to occurrences with timing
  data.
- Reset tracked time from Review selected day deletes that occurrence's timing
  sessions, refreshes the average, removes the Tracked time row when no timing
  remains, and does not change Status or Note.
- Behavior adherence, status counts, heatmaps, tracking-since metadata, and
  category counts retain their existing meaning and do not include duration
  data.
- The UI remains sparse, divider-based, mobile-responsive, and accessible. No
  new modal, table, disclosure, chart, route, or design token is added.

Documentation updates required during implementation:
- `docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md`: define
  the average formula, conditional visibility, selected-day row, and reset
  correction path.
- `docs/AGENT_RESOLVERS.md`: record analytics ownership of timing aggregation
  and forbid component-side duration calculations.
- `docs/ROUTE_MAP.md`: note the additive Behaviors review content without a new
  route.
- `docs/INTERACTION_REGISTRY.md`, `interaction-registry.json`,
  `load-tests/scenarios/interaction-map.json`, and
  `docs/user-guide/behaviors-and-review.md`: trace the reset control on the
  Behaviors surface when needed.
- `STATUS.md`: mark Ticket 069 in progress before implementation and record
  verification at completion.

Suggested files:
- `lib/types/analytics.ts`
- `lib/resolvers/analytics.resolver.ts`
- `lib/services/analytics.service.ts`
- `lib/db/timeSessions.repo.ts`
- `app/(app)/behaviors/actions.ts`
- `app/(app)/behaviors/page.tsx`
- `components/behaviors/BehaviorList.tsx`
- `tests/analytics.resolver.test.ts`
- `tests/behavior-review-ui.test.tsx`
- `tests/time-tracking.service.test.ts`
- product, resolver, route, interaction, and user-guide docs listed above
- `STATUS.md`

Verification:
- Run focused analytics, time-tracking service, and behavior-review UI tests.
- Run `node .agents/skills/impeccable/scripts/context.mjs` before UI edits and
  verify the result against `.agents/skills/impeccable/reference/product.md`.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.

Out of scope:
- Time history UI, charts, trend lines, target durations, expected-duration
  configuration, category/overall duration dashboards, session editing,
  manual timing entry, a separate timing range, new routes, modals, AI
  interpretation, or changes to adherence semantics.

---

## Ticket 070: Privacy-gated time-tracking exports

Add an Include time tracking option to Export & Import so exact activity
timestamps and derived durations remain excluded by default and enter export
artifacts only after an explicit user choice.

Dependencies:
- Tickets 068 and 069 must be complete so persistence, duration derivation,
  reset behavior, and aggregate semantics are stable before export formats
  adopt them.
- Existing export range, archived-behavior, note, rate-limit, circuit-breaker,
  BehaviorLog conformance, and download-route behavior must remain intact.

Settled product and privacy decisions:
- The option label is `Include time tracking`.
- The option is off by default on the page and on every direct download route.
- Exact timing-session timestamps can reveal activity patterns. The option copy
  must state that time tracking is omitted from every export unless selected.
- The query parameter is `include_time_tracking=1`. Other values do not enable
  inclusion.
- When disabled, the export service does not read timing sessions and all
  existing export shapes remain unchanged.
- When enabled, include timing sessions attached only to occurrences and
  behaviors already included by the selected range and archived-behavior
  option.
- Raw exports may include a running session with `stopped_at = null`.
  `duration_seconds` remains null for that running session.
- Derived totals and averages include stopped sessions only and use the same
  aggregation semantics as Ticket 069.
- Timing history remains export-only in this ticket. BehaviorLog import and
  restore validate the optional Cadence file and disclose that they do not
  replay timing sessions.

Format contract when Include time tracking is disabled:
- Full JSON omits the `time_sessions` property rather than emitting an empty
  array.
- JSONL emits no `time_session` records or timing-derived fields.
- CSV preserves its current columns and emits no timing data.
- BehaviorLog omits the timing file and timing extension declaration.
- Markdown summary omits timing counts, totals, averages, and timing guidance.
- Filenames retain the current format.

Format contract when Include time tracking is enabled:
- Full JSON adds an optional `time_sessions` root containing the raw included
  sessions plus derived `duration_seconds` for stopped sessions.
- App-native JSONL adds one `time_session` record per included session with
  session, occurrence, and behavior IDs; start/stop instants; and nullable
  derived duration.
- App-native occurrence CSV preserves one row per occurrence and adds
  `tracked_duration_seconds`, `time_session_count`, and a `time_sessions` JSON
  column containing the included raw session array.
- BehaviorLog adds
  `raw/cadence/occurrence_time_sessions.jsonl` as an optional, hashed,
  Cadence-specific file and declares its path, record count, ordering, and
  `export_only` support under `manifest.extensions.app.cadence`.
- Markdown summary adds behavior-level stopped-session count, recorded total,
  and average tracked time without listing every exact timestamp.
- The Export selected-range summary may show Timing sessions only while the
  option is enabled.
- Export filenames add `with-time-tracking` so sensitive artifacts are
  identifiable after download.

Implementation order:
1. Add failing resolver tests proving the option defaults off and that disabled
   artifacts contain no raw or derived timing data.
2. Extend export input/output types with optional timing-session inputs and an
   explicit `includeTimeTracking` flag.
3. Add the unchecked checkbox and privacy copy to the existing Options form.
4. Thread `include_time_tracking=1` through page search params, download links,
   shared download parsing, export page data, and direct routes.
5. Read timing sessions only when enabled and only for already included
   occurrence IDs. Use a separate owner-scoped repository read rather than
   changing the Export-page read RPC or adding another migration.
6. Implement the Full JSON, JSONL, CSV, BehaviorLog, filename, range-summary,
   and Markdown contracts above in the export resolver.
7. Update import/restore validation and copy so the optional Cadence file is
   accepted, hash-checked, and explicitly not replayed.
8. Update interaction traceability, privacy/export docs, user guidance, and
   full verification.

Acceptance criteria:
- Export & Import shows an unchecked Include time tracking checkbox beside the
  existing options with factual sensitivity copy.
- Applying export options preserves the selected timing value, and every
  download link includes `include_time_tracking=1` only when selected.
- Calling any export download route without the exact opt-in parameter omits
  timing data, even if the account has timing sessions.
- Disabled exports do not query timing-session rows and do not expose session
  existence through counts, filenames, empty arrays, optional files, Markdown,
  or derived fields.
- Enabled exports include only timing sessions attached to occurrences inside
  the selected export scope.
- Reset sessions deleted by Ticket 068 do not appear in later exports.
- Running sessions preserve their start instant and null stop/duration without
  entering stopped-session averages.
- Full JSON, JSONL, CSV, BehaviorLog, and Markdown outputs satisfy the settled
  format contracts and remain deterministic.
- BehaviorLog manifest hashes, file counts, extension metadata, conformance
  checks, and ZIP packaging pass with and without the optional timing file.
- Import and restore accept a valid Cadence timing file without treating it as
  a core record, do not write timing sessions, and clearly disclose the
  export-only limitation.
- Export rate limiting, circuit breakers, authentication, RLS, CSV formula
  protection, note privacy, archived filtering, and behavior-definition
  history remain unchanged.

Documentation updates required during implementation:
- `docs/EXPORT_FORMATS.md`: document the default-off option, privacy rationale,
  format-specific inclusion, range rules, running-session semantics, and
  export-only import/restore limitation.
- `docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md`: document
  the Export option and default omission.
- `docs/DATA_MODEL.md`: note export filtering and derived-duration semantics
  without adding another schema field.
- `docs/AGENT_RESOLVERS.md`: record export resolver ownership for timing
  filtering and formatting.
- `docs/INTERACTION_REGISTRY.md`, `interaction-registry.json`,
  `load-tests/scenarios/interaction-map.json`, and
  `docs/user-guide/data-portability.md`: register and explain the opt-in.
- `STATUS.md`: mark Ticket 070 in progress before implementation and record
  verification and the remaining export-only restore limitation at completion.

Suggested files:
- `components/export/ExportPanel.tsx`
- `app/(app)/export/page.tsx`
- `app/api/export/_shared.ts`
- `lib/types/export.ts`
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `lib/db/timeSessions.repo.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/resolvers/behaviorlog-restore.resolver.ts` only if its optional-file
  disclosure is resolver-owned
- `tests/export-panel-ui.test.tsx`
- `tests/export-download-route.test.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- focused BehaviorLog import/restore validation tests
- product, export, resolver, interaction, and user-guide docs listed above
- `STATUS.md`

Verification:
- Run focused export option, resolver, route, CSV, BehaviorLog conformance,
  import validation, and restore validation tests first.
- Verify disabled fixtures contain no timing field name, timestamp, count,
  filename suffix, manifest entry, or Markdown section.
- Verify enabled fixtures cover multiple sessions, a running session, reset
  omission, archived filtering, 7/30/90/all ranges, deterministic ordering,
  CSV JSON escaping, and manifest hashing.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.

Out of scope:
- Importing or restoring timing sessions, enabling time tracking by default,
  separate time-tracking downloads, time-history UI, charts, provider calls,
  public sharing, automatic redaction, configurable timestamp precision,
  generalized measurement export profiles, or changing the BehaviorLog core
  schema.

---

## Ticket 071: Mobile Timeline refresh and completion-feedback regressions

Add pull-to-refresh to the mobile Timeline and fix two reported mobile
regressions: duplicate completion-chime playback and the Completed label moving
out of the summary row when an occurrence opens.

Report context:
- The owner reported all three items on 2026-08-04 with two screenshots of an
  expanded and collapsed Timeline state.
- The screenshots contain personal Behavior content. The owner explicitly
  approved adding them to the repository on 2026-08-04 as Ticket 071 evidence.
- Evidence: [collapsed Timeline](qa/ticket-071/timeline-collapsed.png) and
  [expanded status misalignment](qa/ticket-071/timeline-expanded-status-misalignment.png).
- The prior UI contract allowed expanded rows to pin status at the top-right.
  The owner intentionally replaced that rule: the resolved status label stays
  horizontally parallel to the behavior title while details open below it.

Dependencies:
- Preserve the existing resolver-owned Timeline groups, status persistence,
  optimistic state, completion feedback, timing controls, Notes, and Needs
  decision behavior.
- Run the project-local impeccable context workflow before editing Timeline UI.
- Do not treat pull-to-refresh as permission to add PWA caching, offline reads,
  offline writes, or a pending mutation queue.

Required investigation order for the duplicate chime:
1. Add a focused regression harness before changing playback code. It must
   represent one mobile activation sequence and one successful status action.
2. Make the harness observe both status submissions and completion-chime
   playback attempts or the existing playback-start event. It must fail if one
   confirmed transition produces two playback attempts.
3. Reproduce the report in a real mobile browser path. Prefer the reported
   browser when known; otherwise cover mobile WebKit and mobile Chromium.
4. Use the failing test and browser instrumentation to identify the duplicate
   trigger. Record the verified cause in `STATUS.md`.
5. Fix that cause. Do not add an arbitrary timeout or broad debounce unless the
   test proves it represents the duplicate event source.
6. Keep regression cases for touch/pointer/click/submit ordering, React
   remounts, route refresh, and an already-Completed occurrence where relevant
   to the verified cause.

Pull-to-refresh requirements:
- Enable the gesture only on the mobile Timeline surface when its scroll
  container is already at the top.
- A downward pull that crosses a clear threshold and is then released refreshes
  the current Timeline data exactly once.
- Show restrained pull and refreshing feedback without adding a permanent
  toolbar, card, modal, route, or design token.
- Short pulls, horizontal gestures, cancelled gestures, and pulls started below
  the top must preserve normal scrolling and must not refresh.
- Status buttons, occurrence disclosures, Notes, timing controls, the mobile
  navigation drawer, and Needs decision controls must keep their existing
  touch behavior.
- Refresh must not mark, unmark, edit, start, stop, reset, or otherwise mutate
  an occurrence. It only requests fresh Timeline data.
- One gesture must not combine a custom refresh with a second native refresh.
  The implementation should define and test how browser overscroll is handled.

Completion-chime requirements:
- One successful user-initiated transition from a non-Completed state to
  Completed produces at most one playback attempt and one playback-start event.
- One mobile tap must submit one status mutation. A duplicated playback must
  not be hidden while two mutations still occur.
- Not Completed, Note saves, pull-to-refresh, ordinary route refreshes, failed
  status actions, and re-saving an already Completed occurrence remain silent.
- Browsers that block audio should preserve the existing factual blocked path.
  The fix must not fake a successful playback signal.

Expanded-row alignment requirements:
- Opening a Completed occurrence keeps its Completed label in the summary row,
  horizontally parallel to the behavior title.
- Expanded Description, Category, Schedule, Track Time, Change status, and Note
  content flows below the complete summary row and cannot push the label down.
- The alignment must hold at the supported mobile widths, with long behavior
  titles, and while timing or Note content is present.
- Preserve the corresponding Not Completed row structure and collapsed-row
  alignment. Do not change stored status semantics or row colors.

Acceptance criteria:
- A mobile pull from the top crosses the threshold, releases, shows bounded
  refresh feedback, and refreshes Timeline data once.
- Gesture tests prove that non-qualifying pulls do not refresh or mutate data.
- A test added before the sound fix reproduces the duplicate chime path or
  isolates the exact duplicate trigger observed through browser
  instrumentation.
- One successful mobile Completed action produces one status submission and
  one chime playback attempt. The regression test fails if playback occurs
  twice.
- Opening Completed rows at 320px and 390px keeps the status label parallel to
  the behavior title. A long-title fixture and an expanded-detail fixture both
  pass without horizontal overflow.
- Browser QA covers mobile WebKit and Chromium when available. Any unavailable
  browser or device remains explicitly unverified.
- Product docs, interaction traceability, design-system Timeline fixtures, and
  user guidance match the implemented behavior.

Documentation and traceability required during implementation:
- `docs/UI_SPEC.md` and `docs/USER_FLOWS.md`: reconcile the recorded target
  behavior with the final gesture, exact-once sound, and summary-row details.
- `docs/INTERACTION_REGISTRY.md`, `interaction-registry.json`, and
  `load-tests/scenarios/interaction-map.json`: register pull-to-refresh and
  update any affected status-action coverage after implementation.
- `DESIGN.md` and the design-system bench: preserve the expanded resolved-row
  alignment and mobile gesture feedback pattern.
- `docs/user-guide/timeline.md`: explain mobile pull-to-refresh only if the
  gesture needs user-facing guidance.
- `STATUS.md`: mark the ticket in progress before implementation and record the
  sound root cause, verification, and any device gaps at completion.

Suggested files:
- `components/timeline/Timeline.tsx`
- `components/timeline/TimelineGroup.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `components/timeline/StatusButtons.tsx`
- a focused mobile pull-to-refresh client component or hook
- focused Timeline interaction, status-button audio, and expanded-row UI tests
- design-system Timeline fixtures and the docs listed above
- `docs/qa/ticket-071/timeline-collapsed.png`
- `docs/qa/ticket-071/timeline-expanded-status-misalignment.png`
- `STATUS.md`

Verification:
- Run the new focused sound regression test before and after the fix, retaining
  evidence that it failed for the reproduced cause and passed after correction.
- Run focused pull gesture, Timeline UI, status action, and completion-feedback
  tests.
- Run `node .agents/skills/impeccable/scripts/context.mjs` before UI edits and
  verify the result against `.agents/skills/impeccable/reference/product.md`.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.
- Run authenticated mobile browser QA at 320px and 390px, plus real touch
  browser QA when available.

Out of scope:
- Offline/PWA caching, offline mutation, background sync, service-worker data
  caching, native mobile apps, haptics, new sounds, sound settings, changes to
  status semantics, Timeline routes, or broad Timeline redesign.

---

## Future ticket: Workspace restructuring

Broader restructuring remains deferred. Tickets 107–114 add the desktop and
shared core/UI workspaces while leaving Next.js at the repository root. Moving
Next.js into `apps/app` or adding other packages still needs a separate ticket.

Target shape:

```text
apps/
  app/
  marketing/
  desktop/
  mobile/
packages/
  core/
  db/
  ui/
  config/
```

Acceptance criteria should include:
- Preserve all current authenticated app routes and behavior.
- Preserve Supabase, Sequenzy, Vercel, test, and drift-check workflows.
- Start with npm workspaces unless Turborepo is justified.
- Extract `packages/core` before broader UI sharing when a second runtime needs
  the logic.
- Keep `packages/ui` focused on tokens and primitives first because future
  surfaces may use different frameworks.

---

## Ticket 072: BehaviorLog 0.2.0-draft conformance — intervention repair and schema unfork

Align the BehaviorLog export with upstream `0.2.0-draft` and remove every
divergence between Cadence's emitted records and the canonical schema. The
2026-08 parity audit found Cadence interventions fail canonical validation on
three counts and that the embedded `schema.json` is a fork that legitimizes
them.

Dependencies:
- Upstream BehaviorLog-Bundle repo at `0.2.0-draft` (Intervention
  `failure_reason`, canonical profile identifiers, hardened reference
  validator).

Settled decisions:
- Intervention records emit `planned_for_utc` (was `scheduled_send_at_utc`)
  and map Cadence delivery status `pending` to `planned`. `sent`, `failed`,
  and `cancelled` map unchanged. `pending` never appears in a bundle.
- `failure_reason` stays top-level and keeps the existing sanitization; the
  upstream field now exists, so this becomes conformant rather than divergent.
- The embedded `schema.json` is a byte-exact copy of the upstream
  `0.2.0-draft` canonical schema, not a Cadence-generated variant. Delete the
  local schema-generation divergence.
- `manifest.profiles` uses canonical identifiers only: `core`, `intervention`,
  and later `definition_history` and `time_tracking`. Drop `notes` (notes are
  optional core surface, not a profile) and the plural `interventions`.
- `manifest.schema_version` becomes `0.2.0-draft`. Import continues to accept
  `0.1.0-draft` and adds `0.2.0-draft`.
- Re-pin `tests/fixtures/behaviorlog-reference/` to the upstream `0.2.0-draft`
  validator snapshot and record the new commit in `SNAPSHOT.md`. The hardened
  validator now errors on unknown intervention fields and `pending`, which is
  the regression net this ticket needs.

Implementation order:
1. Re-pin the reference-validator snapshot and watch the conformance test fail
   against current output.
2. Fix the intervention record mapping and manifest profile identifiers in the
   export resolver.
3. Replace the generated embedded schema with the canonical copy.
4. Update import validation to accept both schema versions and the renamed
   intervention field from newer bundles while still reading `0.1.0-draft`
   bundles produced before this ticket.
5. Update `docs/EXPORT_FORMATS.md` and conformance tests.

Acceptance criteria:
- `npm run behaviorlog:conformance` passes against the pinned `0.2.0-draft`
  validator with zero errors and zero warnings for a resolver-generated bundle
  containing interventions.
- An exported intervention round-trips through Cadence import preview without
  `unsupportedFields` entries.
- A fixture bundle with `delivery_status: "pending"` fails import validation
  with a clear error.
- Existing `0.1.0-draft` bundles (pre-repair fixtures) still import, with the
  legacy field and status names normalized on read.

Suggested files:
- `lib/resolvers/export.resolver.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `tests/fixtures/behaviorlog-reference/*`
- `tests/behaviorlog-conformance.test.ts`
- `tests/export.resolver.test.ts`
- `docs/EXPORT_FORMATS.md`

---

## Ticket 073: Export Definition History, Time Tracking, and Intervention Rules profiles

Replace the `raw/cadence/` export-only files with the first-class `0.2.0-draft`
profiles so definition history, time sessions, and reminder configuration
become portable to any BehaviorLog reader.

Dependencies:
- Ticket 072.

Settled decisions:
- Behavior definition events export as `data/behavior_definition_events.jsonl`
  with `record_type: "behavior_definition_event"`. Cadence's first row per
  behavior maps to `event_kind: "baseline"` with `previous: null`; later rows
  map to `revision` with full previous/next title and description objects and
  `changed_fields` limited to `title`/`description`. `reason` maps to
  `reason_code`; source `manual`/`import`/`system` maps to capture methods
  `manual_text`/`imported`/`system_generated`.
- The `raw/cadence/behavior_definition_events.jsonl` file and its manifest
  extension declaration are removed. Full JSON keeps the app-native shape.
- Time sessions export as `data/time_sessions.jsonl` with
  `record_type: "time_session"`, still gated by `include_time_tracking=1`.
  The standard records carry start/stop instants and NO duration field;
  running sessions keep `stopped_at_utc: null`. App-native formats keep
  `duration_seconds`. The manifest sets
  `privacy.contains_time_tracking: true` when the file is present, and the
  `raw/cadence/occurrence_time_sessions.jsonl` file is removed.
- Per-behavior reminder settings export as `data/intervention_rules.jsonl`:
  one enabled rule per enabled channel with deterministic
  `rule_id` (`rule_reminder_<behaviorId>_<channel>`),
  `offset_minutes = -reminder_offset_minutes`, and `enabled: true`. Disabled
  channels emit no rule. Intervention records set `rule_id` to the matching
  rule.
- `manifest.profiles` adds `definition_history` and `time_tracking` exactly
  when the corresponding files are present.
- The manifest declares `rules.definition_history_policy: "event_sourced"`,
  since Cadence records every title/description change as a definition event.
- Reminder flags stay duplicated under `extensions.app.cadence` for one
  release for backward compatibility, then may be dropped by a later ticket.

Acceptance criteria:
- Conformance passes with the three new files present and zero warnings,
  including the upstream validator's new privacy-flag, rule-reference, and
  definition-consistency checks.
- Definition-history and time-session content matches Full JSON for the same
  export options, minus app-only fields.
- No `raw/cadence/` files remain in the bundle export.
- Export & Import screen copy reflects that definition history and timing now
  travel in standard files.

Suggested files:
- `lib/resolvers/export.resolver.ts`
- `lib/services/export.service.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- `docs/EXPORT_FORMATS.md`

---

## Ticket 074: Import and restore replay for definition history and time sessions

Close the portability chain the audit flagged: imported bundles carrying the
new profiles should reconstruct revision history and timing sessions instead
of validating and discarding them.

Dependencies:
- Tickets 072 and 073.

Settled decisions:
- Create-mode and approved-merge imports replay
  `data/behavior_definition_events.jsonl` for behaviors they create: baseline
  and revision rows insert into `behavior_definition_events` with
  `source = 'import'`, preserving imported `recorded_at` ordering and full
  previous/next text. The locally generated import baseline is emitted only
  when the bundle carries no baseline for that behavior.
- Restore replays the imported revision trail for restored behaviors under
  the same rules instead of recording only a snapshot transition.
- `data/time_sessions.jsonl` rows import into `occurrence_time_sessions` for
  safely mapped occurrences. A running imported session (null stop) imports
  as stopped-at-null only if the occurrence has no other running session;
  otherwise it is skipped with a warning.
- Both replays are idempotent through `behaviorlog_import_record_mappings`
  with new record types `behavior_definition_event` and `time_session`.
- Unmappable events and sessions become skip actions with warnings, never
  hard failures of the whole import.

Acceptance criteria:
- Export → wipe → restore reproduces the full definition-event trail
  (baselines, revisions, reasons, timestamps) and all stopped time sessions.
- Re-applying the same accepted import creates zero duplicate events or
  sessions.
- Merge preview shows planned definition-event and time-session actions with
  counts before apply.
- The mappings table check constraint covers the two new record types.

Suggested files:
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/services/behaviorlog-restore.service.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `supabase/migrations/*_extend_import_mapping_record_types.sql`
- `tests/behaviorlog-import-write.service.test.ts`
- `tests/behaviorlog-restore-apply.service.test.ts`

---

## Ticket 075: Re-export imported passive data with provenance

Data imported from another app currently dies inside Cadence: `imported_notes`
and `imported_interventions` never re-export, and import parsing drops most
source provenance. Fix both so Cadence can sit in the middle of a portability
chain.

Dependencies:
- Ticket 072.

Settled decisions:
- The BehaviorLog export includes `imported_notes` rows as `note` records
  (`note_role: "imported"`, original attachment type and mapped local target,
  preserved sensitivity, `source.imported_from` and `source.original_id`
  from stored metadata) when the include-notes option is selected and the
  attachment target is inside the export scope.
- `imported_interventions` rows export as additional intervention records
  with `source.capture_method: "imported"` and preserved external provenance,
  alongside the operational reminder-delivery interventions.
- Import parsing retains `source.producer`, `producer_version`,
  `imported_from`, and `transformation_notes` into the existing `metadata`
  jsonb on `imported_notes` and `imported_interventions`. No migration.
- `manifest.privacy.contains_notes` accounts for imported notes.
- Promotion-created reminder deliveries do not double-export: an operational
  delivery with `imported_intervention_id` set suppresses the passive row's
  separate intervention record.

Acceptance criteria:
- Bundle A imported into Cadence and re-exported yields A's notes and
  intervention history with `imported` provenance and stable original IDs.
- No duplicate intervention records for promoted reminders.
- Conformance passes with mixed operational and imported intervention records.

Suggested files:
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/db/importedInterventions.repo.ts`
- `lib/db/behaviorLogImports.repo.ts`
- `tests/export.service.test.ts`
- `tests/behaviorlog-import-notes.test.ts`

---

## Ticket 076: Export honesty fixes — health flag, synthetic semantics, synthesis notes

Three small truthfulness fixes in the BehaviorLog export surfaced by the
audit.

Dependencies:
- Ticket 072.

Settled decisions:
- `manifest.privacy.contains_health_data` is `true` when any included
  behavior maps to canonical `health_wellness` or `medication_non_dose`, or
  carries the Medical or Measurements display category. It stays `false`
  otherwise.
- Synthesized status events for legacy resolved snapshots use
  `status_semantics: "system_rule_declared"` (not `explicit_user_mark`),
  keeping `capture_method: "derived"` and `confidence: "medium"`. The
  manifest `rules.status_semantics` map documents the synthesis rule.
- Behavior records whose `success_definition` is producer boilerplate carry
  `source.transformation_notes` stating the synthesis, per the updated
  MAPPING.md guidance, so agents do not read it as user intent.
- Schedule records add `behavior_schedule_id` under `extensions.app.cadence`
  so the parent grouping survives for readers that care.

Acceptance criteria:
- A bundle with a Medical-category behavior reports
  `contains_health_data: true`; one without health-adjacent behaviors reports
  `false`.
- Synthesized events are distinguishable from explicit user marks in the
  exported status-event stream.
- Conformance and existing import tests pass unchanged otherwise.

Suggested files:
- `lib/resolvers/export.resolver.ts`
- `tests/export.resolver.test.ts`
- `docs/EXPORT_FORMATS.md`

---

## Ticket 077: Import and restore fidelity — custom ranges, categories, reminder config, archival pairing

Round-trip fixes for data Cadence itself supports but currently drops or
mangles on the way back in.

Dependencies:
- Tickets 072 and 073.

Settled decisions:
- Import accepts arbitrary `window_start_local`/`window_end_local` ranges as
  custom range slots (`kind: 'range'`, `preset: null`) instead of rejecting
  non-preset ranges. Preset labels in extensions still map to presets.
- Restore reassigns behavior categories: match existing categories by
  normalized display name from `extensions.app.cadence.category_name`
  (fallback: canonical category), create the category when absent, and link
  `category_id`. Create-mode import keeps its existing no-create matching.
- Create-mode import and restore apply reminder configuration from
  `data/intervention_rules.jsonl` when present (enabled channels and negated
  `offset_minutes`), falling back to `extensions.app.cadence` reminder flags
  from older bundles.
- `active` derives strictly from `archived_at_utc`: null means active. A
  contradictory `extensions.app.cadence.active: false` with a null archive
  timestamp is ignored and reported as an import warning, eliminating the
  `active=false, archived_at=null` state the audit found.
- When multiple imported schedules share a `behavior_schedule_id` extension
  value, import reconstructs one `behavior_schedules` parent with multiple
  slots instead of parentless flat slots.

Acceptance criteria:
- A Cadence export with a custom 07:15–09:40 range slot round-trips to an
  identical slot.
- Export → wipe → restore reproduces category assignments, reminder settings,
  and schedule-parent grouping.
- No import path can produce `active = false` with `archived_at = null`.
- RLS and schedule-integrity tests still pass.

Suggested files:
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/services/behaviorlog-restore.service.ts`
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `tests/behaviorlog-import-merge-preview.test.ts`
- `tests/behaviorlog-restore-apply.service.test.ts`
- `docs/EXPORT_FORMATS.md`
- `docs/DATA_MODEL.md`

---

## Audit-derived tickets (078-093)

Tickets 078 through 093 come from a repository-wide read-only audit run on
2026-08-06 across five independent passes: domain resolvers/services/repos,
routes/auth/API, import/restore/export, UI/interaction, and
schema/marketing/ops. Every finding cited below was verified against the
source; no fix was applied during the audit.

Suggested order: 078, 079, 080, 081, 082, 083 first. Those cover silent data
loss, an outbound-email abuse vector, permanently stuck reminder state,
truncated exports, unbounded push fan-out, and an account-deletion lockout.
The rest may be scheduled normally.

---

## Ticket 078: Preserve unresolved occurrences earlier in the current day

Stop behavior edits from deleting unresolved occurrences that were already
scheduled earlier today, along with their notes and tracked time.

Context:
- `resolveGenerationWindow` starts the window at local midnight of the current
  day (`lib/resolvers/occurrence.resolver.ts:469-474`).
- `deleteUnresolvedIds` removes every unresolved occurrence inside that window
  that the new schedule no longer generates
  (`lib/resolvers/occurrence.resolver.ts:293-303`). It has no guard for
  scheduled instants earlier than `now`.
- `docs/DATA_MODEL.md:1047` states only "Future unresolved occurrences may be
  regenerated." The implementation contradicts the contract.
- The occurrence row owns its `note` column, and `occurrence_time_sessions`
  cascades on occurrence delete
  (`supabase/migrations/20260802000000_add_occurrence_time_sessions.sql:13`).
  Both are destroyed with no warning and no undo.
- Reproduction: at 14:00 local, a behavior has an unresolved 08:00 occurrence
  today carrying a note and two stopped time sessions. Editing the behavior so
  its schedule starts at 09:00 deletes the 08:00 row, its note, and its
  sessions.

Settled decisions:
- Deletion eligibility narrows to occurrences whose scheduled instant is
  strictly after `now`. The generation window itself is unchanged, so
  regeneration behavior for the rest of today is unaffected.
- Independently of timing, an occurrence is never deleted when it has a
  non-empty note or any `occurrence_time_sessions` row. This is a second,
  independent guard, not a replacement for the time rule.
- Preserved occurrences that the new schedule no longer produces remain stored
  as unresolved on their original date. The user still owes them a decision;
  they are not rewritten, retimed, or auto-resolved.
- `now` continues to be injected into the resolver. Do not read the clock
  inside `lib/resolvers`.

Implementation order:
1. Add failing resolver tests for: an unresolved past-instant occurrence today,
   an unresolved future occurrence today, an unresolved past occurrence with a
   note, and one with a stopped time session.
2. Narrow `deleteUnresolvedIds` in `lib/resolvers/occurrence.resolver.ts`.
3. Thread note and time-session presence into the deletion planner input so the
   resolver can apply the second guard without querying anything itself.
4. Update `docs/DATA_MODEL.md` if the wording needs to state the note and
   time-session guard explicitly.

Acceptance criteria:
- Editing a behavior at 14:00 preserves an unresolved 08:00 occurrence from the
  same day, including its note and time sessions.
- Editing a behavior still removes unresolved occurrences scheduled later today
  and on future days when the new schedule no longer produces them.
- An unresolved occurrence carrying a note or a time session is never deleted
  by a schedule edit, regardless of its scheduled instant.
- Resolved occurrences and past-day occurrences remain preserved as before.
- `npm run resolvers:check` and the full test suite pass.

Suggested files:
- `lib/resolvers/occurrence.resolver.ts`
- `lib/services/occurrence.service.ts`
- `tests/occurrence.resolver.test.ts`
- `docs/DATA_MODEL.md`

---

## Ticket 079: Profile email integrity and reminder recipient trust

Stop an authenticated account from redirecting Cadence's transactional email to
an arbitrary address.

Context:
- `profiles.email` is directly writable by its owner. The base schema grants
  table-wide DML (`supabase/migrations/20260607204951_create_database_schema.sql:292`)
  and the RLS policy is scoped only by `id = auth.uid()` (`:166-180`). There is
  no column-level restriction, and the only trigger on the table is
  `set_profiles_updated_at`.
- `handle_new_user` seeds the email at signup and nothing re-syncs it
  afterward.
- The reminder processor reads that value as the recipient
  (`lib/services/reminder.service.ts:455`) and passes it to Sequenzy as `to`
  (`lib/services/sequenzy.service.ts:78-95`). The behavior title flows into the
  template variables, so the message body is partly attacker-controlled.
- Attack: sign up, set `profiles.email` to a victim's address through the Data
  API, create a behavior with email reminders and a chosen title, then
  repeatedly reset sent `reminder_deliveries` rows to
  `status='pending', processing_started_at=null` — the same table-wide grant
  permits it (`:296`). Result is repeated mail to a third party from the
  project's sending domain and reputation.
- Verified safe to narrow: `lib/db/profiles.repo.ts` only ever issues
  `.update({ timezone })`. No user-scoped app code writes `email` or
  `display_name`.
- Verified NOT safe to blanket-revoke: `reminder_deliveries` is written by the
  user-scoped client during interactive sync
  (`lib/services/occurrence.service.ts:646`, `:775` create a user client and
  reach `syncCoveredReminderDeliveries`). Revoking DML there would break the
  app.

Settled decisions:
- Replace the table-wide profiles grant with a column grant:
  `grant update (timezone) on public.profiles to authenticated`. `email`,
  `display_name`, `id`, and the timestamps become non-writable by the
  `authenticated` role.
- Keep `profiles.email` correct by syncing it from `auth.users` on update,
  mirroring the existing `handle_new_user` insert path, so a provider-side
  email change still propagates.
- Add a `before update` trigger on `reminder_deliveries` that rejects, for any
  role other than `service_role`, a transition out of a terminal status
  (`sent`, `failed`) back to `pending`, and rejects clearing a non-null
  `processing_started_at`. This kills the recycle vector while leaving the
  app's legitimate pending-plan and cancel writes working.
- The reminder recipient continues to read from `profiles.email`, which is
  trustworthy once the column is locked. Do not add a second identity lookup.

Acceptance criteria:
- An authenticated Data API client cannot change its own `profiles.email` or
  `display_name`; a timezone update from Settings still succeeds.
- An authenticated client cannot move a `sent` or `failed` reminder delivery
  back to `pending`, nor clear `processing_started_at`.
- An email change at the identity provider propagates to `profiles.email`.
- Reminder planning, cancellation, and interactive occurrence sync all still
  work through the user-scoped client.
- `npm run smoke:rls` is extended to cover both new restrictions and passes.

Suggested files:
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `scripts/supabase-rls-smoke.mjs`
- `lib/db/profiles.repo.ts`
- `docs/DATA_MODEL.md`
- `tests/supabase-function-permissions-migration.test.ts`

---

## Ticket 080: Reminder pipeline reliability — claim recovery, cancel race, channel isolation

Three defects in one surface: reminders can be stranded forever, can send after
the user resolves the occurrence, and can be blocked entirely by unrelated
email configuration.

Context:
- Claim stranding: claiming sets `processing_started_at`
  (`lib/db/reminderDeliveries.repo.ts:236`), and every due query requires
  `.is("processing_started_at", null)` (`:154`, `:178`). Reconciliation also
  excludes claimed pending rows (`:266`). No path expires or reclaims an
  abandoned claim, and neither provider call has a bounded timeout. A killed
  serverless invocation therefore leaves a row `pending` and claimed forever:
  never sent, never logged as failed. Found independently by three audit
  passes.
- Cancel race: occurrence validation happens before the provider call
  (`lib/services/reminder.service.ts:424-484`). A status transition in that
  window cancels the delivery via the status RPC
  (`supabase/migrations/20260709203117_add_transactional_occurrence_status_change.sql:298`),
  but the post-send update filters only on delivery and user id
  (`lib/db/reminderDeliveries.repo.ts:336`), flipping the cancelled row to
  `sent`. Violates `docs/NOTIFICATION_SPEC.md:242`.
- Channel coupling: `processDueReminders` awaits email before push
  (`lib/services/reminder.service.ts:238-247`), and email processing builds the
  Sequenzy sender before checking whether any email delivery is due (`:269`).
  A deployment with VAPID configured and Sequenzy absent gets no browser
  reminders at all.

Settled decisions:
- A claim older than 15 minutes is reclaimable. Due queries select rows where
  `processing_started_at is null or processing_started_at < now() - interval
  '15 minutes'`, and the claim update carries the same predicate so two workers
  cannot both win a reclaim.
- Reclaiming an abandoned row counts as a retry, not a failure. Emit a
  monitoring event when a reclaim occurs so stranding becomes visible.
- Provider calls get a bounded timeout via `AbortSignal.timeout` at 10 seconds.
  A timeout records a delivery failure through the existing failure path.
- The terminal `sent` update adds `status = 'pending'` to its filter. If it
  updates zero rows the delivery was cancelled mid-flight: log it and do not
  resurrect the row. Report it in the result counters as cancelled, not sent.
- The Sequenzy sender is constructed lazily, only after the due-email query
  returns at least one row. Each channel is isolated so one channel's
  configuration or provider failure cannot abort the other.
- Do not move reminder orchestration out of `lib/services`. Resolvers stay
  pure.

Acceptance criteria:
- A delivery claimed more than 15 minutes ago and never completed is picked up
  by the next run and sent exactly once.
- Two concurrent workers cannot both claim the same reclaimable row.
- A status change that cancels a delivery mid-send leaves the row `cancelled`,
  never `sent`.
- With Sequenzy env vars absent and no email deliveries due, browser push
  reminders still process normally.
- With Sequenzy env vars absent and email deliveries due, those deliveries
  record a failure and push still processes.
- A hung provider call fails the delivery within the timeout instead of
  stranding it.

Suggested files:
- `lib/services/reminder.service.ts`
- `lib/db/reminderDeliveries.repo.ts`
- `lib/services/sequenzy.service.ts`
- `lib/services/web-push.service.ts`
- `tests/reminder.service.test.ts`
- `docs/NOTIFICATION_SPEC.md`

---

## Ticket 081: Complete reads for export and restore

Stop exports and restores from silently truncating at the PostgREST row cap.

Context:
- `listTimeSessionsByOccurrenceIds` (`lib/db/timeSessions.repo.ts:15-27`) and
  `listBehaviorDefinitionEvents`
  (`lib/db/behaviorDefinitionEvents.repo.ts:181-205`) are plain unpaginated
  selects — no `.range()`, no `.limit()`, no loop. They are bounded by the
  configured row cap (`supabase/config.toml:18` sets `max_rows = 1000`
  locally; the hosted value was not verified during the audit and must be
  confirmed first).
- The exporter writes the truncated array length into the BehaviorLog manifest
  as the authoritative `record_count`
  (`lib/services/export.service.ts:216-241`), so a consumer cannot detect the
  loss.
- The restore and fingerprint path has the same shape for occurrences, status
  events, notes, and mappings
  (`lib/services/behaviorlog-import.service.ts:680-701`,
  `lib/db/occurrences.repo.ts:160-175`,
  `lib/db/occurrenceStatusEvents.repo.ts:138-170`, `lib/db/notes.repo.ts:44-59`).
  A restore can therefore commit while silently retaining rows it should have
  removed, because the planner never saw them.
- The main export bundle is unaffected: `readExportPageBundle` calls an RPC
  returning a single JSON row (`lib/db/exportPageRead.repo.ts:153`).
- This lands on the stated "Portable by default" product principle
  (`PRODUCT.md:50`).

Settled decisions:
- Confirm the hosted `max_rows` value before implementing, and record it in
  `docs/SUPABASE_WORKFLOW.md`.
- Add one shared paginated-read helper in `lib/db` that loops with `.range()`
  at a fixed page size until a short page returns. Every user-scoped list read
  that can grow without bound uses it.
- Pagination is not a silent best effort. The helper carries an absolute
  ceiling; reaching it throws rather than returning a partial array, so a
  future unbounded growth case fails loudly instead of truncating.
- Manifest and summary counts derive from the materialized arrays after
  pagination completes, never from a separate count query.

Acceptance criteria:
- An account with more rows than the row cap exports every time session and
  every definition event, and the manifest count equals the true count.
- A restore preview for an account above the cap sees the full local graph, so
  its fingerprint and planned actions cover every row.
- A read that would exceed the absolute ceiling throws a clear error instead of
  truncating.
- Existing export shape, ordering, and hashing tests pass unchanged.

Suggested files:
- new `lib/db/paginated-read.ts`
- `lib/db/timeSessions.repo.ts`
- `lib/db/behaviorDefinitionEvents.repo.ts`
- `lib/db/occurrences.repo.ts`
- `lib/db/occurrenceStatusEvents.repo.ts`
- `lib/db/notes.repo.ts`
- `lib/services/export.service.ts`
- `tests/export.service.test.ts`
- `docs/SUPABASE_WORKFLOW.md`

---

## Ticket 082: Push subscription bounds and account-switch recovery

Cap how much outbound work one account can create, and let a shared browser
switch accounts without stranding notification setup.

Context:
- Registration accepts any syntactically valid HTTPS endpoint with no
  per-account quota (`lib/services/push-subscription.service.ts:108-122`,
  `lib/db/pushSubscriptions.repo.ts:12`), and a successful request resets the
  route's auth-failure limiter (`app/api/push/subscribe/route.ts:142`), so that
  limiter never bites on success.
- Reminder processing loads every active subscription for the user and sends
  sequentially (`lib/services/reminder.service.ts:621-631`). The batch limit
  bounds deliveries, not subscriptions.
- One account can therefore register thousands of endpoints pointing at hosts
  of its choosing and create one due reminder, turning the cron into a blind
  sequential request generator and blowing the function time budget — which
  then strands the claimed delivery unless Ticket 080 has landed.
- Account switching: sign-out leaves the previous account's active push row
  intact (`app/auth/sign-out/route.ts:8`). If the provider reissues the same
  endpoint for the next account, the single-active-owner constraint
  (`supabase/migrations/20260722213732_enforce_single_active_push_endpoint_owner.sql:21`)
  rejects it, and the client unsubscribes the fresh subscription and reports a
  generic failure (`lib/push/browser.ts:120-173`). The repository's own test
  models this (`tests/push-browser.test.ts:399`).

Settled decisions:
- Cap active push subscriptions per account at 20. Registering past the cap
  evicts the least recently used active row rather than rejecting the new
  device, so a legitimate multi-device user is never locked out.
- Bound per-delivery fan-out: a single reminder delivery sends to at most the
  capped set, and the send loop runs with bounded concurrency rather than an
  unbounded sequential walk.
- Successful registration no longer resets the auth-failure limiter; add a
  separate, low-rate registration limiter keyed per account.
- Sign-out deactivates the current device's push subscription row for the
  departing account before clearing the session, so an endpoint reissued to the
  next account is free to claim.
- Endpoint host allowlisting is explicitly out of scope. The quota and the
  bounded fan-out are the fix; an allowlist would break self-hosted and future
  providers.

Acceptance criteria:
- An account cannot hold more than 20 active subscriptions; the 21st evicts the
  least recently used.
- One due browser reminder produces at most 20 outbound sends.
- Repeated successful registrations are rate limited per account.
- Signing out and signing in as a second account in the same browser results in
  a working subscription for the second account.
- Existing push registration, status, and delivery tests pass.

Suggested files:
- `lib/services/push-subscription.service.ts`
- `lib/db/pushSubscriptions.repo.ts`
- `lib/services/reminder.service.ts`
- `lib/push/browser.ts`
- `app/auth/sign-out/route.ts`
- `app/api/push/subscribe/route.ts`
- `tests/push-subscription.service.test.ts`
- `tests/push-browser.test.ts`
- `docs/NOTIFICATION_SPEC.md`

---

## Ticket 083: Settings write atomicity and account-deletion ordering

Make the two destructive Settings paths either fully succeed or leave state
unchanged, as their interaction contracts already promise.

Context:
- Account deletion runs `signOut({ scope: "global" })` first and only then
  constructs the service-role client and deletes the auth user
  (`lib/services/account.service.ts:33-46`). If deletion fails — missing
  `SUPABASE_SERVICE_ROLE_KEY`, transient provider error — the account still
  exists but every session is gone, and the error renders into a Settings page
  the user can no longer reach. Contradicts `INT-SETTINGS-009`
  (`interaction-registry.json:2497`), which describes a recoverable failure.
- Timezone save performs the stale marker, profile update, behavior update, and
  occurrence sync as four independent calls
  (`lib/services/settings.service.ts:74-92`). A failure after the profile write
  leaves the profile on the new zone and behaviors on the old, and background
  sync then expands behaviors in the old zone while recording coverage fresh
  under the new one. Contradicts `INT-SETTINGS-003`
  (`interaction-registry.json:2357`), which promises unchanged stored timezone
  and schedule graph on failure. Found by three audit passes.

Settled decisions:
- Account deletion reorders to: validate confirmation, construct the
  service-role client and verify it is usable, delete the auth user, then sign
  out. A failure before deletion leaves the session intact so the user can read
  the error and retry.
- The timezone save moves behind one owner-scoped atomic database function that
  updates the profile, updates active behaviors, and marks sync state stale in a
  single transaction, following the pattern already established by
  `update_behavior_with_schedule_graph`. Occurrence sync stays outside the
  transaction; it is idempotent and re-runnable.
- On failure, both actions report the specific failure and guarantee no partial
  commit. Do not add a repair path for a partial state that can no longer occur.

Acceptance criteria:
- A simulated `admin.deleteUser` failure leaves the user signed in, on
  Settings, reading a specific error, with the account intact.
- A successful deletion still revokes every session.
- A simulated failure of the behavior timezone update leaves the profile
  timezone unchanged.
- A successful timezone save updates profile and behaviors together and marks
  sync stale exactly once.
- `INT-SETTINGS-003` and `INT-SETTINGS-009` descriptions match observed
  behavior; update `interaction-registry.json` only if the settled behavior
  differs from the recorded contract.

Suggested files:
- `lib/services/account.service.ts`
- `lib/services/settings.service.ts`
- `app/(app)/settings/actions.ts`
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `tests/settings.service.test.ts`
- `tests/account.service.test.ts`
- `docs/USER_FLOWS.md`

---

## Ticket 084: Import apply concurrency fence and partial-failure recovery

Make applying an accepted import run exactly once, even under a double-click or
two tabs.

Context:
- The server does re-verify all four accepted fingerprints before writing, so
  Ticket 055's binding works
  (`lib/services/behaviorlog-import.service.ts:257-301`).
- But nothing locks local state between the check and the writes, every request
  creates its own apply run, and only *restore* has a unique accepted-preview
  fence (`supabase/migrations/20260709191905_bind_import_apply_to_accepted_preview.sql:18-29`
  versus `supabase/migrations/20260709203154_make_behaviorlog_restore_atomic_and_idempotent.sql:18-27`).
- Behavior titles carry no unique constraint
  (`supabase/migrations/20260607204951_create_database_schema.sql:23-39`), and
  writes span multiple transactions
  (`lib/services/behaviorlog-import-write.service.ts:329-511`), so a
  mid-sequence failure marks the ledger failed while leaving created rows
  behind (`:1391-1418`).
- Two tabs applying the same accepted preview both pass the fingerprint check
  before either writes, and both create the behavior with duplicated schedule
  and history. Found by two audit passes.

Settled decisions:
- Give import apply the same unique accepted-preview fence restore already has:
  at most one successful apply per accepted preview run id, enforced by a
  database constraint rather than by application checks.
- A second concurrent apply loses the fence and returns the first run's result
  as an idempotent success, not an error. The user clicked once conceptually.
- Product-row creation and its import mapping insert move into the same
  transaction, so a mapping conflict cannot leave an orphaned behavior.
- A run that fails partway is recorded as failed and its created rows are rolled
  back with it. Do not add a compensating cleanup pass; make the write
  transactional instead.

Acceptance criteria:
- Two concurrent applies of the same accepted preview produce one set of rows;
  the second returns the first's result.
- A forced failure midway through an apply leaves no product rows behind and
  the ledger marked failed.
- Retrying a failed apply from a fresh preview succeeds.
- Existing fingerprint-binding and merge-preview tests pass unchanged.

Suggested files:
- `lib/services/behaviorlog-import.service.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- `lib/db/behaviorLogImports.repo.ts`
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `tests/behaviorlog-import-apply.service.test.ts`
- `docs/EXPORT_FORMATS.md`

---

## Ticket 085: Occurrence identity for overlapping schedule time entries

Let an exact-time entry and a range entry that share a start time coexist on the
same behavior and day, as the recurrence contract already specifies.

Context:
- `docs/RECURRENCE_RULES.md:70-73` defines occurrence identity as behavior +
  local date + start time + end-time/range identity.
- The resolver honors that and plans both occurrences
  (`lib/resolvers/occurrence.resolver.ts:436-457`).
- The database key does not include range identity:
  `unique (behavior_id, scheduled_for)`
  (`supabase/migrations/20260607204951_create_database_schema.sql:63`), and the
  upsert conflict target matches it
  (`lib/db/occurrences.repo.ts:271`). Only one row survives.
- Form validation permits creating exactly this shape, because duplicate start
  times are rejected only *within* a single schedule
  (`lib/services/behavior-form.ts:459-475`: "Use each start time only once
  within a schedule").
- Result: a Daily exact 09:00 schedule plus a Monday 09:00-12:00 range schedule
  silently loses one occurrence every Monday, in Timeline, reminders, and
  analytics alike.

Settled decisions:
- Occurrence identity in the database becomes behavior + local date + start
  time + range identity, matching the documented rule.
- Implement it as a stored generated column on `occurrences` holding the range
  identity, with the unique key over
  `(behavior_id, local_date, schedule_start_time, <generated column>)`, so the
  PostgREST upsert can name real columns as its conflict target. Do not rely on
  a partial or expression index that `onConflict` cannot reference.
- Detect and report existing duplicate-suppressed rows before swapping the
  constraint. If any account already lost occurrences to this key, backfill the
  missing rows in the same migration from the owning schedule, as unresolved,
  preserving everything already stored.
- Form validation stays as-is. Two schedules sharing a start time is a
  legitimate shape once the key is fixed; do not add a cross-schedule
  uniqueness rule.

Acceptance criteria:
- A behavior with Daily exact 09:00 and Monday 09:00-12:00 produces two
  distinct occurrences every Monday, in Timeline, reminders, and analytics.
- The migration is idempotent and does not hardcode any account, behavior, or
  occurrence id.
- No existing occurrence row, status, note, or time session is modified or lost
  by the constraint swap.
- Occurrence sync remains idempotent: a second run creates no duplicates.
- `npm run smoke:schedule-integrity:local` passes.

Suggested files:
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `lib/db/occurrences.repo.ts`
- `lib/db/database.types.ts`
- `lib/resolvers/occurrence.resolver.ts`
- `tests/occurrence.resolver.test.ts`
- `tests/sql/ticket-060-schedule-integrity-smoke.sql`
- `docs/DATA_MODEL.md`

---

## Ticket 086: Import validation and dedup gaps

Four validation holes that let a hash-valid bundle write inconsistent or
duplicated history.

Dependencies:
- Ticket 084 for the transactional apply path.

Context:
- Date/instant disagreement: `local_date`, `scheduled_for_utc`, and `timezone`
  are validated separately and never cross-checked
  (`lib/resolvers/behaviorlog-import.resolver.ts:1004-1044`), then persisted
  unchanged (`lib/services/behaviorlog-import-write.service.ts:2539-2553`). A
  bundle declaring `2026-11-01T05:30:00Z` in `America/New_York` with
  `local_date: 2026-10-31` is accepted, and the occurrence groups under the
  wrong day permanently. DST boundaries make this easy to hit by accident.
  Contradicts `docs/DATETIME_STRATEGY.md:66-75`.
- Cross-behavior schedule references: validation checks that the occurrence's
  behavior and schedule ids exist, never that the schedule belongs to that
  behavior (`lib/resolvers/behaviorlog-import.resolver.ts:1437-1457`). The FK
  enforces account ownership only
  (`supabase/migrations/20260609202707_add_behavior_schedule_slots.sql:136-139`).
  The same inconsistent shape is reachable in the live schema, since a slot's
  `behavior_id` and its schedule parent are independently constrained.
- Duplicate intervention ids: duplicate detection covers behaviors, schedules,
  occurrences, status events, and notes, but omits interventions
  (`lib/resolvers/behaviorlog-import.resolver.ts:354-370`). Apply collapses
  them by external id while keeping both actions
  (`lib/services/behaviorlog-import-write.service.ts:814-821`), so the first
  write stores the last plan and the second no-ops. Preview shows no conflict.
- Note reimport: merge preview maps a matching external note id to the existing
  imported-note row without comparing content or attachment
  (`lib/resolvers/behaviorlog-import.resolver.ts:2663-2725`), then apply treats
  that note row's id as the note's parent `targetLocalId` while its dedup query
  is scoped to the current run
  (`lib/services/behaviorlog-import-write.service.ts:2032-2129`). Reimporting
  the same note creates a duplicate parented to the first note.

Settled decisions:
- Validation derives the local date from the instant and timezone and compares
  it to the declared `local_date`. A mismatch is a blocking error, not a
  warning: the record is wrong, and accepting it corrupts day grouping.
- Occurrence cross-reference validation additionally requires that the
  referenced schedule's behavior equals the occurrence's behavior. Mismatch is
  a blocking error.
- Add a composite foreign key so the database enforces the same rule for
  schedule slots, closing the shape at both layers.
- Interventions join the duplicate-id detection set with the same
  blocking-error treatment as the other record types.
- Note mapping compares the note's attachment target as well as its external
  id, and the apply dedup query is scoped to the account rather than the run.

Acceptance criteria:
- A bundle whose `local_date` disagrees with its instant and timezone is
  rejected at preview with a clear per-record error.
- A bundle attaching behavior B's schedule to behavior A's occurrence is
  rejected at preview.
- A bundle with two intervention rows sharing an id is rejected at preview
  rather than silently keeping one.
- Importing the same note-bearing bundle twice produces one note, correctly
  parented to its behavior.
- A valid Cadence export still imports cleanly with no new errors or warnings.

Suggested files:
- `lib/resolvers/behaviorlog-import.resolver.ts`
- `lib/services/behaviorlog-import-write.service.ts`
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `tests/behaviorlog-import-merge-preview.test.ts`
- `tests/behaviorlog-import.resolver.test.ts`
- `docs/EXPORT_FORMATS.md`

---

## Ticket 087: Multi-tab concurrency for behavior edits, statuses, notes, and cache

Stop a second tab from silently reverting work, and stop a stale cache write
from resurrecting deleted state.

Context:
- Stale behavior form: the edit form submits the full draft with no client
  revision or `updated_at`
  (`components/behaviors/BehaviorForm.tsx:204-206`). The service reads the
  latest record *after* submission and uses that as the RPC precondition
  (`lib/services/behavior.service.ts:141-193`), so the RPC guards server-side
  interleaving but accepts an arbitrarily old browser draft. Tab A saves a
  schedule change; Tab B saves a title change from its older draft and reverts
  A's schedule with no warning.
- Status conflict UI: the server correctly rejects a stale `expected_status`
  (`lib/services/occurrence.service.ts:680-684`), but the client error branch
  only clears optimistic state
  (`components/timeline/StatusButtons.tsx:140-157`), rolling back to the stale
  prop. The user is told "status changed" and then shown the old status.
- Behavior review submissions: review rows do not pass the shared optimistic
  `disabled` state, and `useFormStatus` disables only the submitted form
  (`components/behaviors/BehaviorList.tsx:680-684`), so a sibling status button
  stays live during an in-flight request.
- Note last-write-wins: the note update filters only on user and occurrence id
  with no expected prior value
  (`lib/services/occurrence.service.ts:783-794`,
  `lib/db/occurrences.repo.ts:280-289`).
- Cache write-back: a miss loads asynchronously and writes back unconditionally
  (`lib/cache/user-read-cache.ts:39-64`), so a mutation that invalidates the key
  mid-load is overwritten when the older load resolves — an archived behavior
  can render as active for up to the 60s TTL. The map is also process-local, so
  invalidation does not cross Vercel instances.

Settled decisions:
- The behavior edit form carries the loaded record's `updated_at` as a hidden
  precondition, and the update RPC rejects a mismatch. The failure is a
  first-class conflict state, not a generic error: tell the user the behavior
  changed elsewhere and offer to reload, without discarding their draft.
- A status conflict refreshes the route on the error path as well as the
  success path, so the UI lands on server truth rather than the state that
  caused the conflict.
- Behavior review status controls share the same optimistic disabled state
  Timeline rows use, so only one status submission per occurrence can be in
  flight.
- Note saves carry an expected prior value and surface a conflict rather than
  overwriting. Notes are user-authored prose; silent loss is worse than a
  prompt.
- Cache entries carry a generation counter incremented by invalidation. A load
  that started before an invalidation does not write back.
- Cross-instance cache coherence stays out of scope; the 60s TTL remains the
  bound. Document that explicitly rather than implying global correctness.

Acceptance criteria:
- Two tabs editing one behavior: the second save reports a conflict and does not
  revert the first tab's schedule change.
- A status conflict leaves the row showing the server's current status.
- Rapidly clicking Completed then Not Completed in behavior review issues one
  submission.
- A note conflict is reported rather than silently overwritten.
- A behavior archived during an in-flight cached read does not reappear as
  active.

Suggested files:
- `components/behaviors/BehaviorForm.tsx`
- `components/behaviors/BehaviorList.tsx`
- `components/timeline/StatusButtons.tsx`
- `lib/services/behavior.service.ts`
- `lib/services/occurrence.service.ts`
- `lib/cache/user-read-cache.ts`
- `tests/user-read-cache.test.ts`
- `docs/USER_FLOWS.md`
- `interaction-registry.json`

---

## Ticket 088: Background sync freshness and timezone propagation

Status: complete locally (2026-09-04).

Existing version/configuration guards were retained and verified. Current-profile
timezone creation and generation-window summary fixes pass local checks.
Evidence: `docs/qa/2026-09-04-tickets-088-091-104-105.md`.

Platform impact:

| Platform | Impact |
| --- | --- |
| Web | lib/services/behavior.service.ts; packages/core/src/services/occurrence-sync.ts |
| Desktop | Shared summary timezone correction in packages/core/src/services/occurrence-sync.ts; existing native scheduling retained. |
| Marketing | Not applicable: no public-content or navigation change. |
| Future mobile | No implementation; mobile remains deferred under docs/FUTURE_UPDATES.md. |


Stop background synchronization from certifying stale schedules as fresh, and
stop new behaviors from inheriting an obsolete timezone.

Dependencies:
- Ticket 083 for the atomic timezone write.

Context:
- The sync processor loads behaviors *before* reading sync state
  (`lib/services/occurrence.service.ts:404-445`), and the final upsert clears
  `stale` with no generation number or expected-state check (`:538-540`,
  `lib/db/occurrenceSyncState.repo.ts:78`). A behavior edit committed in that
  window is written over: the processor generates from its stale snapshot and
  then marks the user fresh, so the edit is never picked up.
- Behavior creation prefers the hidden form timezone over the current profile
  timezone (`components/behaviors/BehaviorForm.tsx:209-210`,
  `lib/services/behavior.service.ts:85-92`), while generation uses the
  behavior's stored zone and sync state records the profile zone as fresh
  (`lib/services/occurrence.service.ts:167`, `:337`). Later synchronization
  never repairs the mismatch. Found by two audit passes.

Settled decisions:
- Sync state carries a generation counter. Behavior writes increment it; the
  processor captures it before loading behaviors and the final freshness upsert
  applies only when the counter is unchanged. A bumped counter means the run's
  snapshot is obsolete: leave the account stale for the next run.
- Behavior creation uses the server's current profile timezone as the source of
  truth. The hidden form field is removed rather than merely deprioritized, so
  the stale value cannot be submitted at all.
- Freshness is never recorded for a timezone other than the one actually used
  to expand the behaviors in that run.

Acceptance criteria:
- A behavior edit committed while a sync run is in flight leaves the account
  stale and is applied by the next run.
- A behavior created from a tab loaded before a timezone change is stored in
  the current profile timezone.
- Sync state never records a timezone that differs from the expansion timezone.
- Repeated sync runs remain idempotent.

Suggested files:
- `lib/services/occurrence.service.ts`
- `lib/db/occurrenceSyncState.repo.ts`
- `lib/services/behavior.service.ts`
- `components/behaviors/BehaviorForm.tsx`
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `tests/occurrence-sync-state.service.test.ts`
- `docs/DATETIME_STRATEGY.md`

---

## Ticket 089: Timeline and Export interaction correctness

Five interaction defects across Timeline and Export that strand, discard, or
mislead.

Context:
- Note remount discards typing: a successful save starts `router.refresh()`
  while leaving the textarea editable
  (`components/timeline/OccurrenceNoteForm.tsx:33-52`), and both hosts key the
  form on the stored note value (`components/timeline/OccurrenceRow.tsx:222`,
  `components/behaviors/BehaviorList.tsx:690`). When refreshed data changes the
  key, React remounts and drops any newer draft.
- Stale preview stays actionable: selecting another import or restore file
  replaces the payload without invalidating the rendered preview or its
  confirmation controls
  (`components/export/BehaviorLogImportPanel.tsx:59-66`, `:194`, `:521`,
  `components/export/BehaviorLogRestorePanel.tsx:57-64`, `:183`). Server
  fingerprint checks prevent corruption, so the user is walked to the end of a
  destructive confirm flow for a guaranteed failure.
- Timer loses Stop at midnight: a timer may start on a current-day resolved
  occurrence (`lib/resolvers/time-tracking.resolver.ts:46`), but after midnight
  the retention rule drops that row from Timeline
  (`lib/resolvers/timeline.resolver.ts:190-205`) and behavior review exposes
  only Reset (`components/behaviors/BehaviorReviewTimeReset.tsx:25-32`). The
  user can discard the elapsed time but not keep it, contrary to
  `docs/USER_FLOWS.md:274`.
- Chime blocks reconciliation: a Completed transition awaits the full audio
  fallback chain before `router.refresh()` and `onStatusSuccess`
  (`components/timeline/StatusButtons.tsx:145-146`,
  `lib/ui/completion-feedback.ts:77`, `:106`, `:253`), with no timeout on media
  playback, context resume, or asset fetch. A stalled asset leaves a committed
  row stuck in optimistic "Saving" with controls disabled.
- Pull-to-refresh captures modal gestures: the wrapper contains the modal,
  checks *document* scroll position rather than the modal's scroll container,
  and its interactive-target selector omits `<summary>`
  (`components/timeline/MobileTimelinePullToRefresh.tsx:24`, `:90`, `:128`,
  `components/timeline/Timeline.tsx:31-33`). Scrolling a long modal at 390px can
  lock into a Timeline refresh and `preventDefault` the modal's own scroll,
  contradicting `INT-TIMELINE-010` (`interaction-registry.json:1295`).

Settled decisions:
- The note form is no longer keyed on the stored value. It reconciles on
  successful save and preserves any draft typed after the save started.
- Selecting a new file clears the previous preview and disables its
  confirmation controls immediately. The user re-previews; no destructive
  control is ever live against a payload it does not describe.
- Stop remains available wherever a running timer is reachable, including
  behavior review after the Timeline row ages out. Reset is not an acceptable
  substitute, because it discards the duration.
- Completion feedback is fire-and-forget: audio never gates `router.refresh()`
  or `onStatusSuccess`. Keep the existing exactly-once playback guarantee from
  Ticket 071 — it is a sequencing change, not a removal.
- The pull gesture checks the scroll position of the nearest scrollable
  ancestor, treats `<summary>` as interactive, and does not arm while a modal is
  open.

Acceptance criteria:
- Typing immediately after a successful note save is preserved.
- Selecting a second file leaves no actionable preview from the first.
- A timer running on an aged-out resolved occurrence can still be stopped with
  its duration preserved.
- A stalled chime asset does not leave a committed row disabled.
- Scrolling and swiping inside an open Needs decision modal never triggers a
  Timeline refresh.
- Ticket 071's single-playback and 48px alignment regressions still pass.

Suggested files:
- `components/timeline/OccurrenceNoteForm.tsx`
- `components/timeline/OccurrenceRow.tsx`
- `components/timeline/StatusButtons.tsx`
- `components/timeline/MobileTimelinePullToRefresh.tsx`
- `components/timeline/mobile-pull-to-refresh.ts`
- `components/behaviors/BehaviorReviewTimeReset.tsx`
- `components/export/BehaviorLogImportPanel.tsx`
- `components/export/BehaviorLogRestorePanel.tsx`
- `lib/ui/completion-feedback.ts`
- `tests/timeline-interactions-ui.test.tsx`
- `interaction-registry.json`

---

## Ticket 090: Accessibility, form errors, and hydration determinism

Three defects that break the documented WCAG 2.2 AA baseline or leave the user
without feedback.

Context:
- Focus trap: the Needs decision dialog's focusable selector omits native
  `<summary>` elements while collecting controls inside *closed* `<details>`,
  because it never tests visibility
  (`components/timeline/NeedsDecisionDialog.tsx:13`, `:65`, `:83`, `:185`).
  Focus can escape the `aria-modal` dialog after the last summary, and
  Shift+Tab can target a hidden control. `PRODUCT.md:55` commits to WCAG 2.2 AA.
- Invisible recurrence errors: the server writes incomplete-recurrence errors
  to `fieldErrors.recurrence` (`lib/services/behavior-form.ts:112`, `:670`) but
  the form renders only `fieldErrors.schedule`
  (`components/behaviors/BehaviorForm.tsx:438-447`, `:832`). Selecting Weekly,
  clearing every weekday, and saving yields "Check the highlighted fields" with
  nothing highlighted.
- Hydration mismatch: both Export client panels format run timestamps during
  render with no explicit timezone
  (`components/export/BehaviorLogImportPanel.tsx:704`, `:1114`,
  `components/export/BehaviorLogRestorePanel.tsx:550`, `:683`), so the server
  renders in the server's zone and hydration in the browser's. A run at
  `2026-08-06T00:30:00Z` renders "August 6" on a UTC server and "August 5" in an
  America/New_York browser. STATUS.md records an unexplained production
  hydration warning on Timeline, Behaviors, and Export from Ticket 070; this is
  a confirmed mismatch source on Export but is not yet proven to be that
  warning.

Settled decisions:
- The dialog's focusable set includes `<summary>` and excludes anything not
  currently rendered, tested by visibility rather than by tag list.
- Every `fieldErrors` key the server can produce has a rendered surface. Add a
  check so a new key cannot be introduced without one.
- All user-facing timestamp formatting takes the resolved profile timezone
  explicitly. No locale formatting runs against an implicit ambient zone.
- Sweep Timeline and Behaviors for the same pattern in this ticket. If the
  production warning persists after the sweep, record that in STATUS.md rather
  than closing the item as fixed — do not claim a root cause that was not
  demonstrated.

Acceptance criteria:
- Tab and Shift+Tab remain inside the Needs decision dialog with all rows
  collapsed, and never focus a hidden control.
- Saving a Weekly behavior with no weekday selected shows a message on the
  recurrence field.
- Server and client render identical timestamp text for a fixed instant with
  the server and browser in different zones.
- No new hydration warning appears in a production-mode render of Timeline,
  Behaviors, and Export.

Suggested files:
- `components/timeline/NeedsDecisionDialog.tsx`
- `components/behaviors/BehaviorForm.tsx`
- `components/export/BehaviorLogImportPanel.tsx`
- `components/export/BehaviorLogRestorePanel.tsx`
- `lib/services/behavior-form.ts`
- `tests/ux-ticket-049-052-ui.test.tsx`
- `docs/UI_SPEC.md`

---

## Ticket 091: Reminder delivery cadence and export cost guardrails

Status: in_progress (2026-09-04).

Local implementation and checks pass. Hosted migration, Preview inspection,
and five-minute delivery acceptance remain pending.
Evidence: `docs/qa/2026-09-04-tickets-088-091-104-105.md`.

Platform impact:

| Platform | Impact |
| --- | --- |
| Web | lib/services/export.service.ts; components/export/ExportPanel.tsx; vercel.json |
| Desktop | Existing local runtime remains unchanged; this ticket concerns hosted web/provider operations. |
| Marketing | Not applicable: no public-content or navigation change. |
| Future mobile | No implementation; mobile remains deferred under docs/FUTURE_UPDATES.md. |


Close the gap between the reminder granularity the product offers and the
granularity it delivers, and stop the Export page from doing unbounded work on
load.

Dependencies:
- Ticket 080 for claim recovery, and Ticket 081 for paginated reads.
- Ticket 094 for the owner-scoped time-session query RPCs. Ticket 091 must
  reuse the joined historical repository path instead of adding a competing
  table query.

Context:
- `vercel.json:5-6` runs reminder processing at `0 * * * *`. The product offers
  "at scheduled start" and "15 minutes before"
  (`docs/NOTIFICATION_SPEC.md:97-99`, `docs/UI_SPEC.md:448-449`), and the
  processor only sends already-due rows. An at-start reminder due at 09:01
  arrives at 10:00 — the offered granularity and the delivered granularity are
  two orders of magnitude apart.
- Merely *opening* the Export page builds the entire bundle with
  `enforceDownloadGuardrails: false`
  (`app/(app)/export/page.tsx:64`, `lib/services/export.service.ts:114-117`),
  so no rate limit or circuit breaker applies. The resolver simultaneously
  materializes JSONL, CSV, JSON, Markdown, and BehaviorLog structures
  (`lib/resolvers/export.resolver.ts:222-259`) with ZIP buffers on top
  (`lib/services/zip.ts:41`). Time-tracking exports also put every included
  occurrence id into a single `.in(...)`, which becomes an oversized URI.

Settled decisions:
- Reminder processing runs every 5 minutes. Worst-case lateness drops to about
  5 minutes, which is defensible against a 15-minute-before offset. Confirm the
  cron frequency available on the current Vercel plan before implementing; if
  5 minutes is unavailable, record the achievable frequency and narrow the
  offsets the UI offers to match rather than shipping a promise the platform
  cannot keep.
- The Export page renders from a summary read — counts, range, and available
  formats — and does not build downloadable artifacts. Artifacts are built only
  on the download request, where guardrails already apply.
- Ticket 094 owns time-session read transport. Historical export reads use the
  joined date-range/cursor RPC. Arbitrary-ID reads retain automatic bounded RPC
  batching. Ticket 091 must not restore the oversized `.in(...)` query or add a
  second batching or pagination policy.
- No hard cap on export size in this ticket. Streaming or chunked download is
  future work; the fix here is to stop paying the cost on page load.

Acceptance criteria:
- A reminder due at 09:01 is delivered within about 5 minutes.
- The offsets offered in the UI are all deliverable at the configured cron
  frequency.
- Opening the Export page issues no artifact serialization and no rate-limit
  consumption.
- An all-time export with time tracking on a large account completes without an
  oversized query URI.
- Existing export artifact content and filenames are unchanged.

Suggested files:
- `vercel.json`
- `app/(app)/export/page.tsx`
- `lib/services/export.service.ts`
- `lib/db/timeSessions.repo.ts`
- `docs/NOTIFICATION_SPEC.md`
- `docs/VERCEL_WORKFLOW.md`
- `tests/export.service.test.ts`

---

## Ticket 092: Marketing example bundle and agent-readability parity

Make the advertised example bundle actually import, and make the markdown
mirrors say what the HTML says.

Context:
- The generated example emits `recurrence: { frequency: "daily", interval: 1 }`
  (`apps/marketing/scripts/build-example-bundle.mjs:46-49`), but
  `isSupportedRecurrence` switches on `recurrence.type`
  (`lib/resolvers/behaviorlog-import.resolver.ts:4354-4377`) and the exporter
  emits `type` (`lib/resolvers/export.resolver.ts:1781-1800`). The example
  schedule is skipped as `unsupported_recurrence` and its behavior is skipped
  for having no supported schedule. The marketing check only asserts the archive
  is non-empty (`apps/marketing/scripts/check-agent-readability.mjs:110-111`).
  This is the adoption surface for the BehaviorLog standard: the one file a
  prospective user downloads to try the flow fails the flow.
- `/cadence` and `/standard` are documented as dedicated pages
  (`docs/ROUTE_MAP.md:35-42`,
  `docs/PUBLIC_PRODUCT_ARCHITECTURE.md:111-120`) but redirect to the homepage
  (`apps/marketing/astro.config.mjs:6-12`) and appear in no manifest, sitemap,
  markdown mirror, or `llms-full.txt`. The real `/faq` page is missing from the
  route map. The header also lacks the documented Cadence and BehaviorLog links.
- The HTML About page states there is no third-party analytics or behavioral
  tracking (`apps/marketing/src/pages/about.astro:64-76`); its markdown source
  omits the claim (`apps/marketing/src/data/routes.ts:141-172`). The Examples
  page's "no real account or reminder-provider data" statement is likewise
  weakened in its mirror. `llms-full.txt` and the `.md` routes consume the
  divergent copy, so an agent and a human read different privacy postures.

Settled decisions:
- The example generator emits the same recurrence shape the exporter produces.
  The generator stops hand-authoring bundle records where it can reuse export
  serialization instead.
- The marketing readability check gains a real conformance assertion: the
  generated example must pass Cadence's own import preview with zero errors and
  zero skipped behaviors. A non-empty archive is not evidence.
- Documentation follows implementation for routes: `/cadence` and `/standard`
  remain redirects and the docs stop describing them as pages, and `/faq` is
  added to the route map. Revisit dedicated pages only under a scoped ticket.
- Markdown mirrors must carry every substantive claim the HTML page makes,
  especially privacy and data-handling statements. Add a parity check rather
  than relying on review.

Acceptance criteria:
- The published example bundle imports into Cadence with zero errors and its
  behavior and schedule created.
- `npm run marketing:check` fails if the example stops importing cleanly.
- Route documentation matches the shipped routes in both directions.
- Every privacy and data-handling claim in an HTML page appears in its markdown
  mirror, enforced by a check.
- `npm run marketing:build` and the agent-readability gate pass.

Suggested files:
- `apps/marketing/scripts/build-example-bundle.mjs`
- `apps/marketing/scripts/check-agent-readability.mjs`
- `apps/marketing/src/data/routes.ts`
- `apps/marketing/src/pages/about.astro`
- `apps/marketing/src/pages/examples.astro`
- `docs/ROUTE_MAP.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`

---

## Ticket 093: Governance checks, environment contract, and database operations

Close the gaps that let the repository's own guardrails report success while
invariants drift.

Context:
- The interaction checker compares marker counts and implementation substrings
  (`scripts/check-interactions.mjs:136-141`, `:325-333`, `:435-442`), so an
  existing control whose side effect changes — a note update becoming an
  occurrence delete — passes with a stale registry. The resolver checker's
  "nontrivial API logic" regex omits direct `.rpc(` and `.upsert(` calls
  (`scripts/check-resolvers.mjs:182-205`), so a route can reach Supabase
  directly without tripping the bypass rule. Both report large invariant counts
  (4,498 interaction invariants at Ticket 071), which reads as stronger coverage
  than it is.
- `NEXT_PUBLIC_MARKETING_SITE_URL`, `MARKETING_SITE_URL`, and
  `PUBLIC_CADENCE_APP_URL` are read but documented nowhere and all fall back to
  production domains (`lib/marketing-site.ts:1-3`,
  `apps/marketing/src/data/site.ts:5-10`). The env checker uses a fixed list
  that omits all three (`scripts/check-agents.mjs:186-208`). A preview marketing
  deploy without `PUBLIC_CADENCE_APP_URL` sends testers into the production app.
  `CADENCE_PERF_LOG` and `DESIGN_SYSTEM_BENCH_SKILL_DIR` are also unlisted.
- The daily sync batch orders all accounts by stale state, horizon, update time,
  and user id (`lib/services/occurrence.service.ts:510-518`), but the only index
  starts with `user_id`
  (`supabase/migrations/20260625204148_add_occurrence_sync_state.sql:33-34`), so
  each 25-row batch scans and sorts the whole ledger as accounts grow.
- Two large migrations combine table creation, backfills, `SET NOT NULL`, and FK
  creation without explicit transaction boundaries
  (`supabase/migrations/20260609202707_add_behavior_schedule_slots.sql:1-139`,
  `supabase/migrations/20260626140000_add_behavior_schedules.sql:1-142`). Under
  hosted push semantics an intermediate failure leaves earlier statements
  committed, so the retry fails at `CREATE TABLE`.
- `vercel.json:8-10` schedules occurrence sync, but
  `docs/VERCEL_WORKFLOW.md:108-131` documents only reminder processing while
  claiming to own scheduled triggers.
- `INT-SETTINGS-004` says the notification action appears only when permission
  is not denied (`interaction-registry.json:2378`); the panel shows "Refresh
  this device" whenever push is supported
  (`components/settings/NotificationPermissionPanel.tsx:110`, `:148`, `:311`).
- Test-login gating is sound, but once enabled every successful GET creates
  another confirmed auth user and only a *failed* sign-in deletes one
  (`app/auth/test-login/route.ts:41-70`); cleanup is operator-run only.

Settled decisions:
- The interaction check verifies each registry entry's recorded side effect
  against the handler it names, not just marker presence and counts. Where that
  cannot be mechanically verified, the entry is flagged for human review rather
  than counted as passing.
- Invariant counts stop being reported as a headline number, since they invite
  false confidence. Report checked entries and unverifiable entries separately.
- The resolver bypass pattern includes `.rpc(` and `.upsert(`.
- `.env.example` documents every variable the app reads, and the env checker
  derives its list from the source rather than a hardcoded array. Any variable
  whose absence changes behavior gets an explicit default and a comment naming
  the consequence.
- Add the composite index matching the sync batch's ordering.
- Both historical migrations are left as-is — rewriting applied migrations is
  more dangerous than the defect. Instead, document the transaction requirement
  in `docs/SUPABASE_WORKFLOW.md` and add a check that new migrations containing
  a backfill or `SET NOT NULL` carry explicit `begin`/`commit`.
- Resolve the notification-panel drift by deciding which behavior is intended
  and correcting the other side. Denied permission should still show the
  refresh action, since a user who re-grants permission in browser settings
  needs a way to re-register; update the registry entry to match.
- Test-login gains a creation quota per process and a documented cleanup
  cadence in `docs/OPERATIONS.md`.
- `docs/VERCEL_WORKFLOW.md` documents both crons.

Acceptance criteria:
- A deliberately altered interaction side effect fails `npm run
  interactions:check`.
- A route added with a direct `.rpc(` call fails `npm run resolvers:check`.
- `npm run agents:check` fails when the source reads a variable absent from
  `.env.example`.
- The sync batch query uses the new index.
- A new migration with a backfill and no explicit transaction fails the check.
- `docs/VERCEL_WORKFLOW.md` lists both scheduled jobs.
- `INT-SETTINGS-004` matches the shipped panel.

Suggested files:
- `scripts/check-interactions.mjs`
- `scripts/check-resolvers.mjs`
- `scripts/check-agents.mjs`
- `.env.example`
- new migration via `npm run supabase -- migration new <descriptive_name>`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/VERCEL_WORKFLOW.md`
- `docs/OPERATIONS.md`
- `interaction-registry.json`

---

## Ticket 094: Owner-scoped time-session query RPCs

Replace the oversized time-session ID filter with two secure database query
contracts: a bounded arbitrary-ID RPC with invisible repository batching, and
a joined date-range/cursor RPC for historical Analytics and Export reads.

Dependencies:
- Ticket 068 is complete and owns the persisted time-session model, RLS, and
  composite owner/occurrence index.
- This ticket should land before Ticket 091. It does not depend on Ticket 081
  because the live Behaviors failure needs an independent repair.

Production defect evidence:
- On 2026-08-12, authenticated production navigation to
  `/behaviors?range=90` crashed with Next.js digest `2953342693@E394`.
- Vercel runtime logs showed successful reads of 666 occurrences followed by
  `Error: {"message":"Bad Request"}` inside the Behaviors page data load.
- The next repository call placed every occurrence UUID into one
  `occurrence_id=in.(...)` Data API URL. A no-network URL-generation spike
  measured approximately 13,740 bytes for 348 IDs and 26,142 bytes for 666
  IDs. The smaller 30-day request succeeded; the 90-day request exceeded
  Supabase's documented 16 KB URL/header boundary.
- The database stored and returned the 666 occurrences successfully. This is a
  transport-shape defect, not evidence of database capacity loss or corrupt
  occurrence data.
- The same repository path is shared by Behaviors analytics, Timeline timing,
  and time-tracking exports. Timeline has not produced the same hosted error,
  while all-time exports retain the latent risk.

Cost and architecture decisions:
- Use Postgres database functions called through `supabase.rpc(...)`. These are
  Data API database calls, not Supabase Edge Function invocations.
- Keep the 2,000-ID RPC only for callers that genuinely hold an arbitrary,
  non-contiguous set of Occurrences. Timeline is the current example because it
  combines prior Unresolved, recently decided prior, and forward Occurrences.
- Make arbitrary-ID batching automatic above 2,000 unique IDs. The repository
  owns batching, PostgREST response-range continuation, merging,
  deduplication, error propagation, and global sorting. No UI, service, or
  export caller may surface the 2,000-ID or 1,000-row transport limit to a
  user.
- Do not use the ID RPC as the primary historical-data API. Analytics,
  behavior-date review, and Export know their local-date bounds. They must use
  a historical RPC that joins `occurrences` to `occurrence_time_sessions`
  inside PostgreSQL.
- Historical reads use keyset pagination, not offset pagination. The repository
  follows the cursor automatically until the final page so callers receive a
  complete result without knowing the database page size.
- Bind every historical read to an explicit `through_started_at` high-water
  instant supplied by the service. Sessions started after that instant do not
  enter later pages during the same logical read.
- Supabase currently bills no per-request Database API fee. The RPC decision is
  based on lower request, authentication, planning, connection, and sorting
  overhead rather than a claimed per-call dollar saving.
- Database egress remains determined primarily by returned time-session rows.
  Return only the columns used by Timeline, Analytics, and Export instead of
  `select *` so future table columns cannot silently expand the API surface.
- Preserve repositories as the only RPC callers. Services select the correct
  repository contract. Pages, API routes, components, and resolvers must not
  call either RPC directly.

Arbitrary-ID RPC contract:
- Add the non-overloaded migration function
  `public.list_my_occurrence_time_sessions(uuid[])`. Use this exact signature
  consistently in grants, tests, generated types, and repository calls.
- The function accepts only an occurrence UUID array. It must not accept a
  `user_id`, role, email, JWT payload, or arbitrary SQL/filter text.
- Declare the function `STABLE`, `SECURITY INVOKER`, and with a hardened empty
  `search_path`. Fully qualify every referenced table, type, and function.
- Never use `SECURITY DEFINER` for this read. The function needs no RLS bypass
  or creator privilege.
- Require a non-null `auth.uid()` and explicitly filter
  `occurrence_time_sessions.user_id = (select auth.uid())`. Existing table RLS
  remains enabled and authoritative as defense in depth.
- Keep the existing authenticated owner SELECT policy unchanged unless a test
  proves a defect. Do not use the service-role client for the RPC.
- Revoke function execution from `PUBLIC`, `anon`, `authenticated`, and
  `service_role`, then grant only the exact function signature to
  `authenticated`. This removes any inherited or automatic execute grant before
  adding the intended grant.
- Accept a maximum of 2,000 occurrence IDs per database call. Enforce this limit
  inside PostgreSQL, not only in TypeScript, because an authenticated caller can
  invoke an exposed RPC directly.
- Treat a null or empty UUID array as an empty result. Duplicate UUIDs must not
  duplicate returned sessions. Reject an over-limit array with a stable,
  non-sensitive error when the RPC is invoked directly. Application repository
  callers must never reach that error because they batch automatically.
- Use typed `uuid[]` input and fixed SQL only. Do not construct dynamic SQL.
- Return only `id`, `user_id`, `occurrence_id`, `behavior_id`, `started_at`, and
  `stopped_at`, ordered globally by `started_at ASC, id ASC`.
- The repository splits every normalized unique input above 2,000 IDs into
  sequential batches of at most 2,000. It follows every batch through
  PostgREST response ranges of 1,000 rows until a short page returns. A typical
  666-ID input returning fewer than 1,000 sessions uses one request; an exact
  1,000-row response triggers a continuation request. The repository
  deduplicates sessions by ID, merges all pages, and restores the same global
  stable order. This is normal supported behavior, not a fallback or
  exceptional user path.

Historical RPC contract:
- Add the separately named, non-overloaded function
  `public.list_my_occurrence_time_session_history`. Its exact signature is
  `(date, date, boolean, timestamptz, timestamptz, uuid, integer)`. The
  parameters are start local date, end local date, include archived Behaviors,
  high-water start instant, cursor start instant, cursor session ID, and page
  size.
- Filter by `occurrences.local_date`, not by converting `started_at` into a
  calendar date. The Occurrence local date remains the product's historical
  range authority.
- Join `public.occurrences` to `public.occurrence_time_sessions` on the complete
  owner/Occurrence/Behavior identity. Join `public.behaviors` only to enforce
  the current include-archived choice with
  `(include_archived OR behavior.active)`. Do not send Occurrence IDs from
  Analytics or Export to this function.
- Require non-null start date, end date, include-archived flag, and
  `through_started_at`. Reject start dates after end dates.
- Use a `(started_at, id)` keyset cursor. Both cursor fields must be null for
  the first page or both must be supplied for a later page. Reject a partial
  cursor.
- Accept page sizes from 1 through 1,000. Reject values outside that range
  inside PostgreSQL. The repository uses 1,000 and automatically follows full
  pages until a shorter final page.
- Filter `session.started_at <= through_started_at` on every page. Use strict
  tuple comparison after the cursor so a session appears at most once.
- Return the same six minimal columns as the arbitrary-ID RPC, ordered by
  `started_at ASC, id ASC`. The last returned row supplies the next cursor.
- Use the existing `(user_id, local_date, scheduled_for)` Occurrence index for
  the date window. A rollback-only local `EXPLAIN (ANALYZE, BUFFERS)` fixture
  with 3,650 Occurrences and 7,300 sessions showed sequential scans for
  all-time cursor pages. Add the evidenced
  `(user_id, started_at, id)` session index. The new index served the all-time
  first and later cursor pages while the 90-day plan retained the Occurrence
  date index. Treat these synthetic plans as index evidence, not a capacity
  benchmark.

Shared RPC security decisions:
- Declare both functions `STABLE`, `SECURITY INVOKER`, and with a hardened empty
  `search_path`. Fully qualify every referenced table, type, and function.
- Never use `SECURITY DEFINER` for either read. Neither function needs an RLS
  bypass or creator privilege.
- Require a non-null `auth.uid()`. Explicitly scope every joined table to that
  user where applicable. Existing table RLS remains enabled and authoritative
  as defense in depth.
- Keep the existing authenticated owner SELECT policies unchanged unless a test
  proves a defect. Do not use the service-role client for either RPC.
- Revoke each exact signature from `PUBLIC`, `anon`, `authenticated`, and
  `service_role`, then grant only that exact signature to `authenticated`.
- Use typed parameters and fixed SQL only. Do not accept a `user_id`, role,
  email, JWT payload, arbitrary filter, sort expression, or SQL text.
- Emit separate privacy-safe performance timing for arbitrary-ID batch count
  and historical page count, plus returned session count, duration, and
  success/error. Never log user IDs, occurrence IDs, behavior IDs, session IDs,
  notes, titles, cursors, local dates, or request bodies.

Caller routing decisions:
- `lib/services/timeline.service.ts` and single-Occurrence timing reads use the
  arbitrary-ID repository method.
- `lib/services/analytics.service.ts` uses the joined historical repository
  method with its resolved local-date range, `includeArchived: true`, and its
  injected `now` as the high-water instant.
- `lib/services/export.service.ts` uses the joined historical repository method
  only when `include_time_tracking=1`, with the resolved export dates, the
  requested include-archived choice, and the export's injected `now` as the
  high-water instant.
- Selected-day and Behavior history continue consuming Analytics service data.
  They do not add an ID-based historical query.

Implementation sequence:
1. Add failing migration-contract tests for both non-overloaded signatures,
   invoker mode, hardened search path, explicit ownership, narrow grants,
   minimal columns, fixed ordering, and the absence of dynamic SQL.
2. Create the migration with
   `npm run supabase -- migration new <descriptive_name>` and implement the
   bounded ID function, including its 2,000-ID database guard.
3. Add historical-function contract tests for the direct join, local-date
   filter, archived behavior filter, high-water bound, cursor-pair validation,
   strict keyset predicate, and 1–1,000 page-size guard.
4. Implement the joined historical function in the same additive migration.
5. Run representative local `EXPLAIN (ANALYZE, BUFFERS)` checks for 90-day and
   all-time history shapes. Add a cursor-supporting index only if the plans
   demonstrate the need, and record the plan evidence in the ticket handoff.
6. Run a clean local database reset and regenerate `lib/db/database.types.ts`
   from the local schema.
7. Add failing arbitrary-ID repository tests proving 666 unique IDs with fewer
   than 1,000 returned sessions use one RPC request, an exact 1,000-row response
   continues through response ranges, and 2,001 IDs use sequential batches
   without a caller-visible limit error. Prove duplicate IDs are normalized,
   empty input performs no network call, page errors propagate, page results
   are deduplicated, and merged results are globally ordered.
8. Replace the direct `.in("occurrence_id", ...)` read in
   `lib/db/timeSessions.repo.ts` with the typed arbitrary-ID RPC boundary. Keep
   `listTimeSessionsForOccurrence` on the same repository path.
9. Add failing history-repository tests for first-page parameters, automatic
   keyset pagination, fixed high-water reuse, cursor advancement, exact-page
   continuation, short-page termination, partial-page errors, non-advancing
   cursor rejection, and stable complete results.
10. Add the historical repository method and privacy-safe timing spans.
11. Add failing Analytics and Export service tests proving they use the
   historical repository contract and never materialize or transmit an
   Occurrence ID list for time-session history.
12. Route Analytics and Export through joined historical reads. Preserve
   Timeline on the arbitrary-ID method.
13. Extend the two-user Supabase RLS smoke to create owned time sessions and
   prove own-only, foreign-only, and mixed-owner behavior through both RPCs and
   ordinary authenticated clients. The service role remains restricted to
   exact temporary-user setup and cleanup.
14. Run focused Analytics, Timeline, Export, migration, repository, and RLS
   tests before the full repository gates.
15. Update `docs/DATA_MODEL.md`, `docs/SUPABASE_WORKFLOW.md`, and generated types
   with both function contracts, caller routing, automatic pagination,
   deployment order, and privileges.

Acceptance criteria:
- A 666-ID repository read returning fewer than 1,000 sessions makes exactly
  one RPC request and constructs no oversized Data API URL. An exact 1,000-row
  response continues through PostgREST response ranges without truncation or
  duplication.
- A read above 2,000 unique IDs uses sequential RPC batches of at most 2,000,
  returns every permitted row once, and preserves global `started_at`, `id`
  ordering without exposing the batching limit to the caller or user.
- Analytics, behavior-date review, and Export transmit date, archive, high-water,
  cursor, and page-size parameters. They transmit no Occurrence ID array for
  historical time-session reads.
- The historical RPC performs the Occurrence → Time Session join directly and
  filters on `occurrences.local_date`.
- A history result larger than 1,000 rows is fetched completely through
  automatic keyset pagination with no duplicates, gaps, offset pagination, or
  user-visible page limit.
- Sessions started after the fixed high-water instant do not enter later pages.
- Anonymous callers cannot execute either function.
- User A can retrieve User A's requested sessions through both functions.
- User A receives no User B sessions through foreign-only or mixed-owner ID,
  date-range, cursor, or archive inputs.
- Both functions are verifiably `SECURITY INVOKER`; no security-definer variant
  is present.
- Only `authenticated` has execute permission on each exact function signature.
- Null and empty input return zero rows. Duplicate IDs do not duplicate rows.
- An input above 2,000 IDs is rejected inside PostgreSQL without leaking IDs or
  account information when the RPC is called directly; the application handles
  the same input automatically through batches.
- Invalid historical ranges, partial cursors, and page sizes outside 1–1,000
  are rejected without leaking account or record information.
- Existing Timeline timing, Behaviors averages and selected-day timing, and
  privacy-gated export contents remain unchanged.
- `/behaviors?range=7`, `30`, and `90` render successfully for the production
  account shape that previously returned 666 occurrences.
- An all-time time-tracking export completes through joined cursor pages and
  does not create any Occurrence-ID URI or payload.
- Privacy-safe runtime logs contain no recurrence, behavior, occurrence,
  session, note, account, or request-body data.

Deployment and rollback:
- Hosted schema deployment requires explicit user authorization and follows
  `docs/SUPABASE_WORKFLOW.md`. Never create or edit the hosted function through
  Dashboard SQL.
- Deploy the additive migration before the application code. The old
  application ignores the new function, while the new application requires it.
- After hosted migration deployment, verify grants and cross-account behavior
  for both RPCs through ordinary authenticated clients before deploying the
  application.
- After application deployment, smoke `/behaviors?range=7`, `30`, and `90`, a
  normal Timeline read, and a time-tracking export. Inspect Vercel and Supabase
  logs for `Bad Request`, permission, timeout, and cross-account anomalies.
- If the application rollout fails, roll back the application first. The
  unused additive function may remain until a later migration removes it; do
  not edit an applied migration or drop it manually from hosted Supabase.

Required verification:
- `npm run supabase -- db reset`
- `npm run smoke:rls` against the local project
- focused migration, repository, Analytics, Timeline, Export, and smoke-script
  tests
- `npm run agents:check`
- `npm run interactions:check`
- `npm run resolvers:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

Suggested files:
- new migration via
  `npm run supabase -- migration new add_time_session_query_rpcs`
- `lib/db/timeSessions.repo.ts`
- `lib/db/database.types.ts`
- `lib/services/analytics.service.ts`
- `lib/services/export.service.ts`
- `lib/services/timeline.service.ts`
- `scripts/supabase-rls-smoke.mjs`
- `tests/time-sessions-rpc-migration.test.ts`
- `tests/time-sessions.repo.test.ts`
- `tests/rls-smoke-script.test.ts`
- Analytics service tests added or extended by the implementation
- `tests/export.service.test.ts`
- relevant Timeline service tests added or extended by the implementation
- `docs/DATA_MODEL.md`
- `docs/SUPABASE_WORKFLOW.md`
- `STATUS.md`

Out of scope:
- Changing adherence, status, reminder, duration, or export semantics.
- Adding a new route, Edge Function, service-role path, or UI interaction.
- Replacing the existing time-session table or RLS ownership model.
- Streaming exports, changing export filenames, or adding a product-level
  export-size cap.
- Moving Analytics or export calculations into PostgreSQL. The historical RPC
  owns joined data retrieval only; resolver semantics remain unchanged.
- Hosted migration deployment without explicit authorization.

---

## Ticket 095: Behavior configuration event contract and capture

Add append-only owner-scoped history for Behavior schedule graphs, reminder
settings, category, active state, and timezone.

Dependencies:
- Ticket 078 must complete first so a configuration change cannot erase
  earlier same-day Occurrence history.

Settled decisions:
- Preserve current `behaviors`, `behavior_schedules`, and
  `behavior_schedule_slots` as operational snapshots.
- Add `behavior_configuration_events` with complete normalized previous and
  next configuration snapshots, changed fields, exact recorded/effective
  instants, effective local date, timezone, source, and reason code.
- New Behaviors receive a baseline. Existing Behaviors receive a truthful
  `history_capture_started` baseline at rollout time. Do not backdate current
  configuration to Behavior creation.
- Definition title/description history remains in
  `behavior_definition_events`; do not duplicate that text in configuration
  snapshots.
- Capture manual Behavior form, archive/restore, Settings timezone,
  import-create/merge, and destructive restore configuration writes at their
  atomic mutation boundaries.
- A normalized no-op creates no event. One save that changes several
  configuration fields creates one revision.
- The history is append-only personal data, not a tamper-evident compliance
  ledger.

Acceptance criteria:
- A daily-to-weekly edit stores one revision with complete previous and next
  schedule graphs and exact effective time.
- Reminder-only, category, archive/restore, and timezone changes are recorded.
- A title plus schedule edit writes the definition event, configuration event,
  Behavior snapshot, schedule graph, and stale marker atomically.
- Failed writes leave no partial event or graph mutation.
- No-op saves create no configuration event.
- Owner RLS permits no cross-account reads or writes, and authenticated clients
  have no update or delete path for event rows.
- Existing accounts receive no invented pre-rollout schedule history.

Suggested files:
- new migration via `npm run supabase -- migration new add_behavior_configuration_events`
- `lib/types/behavior-configuration-event.ts`
- `lib/resolvers/behavior-configuration.resolver.ts`
- `lib/db/behaviorConfigurationEvents.repo.ts`
- `lib/db/behaviorDefinitionEvents.repo.ts`
- `lib/services/behavior.service.ts`
- `lib/services/settings.service.ts`
- import and restore services/RPC migrations
- `lib/db/database.types.ts`
- `tests/behavior-configuration.resolver.test.ts`
- migration, repository, service, import, restore, and RLS tests
- `docs/AGENT_RESOLVERS.md`
- `docs/DATA_MODEL.md`

Out of scope:
- Dose, quantity, supply, refill, or clinical semantics.
- User-entered change reasons or a revision-browser UI.
- Hosted migration deployment without explicit authorization.

---

## Ticket 096: Occurrence configuration lineage

Link each newly generated Occurrence to the configuration event that governed
its schedule without inventing lineage for legacy Occurrences.

Dependencies:
- Tickets 078 and 095.

Settled decisions:
- Add a nullable owner-and-Behavior-scoped configuration-event reference to
  `occurrences`.
- New generated Occurrences receive the governing event ID.
- Past, resolved, and protected Occurrences keep their original event.
- A retained future unresolved Occurrence moves to the new event only when the
  new schedule still generates the same Occurrence.
- Pre-rollout Occurrences remain unlinked unless the governing revision is
  known from an actual captured event.

Acceptance criteria:
- New Occurrences identify their governing configuration event.
- Daily-to-weekly changes preserve old lineage and assign new weekly
  Occurrences to the new revision.
- Same-instant Occurrences retained by the new graph receive new lineage only
  when the new graph still produces them.
- Ticket 078-protected, past, and resolved rows keep their original lineage.
- Duplicate schedule-time merging remains deterministic.
- Cross-owner event references fail at the database boundary.

Suggested files:
- new migration via
  `npm run supabase -- migration new link_occurrences_to_behavior_configuration_events`
- `lib/resolvers/occurrence.resolver.ts`
- `lib/services/occurrence.service.ts`
- `lib/db/occurrences.repo.ts`
- `lib/db/database.types.ts`
- `tests/occurrence.resolver.test.ts`
- `tests/occurrence.service.test.ts`
- migration and RLS tests
- `docs/DATA_MODEL.md`
- `docs/RECURRENCE_RULES.md`

Out of scope:
- Reconstructing unknown pre-rollout configuration history.
- Rewriting resolved or historical Occurrence schedule snapshots.

---

## Ticket 097: Configuration history export and BehaviorLog schedule periods

Expose complete app-native configuration history and historically correct
BehaviorLog schedule periods.

Dependencies:
- Tickets 095 and 096.

Settled decisions:
- Full JSON adds sorted `behavior_configuration_events` for every included
  Behavior, regardless of the selected Occurrence range.
- JSONL and CSV remain current-snapshot formats.
- BehaviorLog ends old schedule periods, creates new schedule periods, and
  maps known Occurrences to the correct revision schedule.
- Exact effective instants and Cadence lineage IDs live under the Cadence
  extension when BehaviorLog core exposes only local-date bounds.
- Legacy unlinked Occurrences use an explicit medium-confidence fallback. Do
  not present current recurrence as verified historical truth.
- Markdown reports history counts and tells agents to segment analysis around
  changes. It must not infer causality or provide clinical guidance.
- Export disclosure copy names schedule and reminder history without adding a
  new export option.

Acceptance criteria:
- A daily-to-weekly account exports both schedule periods and exact change
  timing.
- Known Occurrences reference the schedule revision that governed them.
- Full JSON includes complete previous and next configuration snapshots.
- Archive filtering and deterministic ordering match definition-history rules.
- Reads above the Data API row cap are complete or fail loudly at a documented
  absolute ceiling.
- Manifest counts and hashes match emitted records.
- BehaviorLog conformance, Full JSON, Markdown, and Export UI tests pass.

Suggested files:
- `lib/db/behaviorConfigurationEvents.repo.ts`
- `lib/services/export.service.ts`
- `lib/resolvers/export.resolver.ts`
- `lib/types/export.ts`
- `lib/export-prompts.ts`
- `components/export/ExportPanel.tsx`
- `tests/export.service.test.ts`
- `tests/export.resolver.test.ts`
- `tests/behaviorlog-conformance.test.ts`
- `tests/export-panel-ui.test.tsx`
- `docs/PRODUCT_SPEC.md`
- `docs/EXPORT_FORMATS.md`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`

Out of scope:
- Import or restore replay of exported configuration-event history.
- A new BehaviorLog standard profile for non-schedule configuration changes.
- A configuration-history browser in the Cadence UI.
- Hosted deployment without explicit authorization.

---

## Ticket 098: Public repository security release gate

Produce auditable evidence that publishing the Cadence source and repository
history will not expose credentials, private account data, or an authorization
model that depends on hidden implementation details.

Context:
- The repository currently describes Cadence as public and open-source, but the
  connected GitHub remote is not accessible to an unauthenticated visitor as of
  2026-08-25.
- Ticket 079 documents a live production email-recipient authorization defect.
  Ticket 082 documents an account-controlled push fan-out abuse path. Public
  visibility must not precede their deployed fixes.
- `.gitignore` excludes local environment files, but ignore rules do not prove
  that no secret existed in an earlier commit, branch, tag, issue, pull request,
  release asset, workflow log, or other GitHub-hosted repository surface.
- GitHub requires a leaked credential to be revoked or rotated before history
  cleanup. Rewriting history cannot remove the credential from existing clones
  or forks:
  `https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository`.
- Supabase Data API safety depends on both least-privilege grants and RLS. Secret
  and service-role keys bypass RLS and must remain server-only:
  `https://supabase.com/docs/guides/database/postgres/row-level-security`.

Dependencies:
- Tickets 079-083 and 093 must complete.
- Every security-relevant application and migration change from those tickets
  must be deployed and verified before this gate can pass. Read-only audit work
  may start earlier.

Settled decisions:
- Prefer publishing the existing repository and preserving its history only if
  every scan and metadata review passes.
- Use at least one history-aware secret scanner across all local Git refs. Add
  manual project-specific patterns for Supabase, Sequenzy, VAPID, Google OAuth,
  AgentMail, Vercel, cron, reminder-process, database, and session credentials.
- Inventory GitHub-hosted surfaces through authenticated read-only API or CLI
  access. Include branches, tags, issues, pull requests, comments, reviews,
  releases, assets, Actions logs and artifacts, wiki content, discussions, and
  Pages content when those surfaces exist.
- Treat a real credential finding as compromised. Revoke or rotate it first,
  update every authorized deployment, verify the old value fails, and only then
  decide whether history cleanup remains necessary.
- Never commit raw scanner output, matched values, credential fingerprints,
  private GitHub metadata, production identifiers, or user data. Keep only a
  sanitized aggregate record of tools, versions, scopes, dates, and outcomes.
- Build the Next.js and Astro browser artifacts with unique synthetic canary
  values. Prove that every server-only canary is absent from browser-delivered
  files. Public configuration canaries may appear only where documented.
- Review every exposed table, view, function, grant, and policy. Extend the
  existing ordinary-user RLS smoke rather than creating a parallel ownership
  harness. The smoke must attempt cross-account read and mutation through the
  same Data API paths available to a signed-in browser.
- Inventory every service-role or secret-key caller. Confirm that no client
  component, browser bundle, user-facing data path, log, error response, or
  exported artifact can receive a privileged credential.
- Record every unresolved security-relevant ticket and its publication impact.
  The gate fails for a known path that can expose another account's data, abuse
  a provider, bypass authorization, or reveal a live credential.
- This ticket produces evidence only. It does not change repository visibility,
  rewrite Git history, rotate credentials, or deploy provider changes without
  separate owner authorization.

Acceptance criteria:
- A full tracked-tree and all-ref Git-history scan reports no active credential,
  private key, database URI, session material, or real account data.
- A GitHub metadata inventory reports no sensitive content on every existing
  repository surface, or each finding has a documented private remediation.
- Every confirmed credential finding is revoked or rotated before the gate can
  pass. The old credential is verified unusable without printing either value.
- Synthetic server-only canaries are absent from all browser-delivered Next.js
  and Astro artifacts.
- Static grant/policy coverage and the authenticated many-account RLS smoke
  cover every exposed table, view, and function. Cross-account reads and writes
  fail.
- The browser and marketing applications use only documented public Supabase
  and VAPID values. No service-role, provider, OAuth secret, process secret, or
  database credential enters a client path.
- `npm audit --omit=dev` reports no unresolved high or critical production
  vulnerability. Any exception names the package, exposure, mitigation, owner,
  and expiry date without copying sensitive advisory material.
- `docs/PUBLIC_REPOSITORY_RELEASE.md` records the sanitized evidence, the exact
  tested commit, deployed application version, hosted migration boundary, open
  risks, and a clear pass or fail decision.
- A fail decision blocks Ticket 100. A pass decision remains valid only for the
  exact reviewed Git commit and repository metadata snapshot.

Suggested files:
- `scripts/check-public-source-boundary.mjs`
- `scripts/check-agents.mjs`
- `scripts/supabase-rls-smoke.mjs`
- `tests/public-source-boundary.test.ts`
- `tests/rls-policy-registry.test.ts`
- `tests/rls-smoke-script.test.ts`
- `.gitignore`
- `.env.example`
- `docs/PUBLIC_REPOSITORY_RELEASE.md`
- `docs/OPERATIONS.md`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

Required verification:
- Run the selected history-aware scanner against all refs and record its exact
  version and scope in the sanitized release document.
- Build both applications with synthetic public and server-only canaries, then
  run `npm run build`, `npm run marketing:build`, and
  `npm run marketing:check`.
- Run `npm run smoke:rls` against local Supabase after a clean
  `npm run supabase -- db reset`.
- Run `npm audit --omit=dev`.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run resolvers:check`, `npm run lint`, `npm run typecheck`, and
  `npm run test`.

Out of scope:
- Claiming that source publication or an automated scan proves the absence of
  every vulnerability.
- Publishing exploit reproduction steps for an unpatched production defect.
- Rewriting Git history, changing repository visibility, rotating production
  credentials, or changing hosted providers without explicit owner approval.
- Adding an admin or support path that can read user behavioral data.

---

## Ticket 099: Open-source license and security disclosure contract

Give public users clear legal permission to use the source and a private route
for reporting security defects before the repository becomes public.

Context:
- The repository calls Cadence open-source but has no root `LICENSE` file.
  Public visibility alone does not grant an open-source license.
- The repository has no root `SECURITY.md`, supported-version statement, or
  documented private vulnerability-reporting route.
- The code license, Cadence name and marks, third-party assets, hosted service
  terms, privacy terms, and user-owned behavioral data are separate concerns.

Dependencies:
- None for drafting and owner decisions.
- Ticket 098 must pass before this ticket's final documents authorize public
  publication.

Owner decisions required:
- Select the code license. Use an OSI-approved license if Cadence will continue
  to claim that it is open-source. Do not infer or choose the license from the
  current product copy.
- Select the private security-reporting mechanism and monitored recipient.
- Decide whether the Cadence name, logo, illustrations, sample content, and
  other non-code assets share the code license or carry explicit exclusions.

Settled decisions:
- Add one root license with an explicit scope. Identify excluded marks, assets,
  or third-party material without inventing ownership claims.
- Inventory direct dependencies, copied code, fonts, icons, images, sample
  bundles, and BehaviorLog materials for license compatibility and attribution
  requirements. Add a notice file only when the selected license or inventory
  requires it.
- Keep hosted-service Terms, Privacy, and Trust documents distinct from the
  source license. The source license grants no rights to user behavioral data.
- Add `SECURITY.md` with supported versions, private reporting instructions,
  requested report details, coordinated-disclosure expectations, and safe
  research boundaries. Do not promise a response deadline the owner cannot
  operate.
- Tell reporters not to include credentials, real user data, or behavioral
  content in a public issue.
- Update the README with the selected license, security-policy link, local
  setup boundary, and the distinction between public browser configuration and
  server-only secrets.
- Keep a contributor license agreement, copyright assignment, bug-bounty
  program, and paid support promise out of scope unless the owner requests one.
- This ticket is documentation and policy work. It does not constitute legal
  advice. The owner may request legal review before approving the license.

Acceptance criteria:
- The owner has recorded the three required decisions.
- A root `LICENSE` contains the approved license text and correct copyright
  information.
- Any excluded marks, assets, or third-party materials are named in README or a
  required notice file. No file receives ambiguous or contradictory licensing.
- `SECURITY.md` provides a tested private reporting route and explains which
  versions receive security fixes.
- README links to `LICENSE` and `SECURITY.md`, explains self-hosting secret
  responsibilities, and never implies that source visibility grants access to
  the hosted service or user data.
- Public Terms, Privacy, and Trust copy remains consistent with the selected
  license and disclosure policy.
- Marketing "View on GitHub" copy names the repository only after Ticket 100
  makes the destination public.

Suggested files:
- `LICENSE`
- `SECURITY.md`
- `README.md`
- `NOTICE` only if required
- `apps/marketing/src/data/routes.ts`
- `apps/marketing/src/pages/about.astro`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/DECISIONS.md`
- `STATUS.md`

Required verification:
- Test the private reporting route without sending real vulnerability or user
  data.
- Run the repository's license or notice checks if the implementation adds
  them.
- Run `npm run agents:check`, `npm run marketing:check`, and
  `npm run marketing:build`.

Out of scope:
- Selecting the license without owner approval.
- Licensing user data, production credentials, or third-party material Cadence
  does not own.
- Creating a contributor license agreement, foundation, bug bounty, paid
  support contract, or trademark registration.

---

## Ticket 100: Public repository publication and GitHub security controls

Publish the reviewed Cadence repository in a controlled, verified sequence and
enable the repository controls needed for ongoing public development.

Dependencies:
- Tickets 098 and 099 must complete with a passing security gate and approved
  license.
- The exact reviewed application and migration version must already be deployed
  and verified in production.

Settled decisions:
- Prefer changing the existing `emixd12/habit-tracking-app` repository to
  public when Ticket 098 approves its history and metadata. Do not create a
  second repository merely to avoid completing the review.
- If Ticket 098 requires a history rewrite or replacement repository, stop for
  explicit owner approval. Record lost commit, issue, pull request, release,
  deployment, and contributor provenance before choosing that path.
- Inventory repository collaborators, deploy keys, webhooks, environments,
  Actions secrets, branch rules, GitHub Apps, Pages settings, releases, issues,
  pull requests, discussions, and wiki state before changing visibility. Do not
  print or copy secret values.
- Add pull-request CI for repository checks, lint, typecheck, tests, and builds.
  Protect `main` from force pushes and deletion. Require the checks that the
  repository can run reliably before requiring pull requests.
- Enable GitHub secret scanning, repository push protection, Dependabot alerts,
  dependency security updates, private vulnerability reporting, and CodeQL
  default setup. GitHub documents secret scanning as automatic and free for
  public repositories and recommends CodeQL default setup for eligible public
  repositories:
  `https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning`
  and
  `https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning`.
- Review every initial secret, dependency, and CodeQL alert. Close only false
  positives with a concrete reason. A high or critical alert blocks completion
  unless the owner accepts a documented, time-bounded exception.
- Publish the source only after the production deployment contains the fixes.
  Never expose a patch in public source while the matching known production
  weakness remains exploitable.
- Treat repository visibility, branch protection, GitHub security settings,
  and production deployment as external mutations. Ticket creation does not
  authorize those actions. Obtain explicit owner approval during execution.
- Keep the repository public after verification. Roll back visibility only for
  an incident, and assume clones already retain everything published.

Acceptance criteria:
- Pull-request CI passes from a fresh unauthenticated clone using documented
  setup and no production credentials.
- `main` branch protection blocks force pushes and deletion and requires the
  selected stable checks.
- Secret scanning, repository push protection, Dependabot alerts, dependency
  security updates, private vulnerability reporting, and CodeQL default setup
  are enabled and have completed their first scans where applicable.
- No untriaged high or critical security alert remains. Every lower-severity
  alert has an owner and disposition.
- The owner explicitly authorizes the visibility change after reviewing the
  Ticket 098 pass record and Ticket 099 license.
- An unauthenticated visitor can view and clone the canonical repository, read
  `LICENSE` and `SECURITY.md`, and complete the documented non-provider checks.
- The marketing "View on GitHub" destination resolves to the canonical public
  repository.
- Production Google login, cross-account RLS smoke, Timeline read and status
  mutation, Export, account deletion failure recovery, reminder processing,
  and bounded browser-push delivery pass after publication.
- `docs/PUBLIC_REPOSITORY_RELEASE.md`, `docs/OPERATIONS.md`,
  `docs/VERCEL_WORKFLOW.md`, and `STATUS.md` record the public repository URL,
  release commit, GitHub controls, production deployment, verification date,
  remaining risks, and incident rollback owner.

Suggested files:
- `.github/workflows/ci.yml`
- `.github/dependabot.yml`
- `README.md`
- `SECURITY.md`
- `docs/PUBLIC_REPOSITORY_RELEASE.md`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `apps/marketing/src/data/site.ts`
- `STATUS.md`

Required verification:
- Run the pull-request workflow from a non-default branch before protecting
  `main`.
- Run `npm run agents:check`, `npm run interactions:check`,
  `npm run resolvers:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, `npm run build`, `npm run marketing:check`, and
  `npm run marketing:build`.
- Run the authenticated production checks named in the acceptance criteria
  without copying account data or credentials into the release record.
- Verify the public clone and marketing link from an unauthenticated browser
  session.

Out of scope:
- Publishing before Ticket 098 passes or before the reviewed fixes reach
  production.
- Weakening Auth, RLS, grants, route protection, secret ownership, or provider
  controls to make a public clone easier to run.
- Publishing private operational evidence, user data, provider payloads,
  scanner matches, Actions secrets, or deployment credentials.
- Assuming that switching the repository back to private removes published
  history from clones or forks.

---

## Ticket 101: Public trust evidence contract and freshness rules

Define one versioned, sanitized evidence contract for every check Cadence shows
on its public Trust surface.

Context:
- Tickets 098 and 100 create release records and GitHub security controls, but
  they do not produce one machine-readable record the Trust page can consume.
- Ticket 092 checks source manifests and generated marketing files during a
  build. It does not prove that the declared routes are live.
- The current Trust page contains durable product claims. It has no status
  vocabulary, freshness rules, immutable evidence links, or safe missing-data
  behavior.
- Without a contract, a failed collector can disappear from the page or leave
  an old green result looking current.

Dependencies:
- Ticket 092 owns the corrected marketing route manifest and parity checks.
- Tickets 098 and 100 own the initial public-source gate and GitHub security
  controls. This ticket may define and test the contract earlier, but it cannot
  mark their checks Passed before those tickets complete.

Settled decisions:
- Add a JSON Schema for `cadence.public-trust-evidence` with an integer schema
  version. Reject unknown status values and malformed timestamps.
- Every snapshot names the exact source commit, application deployment,
  marketing deployment, workflow run, build time, verification time, and
  freshness deadline it covers. Use sanitized public identifiers only.
- Required checks are source-to-deployment provenance, production dependency
  vulnerabilities, code scanning, secret scanning, public artifact integrity,
  application live-route comparison, marketing live-route comparison, hosted
  migration boundary, and cross-account RLS isolation.
- Use exactly five public statuses: `passed`, `failed`, `stale`, `not_run`, and
  `unavailable`. Display them as Passed, Failed, Stale, Not run, and
  Unavailable.
- `not_run` means Cadence supports the check but has no completed result for the
  named deployment. `unavailable` means the platform cannot perform or expose
  that check. It requires a concrete reason and scope limit.
- A stored Passed result becomes Stale after its check-specific freshness
  deadline or when its named deployment no longer matches the current
  deployment. A consumer derives Stale; a publisher cannot extend freshness by
  copying an old result into a new snapshot.
- Every check records its identifier, status, scope, tool and version,
  completion time, freshness deadline, summary, and immutable evidence URL.
  Failed, Not run, and Unavailable checks remain present in the snapshot.
- Evidence summaries may contain counts, digests, public dependency names,
  public route paths, and sanitized deployment identifiers. They must not
  contain secrets, scanner matches, private repository metadata, provider
  tokens, raw headers, user identifiers, behavioral data, notes, or private
  hostnames.
- Implement schema validation and freshness calculation as pure code. The UI,
  workflow scripts, and route handlers consume that code instead of inventing
  status rules independently.
- Keep immutable snapshots. A separate `latest.json` pointer may identify the
  newest valid snapshot, but it never replaces or mutates an older snapshot.
- The contract states what each check proves and does not prove. It must not use
  certification, audit, tamper-proof, or vulnerability-free language.

Acceptance criteria:
- Valid fixtures cover every status and required check.
- Validation rejects missing required checks, unknown status values, invalid
  timestamps, mutable evidence URLs, deployment mismatches, and prohibited
  sensitive fields.
- Freshness tests show that an unexpired matching result stays Passed, an
  expired result becomes Stale, and a prior-deployment result becomes Stale.
- Failed, Not run, and Unavailable checks survive normalization and remain
  visible to consumers.
- The schema defines the public meaning and scope limit of every required
  check.
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`, `docs/OPERATIONS.md`, and
  `docs/VERCEL_WORKFLOW.md` identify the contract, ownership, retention, and
  freshness policy.

Suggested files:
- `schemas/public-trust-evidence.schema.json`
- `lib/resolvers/public-trust-evidence.resolver.ts`
- `lib/trust/public-trust-evidence.ts`
- `scripts/check-public-trust-evidence.mjs`
- `tests/public-trust-evidence.resolver.test.ts`
- `tests/public-trust-evidence-script.test.ts`
- `docs/AGENT_RESOLVERS.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

Required verification:
- Validate passing, failing, expired, missing, and malformed fixtures.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, and `npm run test`.

Out of scope:
- Running production scans, changing repository visibility, enabling GitHub
  Pages, or modifying Vercel deployments.
- Treating absence of a scanner finding as proof that no vulnerability exists.
- Publishing raw operational evidence or any user-owned data.

---

## Ticket 102: Post-deployment trust verification and public evidence feed

Run the public Trust checks against a named production release and publish
sanitized, immutable evidence for human and machine consumers.

Dependencies:
- Tickets 092, 098, 100, and 101 must complete.
- The exact application and marketing commits under test must be deployed and
  report Ready before collection starts.

Settled decisions:
- Add one least-privilege GitHub Actions workflow. It runs manually, after an
  authorized production release, and on a daily schedule for freshness.
- Keep the existing Vercel Git deployment model. Provenance verifies that each
  Ready deployment names the expected Git commit. It does not claim that
  Cadence controls or signs Vercel's private function bundles.
- Generate a production dependency SBOM from the lockfile. Run
  `npm audit --omit=dev`, record the scanner version and aggregate severity
  counts, and publish the SBOM digest. Do not publish private advisory notes.
- Collect the public status of CodeQL, Dependabot, secret scanning, and push
  protection configured by Ticket 100. If GitHub cannot expose a result safely,
  publish Unavailable with the precise limitation instead of inferring Passed.
- Build an integrity manifest for publicly retrievable application and
  marketing assets. Record SHA-256 digests, byte lengths, content types, final
  URLs, and verification times. Do not publish or claim integrity coverage for
  private server bundles.
- Compare the generated marketing route manifest with the live marketing
  origin. Compare a separate explicit registry of public application routes
  with the live application origin. Check the expected status or redirect,
  canonical URL, content type, stable page marker, and machine-readable mirror
  where applicable.
- Bound route checks by an allowlisted origin, route count, response size,
  redirect count, and timeout. Never crawl arbitrary URLs from a response.
- Record the hosted Supabase migration boundary without publishing database
  credentials or connection details. Reuse the authenticated many-account RLS
  smoke from Ticket 098 at its documented cadence; mark it Stale when its
  freshness window expires.
- Publish one immutable snapshot before updating `latest.json`. Use a GitHub
  Pages deployment built from a workflow artifact, not generated commits on
  `main`. Keep snapshots addressable by workflow run and deployment identifiers.
- A check failure still publishes a valid Failed snapshot, then fails the
  workflow gate. A schema or sanitization failure publishes nothing and leaves
  the previous `latest.json` unchanged.
- If one application deployed and the other did not, publish the mismatch and
  mark affected provenance and route checks Failed or Stale. Never combine
  evidence from unrelated deployments into a Passed release.
- Log only sanitized summaries. Store secrets in protected Actions
  environments. Grant the workflow only the repository, Pages, Vercel, and
  Supabase permissions it needs.
- Enabling GitHub Pages, adding secrets, dispatching production verification,
  or changing provider settings requires explicit owner authorization during
  implementation. This ticket definition grants none of those mutations.

Acceptance criteria:
- A manual workflow run against the named production deployments publishes a
  schema-valid immutable snapshot and updates `latest.json` atomically.
- The snapshot maps both Ready Vercel deployments to the expected source commit
  and describes the limits of that provenance.
- Dependency evidence contains an SBOM digest, scanner version, aggregate
  result, and immutable workflow evidence link.
- Integrity evidence detects a changed response body, missing public asset,
  unexpected redirect, content-type change, and digest mismatch.
- Live-route comparison detects a manifest route missing in production, an
  undeclared live public route in the allowlisted surface, a wrong canonical,
  and a divergent Markdown mirror.
- A simulated Failed check remains public and causes the workflow to fail after
  publication.
- A simulated schema or sanitization failure does not replace the last valid
  `latest.json`.
- Scheduled verification makes an expired result Stale even when no new
  application deployment occurred.
- Public evidence contains no secret, raw scanner match, private provider
  metadata, user identifier, behavioral content, or production response body.
- Operations documentation covers dispatch, expected cadence, failure triage,
  evidence retention, secret rotation, Pages rollback, and provider outage
  behavior.

Suggested files:
- `.github/workflows/public-trust-evidence.yml`
- `scripts/collect-public-trust-evidence.mjs`
- `scripts/compare-public-routes.mjs`
- `scripts/build-public-integrity-manifest.mjs`
- `scripts/publish-public-trust-evidence.mjs`
- `config/public-app-routes.json`
- `apps/marketing/src/data/routes.ts`
- `tests/public-trust-collector.test.ts`
- `tests/public-route-comparison.test.ts`
- `tests/public-integrity-manifest.test.ts`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `docs/CRAWL_POLICY.md`
- `docs/PUBLIC_REPOSITORY_RELEASE.md`
- `STATUS.md`

Required verification:
- Run all collectors against deterministic local fixtures with no provider
  credentials.
- Run a manual authorized workflow against Preview before Production. Confirm
  the allowlists prevent access to non-Cadence origins.
- Inspect the public snapshot from an unauthenticated browser and scan the
  output for prohibited fields and synthetic secret canaries.
- Run `npm audit --omit=dev`, `npm run agents:check`,
  `npm run interactions:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, `npm run build`,
  `npm run marketing:check`, and `npm run marketing:build`.

Out of scope:
- Replacing Vercel Git deployments with a custom artifact deployment system.
- Claiming integrity coverage for Vercel's private runtime or function bundles.
- Exposing private GitHub security alerts, raw scan results, repository
  administration metadata, provider credentials, or production user data.
- Broad crawling, authenticated user-flow monitoring, penetration testing, or
  load testing.

---

## Ticket 103: Evidence-backed public Trust page and machine-readable route

Render the public Trust checks without overstating their result, and expose the
same normalized result to agents.

Dependencies:
- Tickets 101 and 102 must complete.
- Ticket 100 must make the canonical source repository public before the page
  links to repository evidence.

Settled decisions:
- Keep the authenticated application's public `/trust` route as the canonical
  human Trust page. Do not create a second marketing Trust page.
- Add a same-origin public machine route for the normalized current result.
  The route validates the upstream evidence contract and applies freshness and
  deployment-match rules before responding.
- Always render rows for source provenance, dependency scanning, code scanning,
  secret scanning, artifact integrity, application routes, marketing routes,
  migration boundary, and RLS isolation.
- A check appears Passed only when a valid snapshot names the current
  deployment and remains inside its freshness window. An expired or superseded
  result appears Stale.
- If no valid snapshot exists, supported checks appear Not run. If the platform
  cannot supply a check, it appears Unavailable with its reason. Network,
  parsing, or schema failures never produce Passed.
- Show the covered commit and deployments, last verified time, next freshness
  deadline, scope summary, limitation, and immutable evidence link. Do not show
  raw response bodies, scanner findings, credentials, or user data.
- Preserve the current durable Trust content about manual status truth,
  single-account isolation, portability, reminders, and BehaviorLog. Separate
  those product commitments from time-bound verification results.
- Use text and icons in addition to color. Status rows, timestamps, evidence
  links, failure explanations, and stale notices must work at 390px and with
  keyboard and screen-reader navigation.
- Keep the last valid snapshot visible as Stale during an evidence-host outage
  when the runtime has a validated cached copy. If no validated copy is
  available, show Unavailable and identify the feed failure.
- Link the marketing footer, Docs page, Markdown mirrors, `llms.txt`, and
  `llms-full.txt` to the canonical Trust page and machine route with absolute
  cross-origin URLs where required.
- Update the interaction registry for every new evidence link, disclosure, or
  refresh action. Do not add a manual refresh control unless cached evidence
  cannot meet the freshness contract.
- The page may say Verified only for a named check and time. It must not call
  Cadence audited, certified, secure, tamper-proof, or vulnerability-free.

Acceptance criteria:
- `/trust` renders every required check for Passed, Failed, Stale, Not run, and
  Unavailable fixtures.
- The machine route returns the same normalized statuses, timestamps, scope,
  and immutable evidence URLs shown on `/trust`.
- Missing, malformed, expired, mismatched-deployment, and unreachable evidence
  never render as Passed.
- The page distinguishes source-to-deployment provenance from public asset
  integrity and states the limit of each.
- A user can reach the immutable evidence for each completed check without
  authentication.
- Marketing HTML, Markdown, and agent outputs point to the canonical routes and
  do not duplicate or contradict status text.
- Mobile, keyboard, screen-reader, reduced-motion, and no-color checks pass.
- Public responses contain no user data, secrets, raw scanner findings, private
  provider metadata, or unsafe HTML from evidence summaries.

Suggested files:
- `app/(legal)/trust/page.tsx`
- `app/(legal)/trust/loading.tsx`
- `app/api/public/trust-evidence/route.ts`
- `components/settings/LegalContent.tsx`
- `components/trust/TrustEvidencePanel.tsx`
- `lib/services/public-trust-evidence.service.ts`
- `lib/trust/public-trust-evidence.ts`
- `apps/marketing/src/data/routes.ts`
- `apps/marketing/src/data/agent-output.ts`
- `apps/marketing/src/pages/docs.astro`
- `docs/ROUTE_MAP.md`
- `docs/UI_SPEC.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/CRAWL_POLICY.md`
- `interaction-registry.json`
- `tests/public-trust-page.test.tsx`
- `tests/public-trust-route.test.ts`
- `STATUS.md`

Required verification:
- Run the public Trust page and machine route against fixtures for all five
  statuses and every failure mode in the acceptance criteria.
- Run the project-local impeccable context workflow before editing the UI, then
  run `npm run design-system:check` and `npm run interactions:check`.
- Run `npm run agents:check`, `npm run resolvers:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, `npm run build`,
  `npm run marketing:check`, and `npm run marketing:build`.
- Verify `/trust` at desktop and 390px viewports. Verify the machine route and
  cross-origin links from an unauthenticated browser session.

Out of scope:
- Authenticated monitoring, synthetic user accounts, production write probes,
  penetration testing, or an admin dashboard.
- Exposing raw security reports or adding claims that exceed the published
  evidence.
- Replacing the existing Terms, Privacy, or durable Trust commitments.

---

## Ticket 104: Security inbox deliverability hardening

Status: blocked (2026-09-04).

Read-only review and monitoring guidance are recorded. Operator diagnostics
and one separately authorized synthetic send remain required.
Evidence: `docs/qa/2026-09-04-tickets-088-091-104-105.md`.

Platform impact:

| Platform | Impact |
| --- | --- |
| Web | docs/OPERATIONS.md#ticket-104-security-inbox-follow-up |
| Desktop | Existing local runtime remains unchanged; this ticket concerns hosted web/provider operations. |
| Marketing | Not applicable: no public-content or navigation change. |
| Future mobile | No implementation; mobile remains deferred under docs/FUTURE_UPDATES.md. |


Close the filtered-folder risk found by the Ticket 099 security-route test
without weakening mailbox protections or changing Cadence's public reporting
address.

Dependencies:
- Tickets 099 and 100 must remain complete.
- Any mailbox rule, allowlist, or provider setting change requires explicit
  owner authorization during execution.

Settled decisions:
- Keep the dedicated security email as the primary private reporting route and
  GitHub private vulnerability reporting as the secondary route.
- Inspect the existing delivery path before changing it. Identify whether the
  junk placement came from forwarding, sender authentication, mailbox policy,
  or a provider reputation rule.
- Prefer the narrowest provider-supported rule that preserves normal spam and
  malware filtering. Do not disable filtering globally.
- Document one owner, a review cadence, and coverage for inbox, junk, spam, and
  quarantine folders. A mailbox rule does not replace monitoring.
- Send only one harmless synthetic route-test message after separate approval
  of the recipient and send. Do not include vulnerability details, credentials,
  user data, or behavioral content.
- Record only sanitized delivery status, destination folder class, and timing.
  Do not commit addresses, headers, provider identifiers, or message content.

Acceptance criteria:
- The provider path and root cause of the filtered delivery are documented in
  private operator notes.
- The narrowest approved mailbox or provider rule is applied, or the ticket
  records why no safe rule exists and relies on explicit filtered-folder
  monitoring.
- One authorized synthetic message reaches the monitored route and receives
  timely review from either the primary inbox or a documented filtered folder.
- `SECURITY.md` continues to name the same primary and secondary private routes.
- Public documentation contains no mailbox configuration, address beyond the
  already-published route, message metadata, or private provider detail.

Suggested files:
- `docs/OPERATIONS.md`
- `docs/OPEN_SOURCE_DECISION_PACKET.md`
- `docs/PUBLIC_REPOSITORY_RELEASE.md`
- `STATUS.md`

Required verification:
- Review the primary inbox, junk, spam, and quarantine surfaces after the
  authorized synthetic send.
- Verify GitHub private vulnerability reporting remains enabled.
- Run `npm run agents:check`, `npm run interactions:check`, and
  `npm run public-source:check` for repository documentation changes.

Out of scope:
- Publishing a vulnerability report, weakening mailbox-wide filtering, adding
  an admin dashboard, or automating inbound security-report handling.
- Changing the public security address unless the owner opens a separate policy
  decision.

---

## Ticket 105: Browser-push dependency compatibility cleanup

Status: in_progress (2026-09-04).

The published dependency has no newer release containing the upstream fix.
The documented exception and fake-transport checks pass. Preview inspection remains pending.
Evidence: `docs/qa/2026-09-04-tickets-088-091-104-105.md`.

Platform impact:

| Platform | Impact |
| --- | --- |
| Web | tests/web-push-compatibility.test.ts; docs/OPERATIONS.md#ticket-105-browser-push-compatibility-exception |
| Desktop | Existing local runtime remains unchanged; this ticket concerns hosted web/provider operations. |
| Marketing | Not applicable: no public-content or navigation change. |
| Future mobile | No implementation; mobile remains deferred under docs/FUTURE_UPDATES.md. |


Remove the non-failing Node `url.parse()` deprecation warning emitted by the
browser-push dependency while preserving the verified Web Push behavior.

Dependencies:
- Ticket 100 provides the recorded production warning and successful bounded
  browser-push delivery evidence.
- Use current official upstream package and Node documentation when selecting
  a compatible version.

Settled decisions:
- Trace the warning to the exact direct or transitive package and call path
  before changing dependencies.
- Prefer the smallest compatible dependency upgrade already supported by the
  existing `web-push` service. Do not patch `node_modules` or replace the Web
  Push provider for a deprecation warning.
- Preserve VAPID key ownership, push-subscription storage, reminder claiming,
  idempotency, expired-subscription handling, and failure logging.
- If upstream has no compatible fix, keep the current version, document the
  upstream issue and review trigger, and retain a focused regression check.
- Use local fakes for verification. A real browser-push send requires separate
  production authorization.

Acceptance criteria:
- Repository evidence identifies the package and version that emits the
  warning.
- The supported Node production path completes without the `url.parse()`
  deprecation warning, or an upstream-blocked exception names an owner and
  concrete recheck condition.
- Browser-push subject, payload, delivery, duplicate prevention, expired
  subscription, and failure tests continue to pass.
- `npm audit --omit=dev` introduces no new high or critical production finding.
- The application and Vercel-compatible production build pass on the supported
  Node version.

Suggested files:
- `package.json`
- `package-lock.json`
- `lib/services/web-push.service.ts`
- `tests/web-push-subject.test.ts`
- `tests/reminder.service.test.ts`
- `docs/OPERATIONS.md`
- `docs/VERCEL_WORKFLOW.md`
- `STATUS.md`

Required verification:
- Run the focused browser-push and reminder service tests with deprecation
  tracing enabled.
- Run `npm audit --omit=dev`, `npm run agents:check`,
  `npm run resolvers:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.
- Inspect one authorized Preview deployment before any separately authorized
  Production deployment.

Out of scope:
- Switching push providers, changing subscription schema, adding PWA or offline
  behavior, or sending a real notification without separate approval.

---

## Deferred work

Web PWA caching, web offline timeline access, and web pending status changes
remain deferred. Tickets 107–114 implement local-first desktop tracking;
Tickets 116–122 implement optional desktop account synchronization and conflict
handling.

See `/docs/FUTURE_UPDATES.md`.

---

## Ticket 106: Marketing content redesign and legal publication gates

Reframe public content around explicit decisions, preserved context,
longitudinal review, and portable records without exceeding implemented
product behavior.

Status: complete (2026-08-31).

Settled contract:

- Keep the public MIT source at
  `https://github.com/emixd12/habit-tracking-app`.
- Keep the application origin canonical for `/trust`, `/privacy`, and `/terms`.
- State that Cadence provides prompts while users export data and choose an
  external AI service. Cadence does not send behavior data to an AI provider.
- Name exactly five exports: JSONL, JSON, CSV, Markdown, and BehaviorLog bundle.
- Use Identity Scaffolding LLC, a Wyoming limited liability company assumed
  authorized in New York, at 30 N Gould St Ste R, Sheridan, WY 82801.
- Use a minimum age of 18, New York governing law subject to nonwaivable
  consumer protections, informal dispute resolution first, and then a court of
  competent jurisdiction in New York State. Do not require arbitration or a
  class-action waiver.
- Use the retention schedule in `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.
- Link the marketing header to the dedicated disclosed macOS preview release.

Acceptance criteria:

- Public copy matches the implemented product and the settled contract.
- Provider retention is verified with sanitized evidence before retention
  claims are published.
- `privacy@identityscaffolding.com` is created and confirmed with one harmless
  route test before publication.
- One legal review approves the final legal text and facts before publication.
- Public registration stays closed until all three gates pass.
- The work adds no product feature, AI integration, analytics, payment flow,
  auth flow, export format, duplicate legal route, or runtime dependency.

Completed 2026-08-31. The owner confirmed that active provider retention
settings were verified, `privacy@identityscaffolding.com` passed its harmless
route test, legal review approved the final Privacy and Terms text and facts,
and all publication approvals are complete. The final policy uses verified
active windows rather than the unsupported 30-day routine-log proposal.
Privacy and Terms are approved for publication. Public registration is
approved; this ticket changes no authentication implementation or provider
setting.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
| --- | --- |
| Web | The application publishes the approved canonical `/privacy` and `/terms` routes. The authentication implementation does not change. |
| Desktop | Ticket 113 owns the existing preview release and its disclosures; no desktop runtime code changes. |
| Marketing | The shared header adds the Download for macOS action through `BaseLayout.astro` and `site.ts`. |
| Future mobile | Deferred. This change neither implements nor advertises a mobile app. |

---

## Ticket 107: Desktop track activation

Activate the accepted macOS implementation plan without changing current web
behavior or claiming desktop completion.

Dependencies: owner approval recorded on 2026-08-30.

Current state (2026-08-30): complete. Activation docs and structural platform checks pass; this does not establish product parity.

Acceptance criteria:

- Reconcile `AGENTS.md`, product/architecture/desktop docs, deferred work, and
  the status ledger with the active track.
- Record the current tracking baseline in `docs/DESKTOP_PARITY.md`, anchored
  to existing interaction IDs, current code, and current data contracts.
- Extend the existing interaction registry with platform applicability,
  implementation state, and evidence; require valid references.
- Require platform impact entries for new or materially changed product/design
  tickets. Marketing consumes approved claims; future mobile remains deferred.
- Schedule Tickets 108–113 with native proof before broad refactoring and
  explicit parity, notification-coverage, and signed-release gates.
- Preserve unrelated uncommitted work, including Ticket 106 publication work.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Preserve current behavior; baseline in `docs/DESKTOP_PARITY.md` and `interaction-registry.json` |
| Desktop | `docs/DESKTOP_BUILD.md`; implementation follows Tickets 108–113 |
| Marketing | `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`; no new availability claim before approved release |
| Future mobile | Not applicable to implementation: mobile remains deferred; shared contracts remain portable |

Verification: agent, interaction, resolver, design-system, lint, typecheck,
test, web-build, and marketing checks. Structural parity metadata is not
semantic or native verification.

---

## Ticket 108: Native boundary proof

Prove native storage and notification boundaries before extracting shared
core code or porting the four product screens.

Dependencies: Ticket 107 contract; precedes Tickets 109–113.

Current state (2026-08-30): complete. Real native activation passed at 21:05:16Z. Evidence and remaining release checks live in `docs/qa/2026-08-30-desktop-native-boundary.md`.

Acceptance criteria:

- Add a minimal Tauri v2/Vite/React application under `apps/desktop`, targeting
  macOS 14+ and Apple Silicon. Keep Next.js at the repository root.
- Verify a persistent SQLite write survives application restart and an injected
  transaction failure rolls back every write.
- Verify native scheduled notification creation, cancellation, activation,
  permission denial, and restart behavior in actual macOS/WKWebView execution.
- Use a thin native transaction/scheduling boundary as needed. Separate calls
  to a SQL plugin do not establish atomicity. Standard desktop notification
  plugin delivery alone does not establish scheduling support.
- Record native evidence and limitations. Browser simulation, compilation,
  and unit tests do not establish OS delivery or activation.
- Verify OS readback and nearest-first coverage under observed scheduling
  limits. Target 30 days and clearly display a shorter verified horizon when
  needed. Do not assume a universal cap or add a background helper.
- Native notification activation remains a prerequisite for broad extraction;
  the horizon decision does not complete this ticket or relax other gates.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Preserve root scripts/deployment; regression verification under this ticket |
| Desktop | `apps/desktop`; native proof documented in `STATUS.md`; product UI follows Ticket 111 |
| Marketing | Not applicable: developer proof adds no approved product availability claim |
| Future mobile | Not applicable: native proof targets macOS only; no mobile implementation |

Verification: native build/tests plus persistent-write, rollback, notification,
activation, and restart checks. Run the repository verification set from Ticket
107. Keep this ticket incomplete until required native evidence exists.

---

## Ticket 109: Shared core and design foundations

Extract portable foundations incrementally while preserving web APIs.

Dependencies: Tickets 107–108, including native proof.

Current state (2026-08-30): complete. Portable core, atomic contracts, archive adapters, canonical tokens, fonts, and runtime adapters pass final BehaviorLog 0.3 checks. Web, marketing, and desktop builds pass.

Acceptance criteria:

- Add `packages/core` and `packages/ui` only as real implementations move.
  Reuse types, resolvers, orchestration, tokens, and installed dependencies.
- Preserve existing web module APIs through adapters or compatibility exports.
  Keep Supabase Auth, RLS, caching, and provider delivery in web adapters.
- Define operation-specific DataStore methods, including atomic Behavior,
  status, import, and restore operations. Do not introduce generic CRUD.
- Replace Node-only hashes without changing fingerprints. Isolate archives
  behind an adapter and preserve every existing archive safety limit.
- Check core imports for Next.js, Supabase, Tauri, Node-only APIs, browser
  globals, and concrete adapters. Update existing resolver governance for
  moved code; do not weaken resolver tests.
- Extract canonical tokens without forcing shared product components. Extend
  `design-system.surfaces.json` with real desktop implementations/bench
  evidence and separate product usage from previews.
- Establish shared domain fixtures and adapter contracts for Ticket 110.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing `lib/resolvers`, `lib/services`, and UI callers retain APIs through adapters |
| Desktop | `packages/core`, `packages/ui`; consumed by Tickets 110–112 |
| Marketing | Preserve Astro runtime; consume canonical tokens where applicable under this ticket |
| Future mobile | Not applicable to runtime work: portable contracts support a separately scheduled future mobile ticket |

Verification: full repository checks, core portability check, unchanged hash
fixtures, existing resolver tests, and web/marketing build equivalence.

---

## Ticket 110: Local persistence and atomic operations

Implement the current domain model in SQLite under one stable local profile.

Dependencies: Tickets 108–109.

Current state (2026-08-30): complete. SQLite schema 6 and ordinary authenticated Supabase contracts pass final 0.3 lifecycle, fresh replay, import/restore, stale-write, history, rollback, and restart checks. All 47 local Supabase migrations and 92 RLS checks pass. No hosted migration ran.

Acceptance criteria:

- Write git-tracked SQLite migrations from current data contracts, including
  schedules/slots, timing, all histories, configuration lineage, range-aware
  Occurrence identity, reminder records, and import provenance.
- Seed one stable profile and current default categories once. Preserve user
  changes and the selected timezone across restart.
- Preserve foreign keys, owner consistency, uniqueness, stale-write guards,
  append-only histories, Occurrence preservation, and idempotency.
- Commit each domain mutation and its outbox records atomically. Retain
  tombstones, cursors, stable local identity, and a no-op SyncEngine. Add no
  live sync, remote conflict policy, cloud login, or provider delivery.
- Implement atomic Behavior/status/import/restore operations and meaningful
  rollback tests. Preserve accepted-preview binding and existing privacy gates.
- Document SQLite schema/migration ownership in `docs/DATA_MODEL.md` without
  changing hosted schema or Supabase RLS semantics.
- Run the same operation contract suite against local Supabase and real SQLite.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing Supabase adapter participates in shared contract tests; no hosted migration authorized |
| Desktop | SQLite adapter under `apps/desktop`; `docs/DATA_MODEL.md` documents implemented schema |
| Marketing | Not applicable: persistence adds no public-copy change |
| Future mobile | Not applicable to implementation: portable contracts remain available for future scoped work |

Verification: both adapter suites, clean local migrations, rollback, restart,
stale writes, protected Occurrences, timing restart, and the repository checks.

---

## Ticket 111: Desktop tracking parity

Port all current tracking capabilities with the current sparse four-screen UI.

Dependencies: Tickets 109–110; baseline from Ticket 107.

Current state (2026-08-31): complete locally. Four screens use shared UI and
local services. Native tracking, review, archive/restore, save/privacy,
merge/replay, destructive restore, responsive layout, and keyboard evidence
pass. Final 0.3 builds and adapter checks pass. The owner confirmed launching
without networking, setting the synthetic Cadence offline QA Occurrence to Completed,
and persistence after quit/relaunch. The supplied screenshot shows Completed.
Before GUI inspection, SQLite independently confirmed the saved decision at
00:28:19 EDT, with its status mutation at 00:26:04.205 and passing integrity and
foreign-key checks. The running process started at 00:26:20, after the decision;
the reopened native UI retained Completed before cleanup. Network disconnection
was owner-confirmed, not independently observed. Evidence:
`docs/qa/2026-08-30-desktop-lifecycle-release.md#offline-launch-and-persistence-passed`.
Ticket 113's preview milestone later completed. Ticket 115 owns deferred Apple-
trusted distribution requirements.

Acceptance criteria:

- Timeline preserves Needs decision, manual statuses, Notes, timing, retained
  corrections, and completion feedback.
- Behaviors preserves every recurrence/time-range control, multiple schedules,
  categories, edit/archive/restore, analytics, and selected-day review.
- Export & Import preserves all five formats, prompt tools, privacy defaults,
  BehaviorLog import/merge, destructive restore, history, and provenance.
- Reuse BehaviorLog import for web-to-desktop transfer. Add no Full JSON importer.
- Local Settings preserves timezone, optional onboarding, and notification
  controls. Omit cloud account controls, email delivery, and duplicate legal pages.
- Use callbacks/client services instead of Server Actions. Bundle necessary
  fonts, images, and audio for offline operation, subject to Ticket 113 rights review.
- Update existing interaction IDs and design-system surface mappings with real
  implementations and evidence. Keep product usage separate from bench previews.
- Preserve keyboard access, responsive layouts, native WKWebView rendering,
  offline launch, and restart persistence.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared-core consumers retain semantics; common fixtures and web regression checks |
| Desktop | `apps/desktop`; evidence in `docs/DESKTOP_PARITY.md` and `interaction-registry.json` |
| Marketing | Do not claim notarized or generally available desktop distribution until Ticket 115 passes |
| Future mobile | Not applicable to implementation: responsive contracts do not authorize mobile delivery |

Verification: common parity fixtures; midnight/DST, monthly fallback,
overlapping schedules, stale edits, timing restart, Occurrence preservation,
BehaviorLog round trips, import/restore rollback, stale previews, archive limits,
and sensitive-data defaults. Run full repository checks and actual WKWebView QA.
Native reminder coverage remains Ticket 112; Apple-trusted distribution is Ticket 115.

---

## Ticket 112: Native reminder coverage

Deliver native macOS reminders with a clearly displayed, verified OS-limited
horizon. The owner accepted this replacement for guaranteed 30-day coverage
on 2026-08-30; 30 days remains the target.

Dependencies: Tickets 108–111.

Current state (2026-08-31): complete locally. Native reconciliation, readback,
visible coverage, cancellation, fully quit delivery, and product click/focus
are verified. Exact OS delivery history survives archival, restart, and export
without claiming user receipt. Profile-local midnight, DST, timezone replacement,
and wake/resume event tests pass. Actual system sleep/wake now passes: OS logs
record sleep at 00:17:30 EDT and wake at 00:17:32. Persisted planning and coverage
writes followed at 00:17:32.668 and 00:17:35.252, before the next minute poll and
before GUI inspection. Settings confirmed Allowed permission, complete zero/zero
coverage, and no errors without selecting Refresh. This establishes automatic
post-wake reconciliation, not an exclusive wake-versus-resume callback source.
Evidence: `docs/qa/2026-08-30-desktop-lifecycle-release.md#system-sleep-and-wake-passed`.

Ticket 111 is complete locally, including owner-confirmed offline acceptance.
Ticket 113 later completed its preview scope. Completing Tickets 111 and 112
does not establish Ticket 115 Apple-trusted distribution readiness.

Acceptance criteria:

- Use a thin macOS scheduler adapter. Preserve existing TypeScript reminder
  planning and hosted browser/email semantics.
- Target the next 30 days and schedule nearest eligible reminders first.
  Reconcile on launch, resume, local day change, and relevant mutations.
- Read retained requests back from the OS. Report only contiguous coverage
  before the first missing intended request, not the furthest retained date.
  Show the actual scheduled-through date/time and clearly disclose a shorter
  horizon or unavailable verification. Do not assume a universal request cap.
- Persist native request identities. Make cancellation/replacement idempotent
  across resolution, edits, archival, repeated reconciliation, and restart.
- Route notification activation to the intended Timeline Occurrence.
- Export native delivery through BehaviorLog's existing extension mechanism;
  do not fork the schema or imply receipt from scheduling acceptance.
- Verify permission denial, cancellation, sleep/resume, fully quit delivery,
  and actual OS scheduling limits. Never silently truncate coverage.
- A shorter OS-limited horizon may pass when nearest-first scheduling,
  readback, and visible coverage agree. Unverified or overstated coverage fails.
  Do not add a background helper. Other native and release gates remain intact.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Preserve hosted channels, services, and provider behavior through regression tests |
| Desktop | Native adapter under `apps/desktop`; interaction and parity evidence updated here |
| Marketing | Native reminder claims require Ticket 112 evidence; notarized or general-availability claims require Ticket 115 |
| Future mobile | Not applicable: macOS scheduler proof does not establish mobile scheduling |

Verification: native notification lifecycle/coverage matrix, shared reminder
fixtures, cancellation idempotency, extension round trips, full repository
checks, and actual macOS execution. Verify missing-request gaps cannot overstate
coverage and OS-limit changes do not depend on a universal hardcoded cap.

---

## Ticket 113: Unnotarized Apple Silicon preview and updater acceptance

Historical title: **Signed macOS release**. On 2026-08-31, the owner rescoped
this ticket to the completed preview milestone. Apple-trusted distribution moved
to deferred Ticket 115. This preserves the original requirement history without
claiming Developer ID signing, notarization, or macOS 14 acceptance.

Current state (2026-08-31): complete. Both `0.1.1-preview.1` and `.2` passed
Apple Silicon packaging, sealed ad hoc signing, hardened runtime, DMG comparison,
persistent updater-key signing, and archive verification. The approved eleven-
asset `desktop-preview` prerelease is public. A quarantined Safari download and
macOS per-app approval passed on macOS 26.5.2.

The real HTTPS `.1` to `.2` sequence verified explicit check, install, and
restart. Invalid signature, tampered archive, and unavailable download paths
failed safely. The valid update preserved the stable profile, Behaviors, Notes,
Occurrences, histories, timing, provenance, outbox baseline, cursors, reminders,
and database integrity. All 64 applicable desktop interactions are implemented.

Both preview versions use SQLite schema 6. Live shipped-migration testing is not
applicable to this release. Existing native rollback tests remain current evidence
for DDL/ledger rollback, preserved history/provenance/outbox, and successful
reopen. The first future schema-changing desktop update must install an older
version and upgrade it through the real updater after creating a protected
database backup. Do not create a disposable migration build for Ticket 113.

Ticket 113 added no backend, CI infrastructure, background helper, cloud login,
live sync, Apple credentials, or Apple program enrollment. Evidence:
`docs/qa/2026-08-31-desktop-preview.md`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Not applicable: the preview installs only the native desktop app |
| Desktop | Complete in the public preview artifacts, updater flow, and QA record |
| Marketing | No notarized or general-availability claim; Ticket 115 owns any future claim |
| Future mobile | Not applicable: this Apple Silicon preview does not implement mobile distribution |

---

## Ticket 114: BehaviorLog 0.3 minimum portability parity

Current state (2026-08-30): complete locally. Canonical passive observations,
configuration-history deduplication, exact passive replay, and accepted source
schedule identity pass shared, SQLite, ordinary-client SQL, and native 0.3
acceptance. Both corrective migrations passed a clean local reset. Hosted
rollout remains separate; limits and evidence live in `STATUS.md`.

Scope: standard configuration history, explicit calendar semantics, native
Intervention mapping, category-registry preservation, saved future Occurrences,
retained imported history, and accurate provenance/loss disclosures. Reuse the
existing applied-import ledger. Add no raw-archive store or notification replay.

Acceptance: canonical schema/validator agreement, legacy-version compatibility,
synthetic round trips, no invented historical lineage, reviewed-loss previews,
and existing web/desktop regression gates. Full arbitrary-extension lossless
exchange is not claimed. Notes and time tracking retain consent gates.

| Platform | Impact |
|---|---|
| Web | Shared contracts and export/import fixes; corrective SQL migrations verified locally; hosted rollout remains separate |
| Desktop | Shared contracts, passive export reads, native rule mapping, and real SQLite round trips |
| Marketing | No implementation or new public claims |
| Future mobile | Shared contracts only; no mobile implementation |

Verification and hosted migration status are recorded in `STATUS.md`.
Only synthetic local data was used. No deployment or hosted data operation ran.

---

## Ticket 115: Apple-trusted macOS distribution acceptance

Current state (2026-08-31): deferred. The owner cannot currently access the
Apple Developer Program or an Apple Silicon Mac running macOS 14. Ticket 113's
completed unnotarized preview and updater acceptance do not satisfy this ticket.

Dependencies: completed Tickets 107–114, Apple Developer Program access, and a
suitable macOS 14 Apple Silicon test system.

Acceptance criteria:

- Obtain owner-authorized Apple Developer Program access. Do not enroll or
  purchase access as an automated task.
- Use a valid Developer ID Application certificate and installed signing identity.
- Provide one complete Apple notarization credential set and submit the production
  app and DMG through the existing strict release workflow.
- Verify stapled notarization for both the app and DMG.
- Download the notarized DMG, retain quarantine, and pass Gatekeeper installation
  and launch without disabling Gatekeeper or removing quarantine.
- Execute the production artifact and acceptance matrix on Apple Silicon running
  macOS 14. A declared or compiled minimum alone does not establish compatibility.
- Keep `node apps/desktop/scripts/release.mjs check` and artifact verification
  strict. Do not add a preview bypass or weaken Apple validation.
- Do not claim notarized or generally available distribution before every item
  above passes and the owner separately authorizes publication.

The 2026-08-31 production check loaded the existing public updater endpoint,
canonical public key, persistent private key path, and Keychain-held password.
Updater configuration, tools, and all 64 desktop interactions passed. The check
stopped only because no Developer ID Application identity or complete Apple
notarization credential set is available. No secret was printed or regenerated.
The first invocation mistakenly base64-encoded the already canonical public-key
file again. Reloading its existing value directly removed that unrelated input
error; no source or release configuration changed.

Both current preview versions use SQLite schema 6, so shipped-migration testing
is not applicable to that release. Existing native rollback tests remain current
evidence. The first future schema-changing desktop update must test an older
installed version upgrading through the real updater with a protected database
backup. This requirement stays within the schema-changing release; it does not
create a migration ticket now.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Not applicable: Apple distribution does not change the hosted web app |
| Desktop | Owned by Ticket 115 and the strict workflow in `apps/desktop/scripts/release.mjs` |
| Marketing | Do not claim notarized or generally available distribution until Ticket 115 passes |
| Future mobile | Not applicable: macOS distribution does not implement mobile distribution |

Deferred blockers: Apple Developer Program access, Developer ID Application
certificate/signing identity, notarization credentials, and an Apple Silicon
Mac running macOS 14. Do not purchase, enroll, generate credentials, notarize,
publish, or change the existing preview release while this ticket is deferred.

---

## Ticket 116: Desktop account-sync product and architecture contract

Status: complete.

Define the optional account mode before adding authentication or network
behavior. Preserve account-free local mode as a complete product path.

Dependencies: completed Tickets 107–114. Ticket 115 remains independent and
deferred.

Settled contract:

- The desktop app starts and remains usable without an account or network.
- A user may sign in with the existing Cadence Google account. Signed-in web
  and desktop clients synchronize the same single-player account.
- SQLite remains the desktop working copy while signed in. Desktop writes stay
  available offline and synchronize when the app next runs with connectivity.
- Synchronize profile timezone, categories, Behaviors, schedules, Occurrences,
  status and configuration history, Notes, time sessions, import provenance,
  imported interventions/observations, and hosted reminder-delivery history.
- Synchronize browser/email reminder preferences. Keep browser push
  subscriptions, native notification requests/coverage, authentication tokens,
  and other device capabilities device-local.
- Reuse the existing typed portability rows, canonical fingerprints, preview
  actions, and atomic write plans. Do not serialize a BehaviorLog ZIP for every
  background synchronization pass.
- Start with complete typed account snapshots, a saved common baseline, and a
  three-way merge. Add a hosted change journal only after measurements show the
  snapshot ceiling is insufficient.
- Keep one signed-in account per desktop installation. Do not add an account
  switcher, billing gate, background helper, web PWA writes, or mobile client.
- Update resolver governance for a pure synchronization planner. Network,
  Keychain, SQLite, and Supabase access remain in adapters and services.

Acceptance criteria:

- Product, data, security, offline, and reminder boundaries agree across the
  source-of-truth documents.
- The contract defines synchronized and device-local fields without weakening
  Supabase RLS or SQLite atomicity.
- The contract defines snapshot limits, retry/idempotency rules, first-link
  ownership, and conflict ownership for Tickets 117–121.
- No runtime, schema, provider, or hosted environment changes occur in this
  ticket.

Implementation ownership:

- `AGENTS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/DESKTOP_BUILD.md`
- `docs/DECISIONS.md`
- `docs/FUTURE_UPDATES.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/AGENT_RESOLVERS.md`
- `docs/TICKETS.md`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Preserve current Google auth and Supabase data behavior; Ticket 120 adds synchronization access through existing RLS contracts |
| Desktop | Owns the account/local-mode boundary and the implementation sequence in Tickets 117–122 |
| Marketing | No new claim in this ticket; Ticket 122 gates any approved synchronization claim |
| Future mobile | Not applicable: the contract keeps portable data semantics but authorizes no mobile implementation |

Verification: run `npm run agents:check`, `npm run interactions:check`,
`npm run resolvers:check`, and `git diff --check`.

Completed 2026-08-31. `docs/DESKTOP_BUILD.md#planned-account-mode` records the
field boundary, 100,000-row/64-MiB/30-second snapshot ceilings, pure three-way
planner ownership, stable idempotency key, two-commit retry rule, and Ticket
117–121 ownership. This ticket changed no runtime, schema, provider, or hosted
environment.

---

## Ticket 117: Desktop local database controls

Status: complete (2026-08-31).

Make the app-managed local-data location visible and recoverable before account
linking can replace or preserve a working copy.

Dependencies: Ticket 116.

Acceptance criteria:

- Store the live SQLite database in the app-managed macOS Application Support
  location. Settings displays its exact absolute path.
- Add Reveal in Finder, Back Up, and Restore actions to Settings. Use native
  file dialogs and platform reveal behavior. Do not allow an arbitrary live
  database location.
- Back Up creates a consistent SQLite online backup, validates integrity and
  foreign keys, and writes the selected destination atomically.
- Restore validates the selected backup and schema compatibility before any
  replacement. Create a protected pre-restore backup, replace atomically, and
  reopen successfully or leave the original database intact.
- Raw database Restore is available only in local mode. A signed-in user must
  disconnect through Ticket 121 first.
- Show actionable errors without exposing unrelated files or accepting an
  arbitrary native command path.
- Add the three interactions to `interaction-registry.json` and update the
  implemented Settings surface evidence. Run the project-local impeccable
  workflow before editing the UI.

Implementation ownership:

- `apps/desktop/src/settings-screen.tsx`
- `apps/desktop/src/local-store.ts`
- `apps/desktop/src-tauri/src/files.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/capabilities/`
- `interaction-registry.json`
- `docs/DESKTOP_DATA_MODEL.md`
- `docs/DESKTOP_BUILD.md`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Not applicable: browser storage and hosted backups do not change |
| Desktop | Implements visible Application Support storage, reveal, backup, and local-only restore |
| Marketing | No claim until the actions pass native acceptance; later copy may describe local-data control |
| Future mobile | Not applicable: Finder and Application Support behavior are macOS-specific |

Verification: unit/native rollback tests, corrupt/incompatible backup rejection,
integrity and foreign-key checks, actual Finder reveal, restart persistence,
`npm run interactions:check`, desktop checks, and the standard repository checks.

---

## Ticket 118: Desktop Google authentication and account session

Status: complete. Local and installed-app acceptance pass with query state,
the official Tauri deep-link plugin, exact-once Google PKCE exchange, restart
persistence, replay rejection, one-account enforcement, and secret scans. The
installed round trip used the owner-authorized temporary legacy-Keychain QA
build. Production Data Protection Keychain and Apple signing remain release
acceptance under Tickets 115/122. See
`docs/qa/2026-08-31-desktop-authentication.md`.

Add optional Google authentication without weakening local mode or placing
privileged credentials in the desktop app.

Dependencies: Tickets 116–117.

Acceptance criteria:

- Use Supabase Auth PKCE in the system browser and a registered desktop deep
  link for callback. Validate state, exchange each authorization code once,
  and handle cancellation, denial, stale callbacks, and duplicate callbacks.
- Use only the public Supabase configuration and the signed-in user's JWT.
  Never package a service-role key or provider credential.
- Store refresh/session secrets in macOS Keychain. Store no authentication
  token in SQLite, frontend storage, logs, exports, or backups.
- Persist only non-secret account-link metadata needed to reconnect the local
  working copy. Keep the stable local profile identity distinct from the hosted
  account identity.
- Support one signed-in account at a time. A different account requires the
  Ticket 121 disconnect flow first.
- Do not upload, delete, or replace product data during authentication. Hand
  successful sessions to Ticket 119 for the first-link decision.
- Update deep-link allowlists and hosted auth configuration only through an
  explicit, owner-authorized operation during implementation.
- Register the account interactions and run the project-local impeccable
  workflow before editing Settings or onboarding UI.

Implementation ownership:

- `apps/desktop/src/account/`
- `apps/desktop/src/settings-screen.tsx`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/capabilities/`
- `apps/desktop/src-tauri/tauri.conf.json`
- `interaction-registry.json`
- `docs/SUPABASE_WORKFLOW.md`
- `docs/DESKTOP_BUILD.md`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Reuses the existing Supabase Google account; web login behavior remains unchanged |
| Desktop | Adds system-browser PKCE, Keychain session storage, and one-account linking |
| Marketing | No account-sync availability claim before Ticket 122 passes |
| Future mobile | Not applicable: no mobile callback, credential store, or client is implemented |

Verification: PKCE/deep-link unit tests, installed-app browser round trip,
cancel/deny/replay/state-mismatch cases, Keychain persistence/removal, secret
scans of SQLite/logs/exports/backups, RLS smoke, and standard checks.

---

## Ticket 119: First desktop account-link data choice

Status: complete 2026-09-02. Controlled Import, Ignore, Cancel, retry,
protected-backup, conflict-routing, and installed owner-account hydration
acceptance passed. Preview.19 preserved the hosted same-status branches and
reached one current common baseline.

Resolve local and hosted data ownership explicitly on the first successful
desktop sign-in.

Dependencies: Tickets 116–118.

Acceptance criteria:

- Detect recognized local data before linking. User-created or edited product
  data, timezone/category changes, histories, provenance, or imported records
  count. An untouched seeded profile and default categories do not.
- When recognized local data exists, require one choice: Import local data into
  the account, or Ignore local data and use account data.
- Import uses the existing typed portability snapshot, fingerprint, preview,
  conflict-action, and atomic write-plan architecture. It uploads no archive
  blob and commits no partial merge.
- Ignore uploads nothing. Before replacing the working copy, create and verify
  a protected local backup and show its exact path.
- When no recognized local data exists, hydrate the local working copy from the
  account without showing a false conflict choice.
- During that first automatic hydration only, preserve pre-existing hosted
  same-status status-event branches unchanged. Reject divergent-status,
  local-only, cross-copy, and post-baseline branches.
- Cancellation leaves the local database and hosted account unchanged and
  removes any incomplete link state.
- An accepted choice records the synchronized baseline only after the hosted
  commit and local atomic apply both succeed. Retries are idempotent.
- The pending attempt durably retains its bounded pre-attempt account snapshot,
  so restart retry preserves later deletions and never infers absence as a winner.
- Route irreconcilable merges to Ticket 121. Do not silently pick a winner.
- Add first-link interactions and update the Settings/onboarding surface under
  the project-local impeccable workflow.

Implementation ownership:

- `packages/core/src/services/behaviorlog-preview.ts`
- `packages/core/src/services/behaviorlog-import-plan.ts`
- `packages/core/src/services/behaviorlog-write-plan.ts`
- `packages/core/src/types/portability-rows.ts`
- `apps/desktop/src/local-import.service.ts`
- `apps/desktop/src/account/`
- `apps/desktop/src-tauri/migrations/0010_first_link_attempt_baseline.sql`
- `interaction-registry.json`
- `docs/USER_FLOWS.md`
- `docs/DESKTOP_BUILD.md`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Receives an authorized import into the existing account through RLS-safe server contracts |
| Desktop | Adds the protected import-or-ignore first-link flow and local hydration |
| Marketing | No claim; the flow is product UI and remains gated by Ticket 122 |
| Future mobile | No implementation is authorized; a future account-link flow must inherit the first-hydration history policy through shared planning |

Verification: empty/default/recognized local detection, import/ignore/cancel,
empty/nonempty hosted accounts, injected local/remote failures, retry
idempotency, protected-backup proof, actual native UI QA, and standard checks.

---

## Ticket 120: Offline-capable two-way desktop synchronization

Status: complete 2026-09-01. The corrected hosted contract, two-copy matrix, offline/retry behavior, and native status UI passed.

Activate the existing outbox and cursors with a bounded, testable sync engine.

Dependencies: Tickets 116–119.

Acceptance criteria:

- Add a pure planner that compares the current local snapshot, current hosted
  snapshot, and saved common baseline. It emits typed conflicts and one atomic
  local/hosted write plan.
- Use complete typed snapshots and canonical fingerprints for the first
  release. Set and test an explicit size/time ceiling. Do not add a hosted
  change journal until measurements require it.
- Trigger synchronization on launch, foreground/resume, connectivity recovery,
  relevant local mutations, and an explicit Sync now action. Do not add a
  closed-app helper or promise realtime synchronization.
- Upload local offline mutations and tombstones. Download hosted web or other
  desktop changes. Acknowledge outbox entries and advance the saved baseline or
  cursor only after the hosted commit and local atomic apply succeed.
- Preserve all histories, provenance, protected Occurrences, referential
  integrity, and stale-write guards. Retries and repeated snapshots are
  idempotent.
- Use authenticated, bounded, `SECURITY INVOKER` database functions where an
  atomic multi-table hosted apply is required. Preserve RLS and never use a
  desktop service-role client or blind unrestricted upserts.
- Synchronize only the Ticket 116 data boundary. Device-specific tokens,
  subscriptions, native delivery state, and native reminder coverage stay
  local.
- Surface offline, syncing, current, failed, and conflict states without adding
  a fifth primary screen. Update interaction registry entries for user actions.

Implementation ownership:

- `packages/core/src/resolvers/account-sync.resolver.ts`
- `packages/core/src/services/`
- `apps/desktop/src/sync-engine.ts`
- `apps/desktop/src/local-store.ts`
- `lib/db/`
- `lib/services/`
- `supabase/migrations/`
- `tests/account-sync.resolver.test.ts`
- `docs/AGENT_RESOLVERS.md`
- `docs/DATA_MODEL.md`
- `interaction-registry.json`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing web writes remain online-only; authenticated hosted changes become desktop sync input through RLS-safe contracts |
| Desktop | Implements automatic eventual synchronization while preserving offline SQLite writes |
| Marketing | No synchronized-product claim until Ticket 122 passes the multi-client matrix |
| Future mobile | Not applicable: no mobile adapter, queue, or release is authorized |

Verification: pure three-way merge fixtures; real SQLite/local-Supabase
contracts; two desktop working copies plus web; offline edits; create/update/
delete/history/provenance cases; crash and retry injection at each commit
boundary; RLS cross-account rejection; snapshot ceiling; native status UI; and
all required repository checks. Hosted migration deployment requires separate
owner authorization.

---

## Ticket 121: Sync conflict review and account disconnect

Status: complete 2026-09-01. Conflict review, stale-decision rejection, both disconnect outcomes, Restore gating, and revoked-session recovery passed native acceptance.

Give users an explicit recovery path for irreconcilable changes and for leaving
account mode.

Dependencies: Ticket 120.

Acceptance criteria:

- Auto-merge independent changes and append-only histories when invariants
  hold. Emit conflicts only when the planner cannot preserve both intentions.
- Pause the accepted synchronization plan when any conflict remains. Do not
  apply the nonconflicting subset against an unresolved baseline.
- Show a persistent shell cue, a conflict count in Settings, and a Review
  conflicts panel within the existing four-screen model.
- Each conflict explains the two values and offers Use account version, Use
  this Mac version, and Keep both only when the resolver can produce a valid
  duplicate without breaking identity or history.
- Recompute fingerprints and reject stale conflict decisions when either side
  changed during review.
- Disconnect offers Keep a local copy or Remove account data from this Mac.
  Keep a local copy removes secrets/link state, preserves the current SQLite
  data, and shows its exact Application Support path.
- Remove account data creates a protected safety backup, removes account data
  and secrets from the working location, and returns to a fresh local profile.
  It does not delete hosted account data.
- Raw database Restore requires disconnect first. Expired/revoked sessions stop
  synchronization safely and direct the user to reconnect or disconnect.
- Register every cue, review action, and disconnect action. Run the project-
  local impeccable workflow before UI changes.

Implementation ownership:

- `packages/core/src/resolvers/account-sync.resolver.ts`
- `apps/desktop/src/sync-engine.ts`
- `apps/desktop/src/settings-screen.tsx`
- `apps/desktop/src/product.tsx`
- `apps/desktop/src/account/`
- `interaction-registry.json`
- `docs/UI_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/DESKTOP_BUILD.md`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | No conflict UI change; web edits remain one input to the shared account state |
| Desktop | Implements the conflict cue/review panel and both explicit disconnect outcomes |
| Marketing | No claim until Ticket 122; later copy must not imply that conflicts are impossible |
| Future mobile | Not applicable: no mobile conflict or disconnect UI is implemented |

Verification: every conflict class and resolution action, stale review,
accessibility/keyboard/responsive UI, keep/remove disconnect, revoked session,
secret removal, backup/path disclosure, actual native QA, interaction checks,
and the standard repository checks.

---

## Ticket 122: Account-sync migration and release acceptance

Status: complete 2026-09-02. Preview.19 passed publication, remote hash
readback, real-updater installation, schema migration, owner-account hydration,
data preservation, configured-state, and secret acceptance.

Prove the schema-changing account-sync release through the real updater and a
multi-client acceptance matrix before making availability claims.

Dependencies: Tickets 117–121. Ticket 115 remains independent and deferred;
this ticket does not weaken Apple-trusted distribution gates.

Acceptance criteria:

- Install an older published Cadence desktop version with representative local
  data. Create and verify a protected database backup before updating.
- Upgrade through the real signed Cadence updater to the schema-changing build.
  Verify every migration, application reopen, rollback/failure path, and data
  preservation requirement. A disposable migration build does not count.
- Preserve stable local identity, account-link metadata, Behaviors,
  Occurrences, histories, Notes, timing, provenance, outbox entries, cursors,
  reminders, and database integrity across the update.
- Run the full web plus two independent desktop working-copy matrix. Cover
  first-link import and ignore, offline edits, deletes, concurrent edits,
  conflicts, retries, revoked sessions, disconnect choices, backup, and restore.
- Verify RLS account isolation with ordinary authenticated users. Verify no
  service-role key or session secret appears in the app bundle, SQLite, logs,
  export, or backup.
- Deploy hosted migrations or auth/provider configuration only after explicit
  owner authorization and through the documented workflows.
- Update public and marketing copy only after the product matrix passes. State
  eventual synchronization and offline/closed-app limits plainly. Do not claim
  notarization or general availability while Ticket 115 remains deferred.
- Record immutable versions, hashes, updater feed, test systems, backup path,
  hosted migration boundary, and remaining limitations in QA evidence.

Implementation ownership:

- `apps/desktop/scripts/release.mjs`
- `apps/desktop/src-tauri/migrations/`
- `apps/desktop/.release/`
- `docs/DESKTOP_RELEASE.md`
- `docs/OPERATIONS.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`
- `docs/qa/`
- `STATUS.md`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Participates in ordinary-user RLS and cross-client acceptance; web offline/PWA behavior remains deferred |
| Desktop | Owns real-updater migration, multi-client synchronization, backup, and release acceptance |
| Marketing | May publish only the precise accepted sync/local-mode claim; Apple-trusted distribution remains gated by Ticket 115 |
| Future mobile | Not applicable: release evidence covers web and macOS desktop only |

Verification: the Ticket 117–121 matrices, real updater migration with protected
backup, artifact/secret scans, local and authorized hosted RLS smoke, native
macOS execution, `npm run agents:check`, `npm run interactions:check`,
`npm run resolvers:check`, `npm run design-system:check`, `npm run lint`,
`npm run typecheck`, `npm run test`, `npm run build`, desktop checks, marketing
checks, and `git diff --check`.

Out of scope: Apple enrollment or trust-gate changes, Intel release, billing,
web PWA/offline writes, realtime closed-app synchronization, background helper,
desktop email delivery, mobile implementation, and arbitrary live database paths.

---

## Ticket 123: User-defined categories and descriptions

Status: complete locally 2026-09-05. Automated, browser, and native interactive
acceptance passed. Web production deployed through PR #45 at `4260b544` with
migration `20260905035835`. Desktop production distribution retains Ticket 115. Evidence:
`docs/qa/2026-09-05-categories-and-behavior-filters.md`.

Let users organize Behaviors with their own categories and explain each
category's meaning for later review and portable exports.

Dependencies: existing configuration-history, portability, and account-sync
contracts from Tickets 095–097 and 116–122. Ticket 124 can start independently.

Scope and acceptance criteria:

- Add a Categories section to Settings on web and desktop. Support create,
  rename, optional plain-text description, reorder, and delete. Default
  categories use the same controls as user-created categories. Deleted defaults
  must not reappear on login, launch, or synchronization.
- Reuse existing category IDs, ownership, and `sort_order`. Keep one optional
  category per Behavior. Use accessible Move up / Move down actions for ordering;
  no drag-and-drop dependency or separate category archive state is required.
- Validate names and descriptions at service/database boundaries. Reject blank
  names and duplicate normalized names within one account. Define and test
  shared length limits. Migrate existing duplicate names without deleting or
  silently merging categories, Behavior assignments, or history.
- Show descriptions in category management and as supporting context for the
  selected category in Behavior forms. Keep descriptions optional and plain text.
- Before deletion, show the affected active and archived Behavior count. Explain
  that deletion moves these Behaviors to No category. Require explicit Delete
  category confirmation, preserve all Behaviors and Occurrences, and allow cancel.
- Replace the disabled category-delete path with one atomic owner-scoped
  operation. Clear affected assignments and append each affected Behavior's
  configuration event in that transaction. Preserve historical snapshots and
  Occurrence lineage. A stale edit, foreign owner, or partial failure writes nothing.
- Renaming, description edits, and reordering preserve category identity and
  Behavior history. Refresh category selectors, Behavior metadata, analytics
  labels, and export reads after successful mutations. Preserve form drafts on
  validation, concurrency, or network errors.
- Add the nullable description field through tracked Postgres and SQLite
  migrations. Update generated types and shared category contracts. Keep web
  writes behind authenticated services/repositories and RLS; keep desktop writes,
  revisions, tombstones, and outbox records atomic through DataStore operations.
- Synchronize category names, descriptions, ordering, and deletion through the
  existing account-sync contract. Test offline edits, concurrent rename/delete
  versus Behavior assignment, retries, and older-client payloads. Missing new
  fields must not erase descriptions. Reject incompatible writes explicitly if
  compatibility cannot preserve data.
- Carry descriptions in app-native category JSONL/full JSON, the existing Cadence
  BehaviorLog category-registry extension, and Markdown category context.
  Preserve descriptions through supported import/restore paths and desktop
  backup/restore. Older bundles without descriptions remain valid. Preserve
  existing create-only import matching and restore decisions; do not silently
  overwrite an existing category's description. Keep CSV columns unchanged.
- Update `docs/DATA_MODEL.md`, `docs/DESKTOP_DATA_MODEL.md`,
  `docs/EXPORT_FORMATS.md`, `docs/USER_FLOWS.md`, and route/parity documentation
  with the implemented contracts. Extend the existing interaction registry and
  design-system catalog when controls ship, with web and native desktop evidence.

Implementation references:

- `app/(app)/settings/`, `components/settings/`, `lib/db/`, `lib/services/`
- `components/behaviors/BehaviorForm.tsx`, `lib/db/behaviors.repo.ts`
- `packages/core/src/`, `apps/desktop/src/local-store.ts`,
  `apps/desktop/src/account/`, `apps/desktop/src-tauri/`
- `supabase/migrations/`, `lib/db/database.types.ts`
- `interaction-registry.json` (`INT-BEHAVIOR-007`, existing metadata draft intent)
  and `design-system.surfaces.json`; register new category-management intents
  during implementation, not as already implemented planning records.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | This ticket owns Settings management, Behavior selectors, RLS/history-safe mutations, and category export context |
| Desktop | This ticket owns equivalent Settings controls, local migrations, atomic offline writes, account sync, portability, and native QA |
| Marketing | No new interface; update existing public documentation and feature claims only after web and desktop acceptance |
| Future mobile | No implementation: mobile remains deferred; preserve the shared category contract for a separately scoped mobile ticket |

Verification: focused validation, ownership, concurrency/rollback, history,
sync, old-client compatibility, export round-trip, and UI tests; clean local
Supabase migration replay and real SQLite adapter contracts; native restart and
protected-backup upgrade preservation; responsive web QA and native Settings
QA. Run the standard ticket checks, `npm run interactions:check`,
`npm run design-system:check`, desktop type/native/contract/parity checks, and
`git diff --check`. Hosted rollout and release publication require their existing
explicit authorization gates.

Out of scope: nested categories, multiple categories per Behavior, tags,
category merging, AI-generated descriptions, team taxonomy, and bulk Behavior editing.

---

## Ticket 124: Behaviors category filtering and sorting

Status: complete locally 2026-09-05. Automated, browser, and native interactive
acceptance passed. Web production deployed through PR #45 at `4260b544` with
migration `20260905035835`. Desktop production distribution retains Ticket 115. Evidence:
`docs/qa/2026-09-05-categories-and-behavior-filters.md`.

Help users find Behaviors as their list grows. Reuse the existing category
assignments and shared Behavior list; no database migration is required.

Dependencies: none on Ticket 123. Verify custom-category mutation integration
when Ticket 123 ships.

Scope and acceptance criteria:

- Add a compact, labeled Category select beside the Behaviors list controls.
  Offer All categories by default, No category, and each owned category in its
  configured order. Select by category ID, not display name. Start with one
  selected category rather than a multi-select filter builder.
- Add a labeled Sort select with Scheduled time (existing default), Name A–Z,
  and Category. Category sorting uses category order, then Behavior title;
  No category sorts last. Use a stable ID tie-breaker. Preserve the existing
  scheduled-time/title/ID comparator for the default order.
- Apply the controls to active and archived Behavior lists. Keep archived
  Behaviors inside their existing disclosure. Show matching and total counts;
  distinguish No matching behaviors from a genuinely empty account or list.
  Provide a Clear filters action that restores All categories and default sorting.
- Keep overall adherence and category summary calculations at their existing
  account/range scope. Make that scope clear when a list filter is active.
  Preserve each visible Behavior's heatmap and selected-day review semantics.
- Preserve selections through range changes, day review, and successful
  create/edit/archive/restore refreshes within the Behaviors screen. Full reload
  or leaving the screen may reset them; no persisted account preference is required.
  Reconcile created rows before filtering. If a saved Behavior leaves the selected
  category, announce success even though its row disappears from the filtered list.
- Category rename/reorder refreshes labels/order without changing the selected
  ID. If the selected category disappears, reset to All categories and announce
  the reset. Do not silently discard unsaved Behavior or Note drafts when a user
  changes controls; preserve drafts or require the existing save/cancel flow.
- Share one pure list projection across web and desktop, reusing
  `components/behaviors/behavior-list-state.ts`. Filter the loaded list without
  additional per-Behavior requests. Do not mutate source arrays or domain records.
- Keep controls keyboard accessible, announce result changes, and stack controls
  at narrow widths without horizontal overflow. Use existing native select and
  text-action patterns. Keep categories out of primary navigation and Timeline filtering.
- Add filter, sort, and clear intents to `interaction-registry.json` at
  implementation time. Update affected review/lifecycle evidence and
  `design-system.surfaces.json` through the existing bench workflow.

Implementation references:

- `components/behaviors/BehaviorList.tsx`
- `components/behaviors/behavior-list-state.ts`
- `app/(app)/behaviors/page.tsx`, `apps/desktop/src/behaviors-screen.tsx`
- `tests/behavior-list-state.test.ts`, existing Behavior UI tests
- `interaction-registry.json`, `design-system.surfaces.json`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | This ticket owns `/behaviors` controls, list projection, lifecycle integration, and responsive QA |
| Desktop | This ticket owns the same shared list behavior in `apps/desktop/src/behaviors-screen.tsx`, offline operation, and native QA |
| Marketing | No new interface; public documentation may describe filtering only after acceptance |
| Future mobile | No implementation: mobile remains deferred; responsive web support is required by this ticket |

Verification: focused projection tests for All categories, No category, empty
matches, duplicate labels, sorting ties, archived rows, and immutable inputs;
UI tests for clear, range/day review, draft preservation, creation, category
reassignment/deletion, and archive/restore. Run standard ticket checks,
`npm run interactions:check`, `npm run design-system:check`, desktop type/build
and parity checks, responsive browser QA, native Behaviors QA, and
`git diff --check`.

Out of scope: Timeline filters, text search, saved views, compound filters,
drag ordering, new analytics calculations, pagination, and new dependencies.

## Ticket 125: Retained Behavior archive notes

Status: complete and deployed to web production (2026-09-05), through PR #46.
Evidence: `docs/qa/2026-09-05-archive-notes.md`. Fresh read-only reviews returned
ship with no findings. Signed desktop distribution remains separate.

Record why a Behavior no longer needs tracking. Every archive cycle retains its
own dated note across Restore and subsequent archives.

Scope and acceptance criteria:

- Add an optional Archive note beside Archive behavior in Details and Settings.
  Blank notes do not block archiving. Plain text is trimmed and limited to 2,000
  characters. Store the note and archive mutation atomically. Failed saves keep
  the draft; stale writes require a fresh Behavior revision.
- Display dated archive history. While archived, allow editing or removing each
  note's text. Removing text retains the archive entry. Restore and later archives
  preserve earlier entries. Repeated submissions do not duplicate archive entries.
- Keep archive notes separate from Behavior descriptions and Occurrence Notes.
  Do not add predefined reasons, automatic archive rules, or completion statuses.
- Preserve history in SQLite, backups, account synchronization, and supported
  exports/imports. Existing Include Notes privacy controls govern archive text.
  Old bundles without archive notes preserve existing notes during merge/restore.
- Reuse the atomic Behavior graph write and existing sync conflict handling.
  Apply schema changes through migrations and verify owner isolation.

Platform impact and evidence:

- Web: `components/behaviors/BehaviorList.tsx`, Behavior Server Actions/services,
  and Postgres migration; extends `INT-BEHAVIOR-022` and archive history controls.
- Desktop: shared BehaviorList, local actions, SQLite migration 0012, and existing
  account-sync adapter. Verify offline writes, restart, and portability contracts.
- Marketing: update `docs/user-guide/behaviors-and-review.md` and generated guidance.
  No marketing layout or product claims beyond the implemented feature.
- Future mobile: implementation remains deferred. The shared Behavior model and
  interaction registry define the future parity requirement.

Verification: focused lifecycle/privacy/sync tests; real SQLite and Postgres
contracts; all repository completion checks; responsive browser acceptance.
Hosted migration, deployment, and signed desktop distribution remain separate
authorized release actions.


---

## Ticket 126: Recurring Note suggestions contract and model evaluation

Status: complete. Final review accepted the contract and deterministic synthetic
evaluation. The authorized live evaluation records a measured no-go after one recall failure
under Ticket 128. Evidence: `docs/qa/2026-09-07-note-shortcuts.md`.

Reduce repeated typing through optional text shortcuts for one Behavior.
Resolve the saved idea's open questions before enabling analysis of real Notes.
Tickets 127–128 depend on this contract; this ticket does not ship product UI.

Scope and acceptance criteria:

- Define the source as current, nonblank Occurrence Notes for one owner and one
  Behavior, across Completed, Not Completed, and Unresolved. Exclude descriptions,
  archive notes, passive imported notes, and other Behaviors. Count distinct
  Occurrences, not edit history. Document whether imported inline Notes qualify
  and prevent reused suggestions from becoming self-reinforcing evidence.
- Evaluate these planning defaults: the latest 100 eligible Notes within 90
  local calendar days; at least three distinct Occurrences supporting a pattern;
  at most five proposed shortcuts; at most 160 characters per shortcut.
  Finalize limits, normalization, stable ordering, and evidence eligibility in
  the product/data contracts. Inject time and use the existing timezone rules.
- Compare deterministic repeated-text matching with a small model on synthetic
  examples: paraphrases, negation, unrelated Notes, one-off statements, and
  instruction-like Note text. Measure unsupported claims, structured-output
  validity, latency, and bounded cost. Include the saved Invisalign example
  without interpreting it as medical advice or changing the Occurrence status.
- Select a provider/model only from current official capability, retention,
  training-use, deletion, and cost evidence. Record a go/no-go decision for
  Ticket 128. Do not send personal Notes during evaluation. If no option meets
  the contract, preserve Ticket 127's non-AI fallback and record the blocker.
- Define separate states for proposed, accepted, and dismissed suggestions.
  Specify editing, removal, deduplication, suppression of dismissed patterns,
  invalidation after source edits/deletion, and expiry. Accepted text remains
  user-controlled; fresh analysis must not silently rewrite it.
- Start with explicit per-Behavior opt-in and on-demand analysis. Define a global
  off control, persistent consent, and revocation while work is in flight.
  Automatic schedules remain deferred. No analysis on Note-editor open/save.
- Selecting an accepted shortcut fills an empty draft or appends on a new line.
  It never replaces existing text, submits the form, changes status, or sends a
  reminder. The user reviews and saves through the existing Note action.
- Specify storage, ownership, deletion, minimal provenance, account sync, backup,
  and export treatment. Keep suggestion records separate from historical Notes.
  Define which metadata stays private and how existing Include Notes controls
  cover shortcut text. Do not silently expand BehaviorLog or export AI proposals
  as user-authored historical Notes. Specify old-client compatibility.
- Account-free desktop must keep analysis local and support ordinary Note entry.
  Linked desktop must require explicit consent before cloud analysis. Define
  whether consent is device-specific and prevent synchronization from silently
  enabling analysis. Global off must dominate per-Behavior enablement.
- Finalize `docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`,
  `docs/DATA_MODEL.md`, `docs/DESKTOP_DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`,
  `docs/DESKTOP_BUILD.md`, and `docs/DECISIONS.md` before dependent implementation.
  Update `docs/ROUTE_MAP.md`, `docs/OPERATIONS.md`, and privacy copy requirements
  for any selected provider. Record unresolved gates without inventing approvals.

Implementation references:

- `components/timeline/OccurrenceNoteForm.tsx`, `components/timeline/OccurrenceRow.tsx`,
  and `components/behaviors/BehaviorList.tsx` own existing Note-entry surfaces.
- `packages/core/src/services/`, `lib/services/occurrence.service.ts`,
  `lib/db/occurrences.repo.ts`, and `apps/desktop/src/local-occurrence.service.ts`
  own current guarded Note saves.
- `interaction-registry.json` owns existing Note intents;
  `design-system.surfaces.json` references `composite.occurrence-note-form`.
  Use these inventories for implementation evidence; do not register planned
  controls as already implemented.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Contract here; shared controls and persistence in Ticket 127, hosted analysis in Ticket 128 |
| Desktop | Contract here; offline shortcuts and sync in Ticket 127, consented account analysis in Ticket 128 |
| Marketing | Define factual privacy/documentation changes here; publish applicable claims only after Tickets 127–128 acceptance |
| Future mobile | No implementation: mobile remains deferred; shared contracts define future parity |

Verification: a reproducible synthetic evaluation with recorded inputs, expected
boundaries, measured results, and provider go/no-go rationale. Run
`npm run agents:check`, `npm run interactions:check`, `npm run resolvers:check`,
and `git diff --check` for the contract. If evaluation code is added, run the
standard coding checks too. Provider access or spending beyond existing
authorization must remain an explicit gate.

Out of scope: AI coaching, diagnosis, cross-Behavior analysis, voice, automatic
Note/status writes, model training on user Notes, and a general agent framework.

---

## Ticket 127: Behavior-scoped Note shortcuts on web and desktop

Status: complete (2026-09-08). Implementation, automated checks, authenticated browser QA,
and isolated native UI acceptance passed, including keyboard operation and restart.
Evidence: `docs/qa/2026-09-07-note-shortcuts.md`.
Does not depend on a successful model selection or Ticket 128.

Ship persistent, user-reviewed Note shortcuts and the non-AI fallback on both
tracking platforms. Reuse the shared Note form and guarded save flow.

Scope and acceptance criteria:

- Add one pure `packages/core/src/resolvers/note-suggestion.resolver.ts` with
  `tests/note-suggestion.resolver.test.ts`. Own eligibility, repeated-text
  matching, count/length bounds, deduplication, and suppression there. No network,
  storage, environment reads, or UI inside the resolver. Register it in
  `docs/AGENT_RESOLVERS.md` and the existing resolver checker.
- Offer deterministic recurring-text proposals from eligible Notes on explicit
  request. Show no proposal for insufficient evidence. Let users accept, edit,
  dismiss, and remove shortcuts under the finalized Ticket 126 contract.
  Preserve accepted text when later analysis proposes different wording.
- Extend `OccurrenceNoteForm` for Timeline, Needs decision, and Behaviors
  selected-day review. Display only this Behavior's accepted shortcuts. Insertion
  changes only the draft and counts as a draft revision, preserving text typed
  during a pending save. Keep explicit Save note and existing stale-write checks.
- Add per-Behavior controls in existing Behavior settings and global off in
  Settings. Persist choices, preserve drafts on errors, and announce outcomes.
  Turning the feature off hides suggestions and stops new requests without
  deleting historical Notes. Use Ticket 126's explicit shortcut deletion policy.
- Implement owner/Behavior-scoped persistence through tracked Postgres and SQLite
  migrations, generated types, repositories, and atomic DataStore operations.
  Test RLS, foreign Behavior IDs, stale writes, rollback, and account switching.
  Reuse account-sync revisions, tombstones, outbox writes, and conflict handling.
- Keep account-free desktop usable offline. Verify accepted shortcuts,
  suppression, settings, and deletion through restart, backup/restore, linking,
  disconnect, two-device sync, and older-client payloads. Never sync consent in
  a way that silently enables provider analysis.
- Implement Ticket 126's export/privacy/provenance contract. Saved Note text
  remains ordinary Note content after explicit review/save; pending proposals
  must never become historical Notes through export or restore.
- Read the project-local impeccable context and use design-system-bench before
  UI edits. Extend existing Note intents and add management intents in
  `interaction-registry.json` when implemented. Update the existing Note-form
  bench, surface catalog, user guide, and desktop parity evidence.

Implementation references:

- `components/timeline/OccurrenceNoteForm.tsx`, `components/timeline/OccurrenceRow.tsx`,
  `components/behaviors/BehaviorList.tsx`, `components/settings/SettingsPanels.tsx`
- `app/(app)/timeline/actions.ts`, `app/(app)/behaviors/actions.ts`,
  `app/(app)/settings/actions.ts`, `lib/services/`, `lib/db/`
- `apps/desktop/src/local-store.ts`, `apps/desktop/src/local-occurrence.service.ts`,
  `apps/desktop/src/settings-screen.tsx`, `apps/desktop/src/account/`,
  `apps/desktop/src-tauri/`, `packages/core/src/`
- `tests/timeline-interactions-ui.test.tsx`, `tests/occurrence.service.test.ts`,
  `tests/occurrence-notes.repo.test.ts`, and existing desktop contract tests

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Implemented in `components/note-shortcuts/NoteShortcutControls.tsx`, `lib/db/noteShortcuts.repo.ts`, and migration `20260908003245`; browser QA in `docs/qa/2026-09-07-note-shortcuts.md` |
| Desktop | Implemented in `apps/desktop/src/local-note-shortcut.service.ts`, SQLite migration `0013`, and shared account sync; native UI acceptance awaits Mac unlock in the same QA record |
| Marketing | Updated `docs/user-guide/timeline.md` and `docs/user-guide/desktop-local.md`; marketing checks/build passed for their generated mirrors; publication remains gated |
| Future mobile | No implementation: mobile remains deferred; preserve shared contracts and accessible responsive web controls |

Verification: resolver boundary/threshold tests; UI acceptance for empty/nonempty
and pending-save drafts, cancel, keyboard use, off controls, and all Note-entry
surfaces; two-owner isolation; real Postgres/SQLite contracts; offline native
restart, sync deletion/conflicts, and protected-backup upgrade acceptance.
Run all standard ticket checks plus `npm run core:check`,
`npm run design-system:check`, `npm run desktop:typecheck`,
`npm run desktop:build`, `npm run desktop:native:test`,
`npm run desktop:contract:test`, `npm run desktop:parity:check`, and responsive
browser/native QA. Run marketing checks/build when generated guidance changes.
Hosted migrations and releases retain existing authorization gates.

Out of scope: provider calls, scheduled analysis, cross-Behavior shortcuts,
new navigation, a template library, and automatic form submission.

---

## Ticket 128: Bounded recurring Note pattern analysis

Status: blocked (2026-09-08). Access, funding, privacy checks, and evaluation retention acceptance are complete.
The authorized live evaluation passed 79/80 quality checks; one negation case omitted its supported proposal.
Schema and evidence checks passed 80/80. Estimated API cost was $0.0088825; p95 latency was 2,072 ms.
The measured gate failed. Retain the deterministic fallback; do not integrate this provider candidate.
See `docs/qa/2026-09-07-note-suggestion-provider-evaluation.md`.
Ticket 127's persisted proposal lifecycle and native acceptance are complete.

Identify repeated meaning within one Behavior's Notes and offer proposed text
shortcuts for explicit review. Keep the non-AI fallback available.

Scope and acceptance criteria:

- Add the selected provider behind a server-only service adapter. Authenticate
  requests, derive the owner from the session, and verify Behavior ownership.
  Read only the eligible bounded history for that Behavior. Do not accept an
  arbitrary Note corpus or trust client-supplied owner IDs.
- Run only on the explicit analysis action after current global/per-Behavior
  consent checks. Enforce the contract's request/input/output limits, per-owner
  rate and cost bounds, timeout, and bounded retry policy. Coalesce equivalent
  in-flight requests without retaining Note text in logs or telemetry.
- Treat Notes and provider output as untrusted data. Request a bounded structured
  result with evidence references; verify every reference belongs to the input
  and each pattern meets the distinct-Occurrence threshold. Reject malformed,
  oversized, unsupported, instruction-like, or out-of-scope output. Render plain
  text only; never give the model tools or mutation authority.
- Recheck consent, Behavior ownership/lifecycle, and source revisions before
  persisting proposals. Discard stale results after opt-out, deletion, source
  changes, or account changes. Retries must not duplicate proposals, resurrect
  dismissed patterns, or overwrite accepted edits.
- Show proposed text separately from accepted shortcuts. Explain insufficient
  evidence, unavailable analysis, and failed requests without blocking normal
  Note entry. Require acceptance before quick-fill and Save note after insertion.
- Linked desktop calls the authenticated hosted adapter only with explicit
  consent and connectivity. Account-free/offline desktop retains Ticket 127's
  local fallback and accepted shortcuts. Never package provider credentials or
  add a closed-app helper. Do not upload local-only history implicitly.
- Implement the finalized provider retention/deletion contract and factual
  consent/privacy copy before enabling the feature. Record sanitized operational
  evidence and an off switch. Update source-of-truth docs, user guidance,
  existing interaction/bench records, and cross-platform QA evidence.

Implementation references:

- Ticket 127's shared resolver and proposal persistence; `lib/services/` for
  provider orchestration and `lib/db/` for owner-scoped reads/writes
- `app/(app)/behaviors/actions.ts` and an authenticated desktop-callable route
  documented in `docs/ROUTE_MAP.md`; both call the same service
- `apps/desktop/src/account/`, shared Note/Behavior controls, existing Settings,
  `interaction-registry.json`, and `design-system.surfaces.json`

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | This ticket owns the authenticated analysis service, consent gating, bounded provider calls, and proposal review integration |
| Desktop | This ticket owns consented linked-account requests, offline/unavailable fallback, and native review acceptance |
| Marketing | This ticket owns accurate analysis/privacy guidance after provider verification; no coaching or medical claims |
| Future mobile | No implementation: mobile remains deferred; reuse the documented authenticated contract in a separately scoped ticket |

Verification: synthetic provider fixtures for paraphrases, negation, injection,
unsupported evidence, malformed output, timeout, rate limits, and retry races;
two-owner/two-Behavior isolation; consent revocation and source deletion during
analysis; accepted/dismissed state preservation; offline desktop behavior.
Repeat Ticket 126's evaluation with the integrated adapter. Run all standard
checks, affected desktop/core/design-system/marketing checks from Ticket 127,
and responsive browser/native QA. Live provider acceptance uses synthetic Notes
within authorized access and spending; record unverified gates explicitly.

Out of scope: background schedules, automatic learning from other Behaviors,
AI coaching, diagnosis, automatic Note/status writes, speech, and model access
to exports, reminders, or unrelated account data.


---

## Desktop repair and updater sequence: Tickets 129–131

Planned 2026-09-08 from the owner's storage, sync, and updater request.
Deliver Tickets 129 and 130 together first. Ticket 131 must not delay that repair release.
Preserve account links, local edits, Notes, history, and unrelated workspace changes.
No production changes occur during planning. Deployment and installed-app acceptance
are explicit completion steps, governed by the existing release workflows.
The shared verification and rollout requirements below apply to all three tickets.

## Ticket 129: Bounded reminder bookkeeping and storage recovery

Status: in_progress (2026-09-08).

**Stop the growth at its source.**

- Reuse the existing journal. Store compact receipts for the two native-reminder operations instead of complete requests and reminder-state responses.
- Retain at most the latest receipt per operation and local profile. Store the mutation ID, request hash, and revision.
- Mark these receipts as device-local and complete immediately. They must not accumulate as pending account changes.
- Preserve the existing monotonically increasing sequence used by reminder freshness checks.
- Return current reminder state for an identical retained retry. Reject changed payloads or stale revisions before writing.
- Keep domain mutations, pending user edits, tombstones, and account acknowledgements unchanged.
- Coalesce repeated refresh requests into one running reconciliation and one pending reconciliation. Preserve delivery evidence until SQLite commits it.

**Repair existing installations safely.**

- Add a tracked SQLite migration that compacts existing native-reminder journal entries while preserving sequence continuity.
- Run recovery before background reconciliation starts. Suspend database writes during maintenance.
- Create one protected recovery backup using the existing SQLite backup implementation.
- Remove redundant native-reminder journal payloads, checkpoint the WAL, and compact the live database.
- Validate database integrity, foreign keys, account identity, baseline, product data, and pending domain mutations before and after cleanup.
- Reopen the database successfully before deleting this repair’s backup, following the user’s selected preference.
- Persist a small recovery marker so interrupted maintenance resumes safely. Preserve the backup on any failure.
- Never delete user-created backups. Report actual before/after disk usage, including WAL and remaining recovery files.

SQLite compaction requires temporary free space. Check available space first and leave the original intact on failure. [SQLite VACUUM documentation](https://www.sqlite.org/lang_vacuum.html)

**Acceptance:** repeated reconciliation on an unchanged dataset retains two compact receipts at most. A 10,000-cycle fixture shows no linear journal growth. The affected database loses its redundant gigabytes without changing user records.

Additional acceptance details:

- Limit compaction to `mutation_outbox` operations `commitNativeReminderPlan`
  and `recordNativeReminderCoverage`, keyed by `(user_id, operation)` for retention.
  Preserve mutation retry identity `(user_id, mutation_id)` and the sequence high-water mark.
- Before implementing recovery, document marker transitions for backup verified,
  cleanup committed, compaction complete, reopen verified, and optional backup deletion.
  Inject interruption at each transition. Verify restart resumes without another backup
  or lost domain writes. Prove all native write entry points honor maintenance exclusion.
- Compare canonical pre/post fingerprints of account identity, baseline, product rows,
  and pending domain mutations. Exclude only the authorized reminder bookkeeping changes.
  Test insufficient space before writes, mid-cleanup failure, rollback, reopen failure,
  and retained backup recovery. Never resume reconciliation on failed validation.

Implementation references and contract ownership:

- Reuse `apps/desktop/src-tauri/src/local_store/mod.rs`, `reminder.rs`, and
  `db.rs`; add the next tracked migration under `apps/desktop/src-tauri/migrations/`.
- Coalesce refreshes in `apps/desktop/src/local-reminder.service.ts` and gate
  startup in `apps/desktop/src/product.tsx`. Preserve existing delivery evidence handling.
- Update `docs/DESKTOP_DATA_MODEL.md`, `docs/DESKTOP_BUILD.md`,
  `docs/NOTIFICATION_SPEC.md`, and `docs/OPERATIONS.md` with implemented behavior.
- Extend native tests and `tests/desktop-store-contract.test.ts`. Record recovery
  measurements and failure evidence without Notes, credentials, or record identifiers.
- Recovery-backup retention is an installed-app acceptance input. Record the
  owner's preference before deletion; an absent preference retains the backup.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Desktop | This ticket owns compact receipts, maintenance, recovery, and installed-database acceptance in the native store and reminder service above |
| Web | No storage implementation: the journal and recovery files are device-local; preserve hosted reminder semantics |
| Marketing | This ticket owns factual repair/help copy in `docs/user-guide/desktop-local.md` and release notes after verification |
| Future mobile | Implementation deferred; no mobile database or maintenance flow exists |

---

## Ticket 130: Dependency-safe account synchronization

Status: in_progress (2026-09-08).

**Apply the chosen deletion policy.**

- When synchronization accepts legitimate occurrence deletion, delete its attached reminder logs on both copies.
- Apply this to all delivery statuses. Retain delivery logs while their occurrence remains.
- Never restore a reminder whose occurrence is absent from the accepted result.
- Protect occurrences containing Notes, status history, or tracked time. Concurrent user changes must produce reviewable conflicts.
- Reject incomplete input graphs with an actionable error. Do not treat arbitrary missing parents as authorized deletion.

**Update every enforcement boundary.**

- Adjust the shared planner and both ordinary and reviewed sync paths.
- Replace blanket reminder-deletion protection with deletion permitted only alongside accepted parent removal.
- Add matching Postgres and native SQLite validation. Preserve ownership checks, foreign keys, atomic apply, and stale-plan protection.
- Delete children before parents. Validate that every retained reminder references a retained occurrence.
- Add a tracked hosted migration for the RPC guard change.
- Keep baseline advancement and outbox acknowledgement conditional on both hosted and local success.

Deletion acceptance matrix:

- Require complete baseline, local, and hosted graphs before planning. An automatic
  accepted deletion requires an existing baseline occurrence, its deletion on one
  copy, an unchanged occurrence on the other, and no protected user content.
  Compatible deletion on both copies must also preserve the protected-content checks.
- Notes, status history, tracked time, resolved status, or concurrent user edits
  prevent automatic deletion. Use existing review controls and stale-plan checks;
  never interpret a missing parent in an incomplete input as a deletion decision.
- Cover pending, sent, failed, and cancelled reminders with removable and protected
  parents, in both deletion directions and reviewed apply. Retain every reminder
  when its parent remains; delete every attached reminder only with accepted parent removal.

**Repair the affected account through normal sync.**

The 2026-09-10 processing-claim follow-up also repairs ordinary and reviewed
reminder planning. Preserve existing processing claims when the selected row
omits them, so choosing a Mac cancellation cannot violate the hosted or SQLite
guard. Keep explicit conflict review and existing status semantics. This requires
no schema change. The shared planner and resolver tests below own the repair;
the platform impact table below also applies to this follow-up.

The subsequent snapshot-timeout follow-up optimizes
`cadence_private.canonical_account_sync_json(jsonb)` through migration
`20260911031421_accelerate_account_sync_canonical_json.sql`. Preserve canonical
bytes, permissions, RLS, statement limits, and all apply guards. Verify the
unchanged output and synthetic performance with
`tests/sql/account-sync-canonical-smoke.sql`, then verify owner-account snapshot
and normal synchronization after authorized deployment. Web owns the hosted
function; installed desktops benefit through the existing RPC without an app
update. Marketing has no UI or copy change; future mobile implementation remains
deferred and inherits the same fingerprint contract.

The owner-approved 2026-09-15 reminder reconciliation follow-up adds one narrow
exception to manual delivery conflict review. From a Pending baseline, preserve
a hosted Sent record over a local Cancelled copy only when identity, schedule,
provenance, and other non-delivery-state fields match. Require a valid send
timestamp and compatible existing claims. Merge occurrence decisions independently;
conflicting user edits and other reminder conflicts still block the whole plan.
The shared account-sync resolver and paired tests own the rule in ordinary and
reviewed synchronization. Verify offline completion, preserved send evidence,
retry after hosted commit, unchanged replay, cancellation before sending, and
continued review for changed identities, schedules, evidence, and user content.
Platform impact: desktop changes its planner and INT-AUTH-009–011 conditions;
web keeps its existing hosted apply and reminder processor, with no migration.
Marketing has no runtime change; update the existing desktop user guidance.
Future mobile remains deferred. Installed preview rollout remains separate.

The 2026-09-16 compatible-mark follow-up preserves independent initial manual
marks after an Unresolved baseline without status history. Require matching
resolved status, provenance, non-status occurrence fields, and each copy's own
timestamp evidence. Preserve every event; select display timestamps with the
existing latest-event ordering. Corrections and divergent descendants remain
blocked. Remove the dormant history-deleting review handler. Verify hosted-commit
retry, unchanged replay, later corrections, fresh hydration, incompatible fields,
and combined reminder reconciliation with unrelated conflict review.
Platform impact and implementation ownership match the preceding planner
follow-up. No schema or provider deployment is required. Install a protected
preview and verify convergence through normal authenticated synchronization.
Installed acceptance: preview.29 reached Account data is current on startup and
repeat sync. All 1,196 original status events remained unchanged; all four
matching-mark pairs and the three original Sent reminders converged. The outbox
has no unacknowledged rows. Read-only hosted verification matched 27 affected
history/reminder rows to the accepted baseline. SQLite integrity and foreign
keys pass; a protected app/database rollback remains available.

Timeout follow-up acceptance (2026-09-10): the owner approved the single hosted
migration. CLI dry-run and deployment applied only `20260911031421`. The hosted
snapshot retained its exact fingerprint and read in 1.15 seconds versus 4.8
seconds before deployment. Installed desktop preview.24 applied the owner's
existing reminder decisions, uploaded six status-history records, cleared both
conflicts, and displayed Account data is current. This completes the timeout
follow-up without declaring the broader Ticket 130 complete.

- Verify current local and hosted snapshots read-only before applying the repaired plan.
- Install the compatible repair build and run normal synchronization.
- Confirm convergence of Behaviors, occurrences, Notes, histories, and Needs decision for the same timezone and date.
- Do not reset the account link or overwrite local data from the web copy.
- Route genuine conflicts through existing review controls.

**Acceptance:** reproduce the original failure before the fix. Then prove convergence, rollback, and retry behavior against real Postgres and SQLite.

Implementation references and contract ownership:

- `packages/core/src/resolvers/account-sync.resolver.ts` owns ordinary and
  reviewed planning. Trace all callers before changing shared deletion guards.
- `apps/desktop/src/account/account-sync.ts`, `apps/desktop/src/sync-engine.ts`,
  and `apps/desktop/src-tauri/src/local_store/sync_apply.rs` own adapter ordering,
  native validation, atomic apply, baseline advancement, and acknowledgement.
- Add the next tracked guard migration under `supabase/migrations/`; update
  `docs/DATA_MODEL.md`, `docs/DESKTOP_DATA_MODEL.md`, `docs/DESKTOP_BUILD.md`,
  `docs/AGENT_RESOLVERS.md`, and `docs/NOTIFICATION_SPEC.md` with the new contract.
- Extend `tests/account-sync.resolver.test.ts`,
  `tests/desktop-account-sync-adapter.test.ts`, `tests/desktop-sync-engine.test.ts`,
  native tests, and real Postgres/SQLite contracts.
- The selected all-status child-deletion policy supersedes the delivery-history
  retention recommendation in `docs/qa/2026-09-08-account-sync-audit.md`.
  Keep that audit as historical evidence. Existing blanket reminder guards are
  implementation defects to replace, not permission to discard other history.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Desktop | This ticket owns shared planning, native apply, normal account repair, and convergence acceptance through the references above |
| Web | This ticket owns the hosted RPC guard migration and shared sync contract; preserve RLS, ownership, and ordinary hosted reminder behavior |
| Marketing | This ticket owns factual sync-repair help/release copy after acceptance; no marketing account-data implementation |
| Future mobile | Implementation deferred; the shared dependency-safe sync contract defines future parity |

---

## Ticket 131: Automatic downloads with user-controlled installation

Status: in_progress (2026-09-08); excluded from the Tickets 129–130 repair release.

Extend the existing signed Tauri updater. No new updater service or dependency is needed.

**Checking and downloading**

- Initialize the updater at app startup, independently of Settings.
- Check after startup, then every 24 hours while running. Resume and connectivity recovery trigger overdue checks.
- Persist the last attempt time to prevent repeated launch requests. Manual **Check for updates** bypasses this interval.
- Download a newer release automatically. Retain one candidate per app session and release superseded resources.
- Split the existing transport into `download`, `install`, and `restart`. Tauri already supports separate download and installation. [Tauri updater API](https://v2.tauri.app/reference/javascript/updater/)
- Keep the current HTTPS feed, signature verification, version ordering, and downgrade prevention.
- Provide an enabled-by-default **Download updates automatically** setting. Disabling it retains manual checks and downloads.
- Run no closed-app background helper. Downloads interrupted by quitting retry during a later app session.

**Prompt and installation experience**

- Show a nonmodal shell notice when the update is ready: version, **Review update**, and **Later**.
- **Later** suppresses that version’s notice for 24 hours. Settings retains its update status and actions.
- Settings shows release notes, download progress, installation state, and actionable retry errors.
- Installation requires **Install update**. Restart requires a separate **Restart Cadence** action.
- Prevent restart during active writes or maintenance. Require saving or explicitly discarding unsaved drafts before restart.
- Keep ordinary background-check failures quiet outside Settings. Never steal focus or show recurring launch dialogs. [Apple alert guidance](https://developer.apple.com/design/human-interface-guidelines/alerts)
- Recognize the existing incompatible-client sync response and show **Update required to synchronize** with a direct update action.
- Keep local tracking available while an update is required.

Compatibility acceptance details:

- Both errors originate in `cadence_private.apply_account_sync_plan(jsonb)`.
  Capture the existing hosted compatibility errors from migrations
  `20260905035835_user_defined_categories.sql` and
  `20260906010951_add_behavior_archive_notes.sql`: SQLSTATE `22023` with
  `Update Cadence before synchronizing category changes.` or
  `Update Cadence before synchronizing Behavior changes.` respectively.
- Trace these RPC errors through the account adapter and sync engine into desktop UI.
  Name that response contract and producer in the owning docs before implementation.
  Test both exact compatibility responses and negative cases: unrelated `22023`,
  network failure, authorization failure, and ordinary conflicts must not prompt updates.
- Persist an attempt when a check starts. Coalesce concurrent automatic checks;
  Settings manual checks bypass the interval. Manual mode exposes explicit download
  before the separate install and restart actions.

**Acceptance:** verify automatic discovery/download, postponement, manual mode, offline recovery, signature rejection, navigation during download, installation failure, and draft-safe restart.

Implementation references and contract ownership:

- Extend `apps/desktop/src/desktop-updater.ts`, `native-updater.ts`,
  `desktop-update-panel.tsx`, `product.tsx`, `settings-screen.tsx`, and
  `apps/desktop/src-tauri/src/updates.rs`. Reuse the signed feed and native restart boundary.
- Extend `tests/desktop-updater.test.ts` and native tests; verify shell and Settings
  behavior during navigation, active writes, maintenance, and unsaved Note/Behavior drafts.
- Update `docs/DESKTOP_BUILD.md`, `docs/DESKTOP_RELEASE.md`, `docs/UI_SPEC.md`,
  `docs/USER_FLOWS.md`, `docs/OPERATIONS.md`, and `docs/user-guide/desktop-local.md`.
- Use the project-local impeccable workflow and design-system-bench before UI edits.
  Extend the existing updater intent in `interaction-registry.json`, its desktop
  parity evidence, and the existing design-system catalog/bench when implemented.
  Do not register planned controls as implemented during this planning pass.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Desktop | This ticket owns startup scheduling, automatic downloads, Settings, shell notices, and guarded install/restart through the references above |
| Web | No updater UI or service: recognize the existing incompatible-client response on desktop; Ticket 130 owns required hosted sync-contract changes |
| Marketing | This ticket owns factual update/release help copy after acceptance; no new marketing layout |
| Future mobile | Implementation deferred; native mobile update distribution requires a separately scoped ticket |

---

### Shared verification and rollout for Tickets 129–131

- Record each ticket’s platform impact: desktop implementation; web sync-contract changes where applicable; marketing release/help copy only; mobile implementation deferred.
- Update ticket status, owning contracts, interaction registry, user guidance, and design-system evidence.
- Run all required repository checks, plus desktop TypeScript/build, native tests, SQLite contracts, and real Postgres sync contracts.
- Test interrupted cleanup, insufficient disk space, stale mutations, lost sync responses, and successful restart.
- Verify updater UI with keyboard navigation, accessible status announcements, reduced motion, and narrow layouts.
- Build from an isolated release checkout. Include required hosted-contract compatibility without accidentally bundling unfinished features.
- Apply the hosted guard migration before activating repaired synchronization. Verify the signed desktop artifact and publish its matching feed afterward.
- Bootstrap preview.19 through its existing manual updater once the repair release is available.
- Confirm the owner’s database size, sync convergence, and version after installation. Repeat unchanged reminder reconciliation to prove growth has stopped.
- Keep Apple Developer ID signing and notarization under existing Ticket 115. Do not describe updater signature verification as Apple notarization.

No production changes occur during planning. These tickets include deployment and installed-app acceptance as explicit completion steps.

Required implementation commands (record individual results; do not mark a ticket
complete from unit checks alone):

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run core:check
npm run desktop:typecheck
npm run desktop:build
npm run desktop:native:test
npm run desktop:contract:test
npm run desktop:parity:check
npm run design-system:check
npm run marketing:check
npm run marketing:build
npm run supabase -- db reset
SUPABASE_TELEMETRY_DISABLED=1 CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts
npm run smoke:account-sync:local
```

Run database contracts only against the isolated local service per
`docs/SUPABASE_WORKFLOW.md`. Add explicit reminder-deletion cases to the real
sync contracts; existing suites alone do not prove this repair.
Use `docs/DESKTOP_RELEASE.md` for signed candidate and installed-updater acceptance.
Document the repair release's exact source and required hosted compatibility.
Reproduce the audit defect before changing its planner behavior.
Mark Tickets 129–130 complete only after their shared repair release and owner
acceptance. Ticket 131 follows separately and cannot delay that release.

---

## Day-progress timeline sequence: Tickets 132–137

Planning authorized 2026-09-15; implementation requested 2026-09-16.
Ticket 132 is complete: the owner accepted the seventh-revision UI baseline on
2026-09-16 and deferred minor design polish. Tickets 133–137 now have local
production integration, a versioned connector contract, and regression coverage.
Hosted rollout and same-account web consent passed on 2026-09-17.
Installed preview.36 reads live Calendar events; remaining native acceptance is open.
The owner selected web and desktop together, a Calendar connection using the
same signed-in Google account, tracked duration estimates with an unknown
fallback, advisory overlap cues only, and a local desktop event cache.

Source of truth: the planned day-progress sections in `docs/PRODUCT_SPEC.md`
and `docs/UI_SPEC.md`. `docs/FEATURE_IDEAS.md` retains the original exploration.
The 2026-09-16 owner request authorizes implementation of this sequence, subject
to its explicit review gates. Provider configuration, hosted deployment, and
desktop distribution still require their respective authorization and evidence.
Provider setup and protected native acceptance were explicitly approved on
2026-09-16. The owner approved hosted rollout, live consent, installed desktop
acceptance, and similar task actions on 2026-09-17. Hosted rollout succeeded.
Public distribution still requires acceptance evidence and applicable provider approval.
Google capability verification belongs to Ticket 134.

Dependency order:

- 132 closes the accepted UI baseline and synthetic layout contracts.
- 134 starts with the versioned event interface, then OAuth, retrieval, and cache.
  Its contract requirements live in `docs/EXTERNAL_EVENT_CONTRACT.md`.
- 133 implements Cadence's own timeline after 132, independently of Google.
  Prioritize 134 infrastructure before further visual polish.
- 135 combines 133 and 134 into the external-event experience.
- 136 adds estimated duration and overlap cues after 135; pure synthetic work
  may proceed after 132 without live provider access.
- 137 verifies the combined web and desktop release after 133–136.

Each implementation ticket must preserve existing interaction intent and use
`interaction-registry.json` and the existing design-system catalog for evidence.
Do not register planned controls as implemented. Use impeccable and
design-system-bench before editing reusable UI. Preserve typography, manual
status semantics, local tracking, and Needs decision. The revised review
candidate keeps timed Calendar context left of the axis and the ledger right.
All Day Events sits beside the ledger-header day title and wraps on narrow
layouts. Desktop status text stays visible unless natural text does not fit.
Mobile uses icon-only 44px actions. The current-time dot has no row tint. Hover/focus
uses a fixed bottom preview drawer with reserved viewport space. The owner has
accepted the seventh-revision baseline. Minor design polish does not block 133–137.

This candidate correction affects the web synthetic bench now. Desktop shares
the candidate for follow-up in Tickets 133–137. Marketing has no change. Native
mobile remains deferred; the responsive web candidate is tested at 390px.

## Ticket 132: Day-progress timeline contract and layout validation

Status: complete. Dependencies: none. Owner accepted the seventh-revision UI
baseline on 2026-09-16 and requested infrastructure work before minor design polish.

Closeout: synthetic layout/context contracts, eight bench DOM tests, complete
repository checks/build, desktop and 390px browser evidence, and independent
review are recorded in `docs/qa/day-progress-layout.md`. Native production
acceptance remains in 133–137. Provider wire/schema finalization belongs to 134,
not a reopened UI gate. No live connector or release is implied.

Each timed event gets one marker at its start, or on the first visible day if it
started earlier. Later days retain duration segments without repeated markers.
Drawers fit their content with 16px padding and reserve only their rendered height.

All-day controls are absent when the day has no all-day events. Otherwise they
show “All day: {first event title}”, with “+N more” for additional visible events.
Dismissed events retain a Restore control. Hover, focus, click, and tap open the
same persistent preview. The preview has no repeated heading or divider. Each
event owns a View details button that opens only that event in the modal details
drawer. Closing details returns focus to the original timeline control.


Goal: prove a readable continuous time line beside responsive ledger rows
before connecting external data or changing the production Timeline.

Scope and acceptance:

- Use one line to the left of today's and future days' rows. Cover each full
  local day, including empty time, and show clock-time labels only at items.
  Retain today plus seven future days, Show more days in seven-day steps, and
  the existing thirty-future-day cap. Extend the same line when days load.
- Define a monotonic time-to-position mapping shared by the moving dot,
  selected-event span previews, and anchors. Minimum readable spacing overrides
  exact scale;
  compressed gaps must not imply uniform scale. Keep day boundaries clear.
- Validate isolated rows, equal-time labels, close items, long
  gaps, empty days, expanded rows, simultaneous timers, overnight events, all-day areas,
  and dense external-icon clusters. Use one day-progress axis with centered
  perpendicular stems without axis nodes. Behavior rows have no
  axis-facing ticks or nodes. Group only identical original start instants inside one event lane;
  do not add parallel timeline columns.
- Resolve the current multiple-time Behavior stacks explicitly. Compare
  chronological placement of responsive rows with connectors into the existing
  stacks. Reduce the unused gap between each Behavior title and its actions.
  Show Completed and Not Completed text by default on desktop. Hide it only when
  the measured title and actions do not fit. Use icon-only mobile actions with
  screen-reader labels, tooltips, and 44px targets; resolved status text may
  remain. Record one coherent choice before Ticket 133; do not
  silently reorder historical data or alter typography or status treatment.
- Keep timed Calendar context left of the axis and the ledger exclusively right.
  Restore action padding is 12px on narrow layouts and 16px on desktop. Align day headers with the
  right of the axis and continue the axis across headers and days. Keep equal-time
  peers on visible actual-time labels without Behavior-facing ticks, nodes, or
  the bracket that made Calendar icons look connected. The pure layout contract may
  retain shared-time peer mapping.
- Do not add an All day column on the right. Place All Day Events beside the day
  title in the ledger header and allow it to wrap on narrow layouts. Hover or focus opens the
  same fixed bottom non-modal preview drawer used for timed Calendar events. Reserve matching
  viewport space; cap it at `min(18rem, 40dvh)` (a maximum, never a fixed height) and scroll internally. Persist it until explicit
  dismissal or replacement so a pointer can reach it. Each event’s View details action opens its own bottom native modal details drawer. Close or Escape returns focus without reopening the preview. Dismissal and restore cause no provider or status writes.
- Timed-event hover/focus previews show duration as a temporary thickened
  axis segment from the displayed original-day perpendicular-stem contact and highlight matching
  Behavior rows. Preserve mapped length to the day body bottom. An overnight continuation starts at
  the next section top above its heading, continues to the event end without another marker or stem.
  Details retain actual times. Do not show permanent
  duration bars. Calendar icons use centered perpendicular stems without axis
  nodes. Group only exact original-start-instant peers; nearby starts remain
  separate. Dense icons may displace vertically into 44px non-overlapping
  targets. Actual timestamps remain unchanged; displayed duration follows stem offsets.
- Validate fixed bottom non-modal preview drawers on hover/focus. They reserve matching viewport
  space, cap at `min(18rem, 40dvh)` (a maximum, never a fixed height), and scroll internally. They persist until explicit dismissal or
  replacement. Hover must not move focus. Each event’s View details action opens its own bottom native modal details drawer;
  Close or Escape returns focus without reopening the preview. Validate source links and easily restorable all-day
  dismissal. Dismissal changes local presentation only and must not delete a
  Google event or write a Cadence status. Existing status colors and Completed/
  Not Completed/Note controls remain clear.
- Render the current-time dot in brand blue without a row tint. No persistent teal overlap fill
  or edge appears. Hover/focus outlines only overlapping Behaviors. Point Behaviors use
  `start <= activation < end`; estimated-duration Behaviors use half-open
  interval overlap. Completed and Not Completed fills remain unchanged.
- Record the layout choice with synthetic fixtures in the existing design
  bench. Compare current and proposed rows at desktop and 390px widths. Obtain
  owner review of the proposed layout before production UI implementation.
- Include two 8:00 AM morning events, three 12:45 PM lunch events, separate
  7:50 AM and 8:05 AM events, and an evening-water toggle. The three-hour
  duration overlaps a 23:30 train event; the 21:30 point does not. Use the Calendar
  badge for same-start groups without changing group data or actions.
- Establish typed synthetic external-event, freshness, duration-estimate, and layout
  contracts; Ticket 134 finalizes the provider wire/schema boundary. Distinguish actual timestamps, estimated windows, unknown duration,
  all-day dates, and display displacement. No raw provider payload enters core.
- Validate the proposed estimate default: positive stopped-session totals for
  at least three Completed Occurrences of the same Behavior in the preceding
  ninety local days; exclude Occurrences with running sessions. Use their
  arithmetic mean. Missing or insufficient history means unknown, never zero.
  Treat this as a planning default, not an owner-specified statistical threshold.
- Update owning UI, flow, datetime, resolver, and desktop parity docs with the
  chosen layout and contracts. Existing Temporal/local-midnight correctness
  remains required; new timezone controls and presentation refinements stay deferred.

Implementation references:

- `components/timeline/Timeline.tsx`, `TimelineGroup.tsx`, `OccurrenceRow.tsx`,
  `TimeTracker.tsx`, `app/globals.css`, and `apps/desktop/src/product.tsx`.
- `packages/core/src/resolvers/timeline.resolver.ts`,
  `analytics.resolver.ts`, `time-tracking.resolver.ts`, and `types/timeline.ts`.
- `app/design-system/`, `design-system.surfaces.json`, `DESIGN.md`,
  `docs/INTERACTION_REGISTRY.md`, and `docs/DESKTOP_PARITY.md`.
- Add synthetic evidence in `docs/qa/day-progress-layout.md`; pair any new
  layout logic with `tests/day-progress.resolver.test.ts`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Synthetic design bench only; production UI follows in 133 and 135–136 |
| Desktop | Shared candidate only; production integration and acceptance follow in 133–137 |
| Marketing | Not applicable: no product claim or layout change |
| Future mobile | Native implementation deferred; responsive web is tested at 390px now |

Verification: document fixture outcomes, row-size comparisons, keyboard/touch
behavior, and owner layout review. Run governance checks below; any prototype
code also requires the standard coding checks. Provider access is unnecessary.

## Ticket 133: Continuous day-progress timeline on web and desktop

Status: in_progress (deployed web and installed evidence recorded; remaining combined native acceptance is open). Dependency: Ticket 132.

Goal: ship the time line and moving current-time dot using Cadence data alone.

Scope and acceptance:

- Implement the accepted left-side layout with a continuous full-day span
  across the visible range, item-only time labels, clear day boundaries,
  centered perpendicular stems without Calendar axis nodes, and one Calendar lane.
  Only identical original start instants group; nearby starts remain separate. Behavior rows have no axis-facing ticks or nodes.
  Use the accepted responsive Behavior width and reviewed collapsed-row treatment
  without changing typography or status treatment.
- Keep timed Calendar context left of the continuous axis and the ledger exclusively
  right with 12px narrow and 16px desktop action padding. Align day headers with the ledger and
  continue the axis through headers and days. Preserve visible actual-time labels
  without Behavior-facing ticks, nodes, or a bracket. Ticket 135 adds the reviewed
  All Day Events control beside the ledger-header day title.
- Share pure layout decisions through
  `packages/core/src/resolvers/day-progress.resolver.ts`, paired with
  `tests/day-progress.resolver.test.ts`. Extend existing Timeline types and
  service output; preserve the web compatibility exports and Needs decision.
  UI owns element measurement, resize observation, and rendering only.
- Reuse current future-day limits and Show more days. Keep the same mapping
  for rows and the dot when loading days or expanding a row. Preserve focus,
  drafts, and scroll context during ordinary refresh; do not auto-scroll to now.
- Advance one dot through today's segment. Recompute on resume, visibility
  return, day change, and relevant layout/data changes. Suspend animation and
  recurring display work while hidden or minimized. Do not refetch account data
  or write storage on animation frames. Record an idle-performance comparison.
- Render the dot in brand blue without a row tint. Scheduled time ranges affect
  presentation geometry only, never estimated duration or status.
- At local midnight, the new current day becomes the first forward section.
  Prior unresolved items still use Needs decision. Removing past sections
  never deletes records or automatically changes status.
- Support reduced motion and an accessible current-position description without
  a constantly announcing live region or a new permanent hourly ruler.
- Keep the timeline usable offline in desktop local mode and when no Calendar
  account is connected. Preserve existing web online-only mutation behavior.

Implementation references:

- Existing Timeline components above and a proposed
  `components/timeline/DayProgressTimeline.tsx` shared presentation component.
- `packages/core/src/services/timeline.service.ts`,
  `lib/services/timeline.service.ts`, `apps/desktop/src/local-timeline.service.ts`,
  and `apps/desktop/src/product.tsx` own view assembly and platform wiring.
- Extend `tests/timeline.resolver.test.ts`, `tests/timeline.service.test.ts`,
  `tests/local-timeline.service.test.ts`, and Timeline DOM interaction checks.
- Update INT-TIMELINE-001 and affected existing Timeline intents only when
  their implemented behavior changes. Update design-system and parity evidence.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared presentation and existing web Timeline service above |
| Desktop | Shared presentation, local Timeline service, and Product wiring above; offline/native acceptance required |
| Marketing | No site layout; 137 documents verified timeline behavior |
| Future mobile | Native implementation deferred; shared layout must pass narrow web checks |

Verification: pure mapping tests, DOM status/Note regression checks, midnight
and resume cases, responsive-row collision fixtures, narrow browser QA, native
WKWebView QA, and idle/minimized performance evidence. Run applicable shared checks.

## Ticket 134: Google Calendar connector and documented external-event interface

Status: in_progress (hosted rollout and same/wrong-account live checks pass; remaining native/provider acceptance is open).
Dependency: Ticket 132 (complete). Next priority: infrastructure.

Goal: provide rich read-only events from the same Google identity used to sign
into Cadence, with a bounded local desktop cache and honest freshness states.

Implementation order and contract acceptance:

1. Finalize the versioned normalized event/snapshot contract in
   `docs/EXTERNAL_EVENT_CONTRACT.md`. Extend existing core types; deliver a
   machine-readable schema, runtime validation, field dictionary, and examples.
   Preserve start/end, explicit derived duration or unknown, source timezone,
   recurrence identity, revision, event state, busy/free facts, and coverage.
2. Record the named read operations, typed errors, capability/permission matrix,
   credential custody, cache lifetime, and compatibility policy. Resolve the
   server-owned connector recommendation in `docs/qa/google-calendar-capabilities.md`
   before provider configuration. MCP informs schemas and capabilities only;
   no MCP server or generic connector framework is required.
3. Implement same-account OAuth, bounded retrieval, normalized adaptation, and
   atomic account-scoped cache refresh/cleanup. Keep the ordinary timeline
   independent from connector availability.
4. Prove the same contract on web and desktop with schema/provider/cache fixtures,
   including a minimal scheduling projection. This is reusable data infrastructure,
   not model inference, dynamic rearrangement, source editing, or automatic writes.

The owner explicitly requested documentation suitable for future scheduling
consumers. This contract is a required deliverable, not optional follow-up prose.

Scope and acceptance:

- Verify provider capabilities before selecting scopes, credential flow,
  callback routes, or schemas. Inspect current Google login/account-linking
  code first. Record whether existing authentication can support incremental
  Calendar consent; do not assume a Cadence login token grants Calendar access.
- Require Cadence sign-in and bind the connector to that account's Google
  identity. Reject a different provider identity without switching Cadence
  accounts or mutating local data. Account-free desktop tracking remains usable;
  Calendar connection is unavailable there.
- Offer explicit Calendar connection, calendar selection, visibility controls,
  reconnect, refresh, and disconnect in Settings on web and desktop. Use
  read-only provider access; never create, edit, or delete source events.
- Document a field-coverage matrix for title, description, time, duration,
  location, source URL, and supported organizer, attendees, conference,
  recurrence, and attachment links. Mark unavailable/restricted fields honestly.
  Preserve rich details through a safe typed adapter; sanitize descriptions and
  validate external links. Do not download attachments automatically.
- Bound reads to selected calendars and displayed days, including events that
  intersect the range. Handle pagination, recurrence instances/exceptions,
  cancellations, duplicates, rate limits, and interrupted refresh. Do not
  replace a complete cache with an incomplete response presented as complete.
- Desktop caches selected event details for the displayed date range, scoped
  to the signed-in account. Evict past/out-of-range data on reconciliation.
  Offline reads retain last-refreshed/stale labels. A missing cache or failed
  refresh never means the calendar is empty. Web gets no new PWA/offline cache.
- Refresh coalesces across Timeline and Settings. Define bounded on-open,
  resume, visible-app refresh, and manual-refresh behavior; avoid per-dot
  network calls, unbounded polling, webhooks, or a closed-app desktop helper.
- Define credential custody before coding. Web secrets remain server-only;
  desktop-held secrets use Keychain. No tokens enter SQLite, browser storage,
  logs, exports, backups, account-sync snapshots, or shipped frontend bundles.
  Preserve RLS and ownership for any new hosted records.
- Keep external events and connector credentials outside BehaviorLog exports
  and ordinary Cadence account synchronization. Both clients fetch Google data
  through the reviewed connector architecture, not by syncing cached events.
- Disconnect stops that connection's refresh and clears its credentials and
  cached external details. Define grant revocation and other-device effects
  accurately for the chosen architecture. Cadence sign-out/account disconnect
  clears the current client's event cache even when Cadence records are kept.
  Handle account deletion, remote revocation, and reauthentication explicitly.
- Update `docs/ROUTE_MAP.md`, `docs/OPERATIONS.md`, `docs/DATA_MODEL.md`,
  `docs/DESKTOP_DATA_MODEL.md`, `docs/DESKTOP_BUILD.md`, and privacy/help copy
  before enabling the integration. Add migrations, generated types, RLS/ownership
  checks, cache backup exclusions, and compatibility tests if storage changes.

Implementation references:

- Inspect `app/auth/google/route.ts`, `app/auth/callback/route.ts`,
  `lib/auth/`, `apps/desktop/src/account/auth.ts`, and existing Keychain boundary.
- Extend `app/(app)/settings/`, `components/settings/`, and
  `apps/desktop/src/settings-screen.tsx` for reviewed account-bound controls.
- Proposed service/adapter ownership: `lib/services/google-calendar.service.ts`,
  `lib/db/` for required hosted records, and
  `apps/desktop/src/calendar/google-calendar.ts` for the desktop adapter.
  Native code owns secure storage and atomic local cache operations only.
- Add paired connector service/adapter tests and provider-response fixtures.
  Test synthetic accounts before any separately authorized real-account check.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Settings, server connector service, and reviewed OAuth/routes above; protect account ownership |
| Desktop | Settings, connector adapter, Keychain boundary, and account-scoped offline cache above |
| Marketing | This ticket owns accurate privacy/connector help requirements; 137 publishes verified claims |
| Future mobile | Native implementation deferred; record reusable event/consent contract only |

Verification: same-account success, wrong-account rejection, consent denial,
revocation, reconnect, selected calendars, complete paginated refresh, stale
offline cache, cache cleanup on account changes, safe content, and secret
absence in exports/sync/backups/logs. Verify live web and native flows before
claiming integration completion. Provider setup and release remain explicit gates.

## Ticket 135: External event lanes, previews, and details

Status: in_progress (shared production presentation; combined acceptance pending). Dependencies: Tickets 133 and 134.

Goal: integrate the accepted Calendar interface beside the ledger, using the
Ticket 134 normalized contract. Preserve the seventh-revision interaction baseline:
hover/focus/click/tap previews, no repeated drawer heading/divider, per-event
details, and conditional title-based all-day labels. Minor visual polish is deferred.

Scope and acceptance:

- Render source icons in one left Calendar lane on one day-progress axis. Use
  centered perpendicular stems without axis nodes. Group only identical original
  start instants. Keep nearby starts separate with non-overlapping 44px controls.
  Display displacement must never change an event's actual time.
- Derive timed-event hover/focus spans from the same time mapping as the current-
  time dot, then apply the displayed stem offsets. Show duration as a temporary thickened axis segment from the displayed
  original-day perpendicular-stem contact and highlight matching Behavior rows. Preserve mapped length
  to the day body bottom. An overnight continuation starts at the next section top above its heading,
  continues to the event end without another marker or stem. Details retain actual times. Do not show permanent duration bars.
  Preserve multi-day/overnight continuity without counting one source event
  as multiple distinct events. Show external activity near the dot without
  overlaying ledger controls or implying a Cadence completion decision.
- Keep All Day Events beside the ledger-header day title and allow narrow wrapping.
  It uses the same fixed bottom non-modal hover/focus preview drawer as timed Calendar events.
  The drawer reserves matching viewport space, caps at `min(18rem, 40dvh)` (a maximum, never a fixed height), and scrolls internally.
  It persists until explicit dismissal or replacement. Each event’s View details action opens its own bottom native modal details drawer.
  The user can dismiss items and restore
  them easily. Dismissal is local presentation state,
  not source-event deletion or a stored Cadence status. Preserve date-only
  meaning; do not invent midnight durations or timed-conflict warnings.
- Hover/focus reveals the fixed bottom non-modal preview drawer. It persists until explicit dismissal or replacement.
  Hover must not move focus. Each event’s View details action opens its own bottom native modal details drawer. Close or Escape returns focus without reopening the preview. Include
  every supported readable detail and a source link where available. Handle
  restricted, missing, long, and stale content.
- Keep icons keyboard accessible with descriptive names. Test preview dismissal,
  modal focus containment/return, Escape, touch access, reduced motion, and
  narrow layouts without covering status buttons. Verify responsive row widths
  keep Completed and Not Completed readable.
- Preserve last-refreshed and offline/error states from the connector service.
  Distinguish no selected calendar, no events, not loaded, and refresh failure.
  The ordinary Cadence timeline remains usable in every connector state.
- Register new implemented event/settings intents in the existing interaction
  registry and extend the existing design-system catalog and desktop parity.

Implementation references:

- `components/timeline/DayProgressTimeline.tsx` from 133; proposed
  `components/timeline/ExternalEventDetails.tsx` for shared previews/details.
- `packages/core/src/resolvers/day-progress.resolver.ts` owns layout inputs
  and collision decisions; UI renders its results with measured row geometry.
- `lib/services/timeline.service.ts`, `apps/desktop/src/local-timeline.service.ts`,
  `apps/desktop/src/product.tsx`, and the Ticket 134 connector services.
- Add `tests/external-event-timeline.dom.test.tsx` and extend layout fixtures.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared event presentation wired through web Timeline service |
| Desktop | Same controls in Product, with cached offline details and native source-link opening |
| Marketing | No site layout; verified interaction help follows in 137 |
| Future mobile | Native implementation deferred; touch interactions and 390px web support required now |

Verification: synthetic dense/all-day/overnight fixtures, connector state matrix,
keyboard/touch browser checks, restorable local all-day dismissal, native hover/
click/source-link checks, and existing status/Note/timer regression tests. Run
applicable shared checks.

## Ticket 136: Estimated Behavior durations and advisory overlap cues

Status: in_progress (bounded history and shared presentation wiring). Dependencies: Tickets 132 and 135.

Goal: distinguish estimated scheduling overlap from actual running timers
without changing Behavior schedules or manual statuses. Consume Ticket 134's
validated scheduling projection and explicit coverage/unknown states. Do not
parse Google fields or formatted event labels inside UI or overlap logic.

Scope and acceptance:

- Implement the duration sample policy finalized in 132. Reuse stopped-session
  totals and arithmetic-mean logic from the existing time-tracking and analytics
  resolvers; preserve existing analytics semantics and APIs. Do not average
  separate sessions when the intended sample is an Occurrence total.
- Return an estimated duration, sample count, and provenance or explicit unknown.
  Missing/insufficient history is not zero. Running timers are activity signals,
  not finished samples. Refresh estimates after timing edits/reset and relevant
  status changes, without rewriting recorded sessions.
- Compare a known estimated interval with timed external-event intervals.
  Use half-open boundaries: a Behavior ending at 10:00 does not overlap an
  event starting at 10:00. Unknown-duration items may show scheduled-time overlap,
  but never imply that an unflagged slot is conflict-free.
- Use Possible overlap language and distinguish Scheduled now, Estimated
  window, and Tracking now. Multiple simultaneous signals are valid. Keep
  Completed/Not Completed colors and text authoritative; activity cues are
  supplementary and accessible without color perception.
- Label assessments based on stale calendar data. Do not claim that current
  availability is verified when external events are unavailable or incomplete.
- Exclude all-day items from timed-overlap warnings in this release. Do not
  infer completion, reschedule Occurrences, modify recurrence, write Google
  events, or add a user-set expected-duration field.

Implementation references:

- `packages/core/src/resolvers/analytics.resolver.ts` and
  `time-tracking.resolver.ts` retain recorded-duration ownership.
- Proposed `packages/core/src/resolvers/timeline-context.resolver.ts` and
  `tests/timeline-context.resolver.test.ts` own estimate eligibility, interval
  overlap, and current-activity presentation state with injected `now`.
- `packages/core/src/services/timeline.service.ts`, web/local Timeline adapters,
  and `lib/db/timeSessions.repo.ts` supply bounded owner-scoped history.
- `components/timeline/OccurrenceRow.tsx` and the shared timeline gutter render
  resolver results; neither computes estimates or conflicts independently.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared context resolver and owner-scoped Timeline service history reads |
| Desktop | Same resolver over local history and cached event inputs; stale state remains explicit |
| Marketing | This ticket defines estimate limitations for help copy; 137 publishes verified wording |
| Future mobile | Native implementation deferred; shared resolver contract defines future parity |

Verification: threshold boundary, untimed/partial/running sessions, multiple
sessions per Occurrence, reset/recomputed estimates, interval adjacency,
unknown duration, simultaneous activity, and stale data. Assert no status,
schedule, reminder, or provider writes occur. Run applicable shared checks.

## Ticket 137: Combined timeline acceptance and release documentation

Status: in_progress (source, deployed web, live, and installed evidence recorded; remaining native/provider cases and public approval are open). Dependencies: Tickets 133–136.

Goal: verify the complete experience on both platforms before publishing claims
or distributing the feature.

Infrastructure/documentation closeout is mandatory: `docs/EXTERNAL_EVENT_CONTRACT.md`
must link the shipped schema, examples, field/provider mapping, capabilities,
errors, compatibility policy, ownership, and cleanup procedures to passing tests.
Verify equal scheduling facts across web and desktop, unknown duration and partial
coverage handling, and all exclusions from exports/sync/backups/model calls.
Record deferred minor visual polish separately; do not reopen Ticket 132 unless
the accepted functionality or accessibility contract materially changes.

Scope and acceptance:

- Verify the same synthetic day across web and native desktop: empty/full days,
  closely spaced and simultaneous rows, existing multi-time stacks, expanded
  Notes, active timers, overnight/all-day events, restorable all-day dismissal,
  bottom preview drawers, and native dialog details.
- Verify same-Google-account connection, calendar selection, wrong-account
  rejection, revocation, refresh failure, offline desktop cache, disconnect
  cleanup, and unchanged account-free desktop tracking.
- Verify day rollover, resume after multiple days, future-range extension,
  stale overlap labels, unchanged Needs decision, and no auto-status or schedule
  changes. Run real keyboard/touch and native source-app-link acceptance.
- Compare idle, visible, hidden, and minimized performance with the prior app.
  The moving dot must not reintroduce hidden clock polling, repeated Keychain
  reads, duplicate sync, or per-frame network work.
- If migrations exist, prove clean replay, ownership/RLS, prior-version upgrade,
  rollback/retry behavior, account isolation, and external-cache exclusions from
  normal synchronization, exports, and backups. Protect real desktop data
  before authorized installed-app acceptance.
- Update `docs/user-guide/`, `docs/DESKTOP_PARITY.md`, `docs/DESKTOP_RELEASE.md`,
  `docs/OPERATIONS.md`, implemented interaction/design-system evidence, and
  factual privacy/help content. Publish only verified connector capabilities.
- Record implementation validation separately from deployment/distribution.
  Both platforms must pass acceptance for this combined release. Existing
  Apple-trust requirements remain under Ticket 115; do not weaken them or
  describe an ad hoc preview as notarized.

Implementation references: Tickets 133–136 above, existing release procedures,
and a consolidated evidence report at `docs/qa/day-progress-release.md`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Browser/provider acceptance and authorized deployment under `docs/VERCEL_WORKFLOW.md` |
| Desktop | Native/offline/upgrade acceptance and authorized distribution under `docs/DESKTOP_RELEASE.md` |
| Marketing | Verified connector/privacy/help copy in `apps/marketing/` and `docs/user-guide/`; no speculative redesign |
| Future mobile | Native implementation deferred; report responsive web evidence without claiming a mobile app |

### Shared verification for Tickets 132–137

Planning/contract-only changes: `npm run agents:check`,
`npm run interactions:check`, `npm run resolvers:check`, and `git diff --check`.
These do not establish implementation or provider acceptance.

For coding tickets, run the standard repository gates and applicable platform
checks. Record each result; tests must exercise the added contract:

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run core:check
npm run desktop:typecheck
npm run desktop:build
npm run desktop:parity:check
npm run design-system:check
```

Add native tests and real SQLite contracts when native/storage code changes.
Schema changes also require clean local migration replay, generated types, and
real ownership/adapter contracts. Marketing changes require its check/build.
Use loopback ports 4321–4330 for browser QA. Synthetic fixtures cannot stand in
for real provider or native acceptance. No implementation is complete merely
because the planning checks pass.

## Ticket 138: Public domain setup and Google ownership verification

Status: complete (2026-09-17). Related: Tickets 134, 137, and 139–141.
DNS, TLS, Search Console ownership, public routing, new callback registrations,
and dedicated-account new-domain sign-in/Calendar consent passed. Installed
preview.40 completed the preserved legacy broker's fresh consent, selected only
the demo calendar, refreshed all three demo events, and passed global disconnect.
The primary account is restored and current. Tracking IDs, counts, and values
match the private backup; one reminder advanced from pending to sent. Integrity
and foreign keys pass. Immediate callback rendering was not observed; completed
authentication and subsequent native operations were verified. Existing aliases
and callbacks remain available. Required workspace and isolated-candidate checks
passed. Evidence: `docs/qa/day-progress-release.md`. Google OAuth approval remains
Ticket 141's separate gate.

Goal: connect the owner's available `cadence-me.com` domain to the existing
Cadence deployments and verify ownership for Google OAuth review. The owner's
2026-09-17 Cloudflare screenshot establishes availability, not working routing
or Google verification.

Scope and acceptance:

- Planned routing: `https://cadence-me.com` to existing Vercel project
  `cadence-marketing`; `https://app.cadence-me.com` to existing project `cadence`.
  Preserve the two-project architecture. Inspect DNS before changing records;
  preserve mail and unrelated records. Verify HTTPS and record rollback steps.
- Inventory canonical URLs, sitemap/metadata, marketing-to-app links, Supabase
  redirects, Google sign-in and separate Calendar callbacks, native broker
  origins, and CORS allowlists. Migrate them together without stranding installed
  desktop clients. Record deliberate handling of old URLs and `www`.
- Verify the root domain in Google Search Console using DNS and a Google account
  with the required Calendar Cloud project ownership. Save sanitized confirmation.
- Configure the Calendar authorized domain and exact callback. Preserve separation
  from the Google sign-in project. Record final URLs in `docs/VERCEL_WORKFLOW.md`
  and `docs/OPERATIONS.md`.
- Verify public pages, web sign-in, Calendar consent, native browser handoff and
  refresh, and old-link compatibility before retiring any existing origin.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing Vercel settings, OAuth routes, and `docs/VERCEL_WORKFLOW.md` |
| Desktop | Broker/auth origin compatibility in `apps/desktop/src/account/`, `apps/desktop/src/calendar/`, and native configuration |
| Marketing | `apps/marketing/src/data/site.ts`, Astro site configuration, and canonical links |
| Future mobile | No implementation; preserve reusable HTTPS endpoint contracts for future clients |

Verification: DNS/certificate readback, Search Console confirmation, redirect and
canonical checks, web/native authentication smoke tests, and affected code checks.
Filing this ticket does not change DNS, hosting, credentials, or OAuth settings.

## Ticket 139: Calendar website copy and privacy disclosure readiness

Status: complete (2026-09-17). Homepage, FAQ, owner-approved Privacy revision,
canonical public links, and Google branding links are published and verified.
Required workspace and isolated-candidate checks pass. Ticket 138 records the
completed OAuth/native compatibility checks; Tickets 140–141 own the
recording and Google review. Evidence: the authorized continuation in
`docs/qa/day-progress-release.md`. Related: Tickets 134 and 137.

Goal: explain optional Calendar access using existing homepage, FAQ, footer,
and canonical legal pages. No site redesign or duplicate legal pages.

Scope and acceptance:

- Homepage placement revised by the owner on September 19: remove the standalone
  hero disclosure and add a fifth “How Cadence works” module. Explain optional
  connectors through their Timeline benefit, using provider-neutral main copy
  and a sanitized static overlap preview. Identify Google Calendar as the first
  read-only connector and retain its pending-public-review status. Keep access,
  selection, editing, and disconnect details in the existing FAQ and Privacy page.
- Add FAQ answers: Is Calendar required? What can Cadence read? Can it change
  Google events? How do I disconnect? Explain same-account consent, global
  disconnect versus sign-out, and offline cache cleanup where relevant.
- Audit the existing Optional Google Calendar privacy section against actual
  access, purpose, storage, sharing, disconnect, deletion, and backup retention.
  Update the provider table's sign-in-only Google description and accurately
  describe hosting/database processing. Check applicable Google Limited Use
  disclosures and link its policy. Do not invent retention or compliance claims.
- Check Calendar-specific facts against current provider settings and the existing
  legal-review process. Preserve the recorded August 31 baseline approvals. The
  owner approved the September 17 Calendar Privacy text and recorded review scope
  for publication. This owner decision supersedes the separate September 17
  new-review publication blocker; record it as owner approval, not an independent
  legal review. Technical, domain, and Google gates remain unchanged.
- Update footer and Google consent-screen links and keep app names and contact
  details consistent. Preserve app-origin canonical `/privacy`, `/terms`, and
  `/trust` per `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`; do not duplicate legal text
  on marketing. Make only relevant Terms corrections.
- Publish capability claims only when verified and available for the stated
  audience. Update existing user-guide, interaction-registry, and design-system
  evidence where implemented links or interactions change.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `components/settings/LegalContent.tsx`, canonical legal routes, and Settings disclosure/link consistency |
| Desktop | Shared Calendar disclosures and Settings legal links; no account-free tracking changes |
| Marketing | `apps/marketing/src/pages/index.astro`, `src/data/faq.ts`, `src/data/site.ts`, and `src/layouts/BaseLayout.astro` |
| Future mobile | No native implementation; verify narrow responsive public pages without claiming a mobile app |

Verification: source-to-copy review, no-login public links, consent-link matching,
keyboard/narrow-layout inspection, marketing check/build, and affected repository
checks. Record final copy and evidence in existing docs. Draft text is not a
publication or provider-compliance claim.

## Ticket 140: Google Calendar verification demonstration video

Status: complete (2026-09-18). Dependencies: Tickets 138–139 and stable live
web/native Calendar flows from 134–137; full Ticket 137 closure is not a prerequisite.

The final 3:35 video is Unlisted at https://youtu.be/vUi5s2B51Uo on brittlebeliefs.
It shows actual verified Cadence branding, separate sign-in/Calendar consent,
both read-only permissions, calendar selection, refresh, timed/two-day event details,
and disconnect. Only the dedicated test identity and harmless events are exposed.
Privacy inspection, full decoding, complete local playback, and unauthenticated
privacy-enhanced YouTube playback pass. YouTube checks found no issues.
The separately labeled final client-ID reference uses an earlier capture of the
same unchanged production client. No consent name was altered or simulated.
The original FFlbGp-_6bE video is superseded for submission. Installed desktop
acceptance is separate QA evidence; desktop shares the hosted Calendar client.
Primary-account restoration passed, including exact equality in all 15 tracking
tables. The dedicated Calendar grant is disconnected. Required candidate checks
pass. Artifact provenance and evidence: `docs/qa/google-calendar-capabilities.md`.

Goal: produce the screen recording required for Google's sensitive-scope review.
Use harmless test events and a plain demonstration, not a promotional film.

Scope and acceptance:

- Prepare a short script showing Cadence's purpose, Google sign-in, separate
  Calendar consent, calendar selection, refresh, and Timeline events. Demonstrate
  each requested permission's use. Include installed desktop browser handoff
  where needed to explain the submitted client experience.
- Capture the actual flow in English with the correct app name and OAuth client
  ID visible in the consent browser address bar. Exclude secrets, access/refresh
  tokens, private event content, unrelated tabs, and notifications.
- Show preview/details and disconnect using a controlled test calendar. Inspect
  the complete recording before uploading it to YouTube as unlisted.
- Create a dedicated Gmail identity for demonstration and ongoing Cadence tests.
  Use only a known name and harmless test calendars/events. Do not invent personal
  details or reuse a password. A human must choose the password, complete any
  verification, and accept account terms.
- Identify and record the destination YouTube channel before any unlisted upload.
  Do not assume the signed-in Google account owns the intended channel.
- Verify reviewer access to the unlisted link. Record the script, local artifact
  reference, video URL, demonstrated build, and covered scopes in the existing
  Calendar QA records. A script or planned recording does not complete this ticket.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Record actual consent, selection, and Timeline controls from Tickets 134–135 |
| Desktop | Record the installed handoff/read-only flow when needed; no runtime changes |
| Marketing | Use final homepage/privacy links from 139; no new marketing video embed |
| Future mobile | Not applicable: no native mobile app is part of this submission |

Verification: complete playback, readable consent/client identity, demonstrated
scope use, privacy inspection, and unlisted-link access. Recheck Google's current
video requirements before recording. Filing this ticket uploads nothing.

## Ticket 141: Google Calendar verification submission and review follow-up

Status: in_progress. Dependencies: Tickets 138–140 and relevant technical evidence
from 134/137. Full Ticket 137 closure is not a prerequisite; this ticket supplies
its public-verification evidence.

September 20 follow-up: Google Verification Center reports data access verified.
Data Access marks `calendar.events.readonly` verified. The unchanged production
broker client and all three declared scopes match the submitted configuration.
Branding remains verified. Ticket 141 remains in progress until post-approval
web/native consent smoke checks pass. Public rollout gates remain unchanged.
See `docs/qa/google-calendar-capabilities.md` for sanitized evidence.

September 18 submission checkpoint: Google accepted the final data-access
submission at 10:52 EDT for `cadence-calendar-498717`. Verification Center reports
under review, and Trust and Safety confirms form receipt. The submitted video is
https://youtu.be/vUi5s2B51Uo; additional information accurately identifies its earlier
client-ID reference. Branding is verified and published. The three declared scopes
remain unchanged; no write/restricted scopes were requested. Google has not approved
Calendar data access. Ticket completion still requires that approval and the
post-approval consent smoke checks. Emiliano Bache Rodriguez monitors the unchanged
support/developer inbox. A daily 09:00 local task follow-up checks Verification
Center and stays quiet without meaningful changes; it does not monitor the inbox.

Goal: submit the separate Calendar OAuth project for brand/data-access review,
answer reviewer questions, and record Google's actual decision.

Scope and acceptance:

- Prepare final justification for each scope: OpenID associates consent with the
  signed-in identity; calendar-list read-only supports calendar choice; events
  read-only supplies displayed event context. Explain why narrower access cannot
  provide the feature. Request no write or unrelated scopes.
- Check final branding, verified domains, public links, exact callbacks, scopes,
  and reviewed video. Keep the Google sign-in project separate.
- Confirm the support/developer inbox and identify who monitors it. The current
  configured contact remains `info@identityscaffolding.com` by owner decision.
  The owner named Emiliano Bache Rodriguez as the human monitor on September 17,
  2026. Record reviewer requests and
  responses without copying private messages or credentials into git.
- Follow Google's current branding and data-access submission sequence. Record
  project, submission date, requested scopes, review state, and required follow-up.
- Complete only when Google's approval covers the actual production client and
  scopes, and the approved public configuration passes consent smoke tests.
  Submission or Testing-mode status is not approval.
- Keep public rollout subject to remaining Ticket 137 technical acceptance.
  Provider approval cannot close native/provider test gaps or replace Ticket 115's
  separate Apple-trust requirements. Update existing QA records and `STATUS.md`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Dedicated Calendar OAuth project, `docs/OPERATIONS.md`, and live consent evidence |
| Desktop | Existing hosted Calendar broker shares the reviewed grant; installed handoff smoke check required |
| Marketing | Identity/privacy links from 139; no unearned Google-approval claim |
| Future mobile | Not applicable: future clients/scopes require their own applicability review |

Verification: actual Google decision and console status, matching production
client/scopes, public links, and web/native smoke evidence. Recheck requirements:

- <https://support.google.com/cloud/answer/13804266?hl=en>
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>
- <https://developers.google.com/terms/api-services-user-data-policy>

### Shared planning verification for Tickets 138–141

Run `npm run agents:check`, `npm run interactions:check`,
`npm run resolvers:check`, and `git diff --check` for the ticket-only addition.
Execution requires each ticket's stated acceptance and applicable code/provider
checks. Native/provider/Workspace coverage remains under Tickets 134–137;
these follow-ups do not change their status or duplicate their test matrices.


## Ticket 142: Default Behavior duration

Status: complete in source; web production deployed September 18, 2026.
Evidence: `docs/qa/behavior-planning-fields.md`. Installed-native release
acceptance remains pending under the desktop release workflow.

Goal: let users set an optional default duration when creating or editing a Behavior.

Scope and acceptance:

- Accept a whole number of minutes from 1 through 1,440; blank means no default.
- Store the value separately from tracked time and measured averages.
- Timeline uses the explicit default when present; otherwise retain the existing
  estimate from completed, stopped Occurrences. Clearly label the source.
- Preserve values through web/desktop edits, archive/restore, synchronization,
  and full-data/BehaviorLog portability. Older records default to null.
- Validate at form and persistence boundaries. Cover invalid values, clearing,
  measured-average isolation, and Timeline duration precedence.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared Behavior form, core services, Postgres migration, Timeline context |
| Desktop | Shared form/context, SQLite adapter, synchronization and portability |
| Marketing | No runtime change; existing tracking claims remain accurate |
| Future mobile | No implementation; shared optional field available to a future client |

Verification: required repository checks, database/SQLite contracts, responsive
form and Timeline QA, and fresh independent review. Existing measured-time
analytics must retain their current results.

## Ticket 143: Scheduled Behavior archive and notification

Status: complete in source; web production deployed September 18, 2026.
Evidence: `docs/qa/behavior-planning-fields.md`. Installed-native release
acceptance remains pending under the desktop release workflow.

Goal: let users choose an optional end date that automatically archives a Behavior
and notifies them when archiving occurs.

Scope and acceptance:

- End date is the first archived day, beginning at local midnight in the Behavior
  timezone. The form explains this boundary. Blank means no scheduled archive.
- Do not generate Occurrences on or after that date. Preserve historical records,
  resolved Occurrences, Notes, and tracked time during reconciliation.
- Reuse atomic archive/history/configuration writes and cancel pending reminders.
- Hosted processing and foreground reconciliation archive due Behaviors. Desktop
  reconciles on launch/resume/day change; no closed-app background helper.
- Retain a durable, accessible in-app archive notification, including after an
  offline interval or denied OS notification permission.
- Preserve the date and automatic-archive marker through synchronization and
  portability. Restoring clears an expired end date to prevent immediate rearchive.
- Cover local midnight, DST, retries, concurrent edits, reminder cancellation,
  offline catch-up, and notification rendering.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared form, hosted processing, archive services, Timeline/Behaviors notice |
| Desktop | Shared rules, local lifecycle reconciliation, durable notice and SQLite |
| Marketing | No runtime change; user-guide copy documents the boundary |
| Future mobile | No implementation; shared lifecycle contract available to a future client |

Verification: required repository checks, clean migrations, owner isolation and
atomicity contracts, desktop contracts, responsive UI QA, and fresh independent
review. Release evidence must distinguish source verification from deployed behavior.

## Ticket 144: Service integration playbook and reusable integration brief

Status: complete (September 18, 2026). Documentation only.
Deliverable: `docs/INTEGRATION_PLAYBOOK.md`. Required documentation checks pass;
fresh independent review returned `ship`. Current summaries are reconciled;
historical checkpoints and remaining Calendar release gates are preserved.

Goal: turn the Google Calendar integration lessons into instructions future agents
can use when integrating another service with Cadence.

Dependencies and evidence:

- Use Tickets 132–141, `docs/EXTERNAL_EVENT_CONTRACT.md`,
  `docs/qa/google-calendar-capabilities.md`, `docs/qa/day-progress-release.md`,
  and the latest `STATUS.md` checkpoints. Open Calendar acceptance gates do not
  block this documentation; distinguish verified results from remaining gaps.
- Inspect the shared external-event types, validation, scheduling projection,
  provider/service adapters, desktop coordinator/cache, and their contract tests.
- Reuse `docs/SERVICE_CONNECTIONS.md` and provider runbooks for operational setup.
  Keep runtime product connections distinct from agent access to provider accounts.

Scope and acceptance:

- Create `docs/INTEGRATION_PLAYBOOK.md`, with one reusable integration brief
  inside it. Link it from `AGENTS.md` and `docs/OPERATIONS.md`.
- Tie each lesson to evidence. Cover native CSP/transport/callback failures,
  stale responses, account-switch isolation, partial reads, and public-release
  prerequisites. Label proposed improvements separately from observed outcomes.
- Require the brief to name the user benefit, data direction, account mapping,
  source of truth, read/write authority, platform impact, and explicit exclusions.
- Require capability research before scope commitments: provider fields,
  missing-value meanings, permissions, limits, revocation effects, and release
  requirements. Distinguish documented support, fixture evidence, and live proof.
- Specify operation inputs/results, runtime validation, schema compatibility,
  identity/provenance, freshness/coverage, errors, bounded retries, and side effects.
  Reuse existing domain models where meanings match. Do not force unrelated
  service data into the Calendar event model or create a generic plugin framework.
- Define credential custody, data minimization, retention/export exclusions,
  connect/cancel/refresh/reconnect/disconnect/deletion behavior, and account-switch
  cleanup. Fence obsolete account, connection, selection, and range responses.
- Require an early consent → bounded read → render → disconnect slice on web
  and installed desktop. Include offline restart, failure recovery, cancellation,
  cross-account isolation, and data-preservation evidence where applicable.
- Identify domain, disclosure, test-account, demonstration, provider-review, and
  deployment dependencies early. Carry forward existing authorization; request
  only missing authority or human-only actions with the exact target and purpose.
- Define separate evidence for source checks, native runtime, live provider,
  deployed behavior, and public approval. Include rollback and cleanup ownership.
- Reconcile stale Calendar status summaries against dated evidence in the existing
  docs. Preserve historical checkpoints and unverified gates. Keep `STATUS.md`
  as the current ledger; do not create another status or decision inventory.
- Demonstrate the brief using Calendar, including its remaining gaps. Do not
  connect a second provider, change runtime code, or mark Calendar gates complete.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Documentation for existing services, API routes, ownership, and release evidence; no runtime change |
| Desktop | Document existing broker/cache and installed lifecycle checks; no package or storage change |
| Marketing | Document capability/disclosure readiness; no new public capability claims or publication |
| Future mobile | Require an explicit future-client impact entry; no implementation |

Verification: review every lesson and code reference against current evidence.
Run the shared documentation checks below. Completion delivers the playbook and
brief, not another integration or a new product capability.

## Ticket 145: First external consumer and Cadence access contract planning

Historical planning scope: the September 20 owner correction supersedes the
external-consumer assumption below. The plan at the same path and Tickets 146–148
now define the in-app horse briefing. This ticket preserves its dated completion.

Status: complete (September 18, 2026). Planning only.
The revised documentation checks pass; fresh independent review returned `ship`
with no findings.
The owner selected Cadence Daily Brief and approved connected, authenticated,
read-only advice using Cadence and authorized connector context, including Calendar.
The revised proposal is `docs/plans/first-external-consumer.md`; accepted scope is
recorded in `docs/DECISIONS.md`. Tickets 146–148 cover bounded implementation.
Future writes are intended but separately scoped. No live transmission is authorized.

Goal: define one concrete consumer of Cadence data and the smallest interface
needed to support it, informed by the owner's future daily planner/coach direction.

Dependencies and evidence:

- Use Ticket 144's brief before finalizing the proposal. Consumer discovery can
  begin independently. No new provider access or Google approval is needed to plan.
- Read `docs/PRODUCT_SPEC.md`, `docs/FUTURE_UPDATES.md`, `docs/DECISIONS.md`,
  `docs/EXTERNAL_EVENT_CONTRACT.md`, `docs/EXPORT_FORMATS.md`,
  `docs/AGENT_RESOLVERS.md`, and `docs/ROUTE_MAP.md`.
- Inspect existing services, BehaviorLog portability, and the minimal scheduling
  projection before proposing new interfaces. Current event schema/source values
  are Google-specific; internal contract readiness is not public API/MCP support.

Scope and acceptance:

- Use the brief to propose one named consumer, its user, invocation context,
  concrete use case, required data, and example request/result. Obtain the owner's
  consumer choice before treating it as an accepted implementation target.
- Distinguish services supplying Cadence from external clients consuming Cadence.
  Identify any inbound connector dependency without inventing a second provider.
- Define what the consumer may observe, suggest, and execute separately. Keep
  reading context, proposing a schedule, and applying changes as distinct powers.
- Map each required fact to an existing contract/service or a documented gap.
  Cover Behaviors, Occurrences, duration source, external scheduling facts,
  ownership, provenance, uncertainty, and freshness only as the use case requires.
- Compare existing export, a bounded authenticated API, and an MCP adapter.
  Recommend the smallest sufficient option and explain when another is needed.
  Any future transport must use existing services and shared domain rules.
- Specify authentication, per-account authorization, consent, minimum data,
  retention, revocation, operation bounds, versioning, and stable failure results.
  Treat external text as data; do not grant model access merely because Cadence
  can read it. Exclude rich event details unless the use case justifies them.
- If writes are proposed, define preview/approval, stale-data revalidation,
  idempotency, audit/history, and conflict behavior. Calendar access or busy/free
  facts cannot authorize event edits or automatic Behavior status changes.
- Record explicit proposed changes to current coaching/rearrangement boundaries.
  Update product decisions/specification only after the owner accepts those changes.
  Ticket creation itself does not remove current exclusions.
- Deliver one proposal at `docs/plans/first-external-consumer.md`, with examples,
  acceptance scenarios, unresolved decisions, and bounded follow-up ticket scopes.
  Accepted decisions belong in `docs/DECISIONS.md`; the proposal is not a parallel
  source of product truth. Create execution tickets only for accepted scope.
- Do not implement endpoints, an MCP server, model calls, schedule writes, new
  connectors, credentials, or a generic integration framework in this ticket.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Map proposed access to existing services/resolvers and auth boundaries; implementation requires a follow-up ticket |
| Desktop | Specify local-only versus linked-account availability and offline/freshness limits; preserve account-free tracking |
| Marketing | Not applicable to runtime; publish no API, MCP, or coaching claims from a planning proposal |
| Future mobile | Review shared contract compatibility only; no client implementation |

Verification: trace each proposed operation to an owner and contract. Include
examples for denied access, incomplete/stale context, account changes, and any
proposed write conflicts. Run the shared documentation checks below. Completion
requires the owner's consumer choice and scope decision; unresolved choices remain
explicit and cannot silently become execution authority.

### Shared documentation verification for Tickets 144–145

Run `npm run agents:check`, `npm run interactions:check`,
`npm run resolvers:check`, and `git diff --check` for documentation-only work.
Use the existing interaction registry and design-system catalog as evidence;
do not register proposed interactions as implemented. Record why runtime tests
and builds were not rerun when no runtime files changed.

## Ticket 146: Minimal advisor day-context contract and read service

Status: complete in source (September 20, 2026). Revised history, fences, clean
SQL replay and all required checks passed; fresh independent review returned `ship`.
Evidence: `docs/qa/in-app-daily-brief.md`.
Filed September 18, 2026. Dependency: Ticket 145, corrected by the September 20 decision.

The September 19 contract, snapshot/revision RPCs, Calendar subsets and admission
limits passed source/SQL checks and independent review. Preserve that dated evidence
in `docs/qa/advisor-read-only.md`. It does not complete the revised acceptance below.

Goal: supply validated current-day facts and bounded completion history to Cadence's
in-app briefing. `docs/plans/first-external-consumer.md` now holds the corrected plan.
No model call, UI implementation, delegated credential or public read API belongs here.

Scope and acceptance:

- Reuse existing core projection/validation, repository snapshot/revision reads,
  duration rules and Calendar subset service. Keep consistent owner-scoped reads.
- Add bounded per-Behavior Completed, Not Completed and Unresolved aggregates with
  explicit lookback dates and completeness. Reuse analytics/status rules; exclude
  Unresolved from final adherence. Completed-only duration samples are not adequate
  completion history. Preserve raw history and sessions inside the service.
- Use the existing 90-complete-local-day maximum lookback and history ceilings.
  Capped samples produce unknown/incomplete facts, never biased totals or estimates.
- Keep opaque references, source observation/revision, current-day bounds, duration
  provenance and Calendar completeness. Exclude Notes, rich Calendar fields,
  credentials and raw account/provider identifiers. Treat text as untrusted data.
- Replace external-client grant assumptions with server-owned first-party account
  and briefing-disclosure fences. Keep owner isolation and before-delivery checks
  for account, timezone, source, connector selection/connection and disclosure changes.
- Retain bounded reads, record/byte limits, shared admission and the 30-second read
  deadline. Reject overflow. Reuse existing conservative Calendar interval rules.
- Read persisted records without Timeline/export generation or archive side effects.
  Return incomplete/recovery states when normal app maintenance has not caught up.
  Prove zero tracking, reminder and provider-event writes; document operational writes.
- Add migrations/types/data-model changes only if required by the revised snapshot.
  Validate every new field and synthetic fixture; preserve existing callers.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend `packages/core/src/services/advisor-day-context.ts`, `lib/db/advisor-context.repo.ts` and `lib/services/advisor-day-context.service.ts`; Ticket 147 connects generation. |
| Desktop | Reuse shared contracts and preserve Calendar callers; Ticket 148 consumes hosted context in the linked-account horse bubble. Local-only AI remains deferred. |
| Marketing | Not applicable: internal data work provides no public capability claim. |
| Future mobile | Shared validation only; no native client implementation. |

Verification: all required repository checks, all-status history and cap fixtures,
owner isolation, revision races, Calendar semantics, zero-source-write assertions,
and clean SQL replay where changed. Update resolver ownership for actual changes.

## Ticket 147: First-party briefing generation and model-data controls

Status: in_progress for release acceptance. Source implementation, required
checks and fresh independent review (`ship`) completed September 20, 2026.
Hosted/live-data/installed-desktop gates remain in `docs/qa/in-app-daily-brief.md`.
Filed September 18, 2026. Dependencies: revised Ticket 146 and September 20 decision.

The old disabled endpoint is implemented, but it is not the target interface.
External-token isolation is no longer a prerequisite. Preserve its historical
finding in `docs/qa/advisor-auth-isolation.md`; do not enable delegated OAuth.

Goal: generate a briefing inside Cadence using existing sign-in and a server-side
OpenAI `gpt-5.6-luna` adapter, behind provider-neutral facts/result contracts.

Scope and acceptance:

- Implement `POST /api/advisor/brief` as one first-party operation. Derive owner and
  local day from verified sign-in. Reuse web session checks and the linked-desktop
  authenticated broker path; preserve RLS and existing Keychain handling.
- Apply web origin/CSRF checks, exact desktop broker origins, safe errors,
  `no-store`, item/output limits, account-wide rate limits and one in-flight
  generation. Reject owner overrides, arbitrary prompts/URLs and unknown fields.
- Reuse Ticket 146 directly. Replace or retire the old GET adapter and external
  consumer path; do not make the server call its own HTTP API. No external OAuth
  client, new advisor login, delegated token or public MCP endpoint is required.
- Implement first-party enablement and revocable model-data disclosure for the
  briefing purpose, minimum fields and optional selected Calendar facts. Use
  existing Settings/account patterns. Do not ask for approval of prewritten or
  generated briefing text. Calendar display permission remains distinct from
  disclosure to the model. Revised destination/fields cannot silently inherit consent.
- Use one small generation adapter: validated facts in, validated briefing out.
  OpenAI Luna 5.6 is selected; do not substitute a model. Provider SDK types stay
  out of core/UI. No multi-agent framework, provider registry or tool runtime.
- Keep API keys server-only. The model receives no user session, Google credential,
  database client or mutation tool. Model text cannot fetch extra data or execute
  source changes. Validate output, source references, length and zero applied changes.
- Bound the complete read-plus-generation attempt to 60 seconds, each phase at
  most 30 seconds. Deduplicate automatic daily requests across remounts/tabs and
  prevent retry loops. Define operational cache/admission/disclosure retention
  before activation. Do not store prompt history or log content by default.
- Revalidate session, disclosure, account and source state before model submission
  and before delivery. Disablement, account switch/deletion and Calendar changes
  invalidate pending results. External retention cannot be retroactively recalled.
- Verify actual OpenAI model/account access and applicable retention/deletion terms,
  Google onward-use requirements, secrets and exact live-test authority. These are
  deployment/live-test gates, not reasons to rebuild an external identity system.
- Any persistence change needs migrations/types/data-model updates, owner tests,
  clean local replay and rollback. Register controls only when implemented.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `lib/services/daily-brief.service.ts`, briefing routes and `DailyBriefSettingsPanel` implement authenticated generation and disclosure controls. |
| Desktop | Existing linked-account authentication calls the hosted service; no embedded OpenAI key or new advisor credential. Ticket 148 verifies presentation and offline limits. |
| Marketing | No runtime claim; record provider/retention disclosure requirements before separately authorized publication. |
| Future mobile | Neutral contracts only; native authentication/UI are not applicable to this ticket. |

Verification: all required checks, two-account session isolation, unauthorized
zero-read tests, request forgery/replay/duplicate tests, prompt injection, output
validation, timeouts, disclosure/source races, and zero-source-write checks.
Live provider access and deployment require their own recorded evidence.

## Ticket 148: In-app horse briefing and read-only acceptance

Status: in_progress for release acceptance. Source implementation, required
checks and fresh independent review (`ship`) completed September 20, 2026.
Hosted/live-data/installed-desktop gates remain in `docs/qa/in-app-daily-brief.md`.
Filed September 18, 2026. Dependencies: revised Tickets 146–147.

The earlier synthetic external consumer is not acceptance of this flow. The owner
explicitly corrected the destination, automatic invocation and meaning of inputs.
OpenAI Luna 5.6 and Cadence-hosted generation replace the open host/model choice.

Goal: show an AI-written daily briefing in a text bubble emerging from the existing
horse when the user first opens Cadence. The user can dismiss or ignore the bubble.

Scope and acceptance:

- Connect app opening → bounded facts/history/Calendar read → model generation →
  horse-bubble display. No separate advisor app, manual Generate prerequisite,
  prewritten-summary approval or per-briefing acceptance step.
- Use the existing Timeline horse on web and desktop. Preserve current spacing,
  type, square corners, colors and navigation. No general chat screen, audio speech,
  modal interruption or new model-controlled actions.
- Planning default: once per account/local day per app installation, with same-day
  dismissal across navigation/reopening. Test account/date changes and server
  deduplication. No cross-device dismissal sync is implied. Failed attempts allow
  deliberate retry; no polling or background helper.
- Keep loading, empty, error, unavailable and partial states nonblocking. A dismissed
  in-flight result cannot reopen the bubble. The user can ignore the bubble and
  operate Timeline controls normally. Dismissal changes presentation only.
- Show model-written text, including priorities, timing or suggested changes when
  facts support them. Include source time and uncertainty. Expired or incomplete
  context cannot imply current free time. Never apply a suggestion or mark a status.
- Provide keyboard dismissal, accessible naming, visible focus, polite announcement,
  readable wrapping/contrast and reduced motion. Test desktop and narrow mobile web,
  long text and content growth without obscuring tracking controls.
- Linked online desktop uses the same hosted model boundary. Disclose absent
  unsynced/local-only data; unavailable AI never disables account-free/offline
  tracking. Local-only AI and a new synchronization mechanism remain deferred.
- Adapt or retire synthetic consumer tests as needed. Test completion-history
  interpretation, unknown/capped history, all Calendar states, prompt injection,
  invalid/long model output, freshness/disclosure races and duplicate opening.
- Use existing interaction/design catalogs. Add implemented enablement, automatic
  invocation, dismissal and retry intents in the same runtime change. Invoke
  Impeccable and design-system-bench before reusable UI work; do not invent a second
  decision inventory. Update DESIGN.md from actual code after implementation.
- Record source, synthetic, deployed, live model/provider, installed desktop and
  public evidence separately. Define disablement, operational cleanup and rollback;
  verify zero tracking/provider-event changes. Preserve separate release gates.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Add bubble/invocation to `app/(app)/timeline/page.tsx` through shared UI and Ticket 147; verify responsive web and existing Timeline actions. |
| Desktop | Add equivalent bubble/invocation to `apps/desktop/src/timeline-screen.tsx`; verify linked current/unsynced/offline states and native lifecycle. |
| Marketing | No public AI claim from this implementation. Publication follows live release acceptance. |
| Future mobile | Native implementation is not applicable; shared contracts and mobile web remain in scope. |

Verification: all required repository checks, synthetic end-to-end and responsive
browser/accessibility QA, installed-desktop evidence, and separately authorized
live-model acceptance. Synthetic success does not establish deployed/live status.


## Ticket 149: Calendar inspection polish and Timeline reload

Status: complete in source (September 18, 2026). Required checks, responsive
synthetic browser QA, and fresh independent review (`ship`) pass.
Evidence and live/native limits: `docs/qa/calendar-inspection-refresh.md`.

### Scope and acceptance

- Use owner-selected Poline facet `#DA3278` for a thin overlap border and solid 1px event-duration axis segment, with no glow.
- Align the bottom preview close icon with the event title while preserving its 44px target.
- Open explicit View details in a centered, bounded native modal. Keep quick previews in reserved bottom space.
- Identify Google Calendar event markers with its provider icon.
- Remove the healthy Calendar current label; retain actionable freshness/failure states.
- Reload Cadence and connected Calendar data with a deliberate desktop upward overscroll at the top, or mobile pull.
- Confirm successful completion with temporary feedback. Retain data and report failed or partial refresh honestly.
- Preserve manual statuses, focus restoration, offline local tracking, and normal scrolling.

### Platform impact

- Web: shared Timeline/details/CSS and refresh wrapper; INT-TIMELINE-010 and INT-CALENDAR-005/006/007.
- Desktop: shared presentation, bundled provider asset, and native product refresh callback.
- Marketing: not applicable; this changes authenticated/local tracking controls only.
- Future mobile: native implementation remains deferred; responsive web shares the presentation and touch refresh contract.

Use the existing interaction registry and design-system Timeline family for evidence.
No schema, new connector, or provider permission change.


## Ticket 150: Calendar display names and compact selection

Status: in_progress (September 20, 2026). Implementation and focused/browser QA
passed; repository acceptance awaits concurrent Daily Brief test/build repairs.
Evidence: `docs/qa/calendar-selection.md`.

- Request and prefer Google's per-user `summaryOverride`, falling back to `summary`.
  Preserve calendar IDs, readable-role filtering, pagination, and account scope.
- Replace the tall calendar cards with one multi-select field. Show selected
  calendars as wrapping tags; expand a searchable, bounded checkbox list.
  Preserve per-calendar Timeline visibility and explicit Save semantics.
- Refresh Calendar reloads available calendars even with no saved selections.
  Preserve drafts and distinguish list failures from successful refreshes.
- Verify provider mapping, selection/visibility/save behavior, empty/error states,
  keyboard access, long names, and narrow responsive layouts.

Platform impact: web and desktop share `GoogleCalendarPanel.tsx` and the hosted
provider adapter. Marketing is not applicable because this is authenticated
Settings. Future native mobile stays deferred; mobile web is responsive.
Use INT-CALENDAR-002/003 and the existing Settings design-system family.
No schema, OAuth scope, provider event mutation, or deployment is required.

## Ticket 151: Briefing configuration contract and saved presets

Status: complete.
Filed September 20, 2026. Dependencies: source contracts from Tickets 146–148.

Goal: replace fixed briefing choices with a small, provider-neutral configuration
that the internal workbench can edit and compare.

Scope and acceptance:

- Define a versioned, validated configuration for tone, directness, encouragement,
  length, briefing priorities, allowed suggestion types and number of alternatives.
  Include bounded scope controls for Behavior selection, history window and optional
  Calendar context. Preserve the current briefing as the default preset.
- Keep policy separate from presentation. Tone or free-text guidance cannot relax
  authentication, disclosure, freshness, output limits or read-only rules.
- Scope only narrows server-authorized data. Calendar inclusion still requires
  separate disclosure. Behavior selection must resolve within the signed-in owner;
  repository presets must contain no real account IDs or private Behavior content.
- Support shorter history windows within the existing 90-complete-local-day ceiling.
  Apply the selected window before aggregation; never relabel a 90-day total as
  shorter history. Preserve completeness and separate manual statuses.
- Store canonical presets as versioned repository data. Workbench drafts contain
  configuration only. Do not introduce a settings database, provider registry,
  per-user admin roles or a generic agent framework for this internal tool.
- Reject unknown fields, unsupported versions and out-of-range values. Keep the
  selected model behind the existing adapter; the configuration contains no SDK
  types, credentials, provider URL or caller-supplied system prompt.
- Integrate prompt construction through `lib/services/daily-brief-consumer.ts` and
  the shared facts contract. Preserve source fences and existing bounded generation.
  Production activation belongs to Ticket 155.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend shared daily-brief types/context assembly and `daily-brief-consumer.ts`; Ticket 154 exposes workbench controls. |
| Desktop | Reuses neutral types and hosted generation after Ticket 155; no separate native configuration editor. |
| Marketing | Not applicable: internal configuration provides no new public claim. |
| Future mobile | Neutral contracts remain reusable; native UI remains deferred. |

Verification: default-preset compatibility, exact validation, scope intersection,
history-window/cap fixtures, prompt injection and zero-source-write tests. Run all
required repository checks. Update resolver ownership for any new pure owner.

Implementation and provider-free verification: `docs/qa/briefing-workbench.md`.
Independent source review accepted this implementation. Ticket 155 retains live
quality, hosted and installed desktop acceptance gates.

## Ticket 152: Curated briefing references and verifiable citations

Status: complete.
Filed September 20, 2026. Dependency: Ticket 151.

Goal: let the workbench select research and guidance that can support briefing
suggestions, with inspectable provenance and bounded model input.

Scope and acceptance:

- Begin with an explicit curated catalog of research/guidance records. Each record
  has a stable ID, title, source URL, publication date when known, review date,
  bounded excerpt or summary, applicability and limitations. Distinguish research
  evidence, interpretation and editorial suggestion guidance.
- Store only material permitted for repository distribution. Keep private documents
  and account facts out of the catalog. No live web search, arbitrary URL fetching,
  uploads, vector database or autonomous research is required for this slice.
- Select references explicitly by catalog ID through Ticket 151 configuration.
  Bound reference count and total bytes within the generation budget. Missing,
  withdrawn or unsuitable references produce explicit omission/rejection reasons.
- Treat reference text as untrusted data. It grants no tools, instructions, new
  account scope or authority over scheduling constraints. Source absence must not
  turn unsupported advice into a research-backed claim.
- Extend structured results with references to supplied catalog IDs. Validate IDs
  and map them to trusted catalog metadata; never render a model-invented URL.
  The workbench exposes which sources support each suggestion and the underlying
  excerpts. Human review assesses support; ID validity alone does not prove it.
- Define source-review/withdrawal behavior. Changing the selected reference set or
  content revision invalidates pending comparisons. Record the version used in
  each in-memory result. Production source presentation follows Ticket 155.
- Reuse the existing provider-neutral generator and output validation. No new model
  service or model-controlled retrieval path is needed.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Add bounded catalog selection beside `daily-brief-consumer.ts`; extend shared result types and Ticket 154 preview. |
| Desktop | Ticket 155 carries validated source metadata through the existing hosted client and shared bubble. No native research service. |
| Marketing | Not applicable: catalog entries are not publication of product efficacy claims. |
| Future mobile | Shared reference/result contracts only; native retrieval and UI are deferred. |

Verification: missing/withdrawn sources, byte/count bounds, unsupported citation
IDs, hostile reference instructions and absent evidence. Review synthetic advice
against its actual cited excerpts. Run required repository checks; update the
existing interaction/design catalogs only when source controls are implemented.

Implementation and provider-free verification: `docs/qa/briefing-workbench.md`.
Independent source review accepted this implementation. Ticket 155 retains live
quality, hosted and installed desktop acceptance gates.

## Ticket 153: Deterministic briefing planner and suggestion routing

Status: complete.
Filed September 20, 2026. Dependencies: Ticket 151 and Ticket 146 context contracts.
Ticket 152 is required only for research-backed explanations.

Goal: generate inspectable, read-only scheduling options under explicit constraints
before the model writes the briefing.

Scope and acceptance:

- Add a pure planning resolver under `packages/core/src/resolvers`, with injected
  time and typed facts/configuration. Reuse existing duration, Temporal day-boundary,
  Calendar interval and status rules. Services own reads; UI owns no planning logic.
- Support fixed commitments, explicitly movable Behavior occurrences, permitted
  windows, duration assumptions, buffers and bounded scheduling preferences.
  Treat Calendar events as fixed context. Exact Behavior schedules remain fixed
  unless the planning input explicitly marks them movable for a hypothetical option.
- Define bounded candidate generation and deterministic ranking/tie-breaking.
  Configuration adjusts priorities and tradeoffs, not validity. No unbounded
  optimizer, multi-agent router or separate planning service is required.
- Route to one of: recap, priority suggestions, validated scheduling options, or
  insufficient-context explanation. Route from evidence and policy, not tone.
  Partial/stale Calendar coverage or unknown required duration cannot prove a free
  slot. Preserve all-day, tentative, declined and transparent-event meanings.
- Return structured proposals with source occurrence references, current/proposed
  intervals, checked constraints, assumptions, reasons and rejection explanations.
  Include explicit no-feasible-option and no-change results. Cap option counts.
- The model may explain supplied options but cannot invent executable moves.
  Validate that any structured scheduling recommendation refers to a valid supplied
  option. Withhold invalid output rather than silently applying or repairing it.
- Preserve source/configuration revisions and expiry. Never update a schedule,
  status, Note, reminder, sync record or Calendar event. A future Apply action needs
  separate operation, authorization, conflict and audit tickets.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Proposed `packages/core/src/resolvers/briefing-plan.resolver.ts`, service orchestration and Ticket 154 inspector; register ownership in `docs/AGENT_RESOLVERS.md` when implemented. |
| Desktop | Shares neutral proposal contracts; Ticket 155 uses hosted planning and discloses absent unsynced/local-only facts. No local planner UI or write path. |
| Marketing | Not applicable: hypothetical scheduling options do not establish automated rescheduling capability. |
| Future mobile | Pure planning contracts may be reused later; native implementation is deferred. |

Verification: deterministic ranking, immovable conflicts, buffers, unknown duration,
partial/stale sources, no feasible slot, DST/overnight/day boundaries, status handling,
revision invalidation and zero writes. Pair every resolver with tests and run all
required repository checks.

Implementation and provider-free verification: `docs/qa/briefing-workbench.md`.
Independent source review accepted this implementation. Ticket 155 retains live
quality, hosted and installed desktop acceptance gates.

## Ticket 154: Internal briefing workbench and comparison previews

Status: complete. My account comparisons, the contract glossary and repository document access passed required checks and independent review.
September 21 output follow-up: an owner-clicked local comparison rendered two
validated account briefings side by side. A previous attempt withheld one output;
its exact rejection remains unverified. Pipeline 1.1 removes the hard-coded
120-word prompt limit in favor of each configuration's combined word budget.
All required checks pass; independent review of this correction returned `ship`. See
`docs/qa/briefing-workbench.md`; hosted and installed release gates remain open.
Filed September 20, 2026. Dependency: Ticket 151. Add reference and planning controls
as Tickets 152–153 land; unavailable controls must not pretend to work.

Goal: adjust briefing dimensions and compare real generated outputs against the
same frozen synthetic or signed-in account facts inside the existing development design bench.

Scope and acceptance:

- Extend `app/design-system/DailyBriefBench.tsx` and the existing `/design-system`
  preview mechanism. This is an internal development surface, not a new customer
  dashboard, general chatbot or expansion of ordinary Settings.
- Provide grouped controls for voice, scope, references, suggestion options and
  planner policy. Load, duplicate, edit, compare and export validated configuration
  presets. Saving a workbench draft never activates it for daily users.
- Freeze one authorized snapshot for a comparison. Synthetic mode uses fixed fixtures;
  My account mode uses the signed-in owner and existing revocable model-data consent.
  Read Cadence and optional disclosed Calendar once per comparison. Apply history
  windows before aggregation and intersect Behavior scope with that snapshot.
  Hold its injected planning clock, facts
  and source revision constant; show intentional scope differences separately.
  Display configuration, reference, planner and model versions for each result.
  The same inputs do not imply deterministic model wording.
- Reuse the actual generator, validation, planner and `DailyBriefBubble`; do not
  create a second prompt implementation. Clearly distinguish static fixtures from
  model-generated previews and failed attempts from successful results.
- Require an explicit Run comparison action. Bound concurrency, attempts, output,
  duration and cost exposure; cancel/discard superseded results. Do not generate
  while dragging controls, loading a preset or opening the bench.
- Keep server credentials server-only. A development-only generation boundary must
  reject production execution and untrusted origins. Accept known synthetic fixture
  IDs or an explicit My account mode with validated configuration, never arbitrary
  prompts, URLs or caller-selected owners. Account mode requires current sign-in,
  briefing enablement and separate Calendar disclosure. It must never consume
  production daily-attempt state. Synthetic mode must never read account/provider data.
- Compare horse-bubble previews beside an inspector for effective facts, included
  references, planner options/rejections and output-validation results. Permit
  qualitative review notes without pretending to offer an objective quality score.
- Provide a searchable glossary for workbench settings and statuses. Give each term
  a stable ontology ID, related terms and traceable contract symbols. Keep distinct
  meanings separate even when their displayed values match. Check contract coverage.
- Expose canonical preset and reference JSON documents for inspection and repository
  editing, alongside links to original reference sources. Explain version updates
  and the difference between repository changes, comparison drafts and hosted rollout.
- Keep outputs and facts in memory. Persist/export only configuration by default;
  no prompt-history store or automatic telemetry. Account-specific scope selections
  also stay in memory. Keep delivered comparisons inspectable after snapshot expiry
  with an expired notice. Window focus changes recheck access without discarding
  unchanged results. Clear private results on account/consent changes, access-check
  failures, mode changes and leaving the visible workbench. Use synthetic fixtures for normal
  tests; live model runs retain explicit provider-test authority. The owner authorized
  implementing account mode, but will sign in and run private comparisons personally.
  Agents must not run live comparisons with private account data.
- Use Impeccable and design-system-bench before UI edits. Preserve responsive
  layout, keyboard operation, clear labels and current product styles. Update
  `DESIGN.md`, the existing interaction registry and design-system catalogs when
  controls exist; do not register these planned interactions as implemented now.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `DailyBriefBench.tsx`, the development-only comparison route and shared account-context service implement My account mode alongside synthetic fixtures. `BriefingWorkbenchGuide.tsx` adds the glossary and repository document access. |
| Desktop | No native account workbench: browser mode reads hosted synchronized data only; local-only and unsynced records remain excluded. Ticket 155 retains installed consumption acceptance. |
| Marketing | Not applicable: the internal workbench is neither hosted marketing content nor a public demo. |
| Future mobile | Verify narrow mobile web previews; native workbench implementation is not applicable. |

Verification: configuration round-trip, comparison input identity, explicit-run
behavior, stale result cancellation, production/origin rejection, zero account
reads in synthetic mode, owner/consent/source fencing in account mode, no daily
admission writes, no client secrets, keyboard/mobile/long-text states and required repository
checks. Provider-free tests must not silently call OpenAI.

Implementation and provider-free verification: `docs/qa/briefing-workbench.md`.
September 21 account troubleshooting corrects reminder-query batching, preserves
historical occurrence lineage after a fenced sync, and exposes synchronization
recovery instructions. Recovery uses the existing Settings timezone save;
the comparison remains read-only and requires an explicit Run comparison click.
Synthetic, account and glossary/document implementations passed independent review. Ticket 155 retains live
quality, hosted and installed desktop acceptance gates.

## Ticket 155: Reviewed briefing configuration rollout and acceptance

Status: in_progress. Source implementation and independent review are complete;
live synthetic, hosted and installed desktop acceptance remain open. See
`docs/qa/briefing-workbench.md`.
Filed September 20, 2026. Dependencies: Tickets 151–154. Hosted/live-data/native
activation also depends on remaining release acceptance for Tickets 147–148.

Goal: make a reviewed preset drive the daily horse briefing on web and linked
desktop, with evidence and a simple rollback.

Scope and acceptance:

- Select the active versioned repository preset through the existing server
  generation service. An ordinary reviewed code/configuration change promotes a
  preset; no new runtime admin console, user role or configuration database.
- Apply the same validated preset, references and planning pipeline tested in the
  workbench. Keep OpenAI `gpt-5.6-luna` initially and preserve the provider-neutral
  boundary. Model/adapter changes must not require rewriting core policy or UI.
- Fence pending output against effective configuration, reference and planner
  versions as well as existing account, disclosure, source and time checks.
  Preserve once-per-local-day admission and dismissal. A configuration rollout
  must not silently regenerate an already completed daily briefing.
- Configuration cannot grant data access. Scope expansion or changed model-data
  disclosure must use the existing revocable control boundary. Keep the normal
  Settings surface limited unless a later ticket explicitly adds user tuning.
- Render validated suggestions and compact source provenance in the shared bubble
  without implying that changes were applied. Verify text remains useful when
  no references or valid scheduling options are available.
- Review a bounded synthetic matrix covering sparse/dense days, incomplete history,
  Calendar absence/partial coverage, hostile input, no feasible plan, contrasting
  tones and narrow displays. Record observed quality, latency and usage when
  available; do not invent scores, costs or guaranteed research efficacy.
- Verify account/configuration changes, existing Timeline controls, linked desktop,
  unsynced/offline limits and zero source/provider-event writes. Separate source,
  synthetic provider, hosted real-data, installed native and public evidence.
- Document the selected preset and rollback to the prior reviewed configuration.
  Existing feature disablement remains available. Preserve Tickets 147–148 release
  gates; this ticket does not authorize hosted deployment or real-data transmission.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `lib/services/daily-brief.service.ts`, generation validation and shared briefing UI consume the reviewed configuration; record release QA. |
| Desktop | `apps/desktop/src/daily-brief.ts` and shared horse bubble consume the same hosted result; installed linked/offline acceptance is required. |
| Marketing | No new claim automatically follows. Public wording requires separately recorded capability and release evidence. |
| Future mobile | Preserve reusable configuration/result types; native delivery remains deferred. |

Verification: all required checks, shared-core portability, design/interaction
checks, web/desktop builds, comparison regression fixtures and independent review.
Record remaining live/native gates explicitly instead of treating bench success
as production acceptance.

---

## Ticket 156: Recipe-scoped workbench and configuration

Status: complete; implemented September 21, 2026.
Parent checks and independent read-only review pass. Live quality and rollout
acceptance remain under Ticket 161; see `docs/qa/briefing-workbench.md`.
Filed September 21, 2026. Dependencies: Tickets 151 and 154.

Goal: scope workbench controls and output policy to a named recipe, with Daily
Brief as the first recipe. Later recipes may use completion information differently.

Scope and acceptance:

- Extend the existing configuration contract and workbench with a stable recipe
  identity and version. Bind presets, context selection, output policy, references
  and comparison results to that recipe. Do not build a general workflow engine.
- Introduce only Daily Brief now. Future recipe implementations require their own
  tickets; do not add placeholder recipes or an arbitrary prompt editor.
- Define validation and compatibility for existing presets, saved drafts and
  imports. Reject incompatible recipe/configuration combinations clearly.
- Preserve one frozen authorized snapshot per comparison. Recipe/configuration
  changes invalidate pending output and contribute to the effective revision.
- Keep context access separate from recipe selection. A recipe cannot grant
  connector or model-data permissions. Preserve explicit Run comparison, private
  memory-only results, read-only behavior and daily allowance separation.
- Keep preset/reference documents accessible. Extend the existing glossary with
  recipe terms and traceable contract owners. Use Impeccable and design-system-bench
  before UI edits; update the existing interaction registry/catalog at implementation.
- Document the boundary between existing behavior and the planned Daily Brief
  policy in Ticket 158. Filing this ticket does not change the active recipe.

Implementation references: `packages/core/src/types/briefing-config.ts`,
`packages/core/src/services/briefing-config.ts`, `packages/core/src/data/briefing-presets.json`,
`lib/services/briefing-pipeline.ts`, `lib/services/briefing-workbench.service.ts`,
`app/design-system/DailyBriefBench.tsx`, `docs/ontology/briefing-workbench.json`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend the existing configuration, pipeline and workbench references above; verify through Ticket 161. |
| Desktop | Shared server recipe feeds the existing linked desktop briefing; no native workbench. Ticket 161 verifies consumption. |
| Marketing | Not applicable: internal recipe controls do not create a public capability claim. |
| Future mobile | Reuse recipe contracts; test narrow web controls in Ticket 161. Native implementation remains deferred. |

Verification: recipe identity/version validation, old-preset compatibility, cross-recipe
rejection, effective revision withdrawal, same-snapshot comparisons, glossary coverage,
explicit-run and privacy regressions, plus required repository checks.

---

## Ticket 157: Explicit recipe context controls and duration sources

Status: complete; implemented September 21, 2026.
Parent checks and independent read-only review pass. Live quality and rollout
acceptance remain under Ticket 161; see `docs/qa/briefing-workbench.md`.
Filed September 21, 2026. Dependencies: Tickets 146, 151 and 156.

Goal: expose which facts a recipe receives, including distinct duration sources,
without confusing input selection with permission to mention those facts in prose.

Scope and acceptance:

- Audit the existing source-to-model projection before adding fields. It currently
  provides one effective duration: a configured Behavior default, otherwise an
  eligible historical mean. Raw completion timestamps are not in the briefing contract.
- Define independent controls for authorized Calendar context, completion history,
  completion timestamps, recorded elapsed durations, historical average duration
  and configured default duration. Clearly distinguish finished-at time from elapsed
  time. Verify source semantics; a manual status-update timestamp is not automatically
  the actual finish time. Unsupported inputs must be marked unavailable.
- Make default-versus-observed duration selection and fallback explicit. Preserve
  sample eligibility, provenance and bounded history rules unless a reviewed contract
  change explicitly replaces them. Never manufacture a duration when a source is absent.
- Honor field exclusions before model serialization. Document which selected
  aggregates may derive from server-side history; do not leak excluded raw fields
  through another payload field or inspector export.
- Retain minimal internal completion state when needed to exclude finished work.
  Its internal use does not require completion narration in the Daily Brief.
- Capture one authorized source snapshot, then apply each configuration's scope
  and history projection correctly. Controls cannot bypass existing consent.
- Show included/excluded inputs, selected duration source, sample coverage and
  reasons in the private inspector. Link controls to stable glossary contract terms.
  Use existing workbench styles and document access; no new customer Settings page.

Implementation references: `packages/core/src/types/advisor-day-context.ts`,
`packages/core/src/resolvers/timeline-context.resolver.ts`,
`packages/core/src/services/briefing-config.ts`, `lib/services/advisor-day-context.service.ts`,
`lib/services/briefing-account-context.service.ts`, `app/design-system/DailyBriefBench.tsx`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend the context projection and workbench references above; Ticket 161 verifies controls and payloads. |
| Desktop | Hosted projections remain limited to synchronized account data. No local data transmission or native controls; Ticket 161 verifies this boundary. |
| Marketing | Not applicable: internal input controls do not authorize new public wording. |
| Future mobile | Preserve shared context contracts and narrow web controls; native controls remain deferred. |

Verification: disabled-field absence, aggregate/raw-field independence, duration
source precedence, insufficient samples, timestamp semantics, completed-work filtering,
different history windows over one snapshot, consent revocation and required checks.
Any schema change discovered during implementation requires normal migrations and types.

---

### Ticket 157 follow-up: historical completion marking context

Owner-authorized September 22, 2026; source implementation and local QA complete.
Hosted migration `20260922034223_advisor_historical_completion_times.sql` is applied;
the hosted migration list confirmed it on September 24, 2026. A clean local replay
through the documented loopback procedure and the owner-run private comparison
remain pending. See `docs/qa/briefing-workbench.md`.
Replace the
unsupported finish-time placeholder with Historical completion times. Reuse
existing current mark snapshots, a 1–90-day window and shared circular summaries.
No actual-finish capture, automatic model run or write authority is added.
See `docs/DATETIME_STRATEGY.md` for eligibility and sufficiency.

Platform impact: web uses `DailyBriefBench.tsx` and the shared server projection;
linked desktop consumes the same reviewed Daily Brief pipeline after deployment,
with local-only/offline model generation unchanged. Marketing is not applicable
because this is an internal authenticated-context control. Future mobile has no
implementation; it must reuse the shared contract when separately ticketed.
Existing interaction-registry exclusion and design-system bench remain the UI evidence.

## Ticket 158: Daily Brief purpose and prose contract

Status: complete; implemented September 21, 2026.
Parent checks and independent read-only review pass. Live quality and rollout
acceptance remain under Ticket 161; see `docs/qa/briefing-workbench.md`.
Filed September 21, 2026. Dependencies: Tickets 156–157.

Goal: make Daily Brief a morning overview of practical day constraints and
opportunities, adding interpretation beyond facts already visible in the ledger.

Scope and acceptance:

- Define a Daily Brief output policy that prioritizes meaningful conflicts, tight
  transitions and supported opportunities. Departures remain future capability
  until Tickets 162–165 implement and verify the travel contract from Ticket 160.
- Remove routine completion recaps and adherence summaries from this recipe's
  prose. Keep shared completion data available for internal filtering and future
  recipes. Do not remove or reinterpret manual ledger statuses.
- Keep diagnostics such as missing duration samples and raw connector states in
  the inspector. Mention uncertainty in prose only when it materially affects a
  specific recommendation; explain the practical consequence in plain language.
- Do not substitute unsupported certainty for suppressed diagnostics. Partial
  Calendar coverage cannot establish free time; missing duration cannot prove a fit.
- Keep output concise when no meaningful issue exists. Do not fill the word budget
  with ledger repetition, generic coaching or technical explanations.
- Update the shared recipe instructions and output contract. The current global
  factual-recap instruction conflicts with this intended recipe policy; replace it
  within Daily Brief during implementation, rather than treating it as immutable.
- Keep the existing horse bubble and read-only semantics. Version the policy and
  add positive/negative synthetic examples for review under Ticket 161.

Implementation references: `lib/services/daily-brief-consumer.ts`,
`lib/services/briefing-pipeline.ts`, `packages/core/src/types/daily-brief.ts`,
`packages/core/src/data/briefing-presets.json`, `components/briefing/DailyBriefBubble.tsx`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Update the shared recipe policy and existing bubble output contract; Ticket 161 verifies the result. |
| Desktop | Existing linked desktop consumes the same hosted policy and shared bubble; Ticket 161 verifies installed behavior. |
| Marketing | Not applicable: no copy changes or new AI claims follow from this internal policy work. |
| Future mobile | Shared output policy remains reusable; narrow web rendering is verified in Ticket 161. Native delivery is deferred. |

Verification: recipe-specific completion suppression, completed-work exclusion,
diagnostics kept out of prose, material uncertainty expressed accurately, concise
uneventful-day output, hostile-input handling and required repository checks.
Model quality requires reviewed outputs, not only string-matching unit tests.

---

## Ticket 159: Day conflicts and feasible opportunities

Status: implementation complete, September 22, 2026.
Required checks and web/desktop builds pass. Fresh independent review returned ship.
Evidence: `docs/qa/briefing-workbench.md`. Model-quality and rollout acceptance
remain under Ticket 161.
Filed September 21, 2026. Dependencies: Tickets 153 and 156–158.

Goal: supply deterministic evidence for day conflicts and useful windows,
independently of whether the user permits hypothetical schedule moves.

Scope and acceptance:

- Separate conflict detection from move-option generation in the shared planning
  boundary. Detect supported conflicts even with no movable Behaviors selected.
- Combine authorized Calendar commitments, relevant remaining Behaviors,
  duration estimates, configured windows and buffers. Exclude finished work from
  remaining-work recommendations without changing its stored status or history.
- Distinguish known overlaps, tight transitions, feasible opportunities and unknown
  feasibility. Keep source references, assumptions and freshness in typed evidence.
- Reuse existing resolver logic for interval/timezone handling and scheduling
  constraints. Do not delegate conflict or free-window arithmetic to the model.
- Require a supported duration and complete relevant coverage before claiming that
  an activity fits a gap. A 35-minute shower example is valid only when both the
  estimate and available window support it; it is not a hard-coded recommendation.
- Keep hypothetical moves separately gated. Reporting a conflict never authorizes
  rescheduling, marking completion, writing Calendar events or creating Timeline blocks.
- Rank material findings for the Daily Brief recipe under Ticket 158. Keep detailed
  rejection reasons and evidence in the inspector. No travel-time inference until
  Tickets 162–165 implement and verify the accepted Ticket 160 travel contract.

Implementation references: `packages/core/src/resolvers/briefing-plan.resolver.ts`,
`packages/core/src/types/briefing-plan.ts`, `lib/services/briefing-pipeline.ts`,
`packages/core/src/resolvers/timeline-context.resolver.ts`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared resolver and pipeline supply evidence to the existing briefing; Ticket 161 verifies comparisons. |
| Desktop | Consume the same hosted evidence through the existing briefing. No local scheduling fork; Ticket 161 verifies parity. |
| Marketing | Not applicable: resolver work does not establish public efficacy claims. |
| Future mobile | Pure resolver/types remain reusable; native planning UI is not in scope. |

Verification: overlaps with no movable selections, buffers, completed-work exclusion,
unknown durations, partial/stale Calendar data, all-day and timed events, DST/day
boundaries, no feasible window, provenance and zero mutation calls; required checks.

---

## Ticket 160: Travel context and departure advice discovery

Status: discovery complete, revised September 21, 2026. Runtime implementation not started.
Filed September 21, 2026. References: Tickets 132–137, 144 and 156–159.
Independent of the initial Daily Brief rollout.

Goal: define proactive multimode travel, complete-trip occupancy and the provider,
permission and presentation contracts needed to implement them.

Accepted scope and discovery result:

- Use permitted fresh device position as the default immediate origin. Add optional
  Behavior locations. Define role-specific precedence for corrections, device,
  Behavior, Calendar and base locations; future legs use planned stop provenance.
- A missing base suppresses only final-return advice and leaves return time unknown.
  Recommend current location → first event and A → B → C when each leg's endpoints,
  timing and mode are usable. Never insert a base detour automatically. Current
  device position overrides a predicted origin for the next immediate departure.
  Recalculate affected legs when location, timing or mode changes. Onboarding
  requests a base when needed for an otherwise unknown immediate origin.
- Route proactively whenever two usable points exist after setup. Support walking,
  cycling, transit and driving. No per-trip origin confirmation or driving fallback.
- Include departure, event attendance, onward travel and return in derived occupied
  intervals. A 2:30–4:30 event can occupy 1:30–6:30. Detect collisions against that
  expanded span without changing scheduled times, statuses or Calendar events.
  Preserve all known outbound/event-to-event occupancy and collisions without a base.
- Reuse the existing magenta Timeline span, overlap borders and event inspection.
  Show Calendar locations with Google Maps or supported preferred-navigation links.
- Distinguish saved configuration, temporary device observations and expiring route
  estimates. Expiry does not erase locations or require explicit origin entry again.
- Audit destination ambiguity and provider capabilities, terms, pricing, quotas,
  credentials, disclosure, retention and revocation through dated primary sources.
  Keep raw locations out of model inputs; derived timing still needs provider-use
  clearance and the revised model disclosure before transmission.
- Document bounded contracts, synthetic examples, failures, cost assumptions and
  all platform impacts. No background tracking, autonomous navigation or scheduling.

Deliverable: [travel/departure integration brief](plans/travel-departure-discovery.md).
The owner corrections supersede the initial manual-only, driving-only,
advisor-only recommendation and the later global saved-base requirement.
Product direction is accepted. Tickets 162–165 now separate implementation and
release evidence; provider-use review precedes live
calls. Discovery performs no provider setup, credential creation, device reads,
private route queries or deployment. Verification results live in `STATUS.md`.

Planning references: `docs/INTEGRATION_PLAYBOOK.md`, `docs/PRODUCT_SPEC.md`,
`docs/DATA_MODEL.md`, `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `docs/DECISIONS.md`,
`packages/core/src/types/advisor-day-context.ts`, `packages/core/src/types/briefing-plan.ts`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Tickets 162–164 implement locations, permissions, routing, expanded occupancy and existing UI. Ticket 165 verifies release. |
| Desktop | Same follow-ups cover local saved locations, linked sync, native foreground permission and shared routing/UI; Ticket 165 verifies installed behavior. |
| Marketing | Ticket 165 owns required disclosures; no capability claim from discovery alone. |
| Future mobile | Shared contracts remain portable; native delivery is deferred. Tickets 162/164 verify narrow mobile web. |

Verification: dated primary-source provider/terms/cost review, synthetic full-trip
and collision examples, permission/retention review, cross-platform inventory,
consistent product docs and required repository checks. No live private route test.

---

## Ticket 161: Daily Brief recipe evaluation and reviewed rollout

Status: in_progress. Provider-free evaluation implementation and required checks
pass; fresh independent review returned ship with no findings. Model wording review,
owner-run comparisons, promotion, hosted and installed desktop acceptance remain
open. Evidence and rollback: `docs/qa/briefing-workbench.md#ticket-161-evaluation-and-rollout`.
Filed September 21, 2026. Dependencies: Tickets 156–159; coordinate with Ticket 155
and remaining Tickets 147–148 release gates. Ticket 160 is not a rollout dependency.

Goal: verify that the Daily Brief recipe adds useful day orientation and promote
only a reviewed configuration through the existing rollout path.

Scope and acceptance:

- Build a bounded synthetic matrix for overlaps, tight transitions, supported gaps,
  missing durations, partial Calendar coverage, completed Behaviors, sparse and dense
  days, and uneventful days. Add hostile text and expired/changed context cases.
- Compare configurations against the same frozen facts. Verify context toggles
  alter payload projection, not merely instructions, and that recipe identity and
  versions appear in the existing inspector and comparison evidence.
- Review whether prose identifies material constraints and useful opportunities,
  avoids completion-ledger repetition and diagnostics, and supports every timing
  claim. Distinguish contract tests from human judgment of model wording.
- Preserve explicit Run comparison, no automatic reruns, read-only results, private
  memory-only state and separation from the production daily briefing allowance.
  Model/provider validation failures must remain visible and must not masquerade
  as successful comparisons or fabricate fallback advice.
- Run required checks and obtain independent review. Verify responsive controls,
  glossary/document access, shared bubble rendering and existing Timeline interactions
  through the existing interaction registry and design-system catalog.
- Promote through Ticket 155's reviewed repository configuration mechanism. Record
  policy/configuration versions and rollback. A rollout must not silently regenerate
  an already attempted daily briefing or reset dismissal/admission state.
- Separate provider-free, authorized synthetic-provider, owner-run account, hosted
  and installed desktop evidence. Private comparisons remain owner-clicked under
  the existing instruction; filing this ticket authorizes no live generation or
  deployment. Record incomplete gates rather than claiming production acceptance.
- Evaluate departures only after Tickets 162–165 implement and verify travel.
  Initial acceptance must not imply travel context is available.

Implementation/evidence references: `docs/qa/briefing-workbench.md`,
`lib/services/briefing-fixtures.ts`, `tests/briefing-workbench-account.test.ts`,
`tests/briefing-workbench.dom.test.tsx`, `tests/briefing-plan.resolver.test.ts`,
`tests/daily-brief-consumer.test.ts`, `interaction-registry.json`,
`design-system.manifest.json`, `design-system.surfaces.json`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Verify existing workbench and daily briefing paths, then record separately authorized hosted acceptance. |
| Desktop | Verify `apps/desktop/src/daily-brief.ts` and shared bubble with linked, offline and unsynced limits; preserve existing native release gates. |
| Marketing | No automatic changes. Any future public claim requires separate release evidence and copy work. |
| Future mobile | Verify narrow mobile-web rendering and controls; native delivery remains deferred. |

Verification: required repository commands, shared-core portability, design/interaction
checks, applicable web/desktop builds, independent review, reviewed output evidence and
rollback. Keep any unexecuted live or installed checks explicitly open.

---

## Ticket 162: Travel locations, permission and onboarding

Status: implemented behind the provider gate; repository checks and independent
code review passed. Database and live release gates remain in Ticket 165.
Filed September 21, 2026. Dependency: Ticket 160 accepted direction.

Goal: establish usable owned locations and explicit travel setup for proactive routing.

Scope and acceptance:

- Add optional Behavior locations and an optional saved base, mode and supported
  navigation preferences. Reuse the existing Behavior form and Calendar/briefing settings.
- Allow current-location-to-event and event-to-event recommendations without a base.
  Missing base suppresses only final-return advice and leaves return time unknown.
  Declining location prompts for a base to establish the immediate origin; known
  event-to-event legs remain available when that origin is unknown.
- Explain proactive routing, recipients, permissions and retention before enabling
  travel. Keep routing, Calendar, device and model disclosures separate.
- Implement foreground browser and macOS location adapters. Current permitted
  position supplies the immediate origin ahead of a predicted scheduled position;
  no continuous/background position history.
  Handle denied, revoked, stale, inaccurate and unavailable samples explicitly.
- Preserve role-specific endpoint precedence and source revision. Corrections apply
  to a journey; ambiguous/hybrid destinations need the missing fact. Do not infer
  home, attendance or future physical presence from schedules.
- Define saved-location web/SQLite contracts, migrations, RLS, types, sync, removal,
  deletion and compatible Cadence backup/restore. Preserve older imports and existing
  BehaviorLog formats. Keep provider results/device samples out of persistent sync,
  exports, backups and telemetry. Document provider-derived storage restrictions.
- Update existing interaction/design catalogs and platform parity evidence with the
  implemented controls. Scope discovery adds no registry entries by itself.

References: `docs/plans/travel-departure-discovery.md`, `docs/DATA_MODEL.md`,
`components/behaviors/BehaviorForm.tsx`, `components/settings/GoogleCalendarPanel.tsx`,
`apps/desktop/src`, `apps/desktop/src-tauri`, `interaction-registry.json`,
`design-system.manifest.json`.

Implementation: `TravelSettingsPanel`, the shared travel-settings planner,
`/api/travel/settings`, Behavior form `location_text`, hosted travel migration,
SQLite migration 0016, existing profile sync and foreground browser/macOS adapters.
The interaction registry owns `INT-TRAVEL-001/002`; the design catalog owns
`module.travel-settings-panel`. Clean local migration replay and generated-type confirmation now pass using
the working official CLI override. Hosted deployment remains in Ticket 165.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `TravelSettingsPanel`, `BehaviorForm`, `/api/travel/settings` and `lib/ui/foreground-location.ts`; 390px QA in `docs/qa/travel-release.md`. |
| Desktop | SQLite migration 0016, `apps/desktop/src/local-travel-settings.service.ts`, `foreground-location.ts` and private first-link import in `account/first-link.ts`; installed acceptance remains in Ticket 165. |
| Marketing | `components/settings/LegalContent.tsx` and `docs/user-guide/travel.md`; release claims remain gated by Ticket 165. |
| Future mobile | `packages/core/src/types/travel.ts` provides portable contracts; native mobile permissions/navigation remain out of scope. |

Verification: required checks; clean migrations/types; ownership/RLS; legacy import,
sync and deletion tests; denial/revocation/account-switch races; no-base suppression
limited to final return while other usable legs remain; responsive form/settings
and synthetic native boundary checks. No live private location read is implied
by this planned ticket.

---

## Ticket 163: Proactive routes and complete-trip collision evidence

Status: implemented behind the provider gate; repository checks and independent
code review passed. Database and live release gates remain in Ticket 165.
Filed September 21, 2026. Dependencies: Ticket 162 contracts; coordinate with Ticket 159.
Provider-use clearance from Ticket 165 is required before live provider calls.

Goal: derive one shared travel-occupancy contract for Timeline and advisor findings.

Scope and acceptance:

- Add one bounded server routing adapter for walking, cycling, transit and driving.
  Use the chosen mode; never silently switch modes. Resolve unambiguous points and
  compute usable pairs proactively after setup, with source/grant validation.
- Apply current-origin precedence and future-stop provenance. Plan A → B → C from
  event locations, times and mode; recalculate affected legs when inputs change.
  Never insert a base detour automatically. Fresh device position overrides the
  predicted origin for the next immediate departure. Compute last event → base
  only when a usable base exists; otherwise suppress only final-return advice.
- Evaluate outward, onward and return legs at their relevant times. Handle transit
  schedules/connections, asymmetric durations, unavailable returns and arrival/exit/
  settling buffers. Unknown results cannot mean zero travel or complete availability.
- Derive occupied segments without moving source schedules. Deduplicate shared legs,
  preserve known free gaps and compare expanded spans against eligible Behaviors and
  commitments. Retain known outbound and event-to-event occupancy/collisions when
  return timing is unknown. Preserve existing duration, completion and uncertainty
  rules.
- Put pure rules in shared core; services own provider/location I/O. Keep raw locations
  out of advisor facts. Validate a versioned timing/provenance/freshness projection.
- Coalesce meaningful foreground changes. Bound legs, concurrency, retries, deadlines
  and persistent owner/global quota debits. Clear or refresh stale evidence without
  per-trip approval, continuous polling or resetting Daily Brief admission.
- Respect provider field masks, warnings, attribution, credentials and permitted
  retention. Prove exact outbound data projection and late-response rejection.

References: `docs/plans/travel-departure-discovery.md`,
`packages/core/src/resolvers/timeline-context.resolver.ts`,
`packages/core/src/resolvers/day-progress.resolver.ts`,
`packages/core/src/resolvers/briefing-plan.resolver.ts`, `lib/services`.

Implementation: `packages/core/src/resolvers/travel.resolver.ts`,
`lib/services/travel-provider.ts`, `travel-route-refresh.service.ts`,
`travel-routing.service.ts`, `/api/travel/routes` and persistent quota admission.
Provider-free fixtures cover planning, timing, transit, late-response rejection
and selected-mode projection. Authorized public-landmark live tests now pass in
all four modes. Hosted routing and model projection remain disabled.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `lib/services/travel-route-refresh.service.ts`, `/api/travel/routes` and the shared travel resolver supply Ticket 164. |
| Desktop | `apps/desktop/src/travel.ts` uses the same hosted adapter and core for synchronized online accounts; offline tracking continues. |
| Marketing | Not applicable: core/provider implementation alone establishes no public release claim; Ticket 165 handles disclosure. |
| Future mobile | `packages/core/src/resolvers/travel.resolver.ts` is portable; native integration remains out of scope. |

Verification: required checks and resolver fixtures for the 2:30–4:30 event occupying
1:30–6:30, travel-created collisions, half-open boundaries, no-base outbound/A→B→C,
unknown final return with retained known spans, no automatic base detours, current
device precedence, affected-leg recalculation, transit, midnight/DST, partial
coverage, quota/grant races and zero automatic tracking/Calendar mutations.
Provider-free fixtures precede authorized tests.

---

## Ticket 164: Travel in the existing Timeline and Daily Brief

Status: implemented behind the provider gate; repository checks and independent
code review passed. Database and live release gates remain in Ticket 165.
Filed September 21, 2026. Dependencies: Tickets 162–163; coordinate with Tickets 159/161.

Goal: display complete-trip effects through existing Timeline and briefing patterns.

Scope and acceptance:

- Extend the existing temporary magenta span and Behavior overlap borders using
  shared expanded occupancy. Keep event markers at scheduled starts and distinguish
  departure, attendance, onward/return and available-again times in inspection.
- Preserve the left Timeline/right ledger, reserved bottom preview and details dialog.
  No extra lane, permanent travel fill or separate collision panel. Label travel
  conflicts in text and preserve keyboard, focus, touch and narrow-screen behavior.
- Show available Calendar location text with Google Maps or supported preferred
  navigation links. Use validated structured builders and supported transport modes;
  unresolved text offers search without claiming verified route timing.
- Show mode, endpoint provenance, return-to-base assumption and freshness when material.
  Missing base withholds only final-return advice. Keep known outbound/onward advice,
  magenta spans and collisions; unknown legs prevent complete-trip availability claims.
- Integrate derived evidence into advisor guidance only after provider-use clearance
  and model-disclosure update. Until then, show deterministic travel facts separately.
  Never send raw locations to the model or fabricate a model/provider fallback.
- Changes may update deterministic Timeline evidence but cannot silently regenerate
  an attempted Daily Brief or reset dismissal. Define stale-brief handling explicitly.
- Update existing interaction registry, design catalog/bench and shared desktop parity
  evidence. Use impeccable and design-system-bench before editing UI.

References: `components/timeline/DayProgressTimeline.tsx`,
`components/timeline/ExternalEventDetails.tsx`, `components/briefing/DailyBriefBubble.tsx`,
`lib/services/briefing-pipeline.ts`, `apps/desktop/src/daily-brief.ts`,
`interaction-registry.json`, `design-system.manifest.json`.

Implementation: shared `DayProgressTimeline`, `ExternalEventDetails`,
`OccurrenceRow` travel inspection, native navigation builders and foreground
`useTravelContext`; desktop uses the same presentation. The Calendar bench covers
complete-trip and no-base fixtures. The interaction registry owns
`INT-TRAVEL-003`; existing Calendar inspection/navigation intents remain canonical.
Daily Brief receives no route projection and retains its admission/dismissal state.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `DayProgressTimeline`, `ExternalEventDetails`, `OccurrenceRow` and `TravelSettingsPanel`; Daily Brief projection stays disabled. |
| Desktop | `apps/desktop/src/product.tsx` uses shared travel presentation and navigation; installed acceptance remains in Ticket 165. |
| Marketing | `docs/user-guide/travel.md` records gated behavior; Ticket 165 controls release claims. |
| Future mobile | 390px web evidence in `docs/qa/travel-release.md`; native mobile navigation/permission UI remains out of scope. |

Verification: required checks, design/interaction checks, web/desktop builds,
responsive browser QA, exact expanded-span/collision parity, navigation URL safety,
missing/stale facts, no-base final-return suppression with other known advice/spans
preserved, and unchanged status/schedule/dismissal flows.

---

## Ticket 165: Travel provider and cross-platform release acceptance

Status: in progress; two installed-macOS gates remain. Repository, local database,
public-landmark, deployed-web and private-account acceptance pass (PRs #58–#65,
September 22–23). Installed macOS passed cold start, account sync, restart
preservation and a hosted route request on preview.45. Open: native device location
(Core Location on the owner's Mac silently refuses the ad hoc and self-signed
Cadence builds as new clients while serving already-authorized Chrome; a machine-level
condition and an Apple-trusted signing requirement both remain open until a second Mac
or a Developer ID build under Ticket 115 discriminates them) and native
navigation handoff (opening a route destination in the selected maps app from the
installed app is not yet verified). Evidence: `docs/qa/travel-release.md`. Billing and restricted local credentials are configured.
Filed September 21, 2026. Reviews begin alongside Tickets 162–164; release follows them.

Goal: establish provider-use, disclosure and runtime evidence for the accepted travel feature.

Scope and acceptance:

- Resolve applicable Google Maps/Calendar terms, billing region, permitted derived
  display/model projection, provider retention, attribution and credential restrictions
  before live routing. Deterministic presentation does not waive provider-use review.
- Configure approved credentials/quotas only within the user's authorized rollout.
  Validate full-trip/proactive cost assumptions and hard spending caps. No unrestricted
  key or inferred access to a provider account/connector.
- Update canonical Privacy/Terms, data-use controls and factual user guidance. Explain
  foreground current origin, optional saved base, unknown final return without one,
  proactive event-to-event routing, transport modes, provider recipients, model
  projection and limits on provider erasure.
- Separate synthetic, authorized public-landmark, private-account, deployed-web and
  installed-desktop evidence. Verify denial/revocation, cold start, restart, offline,
  account switch, changed event locations/times/mode, current-device precedence,
  no-base outbound/event-to-event advice and occupancy, no automatic base detours,
  and full outbound/return occupancy when all legs are known.
- Verify Google Maps attribution and supported navigation handoff. Record incomplete
  native/provider gates explicitly. Initial Daily Brief rollout remains independent.
- Record rollout versions and rollback. Disable routing and clear transient data first;
  preserve user-authored locations and independent tracking/Calendar/sign-in behavior.

References: `docs/plans/travel-departure-discovery.md`, `docs/INTEGRATION_PLAYBOOK.md`,
`docs/OPERATIONS.md`, `docs/qa/day-progress-release.md`, `docs/qa/in-app-daily-brief.md`.

Release history: PR #58 (travel implementation) merged September 22, 2026; PR #59
(geocode venue types), #63 (desktop sync canonicalization), #64 (Ticket 166), #65
(Ticket 167) and the location diagnostics PR followed. Production deployments carry
each merge; installed previews .43–.45 carry the desktop side.

Implementation evidence and remaining gates: `docs/qa/travel-release.md`,
`components/settings/LegalContent.tsx`, `docs/user-guide/travel.md` and the
travel rollback section in `docs/OPERATIONS.md`. The owner authorized USA billing,
a nonrenewing initial US$20 allowance, restricted credentials and live testing.
The local key and quotas are verified; 40 atomic US$0.50 reservations bound calls.
One reservation covers public-landmark tests. The hosted travel migrations now
preserve that reservation. Production-only workload identity replaces the hosted
egress requirement; hosted runtime acceptance passed September 22 and installed-macOS
acceptance is recorded above with its two open gates. The separate advisor update installed
released preview.42. Its missing build-time broker address is corrected. Installed
Settings confirms advisor enablement and Calendar access. The first automatic
briefing returned HTTP 409. The isolated preserved-lineage hotfix is now deployed;
a normal browser retry returned `ready` and displayed the briefing.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | `docs/qa/travel-release.md` records synthetic, hosted runtime and private-account acceptance; Daily Brief stays independent. |
| Desktop | `docs/qa/travel-release.md` records installed sync, restart and route acceptance on preview.45; native device location and navigation handoff remain open. |
| Marketing | `components/settings/LegalContent.tsx` and `docs/user-guide/travel.md` disclose the disabled rollout; public claims need deployed evidence. |
| Future mobile | Not applicable to native release: native app remains deferred. Mobile-web evidence belongs to web acceptance. |

Verification: required repository checks and applicable platform builds; reviewed
provider/disclosure evidence; separately authorized live tests; spend/rollback checks.
Filing this ticket does not create credentials, deploy, read location or transmit private data.

## Ticket 166: Travel refresh quota, failure messages and device-location onboarding

Status: implemented in repository September 22, 2026; the hosted quota function
migration is applied (PR #64, September 23, 2026) and owner re-acceptance follows.
September 24, 2026 follow-up: a request that has reached the routes call now
finishes when the window blurs, hides or unmounts, so an admitted quota slot is
not wasted. Filed September 22, 2026 from Ticket 165 owner acceptance.
Dependencies: Tickets 162–165 shipped (PRs #58–#60); production routing is enabled.

Goal: make travel usable on a real day without exhausting the owner quota, tell the
user plainly why estimates are missing, and make granting foreground device location a
one-step, in-context action on iPhone Safari and desktop browsers.

Evidence: on September 22 the owner account consumed its six daily route refreshes in
about fifteen minutes of ordinary use because every Timeline focus or visibility change
issued a new `POST /api/travel/routes`. Requests with no routable legs still consumed a
reservation. After the limit, the owner counter kept rising (11 by 3 PM Eastern) and the
phone Timeline showed only `Travel estimates are unavailable. Tracking and Calendar
still work.` The routing itself worked: the 429 `quota_exceeded` response was correct.

Scope and acceptance:

- Client reuse. The web and desktop travel hooks keep the last successful view for the
  same account, local date, source key and corrections until its `expiresAt`. Focus,
  visibility and BroadcastChannel refreshes reuse that view; a new request is sent only
  when the view is missing, expired, or the source key or corrections changed. The
  existing hidden/unfocused suppression and five-minute expiry stay unchanged.
- Server admission. `refreshTravelRoutes` consumes the owner and global quota only when
  the first provider call (a geocode) is about to happen, since geocoding is billable and
  precedes leg planning. A request with no geocodable text returns the zero-leg evidence
  without a reservation and without provider calls. Geocoding calls remain
  bounded by the existing per-request caps. The rejected-attempt counter must not grow
  past the limit; store admissions, not attempts, or add a separate rejected count.
- Limits. Raise the owner limit from 6 to 24 admissions per owner local day. Keep the
  global limit at 100 per UTC day and the US$0.50 reservation accounting. Update the
  quota migration through a new migration, the rollback-only SQL smoke, `docs/OPERATIONS.md`
  and `docs/qa/travel-release.md`.
- Failure messages. Replace the single generic message with one per failure code, exact copy:
  - `quota_exceeded`: `Today’s travel refresh limit is reached. Estimates return tomorrow.`
  - `provider_unavailable` and network errors: `Travel estimates are unavailable right now. Tracking and Calendar still work.`
  - `provider_clearance_required` / not configured: keep `Travel estimates await this deployment’s provider review.`
  - `context_changed`: retry once silently after 350 ms, then show the unavailable message.
  Messages render in the existing Timeline status line; no new control.
- Location onboarding. In the Travel settings panel, when the user saves with routing
  consent newly checked, request the browser position inside that same click so the
  browser prompt appears in context. Show a permission state line under the panel:
  `Device location: allowed`, `Device location: not yet allowed`, or `Device location: blocked`.
  When the state is `prompt` on iOS Safari, add: `To stop Safari asking, tap AA, then
  Website Settings, then Location, then Allow.` When `denied`, add the platform path:
  iOS `Settings › Privacy & Security › Location Services › Safari Websites`, macOS
  desktop app `System Settings › Privacy & Security › Location Services › Cadence`.
  Add-to-Home-Screen guidance is out of scope for this ticket.
- Disclosures. No change to what is sent or stored. Update `docs/user-guide/travel.md`
  for the daily limit wording and the permission line.

References: `lib/ui/travel.ts`, `apps/desktop/src/travel.ts`, `lib/services/travel-route-refresh.service.ts`,
`lib/db/travelRouteQuota.repo.ts`, `supabase/migrations/20260922013000_add_travel_route_quota.sql`,
`components/settings/TravelSettingsPanel.tsx`, `lib/ui/foreground-location.ts`,
`docs/qa/travel-release.md` (hosted acceptance section).

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Hook reuse, failure copy, in-click permission request and permission state line; hosted admission change and migration. |
| Desktop | Same shared hook and panel behavior; macOS permission path copy; installed re-acceptance on the next preview build. |
| Marketing | Not applicable: no public capability claim changes; user guide wording only. |
| Future mobile | Not applicable to native release; iPhone Safari guidance covers mobile web. |

Verification: focused Vitest for hook reuse across focus changes, per-code messages,
zero-leg admission and the 24 limit; rollback-only SQL smoke against local Postgres;
DOM test for the permission state line; required repository checks; hosted migration
through the reviewed workflow; owner re-acceptance on web and installed desktop.
Filing this ticket changes no runtime behavior.

## Ticket 167: Travel refresh policy — first daily open, then manual, with base geocode reuse

Status: implemented in repository September 22, 2026; base geocode reuse enabled
September 24, 2026 after the Geocoding policy check recorded in
`docs/qa/travel-release.md`; owner re-acceptance follows. Filed September 22, 2026 from Ticket 165 owner acceptance.
Dependencies: Ticket 166 (view reuse, per-code messages, admission change). Coordinate
the two so the hook is changed once.

Goal: cut provider calls and quota use to what the user actually needs by refreshing
travel automatically only on the first Timeline open of the local day and on source
changes, and reusing the saved base's geocode within provider policy.

Scope and acceptance:

- First open. Opening the Timeline refreshes travel automatically when this page session
  holds no fresh view for the account, local date, source key and corrections. Views and
  failures live in an in-memory, per-page-session cache (no storage), so Settings round
  trips and remounts reuse them, a failure is not retried automatically for five minutes,
  and a page reload triggers exactly one request. Review of the first implementation
  replaced a persisted per-day marker with this rule: a reload after the day's first
  refresh otherwise left the Timeline with no view and no automatic request.
- Source-change refresh. After that, refresh automatically only when the travel source
  key changes: event times, locations or revisions, corrections, located Behavior
  occurrences and their Behavior location revisions, duration estimates or travel settings. Focus, visibility, online
  and BroadcastChannel events reuse the current view and never send a request by themselves.
- Manual refresh. The Timeline travel status line shows `Travel as of 2:52 PM` using the
  view's `observedAt` in the account timezone, followed by a `Refresh travel` text link
  (existing text-link style). Activating it invalidates the view and requests once. It
  is disabled while a request is in flight and hidden when travel is off or unconfigured.
- Expiry. When the view passes `expiresAt`, keep showing it with the status line
  `Travel estimates from 2:52 PM may be stale.` plus the same `Refresh travel` link.
  Do not auto-request on expiry. Spans and collisions remain visible until refreshed.
- Device origin. The current position is read only during an automatic or manual
  refresh. Document that the immediate-departure origin is as fresh as the last refresh.
- Base geocode reuse. Server-side, reuse the saved base's resolved place ID for the
  lifetime of the travel settings revision, held in memory per server instance with a
  bound of 30 days, never persisted, never containing coordinates or route content.
  Precondition: re-verify the Geocoding policy caching allowance and record the result
  in `docs/qa/travel-release.md` before enabling. If the policy does not allow it, drop
  this item and say so in the ticket.
- Desktop parity. Same behavior through the shared hook; the manual link works offline
  by showing the unavailable message without a request.
- Disclosures and guide. Update `docs/user-guide/travel.md` and the Travel settings
  panel copy to describe first-open plus manual refresh. No change to what is sent.

References: `lib/ui/travel.ts`, `apps/desktop/src/travel.ts`,
`components/timeline/DayProgressTimeline.tsx`, `lib/services/travel-route-refresh.service.ts`,
`lib/services/travel-provider.ts`, `docs/qa/travel-release.md`, Ticket 166.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Hook refresh policy, status line and manual link; server base geocode reuse behind the policy check. |
| Desktop | Shared hook and status line; offline manual behavior; installed re-acceptance on the next preview build. |
| Marketing | Not applicable: no public claim changes; user guide wording only. |
| Future mobile | Not applicable to native release; mobile web inherits the web behavior. |

Verification: focused Vitest for first-open-per-day, source-change-only refresh, manual
link states, stale display, and geocode reuse bounds; DOM test for the status line and
link; required repository checks; owner re-acceptance on web and installed desktop with
provider call counts read from Cloud Monitoring before and after.
Filing this ticket changes no runtime behavior.

---

## Advisor recovery and useful recommendations: Tickets 168–174

Filed September 26, 2026 after the owner approved the advisor analysis and requested
implementation tickets. Implementation began the same day; each ticket's status line
records what shipped in source and which release gates remain open.
The owner clarified that routing includes both travel timing and fitting Behaviors
around Calendar events. Occasional adherence tips should use defined analysis lanes
inspired by `packages/core/src/export-prompts.ts`.

Source of truth: `docs/PRODUCT_SPEC.md#planned-advisor-improvements-tickets-168174`,
`docs/plans/first-external-consumer.md`, and the September 26 decision in
`docs/DECISIONS.md`. These tickets extend the existing Daily Brief recipe, shared
horse bubble, server pipeline and workbench. They add no general chat, autonomous
writes, new connector, second model provider or agent framework.

| Ticket | Delivery slice | Dependencies |
|---|---|---|
| 168 | Bounded loading and recoverable presentation | Existing Tickets 147–148 implementation |
| 169 | Analysis evidence contract and bounded source projection | Existing Tickets 146, 156–157 implementation |
| 170 | Travel timing and Behavior scheduling | 169; existing 159 and 162–167 implementation; provider/model-use gates below |
| 171 | Timing, load and Calendar-context patterns | 169; use 170 for concrete timing recommendations |
| 172 | Recurring obstacles and decision-recording patterns | 169; separate source disclosure before optional inputs |
| 173 | Useful prose and occasional, nonrepeating tips | 169–172; 168 for delivery and suppression accounting |
| 174 | Workbench evaluation and staged release acceptance | Review starts alongside 168–173; acceptance follows each delivered slice |

Ticket 168 can ship independently. Ticket 174 carries forward the open checks from
Tickets 147–148, 155 and 161; it does not mark them complete or erase dated evidence.
Ticket 165 retains native travel and provider-use acceptance. Model transmission of
travel evidence remains disabled until its specific clearance and disclosure pass.
Deterministic travel presentation can proceed under the existing reviewed boundary.

Every implementation uses existing `INT-BRIEF-001` through `INT-BRIEF-005`, relevant
`INT-TRAVEL-*` intents, and `module.daily-brief-bubble` in the design-system catalog.
Update those inventories when behavior actually changes, not when filing tickets.
Use impeccable and design-system-bench before UI edits. Update the existing QA records,
glossary, user guidance and platform evidence; do not create a parallel inventory.

### Shared verification for Tickets 168–174

Begin each code slice with a regression or evidence fixture that fails for the
intended behavior. Run its focused checks, then all seven required commands from
`AGENTS.md`. Shared core changes also require `npm run core:check`; reusable UI
requires `npm run design-system:check`, desktop typecheck/build, and desktop/390px
browser QA on the first available loopback port in 4321–4330. Schema changes require
tracked migrations, updated data-model/types, clean local replay and owner-isolation
checks. No runtime or schema change follows from filing this sequence.

Preserve existing live-test instructions: private workbench comparisons remain
owner-clicked. Ticket filing grants no new provider spending, private-data transmission,
hosted migration, deployment or native release authority. Record existing authorization
when exercising those gates; do not substitute synthetic checks for live acceptance.

## Ticket 168: Recoverable Daily Brief loading and presentation

Status: implemented in source September 26, 2026; hosted migration, deployed-web and
installed-desktop recovery evidence remain open under Ticket 174. Filed September 26, 2026.
Dependencies: existing Tickets 147–148 implementation; release evidence in Ticket 174.

Goal: make every enabled advisor request reach a visible result or actionable failure,
without navigation silently consuming the user's opportunity to receive advice.

Scope and acceptance:

- Reproduce the reported failures before assigning a live root cause. Source inspection
  found a daily attempted marker written before success, Timeline-key remounts, silent
  preference failures, and missing effective client deadlines. Preserve these as
  hypotheses until regression evidence establishes the affected paths.
- Bound preferences, installation-ID acquisition, authentication, request and response
  decoding. Compose caller cancellation with the deadline on web and desktop; supplying
  a signal must not disable timeout. Preserve the server's 60-second attempt and
  30-second phase limits. Test the full client deadline with unresolved promises.
- Separate request progress, successful delivery and dismissal. Reuse one in-flight
  attempt and fresh result across same-account page-session remounts. A changed status,
  timer, route or focus must not leave a stuck loader or silently remove recovery.
  Revalidate changed source facts before reusing any result.
- Keep one automatic daily start, server deduplication and existing rate limits.
  Make failed, abandoned and server-completed-but-undelivered attempts recoverable
  through deliberate bounded retry. Never equate server completion with presentation.
  Do not clear quota/admission records or toggle consent to force another request.
- Preserve same-day dismissal and account/date isolation. Do not reopen dismissed
  output. Keep fresh text in memory only. On expiry, withdraw current timing claims
  and retain an honest recovery/expiry state without automatic regeneration.
- Distinguish pending, timeout, offline, authentication, stale context and rate-limit
  outcomes. Honor retry timing and return available recovery guidance. Diagnostics
  may record phase, duration and error code, never prompt, account facts or output.
- Update admission/retention documentation if recovery needs persistent state changes.
  Keep tracking usable throughout; no chat screen, polling loop or background helper.

Implementation references: `components/briefing/DailyBriefLauncher.tsx`,
`components/briefing/DailyBriefBubble.tsx`, `lib/ui/daily-brief.ts`,
`apps/desktop/src/daily-brief.ts`, `lib/services/daily-brief.service.ts`,
`lib/services/daily-brief-request.ts`, `lib/db/daily-brief.repo.ts`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared launcher/client and existing Timeline bubble above; update `INT-BRIEF-001/002/003` when implemented. |
| Desktop | Same launcher plus `apps/desktop/src/daily-brief.ts`; verify navigation, restart, linked-session expiry and offline tracking in 174. |
| Marketing | Not applicable: recovery changes no public capability claim. |
| Future mobile | Mobile web uses the shared launcher; native implementation remains deferred. |

Verification: `npm run test -- tests/daily-brief-lifecycle.dom.test.tsx tests/daily-brief-ui.dom.test.tsx tests/desktop-daily-brief.test.ts tests/daily-brief.service.test.ts tests/daily-brief-route.test.ts`.
Cover remount during generation, stalled requests, dropped delivery, expiry, retry,
parallel tabs, account/consent changes and unchanged dismissal. Apply shared checks.

## Ticket 169: Advisor analysis evidence contract and bounded history

Status: implemented in source September 26, 2026; hosted migration and real-account
evidence remain open under Ticket 174. Filed September 26, 2026.
Dependencies: existing Tickets 146, 156–157 implementation. Enables Tickets 170–173.

Goal: supply small, validated findings to the advisor through explicit analysis lanes.

Scope and acceptance:

- Define a fixed set of lane contracts inside the existing recipe/configuration
  boundary. Reuse export prompt IDs where purposes match. Each lane declares its
  question, required inputs, local-date window, sample threshold, permitted suggestions
  and unsupported-input behavior. Future connectors can satisfy these contracts;
  this ticket implements no connector registry, new connector or arbitrary prompt tool.
- Give findings opaque evidence/source references, scope, counts/denominators where
  relevant, coverage, observation/revision/expiry and explicit limitations. Keep
  confidence tied to stated sufficiency rules, not a model-invented probability.
- Extend the owner-scoped snapshot/revision projection for the lanes in 171–172:
  historical local dates and schedule slots, relevant definition/configuration periods,
  decision chronology and optional reminder/Note inputs. Keep optional sensitive
  sources excluded until 172 implements their disclosure. Read no export/page entry
  point with occurrence-generation or archive side effects.
- Preserve the 90-complete-local-day maximum and existing count/byte/deadline ceilings.
  Apply selected windows before aggregation. Incomplete, capped or absent inputs yield
  unavailable findings, never biased totals. Fence every newly read source revision.
- Reuse status/analytics and completion-timing semantics. Unresolved is missing decision
  data, excluded from adherence failures. Recorded marks are not actual finish times.
  Segment meaningful schedule/definition changes; do not split schedule periods for
  reminder-only or category-only revisions.
- Separate internal source records from selected model findings. Excluded inputs and
  unsupported claims must stay absent from prompts and private-inspector projections.
  Configuration selection cannot grant access. Extend exact validators and version
  fences; document old-config and old-snapshot compatibility.
- Register actual pure analysis owners and paired tests in `docs/AGENT_RESOLVERS.md`.
  Repositories own reads, services own authorization and composition, core owns
  calculations, and the model explains supported findings.

Implementation references: `packages/core/src/types/advisor-day-context.ts`,
`packages/core/src/types/briefing-config.ts`, `packages/core/src/services/briefing-config.ts`,
`packages/core/src/services/advisor-day-context.ts`, `lib/db/advisor-context.repo.ts`,
`lib/services/advisor-day-context.service.ts`, `lib/services/briefing-pipeline.ts`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend the existing snapshot, core projection and hosted pipeline above; 174 verifies exclusions and migrations. |
| Desktop | Shared server findings use synchronized account data; no local-only upload or new sync mechanism. |
| Marketing | Not applicable: internal contracts do not establish a public feature. |
| Future mobile | Reusable core contracts only; no native client implementation. |

Verification: `npm run test -- tests/advisor-day-context.test.ts tests/advisor-day-context.service.test.ts tests/briefing-config.test.ts tests/briefing-pipeline.test.ts tests/briefing-account-context.test.ts`.
Add tests for lane validation, insufficient/capped history, window filtering, source
revision races, two-owner isolation and excluded-field absence. Apply shared checks.

## Ticket 170: Calendar travel timing and Behavior scheduling advice

Status: deterministic display implemented in source September 26, 2026. Model
projection of travel remains disabled pending provider-use clearance and revised
disclosure; native and live gates stay with Tickets 165 and 174. Filed September 26, 2026.
Dependencies: 169 and existing 159, 162–167 implementation. Coordinate with 165 and 174.

Goal: explain departure, onward travel and return constraints alongside feasible
Behavior opportunities in the existing advisor presentation.

Scope and acceptance:

- Reuse the travel resolver's validated legs, occupancy, collisions, mode, freshness
  and provenance. Join owner-matched Calendar and Behavior evidence without trusting
  client-authored routes or invoking extra paid routing merely to generate prose.
  Preserve travel quota, source-change and manual-refresh policy from 166–167.
- Use travel-expanded occupancy when checking Behavior fits, including return where
  known. Unknown legs cannot become zero travel. Missing base suppresses final-return
  advice only; preserve known outbound/onward evidence and current-origin precedence.
- Keep Calendar events fixed. Distinguish a supported gap from permission to move an
  exact Behavior. Generate hypothetical moves only within explicit flexibility and
  permitted windows; calculate all intervals in core, never in the language model.
- Resolve provider-use clearance and revised model-data disclosure before enabling
  timing-only model projection. Raw locations, coordinates, place IDs and provider
  responses remain excluded. Current routing clearance alone does not permit this.
- If model projection remains unapproved, present attributed deterministic travel and
  compatible fit guidance beside the generated brief under the existing display
  boundary. Keep travel-derived facts and recommendations out of model input. Clearly
  distinguish calculated guidance from generated text; do not fabricate a model result.
- Withdraw or label changed/expired timing consistently. Travel refresh must not
  silently regenerate the brief or reset its dismissal. Preserve suggestions-only
  behavior and the existing navigation handoff; add no event-editing or Apply control.

Implementation references: `packages/core/src/resolvers/travel.resolver.ts`,
`packages/core/src/resolvers/briefing-plan.resolver.ts`,
`lib/services/travel-route-refresh.service.ts`, `lib/services/briefing-pipeline.ts`,
`components/briefing/DailyBriefBubble.tsx`, `docs/qa/travel-release.md`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Extend existing core evidence and shared bubble; reuse `INT-TRAVEL-*` and `module.daily-brief-bubble`. |
| Desktop | Consume the same evidence through the linked client; native location/navigation gates remain in 165, briefing acceptance in 174. |
| Marketing | Not applicable: public routing/advisor claims await separately reviewed release evidence. |
| Future mobile | Mobile web shares the evidence and presentation; native routing remains deferred. |

Verification: `npm run test -- tests/travel.resolver.test.ts tests/briefing-plan.resolver.test.ts tests/briefing-pipeline.test.ts tests/daily-brief-consumer.test.ts`.
Cover full trips, missing base/legs, late arrivals, stale evidence, each existing mode,
source/disclosure changes, no extra routing call, fixed schedules and model exclusion
when clearance is absent. Apply shared checks and keep live provider gates explicit.

## Ticket 171: Adherence timing, load and Calendar-context analysis

Status: implemented in source September 26, 2026. The historical Calendar lane
reports unavailable; no historical Calendar read was added. Filed September 26, 2026.
Dependencies: 169; concrete timing suggestions also require 170's feasibility checks.

Goal: identify repeatable adherence difficulties and suggest one supported scheduling
or workload experiment without confusing correlation with cause.

Scope and acceptance:

- Implement lanes inspired by `weekday-time-dips`, `realistic-timing`, `schedule-load`
  and `cross-source-context`. Use current manual outcomes and captured schedule periods,
  account local dates/timezone, and clearly stated lookbacks.
- Compare eligible weekday/slot outcomes with a comparable baseline. Report resolved
  denominators and Unresolved coverage separately. Define and test minimum samples,
  repeatability and material-difference thresholds before a finding becomes eligible.
- Relate scheduled daily load to resolved outcomes while controlling descriptive
  comparisons for weekday and changed schedules. Do not infer a fixed personal capacity
  from a few observations or recommend deleting a Behavior automatically.
- Preserve timing semantics. Marking patterns support statements about logging time,
  not actual performance. Use effective performance times only when their source
  contract supports that meaning; otherwise leave actual-time analysis unavailable.
- Use current Calendar constraints to contextualize today's suggestion. Historical
  Calendar associations require bounded authorized coverage for the compared dates.
  Implement that read through the existing connector if selected; otherwise report the
  historical lane unavailable. Today's agenda cannot explain past adherence failures.
- Produce structured findings with supporting evidence, limitations and a proposed
  experiment. Any concrete new time must pass the deterministic planner. No generic
  coaching, diagnosis, causal claim, streak scoring or status change.

Implementation references: `packages/core/src/resolvers/analytics.resolver.ts`,
`packages/core/src/resolvers/completion-timing.resolver.ts`,
`packages/core/src/resolvers/briefing-plan.resolver.ts`,
`lib/services/advisor-day-context.service.ts`, `lib/services/google-calendar.service.ts`,
`lib/services/briefing-pipeline.ts`, `packages/core/src/export-prompts.ts`.
Proposed shared lane owner: `packages/core/src/resolvers/briefing-analysis.resolver.ts`,
paired with `tests/briefing-analysis.resolver.test.ts`; reuse it in 172.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Shared core analysis and server projection above; 173 presents findings and 174 evaluates usefulness. |
| Desktop | Same hosted findings for synchronized records; no independent native analytics rules. |
| Marketing | Not applicable: no outcome-improvement claim follows from descriptive analysis. |
| Future mobile | Reuse pure findings contracts; native UI remains deferred. |

Verification: add runnable fixtures for each lane to `tests/briefing-analysis.resolver.test.ts`;
extend `tests/briefing-pipeline.test.ts` and `tests/briefing-fixtures.test.ts`.
Cover small/unequal samples, all-Unresolved periods, corrections, schedule changes,
DST/local weekdays, absent historical Calendar and confounded load patterns.
Expected findings must derive from hand-checked data, not the implementation. Apply shared checks.

## Ticket 172: Recurring obstacles and decision-recording analysis

Status: implemented in source September 26, 2026; hosted migration and real-account
evidence remain open under Ticket 174. Filed September 26, 2026.
Dependencies: 169. Optional sources need their implemented disclosure before model use.

Goal: suggest specific ways to reduce recurring obstacles or make decisions easier
to record, using the relevant export-prompt analysis lanes.

Scope and acceptance:

- Implement `decision-debt`, `logging-chronology` and `correction-patterns` from bounded
  history. Resolve revision chains before comparisons. Describe batching and correction
  patterns without treating recorded timestamps as performance times or Unresolved as failure.
- Implement `reminder-effectiveness` using delivered reminder records, with outcome
  and decision-recording rates separated by channel and comparable schedule period.
  Missing delivery coverage is unknown, not proof that no reminder arrived. Treat
  differences as associations; do not send reminders or change reminder preferences.
- Add optional `notes-failure-themes` from nonempty Notes attached to Not Completed
  occurrences. State exactly what Note content reaches the model and obtain revocable
  source-specific disclosure before submission; existing enablement cannot silently
  include Notes. No full-export upload or automatic access to unrelated Notes.
- Bound and validate any semantic theme extraction. Retain source references and
  calculate supporting counts from validated members. Reject unsupported themes,
  sensitive extrapolations and embedded instructions. Minimize quoted private text
  in the displayed tip; do not persist model prompts or generated theme history.
- Keep lanes independently available. A declined or missing optional source must not
  block day planning or other supported findings. Missing data must never invite the
  model to invent a reason. Add only the necessary controls to existing Settings and
  recipe workbench; distinguish input permission from internal configuration.
- Use findings to propose one concrete adjustment, such as a simpler decision moment
  or addressing a repeated obstacle. Do not implement Note shortcuts here; Tickets
  126–128 own that separate behavior. Update disclosures and retention contracts with
  any new source or operational metadata.

Implementation references: `lib/db/advisor-context.repo.ts`, `lib/db/notes.repo.ts`,
`lib/db/reminderDeliveries.repo.ts`, `lib/services/advisor-day-context.service.ts`,
`packages/core/src/resolvers/status.resolver.ts`, `packages/core/src/export-prompts.ts`,
`components/briefing/DailyBriefSettingsPanel.tsx`, `app/design-system/DailyBriefBench.tsx`.
Reuse 171's proposed `packages/core/src/resolvers/briefing-analysis.resolver.ts`
and paired `tests/briefing-analysis.resolver.test.ts` for pure evidence calculations.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Bounded source projections and shared Settings/workbench above; update `INT-BRIEF-004` and disclosures at implementation. |
| Desktop | Same linked-account controls and hosted evidence; unsynced/local-only Notes remain excluded. |
| Marketing | No promotional change; canonical privacy/data-use copy changes only with the implemented optional source disclosure. |
| Future mobile | Mobile web receives accessible shared controls; native controls remain deferred. |

Verification: add paired lane fixtures and extend `tests/briefing-account-context.test.ts`,
`tests/briefing-config.test.ts`, `tests/daily-brief-ui.dom.test.tsx` and consumer tests.
Cover missing/disabled Notes, prompt injection, repeated themes, partial reminder logs,
revision chains, batching, source revocation and zero source writes. Apply shared checks.

## Ticket 173: Actionable Daily Brief prose and occasional tips

Status: implemented in source September 26, 2026 behind the `advisor-analysis`
candidate preset. The production default is unchanged until reviewed promotion
under Ticket 174. Filed September 26, 2026.
Dependencies: 169–172 for evidence; 168 for reliable delivery. Evaluate through 174.

Goal: explain what matters today, what to consider doing, and why, with occasional
adherence tips that earn their place through relevant evidence.

Scope and acceptance:

- Extend the existing Daily Brief recipe and version its policy/configuration. Prefer
  two or three distinct, supported planning points and at most one pattern tip; these
  are ceilings, not quotas. Calibrate the combined word budget in the workbench.
  Empty evidence should stay short; supported advice must not collapse into a neutral
  sentence merely because the old default excluded its inputs.
- Rank timing conflicts, departures and feasible opportunities ahead of historical
  nudges. Each recommendation needs a practical action and a short evidence-based
  reason. Allow the minimal historical comparison needed to explain a tip, while
  retaining the ban on routine ledger recaps, diagnostics and generic encouragement.
- Select a pattern tip only when sample sufficiency, relevance and materiality pass.
  Suppress repeated tips with a documented cooldown and stable finding identity;
  changed evidence may justify a new tip. Evaluate these rules over multiple days,
  not only isolated prompts. Do not require a tip on every opening.
- Use only bounded, account-scoped delivery metadata for repetition control, such as
  finding fingerprint and last-shown date. Define retention and disable/delete cleanup
  before persistence; keep generated text and private source content out of storage.
  Failed, cancelled and workbench-only generations must not consume a tip's delivery.
- Bind every recommendation to supplied findings, source references and any required
  planner option. The model explains evidence; it cannot calculate new route times,
  fabricate correlations, recommend resolved work or claim to apply a change.
- Extend existing workbench controls/inspectors for lane eligibility, selection and
  suppression. Compare configurations over the same frozen facts. Preserve explicit
  Run comparison and reviewed repository promotion; no customer prompt editor.
- Keep the existing responsive horse bubble, clear route provenance, keyboard dismissal
  and polite announcements. Update current UI/user-flow contracts and actual interaction
  evidence when this behavior ships. No chat, scoring system or autonomous action.

Implementation references: `lib/services/daily-brief-consumer.ts`,
`lib/services/briefing-pipeline.ts`, `packages/core/src/data/briefing-presets.json`,
`packages/core/src/types/daily-brief.ts`, `lib/db/daily-brief.repo.ts`,
`components/briefing/DailyBriefBubble.tsx`, `app/design-system/DailyBriefBench.tsx`,
`docs/ontology/briefing-workbench.json`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing recipe, workbench and bubble above; reuse briefing intents and design catalog. |
| Desktop | Same hosted selection/prose and shared bubble; 174 verifies linked/offline and installed behavior. |
| Marketing | Not applicable: no automated public claim or advice publication. |
| Future mobile | Responsive web presentation is in scope; native implementation remains deferred. |

Verification: `npm run test -- tests/daily-brief-consumer.test.ts tests/briefing-pipeline.test.ts tests/briefing-workbench.test.ts tests/briefing-workbench-account.test.ts tests/briefing-workbench.dom.test.tsx tests/briefing-ontology.test.ts`.
Add multi-day selection/cooldown and delivery-failure tests, reference validation,
no-tip and meaningful-tip cases, word-budget compatibility and rollout fencing.
Human wording review remains required under 174. Apply shared checks.

## Ticket 174: Advisor workbench evaluation and staged release acceptance

Status: in progress September 26, 2026. Deterministic fixtures, workbench controls
and synthetic evidence are recorded; owner-clicked comparisons, hosted, deployed-web
and installed-desktop acceptance remain open. Filed September 26, 2026.
Dependencies: review begins alongside 168–173; release acceptance follows delivered slices.
Carry forward open evidence from 147–148, 155 and 161; coordinate travel gates with 165.

Goal: demonstrate reliable delivery and useful, supported recommendations on web
and installed linked desktop before promoting each advisor change.

Scope and acceptance:

- Extend `docs/qa/briefing-workbench.md` and existing fixtures with frozen cases for
  every lane, routing/fit combinations, absent sources, small samples, changed
  schedules, all-Unresolved days, repeated tips, prompt injection and no-issue days.
  Show findings and selection reasons beside candidate outputs in the existing bench.
- Separate deterministic correctness, model wording and live reliability evidence.
  Review whether every tip has an actionable adjustment and sufficient support,
  whether routing and Behavior fits agree, and whether brevity preserves useful
  reasoning. A schema pass or authored sample is not a model-quality pass.
- Verify 168 with stalled preference/model/body reads, navigation during generation,
  server success without delivery, refresh, expiry, manual retry, parallel tabs,
  revoked consent and account changes. Record latency by phase and result code without
  private content. Demonstrate bounded loading and recovery on actual release targets.
- Preserve owner-clicked private comparisons, frozen-snapshot comparisons, memory-only
  private output and allowance separation. Record authorized synthetic-provider,
  owner-account, deployed-web and installed-desktop evidence separately.
- Release 168 independently when its checks pass. Promote later evidence/prose changes
  through the existing reviewed preset/policy mechanism. Preserve existing consent,
  quota and dismissal records; do not force regeneration to demonstrate a rollout.
- Verify optional-source controls, actual model payload exclusions and travel's
  deterministic-display fallback. Unapproved travel projection must remain absent.
  Record native location/navigation limitations under 165 without calling them fixed.
- Record exact configuration/policy/runtime versions, rollout and rollback. Rollback
  must preserve tracking and connector records and stop new optional transmissions.
  Close earlier release gates only with matching evidence; leave unexecuted gates open.

Implementation/evidence references: `lib/services/briefing-fixtures.ts`,
`app/design-system/DailyBriefBench.tsx`, `docs/qa/briefing-workbench.md`,
`docs/qa/in-app-daily-brief.md`, `docs/qa/travel-release.md`,
`interaction-registry.json`, `design-system.manifest.json`, `docs/DESKTOP_PARITY.md`.

Platform impact:

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | Existing workbench plus hosted Timeline and 390px acceptance; update the existing briefing QA records. |
| Desktop | Installed linked-account, restart, unsynced and offline acceptance via `apps/desktop/src/daily-brief.ts` and shared bubble. |
| Marketing | Not applicable: this ticket records evidence; publishing new claims requires separately scoped copy work. |
| Future mobile | Mobile-web acceptance only; native release remains deferred. |

Verification: all shared checks, the expanded deterministic/DOM fixture suites,
reviewed live outputs under existing authority, hosted and installed acceptance,
and rollback. Record actual pass/fail results, remaining gates and reviewer findings.

## Ticket 186: Rename Cadence project folder and GitHub repository

Status: completed October 9, 2026. Local (October 7) and GitHub (October 8) cutovers,
acceptance, native updater check and scheduled Trust run passed.
Owner authorization: execute `docs/plans/2026-10-07-cadence-project-rename.md`,
including the selected archive site preserving exact historical evidence URLs.

Goal: rename the existing local folder and GitHub repository to `cadence`
without losing work, history, deployment identities, or installed-client access.

Acceptance: execute the plan's backup, relocation, archive, updater, deployment,
and rollback gates. Preserve local Supabase identity, hosted account identities,
production domains, desktop bundle identity, keys, and data. Keep unrelated
uncommitted work intact. Retain all immutable evidence URLs and bytes. Record
required checks and scheduled-publication continuity before completion.

Platform impact:

| Platform | Implementation or not-applicable reason |
|---|---|
| Web | Trust history/feed and source URLs; see the plan's exact files and existing interaction registry. |
| Desktop | Release URL constants and legacy native updater compatibility; preserve installed app identity. |
| Marketing | Source/download targets in `apps/marketing/src/data/site.ts`; preserve selected release assets. |
| Future mobile | Not applicable: no mobile implementation or identifiers change. |

Execution evidence: `docs/qa/cadence-project-rename.md`.
