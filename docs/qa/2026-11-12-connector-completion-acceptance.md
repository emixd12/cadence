# Connector completion release acceptance: Ticket 323 (November 12–13, 2026)

Plan Task 14 matrix for D28, run by an agent under the owner's decisions of November 12
(`docs/DECISIONS.md`, 2026-11-12, "Finish connector completion"). Evidence classes stay
separate, as `docs/INTEGRATION_PLAYBOOK.md` requires: live provider, local web against a
local stack, deployed web, installed Mac.

Output kept codes, counts, local times and 8-character SHA-256 prefixes of provider IDs.
No routine titles, exercise data, keys or tokens were recorded.

## Why a local stack first

The flag is global and Vercel Preview has none of the production Supabase or connector
secrets, so a preview deployment cannot run the feature. The owner's instruction turns the
flag on in Production after the matrix passes. The matrix therefore ran first on a local
Supabase stack and a local web server with `CADENCE_CONNECTOR_COMPLETION=on`, reading the
owner's live Hevy account. The deployed-web and installed-Mac rows ran after the flag
turned on, with the rule that any failure turns the flag off again.

## Hevy facts found during the run

- `POST /v1/workouts` rejects `routine_id` (400, "Unrecognized key(s) in object:
  'routine_id'"). The public API cannot create a routine workout; only the Hevy app can.
  Routine rows therefore used the owner's real routine workouts from the last 30 days
  (read only).
- Hevy's API has no delete endpoint, and hevy.com's workout page offers no delete control.
  The `deleted`-event rows wait for the owner to delete the test workouts in the Hevy app.
  The removal and revert rules were exercised by moving workouts to another day with
  `PUT /v1/workouts/{id}` (rule 7: an edit that changes the Occurrence removes the match).
- Test additions on the owner's account (all private, titled "Cadence test 323 …"): six
  routines and the workouts `W-min` (3 min), `W-a` (30 min), `W-b` (20 min) and `W-c`
  (25 min). `W-a` and `W-b` now sit on November 10.

## Local stack run (November 12, 20:15–21:05 ET)

Setup: local Supabase (CLI 2.105.0 Go backend; the `supabase` wrapper binary is killed by
macOS on this host, `supabase-go` runs), local `next dev` with the flag on, a temporary
local test user, the owner's Hevy key connected through `POST /api/hevy/connection`.
Seven Behaviors "T323 …", daily at 7:30 PM, America/New_York. Test Occurrences were
re-dated in the local database onto days of the owner's real workouts.

| Row | Setup | Result |
|---|---|---|
| Complete | "Legs routine" linked to routine `1a70b480`; "Gym any" on any workout; both with an Occurrence on Nov 11 | **Pass.** The 2:52 PM routine workout completed "Legs routine" (`completed/derived/connector:hevy`) |
| One workout, routine link and any-workout link | Same | **Pass.** The same workout matched "Gym any" too (attached, because the 2:10 PM workout completed it first) |
| Two workouts on one day | "Gym any" Nov 11 | **Pass.** One completion match, one attached match; row "From Hevy · 2 workouts", expanded "2 workouts in Hevy" with both times |
| Clear, no re-complete | Unmark "Gym any" Nov 11, reconcile | **Pass.** Stays Unresolved; events `completed/connector:hevy > unresolved/manual_tap` |
| Marked Completed by the user | "Marked done" Nov 2 marked Completed with its link off, link on, reconcile | **Pass.** Workout attached; status and event stay the user's |
| Marked Not Completed by the user | "Marked not done" Oct 15 marked Not Completed, link on, reconcile | **Pass.** Nothing written (code `not_completed`) |
| Under the minimum | 3-minute `W-min` today on "Gym any" | **Pass.** Nothing written (code `below_minimum`) |
| Workout removed, another remains | `W-a` (completion) and `W-b` (attached) today; `W-a` moved to Nov 10 | **Pass.** `removed 1, reverted 0`; still Completed |
| Workout removed, none remains | `W-b` moved to Nov 10 | **Pass.** `removed 1, reverted 1`; Unresolved with `unresolved/derived/connector:hevy` |
| Workout deleted in Hevy (`deleted` event) | Needs deletion in the Hevy app | **Waiting on the owner** (see "Owner step"). Not a release gate: the owner turned the flag on after this run |
| Link off | "Link off" linked to routine `69db15d3`, turned off before the first reconcile; Oct 14 Occurrence | **Pass.** Stayed Unresolved through two reconciles; after the link was turned on, the Oct 14 workout completed it |
| Disconnect | `DELETE /api/hevy/connection`, reconcile after the throttle | **Pass.** `status: not_connected`, no provider call; 7 of 9 matches stay active as history; links stored, not fenced |
| Reconnect, same account | Key posted again | **Pass.** Links resume (`connected`, not fenced); the next reconcile completed today's "Gym any" from `W-c` |
| Reconnect with another account | One Hevy Pro account exists (owner decision 4) | **Not run live.** Covered by the database function and service tests |
| Flag off | Server restarted without the flag | **Pass.** Reconcile `disabled`; link `PUT` 503 `not_configured`; link form `available: false`; job `enabled: false`; Timeline shows no "From Hevy" line |
| Background job (Ticket 321) | `GET /api/connectors/completions/process` with `CRON_SECRET`, local ES256 key from the stack | **Pass.** Selected 1, visited 1; with a full read due after a link save, it completed one seeded Occurrence (Nov 4) with no session open |
| 390 px | Timeline at 390 × 844 | **Pass.** Title, "From Hevy" and status fit |

The job's first call completed nothing: the account's events cursor had already passed
the Nov 4 workout, and a re-dated Occurrence is not a change the cursor watches. This is
the designed incremental read (Ticket 311, strategy A); a link save forces a full read.

### Defect found and fixed: no "From Hevy" label on a normal Timeline

`listSourceMatchesForOccurrences` sent 200 Occurrence IDs in one `in` filter. The Timeline
reads every Occurrence in view, and the request failed with "URI too long". The service
catches the error and shows no labels, so the label never appeared on a Timeline with a
week of Behaviors. Fix: batches of 100 IDs, as the status-event and time-session reads
already use; test `tests/source-matches.repo.test.ts`. After the fix the labels showed.

## Deployed web (November 13, 04:30–04:40 UTC)

The flag turned on in Production at 04:30 UTC (redeploy `dpl_GYPJvtPZFmSEwZ6VL1zgUN4Vy9AT`
of commit `5ff760f0`, which carries the batching fix). Test account A, reading the
owner's Hevy account through A's existing connection (generation 3).

| Row | Result |
|---|---|
| Flag reaches the deployment | **Pass.** Link form `available: true` once the redeploy served |
| Links | **Pass.** "Read 20 pages" linked to the six real routines, "Evening walk" to any workout; both `saved` |
| Reconcile | **Pass.** `reconciled`: completed 12, attached 2, skipped 13 (`below_minimum`, `no_occurrence`), refused 0 |
| Labels | **Pass.** Today's "Evening walk" shows "From Hevy" at 1280 px and 390 px; page width 390, no horizontal scroll |

## Installed Mac (test Mac, Cadence 0.1.10, signed in as A)

| Row | Result |
|---|---|
| Forced collision (Ticket 319) | **Pass.** Setup: the Mac on the Timeline had not pulled (0 local matches; "Read 20 pages" today Unresolved). The any-workout link moved to "Read 20 pages"; a hosted reconcile completed it at 04:36:30 UTC (`completed/derived/connector:hevy`). Before the Mac pulled, "Not Completed" was pressed on that row through accessibility, without focusing the window (focus starts a connector refresh). Result on the Mac and on hosted: both root events kept in order, status `not_completed` (the manual mark wins), the completion match stays active as timing evidence, and the outbox has no unsent rows |
| Links and matches reach the Mac (Ticket 320) | **Pass.** 18 matches in the Mac's SQLite after the sync. Today's "Evening walk" row reads "From Hevy"; expanded, "Workout in Hevy" with 7:10 PM–7:35 PM |

Account A keeps these links after the run: "Read 20 pages" on any workout, "Evening walk"
off.

## Owner step

Delete these private workouts in the Hevy app (Hevy's API and website cannot delete):
`Cadence test 323 W-min`, `W-a`, `W-b`, `W-c`, and the earlier `Cadence test (today)` and
`Cadence test (back-dated)` from Ticket 311. Delete the six routines
`Cadence test 323 legs | done | notdone | min | two | off` too. An agent then reruns the
reconcile to record the `deleted`-event rows.
