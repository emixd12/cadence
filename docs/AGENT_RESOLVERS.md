# Agent Resolver Registry

This project uses resolver-first development. Every future agent should identify the owning resolver before touching UI, API routes, cron/process routes, or provider integrations.

Run this drift check before considering resolver-affecting work complete:

```bash
npm run resolvers:check
```

## Registry

Tracking implementations live in `packages/core/src/resolvers`. Existing
`lib/resolvers` modules re-export those implementations without changing web
APIs. Public Trust evidence stays in the web runtime. The checker inspects
actual core implementations and verifies each compatibility export.

Core tracking types contain no generated Supabase types. Web row types remain
in `lib/types/database.ts`; FormData action aliases remain in the web Behavior
and Timeline type wrappers. `@cadence/core/types/json` provides the recursive
JSON contract. Relative package imports keep core independent of web aliases.

`npm run core:check` parses imports, exports, dynamic imports, and global access
with the TypeScript AST. It also typechecks every core source with ES libraries
and no DOM or Node ambient types. Runtime dependencies are limited to Temporal
and `ohash/crypto`. Core callers inject clocks and persistence operations.

Ticket 120 adds the pure synchronization planner at
`packages/core/src/resolvers/account-sync.resolver.ts`, paired with
`tests/account-sync.resolver.test.ts`. The planner may
consume only typed local, hosted, and common-baseline snapshots plus explicit
limits and fingerprints. It may emit only typed writes and conflicts. It must
not import or call Supabase, SQLite, Tauri, Keychain, network, filesystem,
browser, environment, UI, or clock APIs. Services own snapshot reads,
idempotency, retries, atomic adapter calls, and baseline advancement. Ticket 116
added the governance contract before the implementation existed. The first-link
service may explicitly identify the untouched-profile hosted-hydration path.
Only that path may preserve an existing same-status hosted status-event branch;
the planner rejects divergent or later branches.

Shared Behavior writes live in `packages/core/src/services/behavior.service.ts`.
`BehaviorDataStore` commits the complete graph, definition/configuration history,
current configuration pointer, and stale marker atomically. Web and desktop
adapters preserve raw definition, graph, and update-time preconditions. Desktop
also checks the native graph revision. Normalized definition predecessors remain
separate from the raw stored predecessor, matching the web RPC contract.

`services/behavior-values` and `services/schedule` contain the existing portable
form-value and display helpers. FormData parsing and action state adapters stay
in the web runtime. `services/behavior-views` and `services/analytics` assemble
the shared Behavior list and selected-day review data. They retain the existing
analytics resolver for date ranges, statuses, adherence, and time summaries.
Desktop reads repair occurrence coverage before assembling these views.

`services/export-assembly` preserves export row normalization and configuration
history guards. `services/export-download` returns text or bytes through an
injected archive adapter. Prompt constants live at `@cadence/core/export-prompts`;
clipboard access remains in the web/runtime adapter. Native reminder exports
use an optional Cadence raw-file extension, with OS state separated from user
receipt and notification text omitted. Web output without native rows remains
unchanged. ZIP adapters share `lib/services/zip-format.ts` bounds and CRC checks.

`services/behaviorlog-existing` assembles the shared current-record snapshot.
`services/behaviorlog-restore-plan` owns the production restore payload builder;
web and desktop call this same implementation. `services/configuration-payload`
owns its web JSON projection. `services/behaviorlog-write-plan` materializes the
reviewed restore actions into full local rows, using existing definition and
configuration resolvers. `services/behaviorlog-import-plan` projects accepted
merge actions into full local rows. It mirrors the production August 27 SQL
import and portability wrapper; the web still executes that SQL planner. This
remaining duplicate projection requires common SQL/SQLite fixtures before
claiming import parity. Matching and conflict decisions remain in the existing
import resolver. Tests-only legacy write loops are not desktop dependencies.

Desktop preview/apply adapters bind archive bytes, local data and preview
fingerprints to the native preview ledger. Native apply accepts no replacement
row payload. Import mode selection binds a previously unbound preview once;
retries use the stored plan. Restore requires backup, typed confirmation and
sensitivity acknowledgements. Imported interventions remain passive history.
The normal post-commit repair is separate from import apply; imported delivery
history never creates an operational reminder or provider call.

`@cadence/core/hash` preserves SHA-256 UTF-8 hexadecimal output, including lone
surrogate replacement. The browser dependency branch is bundled and checked
against Node with 139 vectors. Existing export/import/restore fixtures remain
unchanged. The canonical BehaviorLog schema lives only at
`packages/core/src/behaviorlog.schema.json`.

