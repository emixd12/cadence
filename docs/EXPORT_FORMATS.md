# Export Formats

## BehaviorLog 0.3 parity contract

BehaviorLog exports now use `0.3.0-draft`. Readers retain compatibility with
`0.1.0-draft` and `0.2.0-draft`; older-version examples remain compatibility
fixtures, not declarations of the current writer version.

- `data/behavior_configuration_events.jsonl` carries the app-neutral
  Configuration History Profile. Import/restore preserve validated history
  without applying old configurations or replaying notifications.
- Schedule anchors are independent of configuration-period starts. Exact
  effective bounds, historical-reference roles, parent grouping, and captured
  occurrence lineage use standard fields. Unknown lineage remains unknown.
- Export preserves stored seconds and fractional seconds. Import retains
  precise history but skips unsupported subminute schedule execution with a
  warning. Unsupported independent interval anchors and generating bounds
  also produce explicit skips instead of silent schedule changes.
- All-time archives read every saved occurrence, including future dates and
  already-recorded decisions, notes, and selected time sessions. Export does
  not generate a new future horizon. Date-limited exports remain bounded.
- Imported passive notes and interventions retain their original attribution
  and timestamps on re-export. Current inline notes remain a separate surface.
- Passive Intervention history accepts the standard channel and delivery-status
  values, including native `other` / `delivered`. Stored `pending` still exports
  as standard `planned`. Import discloses omitted extension metadata, including
  native scheduler identifiers. None of these records schedules a notification.
- Native notification observations use Intervention records with `channel:
  other` and a native-channel extension. OS identifiers and verification
  metadata remain extensions. Neither observation nor verification proves
  user reading.
- Current reminder rules preserve disabled intent. Historical deliveries do
  not link to incompatible current offsets.
- Desktop recognizes current native reminder rules only with the explicit
  `app.cadence.native_notification` hint. Web skips those unsupported rules.
  Neither adapter replays historical native Interventions.
- Category registries remain a manifest extension, including unused source
  category names and ordering.
- Synthesized success definitions and approximate note timestamps carry
  explicit transformation notes and appropriate source confidence.
- `rules.exchange` declares partial fidelity and known limits. Cadence does
  not claim arbitrary lossless profile/extension support. Unsupported optional
  data produces preview loss warnings; unsupported required extensions block
  operational import.

The existing applied-import ledger preserves only bounded, validated portable
configuration records, source occurrence metadata, and fingerprints of captured
schedule fields. Replaying original schedule dates requires an applied ledger,
owned Behavior and slot mappings, an exact captured schedule fingerprint, and
unchanged current recurrence, anchor, timezone, time shape, and active state.
Current configuration-period dates remain the normal comparison. Legacy
ledgers without this proof cannot establish a date alias; mismatches remain
explicit conflicts. The ledger does not store raw
archive bytes. The 8 MiB metadata limit fails explicitly instead of
truncating history. Notes retain the existing user-consent gates. Original
history is preservation-only; it does not become invented local capture history.

Repeated export/import/restore recognizes earlier exchanged configuration IDs
only when the mapped Behavior and complete captured content/provenance agree.
Occurrence lineage follows the retained ID. Independent source IDs remain
distinct, and conflicting captures that reuse a source ID are both preserved.

The Cadence raw configuration file remains a compatibility view, not
the portable source of truth. Native OS registrations remain non-replayable.

## Goals and export surfaces

Exports should be easy to read by:
- ChatGPT or another AI assistant
- A spreadsheet
- A future restore/import process

Exports are also part of Cadence's public-product posture: the app should act
as a practical producer and demonstration surface for the BehaviorLog Bundle
standard.

V1 export types:
- JSONL
- CSV
- Full JSON backup
- BehaviorLog bundle
- Markdown AI summary

Exports should support download and copy where practical.

Export options should include:
- Last 7 days
- Last 30 days
- Last 90 days
- All time
- Include archived behaviors
- Include occurrence notes, off by default. Download API routes use
  `include_notes=1` to opt in.
- Include time tracking, off by default. Exact session timestamps can reveal
  activity patterns. Only `include_time_tracking=1` opts in; disabled exports
  do not read timing rows or expose timing fields, files, counts, or filenames.

Behavior definition and configuration history has a separate privacy posture
from occurrence notes. Full JSON and BehaviorLog exports include full prior and
next title, description, schedule, reminder, category, timezone, and active
values by default for every included behavior. The Markdown summary includes
history counts and agent guidance, but does not repeat the historical values.
Historical definitions and configuration can contain sensitive context, so the
Export & Import screen discloses this default before download. There is no
separate history option.

Full JSON also preserves optional user-authored `location_text` and the
Behavior Where (`where_kind`: `null` for Not set, `anywhere`, `home` or `place`;
Ticket 215) on each Behavior and in prior and next configuration snapshots.
Snapshots recorded before Where read as `place` when they have location text.
JSONL, CSV, Markdown, and BehaviorLog omit saved location text and Where. The
BehaviorLog raw Cadence configuration view removes `location_text`, `where_kind`
and their changed-field markers before writing. No export format includes Ticket 216
completion place labels, place markers, their settings or suggestion dismissals;
inclusion is a backlog decision. Travel settings and the saved base are preserved by
the native SQLite backup. They are not part of the hosted App JSON artifact,
which has no JSON restore input.

## JSONL

One event per line.

Occurrence event:

```json
{"type":"occurrence","local_date":"2026-06-05","scheduled_for":"2026-06-05T22:00:00-04:00","schedule":"10:00 PM","behavior_title":"Brush teeth","category":"Grooming","status":"completed","status_marked_at":"2026-06-05T22:08:00-04:00","note":null}
```

Occurrence `note` remains present in the app-native JSONL shape. It is `null`
unless the include-notes option is selected.

JSONL occurrence rows are current snapshots. `status_marked_at` is the latest
mark on that snapshot, not the complete decision trail.

App-native JSONL remains a compact snapshot format. It does not include
behavior definition events, behavior configuration events, or Occurrence
configuration-event lineage. Use Full JSON or BehaviorLog when history is
needed. Configuration-history export does not change JSONL fields or ordering.

When time tracking is selected, JSONL appends ordered `time_session` records
with session, occurrence, and behavior IDs, start/stop instants, and nullable
`duration_seconds`. Running sessions retain a null stop and duration.
Markdown reports stopped-session count and recorded total per behavior, then
averages the summed stopped-session total for each timed occurrence. It never
lists exact session timestamps.

Behavior event:

