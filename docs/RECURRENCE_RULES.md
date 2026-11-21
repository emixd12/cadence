# Recurrence Rules

## Supported recurrence types

V1 supports:

1. Daily
2. Every N days
3. Weekly on selected weekdays
4. Every N weeks on selected weekdays
5. Monthly on day N

Do not implement natural-language recurrence in v1.

Do not expose raw cron syntax in the user interface.

## TypeScript shape

```ts
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type RecurrenceRule =
  | {
      frequency: "daily";
      interval: number;
    }
  | {
      frequency: "interval_days";
      intervalDays: number;
    }
  | {
      frequency: "weekly";
      interval: number;
      daysOfWeek: Weekday[];
    }
  | {
      frequency: "monthly";
      interval: number;
      dayOfMonth: number;
    };
```

## Schedules and time entries

Each behavior must have one to six schedules, and each schedule must have at
least one time entry. A schedule owns exactly one recurrence rule. An opportunity
Behavior may have no schedules (see "Behaviors of Opportunity").

Use local times in the user's timezone.

Exact-time examples:
- `22:00`
- `09:30`

Preset time ranges:
- Morning: `06:00` to `12:00`
- Afternoon: `12:00` to `18:00`
- Evening: `18:00` to `00:00`
- Night: `00:00` to `06:00`

For recurrence expansion, each time entry has an anchor time. Exact-time
entries use their exact time. Range entries use the start of the range.

If a behavior has multiple schedules, occurrence generation iterates each
schedule's recurrence, expands all of that schedule's time entries, and creates
one occurrence per matching time entry. Generated candidates at the same local
date and start time are deduplicated only when their exact/range and range-end
identity also match. Exact and range entries that share a start time remain
distinct. Stable sort order supplies the snapshot only for identical candidates.

Legacy behavior-level recurrence and flat schedule-slot records are normalized
to a single schedule before occurrence generation. A persisted schedule parent
with no time entry is a typed integrity outcome, not an empty generation plan.
One legacy-compatible empty parent can be identified as repairable from the
behavior compatibility recurrence/time fields; a graph with an empty schedule
among multiple schedules is ambiguous and must fail without marking occurrence
freshness successful.

## Timezone

All rules are evaluated in the user's timezone.

Default:
`America/New_York`

## Day boundary

Local midnight.

The current-day timeline section covers:
- local date at 00:00:00 through local date at 23:59:59.999

Unresolved items before today's local date appear under Needs decision.

## Monthly fallback

If a behavior is scheduled for day 31 and the month has fewer days, schedule it on the last day of the month.

Examples:
- January 31 -> January 31
- February 31 -> February 28 or February 29 in leap years
- April 31 -> April 30

## Occurrence generation range

The system should maintain generated occurrences for:
- Prior unresolved items
- Today
- The next 30 days

The Ticket 060 one-time repair uses the behavior's stable local creation date
as its recurrence anchor and repair-range start, then expands through the
current local day plus the same 30-day future horizon. It inserts only missing
occurrences for schedules whose missing compatibility slot was repaired.
Existing occurrences, including Completed or Not Completed rows, are
preserved. A prior missing occurrence is inserted as Unresolved with no
fabricated completion timestamp or status event; it enters Needs decision only
through the normal prior-local-date rule.

## Behavior end and pause

Behaviors never archive by themselves. An end or a pause stops scheduling while
the Behavior stays active; Behaviors lists it under Not running. Only a person
archives a Behavior. `packages/core/src/resolvers/behavior-run.resolver.ts` owns
these rules.

### Fields

All values are local to the Behavior's timezone. None is stored as an instant.

- `end_on`: the last local day the Behavior runs. Null means no end.
- `end_time`: optional local time on `end_on` when it stops. Null means it stops
  at the end of `end_on`.
- `pause_from_on`: the first paused local day. `pause_from_time` is an optional
  local time on that day; null means the start of the day.
- `pause_back_on`: the local day it runs again by itself, from the start of the
  day. It is later than `pause_from_on`.

