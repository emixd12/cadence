# Rules register

This file lists the rules Cadence uses to decide things from a person's data: floors,
windows, orders and thresholds. Each row says what the rule is, its current value, where
the value lives in code, who decided it, and what to look at in real use to judge it.

Why it exists: the owner asked for one place to review these rules and compare them with
how people actually use Cadence, so a value can be changed later with a reason
(`docs/DECISIONS.md`, 2026-11-25, D34).

How to use it:

- Code is the source of the value. This file is the index. When you add or change a rule
  of this kind, update its row in the same change.
- Change a value only through its named constant. Do not repeat the number at a call site.
- "What to look at" names counts that exist in a person's own records (the export or the
  database, as that person). Cadence collects no usage analytics, so a review reads the
  owner's or a test account's records. No row here authorizes new tracking.
- A rule the owner decided cites its decision. A rule with no decision is an
  implementation default and says so.

Coverage: the length rules from Ticket 366 and the rules beside them, the Daily Brief's
day-note rules from Ticket 367, the Period rules from Tickets 368 to 371, the Daily Brief
analysis thresholds, coach signals, schedule-change proposals, the free-time rule for a
move, travel timing and leave reminders, and connector completion matching. The sets in
"Not yet listed" still live only in code.

## Behavior length

How long a Behavior takes, for the Timeline, day load, travel timing, moves and the Daily
Brief. One measurement and one order serve every caller:
`resolveBehaviorDurationEstimate` in
`packages/core/src/resolvers/timeline-context.resolver.ts`, read by services through
`lib/services/behavior-length.service.ts`.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| LEN-01 | A tracked sample is one Completed Occurrence before today, with its time sessions added together | fixed | `resolveBehaviorDurationSources` | D34, owner, 2026-11-25 | Occurrences with more than one session; Completed Occurrences with no session |
| LEN-02 | Tracked completions needed before the tracked figure outranks the intended duration | 3 | `TRACKED_DURATION_WINS_MIN_SAMPLES`, `time-tracking.resolver.ts` | D34 | How far the figure moves between the 3rd and the 10th sample of one Behavior |
| LEN-03 | Samples the tracked figure uses | the 10 most recent | `TRACKED_DURATION_RECENT_SAMPLES` | D34 | Behaviors whose length changed over time: does the figure follow within 10 completions |
| LEN-04 | The tracked figure | median | `recentMedianSeconds` | D34 | Samples far from the median (a timer left running); how often the mean and the median differ by 5 minutes or more |
| LEN-05 | Tracked completions needed to show a tracked figure at all | 1 | `DURATION_ESTIMATE_MIN_SAMPLES`, `timeline-context.resolver.ts` | Implementation default; kept by the owner, 2026-11-25 | First samples that differ from the later median by half or more |
| LEN-06 | Length order | tracked (3+), intended duration, tracked (1–2), description estimate, 30 minutes for a move | `selectBehaviorDuration`, `briefMoveLengthFromEstimate` | D34 | Items where the intended duration and the tracked figure differ by 20% or more |
| LEN-07 | History the Timeline and moves read | all time | `readDurationHistory` | Implementation default | Behaviors with no tracked completion in 90 days |
| LEN-08 | History the Daily Brief reads | 90 days | `lookbackDays: 90`, `lib/services/advisor-day-context.service.ts` | Implementation default | Whether LEN-07 and LEN-08 give different figures for one Behavior |
| LEN-09 | Length of a move when nothing is known | 30 minutes | `BRIEF_MOVE_FALLBACK_MINUTES`, `DEFAULT_MOVE_SECONDS` | Advisor plan, Phase 2A | How often a 30-minute assumption is corrected with "set length" |

## Daily Brief day notes

