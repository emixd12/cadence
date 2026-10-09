# Vercel Workflow

This repository deploys to the existing Vercel project `cadence` under team
`Emi's projects`. Do not create a duplicate Vercel project for this app.

The current Vercel project `cadence` owns the authenticated web app. The Astro
marketing site is deployed separately as the Vercel project
`cadence-marketing`, currently aliased to
`https://cadence-marketing-two.vercel.app`. Do not change production routing
casually: authenticated app routes, marketing canonical URLs, and Supabase OAuth
redirects must remain stable.

Authoritative upstream docs used for this workflow:

- Vercel deployments: `https://vercel.com/docs/deployments/overview`
- Vercel Git integration: `https://vercel.com/docs/git`
- Vercel environment variables: `https://vercel.com/docs/environment-variables`
- Vercel Cron Jobs: `https://vercel.com/docs/cron-jobs`

The root `package.json` requires Node.js 24.x. Keep local release verification,
GitHub Actions, and both Vercel projects on that major so Next.js and Astro
build under the deployed runtime.

## Current Project

Verified on 2026-06-08 with the Vercel plugin:

- Project: `cadence`
- Team slug: `emis-projects-4c886aeb`
- Team ID: `team_BxWfRYU1gqrl6Ba6t7Vm3wp1`
- Project ID: `prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`
- Framework: Next.js
- Repository: `emixd12/cadence`
- Production branch: `main`
- Repository root/build entrypoint: `.`
- Node runtime setting: `24.x`
- Build command observed in production logs: `npm run build`
- Canonical production URL: `https://cadence-blush-three.vercel.app`
- Secondary production alias: `https://cadence-emis-projects-4c886aeb.vercel.app`

The production deployment observed during Ticket 013 was
`dpl_3t9JNdQxUEZsR5MnYpVumE4Tc4aJ`, ready at commit
`64fa1045492b8f0fc3a89babd470a043174b5227`.

## Marketing Project

The public Astro marketing site is deployed separately:

- Project: `cadence-marketing`
- Current production alias: `https://cadence-marketing-two.vercel.app`
- Git repository: `emixd12/cadence`
- Production branch: `main`
- Workspace root: `apps/marketing`
- Build command: `npm run marketing:build`
- Node runtime setting: `24.x`
- Canonical URL source: `MARKETING_SITE_URL`

Keep this project separate from the authenticated app unless a future scoped
workspace/routing ticket changes the deployment model.

## Environment Variables

Set these in Vercel for both Production and Preview unless a preview environment
intentionally uses separate Supabase or Sequenzy resources:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID=
SEQUENZY_API_KEY=
SEQUENZY_REMINDER_TEMPLATE_SLUG=habit-reminder
SEQUENZY_API_URL=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
REMINDER_PROCESS_SECRET=
CRON_SECRET=
NEXT_PUBLIC_MARKETING_SITE_URL=
MARKETING_SITE_URL=
PUBLIC_CADENCE_APP_URL=
CADENCE_PERF_LOG=0
CADENCE_TRUST_MARKETING_DEPLOYMENT_ID=
```

Rules:

- `NEXT_PUBLIC_SITE_URL` should be the canonical production URL in Production.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is preferred. Keep
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` only for legacy Supabase projects that still
  need it.
- `SUPABASE_SERVICE_ROLE_KEY`,
  `CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID`, `SEQUENZY_API_KEY`,
  `VAPID_PRIVATE_KEY`, `REMINDER_PROCESS_SECRET`, and `CRON_SECRET` are
  server-only. Never prefix them with `NEXT_PUBLIC_`.
- Keep `CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID` unset except during
  the exact authorization-gated Ticket 100 procedure in `docs/OPERATIONS.md`.
- For Vercel Cron, set `CRON_SECRET` to the same value as
  `REMINDER_PROCESS_SECRET` unless there is a deliberate secret rotation plan.
- `SEQUENZY_API_URL` can be omitted when using the default
  `https://api.sequenzy.com`.
- `NEXT_PUBLIC_MARKETING_SITE_URL` belongs to the authenticated app project and
  should point at the matching marketing deployment.
- `MARKETING_SITE_URL` and `PUBLIC_CADENCE_APP_URL` belong to the Astro
  marketing project. Preview values must point at the intended Preview targets;
  omission falls back to Production domains.
