# Data Model

Use Supabase Postgres for the web app. The SQL definitions and RLS requirements
below describe its current schema. Tickets 107–114 implement a separate local
SQLite desktop adapter under `docs/DESKTOP_BUILD.md`; desktop schema work must
preserve the current domain contracts and document its own migrations.

The web app may support many independent accounts. It is still single-player
per account: no shared workspaces, no collaboration records, and no social data
model are in scope.

All user-owned tables must include `user_id`.

Exception: `profiles` uses `id` as the authenticated user's id (`auth.users.id`) instead of a separate `user_id`; its RLS ownership rule is `id = auth.uid()`.

All user-owned tables must have Row Level Security policies.

Use migrations for all schema changes.

Schema operations are CLI-first. Use `docs/SUPABASE_WORKFLOW.md` for local stack, migration, hosted deployment, and local/hosted congruence rules. Do not change the hosted database directly outside git-tracked migrations.

After schema changes, regenerate TypeScript database types from Supabase CLI output and commit them with the migration.

## Travel locations and preferences (Ticket 162)

Ticket 160 establishes optional user-authored Behavior locations and saved base,
transport mode and supported navigation preference. Base absence affects only
the final return leg; known outbound and event-to-event legs remain usable for
recommendations, occupancy and collisions. Return time remains unknown without
a usable base. Do not make saved base a global routing or recommendation constraint.
Calendar event locations remain Calendar-owned source data. Journey corrections
are scoped to an instance/revision; they do not silently overwrite source locations.

Migration `20260922010000_add_travel_settings.sql` adds nullable
`behaviors.location_text` and one `travel_settings` row per profile. Both fields
store only user-authored text. A location is trimmed, contains no control
characters and has at most 500 characters. Removing a Behavior location or base
sets that value to null. Account deletion removes both through existing cascades.

`travel_settings` stores disabled-by-default routing state, optional base, mode,
supported navigation preference, explicit routing-consent time, onboarding time
and revision time. Enabling requires both a mode and consent. Disabling clears
consent. Calendar, device and model permissions remain separate and never imply
routing consent. Owner RLS permits authenticated select/update only; a profile
trigger owns row creation.

Account sync carries travel settings in its singleton profile entity and carries
Behavior locations in Behavior rows. Behavior locations participate in existing
configuration history. SQLite migration 0016 provides the same rows and checks.
Older saved baselines and BehaviorLog imports normalize missing location fields
to null and travel to disabled. Existing BehaviorLog formats remain unchanged.

Device samples, provider geocodes and route results remain transient. Exclude them
from account sync, exports, backups, logs and analytics. Shared resolvers derive
travel occupancy and collisions without changing scheduled times or statuses.
Each leg carries its own endpoints, timing, mode, provenance and freshness so one
unknown leg does not discard known legs. Current device position overrides a
predicted scheduled origin for the immediate departure. Input changes invalidate
affected legs; no automatic base detour is inserted between successive events.
See `plans/travel-departure-discovery.md` for retention and disclosure boundaries.

Migration `20260922013000_add_travel_route_quota.sql` keeps owner-local-day and
global UTC-day counters. Authenticated callers consume quota through one
security-definer function; they cannot write counters or read global counters.
A transaction lock serializes the lifetime global sum. The initial nonrenewing
US$20 allowance admits at most 40 refreshes, reserving US$0.50 each before any
provider call. Failed and partial refreshes retain their reservation. Existing
six-per-owner-day and 100-per-global-day caps still apply. Never prune global
rows or reset the allowance without explicit owner authorization.

One refresh makes at most 19 non-retried geocodes and 18 route calls, including
driving refinement and one batch retry. At verified September 22, 2026 USA list
prices, their upper bound is US$0.365 before tax and without free credits.
The US$0.50 reservation leaves US$0.135 per refresh for margin; it is not a
measurement of billed cost. Recheck pricing and call bounds before changing
the adapter or increasing the allowance. Cloud budget alerts provide an
additional notification and do not enforce this limit.

## Tables

### `account_sync_apply_receipts`

Ticket 120 stores one immutable hosted receipt per authenticated user and
idempotency key. The receipt binds the request, baseline, local, hosted, and
result fingerprints to the exact returned snapshot. Authenticated clients may
select their own receipts. They cannot insert, update, or delete receipts.

`read_account_sync_snapshot()` is a `SECURITY INVOKER` function. It returns one
owner-scoped, canonical snapshot of the synchronized tables. It rejects any
collection above 100,000 rows or a result above 64 MiB.

`apply_account_sync_plan(jsonb)` is a `SECURITY INVOKER` function. Its private
writer repeats authentication and exact payload validation before using its
elevated boundary. It compares every expected row before writing, preserves
append-only history and provenance, rejects protected Occurrence deletion,
applies typed writes in dependency order, and stores the receipt in the same
transaction. The function accepts the adapter's exact `writes`,
`mergedFingerprint`, and `conflicts` plan. It does not
stage BehaviorLog import or restore runs.

The desktop planner preserves existing same-status hosted status-event branches
only while automatically hydrating an untouched local profile for the first
time. It copies every event unchanged and saves them in the first common
baseline. Divergent-status, local-only, cross-copy, and later branches remain
invalid. This compatibility rule changes no hosted row or schema.

### `profiles`

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`profiles.email` is identity-owned reminder-recipient data. The Auth user
creation trigger seeds it from `auth.users.email`, and an Auth email-update
trigger keeps it synchronized when the identity provider changes the address.
Authenticated Data API clients may select their own profile and update only
`timezone`. They cannot insert or delete profile rows, or update `email`,
`display_name`, `id`, `created_at`, or `updated_at` directly. Account deletion
continues through the server-side Auth user deletion boundary and its cascade.

### `categories`

```sql
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text, -- nullable, maximum 2,000 characters
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Default categories:

- Medical
- Grooming
- Fitness
- Food / Drink
- Home
- Measurements
- Admin
- Other

Default categories are seeded for convenience and remain user-owned.
Ticket 123 adds nullable plain-text descriptions through migration
`20260905035835_user_defined_categories.sql` and SQLite migration 0011.
Normalized names are unique per owner using trimmed ASCII case folding.
Legacy duplicates retain their IDs and assignments; later duplicates receive an
ID suffix. New names allow 1–120 characters without control characters.
Descriptions allow 2,000 characters. Existing unchanged legacy names remain valid.
`manage_categories` locks the account, checks category and affected Behavior
snapshots, and applies the complete category change atomically.

### `behaviors`

```sql
create table behaviors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,

  title text not null,
  description text,
  location_text text,

  recurrence_rule jsonb not null,
  scheduled_time time not null,
  timezone text not null default 'America/New_York',

  browser_reminder_enabled boolean not null default true,
  email_reminder_enabled boolean not null default false,
  reminder_offset_minutes int not null default 0,

  active boolean not null default true,
  current_configuration_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
```

`location_text` is an optional user-authored routing destination. It is part of
the Behavior configuration revision and account-sync row. It is not a provider
geocode and never stores coordinates or place identifiers.

### `travel_settings`

```sql
create table travel_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  enabled boolean not null default false,
  base_location_text text,
  mode text,
  navigation_preference text,
  routing_consent_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Supported modes are walking, cycling, transit and driving. Supported navigation
preferences are Google Maps and Apple Maps. The saved base is optional. Missing
base suppresses final-return advice only. Device samples, provider geocodes,
route results and Calendar/model grants never enter this table.

`recurrence_rule` and `scheduled_time` store the first schedule's recurrence
and first time-entry start for compatibility, sorting, and simple summaries.
The schedule source of truth is `behavior_schedules` plus
`behavior_schedule_slots`.

`current_configuration_event_id` identifies the event for the Behavior's
current semantic configuration. The column stays nullable to permit the
deferred Behavior/event creation cycle, but every committed app-created
Behavior has a pointer. The history-aware configuration-event helper updates
it immediately after each validated append. Its composite, deferred foreign
key requires the event to have the same owner and Behavior.

`timezone` is copied from `profiles.timezone` when a behavior is created. When
the user saves a new timezone in Settings, active behaviors are updated to the
new timezone and future unresolved occurrences are resynced. Archived behavior
rows and past or resolved occurrence history remain historical records.
The profile update, active-Behavior updates, configuration events, and one
`timezone_changed` stale-state write share one owner-scoped database
transaction. A failed Behavior precondition rolls back the profile update.
Occurrence generation stays outside that transaction and can be retried while
the committed sync state remains stale.

### `behavior_definition_events`

```sql
create table behavior_definition_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,

  previous_title text,
  next_title text not null,
  previous_description text,
  next_description text,
  changed_fields text[] not null,

  recorded_at timestamptz not null,
  source text not null default 'manual'
    check (source in ('manual', 'import', 'system')),
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  foreign key (user_id, behavior_id)
    references behaviors(user_id, id)
    on delete cascade
);
```

`behavior_definition_events` is append-only history for behavior title and
description definitions. The first row is a baseline: `previous_title` and
`previous_description` are null, `next_*` holds the initial definition, and
`recorded_at` matches the behavior's `created_at`. Existing behaviors are
backfilled with `source = 'system'`; normal Behavior form creates and edits use
`source = 'manual'`. Create-only and approved-merge imports write an atomic
`source = 'import'` baseline for each newly created behavior. Restore writes a
`source = 'import'` baseline for a created behavior or a transition for a
replaced normalized definition.