The day notes the hosted Daily Brief's opening reads with the AI Notes source on
(Ticket 367). `BRIEF_DAY_NOTE_LIMITS` in `packages/core/src/resolvers/day-note.resolver.ts`
holds every value.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| NOTE-01 | Days of day notes the brief reads | today and the 2 local days before it | `BRIEF_DAY_NOTE_LIMITS.days`, `briefDayNoteRange` | D35 chose that the brief reads day notes; the 3 days are an implementation default | Day notes older than 2 days that still describe today (an illness, a trip) |
| NOTE-02 | Characters of each day note sent | the first 280 | `BRIEF_DAY_NOTE_LIMITS.characters`, `resolveBriefDayNotes` | Implementation default | Day notes longer than 280 characters; whether what matters comes after the cut |
| NOTE-03 | A sentence repeats a day note, and Cadence's own words replace it | the whole note when it has 3 or more words, or 6 words in a row | `wholeNoteWords`, `sharedWords`, `textQuotesDayNote` | Plan review, 2026-11-25 (`docs/plans/2026-11-25-periods.md`, section 14, row 6) | Runs whose fallbacks hold `opening_day_note` or `reason_day_note`; short notes made of everyday words |

## Length tip

The coach tip that offers to update a Behavior's intended duration
(`set-the-length-it-takes` in `packages/core/src/data/advice-library.json`).

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| TIP-01 | Window the tip reads | 28 days | `windowDays`, `coach-signals-v2.resolver.ts` | Advisor plan, Phase 4 | Tips shown against tips accepted |
| TIP-02 | Tracked completions needed in the window | 4 | `sessionLength.minSessions` | Advisor plan, Phase 4 | Whether 4 here should equal LEN-02 |
| TIP-03 | "Longer" and "shorter" than intended | above 1.2 times, below 0.8 times | `sessionLength.longerAbove`, `shorterBelow` | Advisor plan, Phase 4 | Accepted and refused tips by ratio |
| TIP-04 | Sessions left out as too long | over 12 hours | `sessionLength.maxSessionMinutes` | Advisor plan, Phase 4 | Sessions over 3 hours on short Behaviors |
| TIP-05 | The offered duration | tracked median rounded to 5 minutes, from 5 to 720 | `roundLengthToMinutes`, `minLengthMinutes`, `maxLengthMinutes`, `behavior-change-proposal.ts` | Advisor plan, Phase 4 | Offers that differ from the LEN-04 figure |

Known difference: the tip takes its median over a 28-day window and LEN-03 takes the 10
most recent completions. The two figures can differ for one Behavior.

## Periods

Labeled date ranges the person declares for the account (Ticket 368). Values live in
`PERIOD_LIMITS` and the "End today" rule in
`packages/core/src/resolvers/period.resolver.ts`; the hosted database repeats the cap and
the lengths (`docs/DATA_MODEL.md`, "Periods").

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| PER-01 | Periods one account can hold, for every writer | 500 | `PERIOD_LIMITS.perAccount`; trigger `periods_enforce_account_cap` in `supabase/migrations/20261126130000_periods.sql` | Periods plan (D35), section 1 | The Period count per account; whether anyone comes near 500 |
| PER-02 | Label length | 1 to 60 characters, one line | `PERIOD_LIMITS.labelCharacters`, `normalizePeriodLabel`; check `periods_label_valid` | Periods plan (D35), section 1 | Labels at or near 60 characters |
| PER-03 | Note length | 2,000 characters, as for a day note | `PERIOD_LIMITS.noteCharacters`, `normalizePeriodNote`; check `periods_note_valid` | Periods plan (D35), section 1 | Notes at or near the limit |
| PER-04 | "End today" applies | first day today or earlier, and ongoing or last day after today | `resolvePeriodEndState` | Periods plan (D35), section 1 | Periods whose last day was later edited by hand to an earlier date |
| PER-05 | Longest Period query range | 366 days | `PERIOD_LIMITS.rangeDays`, `resolvePeriodRange`; MCP `list_periods` through `INTEGRATION_LIMITS.maxPeriodRangeDays` | Periods plan (D35), section 1 | `list_periods` calls refused with `limit_exceeded` |
| PER-12 | Period summaries in one embedded MCP list | the first 20 in display order for `active_periods` and `period_split.periods`, the first 10 on a `get_timeline` day, with a flag when more exist | `INTEGRATION_LIMITS.maxEmbeddedPeriods`, `INTEGRATION_LIMITS.maxTimelineDayPeriods`, `embeddedPeriods` in `lib/services/integration-read.service.ts` | Periods plan (D35), section 5; an implementation default | Accounts where more than 20 Periods cover one day |
| PER-13 | Periods on one `list_periods` page | 40, earliest first, and fewer when the page would pass 90,000 bytes | `INTEGRATION_LIMITS.maxPeriodsPerPage`, `PERIOD_PAGE_BYTES`, `periodPageSize` | Periods plan (D35), section 5; the byte limit is an implementation default (Ticket 370) | Pages shorter than 40; how many pages a client reads |
| PER-14 | Days counted as inside a Period in `period_split` | every local date at least one Period covers, each date once | `periodCoveredDates`, `splitByPeriods`; `getIntegrationAdherenceSummary` | Periods plan (D35), section 5 | Ranges where most days fall inside a Period |