- `CADENCE_PERF_LOG=1` is an optional short-term Production sampling flag for
  privacy-safe server timing spans. It is not a secret, but it should be enabled
  deliberately and reviewed through sanitized Vercel runtime logs.
- `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` belongs to the application project
  and names the current Ready marketing deployment. The app combines it with
  Vercel's source-commit and application-deployment system variables before a
  Trust check can remain Passed.

## Supabase Auth

In Supabase Auth URL configuration, keep the production site URL and redirect
URL aligned with the Vercel production alias:

```text
Site URL: https://app.cadence-me.com
Redirect URL: https://app.cadence-me.com/auth/callback
Legacy redirect retained: https://cadence-blush-three.vercel.app/auth/callback
```

Only add preview callback URLs when preview OAuth QA is intentionally supported.
Do not use wildcard preview redirects for this single-player public app unless
the Supabase project owner accepts that operational tradeoff.

## Cron Processing

`vercel.json` owns both scheduled triggers:

```json
{
  "crons": [
    {
      "path": "/api/reminders/process",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/occurrences/sync",
      "schedule": "5 0 * * *"
    }
  ]
}
```

Vercel Cron calls the route with `GET`. The route also supports protected
manual `POST` calls. Both paths require an `Authorization: Bearer ...` header
or the manual `x-reminder-process-secret` header. The accepted secret can be
either `REMINDER_PROCESS_SECRET` or `CRON_SECRET`.

Hourly reminder processing keeps sends reasonably close to their planned
`scheduled_send_at`. Daily occurrence processing runs at 00:05 UTC and extends
each bounded account batch's generated horizon using the account timezone.
Both routes use the same protected GET/manual POST contract. If the Vercel plan
cannot run the declared schedules, switch to a plan that supports them or
document an external scheduler that calls the same routes with the same bearer
secret.

Production verification on 2026-06-19 found hourly production
`GET /api/reminders/process` invocations returning 200 for the prior 24 hours,
from 2026-06-18T01:00:03Z through 2026-06-19T00:00:03Z, with no production
warning, error, or fatal runtime logs in the preceding seven days. The latest
deployment at that time became ready at 2026-06-19T00:46:32Z, after the
00:00Z cron tick, so its first post-deploy hourly tick still needed the next
cron boundary.

Manual production check, with a user-approved send plan if due email or browser
push deliveries may exist:

```bash
curl -X POST \
  -H "Authorization: Bearer $REMINDER_PROCESS_SECRET" \
  "https://cadence-blush-three.vercel.app/api/reminders/process?limit=1"
```

## Deployment

Normal production deployment is via the Git integration:

1. Push `main` to `emixd12/cadence`.
2. Confirm the production deployment is `READY`.
3. Confirm deployment metadata points at the intended commit.
4. Inspect build logs for warnings or failures.

If using the Vercel CLI locally, link to the existing project only:

```bash
vercel link --yes --project cadence --scope emis-projects-4c886aeb
vercel deploy --prod
```

Do not commit `.vercel/project.json`; `.vercel/` is gitignored.

### Ticket 100 public-release deployment

Verified on 2026-08-25 at release commit
`cb82e0014fc12d6dbf18fb4719e102a2b5908662`:

- `cadence` deployment `dpl_FzvK2siMz4VwkCQ5hCxSTCcKa1bH` is READY.
- `cadence-marketing` deployment `dpl_DMAQ4o6u1QkqxtGC2WZ9YramCe42` is READY.
- The existing production aliases remained unchanged.
- Marketing reported no runtime error during the verification window.
- The application recorded one Node `url.parse()` deprecation warning from
  the browser-push dependency during a successful isolated send. The request
  completed and synthetic cleanup passed.
- A bounded synthetic raw HTTP deletion probe returned 500 before application
  logic because it could not invoke Next's encrypted server action. All
  temporary accounts and profiles were removed. A production browser check then
  kept an intentionally invalid deletion behind the disabled client gate; the
  account, session, and visible behavior inventory remained intact.

Those two initial checks did not exercise production account-deletion failure
recovery. The bounded canary procedure later passed on 2026-08-26 through the
deployed browser Server Action.

- Canary deployment `dpl_HFhFd4T5Z4YjbVFbzkmGTrXybvEB` was READY from reviewed
  Git tree `916eafe3ef34190b47bd4338a1ddcae52dcc4999`.
- Settings returned the recoverable error. The disposable session and records
  remained intact.