`changed_fields` is ordered as title, then description. A baseline always
includes `title` and includes `description` only when the initial description
is non-null. The migration backfill preserves the exact stored baseline text;
it does not silently trim legacy rows. Later rows include only definition
fields whose trimmed values changed, while still preserving the complete
previous and next title and description values. Category, schedule, reminder,
archive, and timezone-only changes do not create definition events. `reason`
is schema-only in the Behavior form; import paths use `behaviorlog_import` or
`behaviorlog_restore` as machine-readable provenance.

Authenticated app clients may select their own rows. History-aware RPCs own
inserts. Clients have no direct insert, update, or delete grant. Database
cascades still remove events when the owning behavior or account is deleted.

Manual Behavior form writes use owner-checked `SECURITY DEFINER` functions
`create_behavior_with_schedule_graph` and
`update_behavior_with_schedule_graph`. The service passes the pure resolver's
optional definition-event plan and the complete validated schedule graph into
the function; SQL does not calculate changed fields or recurrence. The
behavior row, optional definition event, every schedule parent and time entry,
and `occurrence_sync_state.stale = true` commit or roll back together.

Updates lock the owned behavior and bind the write to its exact stored
definition, `updated_at`, and schedule graph. This preserves the definition
ABA guard and also rejects stale schedule-only submissions. A null event plan
must preserve the exact stored title and description bytes, so
canonical-equivalent tabs or Unicode edge whitespace cannot be rewritten
without history. Authenticated callers cannot execute the earlier
definition-only functions.

Manual edit forms submit the `updated_at` value loaded with the browser draft.
The atomic update reports a deterministic stale draft as a non-retryable
application error, so PostgREST returns the conflict instead of retrying it as
a serialization failure. The private graph writer uses the same non-retryable
`P0001` code when a retained schedule or time-entry ID belongs to another graph.
Migration `20260830223000` closes those two older `40001` branches without
changing tables, grants, or function signatures.

Create-only and approved-merge BehaviorLog imports use the same atomic create
function with `source = 'import'`, and preserve the imported behavior
`created_at` as the baseline `recorded_at`. The destructive restore wrapper
locks existing restored behaviors, requires a resolver-planned baseline for
every new behavior and a transition for every title/description overwrite,
then inserts those events in the same transaction as product rows, provenance
mappings, and the applied-run ledger.

Desktop parity verification also exercises that production restore transaction
through ordinary local Supabase clients. The accepted preview's Keep actions
exclude those rows from product writes after exact payload-digest validation.
The full accepted schedule payload remains available for graph validation.
Unchanged graphs retain parent IDs and timestamps; partial changes write only
changed schedule rows. Separately accepted Note/status actions may update those
fields on a kept Occurrence without rewriting its schedule identity.

Function-only migrations `20260830223000`, `20260830224000`,
`20260830230000`, and `20260830231000` implement these conflict/Keep corrections.
They change no public function signatures or grants. Generated local TypeScript
types match the existing definitions. These migrations have not been pushed to
the hosted database by the desktop task.

### `behavior_configuration_events`

```sql
create table behavior_configuration_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  event_kind text not null check (event_kind in ('baseline', 'revision')),
  previous_configuration jsonb,
  next_configuration jsonb not null,
  changed_fields text[] not null,
  recorded_at timestamptz not null,
  effective_at timestamptz not null,
  effective_local_date date not null,
  timezone text not null,
  source text not null check (source in ('manual', 'import', 'system')),
  reason_code text not null,
  created_at timestamptz not null default now(),
  unique (user_id, behavior_id, id),
  foreign key (user_id, behavior_id)
    references behaviors(user_id, id) on delete cascade
);
```

`behavior_configuration_events` stores append-only configuration history. A
snapshot contains `category_id`, the complete semantic schedule graph, browser
and email reminder settings, reminder offset, active state, and timezone.
Schedule and time-entry IDs are excluded. Stable sort order, recurrence JSON,
local times, and reminder values define the semantic graph.

Baselines use `previous_configuration = null`. Revisions store complete prior
and next snapshots and canonical changed fields. No-op saves append no event.
`effective_local_date` uses `effective_at` in the next snapshot's timezone.
Stored timezone aliases remain unchanged, so an alias-to-canonical Settings
save remains an honest revision.

The rollout backfill records `source = 'system'` and
`reason_code = 'history_capture_started'` at migration time. It does not claim
capture began at Behavior creation. Manual create, edit, archive, restore,
Settings timezone changes, create/merge imports, and destructive restore write
events inside atomic owner boundaries. Restore derives parent graphs from
validated schedule rows and locked prior graphs. It does not trust client prior
snapshots or parent graphs. Archive-only restore preserves the prior schedule
graph as retained archived context.

Authenticated clients may select owned events. They cannot insert, update, or
delete event rows directly. Direct authenticated writes to Behaviors, schedule
parents, and schedule slots are revoked; app writes use history-aware RPCs.
Direct category deletion stays disabled because `ON DELETE SET NULL` bypasses
history. The owner-scoped `manage_categories` RPC clears affected assignments
and captures each Behavior configuration event atomically. Existing historical snapshots remain unchanged.

Generated Occurrences link to these events when verified lineage exists. Full
JSON and BehaviorLog expose the complete included-Behavior history and
Occurrence lineage as documented in `docs/EXPORT_FORMATS.md`.

### `behavior_schedules`

```sql
create table behavior_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,

  recurrence_rule jsonb not null,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  unique (user_id, behavior_id, id)
);
```

Each behavior has one or more schedules. A schedule owns one recurrence pattern
and must have one or more owned time entries. Manual form transactions reject
empty, duplicate, malformed, stale, or cross-owner schedule graphs before the
transaction commits.

Legacy behavior rows without schedule parents may still be normalized at
runtime to one schedule using `behaviors.recurrence_rule`,
`behaviors.scheduled_time`, and legacy flat schedule slots. A persisted
schedule parent with no child time entry is different: it is an integrity
failure, not a valid empty schedule. Ticket 060's idempotent migration repairs
every such parent with one exact compatibility slot using the owning
behavior's stored `scheduled_time`; active repaired schedules also receive
only missing Unresolved occurrences from the stable local creation-date anchor
through the normal future horizon. Existing occurrences and statuses are not
updated or recreated. Archived repaired schedules receive the slot but no new
occurrences.

### `behavior_schedule_slots`

```sql
create table behavior_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  behavior_schedule_id uuid,

  kind text not null check (kind in ('exact', 'range')),
  preset text check (preset is null or preset in ('morning', 'afternoon', 'evening', 'night')),
  start_time time not null,
  end_time time,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  constraint behavior_schedule_slots_schedule_owner_fkey
    foreign key (user_id, behavior_schedule_id)
    references behavior_schedules(user_id, id)
    on delete cascade,
  constraint behavior_schedule_slots_schedule_behavior_owner_fkey
    foreign key (user_id, behavior_id, behavior_schedule_id)
    references behavior_schedules(user_id, behavior_id, id)
    on delete cascade
);
```

Supported range presets:

- Morning: 6:00 AM-Noon
- Afternoon: Noon-6:00 PM
- Evening: 6:00 PM-Midnight
- Night: Midnight-6:00 AM

Each schedule must have at least one time entry. A behavior can have multiple
schedules and multiple time entries per schedule. A nullable
`behavior_schedule_id` preserves legacy/import paths that only know flat
behavior-level slots; new writes should set it. The composite foreign key
requires linked schedules and slots to belong to the same behavior. Occurrence
generation creates one occurrence per matching schedule time entry, then
merges candidates with the same behavior, local date, start time, and range
identity. An exact entry and a range entry that share a start time remain
distinct. Stable sort order breaks ties only when every identity field matches.

Current uniqueness is enforced with partial indexes:

- `(behavior_schedule_id, start_time)` where `behavior_schedule_id is not null`
- `(behavior_id, start_time)` where `behavior_schedule_id is null`

### `occurrences`

```sql
create table occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  behavior_schedule_slot_id uuid references behavior_schedule_slots(id) on delete set null,
  behavior_configuration_event_id uuid,

  scheduled_for timestamptz not null,
  local_date date not null,
  schedule_kind text not null check (schedule_kind in ('exact', 'range')),
  schedule_preset text check (schedule_preset in ('morning', 'afternoon', 'evening', 'night')),
  schedule_start_time time not null,
  schedule_end_time time,
  schedule_range_identity bigint generated always as (
    case
      when schedule_kind = 'exact' then -1::bigint
      else (extract(epoch from schedule_end_time) * 1000000)::bigint
    end
  ) stored,

  status text not null default 'unresolved'
    check (status in ('unresolved', 'completed', 'not_completed')),

  completed_at timestamptz,
  status_marked_at timestamptz,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    behavior_id,
    local_date,
    schedule_start_time,
    schedule_range_identity
  ),
  unique (user_id, id, behavior_id),
  foreign key (user_id, behavior_id, behavior_configuration_event_id)
    references behavior_configuration_events(user_id, behavior_id, id)
    deferrable initially deferred
);
```

`status` is the current-status snapshot for fast Timeline, Analytics, and
app-native export reads. Status history is stored separately in
`occurrence_status_events`.

`behavior_configuration_event_id` is nullable for legacy, imported, and
restored Occurrences whose governing event is unknown. The migration does not
invent lineage for existing rows. New generated Occurrences store the current
Behavior event. A linked, unresolved Occurrence strictly after the injected
current instant may advance to a new current event only when the same local
date, start time, and range identity remain in the new graph and Ticket 078
protections do not apply. A
null-lineage row never receives inferred lineage during generation.

