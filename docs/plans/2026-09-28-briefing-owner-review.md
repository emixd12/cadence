# Daily Brief owner decisions: stored briefs and candidate evaluation

Prepared September 28, 2026; owner evaluation criteria recorded September 30.
This packet supports Tickets 184–185. The criteria and initial coverage below are
owner-approved. Candidate outputs and stored-brief proposals remain unaccepted.

## When you return

Tickets 182–183 are implemented. Tickets 184–185 need these owner actions:

1. **Evaluation criteria recorded.** Use `daily-brief-balanced@1`: actionable adherence
   analysis and day planning, a general one-minute reading cap, longitudinal focus on
   quiet days, and varied lanes with justified repetition of important patterns.
   Coverage: six tuning cases, ten reserved cases and one seven-day sequence.
2. **Review complete A/B text.** Open the [local workbench](http://127.0.0.1:4321/design-system?preview=briefing-workbench).
   Use Days → Analyze days without a model → Save day → Plan daily briefs.
   Planning shows the call count. You run private account comparisons personally.
   Leave exact prose, then choose A/B/both/neither. No candidate is promoted.
3. **Decide stored briefs: pursue or decline.** If pursuing, record the choices in
   the lifecycle table: cutoff, latest valid refresh, expiry display, travel/day key,
   retention/deletion and offline behavior. Proposed defaults remain unaccepted.

Remaining reply template: `A/B feedback: …; Stored briefs: pursue/decline;
proposed storage defaults accepted except: …`. Accepted criteria do not accept
candidate outputs or authorize deployment. A two-day deletion promise needs scheduled cleanup.

If the local server stopped, start it with Node 24 using
`npx next dev --webpack --hostname 127.0.0.1 --port 4321`. If occupied, choose the
next free port through 4330 and update the workbench URL. Do not use `npm run dev`
for this session because that script selects port 3000.

## Decision status

- Ticket 185 permits proposal preparation only. Stored brief implementation,
migrations, deployment, and privacy-copy changes remain gated on recorded owner
choices.
- Ticket 184's criteria prerequisite is satisfied by the owner's September 30 reply.
No held-out comparison, quality result, candidate acceptance or promotion is claimed here.
- Keep the production preset unchanged until the Ticket 184 decision and release
gates are complete.

## Ticket 185: proposed stored-brief contract

### Proposed default

Store only complete, validated server results for the authenticated account and its
current local day. Store source revision, configuration revision, timezone, local
date, generated time, source-valid-until time, and a monotonic revision with each
result. Do not store raw prompts, source facts, credentials, or provider payloads.

Use the existing authenticated service and private owner-scoped database boundary.
A stored result is not a source of truth for Behaviors, Occurrences, Calendar, Notes,
reminder history, or current permissions. Current authorization and disclosure checks
must gate every read and write. Direct client table access stays denied under RLS.

### Lifecycle proposal

| Event | Proposed behavior | Owner choice still needed |
|---|---|---|
| First open before 07:00 | Do not start generation until the proposed 07:00 local cutoff. Timeline remains usable. | Keep 07:00, use local midnight, or choose another time? |
| First open at/after cutoff | Start one account/day generation through the existing path. Show loading; storage does not make first generation instant. | Approve automatic first-open generation? |
| Reopen | Return the latest complete revision only while its source-validity window remains open and its account, date, timezone, and disclosure revisions match. | Should same-day reopening return that revision? |
| Explicit refresh | Start a new revision under one account/day lease. Keep an older revision only while it remains valid. A failed or partial refresh never replaces a complete result. | Allow refresh after ordinary input changes, expiry, or both? |
| Expired source evidence | Withdraw current timing claims and offer the existing refresh action. Never treat a displayed timestamp as proof of freshness. | Hide the full brief or retain non-timing prose with a stale label? |
| Feature disabled | Immediately deny retrieval, invalidate pending leases, and schedule stored-content deletion. No late write may make content readable again. | Delete immediately or retain a short audit-free cleanup window? |
| Optional-source consent revoked or source disconnected | Immediately fence reads and pending writes that used that source. Prefer deleting affected stored revisions; do not serve them on another device. | Delete affected revisions or retain inaccessible data until normal expiry? |
| Account deleted | Cascade-delete stored briefs and lease metadata with the account. | None if existing account-deletion contract is retained. |
| Device offline or account-free | Show no generated brief. Keep local tracking available. Do not queue generation or imply local records were included. | Confirm no offline brief cache. |

### Cutoff, day key, and timezone

The existing product is keyed to the signed-in profile's local day, and the server
currently derives date and timezone. The 07:00 cutoff appears as an unconfirmed
proposal in the briefing bench document. It is not implemented as a stored-brief
contract.

Recommended choice for owner review: use a profile-local 07:00 eligibility cutoff,
while keeping the brief's date key equal to the profile's current calendar date.
Capture the timezone and date at admission. A timezone change fences the old
in-flight result. The owner must decide whether that change permits another
account/day generation or waits until the next local day; the latter avoids duplicate
briefs during travel but may leave the new timezone without a brief.

Alternative: use local midnight and the existing first-open behavior. This is simpler
and matches current user-flow language. It does not honor the proposed 07:00 input.
Do not silently mix an eligibility cutoff with a different date key.

### Revision, uniqueness, and failure behavior

Recommend an account + admitted local-date uniqueness key, with timezone and disclosure
revision stored on the claim. Use a database lease and idempotency key so parallel
web tabs and linked desktop devices share one automatic attempt and one refresh at a
time. Existing per-installation limits do not provide account/day uniqueness. Keep
existing rate limits and retry caps unless a follow-up decision changes them.

A complete revision becomes current atomically only after generation, validation,
source-freshness recheck, and authorization recheck succeed. Partial, timed-out,
rejected, cancelled, or storage-failed attempts cannot replace it. Preserve a still-
valid prior revision after a refresh failure. If no valid revision remains, return the
existing recovery notice and explicit retry. Do not add automatic retry loops.

On reopen, select the newest revision that passes current account, date, timezone,
source-revision, disclosure, and expiry checks. Never fall back to an older revision
whose evidence has expired or whose optional-source authorization was revoked.

### Freshness versus retention

Keep validity and retention separate. Recommend a source-validity cutoff no later
than the earliest existing five-minute source age, local midnight, or authorization
invalidation. Retention may keep authenticated server content for up to
two days after creation for same-day recovery and cleanup. Retention does not extend
validity and does not authorize display.

A two-day promise requires scheduled deletion for inactive accounts. Deleting only
when the user next opens the app does not meet that promise. Specify cleanup cadence,
retry behavior, and a measurable maximum deletion lag before implementation. If that
service cannot be guaranteed, do not promise a two-day maximum or store text under that contract.

### Disable, deletion, RLS, and race requirements

- Settings disablement must revoke retrieval before background cleanup runs.
- Preference, Calendar connection/selection, profile timezone, account, and source
  revision changes must fence an active generation before input and before commit.
- A pending write must compare the current preference/disclosure revision and lease
  at commit. Revocation winning the race means the write fails closed.
- Every read derives the owner from the authenticated current session. RLS and narrow
  RPC grants must prevent cross-account reads, including stale identifiers.
- Account deletion cascades content and operational lease/idempotency rows. The
  cleanup path must be safe to retry and must not recreate rows after deletion.
- Do not put stored brief text in exports, desktop SQLite, backups, browser storage,
  logs, analytics, or error messages unless a later decision explicitly expands scope.

### Linked desktop and privacy copy

Linked desktop may read a current hosted revision while online and authenticated.
Offline/account-free mode shows no stored brief. The brief uses hosted account context
only; local-only or unsynced Behaviors and Occurrences are excluded and must be named
in the UI where the stored brief is presented. Do not queue generated content for
later synchronization.

If storage is accepted, file a marketing/privacy-copy follow-up before release. Review
`/privacy`, marketing FAQ/privacy wording, and desktop disclosures for content type,
purpose, retention window, deletion behavior, and the fact that offline/unsynced local
data is excluded. No marketing copy change is authorized by this packet.

## Ticket 184: accepted evaluation criteria — September 30, 2026

The owner supplied these criteria before candidate evaluation:

- **Usefulness:** provide actionable insights for improving adherence. Combine
  behavioral adherence analysis from available evidence with planning advice for
  the day's Behaviors and outside connector events. Existing consent, evidence
  sufficiency and source limits still apply; "all available data" does not bypass them.
- **Reading burden:** keep the complete visible brief generally within a one-minute
  read. Be concise and precise. This replaces the earlier 45-second evaluation target;
  it is not a requirement to fill a minute. Record observed reading time and visible
  word count; word count alone does not establish reading time. A future user setting
  may vary length, but no setting is added by this decision.
- **Quiet days:** prioritize supported longitudinal adherence insights over day-specific
  management tips. Do not invent a pattern when history does not support one.
- **Repetition:** prefer different analysis lanes across days. Revisit persistent
  high-importance or high-impact patterns when useful. Wording may vary, but rephrasing
  alone does not make a repeated insight different. Record the reason for each repeat.
- **Initial coverage:** six tuning cases, ten reserved evaluation cases and one
  seven-day sequence. This is one coverage profile, not a universal fixed suite.

Factual, privacy, authorization and delivery failures remain blockers. The owner
will judge complete outputs against these criteria; no numerical win-rate threshold
or automatic promotion rule is inferred.

### Coverage profiles and evaluation iterations

| Profile ID | Revision | Recipe | Coverage | Predecessor | State |
|---|---|---|---|---|---|
| `daily-brief-balanced` | `1` | `daily_brief@1.0` | T1–T6, H1–H10, S1 (seven days), defined below | None | Initial coverage accepted; iteration 1 pending |

Use `daily-brief-balanced@1` when referring to this exact profile revision.
A profile has a stable ID; revising its cases, criteria, clock or input coverage
creates a new revision with a predecessor and change reason. A distinct coverage
purpose gets another profile ID. Preserve previous definitions and results.

An evaluation iteration is separate from a profile revision. Record profile ID and
revision, iteration number, candidate/baseline versions, source freeze, case/run IDs,
feedback, failures and outcome in the existing QA record. Reusing a profile does not
reset held-out exposure: once its held-out results influence tuning, reserve new
held-out cases in a new revision before evaluating the changed candidate.
Private case/run details remain in local reports; repository QA uses non-private IDs.
This document records profiles; a profile selector or automatic iteration tracker
has not been added to the workbench.

### Profile `daily-brief-balanced@1`: pre-evaluation freeze

Use one captured logical clock for every case: `2026-11-01T12:00:00Z`, which is
07:00 in `America/New_York` after the local DST transition. The target date is
`2026-11-01`. The active source fixture already uses this date, timezone, and clock.
Use baseline `cadence-default` (config 1.2) and candidate `advisor-analysis`
(config 1.3). Do not tune or revise the frozen held-out pairs below.

| Split | Case | Day fixture | Analysis fixture | Purpose |
|---|---|---|---|---|
| Tune | T1 | `sparse` | `none` | Ordinary day and no finding. |
| Tune | T2 | `dense` | `heavy_load` | Several scheduled items and high load. |
| Tune | T3 | `overlap` | `no_issue` | Supported schedule conflict. |
| Tune | T4 | `tight_transition` | `late_logging` | Tight interval with a separate history signal. |
| Tune | T5 | `supported_gap` | `marking_offset` | Supported opportunity and timing pattern. |
| Tune | T6 | `completed` | `no_issue` | Resolved work and no remaining-work advice. |
| Held out | H1 | `uneventful` | `no_issue` | Quiet day without a supported pattern: concise output without a tip is valid; generic coaching is not. |
| Held out | H2 | `incomplete_history` | `capped` | Unknown and capped history must stay unknown. |
| Held out | H3 | `calendar_partial` | `none` | Partial Calendar cannot imply free time. |
| Held out | H4 | `hostile` | `note_obstacles` | Hostile Behavior and Note text stay untrusted. |
| Held out | H5 | `sparse` | `weekday_dip` | Historical pattern must be relevant today. |
| Held out | H6 | `missing_duration` | `small_sample` | Insufficient duration evidence cannot prove a fit. |
| Held out | H7 | `no_feasible` | `changed_schedule` | Reserved day and schedule-change boundaries. |
| Held out | H8 | `calendar_absent` | `reminder_association` | No Calendar plus optional-source evidence. |
| Held out | H9 | `completed` | `all_unresolved` | Current resolved state and historical unresolved data. |
| Held out | H10 | `overnight` | `none` | Calendar interval from 23:00 to 02:00 next local day. |

This initial accepted coverage profile uses the exact existing IDs above. Reserve H1–H10 before any
candidate tuning. Run the same case, clock, and renderer on both configurations.
Do not use held-out results to revise prompts, references, configuration, resolver
rules, or presentation. If a held-out case exposes a defect, record it, make a new
candidate, and create a newly reserved holdout before evaluating that candidate.

**Held-out sequence S1:** save seven Synthetic days, September 21–27, 2026, at
07:00 America/New_York. Use `sparse` + `corrections` with the same frozen A/B presets.
Start warm-up empty. Plan all seven chronologically, then review 14 complete briefs
for repetition and accumulated reading burden. Count S1 as one sequence, not seven
independent quality votes. Reserve this sequence before tuning.

**Overnight coverage:** H10 uses the added versioned `overnight` fixture. Its event
starts at `2026-11-02T04:00:00Z` and ends at `2026-11-02T07:00:00Z`.
Both A/B use the November 1 local day; the event ends on November 2.

**Version and source freeze:** the following are versions from the current source and
SHA-256 digests of the files in the working tree during this preparation pass. These
hashes identify file contents, including uncommitted contents; a Git commit alone
must not stand in for them. Recompute and record the hashes immediately before any
actual evaluation. The model call itself has not run. A recoverable copy of these
non-private source files is saved at `.local/briefing-bench/freezes/ticket184-20260928/`;
its `manifest.json` records SHA-256 digests. Keep that copy when changing candidates.

- Presets: `cadence-default` config 1.2; `advisor-analysis` config 1.3;
  recipe `daily_brief@1.0` — `packages/core/src/data/briefing-presets.json`:
  `b98756dfc5d2b69a0598ad8b3f8ec7bf3013d44876f7cc1a7174a80de8e998f8`.
- Prompt and validation source — `lib/services/daily-brief-consumer.ts`:
  `0a7b6d275bb95fda0865ad56020316739f58aaca1a4ac0670979bf986217a6f3`.
- Model adapter: `gpt-5.6-luna`, reasoning `low`, policy version 3.0,
  output cap 2,000 tokens — `lib/services/daily-brief-openai.ts`:
  `8f687426231b8ee4116fbd27472c625e975435bbbe7d4127f7282c8b6b1ca282`;
  policy constant — `packages/core/src/types/daily-brief.ts`:
  `336f4f60ffe693642bbfb88f900d555d91bea43c58539fa286e645247c6b3e6a`.
- Pipeline 3.0 — `lib/services/briefing-pipeline.ts`:
  `40f2a1c11eda9606d2498cb067913bc4db427411cf2fd3ac37442c2a8b710294`.
- Configuration parser 1.3 — `packages/core/src/services/briefing-config.ts`:
  `11e74b8e7de2295985b03a318e240bf6b9e9ea971720c81ee54bae700d1415e6`.
- Planner 1.1 — `packages/core/src/resolvers/briefing-plan.resolver.ts`:
  `ef82f381861261fdd9929037b8e8f8ded35945b770a1205d95bcfa7fc9324394`;
  planner type — `packages/core/src/types/briefing-plan.ts`:
  `f06d74a485ba27b850a137f7de23c7934ee3129e66b9a6a19f2aa7e68560cfb5`.
- Analysis 1.0 — `packages/core/src/resolvers/briefing-analysis.resolver.ts`:
  `85e638b3488dd046e0dfed90343da71b511dd572ecbefc08b484bb6c0b6c18fc`;
  analysis type — `packages/core/src/types/briefing-analysis.ts`:
  `48c31f395ea0ce84fd7d8970ec9e20243f27b7febeaae61417bcf6656b80c34a`.
- Reference catalog `2026-09-20.1` — `packages/core/src/data/briefing-references.json`:
  `18feb52f69bd7536e7a4091f59cb65ed519b78482fccbbabf4f60c77f8cb0850`;
  selector — `packages/core/src/services/briefing-references.ts`:
  `a81754c3e6374620370c447a07acedde9e7d8f48cacc47ba80b28c35e047538c`.
- Rendered-text helper — `packages/core/src/services/daily-brief-presentation.ts`:
  `7718e392a989014040f15f392997bf9a6e63977edae9814a076d5c931585ce0d`;
  bubble — `components/briefing/DailyBriefBubble.tsx`:
  `779fe5f03fec12b5a2d5cf5bfc539a23ff89fce62fe5d39c74423e66c27c2f21`;
  comparison renderer — `app/design-system/BriefingReview.tsx`:
  `8f3cb2e72b6d6d3c5dd0e2b08bd25990c2a40e4eb833dfa4b6d392844002cf09`.
- Day fixture implementation `synthetic-2026-09-28.1` —
  `lib/services/briefing-fixtures.ts`:
  `93b311ae489f49939ac0ba2a6d65ee49df2215454959b915da305eab77890152`;
  analysis fixture implementation `synthetic-analysis-2026-09-26.1` —
  `lib/services/briefing-analysis-fixtures.ts`:
  `4f06bf864dd4431da6987df1a108bf9a671bc9f45810277842787f577e6b9d6a`;
  base context — `tests/fixtures/advisor-day-context.valid.json`:
  `531993b1880c28ef8bc7bacabff83f38e23394fd4ca39c7ed136a32ae24057b7`.

The September 30 criteria above govern evaluation of this profile. The source
freeze remains the September 28 preparation snapshot. Check it against the selected
candidate before running; keep the original recoverable copy. Criteria acceptance
does not accept outputs, promote a candidate, or authorize deployment.

### Proposed review and release record

Record complete rendered output, owner preference (A/B/both/neither), prose comments,
reading burden, useful-today answer, unclear/repeated/unnecessary text, factual
support, privacy/delivery failures, sample count, failures, and unresolved concerns.
Review a consecutive-day sequence for fatigue. Report wins, ties, losses, withheld
outputs, and failures separately. Keep factual, privacy, authorization, and delivery
failures as blockers regardless of preference.

Promotion remains an ordinary reviewed repository change through
`packages/core/src/data/briefing-presets.json` and the existing policy mechanism.
Record prior preset, candidate, relevant versions, release commit, rollback target,
and rollback evidence. The current rollback target is the frozen `cadence-default`
selection in `activeBriefingConfig()`. A future promotion must retain that exact
selection and source snapshot for rollback. Test restored optional-source exclusions
on new generation and preserve every Behavior and Occurrence. This task prepares
that check; it does not claim a rollback of an unpromoted candidate. Do not promote, deploy, alter the production preset, or claim
owner acceptance in this decision packet.

## Owner decision record

Ticket 184 criteria and initial coverage are accepted as recorded below.
Ticket 185 storage choices remain undecided and must precede its implementation.

- Stored briefs: undecided — accept storage / decline storage.
- Automatic cutoff: undecided — 07:00 local / local midnight / other.
- First-open generation and same-day reopening: undecided.
- Timezone-change day-key behavior: undecided.
- Refresh triggers and whether an older valid revision remains visible: undecided.
- Expired content presentation: undecided — hide all / retain non-timing prose with
  explicit stale state.
- Account/day cross-device claim and retry policy: undecided.
- Retention and maximum scheduled-deletion lag: undecided.
- Disablement, optional-source revocation, and pending-write disposition: undecided.
- Linked desktop offline/unsynced disclosure: undecided.
- Ticket 184 evaluation criteria: accepted September 30, 2026, as stated above.
- Initial coverage: accepted as `daily-brief-balanced@1`; iteration 1 has not run.
- Numerical win-rate threshold: not specified; explicit owner output acceptance remains required.
- Candidate promotion and rollout authorization: not granted by this packet.

## References

- `docs/TICKETS.md` Tickets 182–185.
- `docs/plans/2026-09-27-briefing-bench-review.md`.
- `docs/PRODUCT_SPEC.md`; `docs/DATA_MODEL.md`; `docs/UI_SPEC.md`;
  `docs/USER_FLOWS.md`; `docs/ROUTE_MAP.md`; `docs/DECISIONS.md`.
- `docs/plans/first-external-consumer.md`; `docs/qa/briefing-workbench.md`;
  `docs/qa/in-app-daily-brief.md`; `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.
- `lib/services/daily-brief.service.ts`; `lib/db/daily-brief.repo.ts`;
  `components/briefing/DailyBriefLauncher.tsx`;
  `components/briefing/DailyBriefBubble.tsx`.
- `lib/services/briefing-fixtures.ts`; `lib/services/briefing-analysis-fixtures.ts`;
  `tests/fixtures/advisor-day-context.valid.json`.

