# Implementation Status

## How to use this file

This file holds current state: the open-work table and the newest dated entries.
History lives in `docs/status/archive/`, one file per month, moved there unchanged.
`docs/status/README.md` maps each ticket number to its archive file and heading.
Search the archive with grep for older facts; do not read it in full.
`npm run agents:check` fails when this file is larger than 40,000 bytes.

## Update rules

Update this file whenever a ticket starts, completes, becomes blocked, is reopened, or materially changes scope.

Use these status values:

- `not_started`: No implementation work has begun.
- `in_progress`: Work has begun but is not complete or verified.
- `blocked`: Work cannot continue until a specific dependency or decision is resolved.
- `complete`: Acceptance criteria are satisfied and required verification has run, or unavailable commands are explicitly noted.
- `deferred`: Work is intentionally postponed and should not be implemented in v1 unless the docs change.

When updating a ticket row:

1. Keep the ticket scope anchored to `docs/TICKETS.md`.
2. Record key files changed, not every trivial file.
3. Record verification commands with pass/fail status.
4. Record blockers and follow-ups as concrete next actions.
5. Do not mark a ticket `complete` if `npm run lint`, `npm run typecheck`, `npm run test`, or `npm run build` failed or could not be run without explanation.
6. Do not use this file to expand v1 scope. Put future ideas in `docs/FUTURE_UPDATES.md` unless a user explicitly moves them into scope.

Recent entries and the archive:

- Add each new dated entry at the top of "Recent entries", newest first, with the date in its heading (`## <title> — <Month D, YYYY>`).
- When `npm run agents:check` reports that this file is too large, run `npm run status:archive`. It moves the oldest entries, unchanged, into `docs/status/archive/` and regenerates the index.
- Never delete history. Do not edit or reword archived entries.

## Open work

Sources: `docs/TICKETS.md` `Status:` lines for tickets that are not complete, and dated entries
from October 18, 2026 onward (in "Recent entries" below or in `docs/status/archive/`). "TICKETS"
means `docs/TICKETS.md`; "STATUS" means a dated entry, found here or through
`docs/status/README.md`. Where an entry and `git log` disagree, the row says so. Older
owner-gated items are grouped into one row per area (marked "grouped").

Compiled November 9, 2026. Check the cited entry before acting on a row.

