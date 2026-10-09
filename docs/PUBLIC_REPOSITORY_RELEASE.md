# Public Repository Release Gate

## Decision

Ticket 098 status: **PASS**. Ticket 100 status: **COMPLETE**.

Reviewed on 2026-08-25. Ticket 098 cleared the security release gate while the
repository was private. Ticket 100 later completed the separately authorized
publication, controls, and production account-deletion failure recovery
recorded below.

## Audited basis

- Audited executable commit:
  `6c07538f13df1a358bd8902383b9f109e4da0509`, with parent
  `57171c3f17b32b83acd60b31a27938c856675731`.
- The commit containing this PASS record changes only `STATUS.md` and this
  document from the audited executable commit. Its exact hash belongs in the
  external release handoff. This wording avoids an impossible self-reference.
- The executable branch contains 140 commits. The containing evidence commit
  adds one documentation-only commit.
- Private GitHub `main` and `origin/main` identify the audited executable
  commit before the containing evidence commit is published.
- Web production deployment `dpl_3KGt9dNUy2bg1UxtMdLWDakqDBSZ` is READY at
  the audited executable commit.
- Marketing production deployment `dpl_7gLBemWhZ9WuaUujD2npwu62JUGd` is READY
  at the audited executable commit.
- The hosted Supabase migration boundary ends at
  `20260825080815_add_occurrence_sync_batch_order_index.sql`.
- The containing evidence commit does not change executable, dependency,
  database, policy, or deployment configuration.

## Source and history evidence

Gitleaks 8.30.1 completed history-aware scans of the rewritten branch, all
preserved local refs, and the final fresh private clone. Every scan returned
exit code 0 with no finding. Raw scanner reports remained mode 600 in private
temporary storage.

The Cadence source check reviewed 571 tracked and unignored text files plus
all-ref patch history. It covered Supabase, Sequenzy, VAPID, Google OAuth,
AgentMail, Vercel, cron/process, database, session, and private-key patterns.
It found no credential pattern and no server-only environment name in Next
client or Astro source.

The owner authorized a targeted private-history rewrite before the release
candidate. The isolated rewrite replaced the two audited private values. It
preserved topology, messages, timestamps, names, and unrelated blob and
metadata content. The old values have zero occurrence in rewritten branch
blobs, patches, or author and committer metadata. Intended synthetic and
noreply replacements are present.

The mode-700 recovery directory remains at
`/private/tmp/cadence-ticket098-history-rewrite-XTnslg`. Its mode-600 bundle,
dirty patch, untracked archive, snapshots, and checksum manifest remain intact.
The verified bundle SHA-256 is
`e67ebb4d621226f1f611f8bbee1e2a8dd488067c7a14ed27e8a0fda228ef2fc3`.
Old local objects and reflogs were not pruned. Detached Codex worktrees remain
unchanged.

