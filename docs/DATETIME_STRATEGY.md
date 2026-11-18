# Date and Time Strategy

This app is recurrence-heavy. Date/time drift is one of the highest-risk areas for future agents, so this strategy is locked before resolver implementation begins.

## Product decisions

- Default timezone: `America/New_York`.
- User timezone is stored on `profiles.timezone` and copied to each behavior as `behaviors.timezone`.
- Settings can update `profiles.timezone`. A user-approved timezone change also updates active behaviors to the new timezone and resyncs future unresolved occurrences. Past occurrences and resolved occurrences remain historical records.
- Settings commits the profile timezone, every active Behavior timezone,
  configuration history, and one stale sync marker in one owner-scoped
  transaction. Occurrence sync runs afterward and remains safe to retry.
- Browser timezone detection uses `Intl.DateTimeFormat().resolvedOptions().timeZone`; it does not use geolocation or request location permission.
- Day boundary is local midnight in the behavior/user timezone.
- Needs decision is derived from `status === "unresolved"` and `local_date` before today's local date.
- The system does not auto-mark unresolved occurrences as missed.

## Storage model

Use both an instant and a local calendar date:

- `occurrences.scheduled_for timestamptz`: exact UTC instant for a scheduled occurrence.
- `occurrences.local_date date`: calendar date in the occurrence's timezone.
- `behavior_schedules.recurrence_rule jsonb`: recurrence pattern for one
  schedule under a behavior.
- `behavior_schedule_slots.start_time time`: local wall-clock time or range
  start chosen by the user for one schedule time entry.
- `behavior_schedule_slots.end_time time`: local range end for time ranges.
- `behaviors.scheduled_time time`: first schedule time-entry start kept for
  compatibility and simple ordering.
- `occurrences.schedule_*`: snapshot fields preserving the exact time or range
  label source for historical occurrence rows.
- `behaviors.timezone text`: IANA timezone name, default `America/New_York`.

`local_date` is not a convenience cache to ignore. It is the stable grouping key for timeline sections, Needs decision, export, and analytics.

## Implementation library

Use Temporal for timezone-aware calculations. Until native Temporal is universally available in the app runtime, future implementation should add `@js-temporal/polyfill` and import from it in resolver/service code that performs timezone math.

Do not introduce Moment, Luxon, date-fns, date-fns-tz, Day.js, or ad hoc `Date` arithmetic for recurrence or day-boundary logic unless this document is explicitly changed.

Allowed uses of JavaScript `Date`:

- Accepting or returning instants at API boundaries where existing libraries require `Date`.
- Serializing/deserializing `timestamptz` values.
- Tests that convert fixed instants into Temporal values.

Disallowed patterns:

- Parsing `YYYY-MM-DD` with `new Date("YYYY-MM-DD")`.
- Deriving local midnight by subtracting offsets manually.
- Using server timezone as user timezone.
- Calling `new Date()` inside resolvers.

## Resolver contract

Resolver functions must receive time context explicitly. `now is injected`; resolvers do not read the clock.

Example shape:

```ts
export type TimeContext = {
  now: Temporal.Instant;
  timezone: string;
};
```

Recurrence resolvers should produce:

```ts
{
  scheduledFor: Temporal.Instant;
  localDate: string; // ISO YYYY-MM-DD in the behavior timezone
}
```

Services may convert `Temporal.Instant` to database strings. Repositories should persist values; they should not decide recurrence.

## DST and edge cases

Agents must test these cases when implementing recurrence:

- Daily scheduled time around spring-forward and fall-back transitions.
- Weekly schedule across a DST boundary.
- Monthly day 31 fallback in February and April.
- Local midnight boundary for Needs decision.
- Behavior timezone different from the server timezone.
- User timezone changes should preserve past and resolved occurrence history while regenerating future unresolved rows through the occurrence generation service.

For nonexistent local times during spring-forward, prefer the next valid local time. For repeated local times during fall-back, prefer the earlier occurrence unless the product docs are updated with a different policy.

## Database and API formatting

- Store `timestamptz` as ISO strings from UTC instants.
- Store `local_date` as ISO calendar date string `YYYY-MM-DD`.
- Do not store locale-formatted dates.
- UI may format display dates with `Intl.DateTimeFormat`, using the explicit user timezone.

## Time helper

`packages/core/src/resolvers/time.resolver.ts` is the one place Cadence asks for
the time. New code uses it for "now", today's local date, local day bounds, local
wall-clock times and an Occurrence's effective time, instead of writing its own
conversion.

- **Now.** Core never reads the clock. Callers inject a `CadenceClock`:
  `systemClock` (`lib/services/clock.ts`) on the web, `fixedClock` in tests and
  replays. `currentInstant(clock)` returns the instant.
