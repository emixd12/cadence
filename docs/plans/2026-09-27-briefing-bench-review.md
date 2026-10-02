# Briefing bench: audit and revised proposal

Prepared September 27, 2026. This document preserves the audited proposal.
Execution status: Tickets 175–177 implement Phases 0–2. The September 28 review
filed Phases 3–5 as Tickets 182–184. Ticket 185 owns the separate stored-brief
decision. `docs/TICKETS.md` and `STATUS.md` govern current scope and progress.
The September 30 criteria in `2026-09-28-briefing-owner-review.md` supersede this
proposal's 45-second target and quiet-day/repetition guidance for Ticket 184.

**Recommendation:** Build the visual comparison and prose-feedback loop before expanding historical replay.

**Goal:** Improve Daily Brief toward a clear 45-second overview, plus one useful observation when evidence supports it.

**Source of truth:** The owner's request and clarification govern this review. Repository product contracts govern existing behavior.

**Architecture:** Reuse the current comparison service, deterministic analysis, generation pipeline, and production bubble. Add a private review record and versioned candidates. Extend historical inputs only after defining their accuracy.

**Execution:** Review this proposal before turning its phases into tickets. This review does not authorize implementation or production changes.

## Confirmed intent and assumptions

The owner wants meaningful advice that is clear and easy to absorb daily. The owner confirmed a roughly 45-second overview plus one useful observation.

The owner is a visual designer. Reading alternatives and giving agents prose feedback must be a primary workflow.

The attachment reports earlier decisions about account data, 7:00 AM, storage, Calendar replay, and a 100-call budget. Those statements remain proposal inputs. They do not authorize account access, generation, migrations, or deployment during this audit.

Pending the remaining clarifications, this proposal assumes:

- Side-by-side comparison is the default. Rewriting and reviewing several days remain available.
- Initial tuning changes prompts, configuration, evidence selection, or deterministic rules. Model-weight training is deferred.
- Stored daily briefs remain an independent product proposal.
- Four clarifying questions have been asked. Only the reading-length answer has arrived at publication.

## Audit outcome

The plan preserves useful boundaries: deterministic calculations, frozen comparisons, private development access, synthetic cases, and reviewed production promotion.

Its success criteria emphasize generating and rating more outputs. They need to measure whether those outputs improve daily understanding.

The most important missing feature is a complete chain from a specific comment to a specific, testable change.

### 1. Define the reading experience before adding generation modes

**Finding:** The plan measures lane coverage and ratings. Neither proves that a complete Daily Brief earns the reader's attention.

**Change:** Make the complete rendered brief the primary review unit. Lane outputs diagnose particular problems.

Use these proposed editorial criteria:

- The opening explains what matters today, beyond the visible Timeline.
- The overview usually contains one or two distinct planning points.
- At most one historical observation appears. It needs relevance to today and enough supporting evidence.
- A next step appears only when evidence supports it. An observation can be useful without prescribing an action.
- Quiet days stay short. Producing no pattern tip is a successful outcome.
- The prose names Behaviors and concrete consequences. It avoids internal terms, judgment, generic encouragement, and repeated advice.
- Marks describe logging time. They do not establish when a Behavior happened.
- Suggestions remain read-only and preserve the existing scheduling boundaries.

Start by testing approximately 80–120 visible words. This is a proposed working range, not a validated reading-speed formula.

Count evidence lines, limitations, suggestions, travel lines, and repeated labels when reviewing the reading burden. The current validator counts model text, suggestions, and tip text only.

Ask the owner after one reading: “What matters today?” and “Was any part unclear, repetitive, or unnecessary?”

Do not hide material uncertainty or evidence just to meet a word target. Review presentation changes against the existing evidence-line contract.

**Evidence:** `daily-brief-consumer.ts:115` counts model fields. `DailyBriefBubble.tsx:50` renders additional supporting text.

### 2. Replace isolated ratings with anchored prose feedback

**Finding:** The existing bench has one memory-only review textarea. The plan adds ratings and reasons, but no process for converting them into changes.

**Change:** Save the owner's exact comment beside its comparison, output, version, and optional text selection.

The default judgment is “Prefer A,” “Prefer B,” “Both work,” or “Neither works.” The prose explains the judgment.

Allow an optional replacement sentence. Do not require taxonomy selection or a numerical score before commenting.

An agent turns the comment into a proposal containing:

1. The original feedback and linked examples.
2. The interpreted problem and its likely owner.
3. The smallest proposed configuration or code change.
4. The expected effect, possible regression, and cases to rerun.
5. A candidate comparison for human review.

The owner can correct the interpretation. Feedback does not silently become a production rule.

Example feedback: “B is clearer, but it still tells me the same thing twice. Keep the observation; explain it once.”