### Periods the Daily Brief and advisor tips read

Labels and dates only; a Period's note is never sent (Ticket 371). Values live in
`BRIEF_PERIOD_LIMITS` and `TIP_PERIOD_LIMITS` in
`packages/core/src/resolvers/period.resolver.ts`.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| PER-06 | Periods covering today that the brief reads | the first 5 in display order (`comparePeriods`) | `BRIEF_PERIOD_LIMITS.active`, `resolveBriefPeriods` | D35 chose that the brief reads Periods; Periods plan, section 7, set 5 | Accounts with more than 5 Periods covering one day; whether the earliest-started are the ones that matter |
| PER-07 | How long after its last day a Period still reaches the brief | 7 local days before today | `BRIEF_PERIOD_LIMITS.recentDays`, `briefPeriodRange` | Periods plan (D35), section 7 | Briefs that name a Period that ended 5 to 7 days ago; whether that still describes the day |
| PER-08 | Recently ended Periods the brief reads | the 3 most recently ended | `BRIEF_PERIOD_LIMITS.recent`, `resolveBriefPeriods` | Periods plan (D35), section 7 | Accounts with more than 3 Periods ending inside one week |
| PER-09 | Days of Periods the tips prompt reads | today and the 7 local days before it | `TIP_PERIOD_LIMITS.days`, `tipPeriodRange` | Implementation default; matches the 7 days of day notes the tips read | Tips about a slip that a Period older than 7 days explains |
| PER-10 | Periods the tips prompt reads | the first 5 in display order | `TIP_PERIOD_LIMITS.periods`, `resolveTipPeriods` | Periods plan (D35), section 7 | Accounts with more than 5 Periods in one week |
| PER-11 | Words a brief sentence may share with a day note because a Period label holds them | words that stand together inside one label the brief was shown | `textQuotesDayNote` (`allowed`), `validateBriefOpening` | Periods plan (D35), section 7: the verbatim check does not apply to labels | Runs with `opening_day_note` or `reason_day_note` on a day that also has a Period |

## Daily Brief analysis

