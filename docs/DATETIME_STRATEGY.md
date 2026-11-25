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
  item keeps (the logged figure once it rests on 3 finished sessions, then the
  Behavior's intended duration, then the logged figure from fewer sessions, then
  30 minutes; the logged figure is the median of the 10 most recent finished
  sessions, Ticket 366; a second move keeps
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
| The Behavior's schedule is edited after today's move | The move stays. The moved Occurrence is never deleted by the edit, and it stands in for the new schedule's item on its day, so no second copy appears (it keeps its row and its planned time for that day). The same holds for any item the edit keeps: one already marked, already started, or holding a note or timed session. If another item now sits where the moved one is, Cadence opens a move conflict notice; "keep it here" answers it for good, and moving again or Undo answers it too. |
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
- **Every item has a length.** The logged figure once it rests on 3 finished
  sessions, then the Behavior's intended duration, then the logged figure from fewer
  sessions, then a cached model estimate, then 30 minutes (Ticket 366). The stored
  source name `logged_average` is unchanged; the figure is a median. The estimate is stored per Behavior
  and asked again only when its title, description or kind of place changes. A Yes applies
  the length the line showed. A correction from the person becomes the Behavior's
  default length.
- **Gaps.** Items and calendar events keep 10 minutes on each side. An exact-time
  item blocks its own length. A range item blocks its own length at the earliest
  free point in its range. Whether an item is alongside (a pill, a device) comes from
  `alongside.resolver.ts` (Ticket 356): the person's setting (behind `CADENCE_ALONGSIDE`),
  then the cached model guess, then false. Travel spans already carry their margins.
- **Same-place overlap (Ticket 357, D33).** With `CADENCE_ALONGSIDE` on, an alongside
  item blocks only what `alongsideMayOverlap` refuses. It may share time with a Cadence
  item or a calendar event at the same place, or where either place is unknown or
  Anywhere. It may not share time with travel or with an item somewhere else; there it
  blocks like any other item, with the 10-minute gaps. Each item's place is its effective
  Where (`effective-where.resolver.ts`): the person's Where, else counted completion place
  labels, else the cached model guess, else unknown. Calendar events carry no place on
  the free-slot inputs, so their place is unknown. The brief's move lines never move an
  alongside item; when one at another place collides with an item, that item moves. Only a
  pairing line (below) moves an alongside item. A
  moved alongside item (the Timeline's "Move for today") is checked the same way, and
  calendar events do not block it. With the flag off, an alongside item blocks nothing
  and a moved one is blocked like any other item, as before. The effective Where is for
  planning only: routes, departure lines and leave reminders read `where_kind` alone.
  Since Ticket 359 the same rule covers the Daily Brief consumer's overlap and tight-fit
  findings with places from the day context's `planning` field, where the person's
  alongside answer outranks the run's own estimate, and an exact-time opportunity add
  (Chat and MCP), which checks the added Behavior's own side. Chat's moves already used it.
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
- **Re-check on open.** Each time the brief opens, `POST /api/advisor/brief/recheck`
  checks every undecided line against the current day with the same slot check Yes
  uses. A line whose time is taken or has passed is re-planned by the one rule, with a
  reason that names the cause ("5:30 PM is taken now, so 6:30 PM instead."). It makes
  no model call and does not count against the Re-plan limit. When nothing else fits
  today the line closes as `withdrawn`. Lines that still fit are left alone, so a
  second call writes nothing. A re-planned reason names an item, never a calendar title.
- **Open lines hold their times.** Re-plan and Re-check treat the time each other
  undecided line offers as taken, as the planner does, so two lines never offer the same
  time ("5:30 PM is suggested for Piano practice, so 6:00 PM instead.").
- **Named refusals.** A refused Yes or Other time names what is in the slot now and
  whether it changed after the brief ("5:30 PM is taken now: you moved Piano practice
  there after this brief was written."), with the same cause as `refusal.cause`. A line
  refused because an earlier line of the same Accept all moved there says so, with
  `changedAfterBrief: false` ("5:30 PM is taken: Accept all just moved Piano practice there.").
- **Where it went.** While a Yes, Other time or Accept all move stands, the line carries
  `appliedTo` (the move's start and end, UTC). Undo clears it.
- **Saved brief.** Reopening a saved brief shows only its own run's lines. After a
  Refresh, the earlier brief's lines (answered or not) are not shown again.
- **Calendar text for one day.** A line may name the calendar event it avoids. When
  the day ends, the server replaces that title with a generic reason.
- **Pairing (Ticket 361, D33).** With `CADENCE_ALONGSIDE` on, the brief may also offer
  to do an alongside item during another of today's items, its host ("Do Red light
  helmet during Reading at 8:00 PM."). The planner is
  `packages/core/src/resolvers/alongside-pairing.resolver.ts`; the model only writes the
  sentence, and the notice `brief-moves.pairing` is the stock text.
  - Guest: an Unresolved, exact-time alongside item today with a known or guessed Where.
    Host: an Unresolved, exact-time Cadence item today that is not alongside, at least as
    long as the guest, starting now or later and by the latest start hour, with a known or
    guessed Where that `alongsideMayOverlap` allows. Calendar events never host. A step that
    follows its routine's time is neither on its own; a routine slot of two or more steps
    may host as one item and is never a guest.
  - Only when it helps: the guest's local hour holds 3 or more items (the coach's
    `crowded_hour` threshold, alongside items not counted) or the coach's stored
    `crowded_hour` signal names that hour; the guest runs into travel or an item somewhere
    else; or the coach's `done_together` signal names the guest with one of today's hosts.
    A guest already inside a compatible host's time is left alone.
  - The host the `done_together` signal names comes first, then the nearest host. At most
    one pairing per guest and per host. The new time is the host's start for the guest's
    length, and it passes the same slot check Yes runs on the guest's side of the
    same-place rule, so a pairing is not refused at Yes on the same data.
  - Pairing lines come after the move lines, count toward `BRIEF_MOVE_MAX_LINES`, hold the
    times the move lines offer, skip items a move line moves, and are not offered on a stale
    calendar. No, Undo and "Don't suggest moving this" on the guest stop them as for any line.
  - Yes · No · Other time behave as on every line: Yes is an ordinary move of the guest with
    source `daily_brief` and reason `alongside_pairing`. Re-check on open keeps a line
    whose time still fits and whose host is still Unresolved at the same start; otherwise
    the planner pairs the guest again (the same host at its new time, or another host) with
    the stock sentence, or the line closes as `withdrawn`. Re-plan pairs the guest with
    another host, or offers nothing.
  - No link between guest and host is stored. The proposal's `line.pairing` records which
    host was offered, as history only. A later move of the host does not move the guest.
  - Chat: the `plan_alongside_pairings` tool (flag on only) runs the same planner on today
    with today's calendar; Chat offers what it returns and, after the person's yes, applies
    that move with `move_occurrence_for_day` (source `chat`). When the person asks about one
    item, the "helps" rule is skipped for it.
  - The coach's signals are read through the coach agent's read-only channel
    (`coach_read_signals`), today's or else yesterday's, ids and hours only. Without them
    only a crowded hour or a conflict makes a pairing help.

### Brief opportunity lines

Behaviors of Opportunity (Task 7). The Daily Brief can offer to add an opportunity
Behavior to today ("Add for today"), for clients that send `opportunity_lines_v1`.
The code is `packages/core/src/resolvers/brief-opportunity.resolver.ts` and
`lib/services/brief-opportunities.service.ts`.

- **Same free-slot rule.** Lines, Yes, Other time, Re-plan and Re-check use the move
  lines' rule. Today's open items, calendar events and travel spans block a time. A
  move line of the same brief blocks the time it offers.
- **Stale calendar.** When a connected calendar is stale, no line is offered.
- **Cap.** At most 2 opportunity lines, and at most 8 brief lines with the move lines.
- **Order.** Behaviors not on Today come first. Of these, "anywhere" and "home" come
  before "place", then never Completed, then longest since Completed. A Behavior on
  Today is offered only when nothing else fits.
- **Where.** A home item is not offered between the day's first and last travel span,
  because the person is away. A place item says "travel not checked".
- **Yes and Other time.** The person's own session adds an Unresolved Occurrence with
  `added_by = daily_brief`, after the slot check passes. Cadence never marks it
  Completed. The added Occurrence id is stored on the proposal.
- **Undo.** Removes the added Occurrence through `remove_opportunity_occurrence`. A
  marked, noted or timed item is kept, and the line says why. Undo counts as a No.
- **No and "Don't suggest adding this".** No closes the Behavior's lines for the rest
  of the day. After 4 declines on different days, the line offers "Don't suggest
  adding this", stored per Behavior.
- **Re-check on open.** The same `recheck` route re-plans an undecided line whose time
  is taken or has passed, with no model call. When nothing fits, the line closes as
  `withdrawn`.
- **Retention.** Proposals and their answers are deleted 30 days after their day. The
  lines hold no calendar text.

### Base schedule proposals

Advisor Phase 4C (`packages/core/src/services/behavior-change-proposal.ts`).

- **A Yes applies today when it can** (Tips with one-tap changes, Nov 20). A schedule edit
  applies at once and regenerates today's unresolved future items, so today's item moves
  to the new time when it is still ahead, unmarked, not moved by hand and holds no note or
  timed session. Otherwise today's item stays and stands in for the new time, so the day
  never shows a second copy, and the outcome names tomorrow (or the next touched weekday)
  as the first day. Undo after Change for good restores the same way.
- **Trial dates are calendar dates.** The check-in day is fourteen calendar days after the
  local day of Try, moved forward past any weekday the change touches. "Today" is the
  profile timezone's local date at the moment of reading, so a clock change or a move to
  another timezone asks on the right local day. Seven calendar days without an answer keep
  the change.
- **Patterns use set times.** "Moved the same way" compares the planned local time with the
  local time it was moved to, on the same local day, never the stored completion time.

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