A fresh private clone at the audited executable commit contains 140 commits.
The clone passed Gitleaks and the public-source check. `LICENSE`,
`SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `README.md`, and the required release
policy files exist. No screenshot or temporary path was added.

These checks do not prove that no undiscovered vulnerability exists. They
prove that the reviewed patterns and scanner rules found no release-blocking
source or history exposure.

## GitHub-hosted surface evidence

Authenticated GitHub CLI and transport reads confirmed that the repository is
private and unarchived. `main` is the default and only branch. No tag exists.

The fresh inventory found:

- no issue or pull request;
- no issue comment, pull-request comment, or review parent object;
- no release or release asset;
- no Actions run, log, or artifact parent object; and
- disabled wiki, Discussions, and Pages surfaces.

The authorized rewrite changed only private GitHub `main` with an exact lease.
Later authorized updates were normal fast-forward pushes. No old branch,
recovery ref, tag, repository setting, visibility setting, release, issue,
pull request, or GitHub feature state changed.

## Browser artifact boundary

Fresh Next.js and Astro builds used six unique public canaries and ten unique
server-only canaries. The complete `.next` and `apps/marketing/dist` trees
passed the artifact proof:

- every public canary had at least one intended placement;
- Next public canaries appeared only in the Next build;
- Astro public canaries appeared only in the Astro build;
- no public canary crossed application surfaces; and
- no server-only canary appeared in either build.

The final proof found 20 Next artifact-file placements and 23 marketing
artifact-file placements. Tests also prove that an absent public canary, a
cross-surface public canary, or any server canary fails the check.

The exact local `npm run build` completed with Next 16.3.3 Turbopack. Vercel
also completed the default Turbopack build for the audited executable commit.
The Astro build generated five static pages, and the Astro check reported zero
diagnostics.

## Public database and authorization evidence

A clean local Supabase reset applied all 33 tracked migrations through
`20260825080815_add_occurrence_sync_batch_order_index.sql`. The static catalog
audit covered every public relation, function, grant, and policy.

The schema has 18 public tables and no public view. Every table has RLS
enabled. Thirteen tables retain anonymous grants, but no policy authorizes the
anonymous role. No public function is executable by the anonymous role. The 12
authenticated functions match the checked registry. Every `SECURITY DEFINER`
function has a pinned search path.

The local ordinary-client RLS smoke created three temporary accounts. It
passed 92 ownership checks across all relations and authenticated functions.
It exercised cross-account reads and mutations through Data API paths. Cleanup
removed all temporary accounts. Local advisors reported no error-level
finding.

Hosted read-only migration and catalog verification matches local state. The
remote migration list contains all 33 migrations. A push dry run reports the
database up to date. The hosted catalog reports the same 18 RLS-enabled public
relations, no public view, no anonymous policy or executable function, 12
authenticated executable functions, and no unpinned security-definer
function.

The already-passed hosted RLS smoke remains applicable. It passed 92 ownership
checks and cleaned three temporary users. No schema, RLS, or privileged caller
source changed afterward. The final bounded window forbade hosted-data
deletion, so the release gate reused that evidence instead of creating new
fixtures. No hosted data changed during the final verification.

Hosted advisors returned no error. Nine security warnings and 31 performance
warnings remain documented. They do not expose an anonymous authorization
path or create a high or critical dependency finding.

## Privileged caller inventory

The server-only Supabase client supports development test login, account
deletion, protected occurrence processing, and protected reminder processing.
Local verification scripts use loopback credentials for bounded fixture
lifecycle. Normal browser data access uses ordinary authenticated clients.

Protected process routes read process secrets only on the server and compare
request values with timing-safe equality. Sequenzy and VAPID private keys stay
inside server provider adapters. The AgentMail key stays inside its operator
CLI. Database and Vercel credentials have no application client caller.

The source check, artifact proof, privacy-safe error paths, and export review
found no route that returns or logs a service-role key, provider secret, OAuth
secret, process secret, database credential, or session material to a browser
or exported artifact. Public Supabase configuration and the VAPID public key
remain the documented browser values.

## Dependency and build evidence

A clean `npm ci` installed the committed root workspace and lockfile. It did
not change `package.json`, `apps/marketing/package.json`, or
`package-lock.json`. The reproduced tree contains Next 16.3.3, Astro 7.2.6,
esbuild 0.28.2, PostCSS 8.5.26, sharp 0.35.3, and SVGO 4.1.0.

Both `npm audit --omit=dev --audit-level=low` and full
`npm audit --audit-level=low` returned exit code 0 with zero findings. The
esbuild override selects 0.28.2 within Vite 8's peer range. Astro and Next
retain sharp and SVGO through transitive contracts. Marketing does not declare
unnecessary direct copies.

The root Node engine requires Node 24.x. Local release verification, GitHub
Actions, and both Vercel projects target the same major.

The complete clean verification passed:

- `npm run agents:check`;
- `npm run interactions:check`;
- `npm run resolvers:check`;
- `npm run lint`;
- `npm run typecheck`;
- `npm run test` with 130 files passed, one skipped, 1,008 tests passed, and
  one skipped;
- exact `npm run build` with Next Turbopack;
- `npm run marketing:build`;
- `npm run marketing:check`;
- both dependency audits;
- the public-source and canary artifact checks; and
- `git diff --check`.

## Production evidence

Web deployment `dpl_3KGt9dNUy2bg1UxtMdLWDakqDBSZ` is READY at the audited
executable commit. Vercel installed with npm 11.17.0 and completed the default
Next 16.3.3 Turbopack build. The canonical, project, and main-branch aliases
remain unchanged. Public policy routes and protected application routes return
the expected successful responses. Unauthenticated process-route probes return
401. Verification sent no email or push notification.

Marketing deployment `dpl_7gLBemWhZ9WuaUujD2npwu62JUGd` is READY at the same
commit. The monorepo-root upload contained 669 committed files. Vercel used the
root workspace, root lockfile, and root overrides. It resolved esbuild 0.28.2
and completed the Astro build. The canonical alias
`cadence-marketing-two.vercel.app` remains unchanged. All 19 audited routes
returned HTTP 200.

The marketing Astro config supplies an inline empty PostCSS plugin list. This
prevents Vite from discovering the web application's root Tailwind/PostCSS
config during a marketing-scoped install. The boundary adds no dependency.
It preserves one root lockfile, one override policy, and the existing npm
workspace contract. A marketing-local lockfile is unnecessary.

## Ticket 099 policy evidence

The root MIT `LICENSE` names the approved holder. `README.md` documents the
license boundary for source, documentation, synthetic samples, binary assets,
and Cadence marks. `SECURITY.md` defines the monitored email and GitHub private
disclosure routes. `THIRD_PARTY_NOTICES.md`
preserves required upstream notices.

The owner assigned the security inbox monitor. One separately authorized
synthetic route-test email reached the approved mailbox. No recipient,
provider, message, header, vulnerability, credential, user, or behavior data
appears in this record. Ticket 098 sent no email or push notification.

## Completion boundary

Ticket 098 has no remaining release blocker. The decision is PASS.

Ticket 100 is `complete`. The canonical repository is public at
`https://github.com/emixd12/habit-tracking-app`. Production verification used
commit `c86a6d4a366a6e322a23b6977f9c2d812efdef25`. The repository owner is the
incident rollback owner. Publication cannot be retracted from existing clones
or forks.