The analysis lanes that decide whether a pattern has enough records behind it to become a
finding (Tickets 169, 171 and 172). Every value lives in `BRIEFING_ANALYSIS_THRESHOLDS` in
`packages/core/src/resolvers/briefing-analysis.resolver.ts`. A rate counts marks only:
Completed against Completed plus Not Completed.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| ANA-01 | A weekday is lower than a Behavior's other days | 4 resolved on 4 different weeks; 8 resolved on the other days; Unresolved at most 50%; gap of 30 points | `weekday` | Tickets 169–172; an implementation default | Behaviors with one weak weekday that has under 4 resolved |
| ANA-02 | A schedule slot is lower than the other slots | 6 resolved on each side; Unresolved at most 50%; gap of 30 points | `slot` | Tickets 169–172; an implementation default | Behaviors with two slots a day and fewer than 6 resolved in one |
| ANA-03 | Marks come well before or after the set time | 5 same-day Completed marks on 5 dates; median offset of 90 minutes; 70% of marks offset 45 minutes the same way | `timing` | Tickets 169–172; an implementation default | Behaviors marked in one evening batch: the mark time is not the time done |
| ANA-04 | Heavy days have lower rates | 28 days since the last schedule change; heavy is the median load plus 2; 2 weekdays with 2 days and 3 resolved on each side; 12 heavy-day resolved; weighted gap of 20 points; same direction in two thirds of weekdays | `load` | Tickets 169–172; an implementation default | How many days in 90 count as heavy; accounts whose schedule changes more often than every 28 days |
| ANA-05 | Unresolved Occurrences pile up on a Behavior | 5 prior-day Unresolved, and 30% of its past Occurrences | `decisionDebt` | Tickets 169–172; an implementation default | Needs decision counts per Behavior |
| ANA-06 | Decisions are recorded late or in batches | 10 decisions; 40% recorded on a later day; a batch is 3 decisions within 10 minutes | `chronology` | Tickets 169–172; an implementation default | Share of status events recorded after the Occurrence's day |
| ANA-07 | Statuses are often corrected | 4 corrected, and 15% of decisions | `corrections` | Tickets 169–172; an implementation default | Occurrences with more than one status event |
| ANA-08 | Reminders go with a different rate | 8 resolved and 10 Occurrences in each group; gap of 20 points | `reminders` | Tickets 169–172; an implementation default | Behaviors with reminders on for part of the range |
| ANA-09 | Notes are enough to read | 3 notes on 2 dates; at most 12 sent as evidence | `notes` | Tickets 169–172; an implementation default | Notes per Behavior in 90 days |
| ANA-10 | Evidence references on one finding | at most 20 | `maxEvidenceRefs` | Tickets 169–172; an implementation default | Findings that reach 20 |
| ANA-11 | Days each lane reads | 14 or 28 at least, 90 at most, per lane | `lookback` in `BRIEFING_ANALYSIS_LANES` | Tickets 169–172; an implementation default | Accounts with under 28 days of records |

## Coach signals

