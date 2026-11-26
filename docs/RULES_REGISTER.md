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
them. The sets in "Not yet listed" still live only in code.

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

## Not yet listed

These rule sets are in code and have no rows here yet:

- Daily Brief analysis thresholds: `T` in `packages/core/src/resolvers/briefing-analysis.resolver.ts`.
- Coach signals: `T` and `V` in `coach-signals.resolver.ts` and `coach-signals-v2.resolver.ts`.
- Schedule-change proposals: `R` in `packages/core/src/services/behavior-change-proposal.ts`.
- The free-slot rule and its gaps: `packages/core/src/resolvers/brief-move.resolver.ts`.
- Travel margins, get-ready time and leave reminders: `docs/NOTIFICATION_SPEC.md`, "Leave reminders".
- Connector completion matching: `RECORDED_ACTIVITY_MIN_MATCH_SECONDS`.
