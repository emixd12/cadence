# MCP server local acceptance — Ticket 228

## Bounded hosted isolation preparation — Ticket 232 (October 28)

This procedure is prepared, not executed. It is a separate hosted opt-in;
the loopback guards in the existing local integration suites remain unchanged.
It checks the internal-token Data API boundary, not OAuth consent, MCP scopes,
all RPCs, or installed-client acceptance. Those need their separate tests.
Web server security is the affected surface. Desktop acceptance uses a separate
QA-only profile; marketing and future mobile gain no implementation from this script.

### Required identities and fixtures

The owner must name two dedicated Google QA accounts and their actual Auth UUIDs,
approve this exact operation on project `qjodzutjxtmtzczbloxa`, and confirm neither
is their real tracking account. Names alone do not prove an account is synthetic.
Never create or delete accounts through this script. Never supply a service-role
key. Use a publishable key and the approved integration signing key in process
environment only, from its approved custody destination. Do not export the current
provider private key or copy tokens, note text, or private keys into evidence.

Owner selection on October28: A is the existing dedicated test-Mac account.
Its normalized-email SHA-256 prefix matches the supplied test-Mac prefix; retain
only that match result. A's final cleanup removes only approved MCP fixtures and
grants, never the account or its other data. B must be the September Calendar
wrong-account identity from Emi Chrome, not the owner's real tracking account.
Local QA records do not name B; Chrome Local State access was denied by macOS.
Do not infer B from deployment-author metadata. Once B is named, use one read-only
exact-email lookup returning only existence and Auth UUID for A and B. Do not
scan auth.users or other accounts. No such lookup has run yet.

