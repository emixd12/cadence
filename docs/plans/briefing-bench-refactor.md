# Briefing bench refactor and stored daily brief — execution plan

Prepared September 27, 2026 for an executing agent. The owner reviewed a first
draft in conversation and answered its open questions; this document records
their pain points, objectives, decisions, the current system, and the phased
work. Read `AGENTS.md`, `STATUS.md` and `docs/OPERATIONS.md` first, as usual.

Base branch: this plan assumes PRs #82 (Ticket 168) and #83 (Tickets 169–174)
are merged. If they are not, stack on `claude/tickets-169-173-advisor-analysis`.
Another session had uncommitted workbench edits in the main checkout on
September 27 (account-access error display in `app/design-system/DailyBriefBench.tsx`,
`lib/services/briefing-workbench.service.ts` and their tests, plus desktop release
work). Pull or rebase onto whatever lands before starting; do not discard it.

## 1. Owner pain points

Quoted or closely paraphrased from the owner, September 27, 2026:

- "I would like for the testing to allow me to select multiple days." The bench
  only replays today's snapshot, so each run shows one day and one tip.
- "The design bench is getting pretty cluttered and disorganized." One 270-line
  component mixes data source, two full configuration editors, fixtures, glossary,
  JSON import/export, results and raw inspectors.
- The tip-selection summary is an unreadable flat list of about 30 opaque
  `behavior_…` refs with lane prefixes (see the September 27 run below).
- Testing across lanes needs many manual comparisons, each limited to one selected tip.
- The six-comparisons-per-hour limit interrupts testing.
- Generated results disappear, so there is nothing to analyze after several runs.

## 2. Objectives

1. **The owner's account is the primary test dataset.** The owner has dogfooded
   Cadence for a long time and explicitly consents to using their data, including
   sending it to the model, for this evaluation. Synthetic scenarios remain for
   edge cases on a secondary tab.
2. **Pick any past day (or a range) and see the analysis as it was that morning.**
3. **One button generates a tip for every lane** that has a finding on the chosen day.
4. **Ergonomic layout:** a clear data → recipe → analysis → generate → results →
   review flow, with advanced controls collapsed.
5. **Saved runs** with their settings, stored compactly, so the owner can analyze
   results after several sessions.
6. **Product behavior (separate slice):** the user sees the day's brief as soon as
   they open the app, and can reopen it after dismissal without a new model run.

Success means the owner can choose a two-week range, see which lanes fire each
day without any model cost, generate all lane tips for a chosen day in one click,
rate them, and later export a summary of ratings by lane and configuration.

## 3. Owner decisions (September 27, 2026)

1. **Stored first brief of the day, 7:00 AM cutoff.** The user should see their
   advisor text as soon as they open the app. 7:00 AM local is the day's cutoff.
   After dismissal the user can surface the brief again; that shows the stored
   first run of the day, not a new generation. The bench's replay time defaults to
   the same 7:00 AM.
2. **Workbench model budget: 100 model calls per hour** while testing.
3. **Save runs alongside their settings** for later analysis, with storage that
   does not bloat project files.
4. **Replay reads Google Calendar for past dates.**

### Conflicts with current documentation (must be resolved in the same change)

Decision 1 changes shipped product behavior. `AGENTS.md` requires recording such
a change and updating the relevant docs in the same task:

- `docs/TICKETS.md` Ticket 168: "Keep fresh text in memory only" and "Do not reopen
  dismissed output." Ticket 173: "keep generated text and private source content
  out of storage."
- `docs/user-guide/timeline.md`: "Cadence stores no briefing history."
- `docs/qa/in-app-daily-brief.md`: "No prompt or generated text is persisted."
- Comments on the private tables in `supabase/migrations/20260921003952_…` and
  `20260926170000_…`: "No prompt or generated content is stored."
- The Settings disclosure (`components/briefing/DailyBriefSettingsPanel.tsx`) says
  nothing about storage today; it needs a new sentence.

Decision 3 also changes a workbench rule: Ticket 154 (`docs/TICKETS.md`, around
line 11226) says "Keep outputs and facts in memory. Persist/export only
configuration by default." Update that ticket's text and
`docs/qa/briefing-workbench.md` when the run store ships.

The new behavior needs: a server-stored generated brief per account and local
date, a visible Show today's brief control after dismissal, retention and deletion
rules, updated disclosure copy, and a `docs/DECISIONS.md` entry.