| Ticket or area | State | Next action or blocker | Source |
| --- | --- | --- | --- |
| Tickets 301–309: Settings regroup and simplification | Merged to `main` November 11 as PR #205 (`6dd414f8`); all six hosted migrations pushed; Daily Brief grant retired | Owner deletes the vault item `google-calendar-agent-retire-secret`; installed Mac check (302); signed-in hosted check; hosted Home lookup within the travel spend cap; owner reads `docs/qa/2026-11-10-settings-wording.md` | TICKETS, Tickets 301–309; STATUS, "Tickets 301–309 hosted rollout — November 11, 2026" |
| Tickets 310–324: connector completion (D28) | 310, 312, 313 and 322 complete; 314–319 and 321 implemented in source, off behind `CADENCE_CONNECTOR_COMPLETION`; 311 blocked on owner steps; 320, 323 and 324 not started | Owner: the `hevy-test-account-a` vault item (Hevy Pro test account and API key); the service-account token is stored and the preflight's agent steps pass (November 11). Migration `20261110210000` approved November 10. Then Ticket 311, hosted pushes, a Mac build with Ticket 319 | TICKETS, Tickets 310–324; STATUS, "Tickets 312–322: connector completion implemented in source — November 10, 2026" |
| Ticket 292: day notes | Web, MCP (contract 1.1.0) and Mac app (local and sync contract 3) merged to `main` November 10, 2026; hosted migrations `20261110120000`, `20261110130000` and `20261110140000` applied November 10 with owner authorization | Day-note shortcuts, BehaviorLog restore/import, MCP `search`/`fetch`, installed Mac acceptance, live smoke of the Timeline control | TICKETS, Ticket 292; STATUS, "Branch consolidation into main — November 10, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294 complete; 295 spike in progress (mock mode); 296–300 not started; merged November 10, 2026 | Live spike run needs the owner's ChatGPT Plus or Pro sign-in | TICKETS, Tickets 294–300; STATUS, "Tickets 294 and 295: Daily Brief on the user's ChatGPT plan started — November 7, 2026" |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned | The owner compares candidates on the reserved cases and promotes or rejects one under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md` |
| Ticket 291: skill-rule acceptance scenarios | Unit-tested with fakes | First local-stack or live run with a real client | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "Skill-rule scenarios — Ticket 291" |
| Ticket 288: Daily Brief token usage | Recorded per call in the performance log and workbench runs | Measure with `CADENCE_PERF_LOG=1` and replace the assumed figures in `docs/COSTS.md` | TICKETS, Ticket 288 |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | Entry says "not pushed"; `git log` shows PR #198 merged | Not yet rechecked on an installed Mac | STATUS, "Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026" |
| Cadence for Mac 0.1.9 | Published November 7, 2026 | macOS 14 not tested; 0.1.8 users with an auto-archived Behavior must download 0.1.9 | STATUS, "Cadence for Mac 0.1.9 published — November 7, 2026" |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | TICKETS `Status:` lines say "on branch `us-work`, not merged or deployed"; entries record Waves 1–2 deployed and `git log` shows PRs #192–#196 merged | Reconcile the `Status:` lines; hosted migration state of Tickets 275–276: unclear — see source | TICKETS, Tickets 260–283; STATUS, "Travel advisory revamp Wave 1 deployed — November 5, 2026" and "Travel advisory revamp Wave 2 deployed — November 5, 2026" |
| Ticket 165: travel release acceptance | In progress | Denied state; installed Open Location Services and Check again; installed status-only permission regression. Directions matrix: web rows in Ticket 284, installed Mac row in Ticket 285 | TICKETS, Ticket 165; STATUS, Ticket 284 and Ticket 285 entries (November 6–7) |
| Ticket 187: agentic Calendar access | Live since October 24, 2026 | Google sensitive-scope verification (Ticket 245); published Mac against the 187 server; installed desktop consent; `P-012` | TICKETS, Ticket 187 |
| Tickets 245–246: messaging track | Filed October 27; not development tickets | 245: Google verification submission, gated on `P-010` and `P-012`. 246: pre-launch messaging pass | TICKETS, Tickets 245–246; STATUS, "Messaging track — October 27, 2026" |
| Ticket 212: home and travel in onboarding | Live on web since October 24 | Authenticated browser QA of the setup row against a real routing report; installed desktop QA | TICKETS, Ticket 212 |
| Ticket 216: completion place labels | Live on web since October 24 | iPhone Safari re-prompt check; installed signed-desktop CoreLocation acceptance; `P-001` | TICKETS, Ticket 216 |
| Ticket 217: learned travel habits | Live on web since October 24 | Production QA; installed desktop acceptance; `P-002` | TICKETS, Ticket 217 |
| Ticket 218: weather travel margin | Code live; weather off | Operator clearance (`CADENCE_WEATHER_PROVIDER_CLEARANCE`); paid plan; deployed-web and installed acceptance; `P-003` | TICKETS, Ticket 218 |
| Ticket 219: travel facts in Daily Brief input | Stages 1 and 2 live on web | Google's reply to support case 76805292 and the day-level-facts decision; `P-004`, `P-012`; installed desktop acceptance | TICKETS, Ticket 219 |
| Ticket 184: owner-reviewed briefing candidate | Candidate 3 (`daily_brief@1.2`) from the October 23 review | Held-out cases, quality acceptance, promotion and rollback execution | TICKETS, Ticket 184; STATUS, "Ticket 184 candidate 3 — October 23, 2026" |
| Ticket 188: duration estimates from descriptions | Implementation started; recovered for owner review October 22 | Landing decision: unclear — see source | TICKETS, Ticket 188; STATUS, "Tickets 187, 184 candidate 2 and 188 recovered for review — October 22, 2026" |
| Ticket 130: account synchronization | TICKETS says in progress (2026-09-08) | The owner decides its state | TICKETS, Ticket 130; STATUS, "Ticket ledger reconciled with production — October 27, 2026" |
| Account sync timezone rule | PR #159 merged October 28; hosted push authorized | Not verified: a timezone change synced from an installed Mac after the push; authenticated hosted sync against the new rule | STATUS, "Account sync timezone rule for archived Behaviors — October 27, 2026" |
| MCP Tickets 220–231 | TICKETS `Status:` lines still say filed, planned or awaiting review (October 18); MCP is live and Ticket 232 acceptance is complete | Reconcile the `Status:` lines: unclear — see source | TICKETS, Tickets 220–232; STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Ticket 232: MCP production acceptance | Live acceptance complete October 31 | One Trust marketing-ID refresh and a Trust Preview → Production run after the record merges; done or not: unclear — see source | STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Ticket 259: consent offers write permissions | Merged October 31 as PR #175 | TICKETS says live ChatGPT write acceptance remains; the entry records a Tier 2 ChatGPT web run that completed the write: unclear — see source | TICKETS, Ticket 259; STATUS, "Ticket 259: consent offers advertised write permissions — October 31, 2026" |
| MCP acceptance tooling, Tickets 247–258 | Entry: complete except Ticket 253 (on hold); TICKETS still lists 252 in review and 256 planned | Reconcile 252 and 256; consent Allow or Deny before hydration returns 500 (product finding, not fixed) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Tickets 252–256 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Locally verified and independently approved | Live providers, installed desktop and release (241); live Hevy Pro (236); iCloud live acceptance (240); 242 cross-tenant and installed desktop not exercised | TICKETS, Tickets 236, 240, 241, 242 |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: recheck when web-push `latest` changes; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Tickets 301–309 hosted rollout — November 11, 2026