```json
{"type":"behavior","behavior_title":"Brush teeth","category":"Grooming","description":"Night brushing","recurrence_rule":{"frequency":"daily","interval":1},"scheduled_time":"22:00","schedules":[{"id":"schedule-1","recurrenceRule":{"frequency":"daily","interval":1},"timeEntries":[{"id":"slot-1","kind":"exact","preset":null,"startTime":"22:00","endTime":null,"sortOrder":0,"label":"10:00 PM"}],"sortOrder":0}],"schedule_slots":[{"id":"slot-1","kind":"exact","preset":null,"startTime":"22:00","endTime":null,"sortOrder":0,"label":"10:00 PM"}],"browser_reminder_enabled":true,"email_reminder_enabled":false}
```

Category event:

```json
{"type":"category","name":"Grooming","sort_order":2}
```

## CSV

Occurrence CSV columns:
- local_date
- scheduled_for
- schedule
- behavior_title
- category
- status
- status_marked_at
- note

CSV should open cleanly in spreadsheet software.

The `note` column remains present. Note cells are empty unless the
include-notes option is selected.

CSV rows are current snapshots. `status_marked_at` must not be interpreted as
complete status history.

CSV does not include behavior definition events, behavior configuration events,
or Occurrence configuration-event lineage. Use Full JSON or BehaviorLog when
history is needed. Configuration-history export does not change CSV columns or
ordering.

When time tracking is selected, CSV adds `tracked_duration_seconds`,
`time_session_count`, and `time_sessions`. The latter is one escaped JSON array
of included raw sessions per occurrence. Stopped sessions alone contribute to
the derived total.

Cadence neutralizes spreadsheet formula prefixes in CSV columns that can carry
user-controlled free text. Before normal CSV quoting, a protected cell whose
first non-whitespace character is `=`, `+`, `-`, or `@` receives a leading
apostrophe. Protected app-native columns are behavior title, category, and
note. Protected BehaviorLog projections are behavior title, description,
category, success definition, and status-event reason code. Machine-generated
structured values such as signed UTC offsets, timestamps, stable IDs, and
status vocabulary remain exact. JSON and JSONL exports retain the original
text unchanged.

## Full JSON backup

Shape:

```json
{
  "exported_at": "2026-06-05T18:00:00-04:00",
  "profile": {
    "timezone": "America/New_York"
  },
  "categories": [],
  "behaviors": [],
  "occurrences": [],
  "status_events": [],
  "behavior_definition_events": [],
  "behavior_configuration_events": []
}
```

This is an app-native backup of categories, behaviors, occurrence snapshots,
and the append-only `occurrence_status_events` history for exported
occurrences. The `occurrences` array remains the current snapshot surface.
Use `status_events` to analyze corrections or logging chronology:

- `recorded_at` is when Cadence logged the explicit decision.
- `effective_at` is the decision's stated effective time when present.
- `revises_event_id` links a correction to the latest prior event when known.

The additive `status_events` root preserves compatibility for existing readers
of the unchanged category, behavior, and occurrence snapshot arrays. BehaviorLog
remains the interoperable and restore-oriented export format; its
`data/status_events.jsonl` remains the authoritative standard record.

Each Full JSON Occurrence includes nullable
`behavior_configuration_event_id`. A non-null value identifies the captured
configuration event that governed generation. Legacy null values mean Cadence
did not capture verified lineage. Readers must not substitute the Behavior's
current recurrence as historical fact.

`behavior_definition_events` is the append-only history for behavior title and
description definitions. Each record includes:

When time tracking is selected, Full JSON also adds the optional root
`time_sessions`. Each raw session includes a nullable derived
`duration_seconds`; running sessions remain null. The root is omitted entirely
when time tracking is not selected.

- `id` and `behavior_id`
- full `previous_title` and `next_title` values
- full `previous_description` and `next_description` values
- canonical `changed_fields` in `title`, then `description` order
- `recorded_at`, `source`, optional schema-only `reason`, `created_at`, and
  `updated_at`

Events are filtered to behaviors included by the archived-behavior option. The
complete event trail for those behaviors is included even when the selected
occurrence range is 7, 30, or 90 days. Events sort by `recorded_at`, then `id`,
so equal-timestamp exports remain deterministic. Baseline events use the
behavior creation time and preserve the initial definition with null previous
values.

`behavior_configuration_events` is the complete append-only configuration
history for included Behaviors. Each record contains `event_kind`, full
`previous_configuration` and `next_configuration` snapshots, canonical
`changed_fields`, `recorded_at`, `effective_at`, `effective_local_date`,
timezone, source, and reason code. Configuration snapshots contain category,
optional user-authored Behavior location, schedule graph, browser/email
reminder settings, reminder offset, active state, and timezone.

Configuration history follows archived-Behavior filtering but ignores the
selected Occurrence date range. Events sort by `recorded_at`, then `id`.
Repository reads use fixed-high-water keyset pagination so the Data API row cap
cannot silently truncate history. The exporter fails loudly if either
definition or configuration history for one export exceeds 100,000 events.
Exactly 100,000 events is supported. A captured 100,001st event is rejected.

All unbounded export-side list reads complete before resolver formatting.
PostgREST range reads continue in deterministic 1,000-row pages until a short
page, while definition, configuration, and historical time-session reads keep
their fixed-high-water keyset contracts. Every materialized list fails loudly
above 100,000 rows or on duplicate/non-advancing pagination. Export never
substitutes the Data API cap for a record count. Manifest, summary, Full JSON,
and raw-file counts derive from the completed in-memory arrays, so their counts
remain the true artifact counts.

Behavior records include `schedules[]` as the current app-native schedule
structure. `recurrence_rule`, `scheduled_time`, and `schedule_slots` remain in
app-native exports for backward compatibility with old records and older tools.
Full JSON Behavior records include nullable `where_kind` and `location_text`.
Other export formats omit both.
Occurrence `note` values are `null` unless the include-notes option is selected.

## BehaviorLog bundle

The BehaviorLog bundle is the interoperability export. It is downloaded as
`.behaviorlog.zip` and contains:

- `manifest.json`
- `schema.json`
- `README.md`
- `AGENTS.md`
- `data/behaviors.jsonl`
- `data/schedules.jsonl`
- `data/occurrences.jsonl`
- `data/status_events.jsonl`
- `data/notes.jsonl` when include-notes is selected and exported occurrences
  contain notes
- `data/interventions.jsonl` when exported occurrences have reminder deliveries
- `data/intervention_rules.jsonl` when at least one included Behavior has an
  enabled reminder channel