Confirmed by the owner on September 27, 2026: "7am cutoff" means the day's brief is
generated from the first opening at or after 7:00 AM local, then stored. Openings
before 7:00 AM show no automatic brief.

Pre-generation at 7:00 AM by a server job (so even the first opening is instant)
is **not** in scope. Every advisor read requires the user's own current session
(`cadence_advisor_private.current_daily_brief_user()` checks `auth.sessions`);
the Vercel crons (`vercel.json`) run without a user session. Pre-generation would
need a new privileged read path and its own security review. Record it as a
follow-up option.

## 4. Current system (verified September 27, 2026)

### Workbench

- Page: `/design-system?preview=briefing-workbench`, rendered by
  `app/design-system/DailyBriefBench.tsx` (`DailyBriefWorkbench`, ~270 lines) with
  `BriefingWorkbenchGuide.tsx` (glossary and document viewer). The design-system
  page (`app/design-system/page.tsx`, ~2,950 lines) also renders
  `DailyBriefBubbleBench` and `DailyBriefSettingsBench` as catalog previews.
- API: `app/api/dev/briefing-comparison/route.ts` → `lib/services/briefing-workbench.service.ts`.
  `GET` returns account settings and Behavior labels; `POST` runs exactly two
  configurations sequentially.
- Guard: `NODE_ENV === "development"`, loopback host, port 4321–4330,
  `sec-fetch-site: same-origin`, same-origin POST with JSON content type.
- Limits (process-local, in `briefing-workbench.service.ts`): one comparison in
  flight, six starts per hour, 60 s total, 25 s per model call.
- Modes: Synthetic (`lib/services/briefing-fixtures.ts`, 13 day fixtures, plus
  `lib/services/briefing-analysis-fixtures.ts`, 14 analysis scenarios) and
  My account (`prepareAccountBriefingContexts` in
  `lib/services/briefing-account-context.service.ts`).
- Results are memory-only; account mode clears private results on hide, pagehide,
  account or consent changes. Save/export exist only for configurations, not runs.
- The Analysis summary (`AnalysisSummary` in `DailyBriefBench.tsx`) lists lane
  states and every `selectBriefingTip` decision keyed by opaque finding IDs.

### Data reads that constrain replay

- `read_advisor_cadence_snapshot` / `read_advisor_cadence_revision`
  (`supabase/migrations/20260919010100_…`, payload redefined in
  `20260922034223_…`) require `target_local_date` = today in the owner's timezone
  and `history_start = target − 90`.
- `read_advisor_analysis_snapshot` (`20260926170000_…`) has the same date rule.
- `getCalendarEventsForAdvisor` and `getCalendarEvents`
  (`lib/services/google-calendar.service.ts`, around line 150) reject any start
  date other than today (`Temporal.PlainDate.compare(first, today) !== 0`).
  The Timeline's live Calendar also goes through this path. Past-date Calendar
  reads are therefore new connector capability.
- Status history: `occurrence_status_events` (explicit marks, corrections with
  `revises_event_id`, `recorded_at`). Current status snapshot: `occurrences.status`
  and `status_marked_at`. Configuration history: `behavior_configuration_events`.
- Travel evidence exists only for the current day; it cannot be replayed.

### Analysis and generation pipeline

- Lanes: `packages/core/src/resolvers/briefing-analysis.resolver.ts`
  (`resolveBriefingAnalysis`, `selectBriefingTip`, `BRIEFING_ANALYSIS_LANES`),
  paired with `tests/briefing-analysis.resolver.test.ts`.
- Pipeline: `lib/services/briefing-pipeline.ts` (`prepareBriefing`, analysis input,
  one selected tip). Consumer: `lib/services/daily-brief-consumer.ts` (prompt,
  `clock.labels`, tip validation). Model adapter: `lib/services/daily-brief-openai.ts`
  (`gpt-5.6-luna`, strict JSON schema).
- Configuration 1.3 (`packages/core/src/services/briefing-config.ts`) with the
  `analysis` block; presets in `packages/core/src/data/briefing-presets.json`
  (`cadence-default` has no lanes; `advisor-analysis` is the candidate).

### In-app delivery (for Phase 6)

- Launcher and page-session memory: `components/briefing/DailyBriefLauncher.tsx`,
  `lib/ui/daily-brief-session.ts`, `lib/ui/daily-brief.ts` (markers, deadlines).