## Ticket 100 publication evidence

Initial publication occurred from reviewed private `main` at
`a640740798514ac6b6bbe054e0240f400160a03d`. GitHub Free rejected protection
while the repository was private. The authorized provider-required order made
that reviewed commit public, protected `main`, and then merged PR #1. PR #9
added the previously omitted public-source check. CI run `32920923372` passed
at `56609924d637947234c695905f46c6d6e6eef203`, and PR #9 merged as the released
implementation commit.

Protection requires strict `verify`, applies to administrators, requires a
pull request, and blocks force pushes and deletion. The dependency graph,
Dependabot alerts and security updates, secret scanning, push protection,
private vulnerability reporting, and CodeQL default setup are enabled. The
first CodeQL run `32921147161` passed for Actions, JavaScript/TypeScript, and
Python.

Initial review found one CodeQL alert for incomplete multi-character
sanitization in the repository-only Markdown heading slug check. It was closed
as a false positive because the final allowlist removes HTML delimiters and the
slug is used only for in-memory anchor membership. Open secret-scanning,
Dependabot, and CodeQL alert counts are zero.

GitHub does not let a repository administrator self-submit through the public
private-report form. The maintainer-side equivalent created one harmless low
draft advisory and immediately closed it. This verified the private advisory
route without publishing a vulnerability or changing product data.

An unauthenticated HTTPS clone at the released implementation commit exposed
`LICENSE` and `SECURITY.md` and passed the documented clean install, repository
checks, public-source check, lint, typecheck, 1,008-test suite, Next build,
Astro build, and Astro check. An unauthenticated browser reached the canonical
repository from the marketing `View on GitHub` link.

The `cadence` production deployment `dpl_FzvK2siMz4VwkCQ5hCxSTCcKa1bH` and
the `cadence-marketing` production deployment
`dpl_DMAQ4o6u1QkqxtGC2WZ9YramCe42` are READY at the released implementation
commit. No domain, environment variable, secret, billing, plan, installed-app,
or Vercel project setting changed.