Patterns the nightly coach visit counts with no model call. Version 1 values live in
`COACH_SIGNAL_THRESHOLDS` in `packages/core/src/resolvers/coach-signals.resolver.ts`;
version 2 values live in `COACH_SIGNAL_V2_THRESHOLDS` in `coach-signals-v2.resolver.ts`.
Every counting period ends yesterday. The session-length values are rows TIP-01 to TIP-04.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| SIG-01 | Days of Occurrences the visit reads | 56 | `historyDays` | Advisor plan, Phases 3D and 4 | Accounts with under 56 days of records |
| SIG-02 | Completion dropped | last 14 days against the 28 before; 5 and 8 resolved; drop of 25 points | `completionDrop` | Advisor plan, Phase 3D | Drops that a Period or a trip explains |
| SIG-03 | The same move repeats | 28 days; 3 days the same way, and two thirds of moves; per weekday, 4 of the last 5 matching weekdays in 35 days | `repeatedMove`, `repeatedMoveWeekday` | Advisor plan, Phases 3D and 4C | Moves per Behavior in 28 days; whether PROP-01 fires on the same Behaviors |
| SIG-04 | Marks are recorded late | 14 days; one Behavior: 5 decisions, half late; the account: 10 decisions, 40% late | `lateMarking` | Advisor plan, Phase 3D | Whether this and ANA-06 agree for one account |
| SIG-05 | A Behavior is new | settled after 14 days; reported for 7 | `newBehavior` | Advisor plan, Phase 3D | Rates in a Behavior's first 14 days against its next 14 |
| SIG-06 | Window for Daily Brief answers, decisions, reminders and timed sessions | 28 days each | `briefAnswers.windowDays`, `reminderDecisionDays`, `V.windowDays` | Advisor plan, Phases 3D and 4 | Whether 28 days holds enough records for weekly Behaviors |
| SIG-07 | This week against earlier weeks | 4 prior weeks; 3 resolved this week; 8 before | `weeklyNumbers` | Advisor plan, Phase 4 | Weeks with under 3 resolved |
| SIG-08 | A weekday gap | one Behavior: 4 and 8 resolved, gap of 30 points; the account: 6 and 20 resolved, gap of 25 points | `weekdayGap` | Advisor plan, Phase 4 | Whether this and ANA-01 name the same weekday |
| SIG-09 | A time-of-day or timing-mode gap | time of day: 6 resolved on each side, gap of 30 points; exact against range: 6 resolved, gap of 25 points | `timeOfDayGap`, `timingModeGap` | Advisor plan, Phase 4 | Behaviors scheduled in only one part of the day |
| SIG-10 | Steady, and never done | steady: 8 resolved at 90% or more; never done: 5 resolved at 10% or less | `steady`, `neverDone` | Advisor plan, Phase 4 | Behaviors between 10% and 90% that never get a tip |
| SIG-11 | A dip and a recovery | 8 weeks; 3 resolved a week; 4 usual weeks; drop of 40 points; recovered within 15 points | `dipRecovery` | Advisor plan, Phase 4 | Weeks the signal calls a dip against Periods on those weeks |
| SIG-12 | Misses cluster on bad days | 10 marked days; 6 misses; a bad day holds 20% of them; clustered at 60%, spread at 35% | `dayShape` | Advisor plan, Phase 4 | Days with 3 or more Not Completed |
| SIG-13 | Unmarked items | 5 unmarked; the oldest 3 days old | `unmarked` | Advisor plan, Phase 4 | Whether this and ANA-05 agree |
| SIG-14 | When marks are made | the account: 10 decisions; one Behavior: 6; on 5 dates | `markingTime` | Advisor plan, Phase 4 | Hours of status events |
| SIG-15 | Two Behaviors are done together | 8 shared days; together 85% of them; 2 missed days; "only with": 10% at most without, 60% at least with, 3 missed days | `doneTogether` | Advisor plan, Phase 4 | Pairs that share a schedule and so always match |
| SIG-16 | An hour is crowded | 3 items a day in the hour; 6 and 10 resolved; gap of 15 points | `crowdedHour` | Advisor plan, Phase 4; alongside items left out by D33 | Hours with 3 or more items |
| SIG-17 | Reminder response | quick is within 30 minutes; one Behavior: 6 marked; the account: 10 | `reminderResponse` | Advisor plan, Phase 4 | Minutes from reminder to mark |
| SIG-18 | Moved against unmoved | one Behavior: 5 of each; the account: 8 of each; gap of 15 points | `movedVsUnmoved` | Advisor plan, Phase 4 | Rates for moved Occurrences |
| SIG-19 | An Opportunity is ready | 3 completions; within 60 minutes | `opportunityReady` | Advisor plan, Phase 4 | Completions of Opportunity Behaviors by time of day |
| SIG-20 | One step of a routine is done less | 6 resolved; siblings 8 resolved at 70% or more; gap of 30 points | `subBehaviorDropoff` | Coach signals version 3; an implementation default | Routines whose steps differ by 30 points |

## Schedule-change proposals