Occurrence plan writes lock the Behavior and compare the exact expected current
event before inserting, updating, or deleting. Deletes compare the planned
instant, lineage, and complete schedule snapshot. Insert conflicts or changed
update/delete targets reject the plan as stale. Direct authenticated inserts
cannot set lineage. Direct authenticated updates are limited to status
snapshots and notes; generation and restore boundaries own schedule and lineage
changes.

Any update that names an Occurrence identity or schedule-snapshot column clears
captured lineage, even when the value is unchanged. This prevents destructive
restore conflict updates from retaining a now-false event reference. Status and
note-only updates preserve lineage. The generation-plan boundary performs its
guarded snapshot update first, then restores the verified current event in a
separate lineage-only update within the same transaction.

### `occurrence_time_sessions`

```sql
create table occurrence_time_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  started_at timestamptz not null,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stopped_at is null or stopped_at >= started_at),
  foreign key (user_id, occurrence_id, behavior_id)
    references occurrences(user_id, id, behavior_id) on delete cascade
);
```

One partial unique index permits at most one running session per
`(user_id, occurrence_id)`. Users may retain multiple stopped sessions. Owner
RLS grants select, insert, update, and delete only to the authenticated owner.
The table cascades on occurrence or account deletion. Duration is derived from
`stopped_at - started_at`; no mutable duration column exists. Ticket 068 adds
no backfill and does not change occurrence, status-event, note, reminder,
import, or export rows.

Ticket 094 adds
`occurrence_time_sessions_user_started_id_idx (user_id, started_at, id)` for
owner-scoped history cursors. A rollback-only local fixture used 3,650 daily
Occurrences and 7,300 stopped sessions for one owner. Before the index, the
all-time first page sorted a 7,300-row sequential scan in 2.801 ms. A later
cursor page scanned 7,300 rows, removed 5,114, and ran in 1.516 ms. After the
index, both pages used the new index and returned 1,000 rows in 0.798 ms and
0.876 ms. The 90-day plan kept the existing Occurrence local-date index and
remained similar at 0.783 ms before and 0.863 ms after. These local synthetic
plans justify the index shape. They are not capacity benchmarks.

Timeline and single-Occurrence timing reads use the bounded arbitrary-ID RPC
documented below. Analytics, selected-day review, and time-tracking exports use
the joined historical RPC. Exports read sessions only when
`include_time_tracking=1`. Stopped rows receive derived duration output;
running rows keep null duration. Import and restore replay safely mapped
standard time sessions. A running session is skipped when its target Occurrence
already has a running session.

### `occurrence_sync_state`