- `data/behavior_definition_events.jsonl`
- `data/time_sessions.jsonl` only when time tracking is selected
- `raw/cadence/behavior_configuration_events.jsonl`
- `csv/behaviors.csv`
- `csv/schedules.csv`
- `csv/occurrences.csv`
- `csv/status_events.csv`

Core alignment rules:

- `manifest.schema_version` is `0.3.0-draft`, and `schema.json` is the canonical
  upstream schema rather than a Cadence variant.
- `manifest.profiles` uses canonical identifiers. Notes remain optional core
  data. Reminder rules or deliveries add `intervention`, definition events add
  `definition_history`, configuration events add `configuration_history`, and
  selected timing sessions add `time_tracking`.
- Status vocabulary is `unresolved`, `completed`, and `not_completed`.
- `occurrences.jsonl` includes `current_status` as a snapshot only.
- `status_events.jsonl` is the status-history source of truth.
- Local analysis should use `local_date` plus an IANA `timezone`.
- UTC timestamps are used for ordering events.
- Required files are listed in `manifest.json` with SHA-256 hashes.
- App-specific fields live under the `app.cadence` extension namespace.
- `data/behavior_definition_events.jsonl` carries the sorted definition trail
  through the standard Definition History Profile. The first included event
  per Behavior is a baseline; later events are revisions with full previous
  and next title/description snapshots. The manifest declares
  `rules.definition_history_policy: "event_sourced"`.
- `raw/cadence/behavior_configuration_events.jsonl` is an optional, hashed
  Cadence-specific file. It contains the same deterministically sorted records
  as Full JSON `behavior_configuration_events` except saved Behavior locations,
  Where and their changed-field markers are removed. It has `required: false`
  and no core schema reference. The manifest extension declares its path,
  count, `recorded_at`/`id` ordering, and `export_only` history-replay support.
- Core schedules are segmented only when `schedule_graph`, `timezone`, or
  `active` changes. Reminder-only and category-only revisions remain in the
  configuration history files and do not split schedule periods.
- Historical schedule IDs use the configuration event that started the period
  plus semantic schedule and time-entry positions. Core period bounds remain
  local dates. Exact effective instants, anchors, schedule roles, grouping,
  and occurrence configuration-event IDs use standard fields. Cadence semantic
  positions and lineage confidence remain under `extensions.app.cadence`.
- Occurrences with captured lineage reference the schedule period that governed
  their configuration event. Every exported `schedule_id` resolves to a core
  schedule record. Legacy null-lineage Occurrences reference a one-local-date,
  daily placeholder copied from the Occurrence schedule snapshot. Its Cadence
  extension declares medium lineage confidence, `historical_recurrence:
  unknown`, and `import_role: historical_reference_only`. It never claims the
  current recurrence as verified history.
- If an included archived Behavior's captured current configuration is an
  active-false baseline or boundary, BehaviorLog emits one current-configuration
  carrier per schedule/time entry. The carrier uses the same local date for
  `active_from_local_date` and `active_until_local_date`. Its Cadence extension
  sets exact `effective_from_utc` and `effective_until_utc` to the boundary
  instant, `configuration_active: false`, and `period_semantics:
  inactive_current_configuration_carrier`. This transports the retained current
  graph for safe inactive round-trip. It does not claim activity before history
  capture or reopen the schedule period.
- `data/time_sessions.jsonl` is the optional standard Time Tracking Profile
  file. It includes only sessions attached to occurrences in the selected range
  and archived-Behavior scope. Records contain session, occurrence, and
  Behavior IDs plus start/stop instants. They do not contain derived duration.
  Running sessions keep `stopped_at_utc: null`. Its presence requires
  `privacy.contains_time_tracking: true`.
- `data/intervention_rules.jsonl` contains one enabled reminder rule per
  enabled Behavior channel. Rule IDs are deterministic, and
  `offset_minutes` is the negated Cadence reminder offset. Intervention records
  reference the matching enabled rule. Reminder flags remain duplicated under
  `extensions.app.cadence` for backward compatibility.

The upstream standard lives at:
`https://github.com/emixd12/BehaviorLog-Bundle`
- Core record top-level fields must match the BehaviorLog core schema; custom
  producer fields belong under `extensions`.
- CSV files under `csv/` are optional Level 2 migration views. They are derived
  from the matching authoritative JSONL records, include stable ID columns for
  joins, and are listed in `manifest.json` as `required: false` with
  `media_type: "text/csv"`.
- If app-specific extension data appears in a CSV view, it is encoded in one
  `extensions` JSON string column instead of expanding producer-specific fields
  into top-level CSV columns.
- Reminder deliveries are exported through the optional Intervention Profile as
  `data/interventions.jsonl`. Intervention records reference exported
  `behavior_id` and `occurrence_id`, preserve reminder channel, planned time in
  `planned_for_utc`, sent time, delivery status, and sanitized failure reason,
  and keep Cadence-specific delivery metadata under `extensions.app.cadence`.
  Cadence `pending` deliveries export as canonical `planned`; `sent`, `failed`,
  and `cancelled` remain unchanged. Bundles never emit `pending`.
- Intervention records must not include email bodies, push payload bodies, API
  keys, provider secrets, raw push endpoints, browser subscription keys, or other
  sensitive transport details.

If a resolved occurrence has no internal status event, the exporter may emit a
derived medium-confidence status event from the occurrence snapshot so legacy
rows remain interoperable.

### BehaviorLog import validation, tracking, and create-only apply

The import path can read a `.behaviorlog.zip`, validate bundle structure, and
return a dry-run plan. The tracking layer persists auditable import runs and
external-to-local record mappings. Create-only apply may write product data only
for records that remain `action: "create"` in a valid dry-run preview and only
when the import run mode is `create_missing_only`.

Required bundle files:

- `manifest.json`
- `schema.json`
- `README.md`
- `AGENTS.md`
- `data/behaviors.jsonl`
- `data/schedules.jsonl`
- `data/occurrences.jsonl`
- `data/status_events.jsonl`

`data/notes.jsonl` is optional.

`data/behavior_definition_events.jsonl` is parsed by import, merge, and restore.
Cadence replays the complete baseline and revision trail for created or restored
Behaviors. A local import baseline is generated only when the bundle has no
portable baseline for that Behavior. Unmappable events are skipped with a
warning.