If B cannot be reused, the owner must supply another Google identity; create
nothing automatically. An AgentMail inbox alone is not a Google account. Google
[sometimes requires phone verification](https://support.google.com/accounts/answer/114129)
during signup. Check the actual sign-in client's audience and requested scopes.
Later Calendar QA records say In production, superseding the earlier Testing
checkpoint, but that separate project's state does not prove the sign-in state.
Google's [audience rules](https://support.google.com/cloud/answer/15549945) exempt
openid/email/profile-only sign-in from Testing's test-user requirement; additional
scopes in Testing require an eligible listed test user. Current console state
and the new identity's eligibility remain unverified. Do not add Calendar scopes.

Prepare the existing **Review examples**, **Review walk**, **Review reading** and
archived **Review stretch** fixtures described in
`mcp-directory-submission.md#reviewer-account-plan`. Both accounts use
America/New_York. Walk is daily09:00; reading is Mon/Wed/Fri19:00. Disable browser
and email reminders; no push subscription, Calendar, travel or Daily Brief.
Use only the previous week through today. The stopped time session and resolved
status examples remain untouched by this script. Pause client/desktop editing
for these fixtures during the check.

Record the exact existing IDs in a private JSON file, without credentials:

```json
{
  "a": { "category": "UUID", "walk": "UUID", "reading": "UUID", "stretch": "UUID", "occurrence": "UUID" },
  "b": { "category": "UUID", "walk": "UUID", "reading": "UUID", "stretch": "UUID", "occurrence": "UUID" }
}
```

Each Occurrence must belong to that account's Review walk, within the previous
seven days or today, with a null note or exactly **Review sample note**.
The script validates both complete sets, ownership, titles, category, archive
state, timezone and reminders before any write. IDs must all be distinct UUIDs.
Schedule semantics and the absence of other provider connections require the
fixture-preparation checklist; the script does not inspect customer/provider data.

After explicit approval, run with an actual Node24 runtime and these environment
variable **names** injected privately: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`CADENCE_INTEGRATION_JWT_SIGNING_KEY`. The script never loads `.env` files.

```sh
node --experimental-strip-types scripts/mcp-hosted-isolation.mjs \
  --allow-hosted-project qjodzutjxtmtzczbloxa \
  --qa-a ACTUAL_QA_A_AUTH_UUID --qa-b ACTUAL_QA_B_AUTH_UUID \
  --fixtures /private/path/to/approved-fixture-ids.json
```

The placeholders deliberately fail validation. This command is not execution
authority. Do not substitute an owner account or another project to make it pass.

### Exact operations, evidence and cleanup

The script reuses `lib/supabase/integration-token.ts` for five-minute ES256 tokens.
It makes ID-filtered reads of profiles, categories, Behaviors and Occurrences,
and column-permitted PATCHes of profiles, categories and Occurrences. Behavior
writes use the existing `update_behavior_with_schedule_graph` RPC, exactly as
the web repository does. Its same-value payload preserves the complete synthetic
Behavior and ordered schedule graph, with the exact expected update timestamp.
The embedded schedule/slot read stays under that one Behavior and the16KiB cap.
Each table result is limited to one row; requests ask for two to detect surprises.
There are no account creations, list-all queries, inserts, deletes, cron,
purge, reminders, or provider operations. It follows no redirects, retries no
request, allows at most60 requests, bounds each request to4seconds and16KiB,
and reserves30seconds for cleanup after a90second test budget.

1. A and B each read their exact profile and five fixture rows through their own
   minted token. The script checks expiry and invalid-signature rejection (401)
   before mutations. The untrusted key is generated only in memory, with the
   trusted public kid and a different private key; it is never imported.
2. A's GET of each B row must return an empty200 result. A uses the same write
   path for B that succeeds for A: column PATCHes or the Behavior RPC. Denial
   must return an empty200/null RPC result or403. Any returned row fails isolation.
   Same-value writes limit harm if RLS is broken, but triggers may still record
   metadata; these are strictly approved synthetic rows.
3. A's matching same-value profile/category PATCHes and Behavior RPCs must
   return its exact row. A changes only its selected Occurrence note to **Review confirmed**
   with a compare-and-swap filter, then reads it back.
4. In `finally`, read that Occurrence once. Restore the original approved note
   only if it still equals the probe value, with another compare-and-swap.
   Verify restoration, then verify B's note stayed unchanged through B's token.
   An ambiguous timeout is never retried blindly. A conflicting edit stops cleanup.

Output is fixed check labels and request count only. Errors produce a fixed
failure message; provider bodies, tokens and note text are never printed.
A failure, process termination, expired token or exhausted cleanup budget leaves
cleanup **unverified**. Keep MCP disabled, inspect only the named A/B fixture IDs
through their owner sessions, and reconcile the approved note before another run.
Do not delete users/grants/client registrations as an automatic cleanup fallback.
This script restores note content, not timestamps or synthetic audit effects.
Same-value Behavior transactions also mark the account occurrence-sync state stale;
normal user synchronization resolves that state. They do not schedule reminders.
Owner-approved end-of-acceptance cleanup remains separately ID-bound.

Offline guard/fault tests:

```sh
node node_modules/vitest/vitest.mjs run tests/mcp-hosted-isolation.test.mjs
```

These mocks prove the guards and assertion behavior; they do not prove hosted RLS.

### Captured-ID archive cleanup (Ticket232)

`scripts/mcp-fixture-cleanup.mjs` prepares a private SQL transaction. It never
connects to a database. Its CLI pins the approved project and both QA user IDs:
A `caefd1b8-ea46-485f-8869-119a715fb092`, B
`c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b`. The separate local harness supplies its
own two disposable IDs to the pure generator; this does not relax any hosted
transport guard. Execution remains subject to independent review and the
coordinator's activation window.

This uses the authorized **archive** option. It does not physically remove
categories, Occurrences, notes, schedules, time sessions or history. It retains
them under archived Behaviors. This is not proof of erasure or completed physical
cleanup. The transaction calls the existing atomic Behavior RPC, preserving
archive notes and creating the normal configuration history. It marks occurrence
sync stale through that RPC. Already archived Behaviors remain unchanged.
Do not substitute raw Behavior UPDATE or cascade DELETE.

Capture creation receipts as operations succeed, including generated child IDs.
Do not reconstruct provenance from titles or a later account-wide query. The
final private manifest contains only metadata:

- `version: 1`, `project: qjodzutjxtmtzczbloxa`, a UUID `runId`, and `users: [A, B]`.
- `startedAt` before fixture creation and `capturedAt` after final receipt capture,
  at most48hours apart. Database `created_at` values must fall within that window.
- `rows`: exact `{table,id,user_id,created_at,run_id}` creation receipts. Each
  `run_id` equals `runId`. Include all fixture categories, Behaviors, schedules,
  slots, Occurrences, status events, definition events, configuration events and
  time sessions. The allowlist excludes accounts, imported records and settings.
- `counts`: an explicit count for each of the nine allowlisted tables, including
  zeroes. At most500 rows. Stop for a larger run; do not silently increase the cap.

Record the manifest's SHA256 separately in the execution receipt before cleanup.
The command requires that digest and refuses changed files, foreign IDs, duplicate
rows, missing counts or timestamps outside the run. The database independently
checks existence, ownership and exact creation timestamps. **Provenance comes
from the retained creation receipts, not a database run-ID column.** A timestamp
inside the window alone cannot prove who created a row. Never invent or widen
receipts to make cleanup pass. If creation evidence is missing, stop.

```sh
node scripts/mcp-fixture-cleanup.mjs \
  --allow-hosted-project qjodzutjxtmtzczbloxa \
  --manifest /private/path/to/captured-cleanup-manifest.json \
  --manifest-sha256 EXACT_PREVIOUSLY_RECORDED_SHA256 \
  --output /private/path/to/reviewed-cleanup.sql
```

Output is a digest and a prepared-not-executed label. The SQL file is created
exclusively with0600 permissions. The generator prints no IDs, note text or
provider errors. Review the SQL hash, schema and manifest against the frozen
release before supplying it to the already authorized synthetic-account SQL
path. That path must use one connection, ON_ERROR_STOP, no query logging or
response-body printing, and discard error context. No database credentials belong
in command arguments. No all-account cron, purge, reset, seed or account deletion
is part of cleanup.

The reviewed cleanup connection must execute as **postgres**, not service_role.
The DO block validates and locks rows as postgres; its existing SECURITY DEFINER
Behavior RPC executes as its existing database owner, with the exact validated
A/B auth.uid claim set transaction-locally. This explicitly authorized synthetic
admin cleanup is not an RLS proof. Verify that connection role and the reviewed
schema before execution; do not substitute a service-role Data API request.

The transaction takes the existing account advisory locks in sorted order and
locks every captured row. It checks exact table counts and full captured graph
membership before the first archive. A missing ID, foreign owner, changed creation
receipt, omitted graph row, extra Behavior using a fixture category, enabled
reminder, running time session or reminder-delivery row aborts it. It uses an
8second statement timeout and2second lock timeout, with no retry. Every archive
must return its exact ID, and the final archive count must match. Any error rolls
back all archive and history changes. An interrupted connection needs a fresh
readback; a client timeout alone is not proof of rollback. A second execution
needs fresh reviewed receipts because normal archive history changed the graph.

Before this transaction, revoke only newly captured grant IDs through the
ordinary A/B `oauth_revoke_grant` path. Match each grant's owner and creation
receipt first; preserve pre-existing grants and shared client registrations.

#### October28 interrupted run: reviewed abort path

The owner selected EXTEND on October29. This archive-only path remains an abort
option, not an instruction to close the run. Resume requires the reviewed
extension below and a fresh coordinator execution relay.
The optional `emptyUsers: [B]` manifest field closes only run
`4db9fe6e-a966-4cca-938b-aee5a1b955b7`, started
`2026-10-28T02:17:18.882Z`. Both approved identities remain in `users`.
The generator requires no B rows, exactly category
`a29dd2d0-5425-4180-a29a-01a026ebb8c0` and Behavior
`b2c5b6b1-457a-4e58-a14f-e4270c3d341e`, all owned by A.
Other partial runs remain refused. The exact original run now has the explicit
seven-day capture boundary below. Every ownership, creation-receipt, closure
and count guard remains. Other runs retain the original 48-hour limit.

Refresh metadata only for that captured category and Behavior, and children
whose `behavior_id` equals that captured ID. Include app-generated Occurrences:
October29 readback found38, including30 created after the owner's sign-in.
Their actual writer was not verified. Never adopt A's pre-existing Behaviors
or their Occurrences. An unrecognized or unattributable row stops cleanup.
The category and all rows retain their existing Review test labels; archive
only the captured walk through the supported RPC, retaining its history.

`occurrence_sync_state` is account-scoped, keyed by `user_id`, with no Behavior
ID. It cannot enter the fixture manifest. Preserve the row; the archive RPC's
normal stale-state update is expected. Read it separately to verify retention.
No grant was created: the October29 bounded read found zero grants for A and B.
Signing-key IDs and states were unchanged. Recheck both facts before execution.

The reviewed postgres Management API connection can capture metadata, archive
and read back without browser sessions. Its read-only mode can report a
different role; that does not establish the execution role. Confirm postgres
on the exact general-query transport before the authorized transaction. If
ordinary-session capture is selected instead, only A needs a fresh sign-in;
B has no fixture or grant operation. No session is needed solely to revoke
zero grants. Stop if a grant unexpectedly appears.

An abort still needs the coordinator's execution relay. Finish and read back
before November4 02:17:18.882UTC. The SQL transaction enforces this deadline
for this run; it does not silently reset the start time.
Retain all38 Occurrences, category, schedules and original history. Verify one
new archive configuration event, the captured walk inactive, and no mutation
of pre-existing data. The isolated rehearsal covers three preserved Behaviors
and96 Occurrences, explicit/implicit empty-B cases, omitted-child and changed
receipt refusals, and transaction rollback.

For a future run (planning only): model app-generated rows after sign-in/sync
as bounded descendants of captured Behaviors, refresh the manifest before
cleanup, and reject unrelated rows. Sessions expire hourly; coordinate one
continuous owner window for sign-in, key prompts and client consent. Rehearse
all five steps end-to-end locally, including interrupted resumes, generation,
session expiry and archive closure, before any new hosted fixture write.
Verify the captured grant is revoked and its old token fails. No client deletion
or OAuth purge substitutes for revocation. These grant calls are separate from
the archive transaction and require their own receipts.

Read back all captured Behaviors as archived, retained-row counts, new archive
history, unchanged nonfixture baselines, and the test Mac's ordinary synchronization.
Do not report physical removal, timestamp restoration or automatic disappearance
of past Occurrences. Capture the new history IDs, remove local token/fixture
material after retaining sanitized evidence, and preserve the accounts and keys.
Web acceptance tooling only changes here; desktop gets a later sync check.
Marketing and future mobile have no implementation change.

October28 prerequisites: the owner confirmed vault **Cadence**
(`fgyupy5i26isvkdqofojc5o66u`) and working app-integrated `op vault list`.
Do not gate on `op whoami`, which still reports no signed-in CLI account.
At the approved key step, verify the exact vault metadata, create the document
through stdin, then verify item/document metadata and the public key identity.
No plaintext file or sign-in command is required. The other release finished
PR157/159/160; freeze canonical READY sites at
`eb5afa5be5c49b43bbad3ffd5a25d6eddff30079` and stop on drift. The owner holds
PR161 until activation and cleanup; do not merge it. Independent approval of
isolation and archive cleanup must precede any hosted execution. The existing
rotate-while-disabled → session checks → isolation/timeout metadata → enable
order remains. Activation changes the web deployment ID and requires the
coordinated final-pair Trust refresh with full immutable-history preservation.

### Frozen-source fixture resume and tool audit (October 28)

The first fixture attempt created only A's `Review examples` category, then its
Behavior RPC returned HTTP400. Both accounts had zero fixture Behaviors on the
bounded readback. The provider error body was discarded; its SQLSTATE is unknown.
Offline reproduction found mixed sources: the eb5afa5 planner included
`where_kind`, but the workspace's older serializer omitted it. That payload
violates the frozen SQL configuration validator. This is a demonstrated runner
defect, not evidence that hosted grants need changing.

`scripts/build-mcp-hosted-fixtures.mjs` builds the execution entry from exact
`eb5afa5be5c49b43bbad3ffd5a25d6eddff30079` Git objects. It explicitly binds
`@cadence/core` and `@/` to that archive, rejects other product-source inputs,
checks each input against its Git blob, and checks the external runtime
dependency versions against that source's lockfile. It writes a private bundle
and hash receipt. It does not connect to a provider. Under Node24:

```bash
node scripts/build-mcp-hosted-fixtures.mjs /private/path/in/workspace/resume.mjs
```

The output must live under this workspace so Node resolves the checked runtime
dependencies. Import its `runFixtures` export in a private Node24 child; pass
`allowHostedProject: "qjodzutjxtmtzczbloxa"`, `mode: "preflight"` or `"resume"`,
the publishable key and ordinary A/B sessions through stdin/process memory.
Never save session input or invoke the unbundled entry. `import.meta.fixtureSource`
is absent outside the verified bundle, so the entry refuses direct execution.

This is a one-run recovery, not a general seed command. It reuses only A's
captured category `a29dd2d0-5425-4180-a29a-01a026ebb8c0` and Review walk
`b2c5b6b1-457a-4e58-a14f-e4270c3d341e`. The October 28 18:11 UTC attempt
created that Behavior's schedule/slot, eight October 21–28 Occurrences and one
Completed event before the Not Completed RPC returned HTTP 400. The runner had
supplied a null effective timestamp. Frozen SQL requires the Not Completed
effective, recorded and marked timestamps to match. The isolated rehearsal
reproduces SQLSTATE 22023; the hosted response SQLSTATE was not captured.

The repaired entry uses the frozen shared status resolver and one clock instant.
It checks the retained `resume-started.json` and `resume-fixture-ids.json`, every
captured row ID/owner/creation timestamp, schedule, status, note and history
configuration before writes. The category name and both timestamps must still
match. Missing captured rows, changed captured content, other fixture Behaviors
or a B category refuse. Only validated generated Occurrences may be added. It never recreates A's category, walk, Occurrences or Completed
event. It finishes A's Not Completed transition/time session, reading and archived
stretch, then all of B through the same supported paths. Reminder settings stay
off. No admin, schema or grant change is part of the hosted runner.

The original run ID, start time and initial D=`2026-10-27` stay fixed.
The operator supplies `executionDate` explicitly as `YYYY-MM-DD`. It must equal
the actual Temporal New York date before any request. Never inject an old clock
or derive the input silently. The exclusive `completion-started.json` records
initial D, execution D, actual New York date, actual attempt timestamp, original
run/source, prior resume and the capture deadline. Original receipts stay
byte-unchanged. Any further partial write still stops replay for reconciliation.

New fixtures cover execution D minus seven days through D. A's retained walk
reuses its existing eight original plus validated generated Occurrences. The
runner refuses if that graph cannot cover the current eight-day range. It keeps
A's original October25 Completed event and October27 note target. It finishes
only October26 Not Completed and the October25 ten-minute time session. It
never moves those historical actions to a new date. B uses the current range.

The exact original run ends **2026-11-04T02:17:18.882Z**, seven days after its
original start. November5 would be nearly eight days, not seven. The runner,
manifest generator and archive SQL enforce the explicit bound. Other run IDs
retain 48 hours. On the final permitted New York day (November3), October27
still falls within the isolation script's seven-day range. No isolation guard
needs widening.

New IDs and creation receipts use `completion-fixture-ids.json` and
`completion-creation-receipts.json`; pass the former to the isolation script.
Creation receipts contain IDs, owners and creation times only. Cleanup retains
the original start and the explicit November4 boundary. A later capture requires
reconciliation. The repair never substitutes a new run clock.

`tests/mcp-hosted-fixtures.local-integration.test.mjs` is a separate opt-in local
harness. It requires Homebrew Supabase 2.109.1, loopback port 56121, the isolated
`cadence-mcp-232` database and all 94 frozen migrations. It seeds a synthetic
replica with the captured IDs/timestamps, eight original and30 generated
Occurrences. It tests remaining A/B operations at the actual current time,
real session refresh, isolation, manifest refresh, and archive. The historical
SQLSTATE22023 reproduction remains in the earlier rehearsal receipt. Only this harness redirects the injected transport. Hosted guards remain
unchanged. Local-only privileged seeding never runs through the hosted entry.
Offline guards prove changed-partial refusal. The complete local flow proves
no replay, preserved Completed history, notes, time sessions, original receipt
bytes, three unrelated Behaviors and96 unrelated Occurrences.
Rehearsal success does not authorize a hosted retry without independent review
and fresh session/target preflight.

Before archive cleanup, refresh the manifest through ordinary A/B sessions.
Include every row derived from the captured original Behaviors and client-created
`Review practice` IDs. Retain the original creation receipts and record the
refresh separately. Never adopt a pre-existing Behavior or an unattributable
row; refuse on missing lineage or an exhausted row bound. The archive transaction
still enforces exact closure and preserves categories, Occurrences and history.

Before resume writes, `assertPartialGraph` also pins the 30 generated rows
from the retained October28 capture by ID, owner, Behavior, creation time, date
and status. Existing schedule/content checks still apply. Missing or replaced
rows stop the run even when the total count is unchanged; only then can new
validated descendants join the manifest. Preserve the retained capture.

Use `graphReceipt` on the approved captured graph to retain per-row hashes,
not note text. `refreshGraphReceipt` requires every captured row/hash to remain
unchanged, and accepts only new Occurrences. It validates user/Behavior lineage,
creation time, unresolved/null-note state, untouched timestamps, unique schedule
identity, and membership in the frozen recurrence resolver's captured schedule.
Generated dates start October29 and stop at the current day plus30. Record these
IDs separately as `app-generated`; this describes their accepted provenance
class, not proof of which client wrote them. Account-scoped sync state stays
outside the manifest.

Take an explicit checkpoint after each authorized client mutation or isolation
note restoration. Compare that operation's captured IDs and expected changes
before accepting its new baseline. Never replace a hash baseline merely because
it fails. Unknown note/status/edit/deletion changes stop the run. A new client
Review practice Behavior needs its own creation receipt before capture. The
refresh helper cannot add Behaviors, schedules or history implicitly.

#### Session continuity and the owner window

**Superseded October 29, 17:50 UTC (owner decision): the A/B sessions now come
from the local sign-in broker below, not from the owner's Cadence tabs.** This
agent session has no browser channel to those Chrome profiles. The tab-cookie
plan in the next paragraphs is retained as history only.

##### Local sign-in broker (`scripts/mcp-session-broker.mjs`)

- Transport: Cadence's ordinary hosted Supabase Google OAuth with PKCE and the
  publishable key only. No service role, admin link or provider credential. The
  start step adds only `prompt=select_account` so Emi picks the dedicated account.
- Redirect: the exact allowlisted `http://127.0.0.1:<port>/auth/callback`. Ports
  are tried in ascending order from 4321 to 4330; the first one that is exactly
  allowlisted and free on both loopback addresses is used. Startup reads
  back `uri_allow_list`, the Site URL and Google enablement through the read-only
  Management API. It requires the exact callback entry and does not change auth
  configuration. The 17:53 UTC readback found all 20 `127.0.0.1` entries for
  4321–4330, Site URL `https://app.cadence-me.com`, Google enabled, `jwt_exp`
  3600 and refresh-token rotation with a 10-second reuse interval
  (`auth-allowlist-readback.json`).
- Binding: HTTP on 127.0.0.1 only; exact `Host` check; GET only; no-store,
  no-referrer, `default-src 'none'` CSP and frame denial; header/request timeouts
  of 5 and 10 seconds; 15-second provider-call timeout; at most four pending
  attempts, counting reservations taken before the provider call. A failed
  start releases its reservation.
- State: each attempt has its own in-memory PKCE verifier and a 256-bit HttpOnly
  SameSite=Lax cookie scoped to the callback path. Attempts expire after five
  minutes and are deleted on their first callback. The code is exchanged once in
  the broker process, and the browser is sent on to a fixed result page.
- Identity: `auth.getUser` must return exactly A
  `caefd1b8-ea46-485f-8869-119a715fb092` for slot A, or B
  `c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b` for slot B. Anything else, including the
  other test account, is signed out with local scope and dropped. `discarded` is
  reported only when the provider confirms the sign-out. On any sign-out error
  the client stays in a bounded in-memory cleanup list, retried every 30 seconds.
  The page then says `wrong account: sign-out pending, tell the operator`, and
  status shows only a `cleanupPending` count. New attempts are refused while
  eight cleanups are pending. The page shows only `signed in as A/B: match`,
  `wrong account: discarded`, that pending notice or a retry notice.
- Custody: sessions stay in broker memory. Runner processes receive access tokens
  through the Unix socket `~/.cadence-qa232/broker.sock`. The socket is 0600 and
  its directory 0700, owned by the operator; anything else is refused. A live
  socket at that path (another broker) is refused, and only a stale socket owned
  by the operator is replaced. The broker binds a private name and hard-links it
  into place, so it never replaces an existing path. Teardown removes the public
  path only if it is still the broker's own inode. Tokens are
  never written to disk, notes, chat, logs or artifacts. Log lines are fixed
  event names. `session-broker.jsonl` (0600) records only slot, subject, expiry,
  kid and state.
- Refresh: every 30 seconds the broker refreshes any session within 15 minutes of
  expiry. A handoff requires at least 10 minutes of remaining validity. These are
  separate sessions from the owner's browser tabs, so no refresh-token race with
  the tabs occurs.
- Teardown: SIGINT, SIGTERM, the `teardown` command or a five-hour lifetime limit
  first refuses new HTTP and socket work. It then waits for in-flight sign-ins
  and refreshes to finish, so nothing is stored afterwards. Next it signs out
  both sessions with local scope and retries unconfirmed sign-outs three times.
  Finally it clears memory and closes both servers. The receipt and the final log
  line report `unconfirmedSignOuts`. Any nonzero count must be reported and must
  not be described as revoked. Repeated teardown calls, such as a second signal,
  return the same pending result. Run teardown when the run ends or aborts.

##### Key rotation with broker sessions

1. Immediately before rotation, send `pin`. The broker force-refreshes A and B on
   the current kid `cb295840-0eb2-4b4a-a1ba-c28c5b975361`. It then copies both
   access tokens as the pre-rotation baseline, requiring at least 30 minutes of
   validity (normally about 60). The pin fails if either refresh fails, and stale
   tokens are never pinned. It is write-once: a second `pin` is refused, and the
   baseline is never refreshed. A new sign-in after pinning marks the pin
   `invalidated`. Rotation must then stop until a fresh, reviewed broker run.
2. Rotate while MCP stays disabled, then allow the documented propagation time.
3. Send `refresh`. The live sessions must now carry the new kid; this is the
   fresh new-kid session. Verify both live and pinned tokens with `auth.getUser`
   and an exact own-profile read. The pinned old-kid token must still pass.
4. Emi does not sign in again after rotation. One sign-in checkpoint per account
   is needed only if a refresh fails (state `refresh-failed`). If the verifier
   wants a fresh-login proof as well as a refresh, that is one extra A sign-in on
   the same page, taking about a minute.

##### Key custody script (`scripts/mcp-signing-key-custody.mjs`)

Step 2a runs before the pin. It refuses unless `/mcp` returns 503, the only vault
named Cadence has ID `fgyupy5i26isvkdqofojc5o66u`, and no custody document has
the fixed title. The signing keys must be exactly the frozen pair: `78be1780…`
HS256 previously_used and `cb295840…` ES256 in_use. The Production signer
variable must be absent. Every CLI and API read needs a success status and the
expected array or object shape. Every row field a check reads must also be
present with the right type: vault ID and name, item title, env key and
signing-key ID, algorithm and status. A failed, unparseable or missing response
or field stops the run and is never treated as empty. It then generates one ES256 JWK in
memory. That JWK is piped over stdin to `op document create /dev/stdin`, and the item
metadata and stored document are read back and compared. Next it imports the key
to Supabase as standby only and requires the same kid and public fingerprint,
with every old key unchanged. Finally it creates the env record with exactly one
direct `fetch` POST to `https://api.vercel.com/v10/projects/<web>/env?teamId=team_BxWfRYU1gqrl6Ba6t7Vm3wp1`.
The JSON body carries the key, type sensitive and target production. The request
uses `redirect: 'error'` and a 30-second timeout. Only a 2xx response body is
parsed, in memory, for the fields below; other bodies are discarded. The bearer token is the existing Vercel CLI credential, read into memory
from the CLI's `auth.json` at write time and never logged. Preflight requires it
to stay valid for at least 30 more minutes. Success requires a 2xx whose body
holds exactly one created record with an `id`, the same key, type sensitive and
target production, and no failures. The returned value field is never kept. The
later readback must find that same record `id`. A 4xx is `rejected`. A throw, reset, timeout, 5xx,
other status, or a 2xx body that doesn't prove the create is `ambiguous`. Either
way the script never re-POSTs. It records a read-only reconciliation of whether
the record exists and stops. Every CLI read pins
`?teamId=team_BxWfRYU1gqrl6Ba6t7Vm3wp1`; the installed client keeps an explicit
teamId rather than substituting `currentTeam`. The script then reads back a
Production-only sensitive record through the CLI and rechecks `/mcp` 503.

Limitation: a sensitive Vercel value can't be read back. The metadata readback
proves the record's name, target and type, not that the stored JWK is intact.
A/B session continuity after rotation proves Supabase trusts the key; it does
not prove the stored Vercel value either. Proof that the deployed signer
carries the right key is separate: it comes from the activation deployment's
own token minting and isolation checks.

Attempt 1 on October 29 at 19:03 UTC failed safely. Given `-`, op checks for
stdin data the moment it starts, so it raced the runner's write and exited with
"expected data on stdin but none found". No item, import or env change resulted,
and the key was never stored. A harmless runner-path probe of `/dev/stdin`
succeeded, and the probe item was deleted by exact ID. `vercel env add` was also
replaced: its stdin reader keeps only the first data chunk and gives up after 500
ms, which could store a truncated secret. `vercel api --input -` reads to EOF.
The offline `--generate=curl` check (`vercel-api-stdin-check.json`) delivered a
200 KB body written in two chunks over 3 seconds intact. The installed CLI 65.1.0
`api` client retries failed requests: the verifier saw four POST attempts on a
connection reset. The secret-bearing write therefore bypasses the CLI, so a
reset, 5xx, 4xx or timeout is a single failed attempt that stops the run. After the import, both frozen tuples
must be unchanged and the only addition must be the expected standby kid. The
private key never appears in argv, files, logs or the 0600 receipt
`step2-custody.json`. Adapter, subprocess and internal errors become fixed phase
codes, with no raw message, body or cause. The exported `createRunner` handles
spawn, child, stdin (for example EPIPE) and timeout failures, and any nonzero
exit. Each settles once with status 1 and empty stdout and stops the child, and
a later exit 0 cannot override it. A top-level
catch covers `main`. There are no retries. The receipt records the phase and
whether a write was attempted, plus a `custody-created` step with the document
ID, so an ambiguous write can be reconciled. There is no rotation or redeploy in
this script. Evidence: 55 offline cases, including direct regressions for the
b12e0bc and 34821fd findings, the stdin-path forms, a direct EventEmitter runner
harness, direct one-attempt writer cases (reset, timeout, 5xx, 3xx, 4xx and nine
2xx body shapes) and ambiguous/rejected reconciliation, and 49/49 mutation kills
(`key-custody-mutations.json`).

##### Activation signer gate (step 3)

The Vercel-stored JWK can't be read back, so its integrity is unproven until the
deployed server uses it. Immediately after the activation redeploy reaches
READY, the FIRST check is one minimal authenticated MCP call as A: one read
tool, through the Inspector or a scripted OAuth client against the deployed
`/mcp`. That call makes the server mint an integration token with the stored
key and pass it to Supabase under RLS. Success means the call returns A's own
data and nothing else. If the call fails for any signing, token or 401/403
reason, roll back at once: set `CADENCE_MCP_ENABLED` false, then a same-source
redeploy, keeping every key. Do not start client acceptance, Trust or any other
step until that call has passed. Record the deployment ID, the grant ID, the
tool name and the result status only.

##### Activation scripts (`scripts/mcp-activation.mjs`, `scripts/mcp-activation-gate.mjs`)

`node scripts/mcp-activation.mjs enable` (or `rollback`) uses single direct
Vercel REST attempts pinned to `team_BxWfRYU1gqrl6Ba6t7Vm3wp1` and project
`prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`, with no CLI retry client. It first checks
these preconditions:
- the decrypted marketing binding equals `dpl_FxBP12vZPRz3mrdytwCNWrjdXwhj`;
- the decrypted `CADENCE_MCP_ENABLED` is exactly `false`, on the Production-only
  encrypted record `iBPzBCetdvLWtmSN`;
- the frozen web deployment `dpl_AE8GhYkk265Ek9tYdYTEc4bD8EgL` is READY from
  eb5afa5, the canonical alias is on it, and `/mcp` returns 503.

It then makes one PATCH of the flag, followed by an exact decrypted readback,
and one POST `/v13/deployments?forceNew=1` that redeploys the frozen deployment
to production. A bounded poll waits for READY. The readbacks require:
- the new deployment READY from eb5afa5 in the exact project;
- the canonical alias moved to the new deployment, with no other production
  deployment since the start;
- an unchanged marketing binding;
- for enable: `/mcp` returning 401 with the `resource_metadata` challenge, the
  issuer, and the protected resource. Rollback requires 503 instead.

A rejected or ambiguous write is reconciled read-only (the flag value, or the
production deployments since the start) and is never repeated. Response bodies
and tokens are never stored.

Rollback is the safety disable. It requires only the exact flag record (id, key,
encrypted, Production-only) and the READY frozen deployment. Binding, alias and
other-deployment drift, and an unreadable binding or pre-redeploy alias, are all
recorded but never block it. After the redeploy it still requires the alias on
the new deployment and `/mcp` 503.

`node scripts/mcp-activation-gate.mjs` binds a loopback page on 127.0.0.1 on
the first free port, tried in ascending order from 4321 to 4330. A bind error
moves to the next port. Only after binding does it register one public native
DCR client, using PKCE S256, scope `cadence.read` and the `/mcp` resource. After
A's consent it makes one token exchange and one `list_behaviors` call through
the MCP SDK. One deadline aborts all in-flight requests, and no work continues
after it. The gate passes only if the result is not an error and every returned
ID is one of A's six captured Behaviors: the fixture walk, reading and stretch,
plus `083ddfb7…`, `72472a62…` and `94e8cb9f…`. The result must also include the
active walk and reading fixtures, with no duplicates and no B or unknown ID. Any failure means
`rollback` runs at once. Evidence: `tests/mcp-activation.test.mjs` and
`activation-mutations.json` (37/37).

##### Emi's steps

1. The operator starts the broker and relays the exact URL, `http://127.0.0.1:<port>/`.
2. In Chrome profile **Identity Scaffolding**, open that URL and choose **Sign in
   test account A**. In Google's chooser pick dedicated account A, and wait for
   `signed in as A: match`.
3. Then, in **Emi Chrome**, open the same URL and choose **Sign in test account
   B**. Pick account B and wait for `signed in as B: match`.
4. On `wrong account: discarded` or a retry notice, repeat that profile's step
   within five minutes. The existing Cadence tabs are not touched.

Evidence: offline `tests/mcp-session-broker.test.mjs` (22 cases) uses a fake
GoTrue behind real supabase-js, so the actual PKCE storage path runs. Seven
cases are direct regressions for the 10f8ab2 review findings. All seven fail
against 10f8ab2 (`session-broker-regressions-old.log`). All 28 guard mutations
fail the suite while the unmutated copy passes (`session-broker-mutations.json`). The opt-in
`tests/mcp-session-broker.local-integration.test.mjs`
(`CADENCE_QA_BROKER_LOCAL=1`) ran against a disposable auth-only CLI 2.109.1
stack `cadence-qa232-broker` on ports 56120–56127, which was stopped and removed
afterward. Local Google is unavailable, so its injected starter uses a PKCE magic
link. Real code exchange, replay refusal, wrong-account and other-test-account
discard with zero remaining server sessions, pin/refresh continuity and teardown
to zero sessions all passed (`session-broker-local.log`). Live Google sign-in,
production rotation and new-kid issuance remain unverified until execution.


The frozen app's Settings page has no browser-client refresh loop. Merely leaving
it open is insufficient. The frozen server proxy calls `auth.getClaims()` and
passes refreshed cookies to the browser through `setAll`. The installed frozen
Supabase SSR/Auth versions are0.10.3/2.107.0. The local rehearsal simulates an
expired cached session and proves the real refresh-token endpoint, subject,
new expiry and cookie writes for both accounts. This is not a live browser proof.

During production, navigate/reload only each approved Cadence Settings tab near
expiry, then read scoped cookie metadata in memory. Require the exact subject,
current kid and a valid expiry before each phase; capture no token. Do not run
a separate refresh-token client alongside the browser. Keep a valid pre-rotation
JWT in memory before rotation and compare it with a fresh new-key session after
rotation. Refreshing or losing that baseline cannot count as continuity proof.
If the server does not renew cookies, stop for the matching Google sign-in;
never repeat a mutation with stale sessions.

Reserve **150 minutes** with the owner, with a30-minute contingency. Owner steps:
(1) open/re-authenticate both exact Cadence profiles and keep them available;
(2) approve 1Password/Touch ID if prompted during custody creation;
(3) approve each Claude web, Claude Code, ChatGPT developer-mode and Inspector
consent, using only the dedicated accounts; (4) unlock the test Mac if needed.
The operator checks sessions at preflight, before key rotation, before client
acceptance and before grant revocation. Normal refresh needs no Google sign-out.
If refresh fails, at most one sign-in checkpoint per account per affected phase
is attempted before stopping to reschedule. There is no guarantee that all
third-party clients finish within150 minutes.

#### Production-only steps after the local rehearsal

| Step | Preconditions | Readback and stop rule |
|---|---|---|
| Key custody and rotation | Frozen main/READY pair, PR161 held, MCP503/false; both valid ordinary subjects; Cadence vault ID fgyupy5i26isvkdqofojc5o66u; fresh pre-rotation session baseline. | Generate one ES256 key in memory, pipe to op document create, metadata/public-key match; standby kid match, signer env set, rotate while disabled, retain old keys. Verify fresh new-kid and still-valid old-kid sessions. Stop on any mismatch; no repeat key creation. |
| Isolation and timeouts | Captured complete fixtures, reviewed script; current signer kid; exact postgres cleanup transport proved separately. | Own RPC writes pass, cross-account/expired/untrusted tokens fail, note restored. Catalog-only owners/SECURITY DEFINER/proconfig/ACL/role timeouts are metadata, not backend cancellation proof. No manual cron or sleep probe. |
| Activation | Isolation/continuity pass; no competing deployment; frozen source and marketing unchanged. | Set MCP true and correct marketing binding in one env phase, one same-source web redeploy. Require READY/new web ID/source, unauthenticated401, issuer/no-store/CORS. Failure rollback: MCP false plus same-source redeploy; retain all keys. |
| Trust | Final web ID plus frozen marketing ID; no scheduled run competing; actual source workflow/lock unchanged. | Hash all immutable history bytes first. One normal Preview, false RLS/false init; validate tuple/artifacts/history before Production. Stop on failure or adverse gate; no waiver or blind retry. Retain any intervening immutable additions. |
| Clients and test Mac | Owner present; explicit A/B identities; only approved fixtures; exact final connector URL. | Capture each consent/grant ID and client result, cross-account refusal and test-Mac A sync. No owner real data. Missing client access remains unverified. |
| Archive and grants | Approved mutation checkpoints, refreshed lineage/hash manifest; exact postgres role/privileges, deadline not reached. | Archive only captured IDs; preserve all rows/accounts, revoke only captured grants as their user, verify old tokens fail. Read back archive/history/counts and unchanged baselines. No client deletion/purge. |


| Step/tool | Source and import audit | Execution rule |
|---|---|---|
| Fixture creation, archive-stretch and status helper | Verified bundle above: all product imports are eb5afa5; external Supabase/Temporal dependency closure matches its lockfile. | Use only the new bundle and captured receipt; the original mixed bundle is retired. |
| Category, Occurrence and time-session payloads | Fixed execution entry; no workspace-package imports. Category INSERT retains initial authenticated grant; Occurrence columns are explicitly granted in `20260815023424`; time-session INSERT is granted in `20260802000000`. | Exact A/B users and captured Behavior IDs; stop on denial, never switch roles. |
| Session identity/continuity | Supabase JS `auth.getUser` and exact profile-ID reads; browser session capture is origin/account-bound and stays in memory. No product-package imports. | Owner's Cadence tabs only; renew the pre-rotation baseline if old tokens expire. |
| Key generation/custody/import and environment operations | Node crypto, op, bounded Management API and Vercel CLI; no workspace-package imports. These are planned operations, not completed key proof. | Fixed project/vault/name, secret stdin or memory, metadata/public-key readbacks; no diagnostic helper reuse. |
| Hosted isolation | Reviewed `scripts/mcp-hosted-isolation.mjs` imports Node builtins, Temporal and `lib/supabase/integration-token.ts`. The signer is byte-identical to eb5afa5 and imports only Node crypto. No `packages` import. | Keep the reviewed script; same-value Behavior RPC uses the actual read graph with null configuration plan. No raw Behavior PATCH. |
| Timeout/privilege metadata | Fixed catalog-only SELECTs; no product imports. General-query postgres preflight returned HTTP201 with required booleans true at02:01:50UTC. | Preserve the proven cleanup transport; metadata is not cancellation proof. |
| Trust workflow/collection | Workspace workflow, prepare helper and collector differ from eb5afa5. They must not drive release evidence. | Dispatch the normal remote workflow only after verifying main still equals frozen source; it checks out that source. Use frozen-source history/validation scripts and lockfile, not workspace npm aliases. |
| Client consent and grant revocation | Actual frozen deployed UI/RPC and client OAuth flows; `oauth.repo.ts` is byte-identical and has type-only imports. | Owner handles consent; no local smoke/admin-consent substitution. Revoke only captured grant IDs as the owning user. |
| Test Mac helper | `scripts/test-device.mjs` is absent from this old workspace; eb5afa5 has it and its AX helpers. Node builtins only. | Extract the exact frozen helper set; preserve test-Mac account/data and do not install or relink. |
| Cleanup generator/transaction | Reviewed `mcp-fixture-cleanup.mjs` imports only Node builtins and reads the reviewed SQL template. SQL calls current database functions; no workspace serializer. Verified against eb5afa5's94 migrations. | Hash-bound refreshed manifest, confirmed postgres transport, archive only. No grant changes. |

This repair changes QA tooling only. Web, marketing and desktop product code are
unchanged; future mobile has no implementation impact. No hosted retry, key
operation or activation is authorized by a successful offline test alone.

### Grant basis and real local verification

| Call | Permission and ownership basis |
|---|---|
| Profile GET / timezone PATCH | Initial SELECT and owner policies (`20260607204951`); `20260825061411` revokes broad writes and explicitly grants only UPDATE(timezone). |
| Category GET / name PATCH | Initial SELECT/UPDATE and owner policies; `20260815015023` revokes DELETE, not name UPDATE. |
| Behavior GET | Initial SELECT and owner policy, retained after `20260815015023` removes direct writes. |
| Embedded schedule/slot GET | SELECT and owner policies in `20260626140000` / `20260609202707`; direct write revocations retain SELECT. |
| Behavior RPC POST | Explicit authenticated EXECUTE in `20260815015023`; latest replacement `20260827071000` and later field-preservation patches. This existing SECURITY DEFINER function checks auth.uid(), looks up the target with user_id=auth.uid(), and returns null for a foreign target. It also validates exact expected graph/timestamp. This is ownership enforcement inside the supported RPC, not a new RLS bypass. |
| Occurrence GET / note PATCH and restoration | Initial SELECT/owner policies; `20260815023424` regrants UPDATE(note,status,completed_at,status_marked_at) after broad UPDATE revocation. Exact ID and expected-note filters bound both mutation and restoration. |
| Expired/wrong-key profile GET | The same SELECT path; Auth/PostgREST JWT rejection must occur before the query. |

The surrounding execution runbook uses the ordinary web services for fixture
creation: `manage_categories` (authenticated EXECUTE, auth.uid()-bound checks in
`20260905035835`), `create_behavior_with_schedule_graph` (authenticated EXECUTE,
owner-derived inserts in `20260815015023`), and
`apply_occurrence_status_transition` (authenticated EXECUTE, owner-scoped target
in `20260709203117`). Plain note edits use the permitted note PATCH above;
shortcut edits use `update_occurrence_note_with_shortcut` with authenticated
EXECUTE and owner checks in `20260908003245`. Synthetic time-session start/stop
uses the INSERT/UPDATE grants and owner RLS in `20260802000000`. Consent and
revocation use authenticated `oauth_approve_consent` / `oauth_revoke_grant`,
which bind to auth.uid() in `20261018160000`; token endpoints remain service-only.
No fixture setup requires granting raw Behavior writes. Management API metadata,
signing-key operations and Vercel configuration use separately authorized
provider access; they are not user RLS tests. Physical deletion remains outside this archive procedure and requires a separate
exact ID-bound transaction and dependency review.

`tests/mcp-hosted-isolation.local-integration.test.mjs` imports the **same**
runHostedIsolation function. Its separate, opt-in transport accepts only
http://127.0.0.1:56121 and forwards the pinned hosted requests to that isolated
stack. It never relaxes the CLI hosted-project guard or existing local-suite
guards. Set CADENCE_MCP_HOSTED_ISOLATION_LOCAL=1 plus the existing
CADENCE_LOCAL_SUPABASE_URL, CADENCE_LOCAL_SUPABASE_SERVICE_KEY,
CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY and CADENCE_LOCAL_INTEGRATION_SIGNING_KEY
through a private process environment. Use only the assigned cadence-mcp-232
private workdir/project and ports56120–56129, with the project-scoped Docker
proxy and loopback readback. Never run against the default local project.

The harness uses the Auth admin API only for two disposable local users. All
fixture metadata and preservation reads use ordinary A/B authenticated sessions
with explicit user and ID filters. It holds no service-role table-read assumption.
The bounded local cleanup SQL runs as postgres through the exact isolated
container. CLI2.109.1 defaults can revoke service_role table SELECT; do not add
grants to make the harness pass. It signs users in normally and seeds through
existing core/web services.
It confirms direct own-Behavior PATCH is403, then runs the entire corrected
procedure: three own RPC successes and three foreign null responses, invalid
JWT denial, all other own/foreign table operations and note restoration.
It compares complete Behavior/schedule graphs (allowing own updated_at changes)
and requires B's graph to remain byte-equivalent. This is local SQL evidence,
not proof of hosted acceptance. No hosted call occurs in this harness.


### Timeout evidence: metadata only

Use the established CLI credential in memory and the Management API's dedicated
`/v1/projects/qjodzutjxtmtzczbloxa/database/query/read-only` endpoint. Do not use
the mutation query endpoint, assume a Management session is PostgREST, or print
credentials. Run these SELECTs only; record the result with observation time:

```sql
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
       p.proconfig, p.proacl::text as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('oauth_purge_expired', 'oauth_verify_access_token',
   'oauth_rotate_refresh_token', 'integration_apply_write')
order by p.proname;

select r.rolname, r.rolcanlogin, r.rolbypassrls, coalesce(r.rolconfig, '{}') as settings
from pg_roles r where rolname in ('authenticator', 'authenticated', 'service_role')
order by r.rolname;

select coalesce(r.rolname, 'all') as role, coalesce(d.datname, 'all') as database,
       x.setting
from pg_db_role_setting s
left join pg_roles r on r.oid = s.setrole
left join pg_database d on d.oid = s.setdatabase
cross join lateral unnest(s.setconfig) x(setting)
where (s.setrole = 0 or r.rolname in ('authenticator', 'authenticated', 'service_role'))
  and x.setting ~ '^(statement_timeout|lock_timeout)='
order by 1, 2, 3;
```

Compare function owner, SECURITY DEFINER, search_path, timeout overrides and ACL
to the reviewed migration, including any database-specific role overrides.
These records describe configuration. They do not prove a live PostgREST session
loaded it, a cancelled HTTP call terminated SQL, or a nonzero purge completed.
Do not call `oauth_purge_expired`, all-account scheduler routes, `pg_sleep`, locks,
or customer-record queries to manufacture that evidence. No production timeout
probe is included: it would require a separately reviewed isolated, no-customer-
impact design and explicit approval. Retain this gap in activation readiness.

### Activation order and release coordination

Keep MCP disabled. After exact key-operation approval, generate one ES256 key in
approved private custody, import standby, verify its public kid and set only the
matching server secret. Rotate it to current **while MCP remains disabled**.
Then verify fresh and pre-rotation synthetic sessions, run the approved bounded
isolation check and review timeout evidence/gaps. Enable only after those gates
pass and the owner grants all-user activation authority. Preserve all existing
keys and session overlap; do not revoke them. Refresh jwt_exp/cache requirements
before selecting the overlap (3600s plus15minutes was the recorded baseline).

The activation redeploy changes the web deployment ID. Coordinate one final
Trust refresh for that resulting web ID and current marketing ID with the other
release owner. This workspace must not compete with its binding/deploy/migration
work. Final client/desktop acceptance and cleanup follow; directory submission
is excluded. No key or hosted operation is authorized by this local preparation.

Owner inputs to fill before execution:

- A is selected and its test-Mac prefix matches. B's address, both actual Auth
  UUIDs, fixture IDs and exact synthetic-operation authority remain to fill.
- Owner reports Claude web, Claude Code, ChatGPT developer mode and Inspector
  available. Record versions and verify access during acceptance.
- Desktop target is the test Mac. Follow the current desktop-acceptance skill,
  DESKTOP_RELEASE agent-run acceptance and TEST_DEVICES pathway; retain its assigned
  published release. Do not use the owner's primary Mac/data as fixtures.
- Key custody is 1Password. The owner must enable CLI integration and name the
  destination vault/operator; the reported installed CLI has no signed-in account.
  Do not sign in for the owner or expand the existing read-only service account.
  After approval, generate one ES256 JWK in memory and pipe directly to
  `op document create - --vault APPROVED_VAULT --title APPROVED_TITLE --file-name integration-jwk.json`.
  Capture only the item reference and safe status, never plaintext output, argv,
  clipboard or temporary files. Verify custody before import; on an ambiguous
  create, inspect metadata before retrying. No key has been generated or stored.
- Exact final production source/pair, all-user key/session/activation authority,
  acceptance of any remaining timeout-proof gap or a separately approved probe.

## Historical local acceptance — October 18

Date: 2026-10-18. Starting foundation: `1cb5314d42d1e22e577d3b3685586a4ba924bd61`.
Branch: `mcp-create`. Implementation commit `1bbdca5`; Inspector tested with
Ticket 227 UI at `7019a80`. No hosted actions or deployment. Inspector OAuth and
all 16 tool happy paths passed. The error-display limitation below remains.

## Runtime and isolation

- Node 26.0.0 / npm 11.12.1 through `/opt/homebrew/opt/node@26/bin`.
  Node 24 is requested by the repository but unavailable here.
- Official server SDK 2.3.1; client SDK 2.3.1 is dev-only.
- Disposable Supabase project `cadence-mcp-228`, API `127.0.0.1:56921`,
  Postgres `127.0.0.1:56922`. A private Docker proxy forces published ports to
  loopback and rejects container creation outside the assigned project.
- Synthetic users only. Ephemeral signing keys, session tokens and service keys
  remain in a private temporary directory or process memory. No repository env
  file or hosted credential is used. Each test deletes its own users and client.

## Automated evidence

`tests/mcp-server.test.ts` uses the official SDK against the route. It verifies
modern 2026-07-28 discovery and tool calls, registry equality, deterministic order,
private cache hints, OAuth metadata, absence of the incompatible OpenAI profile
marker, all five accepted legacy versions, 401/403/429, output-error envelopes,
Origin checks, CORS, body limits, kill switch and sanitized monitoring.

`tests/mcp-operation.test.ts` verifies scope-before-admission, per-grant rate
limits, admission backend failure, real read-output validation and exactly one
activity owner. Successful writes never receive transport-level postcommit
validation or duplicate activity.

`tests/mcp-server.local-integration.test.ts` runs the actual route, token verifier,
RLS context and operation handlers against local Supabase. Both modern `auto`
and legacy clients pass the following checks:

| Check | Result |
|---|---|
| All 16 tools, compared with the registry | Pass |
| Create retry returns identical bounded result; one activity per attempt | Pass |
| Second account cannot read or mutate first account records | Pass |
| Read-only grant rejects writes with 403 and ChatGPT step-up metadata | Pass |
| Durable independent 120-read / 30-write limits return 429 + Retry-After | Pass |
| Oversize result fails before changing the occurrence status | Pass |
| Expired, revoked and wrong-resource tokens return 401 | Pass |

The integration suite requires `CADENCE_LOCAL_SUPABASE_URL`,
`CADENCE_LOCAL_SUPABASE_SERVICE_KEY`, `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY`
and `CADENCE_LOCAL_INTEGRATION_SIGNING_KEY`, supplied privately. It refuses any
API URL except the assigned loopback URL. Run with:

```sh
npx vitest run tests/mcp-server.test.ts tests/mcp-operation.test.ts
npx vitest run tests/mcp-server.local-integration.test.ts
```

Evidence: focused 24 tests pass; local 12 tests pass (rerun with SDK-client
error assertions at 17:57 UTC); full suite 2,758 passes and 91 skips at 17:50 UTC.
Lint, `agents:check`, `interactions:check`, `resolvers:check` and
`typecheck` pass. Production build passes with `/mcp` emitted as a dynamic Node route.

## Protocol and client limits

Accepted protocol versions: 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26,
2024-11-05 and 2024-10-07. The official SDK handles both eras; no compatibility
protocol is implemented by Cadence. New SDK clients default to legacy; use
`versionNegotiation: { mode: "auto" }` for modern negotiation. Legacy GET/SSE
subscriptions and session resumption are not supported by this stateless route.

The optional `openai/profile` marker is omitted. OpenAI requires an identity-only
schema incompatible with `get_account_context`. Connections work without it;
account labels and duplicate detection may be less reliable. A new compatible
tool remains deferred. [Official guidance](https://developers.openai.com/plugins/build/auth#support-multiple-accounts).

No live Claude/ChatGPT connection, directory approval, hosted deployment or
Node 24 execution is claimed. Those release checks remain separate.


## MCP Inspector 2.11.0 — actual browser run

17:52–17:57 UTC, 2026-10-18. Cadence `next dev` bound to `127.0.0.1:4321`;
Inspector web at `127.0.0.1:4324`, sandbox/app listeners at 4325/4326, all loopback.
4322 and 4323 were occupied when the ports were selected. Inspector was installed
through npm exec, with no repository dependency. Private catalog/storage paths,
`MCP_INSPECTOR_SECRET_STORE=memory`, `MCP_INSPECTOR_PERSIST_TOKENS=none`, and
browser auto-open disabled kept test credentials out of the normal Inspector profile.
The embedded workspace browser failed to mount; a dedicated Chrome session completed
acceptance. No test auth bypass was added: the existing `CADENCE_ENABLE_TEST_LOGIN=1`
route created disposable users against this task's isolated Supabase instance.

Reproduction:

1. Launch the local app with the isolated Supabase keys and signing JWK supplied
   privately, the MCP kill switch enabled, and the exact local issuer.
2. Launch Inspector with a private writable catalog containing a `streamable-http`
   server at `/mcp`, `protocolEra: "auto"`, and explicit free ports from 4321–4330.
3. Connect. Inspector discovers metadata, dynamically registers a native client,
   and starts PKCE OAuth. Cadence preserves the pending consent through local
   test login. Allow the requested read scope. Inspector completes authorization,
   negotiates 2026-07-28, and lists 16 tools.
4. In Inspector Server Settings → OAuth Settings, set scopes to `cadence.read
   cadence.behaviors.write cadence.occurrences.write`. Clear stored OAuth state
   (revoking the earlier token) and reconnect. Both write checkboxes appear on
   Cadence's consent screen; allow them for the synthetic user.
5. Execute account context, categories, Behaviors, Timeline, Behavior create/get,
   Occurrence list/get/status/note, adherence, search/fetch, Behavior update,
   archive and restore. Every call succeeds with structured output. Use the
   returned IDs/revision and stable idempotency keys, not copied real records.
6. Clear Inspector OAuth state and reconnect. Before approving, use the existing
   local test-login route with the same pending-consent return path to create a
   second user. Approve and verify its Behavior list is empty. Target the first
   user's Behavior with get/archive: both server calls return `not_found`.
   SQL activity confirms those exact errors and the first Behavior remains active.

Screenshots are attached to the Ticket 228 task note and PR Context. Consent shows
both write scopes; success shows the 16-tool catalog and restored synthetic Behavior.
No OAuth token, authorization code or secret is included in those images.

### Inspector-specific limitation

Inspector 2.11.0's extra structured-output validator validates a present
`structuredContent` against the success schema even when `isError: true`. Thus a
valid `{error: {code: "not_found", ...}}` tool result appears as a local `-32602`
"Invalid Parameters" error. Its bundled `sH` validator checks `isError` only
when structured content is absent. Cadence's raw response and database activity
retain `not_found`; the official SDK client's `callTool` correctly returns the
tool error in both protocol modes. The live integration regression asserts this
for cross-account get/archive after `tools/list` has cached the output schemas.
This is a client display limitation, not a successful cross-account read/write.
No success schema or operation contract was broadened to mask it.

Inspector also reports nonblocking portability warnings for legal JSON Schema
nullable type arrays (for example `["string", "null"]`). It reports no schema
errors, and all happy paths succeed. Gemini/OpenAPI dialect support is outside
this ticket. Live Claude/ChatGPT acceptance remains Ticket 232.


## Final gates and cleanup

All required repository gates pass: `npm run test` (2,758 passed, 91 skipped),
`npm run lint`, `npm run typecheck` (including Next route type generation),
`npm run build`, `npm run agents:check`, `npm run interactions:check`, and
`npm run resolvers:check`. Focused transport/admission tests: 24 passed. Actual
Supabase integration tests: 12 passed, including SDK `isError` handling in both
protocol modes. Final changed-test lint and repository contract checks pass.
Checks ran on 2026-10-18 at 17:47–17:59 UTC with Node 26.0.0; Node 24 remains
unverified. No new schema migration was required.

The dev server, Inspector, and private Docker proxy stopped. Supabase stopped
with `--no-backup`. No `cadence-mcp-228` containers, volumes or network remain;
no task listeners remain on 4321/4324–4326 or 56920–56929. Private signing keys,
Inspector state, credential-bearing runtime/start logs and the proxy socket were
removed. Browser test tabs closed. Owner and sibling databases were not touched.

## Local expiry maintenance (Ticket 232, October 18, 2026)

This evidence covers local maintenance, not hosted deployment or live-client
acceptance. Node 24.22.0 came from an isolated official runtime archive verified
against its published SHA-256. No global runtime or dependency changed.

The existing daily occurrence-sync route starts maintenance after authentication
and awaits it on every authenticated exit. Tests preserve occurrence responses,
503/Retry-After and breaker skips; cover early failures, zero profiles, disabled
MCP, purge failure and malformed counts; and prove that deleting the final await
breaks the route regressions. Seven raw count fields require nonnegative safe
integers. Fixed failure events never include error payloads or success counts.

Focused route/repository/service/transport tests: 46 passed. The actual Supabase
client and Node HTTP transport settled an eight-second abort while the response
body stalled, with one request and no retry. The route's 17 regressions also
passed after the removed-await mutation was restored.

Assigned stack: `cadence-mcp-232`, API `127.0.0.1:56121`, database
`127.0.0.1:56122`, local mail sink `127.0.0.1:56124`. A private Docker proxy
forced loopback bindings; no owner/default database operations ran. Existing
85 migrations replayed without schema changes. SQL222 passed; SQL232 proved
expired-row deletion, valid-row preservation, retained used DCR/CIMD metadata,
pending-request cleanup and idempotent retry inside a rolled-back transaction.

Three opt-in local tests exercise real maintenance and locked-query cancellation.
An early HTTP abort settled the client but left the SQL query active. The local
`authenticator` role's existing eight-second statement/lock timeouts then ended
the query while the lock remained held. The service also settled at its deadline
without a success event. This proves local transport settlement and the existing
local database bound; it does not prove HTTP abort cancels PostgreSQL or that
production has the same bounds. No new timeout configuration or migration was
introduced. Production database bounds and route duration remain activation gates.

Earlier PATH-selected gates passed: agents, interactions, resolvers, core, design-system, lint,
typecheck, tests and web build; marketing build/check, generated developer docs,
plugin checker and both Claude strict validations. Full suite: 2,803 passed,
94 skipped, including the three local tests run separately. Existing opt-in
hosted/native cases remain skipped. The plugin validator's README installation
advice is nonblocking. No legal copy, production settings, hosted data, production signing keys,
deployment, push, scheduler invocation or directory submission changed.

Cleanup verified zero users, clients, grants and active purge queries before
stopping only `cadence-mcp-232` with `--no-backup`. No matching containers,
volumes or networks remain. The private proxy, signing key, credential loader,
config/workdir and provider logs were removed. No browser server ran. Owner and
sibling databases remained untouched; nonsecret test logs remain in `/tmp`.


### Reporting-failure correction and runtime assurance

Review at `e13756d` found that the fallback maintenance logger could throw and
replace occurrence responses. The route now contains that final reporting
failure. It still observes maintenance rejection immediately and awaits final
settlement. The real service/route regressions preserve 200/503/500 bodies,
Retry-After, original unexpected exceptions, timer cleanup and delayed sync
without unhandled rejections. A successful purge whose logger fails is not
retried. The shared monitoring implementation is unchanged.

Eight new tests failed before the correction and passed afterward. The retained
verifier reproducer changed from three failures to three passes. Focused tests:
54 passed, including the eight-second real stalled-response transport test.
Full suite: 2,811 passed, 94 skipped.

These correction runs pin the official Node 24.22.0 executable and npm entrypoint.
A preload checks the executable's real path and major in Node child processes;
a temporary Vitest setup hook asserts both inside every executed test file.
An npm script shell restores the pinned runtime before resolving child commands.
Earlier logs identified a Node 24 launcher through PATH but did not assert every
child runtime. The verifier observed bare `npm exec -- node` selecting Node 26;
such a diagnostic is not accepted as Node 24 evidence. The guarded required
checks supersede the earlier required-check runtime attribution. The temporary
test config preserves the repository config except for runtime assertions.

Required agents/interactions/resolvers, lint, typecheck, full tests and web build
pass on the corrected runtime tree. The unchanged SQL222/232 and three local
integration results are reused execution evidence from the previous local run,
not a fresh database verification. No SQL reset was needed: this correction
changes only final route error containment, tests and related documentation.
Unchanged core/design/marketing/plugin checks retain their earlier evidence;
they were not rerun or newly attributed to guarded Node 24. Production bounds,
legal approval and live-client acceptance remain unverified and separately gated.


### Owner-approved legal copy — local acceptance

Ticket 232 implements the complete owner-approved Privacy and Terms candidate,
including the separately approved Daily Brief disclosure and matching marketing
wording. The unsupported provider-verification sentence is removed. Existing
Trust wording, unrelated provisions, processor disclosures, and retention rows
remain unchanged. New retention wording describes expiry versus later physical
cleanup and retained shared client registrations. Production scheduling and
provider facts remain release-verification issues, not verified by this change.

The shared owner is `components/settings/LegalContent.tsx`. Its public Privacy
and Terms routes and Settings link panel continue using that owner. Existing
marketing FAQ, About HTML, home/About Markdown, and developer-documentation
status copy agree. `docs/PUBLIC_PRODUCT_ARCHITECTURE.md` now records this contract.
No interaction, layout, token, route, data, or provider behavior changed.

Both local legal dates and the retention caption remain October 18, 2026.
Before separately authorized publication, set both dates and the retention
caption to the actual publication date in America/New_York. Use one fixed
reviewed date, never a dynamic daily date. Legal-copy approval does not authorize
deployment, hosted tests, public activation, or directory submission. Publisher,
reviewer, health-data policy, support and inherited provider-fact verification
remain separate release gates. Release SHA remains unset.

Platform impact follows the existing design-system and interaction inventories:
web public legal pages consume the shared copy and Settings links remain intact;
desktop has no direct LegalContent/TrustAndLegalPanel consumer in its source
and its behavior remains unchanged;
marketing uses its existing copy owners; future native mobile remains deferred.
No parallel inventory or new UI fixture was needed.

Local browser QA used loopback web port 4321 and marketing port 4323. Public
Privacy/Terms, the real Settings legal panel in the existing fixture bench,
expanded FAQ and About passed at 390×844 and 1440×900 with no document overflow.
Privacy tables retain horizontal scrolling inside their containers. No browser
console warnings/errors were captured on those pages. Authenticated account
Settings and installed desktop were not exercised. The unchanged panel mapping
and focused tests cover those consumers without account or provider operations.
Screenshots, viewport readbacks and logs are retained in workspace artifacts
under `.intent/artifacts/legal232/` and linked from the Ticket 232 handoff.

Verification uses official Node 24.22.0 with an executable/major preload guard
and per-test-file runtime assertions. The full suite passes with 2,814 tests and
94 existing opt-in skips. Exact comparison with the approved note passes for
both complete policies; preservation checks cover dates, Trust, renderer and
all existing provider/retention rows. Required agents, interactions, resolvers,
lint, typecheck and web build pass, as do design-system and marketing build/check
(including all 16 generated developer tool references and agent-readable copy).
Lint retains two pre-existing warnings in verifier artifact configs. Initial lint
errors in temporary audit scripts were resolved by retaining those scripts as
text artifacts. No project lint configuration or dependency changed. Browser
servers and owned tabs were closed; unrelated tabs and port 4322 stayed untouched.
No SQL reset or runtime/provider test was needed for this copy-only change.


### Owner-approved backup wording correction — local review

Ticket 232 replaces only strict backup/remnant deadlines with the approved
Supabase backup-lifecycle disclosure. The complete approved sentence appears
in Privacy's Retention section. Calendar connector ciphertext, general backups,
deleted-account remnants and connector/travel retention rows use the same
semantics. Live-record deletion does not immediately erase existing backups.
No new deletion deadline or provider-verification claim is introduced.

Terms, Trust, policy dates/caption, processor disclosures, ordinary log periods,
live-record deletion commitments and MCP/Daily Brief disclosures remain unchanged.
A structured comparison against `d2d39244` proves only the Calendar backup
paragraph, added Retention paragraph and six backup table cells changed.
The public architecture retention bullets now match the approved local policy;
its earlier verification attestation remains identified as historical.
Marketing contains no equivalent strict backup deadline and needs no copy edit.

Public Privacy/Terms and the existing Settings legal-panel fixture were checked
at 390×844 and 1440×900. No document overflow occurred; Privacy tables retain
horizontal scrolling inside their containers. The Settings Privacy link opens
the updated public policy. Browser evidence is retained under
`.intent/artifacts/backup232/`. One React state-update warning appeared during
bench preview navigation; its cause was not investigated in this copy-only task.
The renderer and Settings panel are byte-for-byte unchanged. Authenticated
account Settings, Timeline and installed desktop were not exercised.

Platform impact remains in the existing inventories: web public policy changes;
Settings link behavior is unchanged; desktop has no direct policy consumer;
marketing links to the web owner without a matching deadline; native mobile is
deferred. No interaction intent, layout, token, fixture or design inventory changes.

This is local wording acceptance only. Actual publication-date selection,
independent review and exact disabled-deployment authorization remain required.
Physical backup cleanup and platform sensitive-log capture remain unverified.
No account/provider/database operation or publication occurred.

Verification used official Node 24.22.0 with executable/major guards inherited
by child processes and per-test-file runtime assertions. Required agent,
interaction, resolver, lint, typecheck and web-build gates pass; focused legal
and public-content tests pass, as do design-system and marketing checks.
The full suite passes with 2,815 tests and 94 existing opt-in skips using two
workers. The initial concurrent run timed out in ten unrelated tests while
Next compiled QA pages; the server was stopped and the suite passed without
changing timeouts. Lint retains two pre-existing verifier-config warnings.


## PR108 release-check correction (Ticket232, October18,2026)

CodeQL `js/incomplete-sanitization` identified missing backslash escaping in
the contract Markdown table generator. The marketing table generator shares
the same failure: a literal backslash immediately before a pipe splits a cell.
Both now escape plain-text backslashes before pipes. Code literals containing
backslashes use HTML code with numeric character references because GFM table
escaping precedes code-span parsing; doubling those backslashes changes their
literal values. Existing code-span formatting remains for other values.

Rendered regressions cover one, two and three backslashes before a pipe, regex
backslashes, literal markup characters, table-column counts and contract titles
and enum values. Generated marketing reference data changes only its encoding;
rendered catalog preservation is checked against the reviewed candidate.
No contract, scope, schema, token hashing, legal text or interaction changes.
Web API and desktop behavior are unchanged. Marketing HTML/Markdown reference
encoding is affected; future mobile remains deferred.

The separate CodeQL `js/insufficient-password-hash` finding targets SHA256 in
`lib/services/oauth/protocol.ts`. Issued OAuth credentials use32 random bytes;
callers hash generated credentials, presented credential lookups and rate-limit
buckets. There is no password grant or accepted client secret. Hashing remains
unchanged while independent review evaluates the finding. No alert disposition
is implied by this documentation.

Hosted history has85 migrations after the authorized release preflight; web
Production MCP is disabled and the canonical issuer is configured. Production
application/marketing deployment, final Trust pairing, scheduled maintenance
observation and live-client acceptance remain separate pending evidence.

## Token-family deadline release correction (Ticket 232)

PR108 comment `4309921704` identified access tokens that could outlive their
90-day family. Forward migration
`20261019025157_enforce_oauth_family_deadline.sql` caps refreshed access expiry,
rejects access at or after family expiry, and returns the earlier token/family
expiry. This also protects tokens issued before this correction. New code
exchange already creates a fresh family with shorter token lifetimes. The two
RPC signatures and grants stay unchanged; generated database types are identical.
The five already-applied migrations remain byte-identical.

The isolated SQL regression `tests/sql/ticket-232-oauth-family-deadline.sql`
fails against the old functions and passes after a clean 86-migration reset.
It checks expired, equal, one-microsecond-future, thirty-minute, one-hour and
two-hour family deadlines; existing overlong tokens; ordinary code issuance;
and no token mutation on rejected refresh. Existing SQL222/225 smoke tests pass.
`tests/oauth-server.test.ts` checks the capped `expires_in`, expired-family
errors, effective-expiry boundary and the existing refresh-resource requirement.
SQL tests prove database behavior; mocked HTTP tests prove response handling.

PR108 comment `4309921706` proposes optional refresh resource. Cadence implements
the [MCP authorization profile](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#resource-parameter-implementation),
which requires resource on authorization and token requests. The generic
[RFC8707 resource parameter](https://www.rfc-editor.org/rfc/rfc8707.html#section-2)
is optional subject to authorization-server policy. Cadence's declared policy
in `docs/MCP_INTEGRATION.md` requires it. Keep that contract unchanged.

CodeQL17 (`js/insufficient-password-hash`) was independently reviewed and
dismissed as a false positive on October19 at02:51:48UTC. SHA256 hashes
server-generated 256-bit credentials and noncredential rate buckets; presented
values only look up issued hashes. No user-password verifier, password grant or
client-secret authentication exists. No hashing change was made.

The new migration is local-only pending independent review and separately bound
hosted approval. PR108 remains held; hosted history is85 and MCP stays disabled.
This server-only correction changes no desktop, marketing or mobile interface.
Retained evidence: `.intent/artifacts/deadline232/` (red/green SQL, reset, generated
types, guarded Node24 gates, function diff, preservation hashes and readback).

## Disabled production release — October 18, 2026

PR108 merged as `280b6eacc9ebcabbd9c5b675c67adf1c01870c8d`; its tree is identical
to independently reviewed `81eface`. All ten final-head checks passed. The owner
approved the sixth migration separately; its singleton dry-run and hash matched,
and hosted history is now 86. Both function source hashes, ownership, ACLs and
search paths match local review. Private-schema access/RLS and the shared status
function remain unchanged.

Production web `dpl_FEE1Gx6cxsArYoHGM7DGRJGamiaD` and marketing
`dpl_5p4dy9uHvwFcf2gkhr6moDhw1cRP` are Ready at that merge source. Web was
redeployed after binding the Ready marketing ID. Both retain Node24 and their
existing roots/domains. Production MCP is false and issuer is canonical.
MCP/OAuth/discovery return503/no-store; the unconfigured challenge returns404.
Public Privacy/Terms match215 approved text fields, including October18 dates;
About/FAQ match the approved Daily Brief/MCP wording. Public Trust serves its
prior snapshot with mismatched Passed results correctly marked Stale; this is
not a fresh Trust Passed claim. Provider-unavailable checks and unrun RLS remain
explicit in that feed.

Evidence lives in `.intent/artifacts/deploy232-expiry/`: migration preflight,
dry-run/apply/readback, final deployment metadata, all-three-setting assertion,
public-copy and disabled-route results. Public HTTP/DOM assertions used the host
Node22 client after Node26 fetch intermittently returned compressed bytes as text;
this is separate from the guarded Node24 build/test evidence and deployed Node24.
No product or dependency change was needed for that inspection-client issue.

Normal00:05UTC maintenance still needs scheduled observation. No manual cron,
purge, account fixture, live tracking write, signing-key change, activation or
directory submission occurred. Live Claude/ChatGPT/desktop acceptance remains
separately gated; Ticket232 is not complete.