- The canary variable was removed and read back as absent.
- Clean deployment `dpl_7TUcDZSMsonnLnhte8cvwCes5gHD` was READY from the same
  tree and restored normal deletion.
- Normal deletion removed the disposable account. Auth plus all 18 user-owned
  tables reported zero remaining rows.

Ticket 100 is `complete`. The evidence retains no disposable identifier, email,
token, payload, secret, or user data.

The final check temporarily set only the bounded canary variable, then removed
it. No lasting Vercel domain, environment variable, secret, billing, plan,
project, or installed integration changed.

## Production Smoke QA

Unauthenticated checks:

- `/login` renders without server errors.
- `/timeline`, `/behaviors`, `/settings`, `/export`, and the compatibility
  `/analytics` redirect route redirect unauthenticated users to
  `/login?next=...`.
- `/api/reminders/process` rejects missing or wrong secrets.

Authenticated checks:

- Google login completes through `/auth/callback`.
- Behavior create/edit/archive still syncs occurrences.
- Timeline status marking and notes work.
- Settings shows browser notification support and can save a push subscription
  when browser permission allows it.
- Behaviors shows behavior settings plus adherence and behavior-date review.
- Export download links respond.

Check both a desktop viewport and a narrow viewport around 390px wide.

## Public launch additions

Before broad public launch, add smoke checks for:

- new-user signup through Google,
- first-run onboarding,
- account deletion,
- Terms, Privacy, and Trust public route rendering,
- export/account portability,
- rate-limit or abuse-protection behavior where implemented,
- monitoring/error-reporting capture without sensitive behavior content,
- hosted many-user RLS isolation with `npm run smoke:rls` pointed at the
  production Supabase project.

The first monitoring implementation uses privacy-safe structured runtime logs
captured by Vercel. Do not add a third-party monitoring SDK or send behavior
titles, notes, email addresses, push endpoints, request bodies, uploaded
bundles, or reminder message bodies unless a later ticket defines a privacy
model and consent posture.

## Hosted load testing

Ticket 066 may target only a dedicated, synthetic-only staging deployment.
It must never use the current public production hostname as a fallback.

Vercel's current load-testing policy permits load testing only on Enterprise
plans and requires approval before traffic starts. The approval request must
state the exact start and end time, maximum requests per second, target
hostname, source geography, source IPs, distributed or localized posture, and
Fluid Compute posture. Record the Vercel approval reference in private task
notes. Confirm the cost ceiling and available request, function duration,
invocation, memory, CPU, and cost evidence before the first request. Configure
the required log drains before the approved window when the plan needs them.

Run the repository's static gate only after the owner supplies those facts:

```bash
chmod 600 load-tests/.hosted/ticket-066-stage.json
npm run load:hosted:preflight -- --manifest load-tests/.hosted/ticket-066-stage.json
```

The manifest directory is ignored. The command prints only a sanitized
single-stage limit summary. It does not contact Vercel or start Locust. A
passing result is not provider approval and does not authorize automatic stage
advance. Review current policy again when the recorded review is more than 30
days old.

Policy reference:
<https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments>

## Launch spend and traffic controls

Vercel's Spend Management, Firewall, DDoS, and WAF pricing documentation was
rechecked on 2026-08-01. The current team plan, Spend Management setting,
threshold, notification recipients, webhook, and pause posture remain
unverified. Read-only project discovery found 14 projects in the team,
including the Cadence app and marketing projects. Store project identifiers and
the unrelated project inventory only in private operator notes.

Spend Management is currently documented for Pro teams. It applies one spend
amount per billing cycle across the team. Web and email notifications can fire
at 50%, 75%, and 100%; SMS can fire at 100%. Vercel checks spend every few
minutes, so alerts and pauses cannot prevent already-incurred usage. The spend
amount covers metered usage beyond included allocations. It does not include
seats, Marketplace integrations, or separate add-ons.

The optional hard limit pauses production deployments for every project on the
team. It returns a Vercel `503 DEPLOYMENT_PAUSED` response. Raising the amount
does not resume projects automatically; an operator must resume each project.
Because the current team has non-Cadence projects, the owner must approve this
team-wide blast radius explicitly. Do not enable a hard limit, webhook, project
pause, or resume action as part of repository implementation.