`data/behavior_configuration_events.jsonl` preserves validated configuration
history through the applied-run ledger. The optional raw Cadence view retains
its hash validation and export-only replay contract. Import and restore use only core
schedules marked `extensions.app.cadence.import_role:
current_configuration` to build the current Behavior schedule graph. They skip
`historical_reference_only` schedules as generating schedules. New dependent
historical Occurrences import or restore with their schedule kind,
preset, and start/end snapshot intact and a null
`behavior_schedule_slot_id`; their status history and notes remain attached.
Merge preserves an existing Occurrence's slot link when an explicit record ID,
source ID, or accepted mapping identifies it and its saved kind, preset, and
start/end snapshot match the historical schedule. Behavior, UTC instant, local
date, and timezone must still match. Same-time records alone cannot establish
this historical identity, and missing saved snapshots cannot authorize it.
This prevents a daily-to-weekly export from becoming simultaneous daily and
weekly schedules while preserving Occurrence portability.

`data/time_sessions.jsonl` is parsed by import, merge, and restore. Cadence
replays safely mapped sessions. A running session is skipped with a warning
when the target Occurrence already has a running session.

Import validation rules:

- Validate `manifest.json` format, schema version, listed files, and SHA-256
  hashes for every listed file.
- Accept `0.1.0-draft`, `0.2.0-draft`, and `0.3.0-draft`. Legacy `0.1.0-draft`
  interventions use `scheduled_send_at_utc` and `pending`. Canonical
  `0.2.0-draft` and `0.3.0-draft` interventions use `planned_for_utc` and `planned`. Both forms
  normalize to Cadence's internal scheduled timestamp and `pending` status.
  A `0.2.0-draft` or `0.3.0-draft` intervention that still uses `pending` is invalid.
- Parse the standard definition-history and time-session files when present.
  Unmappable rows become skip actions with warnings.
- Validate JSONL parsing with file and row errors that can be shown to the user
  later.
- Validate supported record types for behavior, schedule, occurrence,
  status-event, and optional note rows.
- Parse optional `data/notes.jsonl` rows with note role, sensitivity label,
  source metadata, source original id, created/updated timestamps, and
  attachment target preserved in the preview plan.
- Reject unknown top-level fields in core records. The preview may still report
  them in `unsupportedFields`, but the bundle is not valid unless custom fields
  are moved under `extensions`.
- Map parsed rows into an internal dry-run plan with records that would be
  created or skipped.
- Detect likely conflicts with existing local behaviors, occurrences, and
  status events, but do not resolve them in this milestone.
- Preserve status semantics, source capture method, source confidence, and
  `revises_event_id` from `status_events.jsonl`.
- Treat `occurrences.jsonl` `current_status` as a current snapshot only.
  Status history comes from `status_events.jsonl`.
- Use `local_date` plus IANA `timezone` for day grouping and conflict preview.
- Require each occurrence `local_date` to equal the date derived from
  `scheduled_for_utc` in its timezone.
- Require each occurrence schedule to belong to the same behavior as the
  occurrence. The database enforces the same relationship for persisted slots.
- Reject duplicate intervention ids before preview or apply.
- Return counts, warnings, conflicts, unsupported fields, and skipped records in
  the preview.
- Optional `data/interventions.jsonl` files are parsed for an Intervention
  Profile preview. The importer validates JSONL rows, record type, manifest
  hash, channel, delivery status, and behavior/occurrence references, then
  marks every intervention as `preview_only`.
- Intervention preview returns counts by reminder channel, delivery status, and
  linked behavior. It also warns when rows contain message bodies, raw
  endpoints, provider identifiers or secrets, subscription keys, recipient
  identifiers, or similar sensitive delivery payload.
- Intervention preview must show the passive history fields that will be stored
  in `imported_interventions` and the sensitive delivery fields that will be
  dropped or redacted. Intervention preview must not create
  `reminder_deliveries`, schedule sends, cancel sends, retry sends, call
  Sequenzy, call Web Push, or call any notification provider.

Import tracking rules:

- Each preview or apply attempt can create one `behaviorlog_import_runs` row.
- Import runs record bundle format, schema version, manifest SHA-256, a
  deterministic bundle fingerprint, producer name/version, subject id strategy,
  privacy redaction level, import mode, dry-run summary snapshot, status, and
  start/completion timestamps.
- Import run status values are `previewed`, `applied`, `failed`, and
  `cancelled`.
- Import modes are `preview_only`, `create_missing_only`, `merge_preview`,
  `merge_by_user_approved_plan`, `restore_preview`, and `restore_apply`.
- `behaviorlog_import_record_mappings` maps external BehaviorLog ids to local
  Cadence ids by import run and record type.
- Mapping record types are `behavior`, `schedule`, `occurrence`,
  `status_event`, `note`, and `intervention`.
- Mapping inserts are idempotent for the same import run, record type, and
  external id. Later import phases should reuse these mappings instead of
  inventing separate provenance stores.
- Create-only and approved-merge apply use one database transaction. A unique
  accepted-preview fence permits one applied run, and a concurrent duplicate
  returns that run's stored result. Failed product writes roll back before the
  apply ledger is marked failed.

Create-only apply rules:

- Create missing behaviors from `data/behaviors.jsonl` when they have at least
  one compatible schedule.
- Match imported behavior categories to existing local categories by normalized
  name. Do not create categories in this import mode.
- Create compatible schedule slots from `data/schedules.jsonl` using Cadence's
  supported recurrence and schedule-slot model.
- Supported recurrence profile is `behaviorlog.calendar_simple.v1` with daily,
  every N days, weekly weekdays, every N weeks on weekdays, and monthly day-N
  rules.
- Exact schedules use `local_time`. Range schedules use
  `window_start_local`/`window_end_local`; preset labels such as morning,
  afternoon, evening, and night are optional Cadence metadata.
- Create missing occurrences from `data/occurrences.jsonl` as `unresolved`
  first.
- Append imported `data/status_events.jsonl` rows into
  `occurrence_status_events` and then update occurrence `status`,
  `completed_at`, and `status_marked_at` from the latest imported event for
  that occurrence.
- A resolved `current_status` snapshot without a supporting status event remains
  a warning; the importer does not synthesize explicit history from the
  snapshot.
- Reapplying the same accepted create-only import run must not duplicate
  behaviors, schedules, occurrences, status events, or mappings.
- Create-only apply may store non-AI behavior, occurrence, status-event, and
  review notes in `imported_notes` after their attachment target is created or
  mapped. Occurrence-attached notes may also fill `occurrences.note` only when
  the imported occurrence is safely identified and the local note is empty.
- Create-only apply may store `data/interventions.jsonl` rows as passive
  `imported_interventions` history with sanitized failure reasons, source
  metadata, redaction indicators, external behavior/occurrence ids, and local
  ids when known.