- **Today.** `todayIn(clock, timezone)` returns today's `local_date`. Pass the
  Behavior's timezone for rules about an Occurrence, and the profile timezone for
  rules about the person's day.
- **Local days.** `localDayBounds(localDate, timezone)` returns `[start, end)`
  from local midnight to the next local midnight. Never add 24 hours.
- **Wall-clock times.** `zonedInstant(localDate, wallTime, timezone)` applies the
  "compatible" rule in "DST and edge cases".
- **Effective time.** `effectiveStartAt(occurrence)` is the time an Occurrence
  actually sits at: its latest applied move for that day, otherwise its planned
  time. Until moves exist it returns `scheduled_for`.

`scheduled_for` keeps meaning the planned time. It is part of the Occurrence's
identity, and the sync resolver rewrites it from the schedule.
`tests/scheduled-for-drift.test.ts` fails when a shipped source file mentions
`scheduled_for` more often than
`tests/fixtures/governance/scheduled-for-allowlist.json` allows. The allowlist
holds the readers that existed on 2026-11-16. Readers move to the helper over
time and their counts go down. Raise a count only when the code needs the planned
time on purpose, such as recurrence, sync identity or export, and give the reason
in the pull request.

## Moves

A move changes when one Occurrence happens on one day. It never changes the
Behavior's schedule, the Occurrence's `scheduled_for` or its identity. Each move is
its own append-only record. The advisor plan's "Data model for per-day moves"
holds the tables; this section holds the time and race rules. They apply to every
writer: the Daily Brief, the coach, chat, MCP clients and the person's own moves
from the Occurrence menu.

### Time rules

- **Same day, in the Behavior's timezone.** A move must keep the Occurrence on its
  own `local_date`, computed in the Behavior's timezone, which is the zone that
  defined `local_date`. Only the new start is checked. A late move may end after
  midnight.
- **Only today.** A move applies to an Occurrence whose `local_date` is today in
  the Behavior's timezone (`todayIn`). Past and future days are not moved.
- **Each move stores its timezone.** The record keeps the IANA timezone it was
  made in, next to its UTC instants, so history reads correctly after a later
  timezone change.
- **A profile timezone change supersedes today's moves.** The change regenerates
  future Unresolved Occurrences in the new zone (see "Product decisions"). Today's
  applied moves on Unresolved Occurrences stop counting toward effective time:
  the server appends a `supersede` record to each chain, so devices see the same
  result and changing back does not revive the move. Records stay as history, and
  a resolved Occurrence keeps the time it was moved to. The person or the Daily
  Brief can move again in the new zone.
- **No moves for range Behaviors in v1.** An Occurrence scheduled as a time range
  (for example Morning) is not moved. Behavior settings explain that a range means
  no move suggestions.
- **Daylight saving.** A new time is resolved with the "compatible" rule in "DST
  and edge cases": a time skipped by spring-forward moves to the next valid time,
  and a time repeated by fall-back takes the earlier instant. Durations are kept as
  elapsed time, so a move across a transition keeps its length.
- **Effective time.** Every reader asks `effectiveStartAt`. Reminders, the
  Timeline, leave reminders, travel, Hevy matching, day progress, analytics, MCP
  output and Mac sync follow the move. Export keeps the planned time and carries
  moves in its `app.cadence` extension.

### Where the rules live

- **Database.** `move_occurrence_for_day` and `revert_occurrence_move` are the only
  writers of `occurrence_moves` and of `effective_start_at` / `effective_end_at`.
  They check, in this order: the Occurrence exists, is Unresolved, is today, still
  has the revision the caller read, is not a range, the new start is on its day and
  not more than a minute in the past, and it is not already there. Undo also needs
  a latest move to undo. A failed check returns `outcome: refused` and a reason,
  never an error, and changes nothing. Each move gives the Occurrence a new
  revision. A Behavior timezone change clears effective time; the records stay.
- **Service.** `lib/services/occurrence-move.service.ts` is the one path every
  caller takes (web actions, MCP tools, the advisor). It picks the length a moved
  item keeps (`resolveMoveDuration`: the Behavior's duration, then the person's
  logged average of at least two sessions, then 30 minutes; a second move keeps
  the length it already has), checks the slot against the day's other Unresolved
  items at their effective times and, when the caller holds them, today's calendar
  events (`slot_taken`, `calendar_busy`), offers up to three free starts on a
  five-minute grid for a refusal (`moveAlternatives`), and resyncs the item's
  reminders. The server keeps no calendar copy, so MCP moves check only other
  Occurrences.