Automatic DDoS mitigation remains available on all plans. Vercel does not bill
traffic it classifies and blocks as DDoS. Successfully served traffic before
mitigation, or abusive traffic not classified as DDoS, can still incur usage.
Current May 2026 Vercel guidance says WAF-denied, challenged, or rate-limited
traffic has CDN request and transfer charges waived. Recheck the current plan
and dashboard before relying on any WAF price or feature.

### Route-control inventory

| Traffic class | Current application control | Provider-edge posture |
|---|---|---|
| Static public and legal documents | Static rendering and crawl policy | Observe bursts. Do not challenge ordinary readers or verified crawlers without evidence. |
| Google OAuth start and callback | Server route, sanitized local return path, Supabase provider controls | Observe start-route bursts. Do not apply one broad IP limit to the callback. Test Google completion before enforcement. |
| Protected app reads | Supabase Auth and RLS | Observe aggregate request, error, and latency signals. Do not broad-limit shared networks. |
| Structured export downloads | Auth, RLS, atomic six-per-minute account limit, export breaker | Log path volume only. Account-aware enforcement remains in the application. |
| Push subscription writes | Auth, validation, RLS, supplemental in-memory failed-auth limit | Edge enforcement requires measured abuse and a rule that preserves shared-network access. |
| Next.js Server Actions | Auth, validation, action-specific services, RLS | Use server-action-aware observation. Do not group every action under one IP limit. |
| Reminder and occurrence process routes | Constant-time secret checks, failed-auth limit, batch ceiling, independent breakers | Do not rate-limit Vercel Cron until its bypass is proven. |

The in-memory failed-auth limits remain defense in depth for one runtime. They
are not distributed enforcement. Provider-edge controls own anonymous abusive
traffic when the current plan supports them. The Supabase-backed export limit
owns authenticated export amplification across application instances.

### Candidate log-only rules

These commands are templates. They stage provider settings. Do not run them
without authorization for the exact project. Do not publish them until a human
reviews the draft, production log evidence, preview enforcement, OAuth, Cron,
ordinary tracking, accessibility, and shared-network behavior.

```bash
vercel firewall rules add "Cadence observe OAuth start bursts" \
  --condition '{"type":"path","op":"eq","value":"/auth/google"}' \
  --condition '{"type":"method","op":"eq","value":"GET"}' \
  --action log --yes

vercel firewall rules add "Cadence observe export bursts" \
  --condition '{"type":"path","op":"pre","value":"/api/export/"}' \
  --condition '{"type":"method","op":"eq","value":"GET"}' \
  --action log --yes

vercel firewall rules add "Cadence observe process-route traffic" \
  --condition '{"type":"path","op":"inc","value":["/api/reminders/process","/api/occurrences/sync"]}' \
  --action log --yes
```

After staging, inspect every rule and the complete draft:

```bash
vercel firewall rules inspect "<exact rule name>" --json
vercel firewall diff --json
```

The owner publishes a reviewed draft. Agents must not publish production
firewall rules. Start with log-only production evidence, enforce in Preview,
return to production log-only observation, then request a separate human
production publish decision. Roll back a false positive by returning the exact
rule to `log` or disabling it, reviewing the diff, and having the owner publish
that rollback.

Never pause system mitigations during a cost incident. That action removes
automatic protection and can make the owner responsible for usage that Vercel
would otherwise block.

References:

- <https://vercel.com/docs/spend-management>
- <https://vercel.com/docs/vercel-firewall>
- <https://vercel.com/docs/vercel-firewall/ddos-mitigation>
- <https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing>
- <https://vercel.com/changelog/web-application-firewall-mitigated-traffic-is-free-on-vercel>

## Rollback

Rollback through Vercel by promoting or rolling back to a previous ready
production deployment. The latest known rollback candidate before Ticket 013 was
`dpl_BkZ4Xmh2CCSzhan2zZQ1jqg29Hxp`, but verify the current deployment list
before choosing a target.

## Public repository release verification

Making the GitHub repository public does not authorize a Vercel setting,
environment, domain, or deployment change. Before publication, merge only a
pull request whose `CI / verify` check passed on a non-default branch and
confirm the resulting production deployments identify the intended commit.

After publication, verify Google login, cross-account RLS isolation, Timeline
read and status mutation, Export, account-deletion failure recovery, reminder
processing, and one bounded owner-approved browser-push delivery. Do not send a
notification or create production test data without the separate approval and
cleanup plan required by the owning workflow.

## Public Trust deployment evidence