Post-publication production verification passed on 2026-08-25. A fresh Google
OAuth flow using the existing account completed through the production
callback and returned to the authenticated Timeline. Timeline read and one
reversible status mutation, notification readiness, and account-deletion
confirmation gates passed. The authenticated Export page rendered all four
download contracts. One CSV download returned a non-empty attachment with the
expected contract. The temporary copy was removed immediately without
retaining its contents.

An intentionally wrong account-deletion confirmation kept the production
Delete account control disabled. The account remained authenticated and the
visible behavior inventory remained unchanged. This verified only the client
gate. It did not invoke the deployed Server Action or exercise Auth-deletion
failure recovery. No destructive owner-account deletion was attempted.

The hosted cross-account RLS smoke passed 92 ownership checks and removed all
three temporary users. Reminder processing checked, claimed, and sent exactly
one synthetic browser delivery to one active owner-controlled subscription.
Exact cleanup removed its behavior, occurrences, deliveries, status events,
schedules, configuration records, and time sessions. No email was sent and no
real user record was deleted.

Marketing reported no runtime error in the verification window. The app
reported one Node `url.parse()` deprecation warning from the browser-push
dependency during the successful send. A bounded synthetic direct-HTTP
deletion-failure probe could not invoke Next's encrypted server action and
returned 500 before application logic. Every temporary account and profile was
removed. At that time, the probe and browser gate did not satisfy the remaining
production acceptance criterion.

The final authorized production check passed on 2026-08-26. One disposable
Google-authenticated account created one synthetic Behavior. Production
deployment `dpl_HFhFd4T5Z4YjbVFbzkmGTrXybvEB` set the bounded server-only
canary for that account and ran the deployed browser Server Action. Settings
returned the documented recoverable error. The session stayed authenticated,
and the profile, one Behavior, and 31 occurrences remained.

The canary variable was removed and read back as absent. Production deployment
`dpl_7TUcDZSMsonnLnhte8cvwCes5gHD` redeployed the same reviewed Git tree with
normal deletion restored. Settings then deleted the disposable account through
the normal path. Auth plus all 18 user-owned tables reported zero remaining
rows. No identifier, email, token, payload, secret, or user data is retained in
this record.

PRs #11 and #12 merged through protected `main`. Exact `main` push CI run 27
passed. Required conversation resolution is enabled and was read back as
active. The temporary canary variable is unset. No lasting domain, environment,
secret, billing, plan, installed-app, or real-user-data setting changed.
## Ticket 102 GitHub Pages boundary

Ticket 102 uses GitHub Pages only for workflow-artifact evidence. It does not
commit generated evidence to `main` or a Pages branch. Pages must use GitHub
Actions as its source. Enabling Pages remains an owner-authorized repository
mutation. The workflow grants Pages and OIDC writes, read-only repository
content, and read-only security-event access.

Keep CodeQL, Dependabot, secret scanning, and push protection enabled. When an
API cannot expose a safe aggregate, the snapshot records Unavailable. The
workflow never publishes raw alerts, scanner matches, advisory notes,
repository administration payloads, credentials, or production user data.

## Ticket 186 rename preparation — October 7, 2026

The owner authorized renaming the existing repository to `emixd12/cadence`.
Repository ID `1261353608`, release assets, desktop identity, and production
domains must remain unchanged. The user-site archive preserves historical
Pages evidence. Plan: `docs/plans/2026-10-07-cadence-project-rename.md`;
execution evidence: `docs/qa/cadence-project-rename.md`. Historical acceptance
above is unchanged.

Completed October 8, 2026 at 20:56 UTC. The repository is `emixd12/cadence` with
the same ID. Settings, refs and releases are unchanged, and the old repository
URLs redirect. `emixd12.github.io` serves all 76 historical Trust evidence files
at their original `/habit-tracking-app/trust/` URLs with identical bytes. New
evidence publishes under `https://emixd12.github.io/cadence/trust/`. Never
create a repository named `habit-tracking-app`; it would end GitHub's redirects.