- Create-only apply must not merge, overwrite, restore, delete, import CSV-only
  data, write `reminder_deliveries`, or trigger notification/provider side
  effects. It may replay supported standard definition-history, time-tracking,
  and intervention-rule data. Imported intervention promotion is a separate
  explicit selected-and-confirmed workflow after passive history exists.

Merge-preview rules:

- Merge preview uses authoritative JSONL files under `data/`; CSV files remain
  optional derived views and are ignored for merge decisions.
- Merge preview emits deterministic actions for each imported core record:
  `create_new`, `map_to_existing`, `skip_existing`, or
  `conflict_requires_decision`.
- Conflict codes and human-readable reasons must be stable enough to present
  for user review and to feed a later user-approved merge plan.
- Behavior comparisons use existing import mappings, source original id,
  title/category identity, archive state, and compatible schedule shape.
- Behavior title/category identity uses the authoritative BehaviorLog category
  for cross-product matching. When both the imported and local records also
  provide a Cadence display category, that display category must match too;
  canonical `health_wellness` does not make `Medical` and `Measurements`
  interchangeable.
- Schedule comparisons use mapped behavior, recurrence profile, recurrence
  payload, timezone, active date bounds, and exact-time or preset range slot.
- Occurrence comparisons use mapped behavior/schedule plus
  `scheduled_for_utc`, `local_date`, and timezone.
- Status-event comparisons use external event id, mapped occurrence, recorded
  time, status, status semantics, and revision target.
- `status_events.jsonl` remains the status-history authority. The occurrence
  `current_status` field is a snapshot only, and unresolved is never converted
  to a failure state.
- The merge-preview output includes a privacy/profile summary, including
  redaction level and whether notes or interventions are present.
- Optional notes are previewed with role, sensitivity/source metadata, source
  original id, timestamps, attachment target, and a storage decision. Non-AI
  behavior, occurrence, status-event, and review notes can plan passive
  `imported_notes` rows. AI-generated notes are skipped with warnings.
- Note identity is account-scoped by external id and attachment. A matching
  attachment and body maps to the existing note; a different attachment or
  body is a conflict.
- High or restricted note sensitivity must produce a preview warning and require
  explicit privacy acknowledgement before the note can be accepted for import.
- Import preview must distinguish an inline occurrence-note fill from a general
  passive imported note record. If a mapped or created target occurrence has an
  empty local note, merge preview may emit an inline safe-fill decision in
  addition to the passive note-record decision. If the local note is non-empty
  and differs, preview still plans the passive imported note row but must not
  plan an inline replacement.
- `data/interventions.jsonl` rows may plan passive imported intervention
  history. Merge preview must show stored fields, dropped/redacted sensitive
  fields, and no reminder-delivery/provider side effects.
- A generated merge preview may be stored in `behaviorlog_import_runs` with
  `import_mode = 'merge_preview'`; this write is limited to the import ledger
  and must not mutate product records.

User-approved merge apply rules:

- Applying a merge plan requires an import run with
  `import_mode = 'merge_by_user_approved_plan'` and an accepted Ticket 020
  `mergePreview` snapshot stored in `dry_run_summary`.
- Apply is bound to one persisted accepted `merge_preview` run. The request
  must identify that run and provide its bundle, local-data, and combined
  preview fingerprints; server-side verification rejects any unaccepted,
  missing, stale, altered, or mismatched preview data rather than silently
  recomputing a replacement plan.
- The resulting apply run retains the accepted preview-run reference and
  accepted preview fingerprint for audit. Raw bundle contents remain outside
  the import-run ledger.
- Apply refuses plans that still contain `conflict_requires_decision`.
- `create_new` actions use the same compatibility checks as create-only import.
- `map_to_existing` actions create provenance mappings without overwriting local
  behavior, schedule, or occurrence fields, except for accepted occurrence-note
  safe fills described below.
- Imported status events are append-only. The current occurrence snapshot is
  updated only after appending events and only when the imported event is latest
  by effective time, recorded time, and stable id tie-breaker.
- Ambiguous or lower-confidence imported events must not replace an existing
  local explicit high-confidence status decision.
- Accepted note actions store non-AI BehaviorLog notes as `imported_notes`
  records. Note mappings use the imported note row id.
- Accepted note actions may additionally fill `occurrences.note` only for
  occurrence-attached, non-AI notes when the target occurrence is safely
  identified and the current local note is empty.
- Note apply must not update occurrence status fields, status events, analytics
  inputs, adherence logic, reminder deliveries, or provider state.
- Accepted intervention actions store passive `imported_interventions` rows and
  provenance mappings. They must not write operational reminder-delivery rows,
  claim reminders, or call notification providers. Imported intervention
  promotion remains separate from merge apply and must require its own selected
  imported-intervention ids plus explicit confirmation.
- Merge apply is idempotent for the same accepted preview. Product writes and
  their mappings commit together, and failed attempts leave no product rows
  before the import run is marked `failed`.

User-facing import UI rules:

- The authenticated Export & Import screen at `/export` is the first-class
  import entry point.
- Uploads must be `.behaviorlog.zip` bundles; unsupported files should fail
  before preview.
- The compressed archive ceiling is 3 MiB. Cadence authenticates
  the account before it reads archive entries, then rejects archives with more
  than 128 entries, an extracted entry larger than 32 MiB, more than 64 MiB
  extracted in total, or an entry whose declared compression ratio exceeds
  100:1. These bounds apply to import and restore, including accepted-preview
  apply.
- The Next.js Server Action request ceiling is 4.25 MiB. A 3 MiB ZIP is
  4 MiB when base64-encoded, leaving 256 KiB for multipart fields and staying
  below Vercel's 4.5 MB Function request cap.
- Apply transports the base64 archive once in the submitted form. Action state
  retains only the SHA-256 fingerprint of the exact archive bytes accepted at
  preview. Apply recomputes that fingerprint, refuses a mismatch, and still
  re-parses and re-validates the submitted archive authoritatively.
- Preview persists an import-run ledger row and must not write product records.
- The UI must show validation output, dry-run counts, privacy notes,
  sensitivity warnings, intervention preview counts, passive intervention
  storage counts, dropped/redacted intervention field summaries, unsupported
  field counts, conflicts, merge actions, imported-note record counts, and
  inline occurrence-note fill counts before apply.
- High or restricted sensitivity notes require a dedicated acknowledgement
  before apply.
- Create-only apply is available only for valid dry-runs with no unsafe merge
  decisions.