The release evidence workflow owns Trust collection after both named Vercel
deployments report Ready. It validates output with
`schemas/public-trust-evidence.schema.json` and
`lib/resolvers/public-trust-evidence.resolver.ts`. Vercel deployment IDs and
public deployment URLs are sanitized subjects, not proof by themselves.

Publish each valid snapshot at an immutable commit- or workflow-run-pinned
public URL and retain it indefinitely. A GitHub Pages snapshot path must contain
the workflow run and both deployment IDs. A mutable `latest.json` pointer may
name the newest snapshot only. Never overwrite a snapshot or copy an old Passed
result into evidence for a newer application or marketing deployment.

Consumers compare the snapshot's source commit and both deployment IDs with
the current production release. A mismatch or expired deadline makes a Passed
result Stale. The fixed policy is 24 hours for provenance, public artifact,
application route, marketing route, and hosted migration checks. It is seven
days for dependency, code-scanning, secret-scanning, and cross-account RLS
checks. Ticket 101 performs no Vercel mutation or production collection.
## Ticket 102 provenance collection

The Public Trust workflow reads named deployments through the Vercel API.
Both must report `READY`. Both public Git commit fields must equal the snapshot
source commit. A mismatch is Failed. This evidence covers only the named
Git-to-deployment association. It does not cover private function bundles,
later environment changes, aliases, or provider internals. The workflow keeps
Vercel Git deployment unchanged and needs only a protected read token plus the
existing project and team identifiers.

Preview collection creates a one-hour Vercel share bypass for each named
protected deployment. The collector uses the resulting cookie only while
requesting the allowlisted Preview routes. It never stores the bypass in the
snapshot, details file, Actions artifact, logs, or GitHub secret inventory.
Production collection does not create a bypass.

Production collection requests each configured public Production origin only
after the Vercel API confirms that origin is an alias on the exact named Ready
deployment. It does not follow an immutable deployment host across origins.

Ticket 091 verified the active team is Pro on 2026-09-04. Current
https://vercel.com/docs/cron-jobs/usage-and-pricing permits one-minute intervals
on Pro, so five-minute reminder processing fits the existing plan. Deploy
`get_export_page_summary` before this application revision. Verify an
authorized Preview before Production; Preview does not execute Vercel Cron.
Production cadence acceptance requires the deployed schedule and a bounded
owner-authorized delivery check.


## Ticket 138 domain migration checkpoint, 2026-09-17

The attachment/preparation checkpoint below is historical. The authorized
dashboard continuation records the subsequent DNS, ownership, and publication.

The existing team remains `team_BxWfRYU1gqrl6Ba6t7Vm3wp1`.
The Vercel CLI account readback was `emilianobache-3890` (CLI 59.7.0,
Node 24.19.0). The owner requested both attachments through Ticket 138:

| Domain | Existing project | Readback |
|---|---|---|
| `cadence-me.com` | `cadence-marketing` (`prj_BLlsxoaz1wSvWuK7xcZLLkHglQcR`) | Attached; DNS not configured |
| `app.cadence-me.com` | `cadence` (`prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`) | Attached; DNS not configured |

`vercel domains inspect` returned an A record target of `76.76.21.21` for
both hosts. Recheck at execution time. Keep records DNS-only and preserve
Cloudflare nameservers. Do not substitute a remembered CNAME or change registrar
settings. Public DNS returned `pam.ns.cloudflare.com` and
`vick.ns.cloudflare.com`; apex A/AAAA/MX/TXT and app/www CNAME queries returned
no answer. This is not a complete zone inventory; authenticated DNS readback is
still required before writing. HTTPS and ownership verification have not passed.

The Cloudflare pathway is installed at `dns-edit` scope. Its credential preflight
fails because `.env.local` lacks Cloudflare access. See `SERVICE_CONNECTIONS.md`.
No DNS record, deployment, or hosted environment value changed at this checkpoint.

### Origin inventory and cutover order