```sql
create table occurrence_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,

  timezone text not null default 'America/New_York',
  last_synced_local_date date,
  synced_through_local_date date,
  last_successful_sync_at timestamptz,

  stale boolean not null default true,
  stale_reason text default 'never_synced',

  last_sync_behavior_count int not null default 0,
  last_sync_created_count int not null default 0,
  last_sync_updated_count int not null default 0,
  last_sync_deleted_count int not null default 0,
  state_version bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`occurrence_sync_state` is a per-user freshness contract for generated
occurrence rows. Write paths mark it stale when behavior schedules, account
timezone, or import/restore flows can affect generated occurrences. A successful
account occurrence sync marks it fresh with the local-date horizon that was
covered and aggregate counts for observability. Freshness coverage is accepted
only after every active behavior has a structurally valid normalized schedule
graph and all occurrence and requested reminder-planning writes succeed. An
empty or ambiguous persisted schedule graph raises a safe integrity error and
best-effort records `stale_reason = 'sync_failed'`; it cannot be filtered out
and then recorded as fresh.

Full sync fences all Behaviors and counts every plan, including archived cleanup.
Only active schedule windows establish the coverage timezone and dates. With no
active schedules, the profile-timezone fallback window establishes empty coverage.
Archived historical timezones must not turn fresh coverage into `multiple`.

Every update increments `state_version` in a database trigger. Authenticated
clients can write the existing freshness columns but cannot insert or update
`state_version` directly. A final fresh write must match the state existence
and version captured before generation planning.

The protected occurrence/reminder repair process reads this ledger rather than
the oldest profiles. It orders stale rows first, followed by the earliest or
missing `synced_through_local_date`, oldest `updated_at`, and `user_id` as a
stable tie-break. After choosing that ordered batch, it resolves each target's
current timezone from `profiles`; the ledger's copied timezone is not used to
mark coverage fresh. This matters for archived behaviors, whose historical
timezone may differ from the current profile timezone. Updating a successful
or failed attempt therefore rotates bounded batches fairly as the account
population grows.

`occurrence_sync_state_batch_order_idx` uses that exact ordering: `stale DESC`,
`synced_through_local_date ASC NULLS FIRST`, `updated_at ASC`, then `user_id ASC`.
Keep the repository query and index order aligned when the batch policy changes.

### `occurrence_status_events`

```sql
create table occurrence_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,

  previous_status text
    check (previous_status is null or previous_status in ('unresolved', 'completed', 'not_completed')),
  status text not null
    check (status in ('unresolved', 'completed', 'not_completed')),
  status_semantics text not null
    check (status_semantics in (
      'explicit_user_mark',
      'explicit_user_correction',
      'imported_explicit',
      'system_rule_declared',
      'ambiguous_import'
    )),

  recorded_at timestamptz not null,
  effective_at timestamptz,
  local_date date not null,
  timezone text not null default 'America/New_York',

  source_capture_method text not null default 'manual_tap'
    check (source_capture_method in (
      'manual_tap',
      'manual_text',
      'system_generated',
      'imported',
      'inferred',
      'derived',
      'ai_generated',
      'unknown'
    )),
  source_confidence text not null default 'high'
    check (source_confidence in (
      'high',
      'medium',
      'low',
      'ambiguous',
      'unknown'
    )),
  revises_event_id uuid,
  reason_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  foreign key (user_id, revises_event_id)
    references occurrence_status_events(user_id, id)
    on delete set null (revises_event_id),
  foreign key (user_id, occurrence_id, behavior_id)
    references occurrences(user_id, id, behavior_id)
    on delete cascade
);
```

This table is the internal append-only status history used for BehaviorLog
alignment. On first manual resolution, store `explicit_user_mark`. When a user
changes one resolved status to another, store `explicit_user_correction` and
link `revises_event_id` to the latest prior status event for that occurrence.

Normal authenticated manual status changes call the owner-scoped
`public.apply_occurrence_status_transition(...)` database function. The
function locks the occurrence, compares both the current status and latest
status-event id with the service's resolver-planned predecessor, updates the
current snapshot, inserts exactly one event, and cancels pending reminders for
a newly resolved snapshot in the same statement transaction. Corrections use
the locked latest event as `revises_event_id` when one exists. A repeated tap
of an already-current resolved status is an idempotent no-op; an ABA-stale or
otherwise competing plan is rejected instead of creating a broken correction
chain. The stale-plan branches use a non-retryable application SQLSTATE.
They must not use `40001`, because that code means serialization failure and
can make PostgREST retry a deterministic stale plan until timeout. Note-only
writes do not use this function and do not alter status timestamps or history.

Do not backfill an absent internal event for a legacy resolved snapshot because
the snapshot cannot prove a manual action or high-confidence provenance. The
BehaviorLog exporter may instead emit a derived, medium-confidence event at
export time so the snapshot remains interoperable without changing internal
history.

BehaviorLog import validation starts as a dry-run preview. The create-only core
import path may then insert clearly new behaviors, compatible schedule slots,
occurrences, and status events from a valid accepted preview with
`import_mode = 'create_missing_only'`.

Merge-preview import is also dry-run only. It may compare imported records
against local records and store the generated preview snapshot in
`behaviorlog_import_runs` with `import_mode = 'merge_preview'`, but it must not
insert, update, restore, overwrite, delete, deduplicate, or otherwise mutate
product records.

Create-only import rules:

- Use `behaviorlog_import_runs` as the auditable preview/apply ledger.
- Use `behaviorlog_import_record_mappings` to map external BehaviorLog ids to
  local Cadence ids for idempotence and provenance.
- Insert occurrences as `unresolved` first, then append imported
  `occurrence_status_events`, then update the occurrence current-status snapshot
  from the latest imported event for that occurrence.
- Treat `occurrences.jsonl.current_status` as a snapshot only. Do not synthesize
  explicit status history from the snapshot during import.
- Preserve `unresolved` as unresolved; do not convert silence into
  `not_completed`.
- Skip unsupported recurrence profiles or schedule windows with warnings.
- Do not merge, restore, overwrite, delete, or deduplicate local product records
  by mutation in create-only mode.
- Import non-AI `data/notes.jsonl` records into `imported_notes` when their
  behavior, occurrence, status-event, or review attachment can be represented.
  Occurrence-attached notes may also fill `occurrences.note` only when the
  imported occurrence is safely identified and the current local note is empty.
- Import `data/interventions.jsonl` records into `imported_interventions` as
  passive delivery history. Store external behavior/occurrence ids and local
  behavior/occurrence ids when safely known. Drop or redact sensitive transport
  fields before storage.
- Do not import Context/Profile records, Analytics Profile records, optional
  CSV-only data, reminder deliveries, or provider side effects until a later
  ticket explicitly adds that write path.

Merge-preview rules:

- Emit user-reviewable deterministic actions: `create_new`,
  `map_to_existing`, `skip_existing`, and `conflict_requires_decision`.
- Use existing `behaviorlog_import_record_mappings` as provenance evidence when
  deciding whether an imported BehaviorLog id maps to a local record.
- Compare behaviors by mapped id, title/category identity, source original id,
  archive state, and compatible schedule shape.
- Compare schedules by mapped behavior, recurrence profile, recurrence payload,
  timezone, active dates, and exact-time or preset range slot shape.
- Compare occurrences by mapped behavior, mapped schedule, `scheduled_for_utc`,
  `local_date`, and timezone.
- Reject an occurrence when its `local_date` differs from the date derived from
  `scheduled_for_utc` in its timezone, or its schedule belongs to another
  behavior.
- Compare status events by mapped occurrence, external event id, recorded time,
  status, status semantics, and revision target.
- Reject duplicate intervention ids before preview or apply.
- Keep `status_events.jsonl` authoritative over occurrence `current_status`
  snapshots. `unresolved` remains a valid unresolved state, not a failure.
- Treat status events as append-only history. Merge preview may identify an
  existing duplicate event, but future writes must not overwrite local history.
- Parse optional `data/notes.jsonl` and include note role,
  sensitivity/source metadata, source original id, timestamps, attachment
  target, and storage decision details in preview output.
- Non-AI behavior, occurrence, status-event, and review notes may be planned as
  passive `imported_notes` rows. AI-generated notes are skipped with warnings.
- Occurrence-attached, non-AI notes may additionally plan an inline
  `occurrences.note` fill only when the target occurrence is safely identified
  and the current local note is empty. Conflicting occurrence notes are stored
  as passive imported notes and do not replace the local note.
- High or restricted note sensitivity must produce a preview warning and require
  explicit privacy acknowledgement before any accepted plan can import that note
  body.
- Preview Intervention Profile records with the passive history fields that
  will be stored and the sensitive delivery fields that will be dropped or
  redacted. Intervention merge actions may plan `imported_interventions` rows,
  but must not plan operational reminder deliveries.

User-approved merge apply rules:

- Apply only import runs with `import_mode = 'merge_by_user_approved_plan'`
  that contain an accepted Ticket 020 `mergePreview` snapshot in
  `dry_run_summary`.
- Refuse to apply while any accepted action remains
  `conflict_requires_decision`.
- For `create_new`, use the same create safeguards as create-only import:
  create compatible behaviors, schedule slots, and occurrences only when the
  validated plan can represent them in Cadence.
- For `map_to_existing`, write provenance mappings only. Do not overwrite local
  behavior, schedule, or occurrence fields except for the limited occurrence-note
  fill rules below.
- Append status events that are not already mapped or duplicated. Preserve
  `revises_event_id` when both the imported event and revision target have
  local mappings.
- Update occurrence current-status snapshots only after status events are
  appended and only when the imported event is the latest event by effective
  time, then recorded time, then stable id tie-breaker.
- Do not replace a local explicit high-confidence status decision with an
  ambiguous or lower-confidence imported status event.
- Applying the same accepted plan must be idempotent through
  `behaviorlog_import_record_mappings`.
- If apply fails after partial work, mark the import run `failed` with the
  failure message. Do not silently continue after inconsistent parent mappings.
- Note mappings use the imported note row id as `local_id`, not the attachment
  target id. This preserves provenance for behavior, occurrence, status-event,
  and review notes with one mapping contract.
- Occurrence-attached notes may fill `occurrences.note` only when the target
  occurrence has been created, mapped, or otherwise safely identified and the
  current local note is empty.
- If the local occurrence note is non-empty and differs from the imported note,
  apply still stores the passive imported note row but must not change
  `occurrences.note` unless a later explicit note-replacement decision model is
  accepted.
- Note imports must not update occurrence status fields, status-event history,
  reminder deliveries, analytics inputs, or adherence logic.
- Accepted intervention actions store passive `imported_interventions` rows and
  provenance mappings. They must not write `reminder_deliveries`, schedule,
  send, cancel, retry, claim reminders, or call providers.
- Do not write Context/Profile records, Analytics Profile records, optional
  CSV-only data, reminder deliveries, or provider side effects in this phase.

### `behaviorlog_import_runs`

```sql
create table behaviorlog_import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  bundle_format text not null,
  schema_version text,
  manifest_sha256 text,
  bundle_fingerprint text,
  accepted_preview_run_id uuid,
  accepted_preview_fingerprint text,

  producer_name text,
  producer_version text,
  subject_id_strategy text,
  privacy_redaction_level text,

  import_mode text not null
    check (
      import_mode in (
        'preview_only',
        'create_missing_only',
        'merge_preview',
        'merge_by_user_approved_plan',
        'restore_preview',
        'restore_apply'
      )
    ),
  dry_run_summary jsonb not null default '{}'::jsonb,
  status text not null default 'previewed'
    check (status in ('previewed', 'applied', 'failed', 'cancelled')),
  failure_message text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  foreign key (user_id, accepted_preview_run_id)
    references behaviorlog_import_runs(user_id, id)
    on delete restrict
);
```

This table is the auditable import ledger. It records BehaviorLog bundle and
schema metadata, manifest/fingerprint hashes, producer information, privacy
profile hints, the requested import mode, a dry-run summary snapshot, status,
and start/completion timestamps. It does not mean imported product records have
been written; `status = 'previewed'` only means the bundle was validated and
previewed.

Successful applies also retain `dry_run_summary.portability` version 1. It
contains validated standard configuration events, source Occurrence timezone
and lineage metadata, and the known Cadence category registry. Existing record
mappings connect external identities to local rows on re-export. The 256 KiB
UTF-8 limit rejects oversized metadata; it never truncates history. Preview
ledger rows omit this metadata. No raw archive, credentials, or notification
replay state is retained through this field.

Imported historical Occurrences keep null local configuration lineage unless
the source can prove it. Migration
`20260831001533_preserve_unknown_imported_configuration_lineage.sql` removes
the atomic import function's assignment of the current configuration to new
historical Occurrences. It does not rewrite existing user records.

`merge_preview` rows store the accepted bundle fingerprint, local-data
fingerprint, and combined preview fingerprint in `dry_run_summary`. A
create-only or user-approved merge apply must reference one persisted, accepted
`merge_preview` row through `accepted_preview_run_id` and retain that row's
combined preview fingerprint in `accepted_preview_fingerprint`. Before writing,
the service rechecks the submitted bundle and current local graph against all
three accepted fingerprints. It rejects unaccepted preview data, a missing or
mismatched preview run, an altered bundle, changed local data, or a recomputed
preview that no longer matches. The applied ledger row therefore preserves the
auditable relationship to the exact reviewed preview without storing raw bundle
contents.

`restore_preview` rows are read-only restore previews. Their `dry_run_summary`
stores the restore preview fingerprint, local-data fingerprint, bundle
fingerprint, non-restorable account/provider/browser fields, destructive action
counts, sensitivity warnings, status-history policy planning, and
machine-readable create/replace/archive/delete/keep/skip actions. A
`restore_preview` row must not imply product records were restored.

BehaviorLog restore preview is behavior-data portability only. It can preview
destructive changes to behaviors, schedule slots, occurrences, status events,
inline occurrence notes, passive imported notes, and passive imported
intervention history, but it does not restore auth identity, profile email,
browser permissions, push subscriptions, provider accounts, provider secrets, or
external provider state.

Destructive restore apply uses `import_mode = 'restore_apply'` and requires a
previous accepted `restore_preview` snapshot. The service must require a
matching preview fingerprint, matching local-data fingerprint, explicit typed
confirmation, a fresh-backup acknowledgement, high/restricted note
acknowledgement when relevant, and stale-preview refusal before any archive,
replace, or delete operation is allowed.

Restore apply uses the transaction-scoped
`public.apply_behaviorlog_restore(restore_payload jsonb)` database function.
The function runs under the authenticated user context, filters every archive,
delete, update, and insert by `auth.uid()`, and applies the prepared restore
payload in dependency order. This keeps destructive restore atomic at the
database statement/function boundary instead of using a long multi-call client
workflow. The function is callable by the `authenticated` role only, not
`anon`, and it keeps behavior upserts keyed by the Behavior `id` primary key.
Internal trigger helpers such as `public.handle_new_user()` and
`public.set_updated_at()` are not directly executable by app roles.

The restore payload may archive behaviors absent from the bundle, delete local
schedule slots, occurrences, status events when a replacement policy is
explicitly selected, inline occurrence notes, passive imported notes, and
passive imported interventions according to the accepted preview. It may upsert
BehaviorLog-represented behaviors, schedule slots, occurrences,
occurrence-status events, passive imported notes, and passive imported
interventions. It must not restore auth identity, profile email, browser
permissions, push subscriptions, provider accounts, provider secrets, or
external provider state. It must not call notification providers or processing
routes.

Restore preview and accepted-preview fingerprinting materialize the complete
owner-scoped local graph before planning. User Behaviors, Behavior schedules,
schedule slots, Occurrences, Occurrence status events, imported Notes,
BehaviorLog record mappings, and imported interventions use deterministic
PostgREST range pagination. Behavior schedule rows are read separately and
reassembled instead of relying on capped embedded-resource arrays. Status
events also batch large Occurrence-ID filters before restoring global order.
Each list rejects duplicate/non-advancing pages and fails above the shared
100,000-row absolute read ceiling. A page failure or ceiling failure aborts the
preview or fingerprint; the service never plans or applies from partial local
data.

### `behaviorlog_import_record_mappings`

```sql
create table behaviorlog_import_record_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid not null,

  record_type text not null
    check (
      record_type in (
        'behavior',
        'schedule',
        'occurrence',
        'status_event',
        'behavior_definition_event',
        'time_session',
        'note',
        'intervention'
      )
    ),
  external_id text not null,
  local_id uuid not null,

  created_at timestamptz not null default now(),

  unique (import_run_id, record_type, external_id)
);
```

Mapping rows connect external BehaviorLog record ids to local Cadence ids for a
single import run. The unique constraint makes repeated mapping inserts
idempotent for the same run, record type, and external id. The table supports
behavior, schedule, occurrence, status event, note, and intervention mappings so
later import phases can share one provenance contract. External ids are
BehaviorLog ids and may be non-UUID values; restore apply may map ids such as
`sch_<uuid>` to deterministic local UUID schedule-slot ids while preserving the
original external id here.

### `imported_notes`

```sql
create table imported_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid not null,
  external_id text not null,

  target_type text not null
    check (target_type in ('behavior', 'occurrence', 'status_event', 'review')),
  target_external_id text not null,
  target_local_id uuid,

  body_markdown text not null,
  note_role text not null
    check (note_role in ('user', 'imported', 'system', 'ai_generated')),
  sensitivity text
    check (
      sensitivity is null
      or sensitivity in ('low', 'medium', 'high', 'restricted')
  ),
  source_original_id text,
  source_capture_method text not null
    check (
      source_capture_method in (
        'manual_tap',
        'manual_text',
        'system_generated',
        'imported',
        'inferred',
        'derived',
        'ai_generated',
        'unknown'
      )
    ),
  source_confidence text not null
    check (
      source_confidence in (
        'high',
        'medium',
        'low',
        'ambiguous',
        'unknown'
      )
    ),
  imported_created_at timestamptz not null,
  imported_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  unique (import_run_id, external_id),
  foreign key (user_id, import_run_id)
    references behaviorlog_import_runs(user_id, id)
    on delete cascade
);
```

`imported_notes` stores passive BehaviorLog note context for behavior,
occurrence, status-event, and review attachments. `target_local_id` points to
the local behavior, occurrence, or status-event row when one is safely known;
review notes may have no local target. Because the attachment is polymorphic,
the application service must only set `target_local_id` from resolver-approved
mappings and must not use notes for status, adherence, reminder, or analytics
calculations. Note mappings in `behaviorlog_import_record_mappings` point to
`imported_notes.id`. Import deduplication matches the external note id,
attachment type, and attachment external id across the account, not only the
current import run. Different attachment or body content is a merge conflict.

High and restricted sensitivity notes are allowed only after preview warnings
and explicit apply acknowledgement. AI-generated notes are skipped in v1.

### `imported_interventions`

```sql
create table imported_interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid not null,
  external_id text not null,

  behavior_external_id text not null,
  occurrence_external_id text not null,
  behavior_id uuid,
  occurrence_id uuid,

  intervention_type text,
  channel text not null check (channel in (
    'browser_push', 'email', 'sms', 'mobile_push', 'in_app',
    'calendar_notification', 'voice_assistant', 'webhook', 'other', 'none'
  )),
  delivery_status text not null
    check (delivery_status in (
      'pending', 'sent', 'delivered', 'failed', 'cancelled', 'suppressed', 'unknown'
    )),
  scheduled_send_at timestamptz not null,
  sent_at timestamptz,
  failure_reason text,

  source_original_id text,
  source_capture_method text not null,
  source_confidence text not null,
  redacted_sensitivity_indicators jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, id),
  unique (import_run_id, external_id),
  foreign key (user_id, import_run_id)
    references behaviorlog_import_runs(user_id, id)
    on delete cascade,
  foreign key (user_id, behavior_id)
    references behaviors(user_id, id)
    on delete set null (behavior_id),
  foreign key (user_id, occurrence_id)
    references occurrences(user_id, id)
    on delete set null (occurrence_id)
);
```

`imported_interventions` stores passive BehaviorLog Intervention Profile
history. It records the BehaviorLog intervention id, external behavior and
occurrence ids, local behavior and occurrence ids when known, intervention type,
channel, delivery status, scheduled/sent timestamps, sanitized failure reason,
source metadata, and redaction indicators. It must not contain raw provider
secrets, raw push endpoints, subscription keys, recipient identifiers, message
bodies, or raw provider payloads.

Migration `20260831014424_preserve_behaviorlog_passive_intervention_values.sql`
retains all canonical BehaviorLog 0.3 passive channels and delivery states.
The canonical `planned` state still maps to the existing stored `pending`
value. Native observations use `other` and may record `delivered`; neither
delivery nor OS verification proves user reading. This migration changes only
the passive table's checks. Operational reminder channels, delivery states,
RLS policies, grants, and stored rows remain unchanged.

Rows are provenance and review context only. They do not create, schedule,
send, cancel, retry, claim, or otherwise mutate operational
`reminder_deliveries`. Intervention mappings in
`behaviorlog_import_record_mappings` point to `imported_interventions.id` and
make repeated accepted applies idempotent.

Imported intervention promotion is a separate opt-in workflow. It may convert
selected future pending reminder interventions into operational
`reminder_deliveries` only after explicit user selection and confirmation.
The promotion workflow must leave sent, failed, cancelled, dismissed, past,
ambiguous, unresolved-parent, resolved-occurrence, inactive-behavior,
disabled-channel, and current-setting-mismatched intervention rows as passive
history.

### `reminder_deliveries`

```sql
create table reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null references occurrences(id) on delete cascade,

  channel text not null check (channel in ('browser_push', 'email')),
  scheduled_send_at timestamptz not null,
  sent_at timestamptz,
  processing_started_at timestamptz,
  import_run_id uuid,
  imported_intervention_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),

  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`import_run_id` and `imported_intervention_id` are nullable provenance fields
