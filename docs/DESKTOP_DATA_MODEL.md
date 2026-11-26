# Desktop data model

Schema version 23 adds the day-note Note shortcuts pool (Ticket 292). Migration
`0023_day_note_shortcut_pool.sql` rebuilds `note_shortcut_states` so it also accepts
`id = 'day_notes'` with a null `behavior_id`, mirroring hosted
`20261111120000_day_note_shortcut_pool.sql`; existing rows and the data-revision
triggers carry over. `readNoteShortcutContext` with `behaviorId: "day_notes"` returns
the profile's non-empty day notes (null `behavior_id` and `scheduled_for`), no
imported IDs, and a `dayPool` object with the profile timezone. `commitNoteShortcutState`
accepts that pool. Like Behavior pools since Ticket 305, the pool is on by default: for
matching, accept and edit only a stored global off switch rejects it, and the pool's own
`enabled` flag does not gate. The local day-note action matches repeated day notes after
each save. `saveDayNote` with `usedShortcut: true` saves the note and adds its day-note ID
to the pool's exclusions in the same transaction; a stale save writes neither, and a
shortcut clear is rejected. Rust tests
`day_note_shortcut_pool_reads_day_notes_commits_and_excludes_shortcut_saves`,
`day_note_shortcut_pool_migration_keeps_existing_shortcut_states` (an upgrade from
schema 22 with data) and `account_sync_round_trips_the_day_note_shortcut_pool` cover it.

Account sync contract 4 (hosted migration
`20261111130000_account_sync_day_note_shortcut_pool.sql`) carries the pool as the
`note_shortcut_state` entity with ID `day_notes`. Contracts 1–3 neither receive nor
write that row, so older Mac builds keep syncing and cannot change it. A linked Mac
and the web then share one day-pool state. Exclusion IDs are unioned like a Behavior
pool's.