| Surface | Existing source | Final target or compatibility treatment |
|---|---|---|
| Marketing canonical, Open Graph, sitemap, robots, Markdown/agent links | `apps/marketing/astro.config.mjs`, `src/data/site.ts`, `src/data/agent-output.ts`, `src/layouts/BaseLayout.astro`; `MARKETING_SITE_URL` | `https://cadence-me.com` after DNS/TLS acceptance |
| Marketing app, privacy, terms, trust links | `PUBLIC_CADENCE_APP_URL` and `src/data/site.ts` | `https://app.cadence-me.com`; legal text stays on app routes |
| Web marketing link | `lib/marketing-site.ts`; `NEXT_PUBLIC_MARKETING_SITE_URL` | `https://cadence-me.com` |
| Reminder and push links | `NEXT_PUBLIC_SITE_URL`, reminder/web-push services | `https://app.cadence-me.com` |
| Supabase web sign-in | Site URL and exact `/auth/callback` allowlist; `app/auth/callback/route.ts` | Add new exact callback before cutover; preserve old callback and existing native allowlist |
| Google sign-in project | `habit-tracker-498717`, Supabase provider callback | Keep separate from Calendar; the Supabase provider callback does not become the app callback |
| Calendar OAuth project | `cadence-calendar-498717`, `GOOGLE_CALENDAR_CALLBACK_URL`, `lib/services/google-calendar-oauth.ts` | Final callback `https://app.cadence-me.com/auth/google-calendar/callback`; retain old registered callback until safe migration |
| Installed Calendar broker | Build-time `VITE_CALENDAR_BROKER_ORIGIN`, `apps/desktop/src/calendar/google-calendar.ts`, native CSP | Keep old HTTPS API origin working without redirects; future builds need new exact CSP origin and installed QA |
| Native returns | `cadence://auth/callback`, `cadence://calendar/callback` | Keep both contracts unchanged |
| Calendar CORS | `lib/services/google-calendar-request.ts` | Same-origin web or the existing three exact Tauri origins; no wildcard needed |
| Public Trust collection | `.github/workflows/public-trust-evidence.yml` protected environment origin variables | Update both production origins and regenerate evidence bound to Ready deployments |
| `www.cadence-me.com` | No configured alias observed | Keep unconfigured for this first cutover; do not claim www support or add a third route implicitly |
| Old marketing/app aliases | Existing Vercel domains | Retain through web/native acceptance; never apply blanket app-origin redirects |

The prepared Calendar callback code accepts the primary
`GOOGLE_CALENDAR_CALLBACK_URL` and optional `GOOGLE_CALENDAR_LEGACY_CALLBACK_URL`.
Both must be exact HTTPS callback URLs registered on the same Google client.
The connection and callback routes select only the configured URL matching the
request origin. Consent, token exchange, and the Settings return therefore keep
the same host and its existing session cookie. Unknown origins fail closed.
The same-account, PKCE, one-use state, and native return checks remain intact.
Tests cover both origins and malicious/unconfigured callback hosts. The
authorized continuation deployed this code. Keep the previous URL in the legacy
setting before switching the primary setting. Keep both stable for in-flight
attempts and while installed clients require the old origin. Do not broaden
CORS or bypass the callback user check.

Execution order: authenticate Cloudflare and save the complete existing record
inventory privately; add only the provider-confirmed routing records; verify
DNS and HTTPS; publish reviewed copy and coordinated origin configuration; add
and test exact auth callbacks; verify Google ownership and branding; smoke-test
new and old web login plus installed native handoff/refresh. Keep old aliases
until all compatibility checks pass. No code default or hosted canonical was
switched while DNS remained unavailable.

Rollback: revert changed canonical/environment values to the captured previous
values and redeploy the prior Ready deployments. Keep old aliases and callback
allowlists available. Restore only changed DNS records from the private inventory;
remove only records created by this change. Remove each new Vercel project-domain
attachment if abandoning setup. Do not delete the domain, nameservers, mail
records, existing OAuth client, or credentials. Domain attachment alone did not
replace a previous production alias.

### Authorized dashboard continuation, 2026-09-17

The owner selected the existing Cloudflare dashboard session. Authenticated
readback showed zero DNS records for `cadence-me.com` before this change. The
operator added only these three records, with Auto TTL:

| Name | Type | Content | Proxy |
|---|---|---|---|
| `cadence-me.com` | A | `76.76.21.21` | DNS only |
| `app.cadence-me.com` | A | `76.76.21.21` | DNS only |
| `cadence-me.com` | TXT | Google Search Console ownership challenge | Not applicable |

Vercel re-confirmed the A targets before execution. Public DNS returns both
A records and the exact TXT challenge. Vercel reports `misconfigured: false`.
Certificate issuance succeeded; both HTTPS homepage and app Privacy returned
200. Search Console confirmed **Ownership verified** through Domain name
provider for Identity Scaffolding (`info@identityscaffolding.com`). Keep the
TXT record installed. This proves domain ownership, not OAuth review approval.
Nameservers, registrar, other zones, and existing aliases remain unchanged.
The zone contained no pre-existing mail or unrelated records to replace.