Example proposal: Keep historical observations in the tip field. Remove repetition from the overview. Compare both versions on the same cases.

If the underlying evidence is wrong, route the change to the resolver. Prompt changes cannot repair incorrect timing calculations.

Start with a local review packet that an existing coding agent can read. No new agent framework or embedded chat is needed.

**Evidence:** `DailyBriefBench.tsx:73`, `:80`, and `:266` show memory-only notes and invalidation. The attachment's §6.4 records ratings but no candidate-change lineage.

### 3. Make reading and comparing the main workspace

**Finding:** Six stacked workflow sections still make the owner traverse controls before reaching text. A day × lane × configuration card collection grows quickly.

**Change:** Use three views: Compare, Days, and Saved reviews. Compare opens first.

The Compare view contains:

- A compact day/case selector and named baseline/candidate selectors.
- Two equally sized reading columns using the real Daily Brief presentation.
- A nearby prose-feedback field and optional replacement wording.
- Collapsed controls for evidence, configuration differences, and technical details.

Pin the baseline while editing the candidate. Configuration changes must not erase completed results or feedback.

An unfinished request can be cancelled. Its previously completed results remain available and retain their original versions.

Show one day at a time by default. The Days view lets the owner compare a short sequence for repetition and accumulated burden.

Keep the lane grid as a diagnostic view. Use Behavior titles, plain-language lane names, selection reasons, and text labels for unavailable data.

On narrow screens, stack A above B with clear labels. Preserve drafts when switching views.

Moving to `/design-system/briefing` can happen with this first useful slice. A component split alone does not resolve the workflow problem.

**Evidence:** `DailyBriefBench.tsx:78` clears results and notes on configuration changes. `:265` already renders the production bubble in two columns.

### 4. Stop promising exact historical mornings without historical evidence

**Finding:** Reading records for a past date does not prove what the system knew at that time.

Status events help, but the current analysis projection omits ingestion timestamps. Imported and backfilled events can carry earlier recorded times.

The current Notes input reads the present occurrence Note. The reminder projection exposes current delivery status and scheduled send time. Neither provides full state history.

Configuration changes, elapsed durations, deleted records, account timezone, and late-created occurrences also need explicit reconstruction rules.

Google Calendar's event-list API filters event times and last updates. It provides no documented “calendar as known at 7:00 AM” parameter. Therefore, fetching a past date cannot establish that historical state. [Google Calendar event-list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

**Change:** Distinguish three evidence types:

| Evidence type | Meaning | Appropriate use |
|---|---|---|
| Captured case | Inputs were frozen during an actual authorized capture | Same-input comparison and regression checks |
| Reconstructed case | Retained history supports some state at the chosen instant | Scoped comparisons with per-source limitations |
| Retrospective case | Current records describe a past date | Exploration; no claim that these were the original morning's facts |

Do not blend these types in quality reports. Unknown history remains unknown; it does not silently become Unresolved.

Define cutoff inclusivity, stable event ordering, revision-chain handling, and late-ingestion semantics. Apply them to both target-day facts and lookback history.

For optional sources without adequate history, omit the source or label the case retrospective. A single past Calendar day does not enable the historical Calendar-pattern lane.

Separate replay time from today's request clock. Use replay time for historical calculations. Use today's clock for authentication, cancellation, and access checks.

The existing generator enforces context freshness. Replaying old timestamps through it unchanged will fail. Add a bounded development evaluation adapter; preserve production freshness checks.

A frozen historical case still needs current authorization. Keep account, consent, Calendar-selection, and connection checks. Capture inputs consistently before freezing them.

New database RPCs also need direct-access controls. A loopback route does not make a hosted public RPC development-only.

**Evidence:** `advisor-analysis.repo.ts:15`, `briefing-analysis-source.ts:28`, `daily-brief-consumer.ts:194`, and migration `20260926170000_daily_brief_analysis_sources.sql:216`.

### 5. Preserve enough information to explain and rerun a comparison

**Finding:** A configuration hash and compact finding cannot recreate a past model input. Fresh data, references, prompts, and opaque identifiers can change.

Saving only successful results also hides timeouts, rejected outputs, cancellation, and storage failures from evaluation.

**Change:** Keep a small local record with explicit capabilities.

| Record | Minimum useful contents |
|---|---|
| Case | Case ID, source mode, target date, replay time, timezone, coverage, source revisions, stable local reference mapping |
| Candidate | Configuration, prompt/reference versions, model identifier, relevant source revision, parent candidate, change rationale |
| Run | Case and candidate IDs, attempt ID, output, rendered evidence, validation, latency, warnings, completion/error/cancellation state |
| Feedback | Exact prose, preference, optional quotation/rewrite, run IDs, candidate IDs, review timestamp |
| Proposal | Linked feedback, interpreted problem, proposed patch, verification cases, review disposition |