When the advisor offers to change a Behavior's schedule ("Try for two weeks"). Every value
lives in `BEHAVIOR_CHANGE_RULES` in `packages/core/src/services/behavior-change-proposal.ts`.
The offered length is row TIP-05.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| PROP-01 | Moves that qualify | 3 the same way from the same set time, in 28 days | `windowDays`, `minSameDirectionMoves` | Advisor plan, Phase 4C | Proposals shown against proposals accepted |
| PROP-02 | Moves count as the same way | targets within 60 minutes of the median | `maxTargetSpreadMinutes` | Advisor plan, Phase 4C | Spread of move targets for one Behavior |
| PROP-03 | Smallest shift worth proposing | 30 minutes | `minShiftMinutes` | Advisor plan, Phase 4C | Repeated moves of under 30 minutes |
| PROP-04 | The proposed time | the median target rounded to 15 minutes | `roundToMinutes` | Advisor plan, Phase 4C | Accepted proposals the person later edits by hand |
| PROP-05 | After a No, the same Behavior and direction is not asked again | for 30 days | `declineCooldownDays` | Advisor plan, Phase 4C | Proposals refused twice |
| PROP-06 | An unanswered proposal closes | after 7 days | `proposalOpenDays` | Advisor plan, Phase 4C | Proposals that closed with no answer |
| PROP-07 | The trial, and its check-in | 14 days; no answer within 7 days keeps the change | `trialDays`, `checkInAnswerDays` | Advisor plan, Phase 4C | Check-ins answered; rate during the trial against the 14 days before |
| PROP-08 | Limits on one proposal | 6 schedules; a reason of 200 characters | `maxSchedules`, `maxReasonLength` | Implementation default | Behaviors with more than 6 schedules |

## Free time for a move

The one rule that decides whether a time is free, for Daily Brief lines, Other time,
Re-plan, Yes, Accept all and "Move for today". Constants live in
`packages/core/src/resolvers/brief-move.resolver.ts` and
`packages/core/src/types/brief-moves.ts`. An item's length follows rows LEN-06 and LEN-09.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| SLOT-01 | Gap kept on each side of an item or a Calendar event | 10 minutes; travel spans keep none | `BRIEF_MOVE_BUFFER_SECONDS` | Advisor plan, Phase 3A1 | Moves the person makes by hand into a gap under 10 minutes |
| SLOT-02 | Step between offered start times | 5 minutes | `BRIEF_MOVE_STEP_SECONDS` | Advisor plan, Phase 3A1 | Hand-set move times that are not on a 5-minute step |
| SLOT-03 | Times "Other time" offers | 3 | `BRIEF_MOVE_OTHER_TIMES` | Advisor plan, Phase 3A1 | Lines answered with a time typed by hand after Other time |
| SLOT-04 | Move lines in one brief | at most 8 | `BRIEF_MOVE_MAX_LINES` | Advisor plan, Phase 3A1 | Briefs that reach 8 lines; lines answered per brief |
| SLOT-05 | Latest start a move may suggest | 22:00 local | `BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE` | Implementation default ("Adjustable later") | Completions marked after 22:00 |
| SLOT-06 | Declines before a line offers "Don't suggest moving this" | 4, on different days; the same for Opportunities | `BRIEF_MOVE_NEVER_OFFER_AFTER_DECLINES`, `BRIEF_OPPORTUNITY_NEVER_OFFER_AFTER_DECLINES` | Advisor plan, Phase 3 | Behaviors declined 2 or 3 times and never accepted |
| SLOT-07 | An alongside item may share time | with an item or event at the same place, or where a place is unknown or Anywhere; never with travel or an item somewhere else | `alongsideMayOverlap`, `alongside.resolver.ts` | D33 (Ticket 357) | Alongside items the person moves away from their host |

## Travel timing and leave reminders