The Calendar client retains its old exact callback and now also registers
`https://app.cadence-me.com/auth/google-calendar/callback`. Branding retains
legacy domains and adds `cadence-me.com`. Supabase now uses Site URL
`https://app.cadence-me.com` and adds its exact `/auth/callback`, preserving
all six prior redirect entries, including native callbacks. No schema changed.

Six Production settings now coordinate the cutover: the app's canonical URL,
marketing URL, primary Calendar callback, and legacy Calendar callback; the
marketing site's canonical URL and application URL. Vercel required replacing
the old public site URL's Secret entry with Config; its value is public. No
provider secret was changed. Sensitive Vercel values cannot be exported; the
private environment capture contains placeholders for those existing values.
Rollback must restore only the known changed URL settings, never placeholders.

Release candidates use isolated source stages at
`/private/tmp/cadence-domain-release-20260917`. The web baseline is the reviewed
source patch `ac1d998dc500e06d20fdc935059e793a28968decbd1e3072011cbe65804fe291`
from deployment `dpl_4VbtFaFa4qEYQ2WJPdPo5fWWw9Vs`, with five approved runtime
files and three regression tests overlaid. The final stage also includes only
the matching legal-link registry entries and legacy callback environment-example
name. Marketing starts at exact commit
`b047d59a368136f283cf981f42e21b937ec13101` from
`dpl_9NYrBAxhXgjThfnqKYvyVmxxBiEV`, with four approved copy files overlaid.
The unrelated dirty workspace is excluded. Promotion and live acceptance are
recorded separately after candidate checks.


Final Production app: `dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua`.
Final Production marketing: `dpl_5WtNGHwxYgRpfrGMuR4tKYhaivrg`.
Both promotions succeeded. The final app stage passed all seven required
commands and 1,685 tests. Its legal footer uses `NEXT_PUBLIC_MARKETING_SITE_URL`
through the existing helper. The Google branding homepage/privacy/terms fields
now match the canonical public domains and were read back after saving.

Public Trust protected-environment variables now use the new application and
marketing origins. `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` now names the final
marketing deployment above. The previous value was
`dpl_A5FZef6LSZ3c3yRfWiETDju4C75s`. Fresh Trust evidence requires a matching
committed source revision and exact deployment IDs; no workflow or fabricated
Passed result was published for these isolated uncommitted overlays.

For rollback, promote prior app `dpl_4VbtFaFa4qEYQ2WJPdPo5fWWw9Vs` and prior
marketing `dpl_9NYrBAxhXgjThfnqKYvyVmxxBiEV`. Restore the old app and marketing
URL configuration together, including Supabase Site URL and Google branding
links when abandoning the new canonical domains. Preserve both callback
allowlists and legacy aliases while rollback is evaluated. Existing deployment
artifacts retain their build-time configuration; restoring project settings
only affects subsequent builds. Never import sensitive placeholders from the
private environment capture. Keep the ownership TXT unless intentionally
abandoning verification. `www` remains unconfigured.


### Calendar review-copy publication — September 17, 2026

Marketing deployment `dpl_8t2tdswkbtotmut2Pbs5B44uA1BE` is Ready and promoted.
Its isolated source stage is `/private/tmp/cadence-domain-release-20260917/marketing`.
Only three previously reviewed marketing copy files changed for this continuation:
`src/pages/index.astro`, `src/data/faq.ts`, and `src/data/routes.ts`. They replace
the obsolete Testing-only limit with pending Calendar-access review. The public
homepage and FAQ both return the new copy and no longer state the old test limit.
The authenticated candidate check also verified the canonical Cadence URL.
Deployment protection remains enabled. Marketing checks and build pass.

The application deployment remains `dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua`. Its
Production `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` setting now names the new
marketing deployment. This affects subsequent builds; the running app retains
its old build-time reference. Fresh commit-bound Trust evidence remains pending.
No new Trust Passed claim or app release was made for this copy correction.
Rollback for this correction: promote marketing
`dpl_5WtNGHwxYgRpfrGMuR4tKYhaivrg` and restore its deployment-reference setting.