- **Scopes.** Outside MCP clients move with `cadence.occurrences.write`. Cadence's
  own agents hold `cadence.occurrences.move` (Daily Brief and chat); the coach
  stays read-only. The move scope is never on the consent screen.
- **Mac.** Account sync contract 6 carries `occurrence_move` records read-only. A
  Mac derives effective time with `effectiveTimeFromMoves`, and passes it to
  occurrence generation so schedule edits keep the move there too.

### Two devices at once

Different kinds of action never collide: a move, a status mark and a note are
separate records. The same action on the same Occurrence is decided on the server
by arrival. Each write carries the revision its device last saw and an
idempotency key. The first write to arrive wins. A later write with an out-of-date
revision is refused with the current state, and the device says what changed
("Gym was just moved to 10:00 on another device"). Offline writes replay with the
same check. These rules live on the server, so every client, including future
iPhone and Android apps, inherits them.

| Case | Rule |
|---|---|
| An Occurrence is Completed or Not Completed while a move is pending | The status wins. A resolved Occurrence is not moved, and any open proposal for it is withdrawn. |
| Undo of a move that a later move already replaced | Refused. Undo reverses only the latest move of that Occurrence's day. |
| The Behavior's schedule is edited after today's move | The move stays. The moved Occurrence is never deleted by the edit, and it stands in for the new schedule's item on its day, so no second copy appears (it keeps its row and its planned time for that day). If another item now sits where the moved one is, Cadence opens a move conflict notice; "keep it here" answers it for good, and moving again or Undo answers it too. |
| The same write arrives twice with the same idempotency key | The second returns the first result and applies nothing. |
| Two moves of the same Occurrence with the same expected revision | The first to arrive wins. The second is refused with the current state. |

### Brief moves

The Daily Brief proposes moves as lines and applies one when the person answers Yes
(advisor Phase 3). These rules sit on top of "Moves"; the code is
`packages/core/src/resolvers/brief-move.resolver.ts` and
`lib/services/brief-moves.service.ts`.

- **One free-slot rule.** Brief lines, Yes, Accept all, Other time, Re-plan and the
  Timeline's "Move for today" all ask the same resolver whether a time is free, so a
  time the brief offers is not refused at Yes on the same data.
- **Every item has a length.** The Behavior's duration, then the logged average,
  then a cached model estimate, then 30 minutes. The estimate is stored per Behavior
  and asked again only when its title, description or kind of place changes. A Yes applies
  the length the line showed. A correction from the person becomes the Behavior's
  default length.
- **Gaps.** Items and calendar events keep 10 minutes on each side. An exact-time
  item blocks its own length. A range item blocks its own length at the earliest
  free point in its range. An item done alongside others (a pill, a device) blocks
  nothing. Travel spans already carry their margins.
- **Calendar and travel on each request.** The device sends today's busy calendar
  events with each brief and answer request (at most 200). Travel times come as a
  signed token from the device's last travel check; the server verifies it, uses it
  for that request and stores nothing. Calendar events and travel are fixed: the
  brief moves Cadence items around them, never the reverse.
- **Route lookups.** Planning makes no route lookups of its own. After a Yes the
  moved item changes the Timeline, so the normal travel route refresh on web and
  Mac runs, about two legs per moved item that has a place. That refresh recomputes
  leave-by lines from the new effective time.
- **Revisions.** Each answer carries the revision the screen read. A changed
  Occurrence or Behavior returns `revision_changed`, and the client reloads.
- **Expiry.** A proposal stays open until its day ends or its item resolves. A change
  to the Timeline no longer withdraws it; Yes is checked against the current day.
- **Calendar text for one day.** A line may name the calendar event it avoids. When
  the day ends, the server replaces that title with a generic reason.

## Tests are source-of-truth evidence

The following tests are required before recurrence/timeline/status work is complete:

- `tests/recurrence.resolver.test.ts`: generation ranges, intervals, weekdays, monthly fallback, DST behavior.
- `tests/timeline.resolver.test.ts`: local-date grouping and Needs decision boundary.
- `tests/status.resolver.test.ts`: status transition timestamps and no automatic missed state.

Run `npm run resolvers:check` after adding any date/time resolver.

## Day-progress and external-event contracts (Tickets 132–136)

The synthetic layout contract derives day start and next-day start through
Temporal in the explicit Timeline timezone. A day can span 23 or 25 hours.
Never divide elapsed time by a hardcoded 24-hour duration. Timed event spans,
item anchors, and the current-time dot share a monotonic piecewise mapping.
Measured row geometry can change spacing without changing any actual instant.
Equal-time rows share a temporal anchor while retaining readable vertical spacing.

Timed external events use half-open instant intervals. Overnight events retain
one identity and clip to each intersected local day for display. All-day events
use a start date and exclusive end date, never invented midnight durations.
All-day events do not participate in timed-overlap warnings.