Margins around a trip and the rules of a leave reminder. `docs/NOTIFICATION_SPEC.md`,
"Leave reminders", holds the reminder rules in full.

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| TRV-01 | Get-ready time | 10 minutes; editable from 0 to 60 in steps of 5 | `TRAVEL_HABIT_RULES.preparation`, `packages/core/src/services/travel-habits.ts` | Owner, 2026-10-22 (Ticket 217): the 10 minutes. The range and step are Cadence assumptions | The get-ready time the person set |
| TRV-02 | Arrival buffer | 5 minutes; from 0 to 30 in steps of 5 | `TRAVEL_HABIT_RULES.arrivalBuffer` | Owner, 2026-10-22 (Ticket 217) | The buffer after answers have moved it |
| TRV-03 | A "too late" or "too early" answer | adds or removes 5 minutes; one question a local day; the newest 30 answers kept | `answerMinutes`, `answersPerLocalDay`, `retainedAnswers` | Owner, 2026-10-22: the 5 minutes and one a day. Keeping 30 is a Cadence assumption | Answers by kind; whether the buffer settles |
| TRV-04 | Exit and settling buffers | 0 seconds | `exitSeconds`, `settlingSeconds` | Owner, 2026-10-22 | "Too late" answers at places with a long walk in |
| TRV-05 | Places that keep a remembered travel mode | at most 100 | `maxRememberedPlaces` | Cadence assumption (Ticket 217) | Remembered places per account |
| TRV-06 | A trip is "soon"; "Leave now" lasts | 30 minutes before the leave time; 5 minutes after it, then late | `DEPARTURE_SOON_SECONDS`, `DEPARTURE_LEAVE_NOW_SECONDS`, `packages/core/src/resolvers/departure.resolver.ts` | Implementation default | Trips first seen inside 30 minutes |
| TRV-07 | A leave reminder fires | at the leave time minus the get-ready time, once per trip | `packages/core/src/services/leave-reminder-plan.ts`; Mac: `mac-leave-reminder-plan.ts` | D3 | Reminders sent against trips of the day |
| TRV-08 | One update to a sent reminder | only when the leave time moves 10 minutes or more earlier | `LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS`, `MAC_LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS` | D15 | Updates sent; leave times that moved under 10 minutes |
| TRV-09 | Route requests for one reminder | at most 3: plan, send, one after sending | `LEAVE_REMINDER_MAX_ROUTES` | D15 | Records at 3 routes |
| TRV-10 | The hosted job's timing | runs every 5 minutes and treats the next 5 as due; re-reads Calendar every 30 minutes; checks for an update 4 minutes after sending; a claim is stale after 15 minutes | `LEAVE_REMINDER_LOOKAHEAD_SECONDS`, `LEAVE_REMINDER_CALENDAR_REREAD_SECONDS`, `LEAVE_REMINDER_UPDATE_AFTER_SEND_SECONDS`, `LEAVE_REMINDER_CLAIM_STALE_SECONDS` | Ticket 277; implementation defaults | Reminders sent after their fire time |

## Connector completion matching

Which recorded activity can complete an Occurrence (D28).

| ID | Rule | Value | Where | Decided | What to look at |
|---|---|---|---|---|---|
| CON-01 | Shortest Hevy activity that can match | 5 minutes | `RECORDED_ACTIVITY_MIN_MATCH_SECONDS.hevy`, `packages/core/src/types/recorded-activity.ts` | D28.8, owner | Workouts under 5 minutes; workouts of 5 to 10 minutes that completed an Occurrence |
| CON-02 | Selector keys on one activity | at most 32 | `RECORDED_ACTIVITY_MAX_SELECTOR_KEYS` | Implementation default | Activities that reach 32 |
| CON-03 | Days of recorded activity one read covers | today and the 30 local days before it | `RECORDED_ACTIVITY_MAX_RANGE_DAYS` | Implementation default | Workouts older than 30 days with an Unresolved Occurrence on their day |

## Not yet listed

These rule sets are in code and have no rows here yet:

- Travel refresh timing (how long an estimate lasts, when a trip refreshes, the monthly ceiling share): `packages/core/src/services/travel-refresh-policy.ts`.
- Weather margins: the table in `packages/core/src/resolvers/weather-margin.resolver.ts`.
- Chat travel horizon: `TIGHT_MARGIN_SECONDS` and `HEAVY_TRAVEL_MINUTES_THRESHOLD` in `packages/core/src/resolvers/travel-horizon.resolver.ts`.
- Travel patterns over time: the constants at the top of `packages/core/src/resolvers/longitudinal-patterns.resolver.ts`.
- Recorded activity freshness (15 minutes): `RECORDED_ACTIVITY_REFRESH_SECONDS`, `RECORDED_ACTIVITY_FRESHNESS_SECONDS`.
- Opportunity suggestions: `packages/core/src/resolvers/brief-opportunity.resolver.ts`, apart from SLOT-06.
- The rest of connector completion matching (which Occurrence an activity matches on its day): the connector completion resolver, not read for this version.
