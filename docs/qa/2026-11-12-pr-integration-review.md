# PRs 238–245: integration and release review

The owner requested review, fixes, protected merges and release for every open PR.
The initial source baseline was `9c3d4198cd4759fdad949468280c97071578a7ad`.
Review began November 11, 2026, New York time (November 12 UTC).
PRs #243, #244 and #245 opened during review and joined the same integration plan.

## Implementation and merge plan

| Order | PR | Work before merge | Deployment boundary |
| --- | --- | --- | --- |
| 1 | [242](https://github.com/emixd12/cadence/pull/242) | Verify the recorded owner decisions and source checks. | Keep the ChatGPT plan path hidden. Ticket 299 owns the desktop UI and account-disconnect integration. |
| 2 | [238](https://github.com/emixd12/cadence/pull/238) | Bound every provider response, preserve cancellation and transport failures, and reject inherited error-map properties. Recheck the older `max_output_tokens` review against the recorded live spike. | Shared schema extraction must preserve hosted requests. The plan adapter has no active caller. |
| 3 | [240](https://github.com/emixd12/cadence/pull/240) | Add failed-attempt release. Prevent duplicate completion or release from undoing an already completed lease. Exercise ownership, replay and final-fence behavior. | Add one pending-only release RPC. Apply the reviewed migration after rehearsal. Keep device mode disabled. |
| 4 | [241](https://github.com/emixd12/cadence/pull/241) | Bound native HTTP reads before buffering, revoke grants after failed credential persistence, and enforce the callback deadline during partial requests. Recheck existing cancellation and stale-session fixes. | Require Desktop native CI. No Settings UI or plan-model call becomes reachable. |
| 5 | [244](https://github.com/emixd12/cadence/pull/244) | Review the recorded pause after Ticket 299 and strict no-fallback decision. | Ticket 300 waits for feature activation. Ordinary Mac release acceptance still applies. |
| 6 | [243](https://github.com/emixd12/cadence/pull/243) | Integrate the hidden UI and model wiring with the repaired adapter, native connection and pending-only release route. Check default-off behavior, account switching, token lifetime, cancellation and cleanup. | Require native and source CI. Pin the signed release's effective feature flag off. |
| 7 | [245](https://github.com/emixd12/cadence/pull/245) | Review the reported Outlook acceptance and iCloud limitations. Correct stale installation and missing-vault prerequisites using the release packet. | Documentation only. Preserve the distinction between completed installation and pending installed connector checks. |
| 8 | [239](https://github.com/emixd12/cadence/pull/239) | Reconcile release evidence and this review with the final merged source. Review the concurrent notarization API-key configuration and fake-vault fixture. Preserve the exact source and hashes of the retained 0.1.10 candidate. | Recording notarization does not publish the binary or complete missing installed checks. |

Each source PR must retain its reviewed ancestry and pass GitHub's required
`verify` check after repairs. Conditional workflows remain explicit gates:
Desktop native for Rust changes and Local Supabase rehearsal for the migration.
Resolve shared documentation semantically. Preserve status history unchanged.

PR #243's additional repair plan:

1. Pin the published build's effective feature flag off, including when Vite
   loads `.env.production` or `.env.local`. Preserve enabled development builds.
2. Make local ChatGPT credential cleanup a prerequisite for completing Cadence
   account removal. Treat provider revocation failure separately from local
   Keychain failure. Apply the same rule to cancelling an unfinished account link.
3. Prevent ChatGPT sign-in from starting during Cadence account teardown.
4. Bound connection-status lookup and release a prepared lease after model or
   completion failure, including cancellation and transport failure. Preserve
   the pending-only server release so cleanup cannot undo successful completion.
5. Add regressions for the observed failure paths, then run integrated source,
   desktop frontend, native and applicable database checks.

## Validation plan

Run focused regressions for each repair and the repository governance checks.
Run lint, typecheck, the complete test suite, web build, desktop frontend build,
marketing build/check, and public-source/Trust checks on the integrated source.
Use native CI and the database rehearsal for checks unavailable in this Linux
workspace. Do not substitute TypeScript tests for native or SQL execution.

After each protected merge, inspect deployment status. At the final commit,
verify both production Vercel projects, check public route behavior, and confirm
that every reviewed PR is merged. Keep the pre-launch Trust marketing-ID
refresh paused under the existing owner decision.

## Release risks and constraints

- `main` deploys automatically. The ChatGPT plan feature must remain dormant
  throughout the sequence. There is no authorization here to activate it.
- The new release RPC must change only the authenticated account's matching
  pending attempt. A duplicate request must leave completed attempts intact.
- The retained notarized 0.1.10 binary comes from `c67ec4d1`, before these PRs.
  Its evidence cannot establish installed acceptance of new native code.
- The 0.1.10 packet still needs session-renewal and revoked-session acceptance.
  Existing installations require one manual upgrade after updater-key rotation.
- This workspace has no Mac test-device inventory, release credentials, Rust
  toolchain, Docker or Dagger. These are access and execution gaps, not missing
  release authorization. The owner has already requested release.
- Vercel deployment inspection works. Environment-variable listing returns
  HTTP 403, and this workspace has no authenticated Vercel CLI fallback.
- The desktop feature switch controls normal UI reachability. Native commands
  remain registered in the main webview; the switch is not a security boundary.
- Default-off builds still run native ChatGPT Keychain cleanup during Cadence
  account disconnect and cancellation of an unfinished link. A local cleanup
  failure blocks teardown. Ordinary installed acceptance must exercise both
  paths with the feature off; this does not reopen deferred Ticket 300.

## Results

### Repairs

**PR #238: bounded provider responses.** The stream had a size limit, but JSON
model responses, catalog responses and error bodies could accumulate without
that limit. A shared reader now caps all response bodies at 256 KiB. The parsed
output retains its 64 KiB limit. Cancellation stays `timeout`; interrupted reads
stay `retry_later`. A malformed catalog no longer looks like an ineligible
account. Provider error mapping now checks own properties, so `constructor`,
`toString` and `__proto__` cannot select inherited values. Four new regressions
failed against the original source. The older `max_output_tokens` review was
stale: the recorded live spike accepted it on all four tested models.

**PR #240: replay-safe completion and failed-attempt release.** A duplicate
complete request could previously call `finish_daily_brief(false)` and downgrade
a successful attempt. The new authenticated `release_daily_brief` RPC changes
only the caller's matching pending lease. It preserves completed attempts,
replacement leases, admissions and quotas. The release route verifies the
signed envelope and account/installation binding. Complete uses pending-only
cleanup unless that request successfully completed its own lease. It also
rechecks expiry and cancellation after the final context fence. SQL regressions
cover ownership, revoked sessions, invalid arguments, replay, retry and grants.

**PR #241: bounded native sign-in and credential handling.** The 2 MiB native
HTTP cap now applies while reading chunks, before full buffering. Partial
loopback requests cannot extend the total sign-in deadline. Cancellation and a
per-request timeout also apply during reads. Failed Keychain persistence or
verification revokes the newly issued grant and preserves the prior session.
Identity validation requires numeric `iat`, validates every audience member,
and checks `azp` whenever present. Existing regressions also cover cancellation
during token exchange and stale catalog failures after account replacement.

**PR #243: account isolation and dormant release enforcement.** The original
signing validator checked process environment only. A real Vite reproduction
loaded the feature flag from `.env.production` after that check passed. Release
and preview build environments now pin the flag off; enabled development builds
remain available. Regressions exercise the env-file case.

Local ChatGPT credential cleanup must succeed before Cadence account removal or
cancellation of an unfinished account link. Provider revocation failure remains
nonblocking after local tokens clear. A synchronous account scope rejects
connection changes during teardown and stale callbacks after account changes.
Shared lifecycle events survive Settings remounts, reject obsolete status reads,
and cancel remembered Daily Brief work. Reconnect retries check the session epoch.

The device flow bounds status lookup, native/provider waits and completion. It
releases the pending lease after model or completion failure, including transport
failure and cancellation. Pending-only release remains safe if completion
succeeded but its response was lost. Native access-token reads recheck plan
permission after refresh. The concurrent device-only availability fix is preserved:
desktop UI can use the device path without claiming hosted availability on web.
Unrelated interaction-registry reordering was removed.

**PR #239: accurate release evidence.** The packet now separates installed
Settings checks from unfinished connector acceptance. Schema 24 and sync
contract 5 were observed; connector-completion records were not. The packet
records the notarization API key and the later follow-up's reported vault backup
and verification. This review does not claim independent live verification. It
preserves the inconclusive leave-reminder check, missing
`launchSyncChanges`, and pending session-renewal/revoked-session results. The
current request authorizes release; it does not supply those missing results.

The concurrent signing change selects the App Store Connect API key in the
credential inventory. The corrected fake vault includes that key. A new
regression proves that an old password backup cannot satisfy the active API-key
backup requirement. All 16 credential tests and 17 desktop release tests passed.

**PR #245: accurate connector acceptance.** The new packet preserves the
reporting agent's Outlook results and their limits. The 0.1.10 installation
already occurred; remaining installed connector checks are the dependency.
The iCloud item exists but its fields were unreadable, and the run had no usable
test identity. Unverified Sandbox Apple Account speculation was removed. A
successful disconnect/reconnect smoke does not establish later provider-grant
revocation; that follow-up remains open. This review did not access accounts or
rerun the reported live acceptance.

### Integration and validation

PR #242 merged as `46b1c9964434b97888e7abbf9b37fe476ef673a2`.
PR #238 merged as `1bfab01ee1cf1d1a26d545441f937a8c3c766f2c` after
[CI run 43153910538](https://github.com/emixd12/cadence/actions/runs/43153910538)
passed. The tested adapter tree was preserved exactly during upload.
PR #240 merged as `efa3177e5c2814f365c539010d2524ece9687f86` after final
[CI 43155849703](https://github.com/emixd12/cadence/actions/runs/43155849703)
and [rehearsal 43155849762](https://github.com/emixd12/cadence/actions/runs/43155849762)
passed. Its merge tree exactly matches the reviewed local tree.
PR #241 merged as `8f73f9057b6985e3e0a4ba01b7222f0393898ed6` after
[CI 43155924973](https://github.com/emixd12/cadence/actions/runs/43155924973),
[rehearsal 43155925007](https://github.com/emixd12/cadence/actions/runs/43155925007)
and [Desktop native 43155925020](https://github.com/emixd12/cadence/actions/runs/43155925020)
passed. Native CI checked the application and passed all 159 Rust tests. The
merge preview had current `main` as a parent and exactly matched the tested tree.
PR #244 merged as `c720a77c3de3a7e220f3af7c7d9f89d9805f3181` after
[CI 43157108815](https://github.com/emixd12/cadence/actions/runs/43157108815)
passed. It records the pause after Ticket 299, defers Ticket 300 until activation,
and preserves strict no-fallback behavior. Its three-file documentation diff
changes no runtime behavior.
PR #243 merged as `dad30768f82e962fe815d0980023ac86f01a5910` after
[CI 43158921056](https://github.com/emixd12/cadence/actions/runs/43158921056)
and [Desktop native 43158921251](https://github.com/emixd12/cadence/actions/runs/43158921251)
passed. Native CI compiled the application and Swift helpers and passed all 161
Rust tests. Its merge tree exactly matches the reviewed local tree.
PR #245 merged as `a48e1bbd464dbe0d013985281d62de5c86954aab` after
[CI 43159679198](https://github.com/emixd12/cadence/actions/runs/43159679198)
passed. Its three-file documentation diff preserves the reviewed product source.

Concurrent updates to PRs #239, #240 and #241 merged current `main` into their
branches. Their source changes were inspected and preserved. Current ticket
status now reflects the protected merges. Branch updates use an expected-head lease;
the first rejected update prompted a fresh comparison rather than an overwrite.

| Local candidate | Passed | Skipped | Environment failures |
| --- | ---: | ---: | ---: |
| PR #238 adapter | 5,685 | 230 | 29 |
| PR #240 device routes | 5,729 | 230 | 29 |
| PR #241 integrated native foundation | 5,735 | 230 | 29 |
| PR #243 integrated hidden UI and lifecycle | 5,776 | 230 | 29 |
| PR #239 final signing configuration and credential regression | 5,777 | 230 | 29 |

All 29 local failures report `listen EPERM`: 21 unchanged session-broker tests
and eight unchanged Docker-proxy tests. Fresh dependency installation removed
one additional overlay-related consumer-test failure without a product change.
The complete GitHub suite for #240 passed, including the blocked local suites.
The final #243 [CI run 43158921056](https://github.com/emixd12/cadence/actions/runs/43158921056)
passed 5,805 tests and skipped 230, with zero failures. All 29 locally blocked
tests passed there. Its tested merge tree exactly matched the reviewed source.

The integrated source also passed governance, lint, typecheck, web build,
desktop frontend build, marketing build/check, public-source and Trust checks.
Lint retains six existing warnings. Native Rust and SQL execution require the
updated GitHub workflows; #240, #241 and #243 passed applicable gates before merging.

The final #239 product candidate `36fc9fa2` also passed the complete local suite
with only the same 29 Unix-socket failures. Lint, typecheck, web build, governance,
16 credential tests and 17 desktop-release tests passed. The remaining edits
record these results and reconcile current ticket status. PR #239's final CI,
merge and deployment identifiers belong in its linked closeout record below.

The local UI screenshot attempt could not launch Chromium: its process singleton
required a Unix socket and failed with `EPERM` before rendering. No visual pass or
screenshots are claimed. The project `design-system:check` also points to a
design-system-bench verifier absent from this executor and the available skill
catalogs. Component regressions, interaction governance and resolver governance
remain executable. The hidden feature's installed acceptance stays deferred;
ordinary release acceptance still requires the configured Mac.

### Hosted deployment

At `1bfab01e`, both Vercel production projects reported READY:

- App: `dpl_AKAqtLDWbugCaPokuyEACsnvu8v3`.
- Marketing: `dpl_3oCh6KuJENefz9XPJ9SxYR2Fv1HD`.

The production login and marketing home returned HTTP 200. The anonymous JSON
export request returned HTTP 401 with the expected sign-in error. Signed-in
export acceptance was not established by that check.

At `efa3177e`, the app deployment `dpl_HAJBunKyrVrrrJKWDbj7msGg7Pej` and
marketing deployment `dpl_CZv9qA8EtThJAZ1Ne8yCYfECA5t8` also reached READY.
The same public checks passed. The app's scoped error/fatal runtime-log query
returned no matching logs in the observed window. This was an immediate smoke
check, not sustained production load or authenticated feature acceptance.

Both production projects also reached READY at `8f73f905` and `c720a77c`.
The app's scoped error/fatal log check at `8f73f905` returned no matching logs.
Both projects reached READY at `dad30768` and then at `a48e1bbd`:

- App at `a48e1bbd`: `dpl_FSaFEg2EHAs8E3tYWAQ1X8sMF8wK`.
- Marketing at `a48e1bbd`: `dpl_gV2gkaxZx9pfbUDe3kHhcEofq8PZ`.

At `a48e1bbd`, login and marketing home returned HTTP 200. Anonymous JSON export
returned the expected HTTP 401. The app's scoped error/fatal query returned no
matching logs from 05:06:41 to 05:16:41 UTC on November 12. The final #239
production checks are recorded in that PR's closeout after its protected merge.

Hosted Supabase initially contained 115 migrations, ending at
`20261111160000_account_sync_connector_completion`, matching the source inventory.
The existing Daily Brief table has RLS enabled. Existing admission, completion
and account-validation functions use an empty search path and authenticated-only
application grants. The new release function was absent before deployment.

[Local Supabase rehearsal 43155150732](https://github.com/emixd12/cadence/actions/runs/43155150732)
replayed all 116 migrations and passed the new Ticket 298 SQL regression. It also
passed 92 RLS ownership checks and the account-sync smoke. The reviewed migration
then applied to the hosted project as `20261112043335_release_pending_daily_brief`.
The source filename matches that provider-assigned version. Its SQL blob stayed
`fd60baaa588ef662feb0d7056ac66c6f67947744` throughout.

Hosted inventory now contains the same 116 versions as source. Generated types
differ from the pre-deployment types only by `release_daily_brief`, whose source
type matches exactly. Both functions use an empty search path. Only
`authenticated` has application execute permission; `anon` and `service_role`
do not. A call as `authenticated` without a session was rejected. The validation
transaction rolled back. Deployment changed no table shape, RLS policy or application row.

No feature activation was performed. Vercel environment-variable access returned
HTTP 403, so this review does not claim independent verification of live flag
values. The existing owner decision still requires the plan path to stay hidden.

### Desktop release boundary

The published stable and preview channels remain 0.1.9. The retained notarized
0.1.10 candidate comes from `c67ec4d1c8d22bddb5245e1d7b92e8c61901e40b`.
It predates PR #241 and cannot certify the newly merged native code. Publishing
all reviewed native changes requires a new signed build and applicable installed
acceptance on the configured Mac.

The release preflight records the owner's authorization from this conversation.
This Linux executor has no access to the configured Mac's signing environment,
retained artifacts, private test-device inventory or authorized test-Mac SSH
identity. Missing local Keychain items do not establish that the configured Mac
lacks them. The remaining request is execution access, not renewed authorization.

The preflight initially exited 11 because the documentation worktree lacked npm
dependencies. Restoring them fixed that execution error without source changes.
The rerun exited 10: one ready requirement, 13 missing requirements or blocked
dependencies, one waiting requirement, and zero probe errors. The ready
requirement is the already-authorized notarization go-ahead. Device reachability,
Mac permissions, account linking and backup verification remain unverified
behind this executor's missing inventory and signing environment.

### Rollback and follow-up

If a hosted regression appears, roll back the app deployment to the last verified
production source. The additive release functions can remain installed; existing
hosted callers do not require them. Do not remove migration history or reset user
data. Feature activation remains a separate owner decision.

On the configured release Mac, verify the retained artifacts and retrieve the
original `launchSyncChanges` classification. Build a new notarized candidate from
the reviewed native source, then run the applicable installed acceptance. Resolve
the pending session-renewal, revoked-session and leave-reminder results before
publishing updater metadata and version-free downloads. Preserve the documented
one-time manual upgrade from 0.1.9 after updater-key rotation.

Ticket 300's ChatGPT-plan installed acceptance remains deferred under #244.
The ordinary release checks concern the Cadence account, upgrade preservation,
callbacks, reminders and signed artifacts. In particular, Cadence session renewal
and revoked-session recovery remain required for the new release. Exercise
Cadence disconnect and cancellation of an unfinished account link in the default-off
build, including the native Keychain cleanup that now gates those operations.

### Final outcomes

Seven PRs merged through `a48e1bbd`: #242, #238, #240, #241, #244, #243 and #245.
Their source and applicable native/database gates passed before each merge.
The hosted database has all 116 reviewed migrations and verified release-function
grants. Both production projects reached READY, and public route checks passed.

PR #239 contains this review, corrected release records, the API-key inventory
selection and its credential regression. Its
[closeout record](https://github.com/emixd12/cadence/pull/239) is the authoritative
location for the final CI run, protected merge SHA, production deployments and
zero-open-PR verification. Those identifiers become available after this file's
commit and cannot be embedded in that same commit.

Mac publication remains incomplete. Stable and preview feeds still publish
0.1.9. A new dormant build must include the reviewed native source and complete
ordinary installed acceptance on the configured release and test Macs. The
project's desktop-acceptance skill requires that evidence before publication.
The owner already authorized release; this session needs access to those Macs.
Ticket 300 remains deferred until the separate feature-activation decision.

Platform impact: web, gated device endpoints and shared adapter code; desktop,
native connection code and release records; marketing, deployment verification
only; future mobile, not applicable. Messaging impact: existing P-029 and P-032.