Repository user-guide copy now describes the same pending-review state.
`agents:check`, `interactions:check`, `resolvers:check`, and `git diff --check`
pass. Full app lint/typecheck/tests/build from the preceding isolated release
remain the code evidence; this continuation changes copy and records only.
Logs are under `/private/tmp/cadence-domain-release-20260917/logs`.

The recording page is isolated and signed into the dedicated test account.
Chrome focus changed before recorder startup completed. No new recording was
confirmed. The page and unsubmitted Google questionnaire remain open for
continuation when Chrome can remain on Cadence during capture.


### Privacy availability correction published — September 17, 2026

Production app `dpl_2J1VKxrPY6gDvxVTNzFf8hpMRZ4b` replaces
`dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua`. The existing isolated web candidate changed
only the obsolete Privacy Testing-mode availability sentence and its existing
assertion. It now says Calendar-access review is pending. Data handling and
retention disclosures remain unchanged. This follows the authorized provider
status change; it is not a new independent legal review.

All seven required candidate commands pass: agents, interactions, resolvers, lint,
typecheck, test, and build. Tests: 1,685 passed, 26 skipped. The initial sandboxed
run rejected the loopback test listener; the authorized rerun passed. The workspace
focused legal test also passes (5 tests). Candidate and public Privacy responses
contain pending-review copy, retain Limited Use disclosure, and omit the stale
test-user limit. The new app build picks up marketing deployment
`dpl_8t2tdswkbtotmut2Pbs5B44uA1BE`; fresh commit-bound Trust evidence remains pending.
Rollback for this copy-only app release is the preceding app deployment above.
Logs: `/private/tmp/cadence-domain-release-20260917/logs/privacy-production-*`.

The updated-brand recording completed and the test grant is disconnected.
The user must download the recorder artifact because browser URL policy blocks
automated access to the extension video page. Download, privacy review, readable
client-ID evidence, and unlisted replacement upload remain pending. The final
Google data-access questionnaire is still unsubmitted.


### Final demonstration and Google submission — September 18, 2026

The downloaded replacement video passed privacy inspection, decoding, complete
local playback, and unauthenticated privacy-enhanced YouTube playback. It is
Unlisted at https://youtu.be/vUi5s2B51Uo on brittlebeliefs. The main recording shows
actual verified Cadence branding; a separately labeled ending uses an earlier
capture of the same production client ID. Detailed provenance is recorded in
`docs/qa/google-calendar-capabilities.md` (repository-relative).

Google accepted the final data-access submission at 10:52 EDT. Verification Center
reports under review and Trust and Safety confirms receipt. Branding remains
verified; Calendar data-access approval is still pending. Ticket 140 is complete;
Ticket 141 remains open for Google's decision and post-approval smoke checks.
Emiliano Bache Rodriguez monitors info@identityscaffolding.com. Daily 09:00 local
task follow-up checks Verification Center and stays quiet without meaningful changes.

No deployment or runtime code changed in this final submission continuation.
App production remains `dpl_2J1VKxrPY6gDvxVTNzFf8hpMRZ4b`; marketing remains
`dpl_8t2tdswkbtotmut2Pbs5B44uA1BE`. Earlier required runtime checks remain valid.
Fresh commit-bound Trust evidence is still pending; no new Trust Passed claim.
Owner Privacy approval remains distinct from independent legal review and Google approval.

Final documentation checks passed: `agents:check`, `interactions:check`,
`resolvers:check`, and `git diff --check`. No new runtime change required another
full build or test run.


### Behavior planning release — September 18, 2026

Deployment `dpl_DqLBYnrVyJQfDFV3YFcCRWicT29f` is READY and promoted at
`https://app.cadence-me.com`. It adds Tickets 142–143 to the preceding production
source, `dpl_2J1VKxrPY6gDvxVTNzFf8hpMRZ4b`, preserving its Privacy correction.
The release excludes unrelated workspace web changes and pending migration
`20260916195000`. Only migrations `20260918010100` and `20260918010200` were pushed.

All seven candidate checks passed; 1,745 tests passed and 26 skipped. Hosted
rollback SQL, authenticated form QA, public redirects, processing-route auth,
and production-domain readback passed. No runtime errors appeared in the
post-promotion check. Marketing and native packages were not published.
Older native clients require the pending update to synchronize Behavior writes.

This CLI deployment has a source manifest, not a matching Git commit claim.
See `docs/qa/behavior-planning-fields.md` for the source hash, rollback reference,
verification boundaries, and local evidence directory.
