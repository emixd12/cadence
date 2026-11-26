# Alongside local-stack acceptance: Ticket 365, local part (November 25–26, 2026)

The local-stack part of Ticket 365 for D33 (`docs/DECISIONS.md`, 2026-11-25, "Alongside
Behaviors and the guessed Where (D33)"), Tickets 356–364. An agent ran it on a local
Supabase stack and a local `next dev`. It does not complete Ticket 365: hosted Preview
acceptance as test account A, installed Mac acceptance and MCP client (Tier 1)
acceptance are still owed.

Evidence classes stay separate. "Observed" means the agent saw it in the database, an
app route's response or the rendered page. "Inferred" means it was read from code or
from automated tests, not watched live.

## Environment

| Item | Value |
|---|---|
| Commit | `9cb59aa9` on `feat/alongside-365` (main plus Tickets 356–364) |
| Node | 24.22.2 |
| Supabase | CLI 2.105.0 (Go backend), project `habit-tracking-app`, started through `scripts/supabase-docker-proxy.mjs` on network `cadence-local`, every published port on `127.0.0.1`. `db reset` applied all 165 migrations through `20261126220000` (exit 0). A temporary workdir copy enabled `signing_keys_path` with a fresh ES256 key, as `docs/SUPABASE_WORKFLOW.md` describes, so agent tokens (Daily Brief, coach) work. API port 55341: Docker refused 55321 as "address already in use" although nothing listened. |
| App | `next dev --port 3100 -H localhost`, `CADENCE_ENABLE_TEST_LOGIN=1`, local keys only, no `.env.local` |
| Flag | `CADENCE_ALONGSIDE=on` for the main run; unset for the flag-off run |
| Model | No provider. `OPENAI_BASE_URL` pointed at a loopback stub (127.0.0.1:55399) that answered every call with 503 and logged only the path and schema name. The stub logged 2 `cadence_daily_brief_opening` calls, 1 `cadence_duration_estimates_v1_3` call and the coach tip calls; all were refused, so the brief used Cadence's stock text. No call left the machine. |
| Email and push | `CADENCE_DISABLE_EMAIL_SENDS=1`, `CADENCE_DISABLE_BROWSER_PUSH_SENDS=1`, reminder and leave-reminder batches disabled |
| Account | Temporary test-login users (`cadence-test-*@example.invalid`). The main account's timezone was set in the database to Australia/Brisbane so that "today" was late morning (local date 2026-11-26) |
| Browser | Headless Chrome via `playwright-core`, fresh context, 1280 × 900 and 390 × 844 |

Before the run, a `habit-tracking-app` stack was already up on a different network, with
the database and gateway bound to `0.0.0.0`. It held no users or Behaviors. The agent
stopped it and replaced it with the loopback-only stack above. During the run, at
01:43 UTC, some other host process connected as `postgres` and ran SQL that created
`cadence_private.period_input_error` and then raised "Period writes were not recorded as
activity with their target". The agent did not run that SQL, and the migration count was
unchanged afterwards.

## Seeding

These steps changed state directly, outside the product:

- `behavior_advisor_estimates` rows with the recipe-1.3 hash
  (`behaviorEstimateInputHash(..., { whereAsked: true })`, reimplemented in a scratch
  script). The hash was correct: the brief's estimate step asked the model only for the
  one Behavior that had no seeded row.
- `profiles.timezone` (Brisbane; briefly Asia/Dubai during the coach job, see case 7).
- `cadence_advisor_private.daily_brief_days.refreshes_used` reset to 0, twice, to get more
  same-day refreshes.
- One `brief_alongside_asks.local_date` moved back a day, to simulate yesterday's ask.
- Eight `move_proposals` rows (status `accepted`, reason `alongside_pairing`, line marked
  `acceptance_seed`) as four-day pairing evidence.
- `agent_runs.local_date` of the day's scheduled coach runs moved back a day, so the
  hourly job would visit again.

Behaviors, answers, marks, moves, brief answers, Completion places, the schedule-proposal
answers, exports, the import and the restore all went through the app's own UI or
routes.

## Results

| # | Case | Result | Observation |
|---|---|---|---|
| 1 | Flag off: nothing new shows, edits work | **Pass**, with defect D1 | Observed. Behavior form has no alongside field. Timeline has no label. The reopened brief has no question line. Editing Red light helmet's length and creating "Flag off check" both saved; the stored `alongside = true` was kept. The dev log has no failed request. Exports drop the field from Behaviors but not from configuration history (D1). |
| 2 | Setting Yes, No, Not answered | **Pass** | Observed on Vitamin pill. `behaviors.alongside` read `true`, `false`, then `null`. Each save wrote one `revision` event with `changed_fields = {alongside}`, `behavior_edited`, `manual`, and the previous and next values. A second round wrote 3 more (6 alongside revisions in total). The Timeline showed "Alongside" on each of the 8 visible days for Yes and on none for No or Not answered. |
| 3 | Guess: form line, Use the guess, Timeline label, guessed Where | **Pass** | Observed. Red light helmet (unanswered, guess yes) showed "Cadence guesses Yes. Planning uses the guess until you choose." with Use the guess (`data-alongside-question="open"`). The Timeline showed "Alongside · a guess". Stretching (Where Not set, guess `home`) showed "Cadence guesses this happens at Home. Planning uses the guess until Where is set." with Review Where and Dismiss only after Completion places was turned on (absent while off, as Ticket 358 says). After an answer from the brief (helmet) or from Use the guess plus Save (Stretching): the label read "Alongside" (`data-alongside="person"`), the form's guess line was gone, and the brief no longer asked. Not run: Dismiss leaving planning unchanged. |
| 4 | Same-place rule | **Pass** (travel not run) | Observed through Timeline "Move for today". Red light helmet (alongside, Home, 10 min) moved onto Reading (Home): allowed. Onto Vitamin pill (Anywhere): allowed. Onto Call mom (no Where, no guess): allowed. Onto Gym session (A place, Riverside Gym): refused, "Something else is already at that time." A control item that is not alongside (Vitamin pill) moved onto Reading was refused. Every allowed move was undone. The brief's planner did the same: it proposed moving Gym because it overlapped Stretching (guessed Home), and it never flagged helmet over Reading. Travel refusal not run (see "Not exercised"). |
| 5 | Timeline row question after Completed | **Pass** | Observed. Journal's occurrence (`markDetailPromptPicked` = 0.383 < 0.5, question open) showed "Done alongside other things? Yes · No" after Completed. No wrote `false` and read back "Saved: it needs its own time." Stretching's occurrence (0.998, not picked) showed no line. Morning pill, marked 3 hours late (alongside pick 0.163), showed "Done at 8:00 AM · Just now · Other time" and no alongside line, so `done_at` kept priority. Surfaces closing each other: brief answer closed the form and Timeline; row answer closed the form, and later briefs did not ask about Journal; form answer closed the Timeline label and brief. |
| 6 | Daily Brief question, pairing and route refusal | **Pass** (words not run) | Observed. Each brief showed at most one question ("Can Red light helmet be done alongside other things?"). Yes wrote `true` and one `alongside` revision, read back "Saved: it can be done alongside other things.", and the reopened brief had no question. `brief_alongside_asks` recorded the first ask per Behavior. With Morning pill's ask moved to the day before, the next refresh asked nothing. A guest that overlapped Gym after Gym's line was declined produced "Podcast 4:20 PM → 2:00 PM: Do Podcast during Reading at 2:00 PM." (`reason = alongside_pairing`, `line.pairing.needs = ["conflict"]`). Yes applied an ordinary move (`occurrence_moves.source = daily_brief`, reason `alongside_pairing`, no link column). Moving the host Reading afterwards left Podcast where it was. Undo restored Podcast (`undone`). Other time offered "11:45 AM · 5:10 PM"; choosing 5:10 PM moved it (`other_time`). No declined the line with no move. With the flag off, `POST /api/advisor/brief/alongside` returned 400 `invalid_request` and the setting was unchanged. The model-written words were not exercised: the stub refused, so the stock text showed. |
| 7 | Coach schedule pairing | **Pass** (job run with seeded evidence) | Observed. With no evidence, `GET /api/advisor/coach/schedule-proposal` returned `{"kind":"none"}`. After four seeded accepted pairing lines (Podcast during Reading, Nov 22–25), `GET /api/advisor/coach/signals/process` (local `CRON_SECRET`, profile briefly in Asia/Dubai at 05:14 local, same local date) stored one proposal: "Change your schedule: Podcast at 2:00 PM every day…", reason "You said Yes to Podcast during Reading on 4 days in the last 28.", `pairing.hostTitle = Reading`. `for_good` applied it: schedule `start_time` changed from 16:20 to 14:00 through one `{schedule_graph}` configuration revision. A second pair (Audiobook) proposed after another job visit, answered `no`: status `declined`, no revision. A third job visit, with the evidence still there, proposed nothing. The `done_together` signal path was not produced. |
| 8 | Exports, import, restore, MCP | **Pass** for the current value; **Fail** for configuration history (D1) | Observed with the flag on. Full JSON `behaviors[].alongside` and JSONL carried `true`, `false` and `null`. CSV had an `alongside` column. BehaviorLog carried it in `extensions["app.cadence"].alongside`. No file contained "guess" or estimate data. A create-only import into a fresh account, and a restore after clearing the values, both reproduced every answer. With the flag off, Behaviors and the CSV omit the field, but configuration history still names it (D1). MCP local Tier 0 (`local-stack.mjs`): with the flag on, the suite took the contract 1.8.0 branch and passed 119/119. `update_behavior` with `alongside: true` saved, read back, and wrote one `{alongside}` revision (`behavior_edited`, `manual`). With the flag off it took the 1.7.0 branch and passed 115/115 (`alongside-absent-before-1.8.0`). The first two flag-on runs failed before any alongside check (observation O3). |
| 9 | `GET /api/behaviors/alongside` | **Pass** | Observed. With the flag off: `200 {"enabled":false,"guesses":[]}`. With it on: `enabled: true` and one entry per Behavior of the signed-in account (6 of 6; the import account's Behaviors never appeared), with `whereGuess: "home"` for Stretching. Observation O1: answered Behaviors still return their stale model guess. |
| 10 | Phone width and accessibility | **Pass**, minor notes | Observed at 390 × 844. No horizontal scroll on Behaviors or Timeline (`scrollWidth` 390). The select's name comes from its wrapping label, "Can be done alongside other things". Tab from Where reaches the select next, then Use the guess, which shows a 2 px solid focus outline. Enter on Use the guess set the select to Yes. Use the guess is 44 px tall. The row question fits and works at 390 px. Note O2: the select is 24 px tall, and the row question's Yes and No are inline text links of about 20 px. |

Supporting automated runs, against the same stack:

- `npx vitest run` on the 23 `tests/*alongside*` files: 235 passed.
- `tests/occurrence-move.local-integration.test.ts`, flag on: 4 passed.
- `tests/brief-moves.local-integration.test.ts` and
  `tests/integration-write.local-integration.test.ts`, flag off: 3 and 34 passed. With
  `CADENCE_ALONGSIDE=on` they fail (1 and 8 tests). See observation O4.

## Defects

### D1. Exported configuration history names `alongside` but never carries its value (fixed)

- **What the agent did.** Changed Vitamin pill's answer three times, created Behaviors with
  the flag on and off, then downloaded Full JSON and BehaviorLog with the flag on and again
  with it off.
- **What happened.** The database's configuration events carry the value: the previous
  snapshot has `alongside: null` and the next has `true`. Full JSON and the BehaviorLog
  `raw/cadence/behavior_configuration_events.jsonl` drop `alongside` from every snapshot,
  with the flag on or off. They keep `"alongside"` in `changed_fields`. Each alongside-only
  revision therefore exports with identical previous and next snapshots, 10 of them in this
  account. The database itself forbids that: `behavior_configuration_events_snapshot_shape_check`
  requires `previous_configuration IS DISTINCT FROM next_configuration`. With the flag off,
  every baseline event, including one for a Behavior created with the flag off, still lists
  `alongside` in `changed_fields`. The BehaviorLog standard file also says "The source
  revision changed alongside".
- **What should have happened.** D33 says the setting "is part of the Behavior
  configuration, account sync, export and the MCP contract". `docs/OPERATIONS.md`,
  "Alongside setting operation", says that with the flag off exports serve "the pre-364
  export bytes". At least one of these must change: carry `alongside` in exported
  snapshots, or leave it out of `changed_fields` and the history notes as well, especially
  with the flag off. Otherwise update the docs to describe the bytes as they are.
- **Where.** `packages/core/src/resolvers/export.resolver.ts`, function
  `toJsonBehaviorConfigurationSnapshot`: it has no `alongside` mapping, while
  `changed_fields` passes through unchanged. The BehaviorLog configuration-history
  projection in the same resolver has the same gap.
- **Effect seen.** Restoring the account's own flag-on or flag-off bundle into the same
  account still succeeded, so restore tolerates these records.
- **Status: fixed** on branch `feat/alongside-history-fix` (November 26, 2026), commits
  `0e467bf5` (planner), `9fb24ba3` (database) and `aec66691` (export). A re-check against
  the local database found the second half worse than an export defect: every baseline,
  including a flag-off one, listed `alongside` and every snapshot carried
  `"alongside": null`, and contract 8 and 9 projections passed those events unchanged, so
  a released Mac would have failed its export after the next Behavior was created. Now an
  unanswered Behavior's history names the answer nowhere, flag on or off; an answer
  change carries it in both snapshots and in every export with the flag on; with the flag
  off exports name it nowhere and leave out answer-only revisions; and migration
  `20261126260000` hides the answer's history from contracts 8 and 9. Tests:
  `tests/alongside-history.local-integration.test.ts`,
  `tests/sql/behavior-alongside-smoke.sql` and
  `tests/export-import-restore-alongside.test.ts`.

## Observations (not judged defects)

- **O1.** `GET /api/behaviors/alongside` returns the cached model guess for Behaviors the
  person has already answered: Red light helmet showed `alongside: true` from the estimate
  after the answer. Every reader puts the person's answer first, so nothing showed wrongly.
  The route still sends a guess the person has overridden. `currentEstimate` in
  `lib/services/brief-move-day.service.ts` returns the 1.3 row whatever the answer.
- **O2.** Small targets. The alongside select is 24 px tall, the same as the form's other
  selects. The row question's Yes and No are inline text links, the same pattern as the
  existing "Done at" line. Neither blocks keyboard use.
- **O3.** MCP local Tier 0 with the flag on failed twice with `redirect-timeout` at OAuth
  consent before any alongside check. The app log showed about 1,000 repeated
  `GET /oauth/consent` requests for one request id. The third run on a fresh stack passed
  119/119. Not root-caused; the first failing log was deleted with its stack. Treat it as
  an unexplained flake to recheck during MCP acceptance.
- **O4.** The local integration suites assume the flag is off.
  `integration-write.local-integration.test.ts` validates outputs with the default 1.7.0
  registry. `brief-moves.local-integration.test.ts` fakes a recipe-1.2 estimate without
  `whereGuess`, and recipe 1.3 then caches nothing. These are test assumptions, not
  product failures (Tier 0 with the flag on passed). No database-backed suite runs with
  `CADENCE_ALONGSIDE=on`.
- **O5.** Probably not related to this feature. A BehaviorLog restore into an account that
  had already imported an earlier bundle from the same source failed with the generic "BehaviorLog restore could not be
  completed." The database logged `duplicate key value violates unique constraint
  "imported_interventions_pkey"`. It failed the same way with the flag on and off.
  `errorMessage` in `lib/services/behaviorlog-restore.service.ts` hides the database error,
  because PostgREST errors are not `Error` instances.

## Not exercised, and why

- **Travel refusal (case 4).** No travel provider or signed travel conclusions locally,
  so no travel span reached the free-slot rule. Inferred from
  `tests/alongside-overlap.resolver.test.ts` only.
- **Model-written brief words, Chat question and Chat pairing.** Not run: needs a model.
  Chat has no fixture transport, and the stub refuses every call.
- **`done_together` signal evidence (case 7).** It needs weeks of completions that the
  coach signal job would count. Only the four-accepted-lines path ran.
- **Dismissing the guessed Where while planning keeps the guess.** Not run.
- **Mac.** Only the hosted route (case 9) ran. No app was built or driven.
- **MCP Tier 1 clients and the plugin skill text.** Not run: the clients use paid models.
- **Hosted Preview, test account A, installed Mac.** Outside this local part.

## Commands

```bash
# Worktree: .claude/worktrees/alongside-365; Node 24 first on PATH.
npm ci
# Loopback stack through the Docker proxy, with signing_keys_path enabled in a temp workdir copy
node scripts/supabase-docker-proxy.mjs "$SOCK" "${DOCKER_DAEMON#unix://}" &
npm run supabase -- start --workdir "$WORK" --network-id cadence-local \
  --exclude imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor
npm run supabase -- db reset --local --workdir "$WORK" --network-id cadence-local
node scripts/supabase-rehearsal-diagnostics.mjs integration-env status.env signing_keys.json int.env
# App, flag on, local model stub, test login
CADENCE_ALONGSIDE=on CADENCE_ENABLE_TEST_LOGIN=1 OPENAI_BASE_URL=http://127.0.0.1:55399/v1 \
  OPENAI_API_KEY=local-stub-not-a-key npx next dev --port 3100 -H localhost
# Coach job, local secret
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/advisor/coach/signals/process
# MCP local Tier 0, flag on and off
CADENCE_SUPABASE_CLI=<re-signed 2.105.0 copy> CADENCE_ALONGSIDE=on \
  node .claude/skills/mcp-acceptance/local-stack.mjs up --name cadence-accept-365 --db-base 56150 --app-port 4450
node .claude/skills/mcp-acceptance/local-stack.mjs tier0 --name cadence-accept-365
node .claude/skills/mcp-acceptance/local-stack.mjs check --name cadence-accept-365
node .claude/skills/mcp-acceptance/local-stack.mjs down --name cadence-accept-365
# Tests
npx vitest run tests/*alongside*.test.ts* tests/brief-move-day.alongside.test.ts
# Cleanup
CADENCE_TEST_LOGIN_MAX_AGE_HOURS=0.01 npm run test-login:cleanup
npm run supabase -- stop --workdir "$WORK"
```

Headless Chrome scripts (sign-in through `/auth/test-login`, form edits, Timeline marks,
moves, brief answers, exports, import and restore) and the model stub lived in the
session scratchpad and are not committed.

MCP run IDs: `local-365-t0-1126t013241` and `local-365-t0-1126t013351` (failed, O3),
`local-365-t0-1126t013546` (flag on, PASS 119/119) and `local-365-t0-1126t013648`
(flag off, PASS 115/115). Ledgers are under the ignored `.intent/acceptance/`. The stack's
`check` reported "0 active of 6 grants, 0 active token families · all revoked" before
`down`.

## Cleanup

`test-login:cleanup` deleted the 3 temporary users. Afterwards `auth.users`, `behaviors`
and `daily_brief_days` held 0 rows. The integration tests deleted their own users. The
dev server, the model stub, the MCP stack and the Docker proxy were stopped. The
`habit-tracking-app` containers were stopped with volumes kept. The temporary signing key,
the local `CRON_SECRET` and the environment files were deleted.

## Screenshots

In `docs/qa/2026-11-26-alongside-local-acceptance/` (synthetic data only):
`case3-form-stretching-labels-on.png`, `case4-helmet-vs-gym.png`,
`case5-journal-row-question.png`, `case5-doneat-priority.png`, `case6-brief-open.png`,
`case6-pairing-line.png`, `case10-row-question-phone.png`,
`case10-use-guess-focus-phone.png`.