- Merge apply requires supported safe actions, no unresolved conflict actions,
  and explicit user confirmation.
- Apply controls operate only on the exact accepted preview shown in the
  current review state. If the bundle or local data changes, the UI must show
  the server refusal, keep the prior preview available for review, and require
  a new preview before another apply attempt.
- Raw uploaded bundle contents are not stored in the import-run ledger.
- The Export & Import screen must disclose that standard definition history and
  safely mapped time sessions replay. Standard configuration history is retained
  passively; raw Cadence configuration history remains export-only.
  Historical Occurrences remain detached from
  inactive historical schedules.
- Do not add full restore, destructive overwrite, generalized notes browsing, or
  intervention-to-reminder writes in this UI milestone.

### BehaviorLog restore preview

Restore preview is separate from create-only import and user-approved merge. It
is for understanding what a trusted BehaviorLog backup would do before any
destructive restore can be considered.

Restore preview rules:

- Restore preview must use a dedicated restore resolver, not merge preview.
- Preview accepts validated BehaviorLog bundle files plus the current
  user-owned local graph needed for comparison.
- Preview is read-only for product data. It may persist an import-run ledger row
  with `import_mode = 'restore_preview'`, but it must not create, update,
  archive, delete, overwrite, deduplicate, schedule, send, cancel, or claim
  product records or reminders.
- Preview emits machine-readable create, replace, archive, delete, keep, and
  skip actions for behaviors, behavior schedule slots, occurrences, occurrence
  status events, definition events, time sessions, inline occurrence notes,
  passive imported notes, and passive imported intervention-history records.
- Each action flags whether it is destructive. Replace, archive, and delete are
  destructive.
- Preview includes stable bundle, local-data, and preview fingerprints. A future
  restore apply must require the same preview fingerprint and refuse stale local
  data.
- BehaviorLog is behavior-data portability, not a full account image. Restore
  preview must state that auth identity, profile email, browser permissions,
  push subscriptions, provider accounts, provider secrets, and external
  provider state are not restored.
- JSONL is authoritative. CSV views are optional compatibility files and do not
  drive restore decisions.
- `status_events.jsonl` is authoritative for status history.
  `occurrences.jsonl.current_status` remains a current snapshot only.
- `unresolved` remains unresolved and must never be converted to
  `not_completed`.
- The default status-history policy is `preserve_append_only_history`.
  `replace_status_history` may appear only as a previewed future policy until a
  later ticket implements and verifies destructive apply behavior.
- High or restricted imported notes produce sensitivity warnings.
- Intervention preview keeps showing stored passive-history fields plus
  dropped/redacted sensitive fields. Restore preview must not write operational
  `reminder_deliveries` or call Sequenzy, Web Push, browser APIs, provider SDKs,
  or notification-processing routes.
- Unsupported schema versions, unsupported recurrence/schedule shapes, missing
  references, unknown core top-level fields, and records that cannot be safely
  mapped must produce validation errors or skip actions before any future apply
  can proceed.

### BehaviorLog restore apply

Restore apply is the destructive counterpart to restore preview and must consume
an accepted `restore_preview` run.

Restore apply rules:

- Apply requires an accepted restore preview snapshot stored on an import-run
  ledger row with `import_mode = 'restore_preview'`.
- Apply creates a separate `restore_apply` ledger row and records the accepted
  preview summary there before attempting writes.
- Apply requires all of the following server-side:
  - matching preview fingerprint,
  - matching local-data fingerprint,
  - matching accepted preview-run fingerprint fields,
  - typed confirmation `RESTORE`,
  - acknowledgement that the user created or downloaded a fresh backup,
  - high/restricted note acknowledgement when relevant,
  - no validation errors,
  - no unsupported restore actions. Intentional
    `historical_reference_only` schedule skips are safe because their
    Occurrences restore as detached schedule snapshots.
- Apply refuses stale previews when local data has changed since preview.
- Apply uses a transaction-scoped database function for destructive product
  writes instead of a long multi-call Supabase client workflow.
- Apply preserves append-only status history by default. Status-history
  replacement remains a policy that must be present in the accepted preview
  before local status events can be deleted.
- Apply replays standard definition events and safely mapped time sessions.
  Provenance mappings make both writes idempotent.
- Apply restores categories by normalized display name, reminder settings from
  standard intervention rules, arbitrary range slots, and shared schedule
  parents from Cadence schedule extensions.
- Apply may archive, replace, or delete only records represented by the accepted
  restore contract. It must preserve user ownership and Supabase RLS boundaries.
- Apply may remove operational reminder deliveries only through normal
  dependency cascades from accepted occurrence deletes. It must not call
  Sequenzy, Web Push, browser APIs, provider SDKs, or notification-processing
  routes.
- Failed restore attempts mark the `restore_apply` run `failed` with a surfaced
  failure message. Because the destructive database work is executed by one
  database function call, partial failure should roll back inside the database
  transaction; errors before or after the function are reflected in the ledger.
- Applying the same accepted restore run is designed to be idempotent through
  deterministic core record ids and passive-history uniqueness on
  `import_run_id, external_id`.
- BehaviorLog external ids do not need to be database UUIDs. When an accepted
  create action has a non-UUID external id, such as Cadence schedule ids in the
  `sch_<uuid>` form, restore apply generates a deterministic local UUID for the
  product row, uses that UUID for child references, and writes a
  `behaviorlog_import_record_mappings` row preserving the original external id.

### Imported intervention promotion

Imported intervention promotion may convert selected passive
`imported_interventions` rows into operational `reminder_deliveries` rows only
after explicit user selection and confirmation. This workflow operates on
stored passive history, not raw bundle files or import preview output.

Eligible records must be future pending reminders that safely link to a current
active behavior and unresolved occurrence. The imported channel and scheduled
send time must match what Cadence's current reminder resolver would generate
from the behavior's present reminder settings. Historical, sent, failed,
cancelled, dismissed, ambiguous, unresolved-parent, resolved-occurrence,
inactive-behavior, disabled-channel, or mismatched-current-setting records stay
passive.

Promotion writes only `reminder_deliveries` rows with `import_run_id` and
`imported_intervention_id` provenance. It must use the normal
occurrence/channel/scheduled-send idempotence key, must not create duplicate
operational sends, and must not call Sequenzy, Web Push, browser APIs, provider
SDKs, or notification-processing routes.

## AI summary

Markdown-compatible plain text summary for a selected range.

The AI summary should be copyable and downloadable as `.md`.