PR #205 merged to `main` as `6dd414f8`, and the production deploy succeeded. The owner
authorized every push below (`docs/DECISIONS.md`, 2026-11-10). An agent pushed with the vault
token `supabase-access-token` and the pinned CLI 2.105.0 (Go backend).

- **Before the deploy:** `20261110150000`, `20261110153050` and `20261110155000`. Readback:
  RLS on `cadence_advisor_private.daily_brief_preferences`, `launch_rate_limits` and
  `note_shortcut_states`. `save_daily_brief_preferences_v4`, `read_daily_brief_preferences`,
  `daily_brief_calendar_fence_is_current`, `commit_note_shortcut_state` and
  `consume_launch_rate_limit` execute for `authenticated` only, and `anon` has no usage on
  `cadence_advisor_private`. The action check includes `travel_home_lookup`.
- **Ticket 307 retirement:** the route returned `401` without its secret. One authorized call
  reported `revoked 1, unrevocable 0, failed 0, remaining 0`.
- **After the retirement:** `20261110160000` applied. Both `google_calendar_agent_*` tables
  are empty, and no role can execute the five `calendar_agent_*` functions.
- **Ticket 305 flip:** a backup query found 0 stored global off switches out of 1 row, so
  `20261110170000` changed no data. The empty backup is kept outside the repository.
- `migration list`: hosted equals git.
- **Tooling:** `scripts/acceptance/agent-secret.mjs` now gives `op` a private HOME; with the
  real HOME, `op` 2.42 hung on the desktop app's settings. The retirement route uses its own
  `GOOGLE_CALENDAR_AGENT_RETIRE_SECRET`, not `CRON_SECRET`. The agents' Supabase item is now
  `supabase-access-token`.
- **Vercel:** an agent removed `GOOGLE_CALENDAR_AGENT_RETIRE_SECRET`, `_CLIENT_SECRET`,
  `_CLIENT_ID` and `_PROJECT_ID` from Production with the owner's per-command approval; a
  readback lists none.