The external snapshot request uses an inclusive displayed local-date range.
The provider adapter converts its inclusive end date to the next local midnight
in the requested IANA timezone. That boundary can cross a daylight-saving
transition. Do not add 24 hours to derive it. The normalized all-day event end
remains exclusive even though the snapshot request end remains inclusive.

A timed event with an unspecified provider end retains its compatibility
`endAt` for clipping, but exposes unknown duration. It cannot establish a free
interval. Recurrence instance identity uses the provider's original start fact.
Cancellation tombstones retain that identity so an atomic cache replacement can
remove the correct instance. Provider revision, busy/free, and current-user
response remain source facts. They do not authorize schedule or status changes.

The estimate window is the preceding ninety complete local days:
`[today - 90 days, today)`. Today is excluded. Three distinct Completed
Occurrences with positive stopped totals establish a sample. Any running
session excludes its Occurrence. Estimates remain a separate contract from
the existing analytics range and averages. The implementation lives in
`packages/core/src/resolvers/timeline-context.resolver.ts`. It never changes
recorded timing, a Behavior schedule, or an Occurrence status.

## Ticket 088 sync freshness

Web Behavior creation reads the current profile timezone from the repository,
bypassing the read cache and ignoring submitted timezone values. The form sends
no hidden timezone. Existing state-version and configuration-event comparisons
guard sync completion; a concurrent edit leaves the account stale for retry.
Freshness summaries derive timezone from the actual generation windows. Mixed
windows retain the existing `multiple` marker and cannot claim one profile zone.

## Historical completion marking times

`completion-timing.resolver.ts` summarizes existing `status_marked_at` values for
currently Completed Occurrences. It never substitutes `updated_at`, scheduled time,
status-event backfill time, or an actual-finish estimate. The current-status snapshot
already represents corrections: Unresolved/Not Completed removes a sample;
re-completion supplies the new mark; repeated Completed taps retain the original.
Deduplicate by Occurrence ID, never count each status-history event as a sample.

Use the current account timezone for every instant, including DST conversion.
Both the historical Occurrence date and the mark's local date must lie in
`[today - historyDays, today)`. Delayed marks within that window remain eligible;
count marks recorded on later local dates separately. Today is excluded and today's
Occurrence need not be completed. Existing duration rules remain independent.

Require three distinct Occurrences across three marking dates. Sort local clock
minutes, cut at the largest circular gap, and calculate the median on that
unwrapped arc. A span above 180 minutes does not support a single typical time.
Thus 23:50, 00:05 and 00:10 cluster around midnight rather than noon. Quantize to
minutes. Report counts, delayed-mark count, range, and exclusions. Insufficient,
dispersed, capped or unavailable evidence has no typical time. Missing, invalid,
future, out-of-window, non-Completed and duplicate records never become samples.

## Development historical briefing evaluation (Ticket 182)

A selected local day and explicit IANA timezone define the evaluation clock. The
workbench defaults to 07:00; this does not change the product day boundary or enable
scheduled generation. Temporal resolves skipped times forward and repeated times
to the earlier instant. The target interval is `[local midnight, next midnight)`;
each lookback is `[target date - selected history days, target date)`. A 90-day
target range plus a 90-day lookback can span 180 calendar days.

Captured means actual retained context at its recorded capture clock. Synthetic
means authored fixtures. Retrospective means current retained state for an earlier
date, including later corrections. Reconstructed is reserved and never emitted by
the present adapter. Missing rows do not establish Unresolved or a quiet day.

A future Reconstructed implementation must prove effective time, recorded time,
and ingestion time strictly before the selected clock for both target and lookback.
Inclusive local-date selection does not make the instant cutoff inclusive. Records
at the clock belong after it. Stable ordering must use `(effective_at, recorded_at,
ingested_at, id)` and validate every revision link within the same owner/entity.
A later correction cannot change an earlier snapshot. Missing links, ambiguous
imports, backfilled recorded times without ingestion provenance, or deletion gaps
must prevent a reconstruction claim for the affected source. Current projections
lack enough provenance to satisfy this contract, so filtering recorded timestamps
alone is explicitly insufficient.

Retrospective rows sort by local date, scheduled instant and ID. Current titles,
configured defaults and retained schedule snapshots are labeled current evidence.
Past Note text, elapsed totals, original timezone and reminder status stay unknown
when history cannot establish them. Optional past Calendar retrieval is a current
read, not a retained history capture or permission for Calendar-pattern analysis.
Live time gates authentication, permissions, provider tokens and cancellation;
only planning and evaluation freshness use the saved clock. Production checks stay live.