Occurrence notes are omitted by default. When include-notes is selected, the
summary includes a compact `Notes` section keyed by local date, behavior,
schedule, and status.

Every Markdown summary also includes concise status-history guidance. Agents
must treat occurrence rows as current snapshots and use Full JSON
`status_events` or BehaviorLog `data/status_events.jsonl` for corrections,
late logging, decision chronology, and adherence-timing analysis. Compare
`recorded_at` with `effective_at` when present, and follow
`revises_event_id`; this timing context must not change Cadence's stored status
or default adherence calculation. Markdown guidance does not add a
status-history UI or new source-capture values.

Every Markdown summary also reports how many behavior definition events are
included for the exported behaviors and directs agents to Full JSON
`behavior_definition_events` or BehaviorLog
`data/behavior_definition_events.jsonl`. Agents should use the ordered
previous/next definitions when a rename or description change affects how past
occurrences should be interpreted. The summary does not repeat the full
historical text and definition events do not alter occurrence status or
adherence calculations.

Every Markdown summary also reports the behavior configuration-event count and
directs agents to Full JSON `behavior_configuration_events` or BehaviorLog
`raw/cadence/behavior_configuration_events.jsonl`. Agents may segment analysis
at captured schedule, timezone, or active boundaries. They must not infer
causality, medication effects, or clinical guidance from a configuration
change.

Example:

```text
Behavior adherence summary, 2026-05-06 to 2026-06-05

Overall:
- Completed: 84
- Not Completed: 12
- Unresolved: 3
- Default adherence: 84 / (84 + 12) = 87.5%

By behavior:
- Brush teeth: 24 completed, 4 not completed, 1 unresolved, 85.7% adherence
- Drink matcha: 27 completed, 1 not completed, 2 unresolved, 96.4% adherence

By category:
- Grooming: 40 completed, 8 not completed, 1 unresolved
- Medical: 30 completed, 1 not completed, 0 unresolved
```

## Desktop export adapter

Desktop BehaviorLog exports map native reminder observations to standard
Interventions with `channel: other`. They may also add
`raw/cadence/native_reminders.jsonl` as a compatibility view.
The manifest declares its path, count, ordering, and export-only support under
`extensions.app.cadence.native_reminders`. Each record contains stable reminder,
Occurrence, and request IDs, the planned UTC instant, native state, and
verification/creation/update instants. Records follow the selected Occurrence
range and archived-Behavior option. Empty native history adds no file.

Native state describes OS scheduling or observation. It never proves that the
user received or read a notification. The manifest declares user receipt
unverified. Exact OS delivery evidence survives notification activation and
later cleanup; a clicked notification leaving OS readback must not turn its
known delivered history into a cancellation. The extension omits owner IDs,
notification title/body, and raw
errors. It does not add hosted reminder channels or modify the core schema.
JSONL, CSV, Full JSON, and Markdown keep their current schemas.

Desktop ZIP encoding uses `fflate/browser`. Web and desktop share the existing
ZIP directory checks, size/entry/ratio limits, and CRC validation. Desktop
decompression uses a fixed declared-size buffer plus one overflow-detection
byte; forged short declarations cannot silently accept truncated data.
ZIP byte encoding may differ by runtime; uncompressed file bytes and manifest
hashes remain authoritative.

## Desktop import and restore

Desktop uses the existing import/merge and destructive restore previews. The
current-record projection and production restore payload builder live in
`@cadence/core`. Desktop materializes those reviewed actions into full local
rows; SQLite owns the atomic commit, append-only history, ownership checks,
provenance mappings, stale marker and outbox entry.

The native preview ledger binds the exact archive bytes, bundle fingerprint,
local-data fingerprint and preview fingerprint. Import mode selection binds a
previously unbound preview once. Native apply consumes only that stored plan;
it accepts no replacement rows. Repeated applies return the prior result.
Domain changes invalidate the preview. OS reminder readback and synchronization
bookkeeping alone do not invalidate it.

Restore keeps the existing backup acknowledgement, typed `RESTORE` confirmation,
and high/restricted-note acknowledgement. Import keeps the existing apply and
note-sensitivity acknowledgements. Imported intervention records remain passive.
Standard native Interventions remain passive on import and re-export.
Native reminder extension records do not restore OS requests or delivery receipts.
Web Import and Restore offer an unchecked native-to-browser conversion choice.
It maps only `channel: other` rules with `app.cadence.native_notification: true`.
Preview warnings disclose conversion and browser permission requirements. The
choice is bound to the accepted preview; changing it requires another preview.
Historical configuration snapshots and passive observations remain unchanged.
Desktop keeps its existing native reminder intent mapping.
Normal occurrence/reminder repair runs separately after a
successful product commit.

The web production import RPC still plans rows in the August 27 SQL functions.
The desktop projection mirrors those functions and uses the same resolver
matching decisions. Common SQL/SQLite fixture checks track this remaining
projection duplication. The desktop does not call the legacy tests-only
TypeScript write loops.

## Prompt library

The Export screen includes a UI-only library of static prompt templates after
the AI summary. Users copy a template into their own assistant together with an
export of the same range. The templates are not included in exported bundles,
the BehaviorLog manifest, or the AI summary.

Every status-touching template carries the occurrence-snapshot versus
`status_events` semantics and states that Unresolved is missing decision data,
not failure. Templates also state which export format and options provide any
optional notes, status events, behavior definition history, or intervention
data they require.

The screen includes this sensitivity disclosure: "Whatever the export
contains, including notes and historical definitions when those options are
selected, becomes visible to the assistant you paste it into."

## Resolver contract

Export formatting belongs in:

`/lib/resolvers/export.resolver.ts`

BehaviorLog import validation belongs in:

`/lib/resolvers/behaviorlog-import.resolver.ts`

The resolver should accept structured rows and return:
- JSONL string
- CSV string
- JSON backup object/string
- BehaviorLog bundle files
- AI summary string

The resolver should not query Supabase directly.

## Required tests

- JSONL emits one valid JSON object per line.
- CSV escapes commas, quotes, and newlines.
- Full JSON includes categories, behaviors, and occurrences.
- Full JSON includes sorted all-time behavior definition events for included
  behaviors with full previous/next text and canonical `changed_fields`.
- Full JSON includes sorted, range-independent behavior configuration events
  for included Behaviors, manifest/count/hash determinism where applicable,
  and nullable Occurrence configuration lineage. JSONL and CSV remain
  byte-for-byte unchanged for the same snapshot input.
- AI summary calculates adherence correctly.
- AI summary omits notes by default and includes a compact notes section when
  include-notes is selected.
