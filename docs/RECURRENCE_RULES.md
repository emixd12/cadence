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

Each behavior must have at least one schedule, and each schedule must have at
least one time entry. A schedule owns exactly one recurrence rule.

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

## Behavior end date

A Behavior may have a nullable `end_date` in its own timezone. The end date is
the first archived local date. Occurrence generation includes dates before the
end date and excludes the end date itself.

Creating a Behavior, or changing an active Behavior's end date, refuses an end date
on or before the current local date in the Behavior's timezone: such a Behavior would
be archived at once and never run. An unchanged end date is not checked again.

At or after local midnight on the end date, lifecycle reconciliation archives
an active Behavior. A delayed reconciliation records the actual processing
instant while its configuration event keeps the end-date midnight as the
effective instant. Web reconciliation runs before authenticated product reads
and in protected background processing. Desktop reconciliation runs on launch,
resume, local day change, and foreground refresh.

Automatic archival removes unresolved generated rows on or after the end date,
including rows whose scheduled instant passed before delayed reconciliation.
Completed, Not Completed, noted, or time-tracked rows remain historical data.
Restoring an automatically archived Behavior clears an expired end date so the
next lifecycle reconciliation does not archive it again immediately.

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
- End date is the first excluded local date and automatic archive boundary.
- Multiple schedules with different recurrences can generate occurrences.
- Exact-time and time-range entries generate occurrence snapshots.
- Duplicate generated occurrences merge before analytics/reminders see them.
- Legacy behavior-level recurrence/time records still resolve as one schedule.