- Server: `lib/services/daily-brief.service.ts`, `lib/db/daily-brief.repo.ts`,
  admission RPCs `begin_daily_brief` / `finish_daily_brief`
  (`20260921003952_…`, `20260926150000_…`: one automatic start plus three retries
  per installation, day and disclosure revision).

### Gates the change must keep passing

- Required commands (`AGENTS.md`): `agents:check`, `interactions:check`,
  `resolvers:check`, `lint`, `typecheck`, `test`, `build`; plus `core:check`,
  `design-system:check`, desktop typecheck/build for shared UI.
- `tests/briefing-ontology.test.ts` requires glossary terms in
  `docs/ontology/briefing-workbench.json` for configuration leaves and fixtures.
- `interaction-registry.json` tracks interaction marker counts per source file;
  `DailyBriefBench.tsx` is an `excluded` development-only entry whose count and
  reason must be updated when controls change.
- Local tooling: the project-local Supabase binary is killed on this Mac; use
  `/opt/homebrew/bin/supabase`. Auto mode denies `gh pr merge` and hosted
  `supabase db push`; hand those to the owner.

## 5. Findings from the owner's September 27 run

The owner ran My account, Cadence default against Advisor analysis
(Snapshot 2026-09-27T21:20Z). Fix these in Phase 0:

1. **Midnight range bug (wrong tip).** Teeth Whitening was "Completed usually
   marked around 11:24 PM for a 6:00 PM–12:00 AM slot" and flagged `mark:later`.
   11:24 PM is inside the range. `realisticTiming` computes `minutes("00:00") = 0`,
   so any range ending at midnight has `end < start` and every mark looks late.
   The advice "try it toward the later part of that window" follows from the bug.
   Treat an end at or before the start as the next day (add 1,440 minutes) and
   check overnight ranges such as 10:00 PM–2:00 AM. Audit other `endTime` uses
   (planner reserved ranges, `describeBriefingFinding`) for the same assumption.
2. **Tip repeated in the main text.** The main text restated the tip almost
   verbatim. Add a prompt rule and a validator: when the main text shares an
   eight-word phrase with the tip, drop the tip (keep the main text).
3. **Mechanics in prose.** "No schedule issue is flagged by today's planner."
   Add "planner" to the forbidden-mechanics instruction and flag it in the bench.
4. **Unreadable selection list.** Show Behavior titles (the account GET already
   returns labels; map finding `behaviorRef` through `configurationRefs`), group
   by lane, show the selected tip first, and collapse the rest.

The other lanes that fired (weekday dip, logging chronology, Note themes) were not
reviewed; the executing agent should not assume their wording quality.

## 6. Target design

### 6.1 Replay service (new, development-only)

Purpose: reconstruct a past local day "as of" a replay time, so every lane and the
planner see what they would have seen that morning.

- **Scope:** owner only, loopback workbench only, read-only. Target dates from
  yesterday back 89 days (history for the oldest target still needs 90 prior days;
  cap the range where the source is incomplete and label it).
- **Replay instant:** default 7:00 AM local on the target date (owner decision 1),
  adjustable per run.
- **Statuses as of the replay instant:** rebuild each occurrence's status from
  `occurrence_status_events` recorded before the instant, following revision chains.
  For occurrences without events (legacy/imported), use `status_marked_at` < instant
  → current status, else Unresolved. Label that fallback in the inspector.
- **History as of the replay instant:** the 90 local days before the target, using
  statuses and corrections recorded before the instant. A later correction must not
  leak into an earlier day. Optional sources follow the same rule and the same
  disclosures.
- **Configuration and durations as of the target:** occurrences already carry their
  schedule snapshot; duration estimates use only history before the target.
- **Calendar:** read the target date through the connector (owner decision 4). This
  needs a new past-date path in `google-calendar.service.ts`, bounded to one day per
  call and to the replay range, preserving selected calendars, connection generation
  and revision fences. Confirm the Google verification disclosure
  (`docs/qa/google-calendar-capabilities.md`, Tickets 138–141) covers reading past
  events for the owner's own evaluation; if unclear, ask before enabling.
- **Travel:** excluded, with a visible label.
- **Implementation shape:** add owner-scoped replay RPCs (private definer plus public
  invoker, like `read_advisor_analysis_snapshot`) that accept a past target date and
  replay instant and return the same payload shapes, so
  `projectAdvisorCadenceSource`, `projectBriefingAnalysisSource` and the pipeline are
  reused unchanged. Put status reconstruction in a pure core function with paired
  tests, not in SQL, if the SQL gets complex.