used only for explicit imported-intervention promotion. App-generated reminder
deliveries keep both fields null. Promoted deliveries must set both fields and
must still satisfy the normal idempotence key
`(occurrence_id, channel, scheduled_send_at)`, so promotion cannot create a
second operational delivery for the same occurrence/channel/send time.

Authenticated owner-scoped writes continue to plan pending deliveries, cancel
pending deliveries, and reactivate unclaimed cancelled deliveries. A
before-update guard prevents non-`service_role` callers from moving `sent` or
`failed` deliveries back to `pending`, or from clearing a non-null
`processing_started_at`. Server-only reminder processing retains the
`service_role` exception for provider-result recording and claim maintenance.

### `account_sync_apply_receipts`

Ticket 120 adds an immutable owner-scoped receipt for desktop account-sync
idempotency. Its primary key is `(user_id, idempotency_key)`. It binds the
request, baseline, local, hosted, and result fingerprints to the exact result
JSON. Authenticated clients may select only their own receipts. They receive no
insert, update, or delete grant. The authenticated-only atomic apply function
writes the receipt in the same transaction as accepted hosted product changes.

The hosted snapshot function reads the Ticket 116 boundary in one transaction,
orders typed entities deterministically, rejects more than 100,000 rows in any
collection, and rejects a complete result above 64 MiB. It excludes Auth
secrets, push subscriptions, occurrence-generation state, and device-local
native notification state.

### `launch_rate_limits`

```sql
create table launch_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('export_download')),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, action)
);
```

`launch_rate_limits` is operational account data. It stores no behavior text,
Note, request body, export content, IP address, recipient, endpoint, or billing
data. Authenticated clients may read only their own counter through RLS. They
cannot insert, update, or delete counters directly. The fixed, authenticated
`consume_launch_rate_limit` function owns atomic counter changes.

Ticket 067 defines `export_download` as six attempts in one 60-second window
per account across application instances and export formats. A denied attempt
does not start export reads or return a partial artifact. Account deletion
removes the counter through the Auth user cascade.

### `push_subscriptions`