- **Open:** delete the vault item `google-calendar-agent-retire-secret`.
- **Not verified:** a signed-in `GET /api/advisor/preferences` as a test account, installed
  Mac checks, and a hosted Home lookup.

Platform impact: web hosted database and production deploy. Desktop: none until a Mac release
(P-037). Marketing and future mobile: not applicable. Messaging impact: none new.

## Tickets 312–322: connector completion implemented in source — November 10, 2026

**On branch `claude/pr-206-tickets-c4834e`, stacked on PR #206. Off in production: every
path does nothing unless `CADENCE_CONNECTOR_COMPLETION` is exactly `on`.**

- Complete: 312 (recorded-activity contract `1.1.0`, `RECORDED_ACTIVITY_MIN_MATCH_SECONDS`),
  313 (`activity-match.resolver.ts`, `resolveConnectorStatusEvent`, timing classifier) and
  322 (connector marks excluded from marking patterns; export and MCP provenance documented).
- Implemented: 314 (three tables, three security-definer writers, migration
  `20261110200000`), 315 (routine list and match read with routine digests), 316
  (completion-source port, reconcile and link services, `/api/connectors/...` routes), 317
  (Complete from Hevy on web Behaviors, "From Hevy" row line, Hevy panel last check), 318
  (timing statistics), 319 (sync convergence of a connector mark and the user's first mark,
  Mac label from the synced event, Mac reconcile after its Hevy refresh) and 321 (schedule
  resolver, `connector_completion` token channel, job route at minutes 7, 22, 37, 52).
- Not done: 311 is blocked (below). 320 is deferred: it needs sync contract 5 (4 is day notes), a SQLite
  migration, native changes and installed acceptance. 323 needs 311, a published Mac build
  with 319 (owner instruction) and Ticket 241's steps. 324 follows 323.
- Hosted: no migration pushed. `20261110200000` fits the standing approval once a push can
  run; the `cadence-agents` token needs the vault service-account token first.
  `20261110210000` grants `service_role` a column read; the owner approved its hosted push
  on November 10, 2026. Both pushes run when the branch merges to `main` (condition 4).
- Owner steps from `npm run qa:preflight -- --suite connectors` (exit 10): store the Cadence
  Agents service-account token (`docs/qa/agent-secrets.md`, steps 4–5); then the vault items
  it lists, of which Ticket 311 needs `hevy-test-account-a`.
- Verification: clean local stack replayed all 107 migrations; SQL fixtures for Tickets 314,
  321, 292 and 275 pass. New and changed Vitest files pass under Node 24. Dagger: agents,
  interactions, resolvers, lint, typecheck, build, desktop-build, marketing and public-trust
  pass after the fixes recorded in the PR; `test` results are in the PR.
- Not verified: live Hevy (change feed, ordering, `routine_id` behavior); the job end to end
  with a minted token; deployed web; any installed Mac build; Vercel usage.
- Platform impact: web, Tickets 314–318, 321, 322. Desktop: 319 in source, linked mode only;
  320 deferred. Marketing: none (P-042). Future mobile: deferred. Messaging impact: P-038 to
  P-041 apply; P-043 logged for the new in-app copy.

## Tickets 310–324: connector completion filed — November 10, 2026

**On branch `connector-completion/tickets`. Documents only; no code.**

- The owner decided D28 on November 10, 2026: a Behavior can be marked Completed from
  activity recorded in a connected service, starting with Hevy. Its eight parts, D28.1 to
  D28.8, are in `docs/DECISIONS.md`.
- Ticket 310 (complete): records D28, files Tickets 310–324, adds the plan
  `docs/plans/2026-11-10-connector-completion-architecture.md`, and updates `AGENTS.md`,
  `docs/PRODUCT_SPEC.md`, `docs/EXTERNAL_EVENT_CONTRACT.md`, `docs/INTEGRATION_PLAYBOOK.md`,
  `docs/DESKTOP_PARITY.md` and `docs/FUTURE_UPDATES.md`. It logs P-038 to P-042 and L-023.