- Replay snapshots are frozen: no revision fence against live data (they are
  historical), but each run records the source revision it read.

### 6.2 Day-range analysis (no model calls)

- New `POST /api/dev/briefing-analysis`: `{ startLocalDate, endLocalDate,
  replayTime, config }` → per day: lane results, findings (with Behavior titles),
  planner day evidence summary, and the tip that `selectBriefingTip` would choose,
  simulating cooldown and spacing across the range in memory.
- Range up to 90 days; compute sequentially with a per-request deadline; stream or
  paginate if needed. No model calls, so it does not count against the budget.

### 6.3 Generation

- **Generate all lane tips (one day):** for each lane with a finding on the chosen
  day, run the production prompt with that lane's top finding offered as the tip.
  At most one call per lane (at most 8). Show results as they arrive.
- **Compare configurations (one day):** today's two-column comparison, for the
  chosen day.
- **Budget:** 100 model calls per rolling hour (owner decision 2), visible counter,
  cancellation, at most two concurrent calls, 25 s per call. Keep the loopback guard.
- Workbench generations never read or write production tip history or admissions.

### 6.4 Run store (owner decision 3)

- **Location:** `.local/briefing-bench/` in the repository root, added to
  `.gitignore`, overridable with `CADENCE_BENCH_DIR`. Add an `agents:check` rule
  that fails if anything under `.local/` is tracked. The data is private.
- **Format:** append-only JSON Lines, gzip-rotated monthly:
  - `configs.jsonl` — each configuration stored once, keyed by its
    `briefingConfigurationRevision` hash (runs reference the hash).
  - `runs-YYYY-MM.jsonl(.gz)` — one line per generated result: run ID, timestamp,
    mode, target date, replay time, config hash, versions (pipeline, policy,
    planner, analysis, model), lane, compact finding (counts, rates, key, band,
    limitations; no evidence refs), model output (text, tip, suggestions),
    validation result, latency, warnings flags, and later ratings.
  - `ratings.jsonl` — rating events (`useful` / `not_useful` / `wrong`, reason),
    keyed by run ID, so ratings never rewrite run files.
- **Size:** no inspectors, snapshots or prompts stored; findings stored compactly.
  Expect about 1–3 KB per result before compression. Rotate and gzip closed months;
  warn above 50 MB.
- **Analysis:** `npm run bench:report` summarizes ratings by lane, configuration and
  flag, and writes a Markdown summary to stdout. It never uploads anything.
- **Writes:** only the loopback dev route writes, only after a successful run.

### 6.5 Bench layout

Move the workbench to its own development route, `/design-system/briefing`
(keep `?preview=briefing-workbench` as a redirect). Split
`DailyBriefBench.tsx` into focused components under `app/design-system/briefing/`:

1. **Data** — My account (default) or Synthetic; single day or range; replay time.
2. **Recipe** — Configuration A and B pickers (presets first); advanced editors
   collapsed per configuration; JSON import/export in a drawer.
3. **Analysis** — day × lane grid. Each cell: finding / no finding / unavailable
   with reason, Behavior title and strength. A marker shows the day's selected tip.
   Clicking a cell opens its evidence (counts, window, limitations, evidence line).
4. **Generate** — "Generate all lane tips" and "Compare configurations" for the
   selected day; live budget counter; cancel.
5. **Results** — one card per day × lane × configuration: bubble, evidence line,
   automatic flags (repeated tip, mechanics words, UTC-looking times, over budget),
   collapsed inspector.
6. **Review** — rating buttons and reason per card; per-lane summary; link to saved
   runs.

The catalog keeps only `module.daily-brief-bubble` and
`module.daily-brief-settings-panel` previews. The glossary moves into a side panel.
Bench chrome keeps the existing neutral system-font style.

### 6.6 Stored daily brief and reopen (product, owner decision 1)

- **Server storage:** a private, owner-scoped table (for example
  `cadence_advisor_private.daily_brief_deliveries`) holding one generated brief per
  account and local date: text, tip, suggestions, references, versions, generated
  and expiry times, disclosure revision and source revisions. No prompt.
- **First run:** the first opening at or after 7:00 AM local generates (existing
  admission) and stores it atomically with `finish_daily_brief` success.
- **Later openings, other devices and reopen:** fetch the stored brief; no model
  call. Add a quiet **Show today's brief** control near the horse after dismissal.
  Dismissal stays per installation; the stored brief is account-wide.