A Behavior has one pause at a time. A new pause replaces the old one. Times are
whole minutes. Local times follow the "compatible" rule: a time skipped by a
spring-forward change moves to the next valid time, and a repeated time takes the
earlier instant.

### Run state

`behaviorRunState(fields, now)` returns one of `running`, `ended`, `paused` or
`archived`. Archive wins. An end that has passed wins over a pause. Nothing is
written when an end or a pause arrives; the state is read from the fields.

### Which Occurrences stop

The stop rule compares an Occurrence's effective time: the moved time when the
row was moved for the day, otherwise the planned time.

- An exact time stops when it starts at or after the end, or inside the pause.
- A time range stops when its window is still open at the end, or overlaps the
  pause. End now at 8 PM removes that evening's Evening window.

Generation creates no stopped rows. Post-write sync removes stopped Unresolved
rows, including past and moved ones; this is the one exception to the rule that
keeps past and moved rows. Completed, Not Completed, noted and timed rows always
stay. Once a stop starts today or earlier, generation does not recreate a row
that already started, so a removed moved row does not return at its planned time.
Generation reads from the earliest stopped local day, so rows left by an end set
offline are removed on the next sync.

### Actions

- Ends after: set `end_on` and optional `end_time` on create or edit.
- End now: sets the end to the current minute, rounded up. Ending an ended
  Behavior changes nothing.
- Pause: sets the pause. It can start today or later; today starts now unless
  `pause_from_time` is later.
- Resume now: clears the pause, and an end that has passed. An end still to come
  stays.
- Start again: clears the end.
- Restore keeps the end, so an archived Behavior with a passed end comes back as
  ended.

Entry points refuse a new end or pause start that is already in the past. A
stored value is not checked again on later saves. Each action writes one
configuration revision whose changed fields include `end` or `pause`.

### Timezone change

A Settings timezone change re-expresses stops that already happened, so their
moment stays the same. A stop still to come keeps its wall-clock time and moves
with the new timezone.

### Timeline notices

Timeline notices are derived from the fields, with no stored record: "ended" on
the day the end arrives, "paused" on the day a pause starts, and "back" on the
back-on day. Archived Behaviors show none.

## Behaviors of Opportunity

A Behavior with `is_opportunity` is in the opportunity pool: the person can add it to
today when a chance comes. The flag is a capability, not a run state. A Behavior can be
scheduled only, scheduled and an opportunity, or an opportunity with no schedules.

### Schedules

- An opportunity Behavior may have zero to six schedules. Any other Behavior has one to
  six.
- With no schedules, the legacy `recurrence_rule` and `scheduled_time` are null and
  generation plans nothing for it.
- Turning the flag off needs at least one schedule.
- Turning the flag on or off is a configuration revision with changed field
  `is_opportunity`.

### Run state

The pool holds Behaviors that are active, not archived and running now. Ending or
pausing a Behavior takes it out of the pool; Resume now and Start again bring it back.
An opportunity can be added only at a time the Behavior is running, by the stop rule in
"Which Occurrences stop".

### Opportunity Occurrences

- `add_opportunity_occurrence` adds one Occurrence with `origin = 'opportunity'` for
  today, at an exact time or in a time range (an optional preset names the range). The
  row has no schedule slot.
- Done now adds the row and marks it Completed in the same call, with its status event.
  A Daily Brief suggestion only places a row; it never marks one Completed.
- `added_by` records who added it: `user`, `daily_brief`, `chat` or `mcp`.
- Generation never updates or deletes an opportunity row. Schedule edits, pauses and
  ends leave it in place. The schedule identity covers scheduled rows only, so an
  opportunity row at a scheduled time does not block the scheduled row.
- An opportunity row starts Unresolved. Past local midnight it joins Needs decision like
  any other Unresolved row. Nothing marks it missed.
- `remove_opportunity_occurrence` removes it while it is Unresolved with no Note, no
  tracked time, no status history and no active source match. Its pending reminders are
  cancelled. Any other opportunity row stays.

Database details: docs/DATA_MODEL.md, "Behaviors of Opportunity".

## Sub-behavior schedules (Ticket 343)

