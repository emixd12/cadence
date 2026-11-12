# November 11 PR integration review

Review completed on November 12, 2026. This report covers the twelve open pull
requests reviewed together. It records source readiness separately from production
and installed release acceptance. The owner authorized fixes, merges and release.

## Integration plan

Use one protected integration PR based on `d3314e337715891812b744a3a358c97c08927a6a`.
Keep each original PR head in its ancestry. Each merge stage retains the previous
stage and the corresponding reviewed source. Resolve shared status entries
semantically and archive old entries with `npm run status:archive`.

This avoids repeatedly invalidating required checks as other reviewed PRs advance
`main`. It does not replace branch protection. Wait for `verify`, Desktop native,
Local Supabase rehearsal and Web client runner on the final candidate before a
manual merge. Check every original PR afterward; closure by reachability must be
verified, not assumed.

| Order | PR | Integration stage | Purpose and integration decision |
| --- | --- | --- | --- |
| 1 | [#226](https://github.com/emixd12/cadence/pull/226) | `77acb8ca` | Repair web export of Mac-written configuration history first. |
| 2 | [#229](https://github.com/emixd12/cadence/pull/229) | `6bfa876f` | Preserve Daily Brief behavior while separating preparation and validation. |
| 3 | [#228](https://github.com/emixd12/cadence/pull/228) | `70b7138a` | Record measured Brief usage and local skill acceptance; repair checkout-path handling. |
| 4 | [#224](https://github.com/emixd12/cadence/pull/224) | `08af7f67` | Record Settings hosted verification without claiming installed Mac acceptance. |
| 5 | [#227](https://github.com/emixd12/cadence/pull/227) | `0b880ff4` | Record connector evidence and remaining account and installed acceptance work. |
| 6 | [#218](https://github.com/emixd12/cadence/pull/218) | `87c3d539` | Upgrade web-push to 4.0.0 and retire the obsolete deprecation exception. |
| 7 | [#221](https://github.com/emixd12/cadence/pull/221) | `53fcd083` | Upgrade Vitest to 5.1.0 before validating the remaining dependency changes. |
| 8 | [#219](https://github.com/emixd12/cadence/pull/219) | `babc8805` | Upgrade Vite to 8.3.6 with matching desktop manifest and lock metadata. |
| 9 | [#220](https://github.com/emixd12/cadence/pull/220) | `522e83b1` | Upgrade jsdom to 31.0.0 and fix the dialog focus defect it exposed. |
| 10 | [#222](https://github.com/emixd12/cadence/pull/222) | `c701b959` | Align Tailwind, PostCSS integration, node compiler and oxide at 4.3.5. |
| 11 | [#234](https://github.com/emixd12/cadence/pull/234) | `52b202c0` | Preserve merge-policy exceptions and remove fixed-port test collisions. |
| 12 | [#223](https://github.com/emixd12/cadence/pull/223) | `22c792f0` | Prepare Mac version 0.1.10 after every source and dependency change. |

The uploaded source integration commit is
`22c792f080af3f95f195d88be704f1bc7951c17c`, with tree
`c46b6598063030e40d5851725b62bb41f95467fc`. Its source matches the locally checked
integration. The report and final status reconciliation follow that source commit.

## Findings and fixes

### Configuration history and export privacy

PR #226 accepts the two configuration snapshot key shapes already stored by web
and Mac writers. The repository converts snapshots before existing consumers
validate them. It preserves false, zero, null predecessors and source records.
Malformed configuration data still fails validation. The query remains scoped to
the authenticated account.

The original pagination fixtures used empty configuration objects. The stricter
converter correctly rejected them, causing four CI failures. The fixtures now
use valid snapshots, and a mixed-shape regression checks conversion, cursors and
immutability.

The proposed export logger accepted any short error beginning with `Invalid` or
`Unsupported`. A private string could therefore pass its logging filter. The
review replaced that pattern with an exact set of code-defined validation labels
inside the export service. The route delegates classification to the service.
A regression covers a private string disguised as a validation error.

The read repair requires no data rewrite. The Mac writer still uploads camelCase
snapshots; Ticket 326 retains that follow-up. Production export as account A
must still verify the repair against existing history.

### Daily Brief contract

PR #229 preserves the current hosted generation API and its validation behavior.
The preparation result survives a JSON round trip before validation. Its
validation data contains trusted server values; it is not an authenticated client
input contract. A code comment records that boundary. Ticket 298 must verify a
signed envelope before accepting returned data from a client.

The split does not expose an endpoint or activate ChatGPT-plan execution. The
adapter and installed acceptance remain gated by Tickets 295–300. The 35 round-trip
combinations, four rejection tests and downstream Brief tests passed in the
isolated review.

### Acceptance tooling and browser behavior

PR #228's local-stack entrypoint compared an encoded file URL with a filesystem
path. A checkout directory containing a space could silently skip execution.
The review fixed the comparison and added a subprocess regression.

The jsdom upgrade exposed an existing focus-order defect in
`ExternalEventDetails`: a child tried to focus before the dialog opened. The
review opens the dialog in `useLayoutEffect`, before the child's passive focus
effect. Focus tests cover the resulting behavior, and `DESIGN.md` records the
contract.

PR #223's access probe recognized `Travel settings` but missed `Set up Travel`
when Travel was off. The probe now handles both labels and restores the drawer's
closed state. Adapter regressions cover that path.

PR #234's session-broker tests reused TCP port 56140. Parallel CI observed
`EADDRINUSE`. Four broker instances in the private-socket test now request an
ephemeral TCP port; the live HTTP fixture retains its intended behavior.

### Dependency and documentation consistency

The final lock was installed afresh under Node 24.22.1 and npm 11.9.0. Workspace
links resolve to the integration checkout. Dependency verification therefore
executes the integrated shared packages, not another worktree's sources.

The Vite manifest and lock metadata both specify 8.3.6. `tailwindcss`,
`@tailwindcss/postcss`, `@tailwindcss/node` and `@tailwindcss/oxide` resolve to
4.3.5, with platform oxide packages also aligned. web-push 4.0.0 passed the isolated
encrypted-transport regressions, including rejection of Node deprecation
warnings. Ticket 105 remains open for deployment verification.

Shared `STATUS.md` conflicts retain the latest open-work rows and every recent
entry. The standard archive command moved older entries unchanged and regenerated
the ticket index. Hosted Settings and connector evidence do not close installed
or account-specific acceptance gates.

## Integrated verification

Per-stage `agents:check`, `interactions:check` and `resolvers:check` passed.
`npm ci` passed on the final source and installed the versions listed above.
Final local results on that source:

| Check | Result |
| --- | --- |
| Lint | Passed; six existing warnings |
| Typecheck | Passed |
| Complete Vitest suite | 5,660 passed; 230 skipped; 29 Unix-socket `listen EPERM` failures |
| Web production build | Passed |
| Desktop frontend build | Passed |
| Marketing build and check | Passed |
| Public source, Trust checks and Trust fixtures | Passed |
| Final governance checks | Agents, interactions and resolver checks passed |

Dagger and Docker are unavailable in this Linux workspace. The integrated
full suite reached only the known Unix-socket `listen EPERM` restrictions:
21 session-broker tests and eight Supabase proxy tests. Those failures are not passing
results; GitHub CI must execute the restricted checks. Local Chromium also fails
before UI startup on its singleton Unix socket. The web-client helper requires
the Chrome channel. Native macOS, Local Supabase rehearsal and Web client runner
results must be checked on the final integration PR.

## Deployment and release sequence

1. Require all final integration checks, including the three conditional
   workflows, to pass. Keep the original PR ancestry and normal protected merge.
2. Verify both Vercel production projects reach Ready for the merged commit.
   The last provider evidence reviewed here showed the app and marketing Ready
   at `d3314e33`; it does not establish the integrated deployment.
3. Run authenticated production export as account A, with Mac-written history,
   and inspect safe server error labels. Recheck existing Brief generation and
   browser-push delivery under their acceptance procedures.
4. Build the signed and notarized Mac 0.1.10 artifacts from the final merged
   source. Run installed acceptance against the downloaded artifact before
   publishing the release assets and updater manifest.
5. Verify the release assets, production deployment commit and every original
   PR's final state. Record actual outcomes, including any remaining access gap.

No reviewed PR introduces a database migration or requires an environment change.
Mac 0.1.10 still inherits SQLite migrations 21–24 and sync contract 5 from `main`.
An upgrade from published 0.1.9 therefore changes the local database. Installed
acceptance must verify data preservation, linked-session survival under the new
signing identity, Settings behavior and native permissions.
Keep connector-completion, weather and ChatGPT-plan activation gates unchanged.
Keep the pre-launch Trust marketing-ID refresh paused under the existing
decision. Paid Home lookup and model-comparison runs retain their spend-cap gates.

The desktop source version is 0.1.10; that does not publish an installer. The
reviewed GitHub `desktop-stable` release still names 0.1.9 and has no 0.1.10 assets.
The rotated updater key means existing installations require one manual upgrade.
Do not publish a `latest.json` pointer before its signed artifact and acceptance
evidence exist.

The `desktop-release` access preflight returned exit 10 in this workspace. It
lacks the test-device inventory (`CADENCE_TEST_DEVICES`), SSH agent, macOS
`security` and Keychain access, provisioning profile, updater signing key and
password, notarization credential, release-vault token and per-run release
folder. The user has already authorized release. These are execution access
gaps, not an unanswered release-permission request. Production export also
remains unverified because no QA authentication credentials are available here.

The baseline deployment IDs were app `dpl_5SNAMgNv4wtKssWMGiQQktwWSXRN` and
marketing `dpl_6HdJB94FgxHfGpJmunioyvwFUNdN`.

The production baseline also passed anonymous HTTP checks: export returned 401
with the expected sign-in message, Settings rendered sign-in, and marketing
returned 200. This does not verify signed-in export or reminder delivery. The
provider logs still showed the existing `DEP0169` URL-parser deprecation on a
reminder process; the web-push upgrade targets that warning. No real push send
ran during this review.

## Rollback and limits

If web deployment regresses, restore the previous known-good Vercel deployment
and diagnose the failing feature before re-promoting. A web source rollback
needs no hosted database rollback for this source set. A desktop rollback must
follow the release runbook and preserve the upgraded database; compatibility
with an older binary is not established by these source checks. Keep the
preserved PR stages available to identify the smallest corrective change.

Do not present a frontend build or macOS CI test as signed installed acceptance.
Do not claim push delivery from an encrypted-transport unit test. Do not mark a
pending release, live acceptance run or original PR complete from source review
alone.