- The plan began as an audit of an earlier design. Three findings shaped the tickets. The
  manual status function rejects connector provenance, so Ticket 314 adds separate
  functions. Published Mac 0.1.9 stops syncing when a connector and the user mark the same
  Occurrence, so Ticket 319 ships in a Mac build first. Hevy reads cover one day and stop
  above 500 workouts, so Ticket 311 picks the read strategy.
- Tickets 311–324 are not started. Ticket 311 needs an owner step only if the `connectors`
  preflight lists one.
- ID gaps on purpose: P-033 to P-037 and L-020 to L-022 belong to Tickets 301–309 on draft
  PR #205.
- Checks: `agents:check`, `interactions:check`, `resolvers:check`, `lint`, `typecheck` and
  `build` pass. `npm run test` ran under Node 26: 5,428 passed and 16 failed in five
  files. Four of those files assert Node 24, which `engines` requires, and
  `tests/acceptance-web-client.test.mjs` timed out closing its browser. A rerun of the
  five files under Node 24 had not finished when this entry was written.
- Not verified: Hevy's change feed, workout order and terms (Ticket 311, L-023). The
  5-minute minimum and the job's check counts are estimates.
- Platform impact: web, Tickets 312–318, 321 and 322. Desktop: linked mode only, Tickets
  319 and 320. Marketing: none until release (P-042). Future mobile: deferred. Messaging
  impact: P-038 to P-042.

## Tickets 301–309: Settings regroup implemented — November 10, 2026

The owner asked on November 10 to carry out Tickets 301–309 and merge PR 205, confirmed the
three agent proposals and authorized pushing Ticket 307's migration after merge
(`docs/DECISIONS.md`, 2026-11-10). Seven parallel agents built the tickets on branches off
`claude/determined-fermi-78a61d`; the orchestrating agent merged and reconciled each one.

- **301:** four groups, a sticky index, source rows with provider icons and state, drawers,
  pure state functions (`lib/ui/settings-sections.ts`), one line of Privacy, Terms and Trust
  links, and a quiet Delete account link. Bench fixtures: a new account measures 2,539 px
  (6,432 before) and Delete account is 22 tab stops away with every source connected.
- **302:** the Mac uses the same groups plus a "This Mac" group and a self-opening Cadence
  account drawer; local-mode rows say "Link a Cadence account".
- **303:** checkboxes and selects save as they change, Home on blur or Enter; one result line
  per section; failures roll back; Disconnect asks first everywhere. Timezone, opened forms,
  Connect, Disconnect and Delete account keep explicit actions.
- **304:** Categories as a closed list with drag, touch and arrow-key reordering; a move is one
  checked `manage_categories` write. No migration.
- **305:** Note shortcuts on for everyone; matching runs after each Note save; no Settings
  control. Migrations `20261110153050` (commit check) and `20261110170000` (turns stored off
  switches on once; not additive). Desktop SQLite migration 0022.
- **306:** one **Plan around my connected sources** choice with per-source exclusions under
  Advanced. Migration `20261110150000` (adds columns and `save_daily_brief_preferences_v4`; it
  also replaces `daily_brief_calendar_fence_is_current` with a looser caller check).
- **307:** Daily Brief reads Google Calendar through the Timeline connection. Retirement route
  `POST /api/google-calendar/agent-grants/retire`, then migration `20261110160000`, which
  refuses to run while any agent credential remains.
- **308:** **Use my current location** fills Home from one server-side reverse-geocoding call;
  the position is never stored or logged. Migration `20261110155000` (rate-limit action).
  `docs/COSTS.md` updated.
- **309:** plainer Settings copy, place-name timezones, `PRODUCT.md` voice. Before-and-after
  list: `docs/qa/2026-11-10-settings-wording.md`.
