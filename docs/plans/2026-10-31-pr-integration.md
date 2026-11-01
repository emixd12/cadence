# October 31 PR integration and release plan

## Scope and baseline

The owner authorized review, repair, merging, and release of all open pull requests.
The inventory contains #161–#169 and #174. PR #175 merged separately during the
review; the integration baseline is `f1392365b7e3a608a0e7def350667a9f5ca83ae8`.

The source corrections below are implemented. The integration pull request holds
the final validation, merge, and deployment results. Do not infer installed Mac
acceptance from source checks.

## Integration order

| Order | PR | Purpose | Review result |
| --- | --- | --- | --- |
| 1 | [#161](https://github.com/emixd12/cadence/pull/161) | Hosted timezone migration evidence | Documentation matches the hosted ledger; installed-Mac timezone confirmation remains unverified. |
| 2 | [#167](https://github.com/emixd12/cadence/pull/167) | Maps support record | Preserve the support outcome and existing accepted-risk boundaries. |
| 3 | [#169](https://github.com/emixd12/cadence/pull/169) | Claude cloud setup | Persist full versus skipped-script installation mode and disclose cached fallback installs. |
| 4 | [#162](https://github.com/emixd12/cadence/pull/162) | Astro checker 0.9.12 | No implementation defect found. Rehearsal previously failed during registry throttling, before SQL. |
| 5 | [#165](https://github.com/emixd12/cadence/pull/165) | Next.js 16.4.3 | No runtime defect found. Existing ESLint 16.4.2 remains compatible; no unnecessary dependency expansion. |
| 6 | [#163](https://github.com/emixd12/cadence/pull/163) | MCP server 2.4.0 | Existing object schemas remain compatible. Keep client 2.3.1 to exercise older-client compatibility. |
| 7 | [#166](https://github.com/emixd12/cadence/pull/166) | Supabase SSR 0.12.7 | Preserve earlier cookies and cache headers across successive cookie callbacks and redirects. |
| 8 | [#174](https://github.com/emixd12/cadence/pull/174) | MCP acceptance tooling | Bind resumed evidence to target, account slots, and scenario; verify offered consent scopes against discovery. |
| 9 | [#168](https://github.com/emixd12/cadence/pull/168) | Disposable location VMs | Fail on artifact, permission, or recovery-action errors; retain bounded startup retries. |
| 10 | [#164](https://github.com/emixd12/cadence/pull/164) | Deep-link plugin 2.6.2 | Pair JavaScript and native versions; update the minimal native lock graph. |

These PRs have no new hosted schema dependency. The order groups evidence and
tooling before dependency and native delivery. All package manifests and lockfiles
are reconciled on one integration branch. Original PR heads remain merge parents,
so the reviewed history remains reachable. Merge the integration with a merge
commit, not a squash, after its current-base checks pass.

## Repairs and regression evidence

### Authentication cookies

Supabase can call `setAll` repeatedly during session cleanup. The newer SSR package
sends anti-cache headers on the first callback. Recreating the response previously
discarded earlier cookie deletions and those headers. One helper now copies both
to rebuilt responses and redirects. Tests cover authenticated continuation and an
invalid-session redirect with multiple cookie batches.

### MCP acceptance evidence

A completed local/account-A/read-only run could previously be resumed as
production/account-B/read-write and return success without executing a client.
The shared ledger now validates context before taking a lock or repairing files.
Every runner supplies its expected context. Production revocation rejects local
runs. OAuth tests also prove that a read-only scenario turns off both default-on
write toggles and rejects a wider token response.

The combined dependency run exposed two additional interactions. Supabase Auth
2.118 clears its local session even when provider sign-out fails. The QA broker
now preserves retryable state until a token-scoped provider logout succeeds and
records a missing session as unconfirmed cleanup. Tests cover repeated provider
failure, successful retry, and a rejected refresh that erased local state.
Independent review also found two cleanup races. A Set now keeps each pending
client distinct across overlapping retries, and a replacement session is stored
before awaiting its predecessor's cleanup. Tests and separate probes verify that
an unrelated failed sign-out remains pending and every concurrent replacement is
revoked at teardown.

The historical hosted-fixture builder intentionally uses the product source and
dependency graph from `eb5afa5`. Its Supabase 2.107 runtime must remain isolated
from the upgraded application client. A private development dependency keeps
that frozen tool reproducible while the application uses the new version; the
builder verifies the actual resolved dependency graph against the historical
lockfile. Offline tests must still pass before that tool can be used.

### Location VM acceptance

The runner now checks Gatekeeper, signature, install, installed version, expected
permission, recovery actions, and System Settings activation. It stages only the
selected DMG under a fixed filename and matches Cadence's exact executable path.
Failed cleanup remains a failure. Initial process/window discovery keeps its
bounded retry; later Accessibility checks remain strict. Synthetic guest tests do
not replace a real Tart run or installed-app acceptance.

### Cloud setup and native dependencies

The SessionStart cache records whether install scripts ran. Resuming a fallback
install repeats its limitation; a later full install clears it. Tests run the
actual hook with synthetic commands and no downloads.

Deep-link JavaScript and native manifests both pin 2.6.2. Its lock update requires
`tauri-plugin` 2.7.1 and `windows-registry` 0.6.1. Existing Windows support packages
are reused; orphaned versions are removed. Checksums and requirements come from
the official crates.io index. Native CI must verify the graph with `--locked`.

## Required validation

1. Run agents, interactions, resolvers, lint, typecheck, the full test suite, and
   web, desktop frontend, and marketing builds on the combined source.
2. Run current-base GitHub CI with a fresh `npm ci`; cached local dependencies do
   not establish the upgraded versions' behavior.
3. Require native macOS checks and tests using the pinned Rust toolchain and
   locked Cargo graph.
4. Require a successful disposable Supabase rehearsal. Earlier registry pull
   throttling is infrastructure failure, not migration evidence.
5. Re-read PR heads and main before publication. Preserve any concurrent work.

## Deployment and rollback

The October 31 pre-integration hosted ledger contains all 97 tracked migrations,
including `20261031210000_oauth_consent_offers_advertised_scopes`. Production was
Ready on baseline `f1392365`. The integration adds no migration. Recheck this
congruence before deploying; never reapply an already-recorded migration.

After merging, verify both existing Vercel projects on the exact merge commit.
Bind application Production `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` to the final
Ready marketing deployment, then redeploy the application. Run Trust Preview
before Production evidence with those exact deployment IDs. Keep unavailable
secret scanning and unrun hosted RLS tests explicit; do not relabel them Passed.

For a web regression, restore the previous verified deployment. This change needs
no database rollback. Avoid a desktop downgrade or replacement of a published
artifact: signed desktop release content is immutable.

## Desktop delivery

Stable desktop 0.1.6 already shipped on October 27. Its real 0.1.5→0.1.6 updater
acceptance passed. The deep-link and shared Supabase client updates require a new
signed build before installed users receive them. Before the final release checks
and Mac build, bump `apps/desktop/src-tauri/tauri.conf.json` from 0.1.6 to 0.1.7 or
the next unused stable version. Production `release.mjs` reads this source version;
it has no stable-version command-line override. Build from that final reviewed
commit using `docs/DESKTOP_RELEASE.md`.

The resolved `@supabase/supabase-js` version changes from 2.107.0 in published 0.1.6
to 2.118.0. This also changes the desktop session client. The release therefore
requires session renewal after more than one hour signed in and the authorized
test-account revoked-session check: after token expiry, verify the revoked state,
reconnect, and confirm sync resumes without lost rows. Earlier 0.1.6 session
acceptance does not establish these results for the upgraded client.

The database schema and updater implementation do not change. Required remaining
evidence includes signed/notarized artifacts, quarantined Gatekeeper acceptance,
protected upgrade/database comparison, deep-link callback replay, and the session
checks above. Native CI cannot establish those installed results. Do not advance
either public feed until the applicable release checks pass on the signing/test Mac.

Platform impact: web authentication and dependency updates; desktop dependency
update pending a new signed binary; marketing checker update; future mobile not
applicable. Messaging impact: none beyond the existing P-014 entry from PR #175.