| Domain | Owner resolver | Allowed callers | Forbidden bypasses | Source docs | Required test | Drift check |
|---|---|---|---|---|---|---|
| Recurrence expansion | `packages/core/src/resolvers/recurrence.resolver.ts` | `lib/services/occurrence.service.ts`, resolver tests | React components, API routes, Supabase repositories, provider adapters, direct `Date` arithmetic | `docs/RECURRENCE_RULES.md`, `docs/DATETIME_STRATEGY.md` | `tests/recurrence.resolver.test.ts` | Resolver must not import React, Next, Supabase, browser globals, provider clients, or env vars. |
| Occurrence generation and repair planning | `packages/core/src/resolvers/occurrence.resolver.ts` | `lib/services/occurrence.service.ts`, resolver tests | Database inserts inside resolver, UI deciding future occurrence or repair windows, API routes deduplicating occurrences, UI expanding or repairing behavior schedules or time entries | `docs/DATA_MODEL.md`, `docs/RECURRENCE_RULES.md` | `tests/occurrence.resolver.test.ts` | Generated occurrence and explicit repair plans must be pure; repository owns persistence and unique constraints. Schedule normalization returns `valid`, single-parent `repairable`, or typed `invalid` results. Active empty or ambiguous persisted graphs cannot be filtered into a successful no-op or fresh horizon. Multiple valid schedules expand through their own recurrence and time entries; duplicate candidates with the same behavior, local date, start time, and end-time/range identity merge before persistence. The Ticket 060 migration may mirror recurrence rules only for its one-time idempotent repair and must retain parity fixtures. |
| Behavior definition history planning | `packages/core/src/resolvers/behavior-definition.resolver.ts` | `packages/core/src/services/behavior.service.ts`, web/desktop Behavior adapters, resolver tests | UI or repositories comparing title/description revisions, schedule/reminder/category/archive/timezone edits creating definition events, database writes inside the resolver | `docs/DATA_MODEL.md`, `docs/PRODUCT_SPEC.md`, `docs/EXPORT_FORMATS.md` | `tests/behavior-definition.resolver.test.ts` | Initial events always mark title changed and mark description changed only when it is non-null; edits compare trimmed title/description values, append only for changed definition fields, and retain full previous/next text in the plan. Source is `manual`, `import`, or `system`; user-entered reasons remain schema-only in this ticket. |
| Behavior configuration history planning | `packages/core/src/resolvers/behavior-configuration.resolver.ts` | `packages/core/src/services/behavior.service.ts`, desktop graph normalization, `lib/services/settings.service.ts`, `lib/services/behaviorlog-import-write.service.ts`, `lib/services/behaviorlog-restore.service.ts`, resolver tests | UI or repositories comparing configuration snapshots, client-supplied prior state being trusted, schedule IDs defining semantic equality, database access or clock reads inside the resolver | `docs/DATA_MODEL.md`, `docs/RECURRENCE_RULES.md`, `docs/DATETIME_STRATEGY.md` | `tests/behavior-configuration.resolver.test.ts` | Baselines contain every field in the existing configuration-history vocabulary; optional default duration and end date remain current Behavior metadata, with live end-date guards in atomic occurrence writers. Revisions compare normalized category, complete ID-free schedule graph, reminder settings, active state, and timezone. Stable JSON keys, weekday order, local-time shape, and schedule sort order define equality. Stored timezone aliases are preserved. Callers inject recorded/effective instants; no-op changes return null. SQL re-derives locked prior and committed next snapshots before inserting append-only events. |
| Desktop account synchronization planning | `packages/core/src/resolvers/account-sync.resolver.ts` | `apps/desktop/src/sync-engine.ts`, account-sync services, resolver tests | Network, Supabase, SQLite, Tauri, Keychain, filesystem, environment, UI, or clock access; adapters choosing winners; applying a nonconflicting subset while any conflict remains | `docs/DESKTOP_BUILD.md`, `docs/DESKTOP_DATA_MODEL.md`, `docs/TICKETS.md` | `tests/account-sync.resolver.test.ts` | The planner consumes normalized local, hosted, and saved common-baseline entities. It synchronizes only Ticket 116 fields, preserves domain revisions, removes ownership identity, bounds every collection to 100,000 rows and the complete snapshot to 64 MiB, emits deterministic preconditioned writes, and fails closed with zero writes when any conflict remains. The explicit untouched-profile first hydration may preserve hosted same-status status-event branches; divergent or later branches still fail. |
| Timeline grouping | `packages/core/src/resolvers/timeline.resolver.ts` | `lib/services/timeline.service.ts`, Timeline UI via service output, resolver tests | Components deriving Needs decision, components filtering prior unresolved or same-day retained decided items, components calculating multi-time grouped completion labels, stored `needs_decision` or partial status | `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `docs/DATETIME_STRATEGY.md` | `tests/timeline.resolver.test.ts` | UI must receive grouped data or call a service; no `/dashboard` model. Multi-time behavior groups keep row-specific statuses and do not show progress labels. Same-day Needs decision retention is derived from `status_marked_at` and local midnight, without a stored flag. |
| Optimistic Timeline status projection | `packages/core/src/resolvers/timeline-optimistic-status.resolver.ts` | Timeline client service and UI state adapter, resolver tests | Components duplicating status projection or changing committed history | `docs/UI_SPEC.md` | `tests/timeline-optimistic-status.test.ts` | The resolver projects pending UI state without persistence; confirmed service output remains authoritative. |
| Occurrence time tracking | `packages/core/src/resolvers/time-tracking.resolver.ts` | `lib/services/time-tracking.service.ts`, `packages/core/src/resolvers/timeline.resolver.ts`, Timeline display formatting, resolver tests | Components deciding start/stop/reset eligibility, services doing instant arithmetic, repositories calculating durations, status/reminder mutation from time controls | `docs/PRODUCT_SPEC.md`, `docs/DATA_MODEL.md`, `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `docs/DATETIME_STRATEGY.md` | `tests/time-tracking.resolver.test.ts` | Temporal instants and explicit `now` own current-day and visible Needs decision start eligibility, start, stop, stopped-session totals, formatting, and reset planning. The Timeline resolver may call the eligibility helper. The service owns authentication, owner-scoped persistence, and idempotent race recovery. UI may call only the formatting helper for its display-only once-per-second counter. |
| Status transitions | `packages/core/src/resolvers/status.resolver.ts` | `lib/services/occurrence.service.ts`, resolver tests | Buttons mutating status rules directly, automatic missed state, repositories deciding status semantics | `docs/USER_FLOWS.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md` | `tests/status.resolver.test.ts` | Stored status remains `unresolved`, `completed`, or `not_completed`; Needs decision remains derived; status-event semantics are planned by the resolver and persisted by the service. |
| Reminder delivery planning | `packages/core/src/resolvers/reminder.resolver.ts` | `lib/services/reminder.service.ts`, resolver tests | Sending email/push in resolver, provider SDK imports, API routes calculating delivery offsets | `docs/NOTIFICATION_SPEC.md`, `docs/SEQUENZY_WORKFLOW.md` | `tests/reminder.resolver.test.ts` | Resolver returns delivery records only; services send and record results idempotently. |
| Native reminder selection and verified coverage | `packages/core/src/resolvers/native-reminder.resolver.ts` | Desktop reminder services and native boundary bench adapters, resolver tests | UI choosing capacity or claiming coverage from requested IDs, OS calls or clock reads inside resolver | `docs/DESKTOP_BUILD.md` | `tests/native-reminder.resolver.test.ts` | Inject `now`, target horizon, and non-negative integer capacity. Compare actual pending ID, instant, title, and body against every eligible request. Unknown readback is always unverified. Coverage stops before the first missing time group. |
| Analytics calculations | `packages/core/src/resolvers/analytics.resolver.ts` | `packages/core/src/services/analytics.ts`, web/desktop analytics adapters, Behaviors review UI via service output, resolver tests | Components calculating adherence or timing durations/averages, components filtering behavior date review rows, unresolved counted as failed completion, gamified streak logic | `docs/UI_SPEC.md`, `docs/PRODUCT_SPEC.md`, `docs/DATA_MODEL.md` | `tests/analytics.resolver.test.ts` | Unresolved is separate and excluded from final adherence unless docs change. Analytics owns stopped-session totals per occurrence, selected-range behavior averages, and selected-day timing summaries using time-tracking resolver duration helpers. Behavior date review rows include all occurrence statuses for the selected behavior and local date so UI can reuse status, note, and reset services without recalculating the data contract. |
| Export formatting | `packages/core/src/resolvers/export.resolver.ts` | `lib/services/export.service.ts`, export API routes via service output, resolver tests | API routes hand-formatting CSV/JSONL/BehaviorLog files, UI building export records, repositories deciding export shape | `docs/EXPORT_FORMATS.md`, `docs/DATA_MODEL.md` | `tests/export.resolver.test.ts` | JSONL, app-native CSV, full JSON, BehaviorLog core JSONL, optional BehaviorLog CSV views, optional BehaviorLog Intervention Profile records, and AI summary stay doc-compatible. |
| BehaviorLog import validation and merge preview | `packages/core/src/resolvers/behaviorlog-import.resolver.ts` | `lib/services/behaviorlog-import.service.ts`, `lib/services/behaviorlog-import-write.service.ts`, resolver tests | Database writes inside the resolver, destructive restore/merge logic, API routes parsing JSONL or deciding conflicts, treating occurrence `current_status` as history, using imported notes for status/adherence/reminder/analytics calculations, writing imported-intervention rows inside the resolver, writing reminder deliveries during import apply, provider calls from imported intervention rows | `docs/EXPORT_FORMATS.md`, `docs/DATA_MODEL.md`, `docs/NOTIFICATION_SPEC.md` | `tests/behaviorlog-import.resolver.test.ts`, `tests/behaviorlog-import-merge-preview.test.ts`, `tests/behaviorlog-import-interventions.test.ts`, `tests/behaviorlog-import-notes.test.ts`, `tests/behaviorlog-import-intervention-history.test.ts` | Import validation and merge preview are dry-run/plan-only; create-only and user-approved merge product writes are service/repository-owned and must consume a valid accepted preview. Merge preview emits deterministic `create_new`, `map_to_existing`, `skip_existing`, and `conflict_requires_decision` decisions plus stable conflict codes. Status history comes from `status_events.jsonl`, while `current_status` remains a snapshot. Optional notes preserve role, sensitivity, source metadata, source original id, timestamps, and attachment target; non-AI behavior, occurrence, status-event, and review notes may plan passive `imported_notes` rows. Occurrence notes may additionally plan inline safe-fill only when the target is safely identified and the local note is empty. High/restricted note sensitivity requires warnings and apply acknowledgement, and AI-generated notes are skipped. Optional interventions are parsed, hash/reference/channel/status validated, summarized by channel/status/linked behavior, and marked `preview_only`; preview shows passive `imported_interventions` storage decisions plus dropped/redacted sensitive fields. Accepted applies may write passive imported-intervention history through services/repositories, but must not create reminder deliveries, schedule/send/cancel/retry/claim reminders, or call Sequenzy/Web Push/provider APIs. Unknown core top-level fields are validation errors and app-specific fields must live under `extensions`. |
| BehaviorLog restore preview/apply | `packages/core/src/resolvers/behaviorlog-restore.resolver.ts` | `lib/services/behaviorlog-restore.service.ts`, Export restore UI via service output, resolver/service/UI tests | Merge preview standing in for destructive restore decisions, database writes inside the resolver, UI deciding create/replace/archive/delete/keep/skip actions, converting unresolved to `not_completed`, restoring auth/profile/provider/browser state, writing reminder deliveries, sending/cancelling reminders, provider calls | `docs/EXPORT_FORMATS.md`, `docs/DATA_MODEL.md`, `docs/USER_FLOWS.md` | `tests/behaviorlog-restore.resolver.test.ts`, `tests/behaviorlog-restore.service.test.ts`, `tests/behaviorlog-restore-apply.service.test.ts`, `tests/behaviorlog-restore-ui.test.tsx` | Restore preview is preview-only and separate from merge preview. It consumes a validated BehaviorLog import plan plus the current user-owned local graph and emits machine-readable create, replace, archive, delete, keep, and skip actions for behaviors, schedules, occurrences, status events, inline occurrence notes, passive imported notes, and passive imported interventions. Destructive actions are flagged explicitly. Preview includes non-restorable account/provider/browser fields, sensitivity warnings, redacted intervention summaries, status-history policy planning with `preserve_append_only_history` as default, local/bundle/preview fingerprints, and no product data mutation. Restore apply is service-owned, gated by a valid accepted preview, matching fingerprints, backup acknowledgement, typed confirmation, and sensitivity acknowledgement when relevant. CSV views do not drive restore decisions, status events remain authoritative, and occurrence `current_status` remains a snapshot only. |
| Imported intervention promotion | `packages/core/src/resolvers/imported-intervention-promotion.resolver.ts` | `lib/services/imported-intervention-promotion.service.ts`, resolver/service tests, future explicit UI or API contract via service output | Import preview/apply writing operational deliveries, UI deciding eligibility, repositories deciding current reminder setting matches, promotion routes calling providers or reminder processing routes, promotion of past/resolved/inactive/mismatched records | `docs/NOTIFICATION_SPEC.md`, `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, `docs/USER_FLOWS.md` | `tests/imported-intervention-promotion.test.ts` | Promotion is separate from BehaviorLog import apply. The resolver requires explicit selected imported-intervention ids and confirmation, filters to future pending reminder interventions, compares against current `resolveReminderDeliveries` output, and returns delivery plans with import provenance only. Services own user-scoped reads/writes and must not call Sequenzy, Web Push, browser APIs, provider SDKs, or notification-processing routes. |
| Public trust evidence validation and freshness | `lib/resolvers/public-trust-evidence.resolver.ts` | Evidence workflow scripts, future Trust services/routes/UI through normalized output, resolver tests | UI or routes inventing statuses, publishers omitting failed or unavailable checks, mutable evidence links, environment or deployment reads inside the resolver | `schemas/public-trust-evidence.schema.json`, `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`, `docs/VERCEL_WORKFLOW.md` | `tests/public-trust-evidence.resolver.test.ts` | Validation requires all nine checks, exact snapshot subjects, sanitized fields, immutable commit- or workflow-run-pinned evidence URLs, and fixed check-specific deadlines. Consumers inject the current source and deployment identifiers plus `now`; only matching unexpired Passed results remain Passed. Failed, Stale, Not run, and Unavailable remain visible. |

## Native reminder coverage contract

`planNativeReminderRequests` consumes current Behavior and Occurrence records.
It reuses the existing reminder offset/status rules, maps the native reminder
intent from `browser_reminder_enabled`, and never enables email delivery.
Stable request IDs are `cadence.local.<occurrence UUID>`.
`apps/desktop/src/local-reminder.service.ts` owns SQLite intent transactions,
OS calls, readback, bounded nearest-first repair, and verification receipts.
Generation includes advance offsets plus a day for timezone transitions.
Imported offsets above one year fail visibly instead of claiming coverage.

`selectNativeReminderRequests` accepts requests with `id`, `title`, `body`, and
`fireAt`, plus injected Temporal `now`, `targetThrough`, and `capacity`. It
returns the nearest eligible requests, ordered by instant then ID. Capacity
must be a non-negative safe integer; the resolver assumes no platform limit.

Past requests remain ineligible. Future instants round upward to whole seconds
because native calendar triggers retain seconds. This prevents early delivery.
The rounded instant must remain within `now < fireAt <= targetThrough`.
Requests that round beyond the horizon wait for a later planning window.

`assessNativeReminderCoverage` receives all requests, not only the selected
subset, and the actual pending readback. Pending timestamps may be null; those
requests cannot verify coverage. Non-null timestamps must match the canonical
expected instant exactly. Pending timestamps are never rounded to hide a
readback mismatch. Titles and bodies must also match exactly.

`scheduledCount` counts verified expected requests, including matches after a
gap. `missingIds` lists expected requests without a verified match.
`scheduledThrough` is the last fully covered instant before the first missing
time group, or `now` when none exists. A partly retained same-time group does
not advance coverage. Complete coverage extends to `targetThrough`, including
a known empty expected set. A null pending readback always returns `unverified`,
zero verified requests, and coverage through `now`, even for an empty expected
set. Duplicate IDs and invalid instants fail rather than silently collapsing.

## BehaviorLog Conformance Harness

`tests/behaviorlog-conformance.test.ts` materializes a BehaviorLog bundle
generated by `packages/core/src/resolvers/export.resolver.ts` as a temporary `.behaviorlog/`
directory, runs `scripts/behaviorlog-conformance.mjs`, and then confirms the
same files remain readable by the dry-run import resolver.

The script runs the pinned upstream `emixd12/BehaviorLog-Bundle`
`reference/validate.mjs` snapshot stored under
`tests/fixtures/behaviorlog-reference/`. The snapshot source commit and date are
recorded in `tests/fixtures/behaviorlog-reference/SNAPSHOT.md`; update that file
when intentionally adopting a newer upstream conformance contract.

## Current implementation state

The registry reflects the implemented resolver set in this repository. All
listed resolver files and paired tests exist, with restore apply covered at the
service/UI boundary because destructive database work is orchestration rather
than pure resolver logic.

`npm run resolvers:check` enforces the registry shape and resolver purity
constraints.

## Layer ownership

Repositories in `lib/db`:

- Query and mutate Supabase.
- Enforce SQL-level constraints through migrations and RLS.
- Do not perform business calculations.

Services in `lib/services`:

- Orchestrate repositories and resolvers.
- Enforce auth and user scoping.
- Prepare data for UI, API routes, and cron/process routes.
- Own external side effects such as Sequenzy and Web Push adapters.

Resolvers in `lib/resolvers`:

- Own calculations, grouping, state planning, and formatting.
- Are pure or nearly pure.
- Receive clock/timezone context explicitly.
- Are unit-tested.

`export.resolver.ts` owns timing-session filtering, derived stopped-session
durations, deterministic export formatting, and default omission. The export
service owns the owner-scoped timing repository read and must not call it unless
the explicit time-tracking option is enabled.

UI components and pages:

- Display data.
- Call server actions/services.
- Do not duplicate recurrence, reminder, analytics, export, or status logic.

API and cron/process routes:

- Validate request/auth/secret.
- Call services.
- Return responses.
- Do not duplicate business logic.

## Review rule

Before finalizing a task, inspect whether logic was duplicated across:

- UI
- API routes
- Services
- Cron/process routes
- Repositories

If duplicated, centralize in a resolver or service and update tests.

## Source-of-truth resolution

When files disagree, resolve in this order:

1. `AGENTS.md`
2. `STATUS.md` for current implementation state only
3. `docs/DECISIONS.md`
4. `docs/DATETIME_STRATEGY.md`
5. `docs/SUPABASE_WORKFLOW.md` and `docs/SEQUENZY_WORKFLOW.md` for provider operations
6. `docs/PRODUCT_SPEC.md`
7. `docs/DATA_MODEL.md`
8. `docs/RECURRENCE_RULES.md`
9. `docs/UI_SPEC.md`
10. `docs/USER_FLOWS.md`
11. `docs/NOTIFICATION_SPEC.md`
12. `docs/EXPORT_FORMATS.md`
13. Existing tests
14. Existing implementation
15. Current ticket prompt, when it intentionally changes scope

`docs/FUTURE_UPDATES.md` describes deferred work and must not override v1 source-of-truth docs unless a future task explicitly moves that work into scope.

If a current user prompt intentionally changes the product, update the relevant docs in the same task.

## Adding a resolver

When adding a resolver:

1. Create the resolver file listed in the registry.
2. Create the paired test file listed in the registry.
3. Keep inputs/outputs serializable unless Temporal values are explicitly part of the local resolver contract.
4. Keep Supabase calls, provider SDK calls, browser APIs, and env reads out of the resolver.
5. Add or update service/repository code only after the resolver contract is clear.
6. Run `npm run resolvers:check`, `npm run test`, `npm run typecheck`, and `npm run build`.


### Archive notes

`packages/core/src/resolvers/archive-note.resolver.ts` owns archive note parsing,
normalization, append, and text replacement. Services inject IDs and timestamps.
The resolver has no I/O or clock access. Behavior services, export/import
resolvers, account-sync validation, and tests may call it. Paired checks live in
`tests/archive-note.resolver.test.ts`; see Ticket 125 and `docs/DATA_MODEL.md`.

## Note shortcuts (Tickets 126–128)

`packages/core/src/resolvers/note-suggestion.resolver.ts` owns source eligibility,
normalization, repeated-text matching, evidence thresholds, expiry, suppression,
and review transitions. `tests/note-suggestion.resolver.test.ts` pairs its boundary
checks. Shared `services/note-shortcut.service` orchestrates the owner-scoped
`NoteShortcutStore`; web and desktop adapters perform atomic reads and CAS writes.
UI, API, repositories, and native code must not independently derive patterns.
No network, storage, environment, clock reads, or UI may enter this resolver.

## Day-progress contract ownership (Tickets 132–137)

Ticket 132 established the pure contracts and accepted synthetic baseline.
Tickets 133–136 implemented the production Timeline callers. Ticket 134 extends
the existing event types through the documented
`docs/EXTERNAL_EVENT_CONTRACT.md` schema/validation boundary. Register any new
pure owner with paired tests; current runtime owners are listed below.

| Domain | Owner resolver | Allowed callers | Forbidden bypasses | Source of truth | Required test | Drift check |
|---|---|---|---|---|---|---|
| Day-progress layout | `packages/core/src/resolvers/day-progress.resolver.ts` | Synthetic design bench, shared Timeline UI, web/desktop services, and resolver tests | UI calculating independent dot/span mappings, changing actual times for collision spacing, fixed 24-hour local days | `docs/UI_SPEC.md`, `docs/DATETIME_STRATEGY.md` | `tests/day-progress.resolver.test.ts` | Geometry and injected instants only; no DOM, clocks, providers, or writes |
| Duration and external context | `packages/core/src/resolvers/timeline-context.resolver.ts` | Shared Timeline assembly, owner-scoped web/desktop services, synthetic fixtures, and resolver tests | Averaging sessions instead of Occurrences, treating unknown as zero, running samples, automatic decisions or schedule writes | `docs/PRODUCT_SPEC.md` | `tests/timeline-context.resolver.test.ts` | Positive stopped Completed totals, optional default duration, explicit unknown/freshness, half-open timed overlaps |
| Briefing analysis lanes | `packages/core/src/resolvers/briefing-analysis.resolver.ts` | `lib/services/briefing-pipeline.ts`, the private workbench through that pipeline, synthetic fixtures, and resolver tests | Components, API routes, provider adapters or prompts computing rates, treating Unresolved as failure, splitting periods at reminder/category-only revisions, reading undisclosed sources, or claiming causes | `docs/TICKETS.md` | `tests/briefing-analysis.resolver.test.ts` | Selected window before aggregation, stated sufficiency/materiality thresholds, capped or undisclosed inputs unavailable, weekday strata for load |
| Travel itinerary and occupancy | `packages/core/src/resolvers/travel.resolver.ts` | Owner-scoped routing services, Timeline/advisor projections, synthetic fixtures, and resolver tests | Provider I/O, location reads, moving schedules, treating unknown travel as zero, or returning raw points in evidence | `docs/TICKETS.md`, `docs/plans/travel-departure-discovery.md` | `tests/travel.resolver.test.ts` | Injected instants, revision fences, exact route segments, half-open collisions, and timing-only model projection |

- `packages/core/src/resolvers/timeline.resolver.ts` retains day selection,
  Needs decision, Occurrence status projection, and future-range ownership.
- `packages/core/src/resolvers/day-progress.resolver.ts`, paired with
  `tests/day-progress.resolver.test.ts`, owns monotonic time anchors, collision
  layout, and dot/span positions from explicit dates, `now`, and geometry inputs.
  UI may measure rows and render output; it must not duplicate temporal rules.
- `packages/core/src/resolvers/timeline-context.resolver.ts`, paired
  with `tests/timeline-context.resolver.test.ts`, owns estimate eligibility,
  half-open interval overlap, unknown-duration handling, and activity labels.
  Reuse existing time-tracking totals and analytics mean logic without changing
  current analytics semantics. Do not duplicate duration rules per platform.
- Shared Timeline assembly and web/desktop services may call these pure
  resolvers. Services supply owner-scoped history and normalized event inputs.
  Provider adapters own Google payload validation, consent, token lifecycle,
  network access, pagination, and refresh. Repositories/native boundaries own
  atomic storage; services own cache expiry, freshness, and disconnect cleanup.
- Resolvers receive injected clocks and typed data. They never read Google,
  Supabase, Keychain, SQLite, DOM, network, environment, or global clock APIs.
  Overlap output cannot authorize schedule, status, reminder, or provider writes.

Core wildcard exports expose these new contracts directly. Existing web resolver
compatibility exports and current Timeline APIs remain unchanged. The new
contracts do not establish provider, native, or production UI acceptance.

## Travel contract ownership (Tickets 162–165)

`packages/core/src/resolvers/travel.resolver.ts` owns immediate-origin precedence,
journey-scoped corrections, direct itinerary legs, known occupancy segments and
half-open collision evidence. Services resolve points and call providers. The
resolver receives injected instants, source revisions and grant revisions.

`TravelEvidenceResult` is safe for API and UI use. It excludes route requests,
coordinates, place IDs and saved location text. Its optional model projection
contains timing and collision facts only. Callers must keep that projection
disabled until Ticket 165 clears provider/model use.

## Day-progress production consumers (Tickets 133–136)

`DayProgressTimeline` consumes the shared day-progress layout resolver and the
timeline-context resolver. Web and local Timeline services supply bounded
90-day occurrence/session history through `resolvePersistedTimeline`. Core returns
per-Behavior estimates; presentation does not calculate sample eligibility.
Provider adaptation and validated scheduling projection live in the external-event
contract modules. No Calendar text or geometry drives recurrence or status writes.

## Advisor context ownership (Tickets 146–148)

Ticket 146's day-context service reuses Timeline, duration, status, and
external-event validation/projection owners. The API in Ticket 147 must call that
service, never duplicate domain rules or query tables directly. Pure projection
and validation receive typed input and injected time. Repositories own bounded,
consistent owner-scoped reads; services own consent, source freshness, and errors.

Existing Timeline/export page entry points perform archive/generation maintenance.
The advisor service must not reuse those side effects under read permission.
Incomplete coverage produces a typed result, not generation or status writes.
Connector credential/health bookkeeping remains explicitly separate from tracking
and provider-event mutation.

`packages/core/src/services/advisor-day-context.ts` owns the minimized projection
and exact runtime contract. `lib/db/advisor-context.repo.ts` owns the snapshot
and revision RPC reads. `lib/services/advisor-day-context.service.ts` owns
assembly, bounds, deadlines, and revalidation. The disabled route currently
imports only `lib/services/advisor-auth.service.ts` and never reads context.
`lib/services/daily-brief-consumer.ts` now owns internal provider-neutral
generation and output validation; it performs no domain mutation.

The September 20 in-app correction reopens Ticket 146 for bounded completion
history, using existing analytics/status rules. Ticket 147 adds first-party
generation and one server provider adapter over this internal service. The model
receives validated facts and has no domain services or tools. Ticket 148 owns
only automatic invocation and presentation in the horse bubble. Refactor or retire
the external HTTP consumer instead of routing the server through its own HTTP API.
These owners are implemented in source; live release evidence remains separate.

The in-app implementation calls `daily-brief.service.ts` from thin briefing routes.
`daily-brief.repo.ts` owns session-bound preferences/admission and active Behavior
IDs. `daily-brief-consumer.ts` validates facts/output through a provider-neutral
callback; `daily-brief-openai.ts` owns the only model HTTP call. These modules cannot
call tracking mutations. Shared `types/daily-brief.ts` contains no provider SDK types.
Completion counts belong to the existing core context projection, with contract,
service, repository/migration and model-adapter tests. UI clients render validated
text, read-only suggestions and trusted source metadata.


## Briefing configuration, references and planning (Tickets 151–155)

Scope and acceptance remain in `docs/TICKETS.md`.

`packages/core/src/services/briefing-config.ts` owns exact versioned configuration
validation and authorized scope intersection. `briefing-presets.json` stores only
repository configuration. Shorter history filters daily records before aggregation
in the existing context service; duration estimation retains its labeled 90-day window.

`packages/core/src/resolvers/briefing-plan.resolver.ts` owns deterministic, bounded,
read-only proposals and evidence-based routing. Its paired test is
`tests/briefing-plan.resolver.test.ts`. The allowed caller is
`lib/services/briefing-pipeline.ts`; UI and API routes cannot calculate proposals.
Calendar intervals remain fixed. Exact Behavior schedules require explicit
hypothetical movability. Unknown duration and incomplete/stale coverage cannot
establish available time. Every output carries source/configuration revisions and expiry.

Ticket 159 separates day evidence from move options. The same planner detects
supported overlaps and tight transitions without movable selections. Configured
windows and selected durations support individual fit observations only with
complete relevant coverage. Resolved work stays out of remaining-work evidence.
Day evidence never grants move permission. The existing inspector retains full
evidence and rejection details; the model explains ranked supported findings.
No travel evidence enters this boundary until its separate release gates pass.

`packages/core/src/data/briefing-references.json` stores the editable curated catalog.
`packages/core/src/services/briefing-references.ts` validates its metadata and owns
selection omissions and trusted source metadata. `daily-brief-consumer.ts` validates
structured suggestions against supplied source and option IDs. The model has no
retrieval or mutation capability. ID validation never establishes research support.

`lib/services/briefing-workbench.service.ts` accepts two validated configurations and
either one known synthetic fixture or an explicit authenticated My account request.
Both modes require the development/loopback/same-origin boundary. Synthetic mode
never reads account data. Account mode uses `briefing-account-context.service.ts`,
which also owns production briefing authorization, source checks and expiry checks.
`readAdvisorDayContexts` captures one raw snapshot and projects one or two history
windows before aggregation. The single-context API remains a compatibility wrapper.
Planning uses the frozen capture clock; a live clock still enforces expiry.
The comparison path never calls daily generation begin/finish admission. Existing
bounded read-admission metadata remains separate from tracking writes and the daily
allowance. The bench retains private results and account selections only in memory.

The workbench guide renders `docs/ontology/briefing-workbench.json` and the actual
preset/reference documents. Ontology terms link back to owning contract symbols;
they explain rules without calculating or overriding them. The paired ontology test
checks links and contract coverage. Repository editing remains outside the browser;
the guide exposes no filesystem write API or model-generation path.

### Recipe projection and duration sources (Tickets 156–158)

`resolveBehaviorDurationSources` in the existing timeline-context resolver exposes
configured defaults, eligible historical means and stopped elapsed totals. Its
compatibility wrapper preserves Timeline estimate behavior. The advisor service
reuses this owner and opts into raw totals only when a configuration requests them.
It never derives finish time from a status-update timestamp. Existing 90-day,
three-sample, running-session exclusion and capped-history rules still apply.

`projectBriefingContext` in `services/briefing-config.ts` owns the recipe's model
projection. It removes resolved work/status fields, excluded sources and raw duration
candidates. The internal planner uses selected duration sources with retained manual
state. `prepareBriefing` returns selected facts and input decisions to the private
inspector; it does not return internal context. `daily-brief-consumer.ts` serializes
that same selected projection and owns Daily Brief policy 2.1 instructions.
Recipe/policy versions contribute to the effective revision and result metadata.

## Historical completion timing resolver

`packages/core/src/resolvers/completion-timing.resolver.ts` owns sample eligibility,
deduplication, local clock conversion, circular median and sufficiency. Allowed
callers: `lib/services/advisor-day-context.service.ts`, synthetic
`lib/services/briefing-fixtures.ts`, and tests. UI, repositories and model prompts
must not recompute timing patterns. Paired tests:
`tests/completion-timing.resolver.test.ts`, `tests/briefing-completion-timing.test.ts`.
The strict context validator checks summary scope, counts, ranges and provenance;
`projectBriefingContext` removes deselected Behavior and timing facts.

## Advisor analysis ownership (Tickets 168–174)

Implemented in source September 26, 2026. `docs/TICKETS.md` owns acceptance.

- Ticket 168: `components/briefing/DailyBriefLauncher.tsx` and
  `lib/ui/daily-brief-session.ts` own presentation state and page-session reuse;
  `lib/ui/daily-brief.ts` owns bounded transport for web and desktop.
  `daily-brief.repo.ts` keeps admission ownership; presentation markers cannot
  override server quotas or disclosure fences.
- Ticket 169: `lib/db/advisor-analysis.repo.ts` reads the revision-fenced analysis
  snapshot. `lib/services/briefing-analysis-source.ts` projects it into opaque lane
  records; `briefing-account-context.service.ts` composes the read, disclosure
  gating, revision fence and tip fingerprints. Configuration selection never grants
  a source; the database enforces optional-source disclosure.
- Tickets 171–172: `packages/core/src/resolvers/briefing-analysis.resolver.ts` owns
  lane contracts, finding calculations and `selectBriefingTip`, paired with
  `tests/briefing-analysis.resolver.test.ts`. Allowed caller:
  `lib/services/briefing-pipeline.ts` (and the workbench through it).
  `packages/core/src/services/briefing-analysis.ts` owns the model projection of the
  one selected finding and the deterministic evidence line.
- Ticket 170: `packages/core/src/services/brief-travel-guidance.ts` projects existing
  `travel.resolver.ts` evidence for display beside the brief, paired with
  `tests/brief-travel-guidance.test.ts`. It never routes or estimates. Travel stays
  out of model input; the model never recomputes intervals.
- Ticket 173: `briefing-pipeline.ts` selects findings; `daily-brief-consumer.ts`
  validates the tip and drops quoted or unsupported Note themes;
  `daily-brief.service.ts` records a tip only after a completed, current attempt.
  Workbench runs never read or record tip history.
- Ticket 174: `lib/services/briefing-analysis-fixtures.ts` supplies synthetic
  scenarios. Neither snapshot capture nor analysis calls Timeline/export
  maintenance or mutates source records.

No component, API route, provider adapter or prompt computes rates, fits or travel
intervals. These tickets add no connector registry, new connector or agent runtime.