```sql
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  endpoint text not null,
  p256dh text not null,
  auth text not null,

  user_agent text,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

An active push endpoint belongs to at most one account. The database enforces
this with a partial unique index on `endpoint` where `active = true`, while the
existing `(user_id, endpoint)` constraint keeps a user's stored endpoint rows
idempotent. The ownership-hardening migration deactivates older active
duplicates for the same endpoint before creating the index, retaining the most
recently updated row as active.

Current-device readiness is not inferred from the browser alone. Cadence
compares the browser subscription's exact endpoint, `p256dh`, and `auth` key
material with an active row visible to the signed-in user through normal RLS.
If the browser holds a subscription that is not persisted for the current
account, the client unsubscribes that stale browser state before creating a
fresh subscription. If the fresh subscription cannot be persisted, the client
unsubscribes it and reports setup failure instead of reloading as enabled.

The browser status and registration API uses the ordinary authenticated
Supabase client. It does not use the service-role key or a privileged ownership
transfer function. A provider that reissues an endpoint still active for a
different account is rejected by the unique index; Cadence removes the new
browser subscription and the user can retry after the obsolete endpoint has
been deactivated. The prior owner's database row can remain active briefly, but
successful browser unsubscribe invalidates its provider endpoint, so it cannot
deliver to that browser. A later normal push attempt receives the provider's
gone/not-found response and uses the existing delivery cleanup to mark that row
inactive. If browser unsubscribe itself fails, Cadence refuses to create a new
subscription and the user can retry the existing Settings action after clearing
the obsolete subscription in browser/site settings.

Each account may have at most 20 active rows. The cap trigger takes a
transaction-scoped advisory lock derived from `user_id` when an active insert
or activation occurs. It keeps the registering row plus the 19 most recently
updated other active rows and deactivates older rows. The migration first applies the
same `updated_at`, `created_at`, and `id` ordering to any pre-existing excess.
This makes the 21st registration an LRU eviction and prevents concurrent
successful registrations from leaving more than 20 active rows.

Registration consumes the `push_subscription_registration` action in
`launch_rate_limits`. Its fixed policy allows six attempts per authenticated
account in one 60-second window. Sign out posts the current browser endpoint
when available and deactivates only the matching RLS-visible active row before
the local Auth session is cleared. A missing endpoint or missing row is a no-op.
Existing browser subscriptions need no stored client migration because
PushManager supplies their endpoint at submit time.

### `exports`

Optional. Only implement if useful for export history.

```sql
create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  export_type text not null check (export_type in ('jsonl', 'csv', 'json_backup', 'behaviorlog_bundle')),
  created_at timestamptz not null default now()
);
```

### Account deletion

Public launch includes an account deletion path from Settings. The current
implementation requires an export acknowledgement and typed confirmation. The
server then constructs and verifies a server-only Supabase service-role client,
hard-deletes the authenticated `auth.users` row, and attempts global sign-out
to clear the current cookie-backed session. Configuration, verification, and
deletion failures occur before sign-out, so the account and session remain
available for a recoverable error.

Hard deletion cascades through Supabase Auth session rows and prevents refresh.
Already-issued stateless access-token JWTs can remain valid until their `exp`
claim. Global sign-out cannot retroactively revoke those JWTs. Cadence relies on
the ownership cascades below and the configured JWT lifetime for that bounded
window.

Deletion removes user-owned hosted records through the existing `on delete
cascade` ownership graph. Until a detailed retention policy is adopted, the
product posture is:

- retain user data while the account exists,
- delete user-owned records on account deletion,
- do not expose routine admin access to user behavior content,
- avoid sending sensitive behavior content to monitoring tools.

The first public-launch monitoring implementation reports privacy-safe
structured runtime events only. Monitoring context may include route names,
methods, coarse event names, and numeric counts. It must not include behavior
titles, behavior descriptions, occurrence notes, account emails, raw push
endpoints, subscription keys, provider secrets, tokens, request bodies, uploaded
BehaviorLog bundles, or reminder message bodies.

## RLS requirements

For every user-owned table:

- Select only where `user_id = auth.uid()`
- Insert only where `user_id = auth.uid()`
- Update only where `user_id = auth.uid()`
- Delete only where `user_id = auth.uid()`

Exceptions: `occurrence_status_events`, `behavior_definition_events`, and
`behavior_configuration_events` are append-only. Configuration and definition
history inserts use history-aware RPCs; authenticated clients receive select
only on configuration history and no direct mutation grant. Database cascades
may still remove events with their owning occurrence, Behavior, or account.

`launch_rate_limits` allows authenticated owner-scoped select only. Its
`SECURITY DEFINER` consume function checks `auth.uid()`, accepts only the fixed
`export_download` action, pins an empty `search_path`, and is executable by
`authenticated` only. `public` and `anon` execute privileges are revoked.

For `profiles`, use `id = auth.uid()` because the primary key is the
authenticated user's id. RLS still owns row visibility, while grants limit
authenticated profile mutation to the `timezone` column. Auth trigger
functions, not the authenticated Data API role, own profile creation and email
synchronization.

Normal app code should use the authenticated user context.

Do not expose the service-role key to client-side code.

Service-role access is reserved for narrow server-only maintenance,
scheduled-processing, or deletion workflows. It must not become the normal path
for user-facing reads or writes.

## Abuse and public-product protections

Before broad public launch, add standard protections around sensitive routes
and account creation:

- provider-level auth abuse protection where available,
- route/action validation for all mutations,
- practical rate limiting for public or secret-protected endpoints,
- a static RLS policy registry test covering every user-owned table,
- a repeatable multi-user RLS smoke command for local or hosted Supabase,
- monitoring that avoids sensitive behavior payloads,
- clear secret ownership for Supabase, Sequenzy, VAPID, and cron/process
  secrets.

Run `npm run smoke:rls` against the intended Supabase target when performing
hosted many-independent-user QA. The command creates two temporary auth users
with service-role access for setup and cleanup, then signs in through ordinary
publishable-key clients to verify that one user cannot read, insert, or update
another user's profile/category/behavior rows.

## Behavior edits and occurrence preservation

When a behavior changes:

- Unresolved occurrences strictly after the injected current instant may be
  regenerated.
- An unresolved occurrence with a non-empty note or any time session is
  preserved, even when it is scheduled in the future and the new schedule no
  longer produces it.
- Unresolved occurrences scheduled at or before the injected current instant
  are preserved. Same-day preserved occurrences remain Unresolved until the
  user decides them.
- Past occurrences are preserved.
- Resolved occurrences are preserved.
- Archived behaviors generate no new occurrences.
- Occurrences preserve schedule snapshots so historical rows still display the
  time or range that existed when they were generated.
- Existing null-lineage Occurrences remain null. Linked future unprotected
  same-identity Occurrences may advance to the new current configuration event.
- The final fresh-state write takes the same per-user advisory lock as Behavior
  configuration writers. It verifies the exact Behavior/current-event set and
  the planning-start sync-state existence/version. Every sync-state update
  increments `state_version`. A concurrent revision, occurrence-only
  import/restore, or zero-Behavior timezone change cannot clear a newer stale
  marker.

## Occurrence uniqueness

Use:

```sql
unique (
  behavior_id,
  local_date,
  schedule_start_time,
  schedule_range_identity
)
unique (user_id, id, behavior_id)
```

`schedule_range_identity` is a stored generated integer. Exact entries use
`-1`; ranges use the end time expressed as microseconds after midnight. This
keeps exact `00:00` and ranges ending at `00:00` distinct while giving
PostgREST a real conflict-target column. Occurrence generation must be
idempotent.

The `(user_id, id, behavior_id)` uniqueness constraint exists so status events
can enforce same-user ownership for their occurrence and behavior snapshot.

## Database functions

### `public.read_account_sync_snapshot()` and `public.apply_account_sync_plan(jsonb)`

`read_account_sync_snapshot` is a stable `SECURITY INVOKER` authenticated read.
It preserves ordinary owner RLS and returns one canonical typed snapshot.
Canonical object keys and entity kind/ID pairs use explicit `COLLATE "C"` byte order.
Clients use matching Unicode code-point order and half-even microsecond rounding.

Migration `20260911031421_accelerate_account_sync_canonical_json.sql` replaces
the recursive SQL fingerprint serializer with PL/pgSQL branch queries. It keeps
the same JSON bytes, text return type, immutable/invoker properties, empty search
path, and existing execution grants. No table or generated TypeScript type changes.
The SQL smoke check at `tests/sql/account-sync-canonical-smoke.sql` compares the
prior algorithm with nested, escaped, Unicode, numeric, and large synthetic input.

`apply_account_sync_plan` verifies `auth.uid()`, exact payload fields, bounds,
canonical fingerprints, the current hosted snapshot, zero unresolved
conflicts, row preconditions, and idempotency before applying any write. It
uses the existing owner-validating BehaviorLog restore boundary for graph,
history, provenance, and protected-Occurrence changes. It applies profile
timezone and reminder-delivery supplemental writes with compare-and-swap
checks. The product writes and immutable receipt share one transaction. Public,
anonymous, and service-role execution remain revoked; only `authenticated` may
execute it. This narrow `SECURITY DEFINER` boundary avoids granting direct
authenticated writes to protected history and graph tables.

The apply boundary serializes plans per account and locks each written entity
identity before its ownership check. Immutable receipts retain fingerprints,
not duplicated account snapshots. A replay reconstructs its response only
while the receipt result still matches the current hosted snapshot; otherwise,
the client must replan.

### `public.consume_launch_rate_limit(p_action text)`

Ticket 067 adds one atomic distributed counter for authenticated structured
exports. The function rejects anonymous callers and unsupported actions. It
returns `allowed`, `limit_count`, `remaining`, `reset_at`, and
`retry_after_seconds`. The caller cannot choose its limit or window.

The function does not bypass product-row RLS, read exports, or mutate user
content. It writes only the caller's `launch_rate_limits` row. The export
service consumes the decision after authentication and before export reads.

### `public.get_export_page_read_bundle(range_start_local_date date, range_end_local_date date)`

Ticket 043 adds a narrow Export-page read RPC to reduce repeated authenticated
Data API round trips. It returns one JSON bundle containing:

- profile timezone,
- occurrence sync state,
- categories,
- behaviors with category labels and schedule slots,
- occurrences in the selected export range,
- status events attached to those occurrences,
- reminder deliveries attached to those occurrences.

The function is `SECURITY INVOKER`, sets `search_path = public`, and filters
all user-owned rows to `(select auth.uid())`. It is executable by
`authenticated` only; `public` and `anon` execute privileges are revoked.

Export range resolution, occurrence freshness decisions, export formatting,
BehaviorLog bundle creation, and adherence math remain in TypeScript
services/resolvers. The RPC is a page-specific read bundle, not a generic data
access layer.

### `public.list_my_occurrence_time_sessions(occurrence_ids uuid[])`

Ticket 094 adds this non-overloaded arbitrary-ID read. The input contains only
Occurrence IDs. It never accepts an account identifier, role, JWT payload,
filter expression, or SQL text.

The function is `STABLE` and `SECURITY INVOKER`, with `search_path = ''` and
fully qualified references. It requires a non-null `auth.uid()`, explicitly
filters `occurrence_time_sessions.user_id` to that owner, and retains table RLS
as defense in depth. The migration revokes the exact signature from `PUBLIC`,
`anon`, `authenticated`, and `service_role`, then grants execute only to
`authenticated`. Normal callers use an authenticated Supabase client.

The function returns only `id`, `user_id`, `occurrence_id`, `behavior_id`,
`started_at`, and `stopped_at`. It orders rows by `started_at ASC, id ASC`.
Null and empty arrays return no rows. Duplicate input IDs do not duplicate
sessions. A direct call above 2,000 IDs fails with a non-sensitive validation
error.

`listTimeSessionsByOccurrenceIds` is the only application boundary for this
RPC. It normalizes duplicate IDs and makes sequential calls with at most 2,000
IDs each. Each call also follows PostgREST response ranges in 1,000-row pages.
A typical 666-ID input returning fewer than 1,000 sessions therefore uses one
request. An exact 1,000-row response triggers a continuation request. The
repository propagates any page error, deduplicates returned sessions by session
ID, and globally sorts all pages and ID batches by `started_at ASC, id ASC`.
Callers never receive a batching or response-page limit.

Timeline and single-Occurrence timing reads use this repository method.
Analytics and Export do not use it for historical ranges.

### `public.list_my_occurrence_time_session_history(date, date, boolean, timestamptz, timestamptz, uuid, integer)`

Ticket 094 adds this separately named historical read. Its parameters are
`range_start_local_date`, `range_end_local_date`, `include_archived`,
`through_started_at`, `cursor_started_at`, `cursor_session_id`, and
`page_size`, in that order.

The function joins `occurrences` to `occurrence_time_sessions` on owner,
Occurrence, and Behavior identity. It joins `behaviors` to apply the current
archive choice with `(include_archived OR behavior.active)`. The requested
history window uses `occurrences.local_date`. The function never derives the
product date from `started_at` and never accepts an Occurrence-ID array.

The start date, end date, archive choice, and high-water instant are required.
The start date must not follow the end date. First-page cursor fields are both
null. Later pages supply both fields. Page size must be from 1 through 1,000.
The query applies `session.started_at <= through_started_at` on every page and
uses strict `(started_at, id)` tuple comparison after the cursor. It returns
the same six minimal columns in `started_at ASC, id ASC` order.

`listTimeSessionHistory` uses a page size of 1,000 and follows keyset pages
until a shorter page returns. An exact 1,000-row page therefore triggers a
continuation call. The repository reuses one service-supplied high-water value
for every page, rejects duplicate or non-advancing rows, and fails above the
shared 100,000-row absolute read ceiling. An all-time request maps its null
application start to the explicit `0001-01-01` database sentinel.

This function has the same `STABLE`, `SECURITY INVOKER`, empty `search_path`,
explicit `auth.uid()` ownership, owner RLS, and authenticated-only exact
signature grant as the arbitrary-ID function.

`analytics.service.ts` supplies its resolved dates, `includeArchived: true`,
and injected `now` as the high-water value. Selected-day and Behavior history
consume that Analytics data. `export.service.ts` calls the historical method
only when `include_time_tracking=1`; it supplies the resolved export dates,
requested archive choice, and injected `now`. Repositories remain the only RPC
callers. Pages, routes, components, and resolvers do not call either function.

## Authenticated read cache

Ticket 044 adds a small server-side read-through cache for low-volatility
authenticated data. Cache keys include the authenticated `userId`, a bucket
name, and an optional variant such as an import-run limit. Keys must not include
emails, provider tokens, secrets, request bodies, behavior text, occurrence
notes, or push subscription material.

Cached buckets:

- `profile_timezone`
- `profile_settings`
- `behavior_list`
- `category_list`
- `behaviorlog_import_runs`

Cache misses still read through the ordinary authenticated Supabase client and
RLS. The cache does not use service-role access for normal app reads.

Invalidation is explicit:

- behavior create/update/archive/restore invalidates behavior/category/timezone
  read buckets,
- Settings timezone changes invalidate profile and behavior buckets,
- BehaviorLog import/restore previews and status updates invalidate import-run
  buckets,
- BehaviorLog import/restore applies invalidate behavior/category buckets,
- account deletion clears all cached buckets for the deleted user.

Occurrence rows, occurrence status events, reminder deliveries, push
subscriptions, and account deletion authorization data remain uncached.

### `public.get_export_page_summary(date, date, boolean, boolean, timestamptz)`

Ticket 091 adds an authenticated, STABLE SECURITY INVOKER counts-only read.
It uses an empty search path, explicit owner predicates, and existing RLS.
Only authenticated users receive EXECUTE; anonymous and service roles do not.
The function returns Behavior counts, Completed/Not Completed/Unresolved
counts, and optional time-session counts for the inclusive local-date range.
Time-session counts use the supplied `through_started_at` cutoff, matching downloads.
Inactive Behaviors require `include_archived`; all-time uses 0001-01-01 through
9999-12-31, including saved future Occurrences. It returns no record arrays,
Notes, history, or export artifacts. Download reads retain the existing RPC.


## Archive note history (Ticket 125)

`behaviors.archive_notes` is non-null JSONB with default `[]`. Each entry has a
UUID `id`, UTC `archived_at`, nullable plain-text `note`, and UTC `updated_at`.
The same Behavior owner and RLS policies protect the history. The database
validates shape, unique IDs, timestamps, and text bounds. The shared resolver
normalizes text and validates the precise UI length limit.

The existing Behavior graph transaction saves archive state and notes together.
Restore preserves entries. Editing/removing text uses the loaded Behavior
revision and retains entry identity and archive time. Notes do not create
configuration or definition events. Account synchronization carries the whole
Behavior history and rejects old writes that omit the new field. Old saved
baselines normalize the missing field to an empty history.

Migration: `20260906010951_add_behavior_archive_notes.sql`. Legacy archived
rows remain empty; the migration does not fabricate past archive cycles.

## Behavior duration and scheduled archive (Tickets 142–143)

`behaviors.default_duration_minutes` is a nullable integer from 1 through
1,440. It is independent of measured Occurrence time. `behaviors.end_date` is
the nullable four-digit-year local date on which the Behavior first becomes
archived. `behaviors.auto_archived_at` is the nullable, finite automatic-archive
instant used by the durable in-app notice. A marker requires an inactive
Behavior with an `archived_at` instant.

Atomic create, edit, import, restore, export, and account-sync paths carry all
three fields. Legacy edit payloads that omit a field preserve its stored value.
Account-sync writes must contain all three keys so an older client cannot erase
newer data. These optional fields are current Behavior metadata, outside the
existing configuration-history field vocabulary. Automatic archive still records
an `active` transition. Occurrence writers check the locked, current end date
for inserts, updates, and elapsed-row cleanup, independent of configuration lineage.
Migration:
`20260918010100_add_behavior_duration_and_scheduled_archive.sql`.

## Note shortcut state (Tickets 126–128)

`note_shortcut_states` stores records separately from historical Notes. Its
composite primary key is `(user_id, id)`. `id` is `global` with null `behavior_id`,
or the exact Behavior UUID text with that owned `behavior_id`. Composite ownership
foreign keys and RLS reject foreign Behaviors; account/Behavior deletion cascades.
Fields are `enabled boolean`, `entries jsonb`, `excluded_occurrence_ids jsonb`,
`revision integer`, and `updated_at timestamptz`. Global arrays must be empty.
Absent state means disabled. Arrays, enum values, IDs, lengths, and ownership
are validated at storage boundaries. Mutations compare the captured state and
commit atomically; concurrent changes fail rather than overwrite. Rendered management
actions also carry a content fingerprint, because equal integer revisions from
independent devices do not prove equal state.
Revision values range from 0 through 2,147,483,647 on every platform. Commands
reject an increment at the ceiling before mutation. Synchronization rejects
over-limit snapshots before planning or applying writes.

Each entry has a SHA-256 normalized-pattern `key`, nullable `text`, `status`
(proposed/accepted/dismissed), `source` (repeated_text/model), `evidence` containing
only Occurrence IDs and exact Note SHA-256 hashes, `created_at`, and nullable
`expires_at`. Accepted text is user-controlled. Dismissed records retain no text
or evidence. Bounds and expiry follow PRODUCT_SPEC. Evidence hashes are private,
not anonymized public data. Saving a shortcut-assisted Note and adding its ID to
`excluded_occurrence_ids` is one guarded transaction. Existing saves that omit
this optional flag retain all previously recorded exclusions.
The 128-slot bound counts each accepted entry twice, reserving room to suppress
both original and edited text on removal. PostgreSQL, SQLite, and core validation
enforce the same bound before accepting additional retained state.

Normal and reviewed account synchronization retains the sorted union of exclusion
IDs from the common baseline and both copies. It changes no winning shortcut text,
status, suppression key, or setting. If review selects deletion while the owned
Behavior survives, synchronization writes a disabled state with no entries and
the retained IDs. Deleting the Behavior may cascade the state. An explicit
first-link local-dataset discard does not retain exclusions from that discarded
copy. A union above 100,000 IDs fails instead of truncating.

Analysis reads current owned sources. Before proposal persistence, compare source
Notes, current state, global enablement, and Behavior lifecycle again atomically.
No stale result may revive removed text or overwrite an accepted edit. No raw
Note text enters logs or monitoring. Cloud consent is separate, device-specific,
and never a synchronized state field. Provider analysis remains disabled until
the Ticket 126 evaluation authorizes it.

Expiry immediately removes proposals/suppressions from eligibility and UI. The next
explicit shortcut mutation prunes expired records. No background cleanup job is
added. Until that mutation, expired private records can remain in the database and
protected native backups. User removal clears live shortcut text immediately;
existing backups retain their prior snapshot under the existing backup policy.

### Dependency-safe account apply (Ticket 130)

Migration `20260908174627_guard_dependency_safe_account_sync.sql` strengthens
`cadence_private.apply_account_sync_plan(jsonb)` without adding tables. It permits
reminder deletion only with the parent Occurrence deletion, requires every attached
reminder deletion, and rejects retained reminders for a deleted parent. Notes,
status history, tracked time, and resolved Occurrences prevent deletion. The
existing JWT ownership, RLS, expected-row, transaction, and receipt checks remain.


### Full-history BehaviorLog capacity (2026-09-16)

Preserved portability metadata allows 8 MiB per applied import ledger. The
shared validator rejects overflow before apply, without truncating history.
No columns or public RPC signatures change. Migration
`20260916195000_bound_behaviorlog_import_action_memory.sql` changes the private
merge-action lookup to release per-call memory and indexes accepted actions
once per SQL import phase. First-match semantics, owner checks, fingerprint
binding, atomic rollback, and append-only history remain unchanged. Counter
updates omit the duplicated import ledger until the final response. The import
RPC receives a bounded 60-second timeout instead of the interactive eight
seconds. Account snapshot reads allow 25 seconds, inside the existing desktop
30-second synchronization deadline. The 64 MiB snapshot limit is unchanged.
Restore preview ledgers retain action, external ID, and local ID for SQL mapping
authorization. Full preview records are recomputed and fingerprint-checked before
apply. Applied replay returns its receipt without claiming a compact ledger is a
full preview. No historical product records are omitted.

## Google Calendar connector (Ticket 134)

Migration `20260917002649_google_calendar_connector.sql` adds owner-scoped
`google_calendar_connections` and `google_calendar_preferences`. Connections
are authenticated SELECT-only. Preferences have explicit column UPDATE grants,
owner SELECT/UPDATE RLS, and a database-incremented selection revision.
Every row references its Auth owner and cascades on deletion.

The non-exposed `cadence_calendar_private` schema holds sealed refresh credentials
and five-minute OAuth attempts. Both tables enable RLS and deny client grants.
Exact `calendar_*` server-only RPC signatures consume attempts atomically, install
credentials with generation/state compare-and-swap, and fence disconnects. They
use empty search paths and fully qualified names. PUBLIC, anon, and authenticated
cannot execute them. The server repository is the only caller. This narrowly
scoped credential exception does not authorize privileged Cadence domain reads.

AES-256-GCM binds ciphertext to purpose, owner, Google subject, generation, and
attempt hash where applicable. A key ID selects the decryption keyring. Credentials
never enter exports, sync snapshots, or desktop backups. Hosting infrastructure
backups may retain sealed ciphertext under the existing provider retention policy.
Local ownership/race verification: `tests/sql/google-calendar-contract.sql`.

## Advisor day-context reads (Ticket 146)

Migration `20260919010100_add_advisor_cadence_snapshot.sql` adds owner-scoped
`read_advisor_cadence_snapshot` and `read_advisor_cadence_revision` RPCs. The
private payload helper assembles profile timezone, selected active Behaviors,
today's persisted Occurrences, duration-estimate samples, and sync coverage in
one database snapshot. The companion revision detects changed source data.
These reads use the authenticated owner's RLS context. They do not use a
service-role fallback or perform tracking maintenance.

Current-day completeness requires fresh sync coverage and no due archive.
The fresh-write configuration/state-version fence certifies current Behavior
configurations. The snapshot's `staleConfigurationCount` is diagnostic only:
occurrence generation deliberately preserves older or null lineage for past
occurrences and protected history. A lineage mismatch alone must not reject
a freshly synchronized snapshot. Stale coverage still fails closed.

The snapshot's internal duration history never leaves the web service. The
consumer projection contains opaque references and aggregate duration estimates.
The 10,000-Occurrence and 20,000-session history ceilings include an overflow
sentinel. Overflow produces unknown measured duration rather than an estimate
from truncated samples. Explicit Behavior default durations remain available.

The RPCs are internal first-party read boundaries, not advisor credentials or
grants. The disabled advisor endpoint cannot invoke them. The September 20
in-app plan reuses first-party ownership; it requires no delegated consumer token.
Migration `20260921003928_revise_advisor_completion_history.sql` extends the
shared payload/revision with all-status history. `cadence.history` contains
Completed, Not Completed and Unresolved counts per selected active Behavior for
90 complete local days. The 10,001st row makes every count null and completeness
unknown. Session overflow affects duration only; raw history never reaches the model.

Migration `20260921003952_add_daily_brief_controls.sql` adds three private,
owner-keyed RLS tables. Direct clients have no table privileges:

- `daily_brief_preferences`: enabled, optional Calendar disclosure, revision,
  captured Calendar connection generation/selection revision and update time.
- `daily_brief_runs`: latest local day/timezone, disclosure revision, status,
  attempt token and timestamps per installation. At most eight installations
  remain; new installations evict the oldest inactive attempt.
- `daily_brief_rate_limits`: at most six recent start timestamps per owner.

Public invoker RPC wrappers call narrowly granted private definer functions.
Every RPC derives `auth.uid()` and requires a matching current `auth.sessions`
row, including `not_after`. No user metadata authorizes disclosure. Atomic
owner locks enforce one account-wide active generation, six starts/minute and a
75-second lease. Completed daily requests do not generate again; only explicit
retry restarts a failed/expired attempt. A retry without a saved attempt follows
normal initial admission. Completion tokens prevent late requests from finishing
replacement leases; a delivery-fence failure can downgrade its own completion.

Migration `20260926150000_daily_brief_bounded_recovery.sql` (Ticket 168) adds
`daily_brief_runs.admissions` (1–4). Server completion does not prove that the
user saw the brief, so an explicit retry may now replace a completed attempt as
well as a failed or expired one. Admissions count per installation, local date and
disclosure revision: one automatic start plus three deliberate retries. The fifth
returns `retry_exhausted`. The one-active-generation rule and six starts/minute
still apply first; no quota or admission record is cleared. A new local day or
disclosure revision starts at one. The column stores no prompt or generated text.

Migration `20260926170000_daily_brief_analysis_sources.sql` (Tickets 169, 172, 173):

- `daily_brief_preferences` adds `include_reminder_history` and `include_notes`
  (default false; both require `enabled`). `save_daily_brief_preferences_v2` saves
  all four controls. The original three-argument save now revokes both optional
  sources, so an older client never keeps or grants them silently. Every save
  bumps the revision, which fences in-flight briefs.
- `read_advisor_analysis_snapshot(target_local_date, history_start_local_date,
  selected_behavior_ids, include_reminders, include_notes, revision_only)` is a
  public invoker wrapper over a private definer function. It requires the current
  session, today's owner-local date and exactly 90 prior days, and filters every
  table by the caller. It returns history occurrences (slot, status, latest mark,
  configuration event), status events, configuration events (kind, effective time,
  changed fields, reminder toggles), and optionally reminder deliveries and Notes.
  Undisclosed optional sources return `not_permitted`; requested flags cannot
  override disclosure. Notes come only from Not Completed occurrences, trimmed to
  280 characters, at most 200 most recent. Row limits plus one signal a cap
  (10,000 occurrences, 20,000 events, 2,000 configuration events, 10,000
  deliveries). The payload's SHA-256 revision fences delivery; `revision_only`
  returns only that hash.
- `daily_brief_tip_deliveries` stores `(user_id, fingerprint, last_shown_local_date)`.
  The fingerprint is a server SHA-256 of lane, Behavior, subject and evidence band;
  no finding or generated text is stored. A shown tip records its own band and the
  two adjacent bands, so evidence at a band edge stays in cooldown. `record_daily_brief_tip` writes only for
  the caller's completed attempt with the same lease and preference revision within
  two minutes of completion. Rows older than 30 days and beyond 64 per owner are
  pruned. Disabling Daily Brief deletes them; account deletion cascades.

Preferences start disabled. Saving controls increments their revision and clears
attempts. Calendar disclosure records the current selected-calendar revisions;
a changed connection/selection requires renewed disclosure. Disabling clears
attempt rows. All three tables cascade on account deletion. Latest attempt/rate
metadata otherwise persists until replacement; this is not a timed deletion SLA.
No prompts, model output, raw facts or credentials are persisted in these tables.
Rollback disables the feature or removes the server key; keep additive migrations
until a separately reviewed removal migration is needed.

Migration `20260919010200_add_advisor_read_admission.sql` adds private operational
read-admission state. Each row binds its lease to `user_id` and `client_id`; it
contains no titles, context, provider payloads, or credentials. Account deletion
cascades to these rows. The acquire/release RPCs derive ownership from `auth.uid()`.
An account-wide transaction lock serializes admission. At most six reads start
per minute across the account, with one active lease per account/client.
Lease-specific release cannot release a replacement request.

The table enables RLS and denies direct client table privileges. Exact function
grants exclude anon and service-role callers. Cleanup removes old owner metadata
on later calls; inactivity can retain rows until the next call or account deletion.
This is not a guaranteed one-day deletion schedule. The first-party generation
metadata policy is documented above and in `docs/OPERATIONS.md`.

## Advisor historical completion-time projection

The advisor snapshot now projects existing `occurrences.status_marked_at` as
`historyOccurrences[].statusMarkedAt`. No table, capture field or status semantics
change. Current Completed snapshots provide one mark per Occurrence; the separate
status-event ledger remains audit history, not independent timing samples.
No fallback uses note-update times or ambiguous historical event backfills.

The private snapshot payload and its revision hash include the mark, so a changed
completion mark invalidates pending contexts. Owner filters, RLS, selected active
Behaviors and bounded history reads remain. The optional parser field supports
unmigrated environments as `source_unavailable`, never invented finish-time data.
Shared summaries use `docs/DATETIME_STRATEGY.md`; no raw private mark timestamps
enter the model or inspector. The SQL function signature still returns JSON, so
public generated database types have no new columns or RPC arguments.