- **Staleness:** a stored brief always shows "Prepared at …". If Timeline facts or
  timing changed since, keep the text visible with a plain notice and the existing
  bounded Refresh (which does re-run). Expired timing claims remain labeled.
- **Retention:** delete at the next local day's first run, and on disable, disclosure
  revision change and account deletion. Keep at most two days as a hard bound.
- **Ticket 168 interplay:** undelivered or interrupted attempts now recover by
  fetching the stored brief instead of regenerating; retries remain for failures.
- **Docs and copy:** update the conflicts listed in §3, the Settings disclosure,
  data model, retention, interaction registry (`INT-BRIEF-001/002/003` plus a new
  reopen intent), user guide and QA record.

## 7. Phases

Each phase is one ticket. File them as Tickets 175–181 in `docs/TICKETS.md` with the
required web / desktop / marketing / future-mobile impact table, and update
`STATUS.md` as each starts and finishes. Begin each code slice with a failing
regression or evidence fixture, per the shared verification rules above Ticket 168.

| Phase | Ticket | Scope | Depends on |
|---|---|---|---|
| 0 | 175 | Fix §5 findings 1–4 | #82, #83 merged |
| 1 | 176 | Replay service (§6.1) without Calendar | 175 |
| 2 | 177 | Past-date Calendar read for replay (§6.1) | 176; Google-use confirmation |
| 3 | 178 | Day-range analysis endpoint and grid (§6.2, §6.5 part 3) | 176 |
| 4 | 179 | Generation modes, 100-call budget, run store and report (§6.3, §6.4) | 178 |
| 5 | 180 | Bench route split and layout (§6.5), glossary and catalog updates | 179 |
| 6 | 181 | Stored daily brief and reopen (§6.6) | 175 |

Phase 6 is independent of the bench and can run in parallel after Phase 0.

### Platform impact (use in each ticket)

- **Web:** Phases 0 and 6 change user-facing behavior; Phases 1–5 are
  development-only (loopback workbench).
- **Desktop:** Phase 0 (shared prompt/resolver) and Phase 6 (shared launcher and
  bubble) reach desktop through the hosted server and a new desktop build; the
  workbench is not a desktop surface.
- **Marketing:** not applicable; no public claim changes.
- **Future mobile:** mobile web receives Phase 6 through the shared launcher; native
  remains deferred.

### Verification per phase

- 175: resolver tests for midnight and overnight ranges; consumer tests for the
  repeated-tip and mechanics rules; DOM test for the grouped, titled summary.
- 176: pure status-reconstruction tests (marks, corrections, late corrections after
  the replay instant, legacy rows); owner-isolation SQL smoke in a port-less local
  container (as in `docs/qa/in-app-daily-brief.md`); replay of today equals the live
  snapshot for the same instant.
- 177: connector tests for past-date bounds, selection and generation fences.
- 178: endpoint tests for range bounds and deadline; cooldown simulation matches
  `selectBriefingTip` day by day.
- 179: budget accounting, cancellation, run-store round trip, gzip rotation,
  `.local/` tracked-file guard, report output on fixture data.
- 180: design-system and interaction checks; desktop-width and 390px browser QA on
  `127.0.0.1:4321`; keyboard access and 44px targets.
- 181: migration with RLS and retention, service tests for stored fetch versus
  generation, lifecycle DOM tests for reopen, multi-device, staleness and disable;
  hosted migration by the owner.

## 8. Non-goals and constraints

- No production exposure of replay, run storage or the 100-call budget; all stay
  behind the development guard.
- No change to the production default preset; promotion stays a reviewed change.
- No travel replay; no travel data to the model.
- No new connector, second model provider or agent framework.
- Workbench runs never consume production admissions or tip history.
- Keep resolver-first ownership: calculations in `packages/core`, reads in `lib/db`,
  composition in `lib/services`; no rates or intervals computed in components.

## 9. Risks and open questions

- **Past Calendar reads and Google verification (Phase 2):** confirm allowed use
  before enabling.
- **Reconstruction accuracy:** legacy occurrences without status events can only use
  `status_marked_at`; label those days in the grid.
- **Range cost:** a 90-day range runs 90 snapshot reconstructions; measure and cap.
- **Stored briefs hold generated personal text:** Phase 6 needs a disclosure update
  and a retention test; it reverses a documented privacy statement.
- **Pre-generation** at 7:00 AM stays a follow-up requiring a privileged-path review.