For exact reruns, retain the minimal authorized projected inputs once per saved case. Retain recoverable prompt and reference versions too.

This requires an explicit local-storage policy change. Do not quietly expand the attachment's output-storage proposal into unrestricted source storage.

Where inputs are not retained, label the run “Review only.” The owner can reread it, but cannot claim an exact rerun.

Use `.local/briefing-bench/` and reuse JSON Lines. Separate append-only feedback events from immutable results. Start without compression automation.

Add deletion, bounded retention, schema versions, and owner partitioning. `.gitignore` prevents commits; it does not provide access control or deletion.

A failed write must show “Not saved” and retain the visible result. Feedback must remain attached to the original output across reloads.

Defer monthly gzip rotation until measured size justifies it. Store short failure metadata rather than raw invalid provider responses.

### 6. Correct the targeted fixes and evaluation semantics

**Midnight bug:** The reported problem is supported by source. `realisticTiming` interprets midnight as zero minutes.

Adding 1,440 minutes to the end fixes that arithmetic case. It does not settle overnight marks because the resolver first excludes next-day marks.

The lane currently promises same-day marks. Preserve that rule initially, or explicitly revise it before accepting next-day marks inside an overnight slot.

The planner already advances overnight range ends. Match that convention and test both sides; do not rewrite working planner logic without evidence.

**Duplicate tip:** An eight-word match is a narrow diagnostic, not a semantic duplication test. Reuse the existing phrase matcher if useful.

Dropping the tip while retaining the same advice in the overview can remove its evidence line and repetition tracking. Preserve provenance and tip-history semantics.

Keep the wording rule, surface duplication warnings, and verify whole rendered outputs. Avoid automatic text surgery based only on phrase length.

**Mechanics words:** Warn on internal language, but avoid rejecting a legitimate Behavior title containing a flagged word.

**Lane generation:** Distinguish “Preview each lane” from “Generate daily brief.” The former offers isolated eligible findings for diagnosis.

A lane preview must disclose any bypass of ranking or cooldown. It must never bypass evidence sufficiency, source consent, or factual validation.

There are nine lane contracts. Historical Calendar context currently reports unavailable. Derive the eligible count instead of hardcoding eight.

**Spacing simulation:** A no-model scan can simulate selection, not confirmed delivery. Production records a tip only when generation retains it.

Label the assumption that selected tips were delivered. Initialize stable fingerprints and any warm-up history explicitly. Keep actual production history untouched.

**Budget:** Count provider calls, including dispatched failures, retries, and dispatched cancellations. Undispatched cancelled work consumes no call.

Reserve budget before dispatch and bound concurrency across tabs. Show queued work and partial results. Cancellation cannot promise a provider refund.

Keep the proposed 100-call ceiling configurable and separate from production admissions. Do not treat it as a token-cost ceiling.

**Evidence:** `briefing-analysis.resolver.ts:294`, `:774`; `briefing-plan.resolver.ts:603`; `daily-brief-consumer.ts:118`; `daily-brief.service.ts:111`.

## Revised delivery plan

Assign ticket numbers after checking the current ledger. Do not assume Tickets 175–181 remain available.

| Phase | Deliverable | Acceptance evidence |
|---|---|---|
| 0. Trustworthy baseline | Fix midnight classification, readable labels, and duplicate/provenance behavior. Define the editorial target. | Regression examples pass. The owner can identify why each observation appears. |
| 1. Compare and comment | Dedicated Compare view, pinned baseline, candidate, saved results, anchored prose feedback. Use today's authorized capture and existing synthetic cases. | The owner comments, edits a candidate, reloads, and retains the original comparison and feedback. |
| 2. Turn feedback into candidates | Local agent review packet, versioned prompt/configuration changes, visible differences, same-case reruns. | One prose comment leads to a specific patch and a reviewable before/after result. |
| 3. Explore selected days | Date/range selection, source-accuracy labels, reconstruction where supported, no-model analysis grid. | Late corrections and imports cannot silently enter a supposedly earlier snapshot. |
| 4. Review sequences and lanes | Small batch comparisons, diagnostic lane previews, budget accounting, cancellation, simple review report. | Repetition and cumulative reading burden can be reviewed across consecutive days. |
| 5. Promote a candidate | Review the candidate against held-out cases and ordinary daily use. Promote through a repository change. | Human preference improves without factual, delivery, or privacy regressions. |
| Separate product track | Stored daily briefs and reopening, if retained after review. | Independent product, disclosure, storage, freshness, and cross-device acceptance. |

