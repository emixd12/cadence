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

Coverage: this first version holds the length rules from Ticket 366 and the rules beside
them, the Daily Brief's day-note rules from Ticket 367, and the Period rules for the Daily Brief
and advisor tips from Ticket 371. The sets in "Not yet listed" still live only in code.

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
| PER-05 | Longest Period query range | 366 days | `PERIOD_LIMITS.rangeDays`, `resolvePeriodRange` | Periods plan (D35), section 1 | Not used by a caller yet |

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

## Not yet listed

These rule sets are in code and have no rows here yet:

- Daily Brief analysis thresholds: `T` in `packages/core/src/resolvers/briefing-analysis.resolver.ts`.
- Coach signals: `T` and `V` in `coach-signals.resolver.ts` and `coach-signals-v2.resolver.ts`.
- Schedule-change proposals: `R` in `packages/core/src/services/behavior-change-proposal.ts`.
- The free-slot rule and its gaps: `packages/core/src/resolvers/brief-move.resolver.ts`.
- Travel margins, get-ready time and leave reminders: `docs/NOTIFICATION_SPEC.md`, "Leave reminders".
- Connector completion matching: `RECORDED_ACTIVITY_MIN_MATCH_SECONDS`.