- **Logged:** `docs/LEGAL.md` L-022 (storing a geocoded Home address);
  `docs/MESSAGING_CHANGES.md` P-037 (old Mac builds' Daily Brief text) and Ticket 309's P-033
  additions.

Verification: each agent ran agents, interactions, resolvers, design-system, lint, typecheck,
desktop typecheck, build and desktop build (all pass) and the full Vitest suite (only the known
`acceptance-web-client` `afterAll` timeout plus load-sensitive files that pass alone). The
306–307 agent ran `db reset` and the new SQL fixtures on the local stack. CI on the merged
branch through Ticket 303 passed, including `rehearse` (every migration and SQL fixture) and
`verify`. Not verified: installed Mac checks (Cadence for Mac is not installed on the owner's
Mac), a signed-in hosted check, a real Google revocation, iPhone Safari, a screen reader.

Platform impact: web and desktop in this change; marketing only through P-035; future mobile
inherits the web page. Messaging impact: P-033 to P-037.

## Settings regroup: evaluation, mock and Tickets 301–309 — November 10, 2026

Owner direction: `docs/DECISIONS.md`, 2026-11-10. Branch `claude/determined-fermi-78a61d`,
opened as a draft pull request on November 10.

- **Evaluation, November 9.** The web Settings page was measured from the real components
  on synthetic data in headless Chrome: 6,470 px, 1,265 visible words and 59 controls for a
  new account at 1280×800; 8,402 px with every source connected. The production page was not
  checked: no kept test-account session was available on this Mac.
- **Mock.** `/design-system?preview=settings-regroup` shows four groups, a section index,
  source rows with state and provider icons, drawers for Categories, Travel and Daily Brief,
  a drag-to-reorder Categories sketch and a one-choice Daily Brief sketch. A new account
  measures 2,537 px, 182 words and 20 controls. `/settings` is unchanged.
- **Files.** `app/design-system/SettingsRegroupBench.tsx`, `SettingsRegroupFixtures.tsx`,
  `settings-regroup-bench.module.css`, `app/design-system/page.tsx`,
  `interaction-registry.json` (bench file excluded), three provider icons and
  `public/brand/connector-icons-source.md`.
- **Tickets 301–309 filed, none started.** The branch was rebased onto `main` on November 10,
  after the consolidation merge that holds Tickets 292–300.
- **Logged.** `docs/LEGAL.md` L-020 (provider marks) and L-021 (one Daily Brief choice, one
  Google connection). `docs/MESSAGING_CHANGES.md` P-033 to P-036.
- **Verification, November 10, after the rebase.** `agents:check`, `interactions:check`,
  `resolvers:check`, `design-system:check`, lint, typecheck and build pass. `npm run test`:
  5,428 pass and 16 fail in 5 files this branch does not change. Four files require Node 24
  (this Mac runs Node 26.13). `tests/acceptance-web-client.test.mjs` passes its 71 tests and
  then times out in its `afterAll` hook, also when run alone. Dagger did not run: Docker is
  not installed here.
- **Not verified.** Safari, an iPhone, a screen reader and the Mac app.

## Branch consolidation into main — November 10, 2026

The owner asked on November 10 for every active branch and open PR to land on `main`, the
horse avatar to stay out of production, and stale branches pruned. Merged through
`consolidate/2026-11-10`:

- `horse-avatar-trial`: a bench on `/design-system`, which calls `notFound()` in production
  builds. Only `public/brand/cadence-horse-avatar.png` is reachable in production.
- PR #181 (launch-sync bookkeeping in release acceptance), PR #202 (Ticket 292, day notes),
  Dependabot PRs #183 (ESLint 10), #185 (agentmail-cli 1.10), #186 (MCP client 2.4) and #187
  (eslint-config-next 16.4.5). PR #184 (`@types/node` 26) was closed: its build failed.
- `accounts-test` as Ticket 293 and `chatgpt-https` as Tickets 294–300, D27 and P-029 to
  P-032. Both had used Tickets 286–292, which `main` and day notes already held.
- `mcp-accept/256`: the cross-process session lock, kept alongside `main`'s exit-45 retries.
- Acceptance mirrors (`scripts/acceptance/protocol.mjs`, `watch.mjs`) gained the two day-note
  tools; `read-a` reads `list_day_notes` and checks the `update_day_note` step-up.

Hosted: the owner authorized the three day-notes migrations, and an agent pushed them
with the pinned CLI (2.105.0) on November 10. Read back on hosted: RLS on `day_notes`,
`authenticated` holds SELECT only, `save_day_note` executes for `authenticated` only, and
the contract-3 `day_note` sync kind is registered. The same day the owner approved additive
migrations in advance (`docs/DECISIONS.md`, 2026-11-10) and added the `cadence-agents`
Supabase token to the Cadence Agents vault (preflight `vault-supabase-access-token`; it
needs the vault's service-account token in this Mac's Keychain first).

Pruned: `note-add-backup`, `agentic-architecture` and an empty agent branch. The two
`backup/*` branches became tags `archive/advisor-analysis-wip-2026-10-22` and
`archive/ticket-165-reminder-gap-2026-10-08`.

Checks: Dagger agents, interactions, resolvers, lint, typecheck, build, desktop-build,
marketing and public-trust pass. Dagger `test` fails in the same five container-only files as
plain `main` (`.claude` files absent, Chrome, `git archive`); the merge-introduced failures are
fixed.

Platform impact: web, desktop and MCP through Ticket 292; acceptance tooling through Tickets
256 and 293; documents only for Tickets 294–300. Marketing and future mobile: not
applicable. Messaging impact: P-028 to P-032, already logged.

## Ticket 292: day notes in progress — November 10, 2026

Approved by the owner on November 10. Web day notes are implemented in source: the
`day_notes` table and `save_day_note` function (migration
`20261110120000_day_notes.sql`), the shared `NoteEditor`, the day-note control under
every Timeline date, the core resolver and service with tests, and day notes in web
Full JSON and BehaviorLog exports (one-day `review` records that pass the reference
validator). Local verification on November 10: a clean local stack (project
`habit-tracking-app`, network `cadence-local`, through the reviewed Docker proxy)
applied every migration including `20261110120000`, with every published port on
`127.0.0.1`. `tests/sql/ticket-292-day-notes.sql` passed: owner-only reads, revoked
direct writes, compare-and-set saves, clear keeps the row, future days, and no access
for a second account or `anon`. A catalog read matched the hand-written
`database.types.ts` entries; `gen types --local` was not run because the proxy policy
rejects the `postgres-meta` image. MCP contract 1.1.0 adds `list_day_notes`, `update_day_note` and `day_note` on
`get_timeline` days (migration `20261110130000_day_note_integration_writes.sql`); its
SQL fixture and the local read and write integration suites (39 tests) pass.
Desktop: SQLite migration 0021, the native `readDayNotes`/`saveDayNote` commands and
the desktop Timeline control are implemented; account sync contract 3 adds the
`day_note` kind (hosted migration `20261110140000`), with same-date merges described in
`docs/DESKTOP_DATA_MODEL.md`. All 125 Rust tests, the sync resolver tests and the hosted
account-sync SQL fixtures pass locally. Installed-app acceptance has not run.
Desktop export includes day notes like web. A clean local start replayed all 99
migrations with loopback-only ports, and the day-note, account-sync and write-replay SQL
fixtures passed (November 10).
Open in this ticket: day-note shortcuts, restore/import of day-note reviews, day notes
in MCP `search`/`fetch`, and installed-app acceptance. The desktop native
store and SQL verification need the Rust toolchain and Docker.

Platform impact: web, MCP and desktop (local and sync) implemented in source; marketing not applicable; future mobile deferred. Messaging impact: P-028.