Schema version 25 adds read-only copies of the hosted per-day move records (advisor
plan, Phase 2B). Migration `0025_occurrence_moves.sql` creates `occurrence_moves` with
exactly the fields of account sync contract 6 (`OCCURRENCE_MOVE_SYNC_FIELDS`): no client,
idempotency key, request hash or proposal link. Account sync is the only writer. As on the
server, `occurrence_id` has no foreign key, so a move outlives its Occurrence as history;
rows leave with their Behavior. A move never changes the stored Occurrence row, so a status
mark on the Mac after a web move compares equal and needs no conflict review. The native
command `readOccurrenceMoves` returns an Occurrence's records in chain order;
`apps/desktop/src/local-moves.service.ts` derives effective time from them with the shared
`effectiveTimeFromMoves` (latest record decides; an Undo, or the server's `supersede`
record with source `system` after a Behavior timezone change, means the planned time) and attaches it to in-memory copies only. The Timeline, native
reminders, leave reminders (through the Timeline's stops), an opened reminder and place
labels read those copies; native writes always re-read the stored row. A moved Occurrence
keeps its reminder request ID, so its new fire time replaces the planned one. Rust test
`account_sync_round_trips_read_only_occurrence_moves` covers apply, field rejection, chain
order, the cascade and the export read. Mac export writes the moves of the export range to
`raw/cadence/occurrence_moves.jsonl` in the `app.cadence` extension, as the web does, with
`person_reason` null because that reason never syncs to a Mac. Restore does not replay moves.

Schema version 24 adds read-only copies of the hosted connector completion records
(Ticket 320, D28). Migration `0024_connector_completion_records.sql` creates
`behavior_source_links` and `occurrence_source_matches` with only the synced fields
(see `docs/DATA_MODEL.md`, "Account sync contract 5"): no routine digests, account
digest or activity references. Rows cascade with their Behavior or Occurrence, as the
hosted rows do. Account sync contract 5 is their only writer; no native command writes
them. Their deletes apply before an Occurrence or Behavior delete, so a cascade never
removes a row the plan still expects. `readImportSnapshot` returns them as
`sourceLinks` and `sourceMatches`, so the planner sees them unchanged, and
`readOccurrenceHistory` returns `sourceMatches` for the Timeline row's workout times.
Rust test `account_sync_round_trips_read_only_connector_records` covers apply, field
rejection and the cascade.

Schema version 22 turns Note shortcuts on by default (Ticket 305). Migration
`0022_note_shortcuts_on_by_default.sql` sets a stored global `enabled = 0` to 1 once,
matching hosted `20261110170000_turn_on_note_shortcuts_once.sql`, and leaves `revision`
and `updated_at` unchanged so a linked Mac and the hosted row converge without a
conflict. The native commit treats an absent global row as on and no longer checks the
per-Behavior flag. Rust tests `note_shortcuts_are_on_by_default_and_keep_the_global_switch`
and `note_shortcut_default_on_migration_turns_a_stored_off_switch_on_once` cover it.

Schema version 21 adds day notes (Ticket 292). Migration `0021_day_notes.sql` mirrors
hosted `day_notes`: one row per profile and local date, a nullable note of 1–2,000
non-blank characters, a revision of at least 1, and a cascade from `profiles`. The
`saveDayNote` mutation compares the stored note with the expected note and returns
null on a mismatch; clearing keeps the row with a null note, so account sync needs no
tombstone. `readDayNotes` reads an inclusive date range. Rust test
`day_notes_save_edit_clear_and_reject_stale_writes` covers save, edit, clear, replay,
future dates and invalid input.

Account sync contract 3 (hosted migration `20261110140000_account_sync_day_notes.sql`)
adds the `day_note` kind. Contract 2 builds neither see nor write it. Edits to the same
day note on both sides go to conflict review. Two new notes for the same date under
different IDs merge into the hosted row: the hosted ID is kept, the texts are joined
with a blank line, the revision rises above both, and the later `updated_at` wins. The
local row is deleted before the merged row is written. If the joined text would
exceed 2,000 characters, sync stops and asks the user to shorten one note. First link
treats day notes like private travel rows, because BehaviorLog import does not
restore them.

Schema version 20 adds completion place labels (Ticket 216). Migration
`0020_completion_place_labels.sql` mirrors the four hosted tables in DATA_MODEL:
`place_label_settings`, `place_markers`, `completion_place_labels` and
`where_suggestion_dismissals`, with the same checks on place keys, microdegree
ranges, accuracy, labels and rule versions. Insert and update triggers require the
opt-in, and a label requires a Completed occurrence of the same Behavior and local
date. Deletions run in the store commands, not in triggers, so account sync applies
each deletion exactly once: `applyStatusTransition` deletes the label when status
leaves Completed, and the `commitPlaceLabels` settings save deletes everything when
labels turn off and older labels when retention shortens. The desktop client deletes
labels past retention when it loads them. `commitPlaceLabels` journals only a request
hash and a null result, so the outbox never keeps marker positions. Domain-revision
triggers cover all four tables. Account snapshots carry them as four entity kinds;
older builds fail closed with "Update Cadence". Native backups include the tables.
Schema version 30 (`0030_guess_dismissal_without_labels.sql`, Ticket 383) relaxes the
two dismissal triggers as hosted `20261126130000` does: a dismissal of a model guess
(`home`, `anywhere`, `add_place`) is admitted while labels are off. Saved-place
dismissals and markers keep requiring the opt-in, and turning labels off still deletes
every dismissal. See "Guessed Where dismissals (Ticket 383, D37)".

Schema version 18 adds the optional Behavior Where (Ticket 215). Migration
`0018_behavior_where.sql` adds nullable `behaviors.where_kind` (`anywhere`,
`home` or `place`; null means Not set) and sets `place` for every Behavior with
location text. Two triggers keep the hosted rule that only `place` keeps
`location_text`, because SQLite cannot add a table check to an existing table.
Native row validation rejects an unknown Where and place text on any other value.
Configuration history is not rewritten: the native snapshot normalizer reads a
missing `whereKind` as `place` when `locationText` is set and as null otherwise,
and `where_kind` is an allowed changed field. Account synchronization requires
`where_kind` in every Behavior upsert, so a build that predates it fails closed
with "Update Cadence before synchronizing Behavior changes." Local edits and
export use the shared core rules. Travel Settings and the Behavior form are the
shared web components; desktop links always open Apple Maps.

Schema version 19 adds learned travel habits (Ticket 217). Migration
`0019_travel_habits.sql` adds `preparation_minutes`, `arrival_buffer_minutes`,
`place_modes`, `leave_feedback` and `habits_updated_at` to `travel_settings`, matching
the hosted columns. Existing rows read as nothing learned. Column checks bound the
minutes and the JSON array lengths; two triggers require a habit revision for any
learned value. The native `commitTravelHabits` command and account-sync apply
validate entry shape, ascending order, the 43-character place key, the hex event
reference and canonical microsecond instants before writing. A habit commit compares
`habits_updated_at` with `IS`, so it never conflicts with a travel settings save.
Account synchronization carries the habits in the profile entity, which now has 13
keys. A build that predates them rejects the hosted profile while validating the
snapshot and fails closed with "Update Cadence before synchronizing account data."
Raw SQLite backups include the columns automatically.

Schema version 16 adds optional Behavior locations and the owner-authored travel
settings singleton. Travel defaults to disabled. Migration 0016 stores no device
sample, provider geocode or route result.

Schema version 12 adds retained archive notes. See the Ticket 125 section below.

Schema version 11 adds nullable category descriptions and owner-scoped normalized
name uniqueness. Migration 0011 preserves IDs and distinguishes legacy duplicates.
`manageCategories` validates the expected category snapshot and performs assignment
clearing, configuration events, category tombstones, revisions, and outbox writes
in one transaction. Description fields survive backup upgrades and synchronization.
Ticket 304's move-to-position uses the same command: the shared planner renumbers
`sort_order` for the whole list, and the changed rows are written with their outbox
records in that one transaction, so a move syncs like other category changes.
Older hosted category writes without the description field are rejected.

Schema version 10 adds the durable pre-attempt account snapshot to
`account_first_link_attempts`. Schema version 9 added the table after version 8 added
`account_sync_baselines` and schema version 7 added `account_link_metadata`.
The pending row preserves the attempt identity, pre-commit fingerprints, and
actual pre-attempt account snapshot through restart, retry, or cancellation.
This snapshot prevents a retry from confusing a post-attempt deletion with
preexisting absence. The baseline row stores the completed first-link
choice, deterministic idempotency key, local/hosted/common fingerprints, exact
canonical hosted snapshot, optional protected-backup path, and completion time.
It is written only after any required hosted commit and local atomic apply succeed.
Ignore never writes hosted data. It fingerprints synchronized product entities,
excluding derived native reminder bookkeeping, and rejects changed local data.
The native transaction also checks the current domain revision. First-link
replacement deletes validated old rows before inserting hosted rows, defers
foreign-key checks until commit, and rolls back failures atomically. Existing
pending attempts using the older raw-snapshot fingerprint must be cancelled and
restarted. Exact retries return the saved result; another baseline is rejected.

The local-profile-owned account metadata row maps
the stable local profile to one hosted user ID and may retain email and
authentication time. It stores no access token, refresh token, PKCE verifier,
pending state, provider credential, or synchronization choice. Ticket 121 owns
removal during disconnect.

Ticket 110 implements the local SQLite boundary. This document describes
implemented storage and explicit gaps. It does not establish complete desktop
parity or replace the web contract in `DATA_MODEL.md`.

## Database and migrations

`apps/desktop/src-tauri/src/local_store` owns `cadence.sqlite3` in Tauri's
application data directory. The earlier `native-boundary-spike.sqlite3`
remains separate. Its `spike_read` and `spike_write` commands remain available.

The database uses foreign keys, WAL, a five-second busy timeout, and owner-only
file permissions on Unix. One transaction applies pending migrations and
records their version, name, exact source, and application time. A failed
migration rolls back its DDL and ledger writes. An altered applied migration or
newer database version stops opening; the application does not delete or reset
the database.

Ticket 117 exposes the exact `cadence.sqlite3` Application Support path without
allowing relocation. Native backup uses SQLite's online backup API, validates
integrity, foreign keys, stable profile, and exact migration history, then
atomically publishes the selected destination. Raw restore is local-mode only.
It validates and stages the selected snapshot, creates an owner-only protected
pre-restore backup under `Backups`, checkpoints and closes the live connection,
removes stale WAL/SHM sidecars, atomically replaces the main file, and reopens it.
Any replacement or reopen failure rolls back to the original database.

Migration `0001_current_local_model.sql` translates the current web Row
contracts through the August 2026 migrations. It does not replay only the
initial June schema. SQLite stores UUIDs and temporal values as text, booleans
as constrained integers, and JSON as validated text. Native IPC returns JSON
objects, arrays, booleans, and nullable values matching current web Row types.
Migration `0002_native_reminder_coverage.sql` adds durable verification receipts
without altering the already applied first migration.
Migration `0003_bound_behaviorlog_plans.sql` stores reviewed portability plans.
Migration `0004_status_history_cascade.sql` permits SQLite's revision-link cleanup
only while deleting an entire owning Occurrence. Direct history updates still
fail. Migration `0005_domain_preview_revision.sql` tracks actual domain changes
independently of reminder receipts and preview ledgers.
Migration `0006_passive_intervention_channels.sql` accepts the standard
BehaviorLog 0.3 Intervention channels and delivery statuses in passive imported
history. The shared importer still maps `planned` to stored `pending`.
The migration preserves existing rows, operational provenance links, domain
revision, and outbox entries. It keeps foreign keys enabled throughout its
transaction. Browser/email operational delivery constraints remain unchanged;
imported Interventions never schedule native requests.
Migration `0016_travel_settings.sql` adds nullable `behaviors.location_text`
and `travel_settings`. It backfills one disabled row for the stable profile and
adds a profile trigger for fresh databases. The row stores optional user-authored
base text, mode, navigation preference, routing consent, onboarding time and CAS
revision. Raw SQLite backup/restore includes these rows automatically. Migration
validation upgrades older backups before use.

Instants use UTC ISO strings ending in `Z`, with up to nine fractional digits.
Native comparisons preserve nanoseconds. Local dates use `YYYY-MM-DD`.
Wall times use `HH:mm:ss` with optional microseconds and no trailing fractional
zeroes. These canonical keys prevent equivalent textual times from defeating
uniqueness. TypeScript and Temporal own recurrence, timezone conversion,
normalization, duration arithmetic, and eligibility decisions.

## Local identity

Initialization commits one generated profile UUID, the current default
categories, an initial stale Occurrence sync state, and an initialization outbox
entry. Reopening preserves the UUID and does not recreate removed categories.
The single-profile unique index prevents a second local profile.

The profile keeps the current web Row shape. `email` is an empty string and
`display_name` is null on initialization. These fields do not represent cloud
identity or a notification recipient. The default timezone is
`America/New_York`. Defaults are Medical, Grooming, Fitness, Food / Drink,
Home, Measurements, Admin, and Other.

Every owned table has `user_id` referencing this profile. Composite foreign
keys also preserve Behavior, schedule, Occurrence, and history ownership.
Every IPC operation checks the supplied profile against the stable local
profile. SQLite has no Supabase Auth or RLS; those remain web responsibilities.

When the final native identifier is `app.cadence.desktop`, startup can adopt
`cadence.sqlite3` from its fixed `app.cadence.desktop-spike` Application Support
sibling. This is a one-time prototype identity transition. Startup leaves an
existing final database untouched. Both paths remain native; no IPC command
accepts an adoption source or destination.

Adoption holds a read snapshot and uses the SQLite online backup API, including
committed WAL pages. It validates database integrity, foreign keys, and the
single stable profile. It applies tracked migrations to a private staging copy,
checkpoints the copy, and publishes a complete file without replacing an
existing destination. The file uses owner-only permissions. The original
database remains available. Interrupted staging cannot become an empty new
profile; startup retries from the original database. Corruption, an invalid
profile, or a partial destination stops startup instead of silently seeding.
SQLite documents snapshot semantics in its [online backup API](https://www.sqlite.org/backup.html).

OS notification permission and requests do not migrate with the database.
The prototype app must cancel its requests before the identity transition.
The final app must obtain its own permission and reconcile actual OS readback.

## Stored tables

| Tables | Contract |
|---|---|
| `profiles`, `categories` | Stable local identity and current default category Rows |
| `behaviors`, `behavior_schedules`, `behavior_schedule_slots` | Full current Behavior graph, optional Where and user-authored place text, compatibility fields, custom and preset ranges, retained IDs and creation instants |
| `travel_settings` | Disabled-by-default routing preference, optional user-authored base, separate consent and CAS revision, and learned habits with their own revision (Ticket 217); no device, provider or route-duration data |
| `behavior_definition_events` | Definition history; updates cannot rewrite events |
| `behavior_configuration_events` | Configuration snapshots and deferred current-event pointer ownership |
| `occurrences` | Schedule snapshots, nullable configuration lineage, status snapshot, note, explicit local date |
| `occurrence_status_events` | Status history, predecessor references, provenance, timestamps |
| `occurrence_time_sessions` | Start/stop instants and at most one running session per Occurrence |
| `occurrence_sync_state` | Versioned local generation freshness and covered local-date range |
| `reminder_deliveries` | Existing browser/email contract and import provenance, without provider delivery |
| `native_reminder_state`, `native_reminder_coverage` | Desired native requests, retained cancellation intent, and explicit coverage receipts |
| `behaviorlog_import_runs`, `behaviorlog_import_record_mappings` | Current preview/apply metadata, accepted preview links, and record provenance |
| `imported_notes`, `imported_interventions` | Current passive imported context; no implicit reminder delivery |
| `behavior_revisions` | Native monotonic graph revision, outside the portable Behavior Row |
| `mutation_outbox`, `tombstones`, `sync_cursors` | Dormant sync scaffold; no network or conflict-resolution implementation |
| `behaviorlog_local_previews`, `local_data_revision` | Stored reviewed import plans and domain-only preview concurrency guard |
| `account_link_metadata`, `account_first_link_attempts`, `account_sync_baselines` | Nonsecret hosted identity mapping, pending first-link retry identity plus bounded pre-attempt snapshot, and completed common baseline; no authentication token |

Hosted-only Auth, push subscription, provider, and launch-rate-limit tables are
not copied. Import operations accept shared, explicit write plans. They do not
implement provider delivery or replay native reminder requests from exports.

Occurrence uniqueness is `(behavior_id, local_date, schedule_start_time,
schedule_range_identity)`. SQLite generates the range identity as `-1` for an
exact time and end-time microseconds for a range. Exact entries and ranges with
the same start remain distinct. Parent-slot start-time uniqueness matches the
current web schema.

## Native command

`local_store({ request })` accepts a typed, unknown-field-rejecting request.
Operation names and envelope fields use camelCase. Domain Rows use the current
snake_case web names. No request accepts SQL, a table name, or a file path.

Read operations execute within a consistent read transaction. Reads reject a
result above 100,000 rows instead of returning a partial result.

| Operation | Arguments after `operation` | Result |
|---|---|---|
| `readProfile` | none | `Profile` |
| `readTravelSettings` | `profileId` | `TravelSettings` |
| `readCategories` | `profileId` | `Category[]` |
| `readBehaviorGraphs` | `profileId` | `{ behavior, schedules, slots, revision }[]` |
| `readOccurrence` | `profileId`, `occurrenceId` | `Occurrence` or null |
| `readOccurrences` | `profileId`, `startLocalDate`, `endLocalDate`, optional `behaviorId` | `Occurrence[]` |
| `readOccurrenceHistory` | `profileId`, `occurrenceIds` | `{ statusEvents, timeSessions }` |
| `readSyncState` | `profileId` | `OccurrenceSyncState` |
| `readExportSnapshot` | `profileId`, nullable `startLocalDate`, `endLocalDate`, `includeTimeTracking`, `throughStartedAt` | Categories, all Behavior graphs and definition/configuration histories, range Occurrences and linked status/reminder/time/native-reminder Rows |
| `readNativeReminderState` | `profileId` | `{ revision, reminders, coverage }` |
| `readImportSnapshot` | `profileId` | Consistent full domain/provenance Rows and domain `revision` |
| `readImportRuns` | `profileId`, `limit` from 1 through 100, optional `kind: import \| restore` | Recent full import-run Rows, filtered before limiting, descending by start instant and ID |

Every mutation also requires `profileId`, `mutationId`, and `now`. IDs and
planned row timestamps come from TypeScript. The native transaction checks
preconditions, applies the operation, and writes its request and result to the
outbox before committing. Repeating the same mutation ID and exact request
returns its previous result. Reusing an ID with a different plan fails.

| Operation | Additional arguments | Result |
|---|---|---|
| `createBehaviorGraph` | `graph`, `definitionEvent`, `configurationEvent` | Saved graph plus revision |
| `updateBehaviorGraph` | `graph`, `expectedRevision`, `expectedNormalizedDefinition`, nullable `definitionEvent`, nullable `configurationEvent` | Saved graph plus revision |
| `applyOccurrenceGeneration` | `behaviorId`, `expectedConfigurationEventId`, `create`, `update`, `delete` | Inserted, updated, and deleted counts |
| `applyStatusTransition` | `occurrenceId`, `expectedStatus`, `expectedLatestEventId`, next `status`, `completedAt`, `statusMarkedAt`, `cancelPendingReminders`, nullable full `event` Row | `{ statusChanged, concurrentDuplicate, occurrence, statusEvent }` |
| `updateOccurrenceNote` | `occurrenceId`, `expectedNote`, `note` | Saved Occurrence |
| `startTimeSession` | full `session` Row | Session or null when another session already runs |
| `stopTimeSession` | `occurrenceId`, `sessionId`, `stoppedAt` | Session or null when already stopped |
| `resetTimeSessions` | `occurrenceId`, full `expectedSessions` Rows | `{ deletedIds }` |
| `commitSyncState` | `expectedVersion`, full `state` Row | Saved state with native-incremented version |
| `updateProfileTimezone` | `expectedTimezone`, `expectedSyncVersion`, `timezone`, full active-graph `updates` | Saved Profile |
| `commitTravelSettings` | `expectedUpdatedAt`, full next owner-authored settings | Saved `TravelSettings` |
| `commitNativeReminderPlan` | `expectedRevision`, full `reminders` Rows, `cancelIds` | `{ revision, reminders, coverage }` |
| `recordNativeReminderCoverage` | `expectedRevision`, explicit `coverage`, `observed` results | `{ revision, reminders, coverage }` |
| `prepareBehaviorLogImport` | `expectedRevision`, full `previewRun`, nullable typed `plan` | `{ previewRun, revision }` |
| `applyBehaviorLogImport` | `previewRunId`, `importMode`, `previewFingerprint`, `localDataFingerprint`, `bundleFingerprint`, nullable `bundlePayloadFingerprint` | Status, full `importRun`, result or error, and `alreadyApplied` |

Mutation `graph` is `{ behavior: Behavior, schedules: BehaviorSchedule[],
slots: BehaviorScheduleSlot[] }`. It contains no nested slot arrays or revision.
Read results add the revision separately. `expectedNormalizedDefinition` is
`{ title, description }`; the shared resolver supplies it. This preserves the
web distinction between exact stored predecessor bytes and normalized history
text without duplicating JavaScript whitespace rules in Rust.

Generation `create` contains full planned Occurrence Rows. `update` contains
`{ expected: Occurrence, next: Occurrence }` pairs. `delete` contains the full
expected Rows. SQLite computes `schedule_range_identity`; clients cannot write
the generated value.

## Atomic guarantees

Graph revisions reject stale and ABA edits. A write validates owned parents,
nonempty schedule graphs, definition expectations, complete prior/next
configuration projections, and retained creation history. TypeScript owns
changed-field planning and normalization. A null definition event preserves
the exact stored title and description bytes. Retained time entries can swap
times or move to a retained/new parent without losing historical Occurrence
links. Retired entries receive tombstones. Every graph mutation marks
Occurrence sync state stale and increments its version.

Generation checks the exact current configuration event. It rejects changed
expected rows and duplicate inserts atomically. It preserves resolved rows,
rows at or before the injected instant, nonblank notes, timing history, and
unknown lineage on update. Updates preserve range identity and historical
creation/status/note fields. Generation itself does not change the sync-state
version. Final freshness commits compare the captured version, so an
intervening graph mutation cannot be hidden by a late successful sync.

Status writes compare both the current status and latest event ID. An immediate
concurrent duplicate follows the existing web result contract; a later ABA
history fails. Event, status snapshot, pending reminder cancellation intent,
and outbox write commit together. SQLite cancellation does not prove macOS
notification cancellation; the native reconciliation service must perform and
verify that external action. Note edits use exact expected-note comparison and
preserve configuration lineage.

Timing writes preserve status and reminder state. A partial unique index
prevents two running sessions for one Occurrence. Stop validates instant order.
Reset compares the full expected session set and commits deletion tombstones
with its outbox entry.

Timezone changes include every active Behavior exactly once. Each update is
`{ graph, expectedRevision, configurationEvent }`. The command checks the
profile timezone, sync version, graph revisions, and exact schedule/definition
preservation. A null event is valid only for an unchanged graph already using
the target timezone. Profile, changed Behavior rows, configuration history,
one sync-state invalidation, and outbox entry commit together. Archived
Behaviors and historical Occurrences remain unchanged. TypeScript validates
timezone semantics and plans later Occurrence regeneration.

Export reads hold one transaction across every returned collection. Definition
and configuration histories remain complete even when the requested Occurrence
range excludes their dates. Linked status, delivery, and native reminder rows
follow the Occurrence range. Optional time sessions must start at or before the
injected `throughStartedAt`; comparison preserves nanoseconds. Archived graphs
remain available for shared export filtering.

All-time export reads include every saved future Occurrence without generating
a new future horizon. Export snapshots also include passive imported notes,
passive interventions, applied import runs, and provenance mappings. Notes
still require the export option. Applied-run portability metadata retains
validated source configuration history, Occurrence timezone/lineage, and known
category registry values. Its 8 MiB limit rejects overflow. Preview ledgers
omit this metadata; retained history never becomes an OS notification request.

The native save command keeps the user-selected destination outside frontend
IPC. It writes an owner-only temporary file, synchronizes its contents,
replaces the destination atomically, and synchronizes the parent directory.
A directory synchronization failure reports that the new file was already
written; it does not claim that the previous file survived the replacement.

## Native reminder intent and coverage

`native_reminder_state` Rows contain `user_id`, `id`, `occurrence_id`,
`request_id`, `fire_at`, `title`, `body`, `status`, `error`, `verified_at`,
`created_at`, and `updated_at`. Request IDs use
`cadence.local.<occurrence UUID>`. The OS adapter accepts and enumerates this
owned namespace alongside the separate `cadence-spike.` test namespace.

The plan command requires future whole-second UTC instants, unverified
`planned` state, unresolved Occurrences, and enabled active Behaviors. The
shared resolver rounds future deadlines upward before submission. A plan
contains the entire desired set. Existing planned, scheduled, or failed Rows
must remain in the plan or appear in `cancelIds`. Cancellation IDs are local
reminder Row UUIDs; unknown UUIDs are idempotent no-ops. Cancelled rows remain
stored for retry. A failed OS cancellation preserves `cancelled` intent and
records its error. A plan commit never records successful OS scheduling.

Reminder reads expose the latest profile outbox sequence as `revision`.
Every plan and receipt compares `expectedRevision` under the write lock.
Every intervening data mutation invalidates existing coverage. An OS result
arriving after a data change cannot publish a stale successful receipt.
Idempotent mutation retries return their original result and revision.

Coverage Rows contain `user_id`, `status`, `target_through`,
`scheduled_through`, `first_unscheduled_at`, `expected_count`,
`scheduled_count`, `missing_ids`, `reason`, `verified_at`, `updated_at`, and
native-managed `dataset_revision`. Initial coverage is null. Status is
`complete`, `limited`, or `unverified`. The receipt argument omits `user_id`,
`updated_at`, and `dataset_revision`. Complete or limited receipts require an
explicit verification instant equal to the mutation's injected `now`;
unverified receipts require null. Shared TypeScript owns coverage assessment
from actual OS readback, including the earliest unscheduled deadline. Native
checks count/boundary consistency without deriving scheduling policy.

Receipt `observed` entries contain `{ id, status, error, delivery? }`, where
`id` is the local reminder Row UUID. A delivered observation requires exact
`delivery` evidence: `requestId`, `fireAt`, `title`, `body`, and `deliveredAt`.
Other observation statuses reject that evidence field. SQLite checks it
against the owned current Row and the receipt instant before committing.
Allowed observations are `scheduled`, `cancelled`,
`failed`, and `delivered`. Observations cannot reschedule cancelled intent.
Exact OS delivery evidence may correct a retired request to `delivered` for
history only, including when an earlier refresh retired it before the native
event drain. The desktop adapter validates the request identity, fire time,
content, and delivery instant against the current owned Row before writing
that observation. A replaced request's stale evidence must not match.
Failed persistence retains pending evidence for retry before expiry cleanup;
it must not silently discard the observation or claim user receipt/reading.
Readback or cancellation errors leave coverage unverified. SQLite cannot make
an OS action atomic with a data transaction; reconciliation and subsequent
readback remain necessary. Deleting an Occurrence cascades its native state
Rows. Reconciliation must also cancel enumerated product requests absent from
the desired set, including requests without a remaining SQLite Row.

## Reviewed import and restore plans

`readImportSnapshot` returns profile, categories, flat graphs with revisions,
definition/configuration/status histories, Occurrences, time sessions, reminder
Rows, import runs, provenance mappings, passive notes, and passive interventions
from one transaction. Each collection retains the 100,000-row rejection limit.
`readImportRuns` provides the smaller recent-ledger read used by page summaries.

Preview preparation writes only the preview ledger, plan binding, and outbox.
It never writes tracking records. The stored plan uses the shared
`LocalImportWritePlan` type: explicit graph writes, new definition/status events,
expected/next Occurrence and time-session Rows, category creates, passive
note/intervention writes and deletes, mappings, and a result summary. Graph
writes include a configuration-event chain ending at the exact final graph.
Native validation rejects unknown fields and accepts no SQL or table names.

Import-run ledgers allow up to 32 MiB per row. Preview ledgers retain review
fingerprints, validation counts, sensitive-note consent, and compact restore
actions. Parsed import plans and redundant merge-action detail stay out of the
ledger. Native restore authorization still checks every accepted action ID.
The initial response includes the full preview; apply reconstructs it from the
exact archive and checks freshness before binding the write plan. Repeated
apply returns the stored result without presenting a new review.

Ordinary domain rows retain the 1 MiB limit; Note shortcut states retain 8 MiB.
Import preparation allows 64 MiB because restore carries expected and next
rows together. Other mutations retain 32 MiB, except the existing 64 MiB Note
shortcut commit. Account snapshots retain 64 MiB and 100,000 entities.
Oversized requests fail before writes; oversized ledgers fail atomically.
Older desktop versions with the 1 MiB ledger limit need an update before
accepting larger synchronized import runs.

An import preview may initially store a null plan while the user chooses a mode.
One later binding may replace null with a typed plan. That binding requires
identical preview ledger bytes and unchanged domain revision. A nonnull plan
cannot be changed or cleared. Apply accepts only the stored preview identity,
mode, and fingerprints; it cannot substitute another write payload. A missing
plan fails before any apply ledger or outbox write.

Domain revision advances through triggers on actual profile, category, graph,
Occurrence, history, timing, passive-context, and mapping changes. Reminder
intent, coverage receipts, sync-freshness metadata, preview bindings, and outbox
writes do not advance this revision. The reminder API separately retains its
global outbox revision. Background reminder reconciliation therefore does not
stale a reviewed import, while tracking changes still do. Shared TypeScript
computes the content fingerprints and plans from the captured snapshot.

Native apply checks exact expected Rows, graph revisions, parent ownership,
configuration lineage, current graph/event agreement, provenance targets, and
status predecessor cycles. Create-only cannot rewrite existing tracking data.
Merge can append schedules and accepted status/note effects, but cannot delete
tracking records or overwrite nonblank notes. Restore permits its explicit
typed replacements and deletes. Native validates destructive target IDs and
provenance mappings against stored restore actions. History Rows remain
append-only; deleting an accepted Occurrence may cascade its dependent history,
with deletion tombstones recorded in the same transaction.

Product writes run within a savepoint inside the operation transaction. A late
failure rolls back product changes, then records the failed apply ledger and
outbox result. A successful apply commits the ledger, mappings, tombstones,
domain changes, sync invalidation, and outbox together. Reapplying a stored
successful preview returns the original result. Failed plans require a new
preview before another attempt. Reviewed row timestamps stay fixed; the native
adapter records the actual apply ledger start/completion instants separately.

Imported interventions stay passive. Native reminder export extensions are not
accepted write-plan fields. Apply does not call an OS notification API, email
provider, or push provider. The desktop service must reconcile current native
reminder intent after an accepted tracking change.

## Verification and remaining work

Rust tests exercise real temporary SQLite databases, restart persistence,
outbox failure rollback, migration DDL rollback, graph revisions, range
uniqueness, status ABA and duplicate behavior, note protection, timing restart,
atomic reset tombstones, timezone transaction rollback, reminder revision races,
failed cancellation persistence, and export timestamp boundaries. The
feature-gated `local-store-contract` binary
provides a JSON-lines transport for real TypeScript adapter tests against this
same native boundary. It accepts a temporary database path only and is excluded
from normal builds. It does not expose a SQL operation.

`tests/desktop-store-contract.test.ts` exercises actual shared planning and
desktop adapters against the runner. Full shared local-Supabase/SQLite contract
coverage remains required before Ticket 110 completes.

Native accepted-plan import/merge/restore transactions are implemented. Shared
planner integration and actual TypeScript-to-SQLite parity tests remain required
before those user flows are complete. TypeScript reminder reconciliation
requires integration and OS lifecycle verification. Migration
recovery UI, full offline product QA, and signed release remain separate
gates. No provider calls, cloud identity, live sync, or background helper were
added.


## Archive notes (Ticket 125)

SQLite schema 12 adds `behaviors.archive_notes` as validated JSON text with
default `[]`. The native row serializer exposes the JSON array matching the
web model. Existing graph writes, revisions, and outbox transactions persist
each archive cycle atomically. Restore/rearchive preserves prior entries.
Validated schema-11 backups upgrade before replacement. Older archives receive
no fabricated history. Account-sync conflicts require explicit review.

## Behavior duration and scheduled archive (Tickets 142–143)

SQLite schema 15 adds nullable `behaviors.default_duration_minutes`,
`behaviors.end_date`, and `behaviors.auto_archived_at`. SQLite and native row
validation enforce the 1–1,440 minute bound, real ISO local dates, valid
instants, and marker-to-archive consistency. Full graph, import, restore,
export, and account-sync rows carry the fields. Direct synchronization rejects
older Behavior rows missing the new keys; normalized legacy baselines use null.

## Behavior end and pause (Ticket 342)

SQLite schema 26 replaces `behaviors.end_date` with `end_on`, `end_time`,
`pause_from_on`, `pause_from_time` and `pause_back_on`, the hosted account sync
contract 7 fields (docs/DATA_MODEL.md, "Behavior end and pause"). The migration
backfills `end_on = end_date - 1` with no time; `auto_archived_at` stays for items
the retired job archived. SQLite checks and native row validation match the hosted
`behaviors_end_valid` and `behaviors_pause_valid` constraints: real dates, whole-minute
times, a time only with its day, and a back-on day after the first paused day.
The configuration snapshot carries `end` and `pause` like core's
`toBehaviorConfigurationSnapshot`; older snapshots read both as null. A timezone
operation may re-express an end or pause start that already happened (rule T1),
naming `end` or `pause` in its changed fields; the back-on day never moves.
Generation refuses a stale plan that creates a row on a day the end or pause stops
entirely, and lets an end or pause delete elapsed bare rows from the day before the
stop onward; marked, noted and timed rows stay. The local archive job is removed.

## Behaviors of Opportunity (Task 8)

SQLite schema 27 (`0027_behaviors_of_opportunity.sql`) mirrors the hosted
migration `20261121100000_behaviors_of_opportunity` (docs/DATA_MODEL.md,
"Behaviors of Opportunity"):

1. `behaviors.is_opportunity` (0 or 1, default 0). `recurrence_rule` and
   `scheduled_time` may be null, but only on an opportunity Behavior. Such a
   Behavior may have no schedules; every other Behavior keeps one or more.
2. `occurrences.origin` (`scheduled` or `opportunity`, default `scheduled`) and
   `occurrences.added_by` (`user`, `daily_brief`, `chat` or `mcp`). An opportunity
   row names who added it; a scheduled row has none. A trigger keeps both fixed
   after insert.
3. `occurrences_schedule_identity_key` is a partial unique index over scheduled
   rows only, so an added row never blocks a planned one or a second added row at
   the same time.

SQLite cannot drop NOT NULL or replace a table UNIQUE, so the migration rebuilds
both tables with every column, check, trigger and index, and copies each row
(Behaviors not opportunities, Occurrences scheduled). The runner turns foreign keys
off before the transaction for this version only, uses legacy renames while the old
table is gone, and runs `pragma_foreign_key_check` before commit. Children such as
status history, time sessions and reminders stay in place.

The configuration snapshot carries `isOpportunity` (older snapshots read false), and
`is_opportunity` is an allowed changed field. Generation refuses a plan that creates,
updates or deletes an opportunity row. `addOpportunityOccurrence` inserts one added
row, and for Done now its Completed status event, in one transaction; the same planned
ID and fields replay. `removeOpportunityOccurrence` deletes a clean added row (Unresolved,
blank Note, no time sessions, no status history, no active source match), cancels its
pending reminders and writes tombstones. Both use the hosted functions' refusal words.
TypeScript (`apps/desktop/src/local-opportunity.service.ts`) plans the row: today in
the Behavior timezone, the run check and the instant.

Account sync contract 8 carries `behavior.is_opportunity`, `occurrence.origin` and
`occurrence.added_by`. A Behavior write without `is_opportunity` and an Occurrence
write without `origin` and `added_by` ask for an update; a write that changes an
existing Occurrence's origin is refused. A removed added row leaves the hosted
snapshot, and the planner sends the delete either way.

## Sub-behaviors (Ticket 349)

SQLite schema 28 (`apps/desktop/src-tauri/migrations/0028_sub_behaviors.sql`) adds
the hosted link columns (`docs/DATA_MODEL.md`, "Sub-behaviors"):

1. `parent_behavior_id` (FK to `behaviors.id`, on delete set null, never itself),
   `sub_behavior_sort_order` (`>= 0`) and `inherit_parent_schedule` (0 or 1, needs a
   parent). Existing rows become standalone; no row is lost from schema 27.
2. Triggers enforce depth 1 on insert and update: no self link, the parent has no
   parent, a Behavior with sub-behaviors cannot gain a parent, and both rows share the
   profile. An opportunity Behavior is never a parent or a sub-behavior: the insert and
   link-update triggers refuse an opportunity row or parent, and
   `behaviors_sub_behavior_opportunity_update` refuses turning a Behavior with children
   (or a child) into an opportunity (hosted `20261122020000`). A BEFORE DELETE trigger clears the children's link and inherit flag so the
   FK set-null passes the row check. `db::error` maps trigger messages to product words.
3. The configuration snapshot carries `parentBehaviorId` and `inheritParentSchedule`;
   older snapshots read as null and false. Allowed changed fields add
   `parent_behavior_id` and `inherit_parent_schedule`.

Native commands (`local_store/sub_behavior.rs`), each one transaction:
`createBehaviorGroup` (a parent, then 1 to 50 children naming it),
`updateBehaviorGroup` (1 to 51 graph updates), `reorderSubBehaviors` (dense order,
every live child listed once, bumps revision and `updated_at`) and
`applyParentSlotStatusTransition` (every Occurrence a child of the parent on one local
day, one status event each, all or nothing).

**Account sync contract 9.** `ACCOUNT_SYNC_CONTRACT = 9`. Behavior upserts must carry
the three fields; a write without them is refused with "Update Cadence". A reorder changes only
`sub_behavior_sort_order`, which hosted apply keeps out of configuration history
(`20261122040000`), so `reorderSubBehaviors` writes no configuration event. The planner
treats `parent_behavior_id` as an optional Behavior-to-Behavior dependency and checks
depth 1 on every input and on the merged graph. Apply writes Behaviors unlinked first,
then restores the links once every row exists, so a regroup never trips the depth
triggers. Stored children are written before other Behaviors, so a batch that detaches
a step and turns its old parent into an opportunity passes the opportunity trigger. Import apply also writes unlinked graphs first. The minimum writer contract
stays 8, so Cadence for Mac 0.1.14 (contract 8) keeps syncing. A Behavior row with
`is_opportunity` and a parent is refused locally, as on the server.

Generation passes `hasActiveSubBehaviors`, so a parent with active sub-behaviors
generates no new Occurrences on the Mac either.

Daily Brief routine moves need no local write: the hosted brief moves a routine's steps
together (`docs/PRODUCT_SPEC.md`, "Sub-behaviors and routines"), and their
`occurrence_moves` rows arrive by account sync like any other move.

## Alongside answer (Ticket 363, D33)

SQLite schema 29 (`apps/desktop/src-tauri/migrations/0029_behavior_alongside.sql`) adds
`behaviors.alongside` (NULL unanswered, 1 yes, 0 no; a check refuses anything else), the
hosted `behaviors.alongside` (`docs/DATA_MODEL.md`, "Alongside setting"). Existing rows
become unanswered; no row is lost from schema 28.

1. The native configuration snapshot carries `alongside`; an older snapshot without the
   key reads as unanswered. The allowed changed fields add `alongside`, so a change
   needs a revision whose snapshots carry the answer (`local_store/behavior.rs`).
2. The DataStore writes the answer through the existing graph commands: the Behavior
   form's update, and the Timeline row question through core `setBehaviorAlongside`
   (one revision, reason code `alongside_answered`). No new native command.
3. **Account sync contract 10.** `ACCOUNT_SYNC_CONTRACT = 10`. Behavior upserts must
   carry `alongside`; a write without it is refused with "Update Cadence", locally and
   on the server. A baseline saved under contract 9 has no field and reads as
   unanswered, so the first contract-10 sync after the upgrade pulls a hosted answer
   without writing it back (`tests/account-sync.resolver.test.ts`, "the alongside
   answer"). The minimum writer contract stays 8: the server hides the field from a
   contract-8 or contract-9 Mac and restores the stored answer on its writes
   (`tests/sql/behavior-alongside-smoke.sql`), so an older build keeps syncing without
   clearing it.
4. **Model guesses are never stored.** A linked Mac reads the account's current guesses
   (`GET /api/behaviors/alongside`) and keeps the last answer in memory, so it still
   applies offline within the session. Guesses never reach SQLite, native backups,
   exports or account sync. A local-only Mac has none: an unanswered Behavior reads as
   not alongside, and the answer and local completion place labels still apply.
5. Exports and BehaviorLog import and restore carry the stored answer only with the
   Mac's alongside build switch on (`VITE_CADENCE_ALONGSIDE=1`), as the web does with
   `CADENCE_ALONGSIDE` on (Ticket 364).

## Guessed Where dismissals (Ticket 383, D37)

SQLite schema 30 (`apps/desktop/src-tauri/migrations/0030_guess_dismissal_without_labels.sql`)
admits a `where_suggestion_dismissals` row with suggestion `home`, `anywhere` or
`add_place` while Completion places is off. No column changes and no row is lost from
schema 29.

1. A linked Mac shows the hosted guessed Where in the Behavior form whether or not
   Completion places is on (`createLocalPlaceLabelClient` `whereGuesses`), with the
   build switch on and the server answering `enabled: true`. `dismissSuggestion`
   passes the shown guess (`shownWhereGuessKey`) to the core planner, so while labels
   are off only that guess can be dismissed, as on the web. Local mode has no guess,
   so nothing new shows and nothing can be dismissed while off. The dismissal row is
   the person's own choice; no guess is stored.
2. **Account sync contract 11.** `ACCOUNT_SYNC_CONTRACT = 11`. No field or kind
   changes. The planner keeps a guess dismissal while labels are off and still drops
   markers, labels and saved-place dismissals. Turning labels off on either side still
   deletes every dismissal: that side removed the row, so the merge carries the
   deletion, and a guess dismissal made after the turn-off survives
   (`tests/account-sync.resolver.test.ts`, "Ticket 383 guess dismissals while labels
   are off"). A baseline saved under contract 10 lacks a hidden row, so the first
   contract-11 sync downloads it without a hosted write.
3. **Older builds.** Contracts 8 to 10 (Cadence for Mac 0.1.14 to 0.1.17, and builds of
   the alongside branch before this change) would delete such a row on an ordinary
   sync, because their planner drops every dismissal while labels are off, and fail a
   first-link replacement, because their schema-29 trigger refuses it. The server hides
   it from them (`docs/DATA_MODEL.md`, "Guess dismissals while labels are off"); their
   writes keep it, and a plan of theirs that turns labels on applies and shows it on the
   next read (`tests/sql/ticket-383-mac-guess-dismissal-sync-smoke.sql`). The minimum
   writer contract stays 8.

## Note shortcut state (Tickets 126–128)

Schema 13 mirrors the owned `note_shortcut_states` contract in DATA_MODEL with
JSON arrays stored as validated SQLite text. Operation-specific reads/commits
own state CAS, ownership checks, outbox writes, revisions, and tombstones.
SQLite and native validation enforce the same 2,147,483,647 revision ceiling as web.
Shortcut-assisted Note saves atomically retain their Occurrence exclusion ID.
Any late failure rolls back both writes. Native backups include the table;
validated older backups migrate before replacement. No provider secret or cloud
consent is stored in this synchronized table.

Account snapshots include `note_shortcut_state` entities. Whole-row conflicts
use existing explicit conflict review; deletion cannot silently resurrect text.
Older clients that cannot understand the entity fail sync and request an update.
Old Note-save payloads remain valid and cannot clear exclusions. Empty pre-feature
state meant disabled before Ticket 305; it now means the deterministic feature is on.
It never implies cloud consent. Account switching cannot reuse another
owner's state. Offline restart preserves accepted text, dismissals, and settings.
Normal and reviewed sync unions exclusion IDs without merging shortcut entries or
settings. A selected state deletion becomes a disabled, entry-free exclusion marker
while its Behavior survives. Explicit first-link replacement may discard the local
dataset and its exclusions. The 100,000-ID and 64 MiB limits still fail atomically.
Shortcut-management outbox rows retain only the canonical request SHA-256 and a
text-free result marker. Exact retry hashes return the already-applied requested
state; changed payloads cannot reuse the mutation ID. Source Notes and shortcut
text are not copied into the mutation journal.

## Bounded reminder receipts and recovery (Ticket 129)

SQLite migration 0014 retains one `mutation_outbox` receipt per local owner and
native reminder operation. `commitNativeReminderPlan` and
`recordNativeReminderCoverage` store a payload hash and revision, mark the receipt
synchronized, and preserve the sequence high-water mark. An exact retained retry
returns current state. Changed payloads and stale revisions fail. Domain mutations
and unsynchronized domain outbox entries keep their existing contracts.

Startup recovery runs before exposing LocalStore. It checks disk space, reserves
a protected backup, and records durable recovery stages. Verification compares
integrity, foreign keys, account metadata, baselines, product rows, and non-reminder
outbox data. Cleanup, checkpoint, VACUUM, and reopen must pass before tracking
starts. Settings reports database, WAL, shared memory, and retained recovery files.
The backup remains until the user acknowledges and deletes that exact recovery copy.

Schema 0013 remains in chronological order as a compatibility prerequisite. The
repair release includes its table migration without activating Note shortcut UI.

## Sync contract

Desktop sends `ACCOUNT_SYNC_CONTRACT` from
`packages/core/src/resolvers/account-sync.resolver.ts` with every hosted read and
apply. The server returns only that contract's kinds and fields, and it keeps
hosted fields that this build cannot see. The native reader stays strict. Any
unexpected field therefore signals a server projection fault, not a newer
schema.

The contract also namespaces client idempotency keys. A build with a new contract
must not reuse an older contract's receipt, even when their projected data is
identical. Native schema upgrades still require a new desktop build.

Contract 1 matches published 0.1.5 and the recorded 0.1.6-dev.2 from `ed93fff`
(SQLite schema 18), whose sync source is unchanged from 0.1.5's `41e4549`.
Compatibility follows source and sync shape, not a version label. Only
unversioned development builds from later source that requires the expanded
profile need coordinated replacement from contract-2 source when this migration
ships. No later installed development build is recorded, and the current Mac
build is unverified. Published 0.1.3 still needs an update because it predates the
Where fields. The complete matrix is in
`docs/plans/2026-10-27-sync-compatibility.md`.

Rules for a schema change:

- **Additive** (a new optional field or kind): give the column a default and
  register it in `cadence_private.account_sync_contract_additions` under the next
  contract. Raise `ACCOUNT_SYNC_CONTRACT` and add matching SQLite fields.
  Published builds keep synchronizing without the new data.
- **Breaking** (a rename, a removal, a change in meaning or allowed values, or a
  cross-row invariant that old builds could violate): also raise
  `account_sync_min_writer_contract()`. Builds below it show "Update Cadence".

## Dependency-safe synchronization (Ticket 130)

An accepted Occurrence deletion removes attached reminder deliveries in both
copies, regardless of reminder status. A retained Occurrence keeps its reminders.
The pure planner rejects incomplete graphs and protects Notes, status history,
time history, and resolved Occurrences. SQLite applies child deletion first and
rejects orphan-producing plans atomically. Hosted apply uses the same final-graph
guard. A failed apply leaves the saved baseline and pending outbox unchanged.

Independent offline generation can create different UUIDs for one schedule
identity. The planner reuses the hosted Occurrence only when the extra local row
is new since the baseline, unresolved, and has no Note, history, tracked time,
reminder, import reference, or Note shortcut exclusion. SQLite removes validated
disposable Occurrences before inserting their replacements in the same atomic
apply. Any duplicate with existing data stops synchronization for review.


Recovery fails closed if a crash leaves a reserved staging file before its
identity reaches the durable marker. Cadence preserves that file and stops before
cleanup. Operator inspection is required; Cadence never adopts an unproven file.

## Disposable Calendar cache (Ticket 134)

`calendar-cache.sqlite3` is separate from `cadence.sqlite3`. It holds the validated
versioned external-event snapshot, owner, generation, range, and freshness receipt.
Native replacement is atomic and accepts only complete matching requests. Failed
refreshes retain the last complete snapshot. Clear invalidates in-flight writes.
Account-free mode cannot read cached external details. Sign-out and account
disconnect clear content even when the user keeps local Cadence records.
The Outlook and iCloud snapshots (Ticket 238) share this file, one scope per source, and
each source's disconnect clears its own. Since Ticket 283 they hold event locations, as the
Google snapshot always has, so the Mac can route those events (P-026).

No Google credential, Supabase session, raw provider payload, or sync baseline
belongs in this file. Existing backup/restore and account sync continue to operate
on `cadence.sqlite3` only. The cache is disposable and never a restore input.

## ChatGPT connection credentials (Ticket 297)

The ChatGPT connection (decision D27) stores nothing in `cadence.sqlite3`, the
Calendar cache or frontend storage. It uses two Keychain items under the app's
existing `app.cadence.desktop.auth` service. Each is a generic password that does not
synchronize and is readable only after first unlock on this device. Only native code
reads them: the webview `auth_secret_*` commands refuse both names.

| Keychain account | Contents | Lifetime |
|---|---|---|
| `chatgpt-installation` | Host ID (`urn:uuid:`, created once per installation) and the issued `oaiapp_` client ID | Kept across Disconnect, so later sign-ins reuse both |
| `chatgpt-session` | Client ID, ID-token subject, ChatGPT email, granted scopes, access token, refresh token, access-token expiry and a needs-reconnect flag | Rewritten by each refresh; Disconnect removes it |

The host ID stays on this Mac. Account synchronization, exports, backups and restore
never carry either item. A Rust test proves that exports, backups and the database
hold no ChatGPT credential. After a rejected refresh, the session keeps only the
email, subject, scopes and the needs-reconnect flag, so the app can name the account
to reconnect. The sign-in `state`, `nonce` and PKCE verifier live only in process
memory while the callback listener runs.