Default to a two-week range for discovery. Support the proposed longer range only where source coverage and runtime limits permit.

The maximum historical window can require roughly 180 days of underlying records. A 90-day target range alone is not sufficient evidence coverage.

Begin with a small curated evaluation set: ordinary days, a quiet day, a scheduling conflict, an overnight range, missing inputs, and repetitive patterns.

Reserve several cases from tuning. Compare the same cases under the same logical clock. Track wins, ties, losses, failures, and unresolved concerns.

Do not average factual failures into an overall quality score. Do not promote a candidate from one attractive generation.

Use a short consecutive-day review to assess fatigue. A tip that reads well once can still be annoying every other morning.

No initial model-weight training is required under the current assumption. If training is desired, first establish stable examples, consent, labels, and held-out evaluation.

## Stored daily brief: separate proposal corrections

Preserve the attachment's proposed 7:00 AM behavior as an unconfirmed input here. Before 7:00 AM, no automatic generation occurs under that proposal.

The first opening after 7:00 AM still waits for generation. Storage makes subsequent openings faster; it does not make first opening instantaneous.

Resolve these product details before implementation:

- **Concurrency:** Existing admission is per installation. Shared storage needs an account/day generation claim to avoid duplicate cross-device calls.
- **Refresh:** Define whether reopening shows the first brief or the latest refreshed brief. Recommend the latest valid revision without a history browser.
- **Freshness:** Preserve current withdrawal of expired timing claims until a different behavior receives explicit acceptance. A timestamp alone does not fix stale advice.
- **Retention:** A “delete on next opening” rule does not expire inactive accounts' data. A two-day promise needs scheduled deletion and tests.
- **Revocation:** Disablement, account deletion, changed disclosure, and revoked source permissions must block retrieval and handle pending writes.
- **Timezones:** Define the day key and cutoff across timezone changes. Separate content retention from timing validity.

Use a new migration for schema and table-comment changes. Do not rewrite applied migrations to erase the prior storage policy.

## Implementation references and platform impact

| Area | Existing owners to reuse |
|---|---|
| Compare view and feedback | `app/design-system/DailyBriefBench.tsx`; proposed route `app/design-system/briefing/page.tsx` |
| Development guard and generation | `lib/services/briefing-workbench.service.ts`; `app/api/dev/briefing-comparison/route.ts` |
| Account access and source capture | `lib/services/briefing-account-context.service.ts`; `lib/db/advisor-analysis.repo.ts` |
| Candidate preparation and prompt | `lib/services/briefing-pipeline.ts`; `lib/services/daily-brief-consumer.ts` |
| Analysis and selection | `packages/core/src/resolvers/briefing-analysis.resolver.ts` |
| Configuration and presets | `packages/core/src/services/briefing-config.ts`; `packages/core/src/data/briefing-presets.json` |
| Production presentation | `components/briefing/DailyBriefBubble.tsx` |
| Stored delivery, if approved | `lib/services/daily-brief.service.ts`; `lib/db/daily-brief.repo.ts`; `components/briefing/DailyBriefLauncher.tsx` |

| Platform | Impact |
|---|---|
| Web | Bench phases stay behind development guards. Shared correctness fixes and separately reviewed promotion affect Daily Brief. |
| Desktop | The bench is not a desktop feature. Shared prompt/core changes and later bubble changes need the relevant hosted/native verification. |
| Marketing | No implementation or claim change is proposed. Revisit only if production storage changes affect published privacy wording. |
| Future mobile | Responsive web comparison and shared bubble changes need narrow-width QA. Native mobile remains deferred. |

Use the existing interaction registry and design-system catalog. Invoke design-system-bench and the project Impeccable workflow before implementing UI changes.

Update governing product/privacy documents before shipping persistence. Update `STATUS.md` when an actual ticket changes state.

## Verification and remaining uncertainty

This audit inspected the attachment, repository instructions, current source, migrations, test cases, and official Calendar documentation.

The checkout already contains workbench and desktop changes. This review did not alter those files.

No account data was fetched. No model generation, database operation, product test suite, build, or live browser QA ran for this document review.

The separate comparison concept uses written synthetic examples. Its DOM check passes preference selection, day switching, feedback retention, and quiet-day rendering.

Implementation must follow the repository's required checks: `agents:check`, `interactions:check`, `resolvers:check`, lint, TypeScript, tests, and build.

Add core, design-system, and desktop checks where their surfaces change. Verify narrow layouts and keyboard use on the required loopback port pool.

Test replay leakage, retained feedback, same-case comparisons, failure persistence, call accounting, and the independent stored-brief lifecycle in their owning phases.

Actual prose quality remains unverified. The owner must review generated examples before accepting a candidate.
