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
| Tickets 310–324: connector completion (D28) | 310–319, 321 and 322 merged to `main` with PR #207 on November 11, 2026, off behind `CADENCE_CONNECTOR_COMPLETION`; hosted migrations `20261111140000` and `20261111150000` applied November 11; Hevy read by events cursor (strategy A) | Ticket 320 (sync contract 5, not required for the first release); Ticket 323 needs a published Mac build with Ticket 319 (owner instruction) and Ticket 241's release steps 6–7; 324 after 323 | TICKETS, Tickets 310–324; STATUS, "Connector completion hosted push and merge — November 11, 2026" |
| Web export returns 500 for accounts with camelCase configuration history | Pre-existing, found during Ticket 292 acceptance (defect D2); not investigated or fixed | Every web export for test account A fails: `assembleExportBundle` throws "Invalid configuration schedule_graph" on 6 `behavior_configuration_events` rows with camelCase keys, likely written by the Mac through account sync; the route logs nothing. A separate workspace is proposed | STATUS, "Ticket 292: day-note shortcuts, restore and MCP search live — November 11, 2026"; `.intent/acceptance/t292-day-notes-20261111/ledger.md`, D2 |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294 complete; 295 spike in progress (mock mode); 296–300 not started; merged November 10, 2026 | Live spike run needs the owner's ChatGPT Plus or Pro sign-in | TICKETS, Tickets 294–300; STATUS, "Tickets 294 and 295: Daily Brief on the user's ChatGPT plan started — November 7, 2026" |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned | The owner compares candidates on the reserved cases and promotes or rejects one under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md` |
| Ticket 291: skill-rule acceptance scenarios | Unit-tested with fakes | First local-stack or live run with a real client | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "Skill-rule scenarios — Ticket 291" |
| Ticket 288: Daily Brief token usage | Recorded per call in the performance log and workbench runs | Measure with `CADENCE_PERF_LOG=1` and replace the assumed figures in `docs/COSTS.md` | TICKETS, Ticket 288 |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | Entry says "not pushed"; `git log` shows PR #198 merged | Not yet rechecked on an installed Mac | STATUS, "Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026" |
| Updater key rotation and new Developer ID identity | New key, certificate, profile and notarization password in place; release `check` passes | Notarized 0.1.10 (owner's instruction); hand install on both Macs; publish `latest.json`; owner attaches key files to 1Password; renew the certificate before December 11, 2027 | DECISIONS, 2026-11-11; STATUS, "Updater signing key rotated — November 11, 2026" |
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

## Connector completion hosted push and merge — November 11, 2026

The owner said on November 11 to merge PR #207 and continue.

- Hosted already had main's `20261111120000` and `20261111130000`, so the connector
  completion migrations moved, unchanged, from `20261110200000` and `20261110210000` to
  `20261111140000` and `20261111150000`. Both create only new objects. A clean local start
  replayed all 114 migrations and all 44 SQL fixtures passed.
- An agent pushed both with the vault token `supabase-access-token` and CLI 2.105.0, before
  the merge: `20261111140000` under the standing approval for additive migrations,
  `20261111150000` (the `service_role` column read) with the owner's November 10 approval.
- Readback: RLS on `behavior_source_links`, `occurrence_source_matches` and
  `connector_completion_state`, each with policies for `authenticated` only; no `anon`
  grants; `service_role` may select only `user_id`, `source` and `next_check_at` on
  `connector_completion_state`. `apply_connector_completion`, `attach_source_activity` and
  `remove_source_match` are security definer with an empty search path and execute for
  `authenticated` only. The six `cadence_private` helpers are revoked from `public`.
- `migration list`: hosted equals git (114 rows).
- The feature stays off until `CADENCE_CONNECTOR_COMPLETION` is `on`; this work set no Vercel variable.

## Ticket 311: Hevy read strategy decided — November 11, 2026

**On branch `claude/pr-206-tickets-c4834e` (PR #207).**

- The owner decided not to buy a Hevy test account; Hevy testing uses the owner's own Pro
  account through vault item `hevy-owner`, additions only (`docs/DECISIONS.md`,
  2026-11-11). The preflight requirement `vault-hevy-a` and the Hevy connector step now
  read `hevy-owner`.
- Live results in `docs/qa/2026-11-hevy-change-feed.md`. The events feed keys on
  `updated_at`, inclusively, and reports new, back-dated and edited workouts;
  `/v1/workouts` is ordered by `created_at`, not start time; no 429. Strategy A, events
  cursor. Two private test workouts were added through the API; nothing was edited or
  deleted.
- `docs/LEGAL.md` L-023: Hevy's terms (effective June 23, 2019) have no API or automated
  access clause; risk low.
- Implemented the same day: Tickets 315, 316 and 321 read changes since a stored cursor
  (`connector_completion_state.read_cursor`, no migration) and fall back to the full read
  for a new link or connection; the job runs the full schedule. Next: merge PR #207.
- Not verified: a `deleted` event, a routine rename or deletion, histories above 500
  workouts.

## Ticket 292: day notes complete — November 11, 2026

The owner approved closing Ticket 292 on November 11, 2026. Web, hosted and MCP are live;
production serves `5e5b5cc7`.

- **Acceptance run** `t292-day-notes-20261111` (ledger
  `.intent/acceptance/t292-day-notes-20261111/ledger.md`):
  - Passed: 1, 2, 3, 5 (accounts A and B; B sees none of A's day notes through
    `list_day_notes`, `get_timeline`, `search` or `fetch`), 6, 7, 8, 9 and 10.
  - 7–9 ran on the test Mac with dev-signed 0.1.10-dev.2 from `main` at `10cb7dfb`: SQLite
    20→23 with integrity ok and no rows lost; a local day note persists across quit and
    relaunch; the synced chip works in the Mac editor; day notes and the shortcut pool sync
    both ways; a concurrent edit goes to conflict review; two new notes for one date merge.
  - Partial: 4. Export content and import and restore previews verified; the apply steps
    did not run, because no throwaway test account exists.
- **Defect D3, fixed:** multi-line notes could not be re-saved on web; every save showed the
  conflict message. Occurrence notes had the same defect from before Ticket 292. PR #213
  (`5e5b5cc7`) normalizes CRLF in the expected text before the compare-and-set. The
  acceptance agent retested on production as account A: multi-line day notes and
  Occurrence notes save, edit and clear at 1280 and 390 px, a stale save still conflicts,
  and a chip save on a multi-line day works.
- **Mac:** no Mac release was published. SQLite `0023`, day-note shortcuts on Mac and sync
  contract 4 reach users with the next Mac release. Hosted already supports contract 4.
- **Still open, outside this ticket:** the web export 500 (open-work row; ledger D2) and
  P-028 in the messaging track.
- **Follow-ups logged** in `docs/FUTURE_UPDATES.md`, "Day note follow-ups".
- **Test fixtures left in place:** account A keeps empty day-note rows (there is no delete
  path) and a `day_notes` shortcut row with 3 dismissed entries. Account B has one cleared
  row. The test Mac stays on dev build 0.1.10-dev.2 (schema 23), linked as A; its
  pre-upgrade backup is `backups/pre-0.1.10-dev.2-20261111T171236Z`. Returning it to 0.1.9
  needs the owner's instruction.

Platform impact: web and hosted live; desktop merged, ships with the next Mac release;
marketing and future mobile not applicable. Messaging impact: P-028 (open).

## Updater signing key rotated — November 11, 2026

macOS reset the owner's login password on November 9 and set the old login keychain aside;
it does not unlock. The Developer ID private key, the notarization password and the updater
key's password were in it. Decision: `docs/DECISIONS.md`, 2026-11-11.

- **Done on the owner's Mac:** the Developer ID G2 intermediate and a new Developer ID
  Application certificate (expires December 11, 2027) in the login keychain;
  profile `Cadence_Desktop_Developer_ID_2026-11.provisionprofile` (team HK26VT477G,
  `app.cadence.desktop`, new certificate only, entitlements cover `Entitlements.plist`); a
  new notarization password; a new updater key in `Cadence Release/updater-2026-11/`.
- **Verified:** a test file signed with the Keychain password verified with Minisign against
  the new public key. `build-env.sh check` from the new `acceptance-0.1.10` wrapper passed
  against commit `ac526471`; it does not contact Apple.
- **Changed outside the repo:** `dev-signed-env.sh` now reads the 2026-11 profile and the new
  public key (backup `dev-signed-env.sh.bak-2026-11-11`); the `acceptance-0.1.10` wrapper
  reads the release worktree from `CADENCE_RELEASE_REPO`.
- **Not done:** notarized 0.1.10; hand install on the owner's Mac and the test Mac; checking
  that Keychain sessions and location permission survive the new certificate; owner attaching
  both key files to the 1Password item.

## Ticket 292: day-note shortcuts, restore and MCP search live — November 11, 2026

PR #208 merged to `main` as `76b701c7` (12 of 12 checks) and PR #210, the Settings hotfix,
as `58efe857` (9 of 9). Production serves `58efe857`. The ticket stays open: installed Mac
acceptance has not run.

- **Live:** the `day_notes` Note shortcuts pool (Settings › General, Day note shortcuts
  drawer after Categories, `INT-SETTINGS-018`), on by default under Ticket 305; BehaviorLog
  restore and import of day notes; MCP contract 1.2.0 (`search` and `fetch` return
  `day_note` records); paged Timeline day-note reads. Mac code: SQLite `0023` and sync
  contract 4, not yet in a Mac build.
- **Hosted:** an agent pushed `20261111120000` and `20261111130000` on November 11, 2026
  with the pinned CLI (2.105.0) and the agents' vault token, under the owner's approval;
  read back: contract-4 row registry (one `day_notes` row, authenticated SELECT only),
  contracts 1–3 hide the pool and contract 5 is rejected, Ticket 305's global gate kept,
  the new day-note shortcut functions execute for authenticated only, and RLS on
  `note_shortcut_states` and `day_notes` unchanged.
- **Acceptance** on production as test account A (ledger
  `.intent/acceptance/t292-day-notes-20261111/ledger.md`):
  - Passed: 1 web add, edit and clear on today, a future day and a Needs decision day at
    1280 and 390 px; 2 two-tab conflict message; 3 drawer, suggestion, Accept, chip only
    in the day-note editor, chip save records the exclusion; 5 MCP 1.2.0 tools for
    account A, each call seen by `mcp:watch`; 6 sync read: contracts none and 1–3 omit
    the `day_notes` row, contract 4 carries it; 10 published Mac 0.1.9 (sync contract 2)
    still syncs with the row present.
  - Partial: 4 export content and import and restore previews correct; apply not run on
    account A (import would duplicate 54 records; restore lists 216 destructive actions).
  - Not run: 5 isolation with account B (preflight requirement `vault-google-b`: vault item missing); 7–9 Mac
    build (no Developer ID certificate in the login Keychain). Both wait on the owner.
- **Defects found:** D1, the Settings outage (next entry). D2, pre-existing: every web
  export for account A returns 500 (open-work row above; ledger, D2).
- **Trust:** an agent set the app's Production `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` to
  `dpl_bBUrdzM6kWmewcW7W8YsHXvXom5M` (marketing at `58efe857`; the value had named a
  November 8 deployment) and redeployed the app; production is Ready. This ledger PR's
  merge stales it again.
- **Not run:** repo `npm run supabase -- db reset`, because the pinned CLI binary fails
  macOS code-signature validation and macOS kills it (exit 137) before it reaches Docker.
  Docker Desktop 29.9.3 is installed and running (context `desktop-linux`, CLI at
  `~/.docker/bin/docker`, not on the agent shell's PATH); earlier agents used it to replay
  all 112 migrations in a throwaway `supabase/postgres` 17.6 container, and CI runs the real
  CLI. `dagger check` was not run for this ledger PR; the agent ran the npm checks instead.
- **Follow-ups logged** in `docs/FUTURE_UPDATES.md`: re-import after a failed day-note
  step, and shortcut evidence limited to past and current days.

Platform impact: web and hosted live; desktop code merged, release pending (items 7–9);
marketing and future mobile not applicable. Messaging impact: P-028.

## Settings outage on production fixed — November 11, 2026

`/settings` failed for every signed-in user from about 05:29Z to 07:26Z on November 11.
The server page `app/(app)/settings/page.tsx` called `drawerLabel()` from the client module
`components/settings/CategoryPanel.tsx`. That code came from Ticket 301 (PR #205). The
Ticket 292 merge (PR #208) added one more string, `DAY_NOTE_SHORTCUTS_PURPOSE`, with the
same pattern. Timeline, Behaviors and Export kept loading.

- **Fix:** PR #210 (`58efe857`) moves `drawerLabel` and four drawer purpose strings into
  `lib/ui/settings-sections.ts`. `tests/server-client-boundary.test.ts` now fails when a
  server module under `app/` imports a non-component export from a client module.
- **Verified:** production `/settings` loads for test account A, and Vercel logs show no
  `drawerLabel` error.
- **Process note:** branch protection blocks a merge on open code-scanning alerts and open
  review threads, not only on `verify`. A CodeQL finding in the new test held the merge
  until `10bb9d65`.

Platform impact: web only. Desktop renders the same drawers from the same modules; no Mac
release carries the defect. Marketing and future mobile: not applicable. Messaging impact:
none.

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