1. A sub-behavior with `inherit_parent_schedule = true` stores a copy of its parent's
   schedules, time entries, timezone, end and pause on its own rows. The resolver
   `mirrorParentSchedule` builds the copy and reuses the child's schedule row ids by
   position; parent row ids are never copied. `planInheritedScheduleMirrors` lists the
   children that need a new copy after a parent edit, and the service writes the parent
   and those copies in one transaction.
2. A following sub-behavior's own schedule, end and pause cannot be edited. Run actions
   (End now, Pause, Resume now) on it are refused; they apply on the parent.
3. A sub-behavior with `inherit_parent_schedule = false` keeps its own schedule and
   follows every rule in this document on its own.
4. While a parent has at least one active sub-behavior (`hasActiveSubBehaviors`),
   Occurrence generation creates and updates no Occurrence for the parent. Future
   Unresolved parent Occurrences with no note, time, move or mark are deleted; all
   other parent Occurrences stay. When the last active sub-behavior leaves, the parent
   generates again.
5. A routine slot is one parent, one local date and one effective start. Following
   steps share the slot; a step with its own schedule appears in the routine only on
   its own days.

## Idempotence

Occurrence generation must be idempotent.

Running generation twice must not create duplicates.

The persistence idempotence key is behavior, local date, start time, and range
identity. The resolver deduplicates by that same identity before persistence.

Every new generated Occurrence stores the current Behavior configuration-event
ID. Existing legacy, imported, or restored rows with null lineage stay null.
Generation may advance lineage only for an already-linked, unresolved row
strictly after the injected current instant when the new graph still produces
the same occurrence identity. Resolved rows, rows at or before the current
instant, rows with notes, and rows with time sessions retain their historical
lineage and schedule snapshot.

Duplicate schedules still merge deterministically before persistence. The
generation service plans from one current Behavior and schedule graph. The
database locks that Behavior and rejects a plan unless its expected current
event still matches. Inserts must all succeed. Updates and deletes must still
match their protected state and planned identity. The final freshness write
uses the configuration-writer advisory lock and verifies the exact current
Behavior/event set plus the planning-start sync-state existence/version before
clearing stale state. Every stale or fresh state update increments that
version.

Restore or import updates that name identity or schedule-snapshot columns clear
captured lineage at the database boundary. Status and note-only updates do not.
The generation-plan transaction reapplies the verified current event after its
guarded snapshot update.

## Interval anchor

Interval-based rules need a stable local calendar anchor. The resolver accepts
an optional `anchorDate` as `YYYY-MM-DD` in the behavior timezone. Services
should pass the behavior's stable local start or created date when available.
If omitted, the resolver uses the local `rangeStart` date.

## Resolver contract

Implement recurrence expansion in:

`/lib/resolvers/recurrence.resolver.ts`

Function shape:

```ts
import type { Temporal } from "@js-temporal/polyfill";

export function resolveOccurrenceSchedule(input: {
  recurrenceRule: RecurrenceRule;
  scheduledTime: string;
  timezone: string;
  anchorDate?: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Array<{
  scheduledFor: Temporal.Instant;
  localDate: string;
}>;
```

The resolver must be pure:
- No database calls
- No React
- No browser APIs
- No email/push side effects

## Required tests

- Daily at 10 PM generates one occurrence per day.
- Every N days generates the correct interval.
- Weekly Friday generates only Fridays.
- Every other Sunday generates every 14 days.
- Weekly rule can support multiple weekdays.
- Monthly day 31 falls back to last day of short months.
- Timezone remains America/New_York.
- Local midnight boundary behaves correctly.
- End day is the last local day that runs; an end time stops it at that minute.
- A pause stops rows from its start until the start of the back-on day.
- End now removes a time range that is still open, and keeps marked, noted and timed rows.
- Multiple schedules with different recurrences can generate occurrences.
- Exact-time and time-range entries generate occurrence snapshots.
- Duplicate generated occurrences merge before analytics/reminders see them.
- Legacy behavior-level recurrence/time records still resolve as one schedule.