- Unresolved occurrences are excluded from default adherence.
- BehaviorLog bundle includes required files, manifest hashes, schedules,
  occurrences, status events, and notes only when include-notes is selected and
  notes exist.
- BehaviorLog includes standard definition-history and optional time-tracking
  files that remain valid in the upstream conformance harness and Cadence
  importer.
- BehaviorLog includes standard configuration history and the optional hashed
  Cadence compatibility file,
  splits daily-to-weekly and active/timezone schedule periods at exact captured
  revisions, does not split category/reminder-only revisions, orders same-day
  revisions deterministically, and keeps every Occurrence schedule reference
  valid.
- Known-lineage Occurrences map to their governing schedule period. Legacy
  null-lineage Occurrences use medium-confidence one-day placeholders with
  unknown historical recurrence.
- Create-only import, approved merge, and destructive restore keep only the
  current configuration schedule graph while preserving historical Occurrences,
  statuses, notes, definition events, and safely mapped time sessions.
- Restore Keep actions preserve exact stored rows, including category nulls,
  schedule parents, and timestamps. A separately accepted Note or status-history
  action can change those fields on a kept Occurrence. SQL validates the full
  accepted payload before separating kept records from actual writes.
- Portable instant comparisons normalize equivalent UTC encodings, including
  PostgREST `+00:00` and exported `Z`, while stale-write guards retain exact
  stored row timestamps. Existing previews may require a fresh preview after
  this normalization update; stale previews must not write data.
- Repository coverage proves keyset reads beyond 1,000 equal-timestamp rows,
  exactly 100,000 rows, a loud 100,001st-row failure, and the local PostgREST
  timestamp/ID cursor grammar.
- Markdown reports definition-history presence and gives rename/description
  guidance without reproducing sensitive revision text.
- BehaviorLog export synthesizes status events for resolved legacy occurrences
  that do not yet have internal `occurrence_status_events` rows.
- BehaviorLog import validation accepts a bundle generated by the export
  resolver, validates hashes and JSONL rows, preserves status-event semantics,
  detects local conflicts, and does not synthesize history from
  `current_status`.
- BehaviorLog merge preview covers `create_new`, `map_to_existing`,
  `skip_existing`, and `conflict_requires_decision` actions, stable conflict
  reasons, privacy/redaction summaries, optional note sensitivity/source
  preview, occurrence-note safe-fill/conflict decisions, optional intervention
  preview counts/sensitive-payload warnings, and status-event authority over
  occurrence snapshots.
- BehaviorLog core conformance materializes a resolver-generated bundle as a
  temporary `.behaviorlog/` directory and runs the pinned upstream
  `emixd12/BehaviorLog-Bundle` reference validator snapshot recorded in
  `tests/fixtures/behaviorlog-reference/SNAPSHOT.md`.
- BehaviorLog CSV views match their authoritative JSONL source record counts
  and stable IDs, escape commas, quotes, and newlines, and keep extension data
  in a single JSON string column.
- App-native and BehaviorLog CSV views prefix formula-leading user-controlled
  text projections with an apostrophe before standard CSV escaping while
  preserving signed machine-generated values such as UTC offsets.
- BehaviorLog Intervention Profile export emits reminder deliveries as optional
  `intervention` records, validates their references through the conformance
  harness, represents planned/sent/failed/cancelled statuses, lists and hashes
  `data/interventions.jsonl` in the manifest, and redacts sensitive transport
  details. Cadence import retains compatibility with pre-repair
  `0.1.0-draft` scheduled/pending intervention records.

## Web page preparation (Ticket 091)

Opening Export reads counts only. It does not serialize artifacts, read full
history, or consume the download rate limit. Generate summary requests the
existing Markdown artifact through `/api/export/markdown` with the same
authentication, six-per-minute account limit, and circuit breaker as structured
downloads. Copy and save become available after generation. Applying different
options clears the generated summary. Desktop keeps its local summary and
native save callbacks. Artifact content and filenames remain unchanged.


## Category controls (Tickets 123–124)

Category descriptions are optional in category JSONL/full JSON records and the
Cadence BehaviorLog category registry. Markdown summaries include category context.
Older bundles remain valid. Restore copies descriptions into new categories.
Create-only import retains the category registry and its existing matching policy.
Neither path overwrites existing category descriptions. CSV columns are unchanged.


## Archive note history (Ticket 125)

Full JSON includes each Behavior's `archive_notes`. BehaviorLog uses the
`extensions.app.cadence.archive_notes` extension with UUID `id`, UTC
`archived_at`, nullable `note`, and UTC `updated_at`. The base BehaviorLog
standard schema is unchanged. Include Notes controls archive text as well as
Occurrence Notes: when disabled, dated archive entries remain but text is null.

Import validates each entry before planning writes. New imports preserve
provided history. An older bundle omitting the extension preserves existing
history during restore; an explicitly supplied empty array expresses empty
history. Archive-only restore retains existing history. Existing Occurrence
CSV/JSONL formats keep their Occurrence scope.

## Behavior duration and scheduled archive (Tickets 142–143)

Full JSON Behavior records include nullable `default_duration_minutes`,
`end_date`, and `auto_archived_at`. BehaviorLog maps the default to the standard
`expected_duration_minutes` field. It stores `end_date` and
`auto_archived_at` under `extensions.app.cadence`. Older bundles that omit a
field preserve an existing value during restore; an explicit null clears it.
Reactivating an archived Behavior clears its automatic marker and any expired
end date, including when an older bundle omits those fields.
Import validates the minute bound, real ISO local date, UTC instant, and the
automatic marker's archived state. App-native JSONL and CSV remain focused on
Occurrence snapshots and do not add Behavior columns.

## Note shortcut privacy (Tickets 126–128)

Shortcut records, proposals, dismissed keys, evidence hashes, exclusions, and
feature preferences are private assistance metadata. They are excluded from
JSONL, CSV, Markdown, full JSON, BehaviorLog, and AI-summary exports. Full JSON
remains a tracking-data export; it does not promise complete application settings.
Include Notes covers shortcut text only after the user reviews and saves it as
ordinary Occurrence Note content. Turning Include Notes off removes that content
through the existing Note exclusion rule. Proposals never become historical Notes.

Native protected SQLite backups retain shortcut state and settings. Account sync
retains them through its separate typed entity contract. Portable imports/restores
never invent proposals or change shortcut consent. Imported inline Occurrences
remain excluded evidence; an export/import roundtrip cannot feed reused Notes
back into suggestions. BehaviorLog schema remains unchanged.
