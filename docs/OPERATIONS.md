# Agent Operations Runbook

Use this file after `AGENTS.md` and `STATUS.md` to run the repository consistently.

For a new external service, complete the reusable brief in
`docs/INTEGRATION_PLAYBOOK.md` before committing to scope. Keep runtime product
connections separate from agent access to provider accounts.

## Current state

The repository contains the complete numbered implementation sequence through
Ticket 063, including the authenticated web app, BehaviorLog portability,
public-launch hardening, performance and UX follow-ups, the Astro marketing
site, the export prompt library, and the locally actionable P3
interaction-audit cleanup. IA-024 remains product-decision-gated; no other
interaction-audit item is open. `STATUS.md` remains the detailed implementation
ledger and should be checked before starting or continuing any ticket.

Cadence's product posture has moved from private-only usage to a public
open-source product with multiple surfaces. The current implemented surfaces
are the authenticated Next.js web app and the sibling Astro marketing site. See
`docs/PUBLIC_PRODUCT_ARCHITECTURE.md` before starting public-product,
marketing-site, workspace, desktop, or mobile work.

## Setup

```bash
npm ci
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Use Node.js 24.x. Local release verification, GitHub Actions, and both Vercel
projects use the same major. The root `package.json` enforces that version.

If local `npm` or `node` is not on the shell path, load the workspace
dependencies and use their Node 24 runtime. Do not run release checks with the
older Node installation under `/Users/emi/.local/bin`.

## CLI commands

Project-local CLI tools:

```bash
npm run supabase -- --version
npm run sequenzy -- --version
npm run agentmail:version
```

Supabase and AgentMail are dev dependencies. The Sequenzy command downloads
the exact reviewed CLI version through npm's isolated execution cache, so it
requires npm registry access when that version is not already cached.

### Search Console agent CLI

Use the existing `gcloud` identity `info@identityscaffolding.com` to impersonate
`polyak-agent@polyak-precious--1726112956978.iam.gserviceaccount.com`.
The CLI targets only `sc-domain:cadence-me.com`. It captures short-lived tokens
in memory and preserves existing ADC credentials and global CLI configuration.
No service-account key or additional OAuth client is required.

Cloud IAM impersonation and Search Console property access are separate.
Scoped token minting and the Search Console API succeeded on 2026-10-07;
the service account did not yet have Cadence property access.
The owner must grant this service account **Full** user access in Search Console
before the commands can operate on Cadence. Confirm the grant with `verify`.

```bash
npm run search-console -- verify
npm run search-console -- sitemaps
npm run search-console -- inspect --url http://cadence-me.com/
npm run search-console -- inspect --url https://cadence-me.com/
npm run search-console -- query --start 2026-10-01 --end 2026-10-07 --dimensions page,query
```

Read commands request `https://www.googleapis.com/auth/webmasters.readonly`.
The following writes request `https://www.googleapis.com/auth/webmasters`.
Run a write only after a specific operator instruction names that action and
sitemap URL. Access authorization alone does not authorize sitemap changes.

```bash
npm run search-console -- submit-sitemap --sitemap https://cadence-me.com/sitemap.xml
npm run search-console -- delete-sitemap --sitemap https://cadence-me.com/sitemap.xml
```

Deletion removes the sitemap submission, not website files or search results.
Inspection returns Google's indexed state, not a live crawl. The API cannot
enumerate Page indexing exclusions or request indexing for ordinary HTML pages.
Use the Search Console report or an authorized export for excluded examples.
Performance queries return at most 25,000 rows per invocation and do not paginate.
Before the property grant, `verify` returned HTTP 404 on 2026-10-07.
HTTP 403 or 404 requires checking property access, token scope, API enablement, and quota;
never print tokens to diagnose it. See Google's [authorization guide](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing).
The October 7 alert evidence is in `docs/qa/2026-10-07-search-console-indexing.md`.

CLI verification on 2026-10-07: agents, interactions, resolvers, lint, typecheck,
and build passed. `npm run test -- --maxWorkers=2 --testTimeout=30000` passed
2,523 tests; 29 skipped. The sandbox blocked existing socket tests and font
downloads; authorized reruns passed. Both requested token scopes reached
`sites.list` with HTTP 200 and no Cadence entry. No sitemap write was executed.

## Standard verification

### Day-progress review bench (Ticket 132)

The development-only `/design-system?preview=day-progress` surface compares
synthetic layouts using actual Occurrence controls. Select the first free
loopback port in 4321–4330 and pass it explicitly to Next. The bench is disabled
in production and must not query account or provider data. Owner layout review
passed on 2026-09-16; Ticket 132 is complete. `docs/qa/day-progress-layout.md` records
the accepted baseline; `docs/qa/day-progress-release.md` separates later release gates.
Ticket 134 starts with `docs/EXTERNAL_EVENT_CONTRACT.md`, then connector
credentials, retrieval, and cache infrastructure. Minor UI polish is deferred.

Calendar capability research lives in `docs/qa/google-calendar-capabilities.md`.
Research does not authorize provider configuration or real-account access.
No Calendar connector or cache is enabled by the synthetic bench.

### Required commands

Before marking a coding task complete, run:

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
```

For UI changes, also run the app and inspect at least:

- `/timeline`
- the affected route
- a desktop viewport
- a narrow mobile viewport around 390px wide

### Codex local timing QA action

The project-local Codex environment includes **Run Local Timing App**. Stop any
other app process on port 3000 before starting it from the Codex action menu.
The action starts or reuses local Supabase, applies pending local migrations
without resetting local data, loads the local runtime keys into the app process,
and starts Next.js with the temporary local test-login route enabled. It overrides
hosted values from `.env.local` only for that app process.
The action delegates the full sequence to `scripts/run-local-timing-app.mjs` so
interactive CLI commands cannot consume the remaining terminal input.

On `/login`, choose **Continue as temporary test user**, create a Behavior
scheduled for today, and open its Timeline Occurrence to test **Track Time**,
**Stop**, and **Reset tracked time**. Local Supabase still requires Docker or a
compatible container runtime.

For many-independent-user RLS smoke QA, point the Supabase environment variables
at the intended local or hosted project and run:

```bash
npm run smoke:rls
```

The command uses service-role credentials only to create and clean up temporary
auth users. Data access checks run through ordinary signed-in publishable-key
clients.

## Local Locust protocol smoke

Ticket 063's Locust harness is local-only. It refuses non-loopback Cadence and
Supabase URLs, even when `.env.local` contains valid hosted credentials. Docker
and the project-local Supabase stack must already be running.

Install the pinned Python environment and run its governance tests:

```bash
npm run load:install
npm run load:manifest:check
npm run load:python:test
```

Start the supervised one-user Locust web UI:

```bash
npm run load:web
```

Run the bounded one-user authenticated protocol proof:

```bash
npm run load:protocol:smoke
```

Both modes use `scripts/load-test-protocol-smoke.mjs` to create exactly one
run-scoped `cadence-load-...@example.invalid` account, seed only synthetic
owned data, inject the local Supabase configuration, start the local app, and
remove the exact account and session file on exit. Locust receives ordinary
auth cookies, never the service-role key. Do not invoke Locust directly for an
acceptance run because that bypasses target preflight, persistence checks, and
verified cleanup.

Session material and generated CSV/HTML output live under ignored
`load-tests/.runs/`; the session file and directory are owner-only. Never copy
cookies, passwords, tokens, keys, Auth user IDs, product row IDs, emails,
fixture text, notes, response bodies, or provider payloads into reports. Only
sanitized aggregate summaries and the synthetic run ID may be committed. A
cleanup failure is a failed run and blocks later load tickets.

The exact architecture, assertion contract, and Ticket 064–066 provider gates
are in `docs/LOAD_TESTING_PLAN.md`.

## Local many-account read-load lifecycle

Ticket 064 extends the one-account protocol proof into a disposable
many-account read baseline. It is still local-only: target classification must
be exactly `local`, and both the Cadence and Supabase endpoints must be
loopback. Never use a hosted application, hosted Supabase project, Vercel
deployment, or production data as a fallback.

Use `docs/LOAD_TESTING_RUNBOOK.md` for the exact setup, preflight, run, abort,
integrity, cleanup, and recovery sequence. Use one of the canonical supervised
commands:

```bash
npm run load:read:smoke
npm run load:read:baseline
npm run load:read:ramp
npm run load:read:full
```

Each command is an independent run with its own identities, artifacts, and
exact cleanup. `load:read:smoke` runs the three-minute read smoke and two-minute
warm calibration. `load:read:baseline` adds the 5-user and 10-user 10-minute
baselines. `load:read:ramp` also runs the four-minute 10/25/50/100-user
plateaus and five-minute recovery. `load:read:full` adds the separately tagged
five-user, five-minute Heavy schedule stage and is the complete Ticket 064
sequence. Do not substitute a raw Locust invocation that bypasses the
supervisor.

The reusable local lifecycle is:

1. Pass Ticket 063's manifest, Python, and authenticated protocol checks.
2. Validate local endpoints, declared run ID, ignored owner-only artifact
   paths, profile, durations, user ceiling, and abort ceilings before creating
   an account.
3. Provision exact run-scoped `cadence-load-...@example.invalid` identities and
   seed the requested Empty, Typical daily, Review-heavy, Export-heavy, or
   explicitly tagged Heavy schedule cohorts.
4. Sign in and prepare sessions before statistics. Assign one unique ordinary
   session and cookie jar to every active virtual user, including while it
   selects a public-document task; fail if the pool is exhausted.
5. Run pre-load integrity, the 1-user three-minute smoke, 1-user two-minute
   warm calibration, 5- and 10-user 10-minute baselines, four-minute
   10/25/50/100-user plateaus, and the five-minute return-to-10-user recovery
   stage.
6. Apply the nominal latency, failure, ownership, provider-isolation, and
   resource gates before advancing at every plateau.
7. Run post-load integrity and the local two-user RLS smoke against the local
   target.
8. Remove every exact run-created Auth user, owned product row, private session
   artifact, and sensitive report copy. Verify zero residuals. Retain only
   inspected aggregate JSON/CSV/HTML evidence.

The service-role key is restricted to server-side exact setup and cleanup,
including their pre/post aggregate boundary checks. It must not reach a Locust
worker. Every timed protected request uses an ordinary signed-in session and
product RLS. Account creation, password sign-in, and cookie generation are
outside normal route statistics.

Default read profiles do not mutate product data, enable email delivery, create
push subscriptions, invoke reminder/occurrence process routes, contact
providers, or submit import, restore, account-deletion, or other destructive
actions. Heavy schedule data is excluded from the default mix and runs only in
an explicitly tagged capacity profile. A full default 100-user fixture may
hold five additional inactive Heavy schedule identities for that separate
stage; they are not part of the default 100-user ramp.

Stop immediately for a non-local target, identity sharing or exhaustion,
service-role exposure, cross-account data, an unexpected `5xx`, provider or
process traffic, a mutation attempt, a breached declared ceiling, failed
integrity, or loss of guaranteed cleanup. Abort still requires safe post-run
inspection and exact cleanup. Cleanup refuses empty, malformed, wildcard, or
broad run selectors and is safe to retry for the same exact run ID.

The supervisor builds and runs Next.js in local production mode and records the
mode, hardware, runtime, Supabase mode, cohort mix, warm/cold state, RPS,
p50/p75/p95/p99, failure ratio, response bytes, integrity results, and cleanup
outcome. Local persistent-Node results do not represent Vercel's instance
lifecycle, autoscaling, cold starts, regional network path, or platform limits
and must not be reported as hosted or production capacity.

The supervisor obtains local Supabase connection values from
`npm run supabase -- status -o env` without trusting `.env.local`, builds the
production app, writes aggregate evidence under
`load-tests/.runs/<run-id>/`, and runs post-load integrity, the same ownership
proof exposed by `npm run smoke:rls`, artifact inspection, and exact cleanup
automatically. A database reset is not required for Ticket 064 and must not be
used as fixture cleanup.

## Local mutation, contention, and operator load lifecycle

Ticket 065 remains local-only and uses the same supervised exact-account
lifecycle. Install and verify the pinned harness first, then select one
independent command:

```bash
npm run load:mutation:smoke
npm run load:mutation:baseline
npm run load:mutation:ramp
npm run load:mutation:spike
npm run load:mutation:soak
npm run load:mutation:breakpoint
npm run load:mutation:timezone
npm run load:mutation:contention
npm run load:mutation:operator
npm run load:mutation:full
```

The default mixed task-selection declaration is 65% protected/export GET-read
tasks and 35% rendered Server Action mutation tasks; reports record the
achieved HTTP ratio after preparation and verification reads. The
representative calibration and mixed stages use the declared 2–5-second think
time, which must appear in both declaration and summary evidence. `timezone`
is a separately tagged, low-frequency changed-timezone profile; `contention`
coordinates two ordinary sessions on the same synthetic occurrence; and
`operator` is the only profile that overlaps protected occurrence/reminder
processing. The supervisor keeps the process secret outside Locust and directs
synthetic email sends only to its loopback fake Sequenzy server. It creates no
active push subscription and must never contact real Sequenzy, Web Push,
OAuth, or another provider.

The Daily tracker owns a dedicated past Needs decision fixture. It completes
that row and clears it back to Unresolved through the selected behavior/day
review's bounded 90-day server-rendered occurrence actions. Separate Timeline
reads and integrity checks retain the Needs decision derivation evidence. The
associated due/past evidence must reconcile seven nonnegative integer fields:
`tracked_occurrences > 0`,
`tracked_deliveries === tracked_occurrences`,
`exercised_occurrences <= tracked_occurrences`,
`clear_events >= exercised_occurrences`,
`unresolved_occurrences === tracked_occurrences`,
`cancelled_deliveries === exercised_occurrences`, and
`reactivated_deliveries === 0`. `exercised_occurrences` counts unique tracked
rows while `clear_events` counts every Clear, so repeated clears may make the
event count larger; both counts must be zero or nonzero together. Suites that
complete `smoke-1` or `mixed-calibration-1` require positive final exercise.
Standalone changed-timezone and contention suites require zero exercise,
Clear, and cancellation counts because they do not execute this path.
Definition-history integrity allows at most five seconds of absolute positive
or negative clock skew and requires nondecreasing revision timestamps.

Before changed-timezone traffic, the supervisor privately fingerprints every
then-past or then-resolved occurrence, including rows resolved by earlier
stages, and requires exact aggregate reconciliation afterward. Before any
protected operator mutation and before every operator request, the local Auth,
profile, sync-owner, and reminder-owner sets must be isolated to the exact run.
The operator plan reserves one non-Locust identity and must causally prove its
private stale state became a newer fresh horizon after occurrence sync.
Retained evidence contains counts only.

Zero **real-provider** sends are permitted. The operator profile intentionally
sends bounded synthetic deliveries to the loopback fake provider; those fake
sends are expected and must reconcile. Non-operator suites require zero
fake-provider requests.

Capacity-oriented mutation sequences establish their latency reference with
one three-minute `mixed_calibration` user. That composite user exposes the
same 100-point task-selection weights as the ordinary Daily tracker, Behavior
maintainer, reflective reviewer, and exporter roles, but it is still one
synthetic identity and a small request sample. Its aggregate p95 is therefore
only a coarse, provisional task-mix reference. The two-times p95 rule is a
local stop/go gate for the same supervised run; it is not a regression
threshold, service-level objective, hosted-capacity estimate, or substitute
for the full cohort and stable-name coverage gates.

Interpret ramp, spike, and breakpoint outcomes without weakening safety:

- A ramp stage that breaches only the exact calibrated-p95 gate is recorded
  with `plateau_passed: false` and
  `recorded_ramp_latency_breach: true`. It forces an integrity checkpoint but
  does not skip a later ramp: all 10/25/50/100-user plateaus execute.
- An unexpected request-failure ratio or any semantic, safety, `5xx`,
  exception, resource, runtime, duration/user, or ceiling failure is fatal.
  It is never converted into a recorded ramp latency breach.
- Breakpoint remains bounded: its first nominal performance failure may be
  retained as a non-passing terminal boundary and skip later breakpoint
  plateaus after the required integrity checkpoint.
- A p95-only breach during `spike-hold-100` may be recorded as expected stress.
  The spike baseline, spike recovery, unexpected failures, `5xx` responses,
  exceptions, resource or ceiling breaches, and every semantic or safety
  failure remain fatal. Require both the primary `spike-recovery-10` gate and
  the distinct `spike-recovery-comparison` gate; the latter records the
  mandatory latency and failure-ratio return to within 10% of the baseline.
- Before the supervisor continues from a ramp latency breach, expected
  breakpoint terminal, or expected stress result, it must run an immediate
  mutation-integrity checkpoint.
  Any violation aborts the suite. Later independent groups do not convert the
  terminal stage into a passing plateau.
- `soak-25` requires all four same-run ramp plateaus and a passing ramp-25.
  It must be strictly below the lowest integrity-clean recorded ramp latency
  boundary; when no ramp boundary was observed, a passing plateau strictly
  above 25 users supplies the boundary. The standalone soak command includes
  calibration, all four ramps, and the 60-minute soak. Final reconciliation
  also checks the later breakpoint boundary.

The soak's app-memory gate uses retained monotonic five-second observations,
not a cold first sample and one hot terminal sample. It compares the median of
the warmed `[5 minutes, 10 minutes)` window with the median of the final five
minutes. Each window requires at least 50 valid app-RSS samples, boundary
coverage within 15 seconds, and no gap over 15 seconds. The terminal median may
grow by no more than the larger of 128 MiB or 25% of the warmed median.
Invalid or incomplete raw evidence fails closed, the instantaneous 4 GiB
process ceilings remain unchanged, and the exact-run checker independently
recomputes the window result. This is a bounded-growth assertion for the
declared workload, not a general memory-leak diagnosis.

Never combine a calibration, plateau, integrity checkpoint, or cleanup result
from different run IDs. Report capacity as the highest executed
`plateau_passed` user count and its achieved requests per second, together with
the first terminal boundary when one exists. If no complete run passes all
selected profiles, final integrity, local RLS smoke, fake-provider
reconciliation, artifact inspection, and exact cleanup, report no Ticket 065
capacity result.

After an authoritative ramp or full run finishes, audit the exact retained
evidence independently:

```bash
npm run load:mutation:evidence:check -- --run-id '<exact-run-id>'
```

This checker recomputes the canonical suite/stage contract, exact report
schemas, artifact inventory and digests, raw CSV/HTML/semantic totals, history
and RPS evidence, resources, integrity and due/past gates, provider/RLS
outcomes, sanitization, and exact cleanup. Both the supervised lifecycle and
the exact-run checker must pass; never edit or merge run directories to obtain
acceptance.

Use `npm run load:mutation:full` only when roughly three hours of uninterrupted
local machine time is available. Every mutation command builds the local
production app, creates a new exact run, runs integrity and RLS gates, stops
its local fake provider, and cleans up in `finally`. The first `SIGINT`,
`SIGTERM`, or `SIGHUP` is cooperative: it stops new stages and active Locust
traffic while allowing integrity, RLS, provider shutdown, artifact inspection,
exact cleanup, and `completion.json` to finish. A missing completion marker
means the lifecycle is incomplete and requires manual exact-run recovery. Do
not invoke raw Locust, run profiles in parallel, substitute a hosted target,
or tune ceilings during an evidence run.

Generic HTTP connection resets or refusals against the local app count as
ordinary request failures; they do not satisfy the repeated database-refusal
gate without explicit database context or an unambiguous database-capacity
message. A runtime-guard abort retains exactly one sanitized initiating reason
in the existing Locust exceptions CSV and then shuts down once. Any exception
row remains a failed stage.

Run the full sequence on an otherwise quiet machine. Host load is part of the
measured system, and a broad latency increase across unrelated request names
can indicate shared-host contention, but aggregate host load does not prove
which process caused it. Treat such a failed run as exploratory: preserve its
sanitized evidence, finish exact cleanup, stop unrelated builds or local load,
and retry from a new exact run with unchanged source, profiles, and gates.
Never raise a ceiling or reuse the earlier calibration to make a retry pass.
If the boundary repeats under controlled quiet conditions, treat it as product
or local-stack evidence rather than dismissing it as contamination.

## Ticket 066 hosted preflight

Ticket 066 hosted traffic is blocked. The repository has no dedicated Cadence
Vercel staging project or separate Supabase staging project. Vercel Enterprise
status and approval are not documented. The owner has not supplied the exact
hostname, authorization reference, approved traffic window and source IPs,
cost ceiling, or monitoring retention.

The static command below validates one owner-approved stage only:

```bash
chmod 600 load-tests/.hosted/ticket-066-stage.json
npm run load:hosted:preflight -- --manifest load-tests/.hosted/ticket-066-stage.json
```

The manifest must be a regular non-symlink file with owner-only permissions.
A repository-local manifest must live under ignored `load-tests/.hosted/`.
The validator rejects production target reuse, non-Enterprise Vercel plans,
missing approval, unsafe data/provider posture, expired windows, unmonitored
runs, broad or invalid sources, automatic stage advance, dirty or mismatched
commits, and missing hosted safety checks. Its output omits hostnames, project
refs, source IPs, and approval references.

The command performs no network request and starts no Locust worker. Do not
create a hosted target, deploy migrations, contact provider support, or run
hosted traffic without the owner's separate authorization. Follow the hosted
section in `docs/LOAD_TESTING_RUNBOOK.md` after every blocker is resolved.

For an interrupted run whose automatic cleanup failed—or whose
`completion.json` is missing—preserve the private exact run metadata and use
mutation mode for inspection and exact cleanup:

```bash
npm run load:integrity -- --run-id "$CADENCE_LOAD_RUN_ID" --mutation
npm run load:cleanup -- --run-id "$CADENCE_LOAD_RUN_ID" --mutation --dry-run
npm run load:cleanup -- --run-id "$CADENCE_LOAD_RUN_ID" --confirm-run-id "$CADENCE_LOAD_RUN_ID" --mutation
```

Never broaden the selector beyond the exact run ID or use a database reset as
recovery. The complete profile durations, fake-provider lifecycle, abort
gates, report inventory, and interrupted-run procedure are in
`docs/LOAD_TESTING_RUNBOOK.md`. Local mutation results describe only the
recorded machine, persistent-Node build, local Supabase Docker stack, synthetic
fixtures, and fake provider; they are not hosted or production capacity.

## Ticket 067 launch cost and surge operations

Ticket 067 local guardrails are implemented. Provider controls and the human
drill remain blocked until the owner approves exact budgets, contacts,
availability tradeoffs, and provider targets. Repository work does not
authorize provider-setting changes, production firewall publication, project
pauses, plan changes, purchases, limit increases, or real incident actions.

### Private cost policy and preflight

Keep the owner policy under the ignored `.launch-safety/` directory. Use a
regular, non-symlink JSON file with owner-only permissions. Do not store account
identifiers, invoice data, payment data, recipient addresses, project refs,
credentials, raw provider exports, or alert payloads in the policy.

The policy schema requires:

- normal monthly budget plus warning, urgent, emergency, and maximum unplanned
  USD thresholds in strictly increasing order;
- maximum accepted hard-stop outage and enabled-or-declined hard-stop posture;
- billing owner, incident owner, alert acknowledgement, emergency control,
  pause, limit-change, and resume roles;
- tested primary and backup notification roles and channel kinds;
- one sanitized plan and cost inventory for Vercel app, Vercel marketing,
  Supabase, Sequenzy, domain, and monitoring;
- fixed or metered dimensions, quotas, overage path, baseline, control coverage,
  and coverage gap for every provider;
- verified Vercel notifications, hard-limit posture, log-only firewall evidence,
  and OAuth/Cron tests;
- verified Supabase Spend Cap posture plus covered and uncovered item records;
- a verified Sequenzy account limit, alert, or manual review control;
- request, error, latency, function, database, Auth, egress, reminder backlog,
  and provider-send monitoring signals;
- separate anonymous, OAuth, authenticated-read, export, push-write, Server
  Action, reminder-process, and occurrence-sync controls;
- Levels 0 through 3 with entry, exit, owner, response time, evidence,
  prohibited actions, rollback, and escalation;
- explicit acknowledgement that alerts can lag, usage can already be incurred,
  provider controls can fail, and some billing categories remain uncovered.

Run the fail-closed static check:

```bash
mkdir -p .launch-safety
chmod 600 .launch-safety/ticket-067-policy.json
npm run launch:cost:preflight -- --manifest .launch-safety/ticket-067-policy.json
```

The command reads no payment data and makes no network request. It prints only
provider, monitoring, traffic-control counts, and the hard-stop posture. It
rejects stale reviews, missing owners, unordered thresholds, untested contacts,
missing costs, missing rollback, unacknowledged gaps, unsafe files, and private
recipient or credential fields.

### Runtime controls

The following server-only variables default to empty and preserve normal
product behavior:

| Variable                                    | Stops                                                    | Preserves                                                          |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `CADENCE_DISABLE_EMAIL_SENDS=1`             | Sequenzy sends before due email rows are read or claimed | Browser push, pending email rows, Timeline, status, Notes, exports |
| `CADENCE_DISABLE_BROWSER_PUSH_SENDS=1`      | Web Push sends before due push rows are read or claimed  | Email, pending push rows, core tracking                            |
| `CADENCE_DISABLE_REMINDER_BATCHES=1`        | The protected reminder batch before any channel work     | Pending rows and all ordinary app access                           |
| `CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES=1` | The protected background occurrence batch before writes  | On-demand owner-scoped freshness and ordinary decisions            |
| `CADENCE_DISABLE_EXPORT_DOWNLOADS=1`        | Structured export downloads before export reads          | Export page review, Timeline, status, Notes, account access        |

Set `CADENCE_LAUNCH_BREAKER_REASON_CODE` to one of `abuse`,
`application_regression`, `cost_surge`, `operator_drill`, or
`provider_incident`. Unknown text becomes `unspecified` and never enters logs.
Monitoring records only breaker, open state, reason, and aggregate blocked
invocation count.

Production environment changes and the deployment needed to apply them require
exact owner authorization. Capture the prior values and deployment first.
Enable only the proven cost source. Verify the new deployment, the expected
`503` plus `Retry-After` route response where applicable, privacy-safe breaker
event, unaffected core tracking, and unchanged queue counts. Roll back by
restoring the prior variables, deploying, and repeating those checks.

Structured exports also use an atomic Supabase-backed limit of six downloads
per account per 60 seconds across formats and application instances. The limit
returns stable `429` and `Retry-After` guidance before export reads. It does not
use IP address, block shared networks, or affect the Export page.

After a clean local migration reset, verify the database-owned decision and
direct-write boundary with:

```bash
npm run smoke:launch-rate-limit:local
```

The command uses only local Supabase. It permits six calls, rejects the seventh,
proves authenticated clients cannot overwrite the counter, and rolls back the
test account and counter.

### Monitoring lens

Use sanitized aggregates only:

- Vercel requests, statuses, latency, function invocations, duration, memory,
  CPU, transfer, builds, monitoring usage, and firewall actions;
- Supabase compute, disk, egress, Auth MAU, logs, database health, connections,
  project count, backups, and add-ons;
- Cadence `5xx`, `429`, breaker events, export-limit events, occurrence-sync
  results, reminder checked/claimed/sent/failed/cancelled counts, and queue age;
- Sequenzy plan allowance, current-cycle aggregate sends, provider failures,
  and account throttle or alert state;
- domain renewal and monitoring or alerting fixed costs.

Do not capture behavior titles, descriptions, Notes, account emails, user IDs,
push endpoints, request bodies, bundle contents, provider payloads, secrets, or
raw recipient data.

### Four-level response protocol

Level 0 — normal:

- Enter below the private warning threshold with stable usage and latency.
- Review usage and notification delivery daily during launch, then weekly.
- Test primary and backup alert delivery monthly without generating billable
  stress traffic.
- Exit when any warning threshold or anomaly is sustained.
- Owner: the private billing and incident owner roles.

Level 1 — warning:

- Enter at the private warning USD threshold or a sustained unexpected usage,
  error, latency, queue, Auth, egress, or send increase.
- Acknowledge within 30 minutes. Identify source, route, method, provider,
  deployment, and expected launch traffic.
- Increase observation. Do not change limits or availability without evidence.
- Exit after two stable observation windows below the entry signal.
- Escalate to Level 2 at the urgent threshold or proven cost amplification.

Level 2 — urgent:

- Enter at the private urgent USD threshold, proven abusive traffic, export
  amplification, reminder backlog, provider-send surge, or application
  regression that accelerates cost.
- Acknowledge within 15 minutes. Enable only the proven scoped breaker or a
  previously reviewed traffic control.
- Preserve Timeline decisions, Auth, RLS, audit history, and pending queues when
  safe.
- Exit after cost acceleration stops and two observation windows stabilize.
- Escalate at the emergency threshold, control failure, integrity concern, or
  unacceptable queue growth.

Level 3 — emergency:

- Enter at the private emergency threshold, maximum unplanned exposure risk,
  active attack beyond scoped controls, provider restriction, or integrity
  threat.
- Acknowledge within five minutes. The authorized owner decides on Attack
  Challenge Mode, provider support, or the approved spend hard stop.
- A Vercel hard stop can pause every production project on the team. A Supabase
  restriction can affect organization services. Confirm blast radius first.
- Publish user communication when availability changes.
- Exit only through the safe-resumption gate below.

Every level prohibits automatic plan upgrades, add-on purchases, compute
resizes, budget increases, unreviewed firewall publication, production data
inspection, broad IP blocking, secret disclosure, and silent mutation loss.

### Safe resumption

One named owner records the go decision only after:

1. cost stops accelerating;
2. traffic, error rate, latency, function, database, Auth, and egress signals
   stabilize;
3. pending, claimed, failed, and cancelled reminder queues are understood;
4. `npm run smoke:rls`, migration congruence, integrity checks, and one ordinary
   authenticated flow pass against the intended target;
5. OAuth callback, Vercel Cron, ordinary status and Note changes, exports below
   the limit, accessibility, and shared-network cases remain usable;
6. rollback steps and the next observation window are assigned.

Resume one scoped subsystem at a time. Start with one bounded request or batch.
Do not unpause unrelated Vercel projects automatically. Increasing a Vercel
spend amount does not resume paused projects.

### Drill

Run the zero-network technical tabletop at any time:

```bash
npm run launch:surge:drill -- --synthetic
```

It simulates a legitimate spike, anonymous abuse, export amplification,
reminder backlog, provider-send surge, hard-stop decision, and false-positive
throttle. Synthetic success proves only state-machine coverage. It does not
prove current provider settings, human alert delivery, owner response, or
production capacity.

After the private policy passes, run the same drill against that policy:

```bash
npm run launch:surge:drill -- --manifest .launch-safety/ticket-067-policy.json
```

Complete a non-production human tabletop with the billing owner and backup.
Record only sanitized outcomes under `docs/qa/launch-safety/`. Do not generate
billable load to test alerts or hard stops.

## Clean-session onboarding QA

Use the dev/test-only login route when a clean browser session needs to exercise
first-run onboarding but Google account access would block the test.

Enable it locally:

```bash
CADENCE_ENABLE_TEST_LOGIN=1
```

If the local app points at a hosted Supabase project, also set:

```bash
CADENCE_ALLOW_HOSTED_TEST_LOGIN=1
```

Safety gates:

- `/auth/test-login` is blocked unless `CADENCE_ENABLE_TEST_LOGIN=1`.
- The route is blocked when `NODE_ENV=production` or `VERCEL_ENV=production`.
- The route only accepts localhost request hosts.
- Hosted Supabase projects require `CADENCE_ALLOW_HOSTED_TEST_LOGIN=1`.
- The service-role key is used only server-side to create a temporary confirmed
  Supabase Auth user. The route then signs in through the ordinary Supabase
  password flow so app code still uses normal auth cookies and RLS.
- One app process reserves at most 10 successful temporary-user creations.
  Creation and successful failure-cleanup release unused reservations. Restart
  the local app after the quota is reached; the quota is intentionally not a
  distributed production control and does not weaken the environment gates.

Clean up stale temporary test users:

```bash
npm run test-login:cleanup
```

The cleanup command deletes only `cadence-test-*@example.invalid` users older
than `CADENCE_TEST_LOGIN_MAX_AGE_HOURS`, defaulting to 24 hours, and reports
counts without printing emails, ids, or auth responses.

Run cleanup after every clean-session QA run. While test login remains enabled,
also run cleanup at least once per day. Disable test login when QA ends. Cleanup
removes database users; restarting the local app resets the separate per-process
creation quota.

## Auth route protection

Protected-route proxy gating uses Supabase Auth `getClaims()` to validate the
cookie-backed access token and refresh cookies when needed. This follows the
current Supabase SSR guidance for page protection and avoids using
`getSession()` in server code.

The proxy matcher also includes `/api/export/*` so long-running authenticated
download clients receive refreshed Supabase cookies. Export APIs are not
treated as protected app-screen routes: an anonymous or invalid export request
continues to its route handler and returns the documented JSON `401` response
instead of redirecting to Login.

Keep strict `getUser()` lookups where the app needs the full Auth user record
or security-sensitive account actions. Ordinary app-route user id and account
label reads should use verified Supabase Auth claims through the shared current
user helper; RLS-backed database access still runs through the ordinary
authenticated Supabase client.

Authenticated sessions can preview the login screen without ending the session
at `/login?preview=1`. The explicit preview URL works in every environment. The
app shell links to it only outside production, so it does not become a normal
production navigation destination. Requests to `/login` without `preview=1`
keep the standard authenticated redirect behavior.

## Source-of-truth order

1. `AGENTS.md`: operating rules and architecture constraints.
2. `STATUS.md`: current implementation state and handoff notes.
3. This runbook plus provider workflow docs.
4. Product docs under `docs/`.
5. Tests and implementation.
6. Current user prompt, when it intentionally changes scope.

If docs conflict, report and fix the conflict before implementing product code.

## Provider workflows

- Supabase: `docs/SUPABASE_WORKFLOW.md`
- Sequenzy: `docs/SEQUENZY_WORKFLOW.md`
- Vercel: `docs/VERCEL_WORKFLOW.md`

## AgentMail Test Inboxes

AgentMail is the repo-standard test inbox layer for agent-led email QA. Use it
to create disposable or task-scoped inboxes for login, auth email,
transactional reminder, SMTP/provider, and app-runtime email testing. It is not
the production sender for auth email or app-runtime communication.

The CLI is repo-scoped and loads `AGENTMAIL_API_KEY` from `.env.local` when the
process environment does not already provide it. Use the project wrapper rather
than a global AgentMail install:

```bash
npm run agentmail:version
npm run agentmail -- --help
npm run agentmail -- inboxes list --limit 20 --format json
npm run agentmail -- inboxes create --display-name "Cadence QA Login" --username cadence-qa-login --domain agentmail.to --format json
npm run agentmail -- inboxes:messages list --inbox-id inb_xxx --limit 10 --format json
npm run agentmail -- inboxes:messages get --inbox-id inb_xxx --message-id msg_xxx --format json
npm run agentmail -- inboxes:threads list --inbox-id inb_xxx --limit 10 --format json
```

General QA loop:

1. Create or reuse an AgentMail inbox and keep the inbox ID plus generated email
   address in private task notes.
2. Use the AgentMail email address as the test recipient in the app flow.
3. Trigger the app flow through the owning auth, notification, or communication
   path.
4. Poll messages or threads, then retrieve the relevant message by ID.
5. Extract only the needed delivery evidence, such as subject, headers, or a
   reduced verification result.
6. Redact email addresses, raw tokens, links, message bodies, names, and
   provider identifiers before adding findings to reports.
7. For production-readiness claims, verify the actual owning email provider and
   app outbox too. AgentMail proves inbox receipt for a test recipient; it does
   not prove real customer delivery configuration.

AgentMail test inbox access belongs to service-access and operations work. It
must not become product, account, notification, export, or provider truth.
Auth and notification behavior still route through their owning contracts.

## Public-product operations

Before broad public launch, scope and verify:

- many-independent-user RLS smoke tests,
- account deletion and export/account portability,
- basic abuse protections and validation,
- monitoring/error reporting without sensitive behavior payloads,
- Terms of Service, Privacy Policy, and privacy/trust content,
- owner mapping for Vercel, Supabase, Sequenzy, VAPID, and cron secrets.

Implemented baseline:

- static RLS policy registry test for user-owned tables,
- Settings account deletion with export acknowledgement and typed confirmation,
- public `/terms`, `/privacy`, and `/trust` routes,
- auth-failure rate limiting for push subscription and reminder processing
  routes,
- bounded reminder processing batch size,
- protected occurrence horizon sync at `/api/occurrences/sync`, scheduled daily
  through Vercel Cron and guarded by `REMINDER_PROCESS_SECRET` or `CRON_SECRET`.
- behavior create/edit/archive/restore marks occurrence sync state stale and
  defers heavy occurrence/reminder repair to the next freshness-aware read
  route or the protected sync process; Settings timezone changes still sync
  immediately because timezone, active behavior schedules, and future
  unresolved occurrences must change together.

Completed public-launch sign-off:

- Ticket 034 fixed the restore-apply readiness defect, verified hosted schema
  congruence, passed hosted multi-user RLS smoke QA, audited hosted
  Auth/provider settings, and recorded sanitized results in `STATUS.md`.

Remaining owner decisions before broader launch:

- decide whether to disable hosted email/password authentication, because the
  product UI exposes Google login only;
- decide whether localhost callback URLs remain allow-listed for development;
- treat CAPTCHA and leaked-password protection as conditional follow-up based
  on the final Google-only provider posture and accepted launch risk.

Implemented follow-up:

- first-run onboarding for behavior creation, notification permission, optional
  import, and timezone through a dismissible Timeline setup pop-up,
- privacy-safe monitoring/error reporting through structured runtime logs that
  avoid sensitive behavior payloads.

## Gated schedule-integrity repair deployment

Ticket 060's schedule repair is a normal git-tracked Supabase migration, but it
mutates existing product rows. Complete the following sequence before and
after hosted deployment:

1. Run `npm run supabase -- db reset` and
   `npm run smoke:schedule-integrity:local`. The smoke is rollback-only and
   covers idempotent repair, preserved statuses, atomic form create/update,
   stale-write refusal, cross-owner refusal, and rollback after a forced slot
   failure.
2. Obtain explicit owner authorization for the linked hosted project, create a
   fresh user-owned export/backup, and compare local and hosted migration
   history. Do not use Dashboard SQL or Table Editor repair.
3. Deploy only with `npm run supabase -- db push`.
4. Run the protected occurrence sync/reminder-planning path once for affected
   stale accounts. The migration itself never creates past reminders.
5. Record only aggregate proof: active empty schedules, orphan/cross-owner
   slots, repaired slot/occurrence counts, duplicate counts, past reminder
   counts, and freshness outcome. Do not record user, behavior, schedule,
   occurrence, provider, email, or note identifiers.
6. Browser-QA Timeline, Behaviors, Needs decision, and behavior review without
   changing preserved resolved occurrences. Recheck migration congruence and
   the Supabase security advisor afterward.

Marketing cookies and analytics are not launch scope, but any future addition
should include consent and documentation updates.

## Marketing site operations

The public marketing site lives in `apps/marketing` as a sibling Astro app. It
does not run inside the authenticated Next.js app shell.

Project-local commands:

```bash
npm run marketing:dev
npm run marketing:build
npm run marketing:check
npm run marketing:preview
```

`npm run marketing:build` runs `astro check`, builds the static site, and
generates the sanitized example BehaviorLog bundle under the marketing public
directory before Astro copies assets into `dist`.

`npm run marketing:check` runs `astro check` and verifies the built agent
readability outputs in `apps/marketing/dist`: Markdown mirrors, `llms.txt`,
`llms-full.txt`, route manifest, sitemap, robots, metadata markers, and the
example bundle path.

The current marketing crawl policy is recorded in `docs/CRAWL_POLICY.md`.
Update that document before changing robots or Content-Signal behavior.

Use those files instead of searching repeatedly for provider setup.

## Design workflow

For UI/design tasks, use the project-local impeccable workflow:

```bash
node .agents/skills/impeccable/scripts/context.mjs
```

Then read `.agents/skills/impeccable/reference/product.md` for app UI guidance. If a specific impeccable command is relevant, read its reference before implementing.

`DESIGN.md` is seeded. After real UI exists beyond the scaffold, run the impeccable `document` workflow or otherwise update `DESIGN.md` from actual code rather than from intentions.

The local design-system bench is also the cross-surface catalog surface:

- `design-system.surfaces.json` owns the canonical surface list, component
  families, shared contracts, and per-surface implementation mappings.
- `design-system.manifest.json` and `design-system.usage.json` remain the
  current strict live inventory for the authenticated Next.js web app.
- `/design-system` renders foundations, global surface/component-family
  mappings, and fixture-backed web-app trace cards.

When changing reusable UI, tokens, surface contracts, component-family
inventory, or bench mapping, update the relevant design-system files and run:

```bash
npm run design-system:check
```

## Interaction registry

`interaction-registry.json` is the canonical machine-readable inventory of
implemented user interaction intents across the marketing site, public
account-information surfaces, login, and authenticated app. Its contract and
maintenance rules live in `docs/INTERACTION_REGISTRY.md` and
`interaction-registry.schema.json`.

Update the registry whenever a user-facing interaction is added, removed,
renamed, moved to another route, gated differently, or given a materially
different side effect or test-coverage posture. New interactive UI source files
must also be added to the registry's `source_inventory`.

Run:

```bash
npm run interactions:check
```

The interaction validator is also invoked from `npm run agents:check`, so new
interactive source files cannot silently bypass the inventory.

## Public Trust evidence contract

Run `npm run public-trust:check` before publishing or consuming a Trust
snapshot. `schemas/public-trust-evidence.schema.json` owns the versioned public
shape. `lib/resolvers/public-trust-evidence.resolver.ts` owns validation,
sanitization gates, exact subject matching, and freshness normalization.

The release evidence workflow owns collection and publication. It must retain
all nine checks, including Failed, Not run, and Unavailable. Store snapshots at
immutable commit- or workflow-run-pinned public URLs. GitHub Pages paths must
contain the workflow run and both deployment IDs. Retain published snapshots
indefinitely. A replaceable `latest.json` pointer may select the newest valid
snapshot, but it never changes retained snapshots.

Collectors must name the exact source commit, application deployment,
marketing deployment, and workflow run. They must never copy a prior result
under a new subject. The contract fixes each deadline from completion time:
24 hours for provenance, public artifact, live-route, and migration checks;
seven days for dependency, code-scanning, secret-scanning, and RLS checks.
Consumers inject the current subject and time. They derive Stale for an expired
or mismatched Passed result and never hide missing or adverse results.

Only publish counts, digests, public dependency names, public route paths, and
sanitized public identifiers. Never publish scanner details, private repository
metadata, credentials, headers, user identifiers, behavioral data, notes,
provider payloads, or private hostnames. Ticket 101 defines and tests this
contract only. It does not run a production check or publish evidence.

## Public repository release audit

Ticket 098 is an evidence-only gate. It never changes repository visibility,
rewrites history, rotates credentials, or deploys application or database
changes.

Run the local source and database checks with:

```bash
npm run public-source:check
npm run public-database:audit:local
npm run smoke:rls:local
```

Run `public-source:check` in addition to a genuine history-aware secret scanner
across every Git ref. Keep raw scanner reports in a private temporary directory.
Never print or commit matches, fingerprints, provider identifiers, or private
repository metadata.

For the browser-boundary proof, build both applications with unique synthetic
values for every documented public setting and server-only credential setting.
Pass only the synthetic value lists to `public-artifacts:check` through
`CADENCE_TICKET_098_PUBLIC_CANARIES` and
`CADENCE_TICKET_098_SERVER_CANARIES`. The public list maps each value to its
single allowed artifact root. The check fails if a server value appears, a
public value crosses surfaces, or a declared public value is absent from its
allowed build.

Record only sanitized aggregate evidence in
`docs/PUBLIC_REPOSITORY_RELEASE.md`. A pass applies only to the exact reviewed
commit, deployed application version, hosted migration boundary, and GitHub
metadata snapshot. Any unresolved high or critical production dependency,
undeployed security fix, real credential, cross-account path, or incomplete
surface review keeps the gate at fail.

## Source license and private security reporting

Cadence source code, repository documentation, and synthetic samples use the
root MIT `LICENSE`, with Identity Scaffolding LLC as the 2026 copyright holder.
`README.md` owns the exact split-scope statement. Tracked binary non-code assets
remain outside that grant pending provenance review. Cadence names and logos
remain reserved as trademarks; the MIT license is not trademark permission.

`THIRD_PARTY_NOTICES.md` preserves the pinned BehaviorLog validator's upstream
MIT notice. Do not remove or replace that notice when updating the snapshot.
Recheck the upstream license at the new pinned commit during any snapshot
update.

`SECURITY.md` owns the public disclosure contract. The primary private route is
`security@identityscaffolding.com`. GitHub private vulnerability reporting is
also enabled. Never direct reporters to a public issue for credentials, user
data, behavioral content, or an unpatched vulnerability.

The repository owner monitors the inbox. The owner authorized exactly one
harmless synthetic test email to the approved address. The sender accepted and
retained that one message with sent status on 2026-08-25. Recipient-side
inspection confirmed receipt at the approved mailbox. The message landed in the
junk folder. Monitor junk and quarantine folders or maintain appropriate
allowlisting so filtered private reports receive review. The Ticket 099
authorization is exhausted; do not repeat that send under its authority.
Ticket 104 may perform at most one new harmless route test only after the owner
separately authorizes its recipient and send. No other follow-up send is
authorized. Record only delivery and acknowledgement outcome; never commit
screenshots, message content, message headers, sender details, recipient
internals, or provider identifiers.

Self-hosters own secret storage, provider accounts, access controls, upgrades,
backups, monitoring, and incident response. Browser configuration may include
documented `NEXT_PUBLIC_` values and the VAPID public key. Service-role keys,
OAuth secrets, provider keys, VAPID private keys, process secrets, database
credentials, and provider tokens remain server-only.

## Public repository publication

Ticket 100 uses the canonical repository at
`https://github.com/emixd12/habit-tracking-app`. Every GitHub and production
mutation needs explicit owner approval for that exact action.

Use this order:

1. Complete the sanitized repository access and integration inventory.
2. Push the prepared files to a non-default branch and open a pull request.
3. Require the `CI / verify` check only after that pull request passes from a
   fresh clone without production credentials.
4. Protect `main` from deletion and force pushes and require pull requests plus
   the passing check. If GitHub Free rejects protection while private, record
   the rejection, use the approved visibility change, and apply protection
   immediately before merging.
5. Read back protection, merge the reviewed release files, and verify both
   Vercel projects remain healthy.
6. If the repository is still private, obtain a separate visibility approval
   and make the existing repository public.
7. Enable secret scanning and push protection, Dependabot alerts and security
   updates, private vulnerability reporting, and CodeQL default setup.
8. Review every initial alert before announcing completion.
9. Verify an unauthenticated clone, `LICENSE`, `SECURITY.md`, and the marketing
   GitHub link. Then run the Ticket 100 production checks.

Ticket 100 completed the external publication sequence on 2026-08-25. Public `main` released
`cb82e0014fc12d6dbf18fb4719e102a2b5908662`. Strict `verify` protection,
administrator enforcement, required pull requests, and force-push and deletion
blocks are active. The dependency graph, Dependabot security controls, secret
scanning and push protection, private vulnerability reporting, and CodeQL
default setup are active. Initial open secret, dependency, and CodeQL alert
counts are zero after one documented false-positive disposition.

Ticket 100 is `complete`. The production account-deletion failure recovery
criterion passed through the deployed browser Server Action on 2026-08-26.

The production application and marketing deployments at that release commit
are recorded in `docs/PUBLIC_REPOSITORY_RELEASE.md`. The hosted 92-check RLS
smoke cleaned its three temporary users. One isolated browser-push delivery
passed and its complete synthetic record graph was removed. No email, domain,
environment, secret, plan, billing, or real-user-data mutation occurred.

Fresh production Google OAuth completed with the existing account. The account,
session, and visible behavior inventory remained intact during the invalid
confirmation check. No destructive owner-account deletion was attempted.

### Account-deletion failure canary

`CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID` is an optional server-only
production verification control. Keep it unset during normal operation. When
set, it must contain one exact Auth user UUID. A malformed value fails closed.
A nonmatching user follows the normal deletion path.

For the matching authenticated user, the service still requires export
acknowledgement and exact typed confirmation. It creates the service-role client
and verifies the Auth user normally. Immediately before Auth deletion, it
returns the existing recoverable deletion error without calling Auth deletion,
signing out, clearing cookies, or invalidating account data. Do not expose or
log the configured UUID. Do not use this variable as general fault injection.

Complete the remaining Ticket 100 check only with explicit authorization for
the production environment changes, deployments, disposable-account creation,
and cleanup:

1. Create one disposable Google-authenticated Cadence account.
2. Record its Auth user UUID and minimum cleanup identifiers only in private operator notes.
3. Add one synthetic canary Behavior or record owned by the disposable account.
4. Set `CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID` to that Auth user UUID.
5. Deploy the exact reviewed commit to production.
6. Sign in as the disposable account.
7. Complete the real export acknowledgement.
8. Enter the exact deletion confirmation.
9. Invoke the deployed account-deletion Server Action through the browser.
10. Confirm Settings returns the recoverable deletion error.
11. Confirm the account remains authenticated.
12. Confirm the profile and synthetic canary data still exist.
13. Remove `CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID` from production.
14. Redeploy the same reviewed application with the canary unset.
15. Delete the disposable account through the approved administrative or normal path.
16. Verify that the disposable profile and every temporary record are gone.
17. Record sanitized evidence without identifiers, tokens, payloads, secrets, or user data.
18. Mark Ticket 100 `complete` only after every step passes.

The authorized run completed every step against reviewed Git tree
`916eafe3ef34190b47bd4338a1ddcae52dcc4999`, which matches production commit
`c86a6d4a366a6e322a23b6977f9c2d812efdef25`. Canary deployment
`dpl_HFhFd4T5Z4YjbVFbzkmGTrXybvEB` returned the recoverable error while the
session, profile, one synthetic Behavior, and 31 occurrences remained. The
variable was removed and read back as absent. Clean deployment
`dpl_7TUcDZSMsonnLnhte8cvwCes5gHD` restored normal deletion from the same tree.
Normal Settings deletion removed the disposable Auth user, and Auth plus all
18 user-owned tables reported zero remaining rows. The evidence record retains
no disposable identifier, email, token, payload, secret, or user data.

The repository owner is the incident rollback owner. A visibility rollback is
appropriate only for an active incident. It cannot retract existing public
clones or forks. Contain the incident, rotate exposed credentials, preserve
evidence privately, and redeploy a verified fix before restoring normal
publication.

## Secrets and local files

- Never commit `.env`, `.env.local`, `.env.*.local`, CLI auth config, service-role keys, API keys, approval codes, or generated secrets.
- `.env.example` is names only plus safe default URLs.
- If a tool prints credentials, redact them in final summaries.

## Status updates

Update `STATUS.md` when a ticket starts, completes, becomes blocked, is reopened, or materially changes scope. Record verification commands with real pass/fail results.

Do not use `STATUS.md` to expand v1 product scope. Put future ideas in `docs/FUTURE_UPDATES.md` unless the user explicitly changes v1 scope.

## Ticket 102 Public Trust publication

For a release that changes the Trust consumer, deploy marketing first. Set the
application project's `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` to that Ready
deployment, then deploy the application. Dispatch Production evidence against
the resulting merge commit and both Ready deployment IDs. Until that snapshot
is public, the consumer must show older Passed results as Stale.

Run `.github/workflows/public-trust-evidence.yml` manually against Preview
first. Name the exact source commit, Ready application deployment, and Ready
marketing deployment. Select `run_rls` only when the owner authorizes
disposable hosted users. After Preview passes, repeat with the protected
`public-trust-production` environment and matching Production deployments.
Production collection binds each configured public origin to the exact named
deployment through the deployment's Vercel alias inventory before fetching it.
The daily schedule resolves the latest Ready Production deployments. It reuses
an unexpired RLS result only while all three release subjects still match.

The protected environments own `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. Environment variables own both Vercel project
IDs, the team ID, Supabase project reference, the Pages origin, and scheduled Production origins. Rotate a
secret at its provider, replace the Actions environment secret, then dispatch
Preview before Production. Never print raw provider responses or credentials.

The workflow validates the schema and detail sanitization before staging a
Pages artifact. It restores every indexed immutable snapshot, adds one path
containing the workflow run ID and both Vercel deployment IDs, and changes
`latest.json` in the same Pages deployment. An adverse check publishes a
Failed snapshot and then fails the workflow. A schema, sanitization, history,
or provider-input failure deploys nothing. Snapshots and detail files remain
indefinitely addressable.

Preview is a dry run. It retains the validated collection as a private Actions
artifact and never changes GitHub Pages or the public `latest.json`. Only an
explicit Production run or the Production schedule enters the Pages job.
Set `initialize_empty_history` only for the first Production publication after
confirming GitHub Pages has no successful deployment. Every later run leaves it
false, so a missing history index stops publication instead of deleting history.
Protected Preview deployments receive one-hour share bypasses during input
preparation. The collector exchanges each bypass for a short-lived cookie and
does not include either value in validated or uploaded evidence.

For failure triage, inspect the sanitized snapshot and failing workflow step.
Fix the release or provider outage, then dispatch a new run. Do not edit old
evidence. A provider outage becomes Unavailable only when collection can still
produce valid sanitized evidence. Otherwise the prior Pages deployment stays
active. Roll Pages back by redeploying the last valid Pages artifact. Never
delete an immutable snapshot. After rollback, verify `trust/latest.json` in an
unauthenticated browser before resuming the schedule.

## Ticket 106 marketing-content publication gates

Ticket 106 changes public content only after three hard gates pass:

1. Inspect active provider capabilities and record sanitized evidence that the
   proposed retention schedule is supportable. Do not infer capability from a
   policy target or publish private provider payloads.
2. Create `privacy@identityscaffolding.com` and confirm it with one harmless
   route test. A documented address alone does not prove the mailbox exists.
3. Obtain one legal review of the final Privacy and Terms text, entity facts,
   retention language, disclaimers, liability language, and dispute process.

The proposed schedule is 30 days for routine logs; up to 90 days or the end of
an investigation for security-incident logs; no more than 30 days for backups;
immediately or within seven days for deleted-account live data, with backup
remnants aging out within 30 days; and 12 months after resolution for support
messages. Longer retention is limited to security investigations, fraud
prevention, or legal preservation.

### Sanitized retention audit, 2026-08-31

The read-only audit found the following active capabilities. It retained no
credentials, user data, message content, private provider payloads, or resource
identifiers:

| Surface                     | Sanitized finding                                                                                                                                                      | Target result                                                                                                            | Official reference                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Vercel                      | An authenticated read-only check confirmed the team uses Pro. The Observability Plus configuration endpoint was unavailable. Two team Log Drains existed, but neither covered a Cadence project. Default Pro runtime-log retention is one day. | Does not support 30-day routine logs or 90-day incident logs.                                                            | <https://vercel.com/docs/observability/runtime-logs>, <https://vercel.com/docs/drains> |
| Supabase                    | Connected read-only project and organization checks confirmed the Cadence project is `ACTIVE_HEALTHY` in a Pro organization. Pro API and database logs retain seven days. | Does not support 30-day routine logs or 90-day incident logs.                                                            | <https://supabase.com/docs/guides/monitoring-and-debugging/logs>, <https://supabase.com/pricing> |
| Supabase backups            | The active organization remains Pro. Pro daily backups retain seven days; the prior account audit found daily backups rather than PITR.                                | Supports the maximum 30-day backup and backup-remnant targets.                                                           | <https://supabase.com/docs/guides/platform/backups>                                    |
| Account deletion            | The implemented path deletes the Supabase Auth user and user-owned rows use `ON DELETE CASCADE`. No destructive production deletion test was performed for this audit. | The implementation supports immediate live-data removal when deletion succeeds; the audit did not independently test it. | <https://supabase.com/docs/reference/javascript/auth-admin-deleteuser>                 |
| Google sign-in              | Cadence uses Google through Supabase Auth. No separate Google retention setting was evidenced in this audit.                                                           | Not independently verified.                                                                                              | <https://supabase.com/docs/guides/auth/social-login/auth-google>                       |
| Sequenzy                    | An authenticated account check exposed no retention setting. Sequenzy says subscriber data remains while an account is active and is deleted within 30 days after account termination, but it gives no transactional-message or delivery-history window. | Partially verified; transactional retention remains unknown.                                                            | <https://www.sequenzy.com/privacy>                                                      |
| Browser push                | Cadence sends each payload with a 24-hour TTL. RFC 8030 permits a push service to retain it for that period or less and forbids delivery after expiry. Browser-vendor operational-log retention remains undisclosed. | The queued payload has a verified one-day maximum; intermediary operational logs remain unverified.                    | <https://www.rfc-editor.org/rfc/rfc8030.html#section-5.2>                              |
| Privacy and support mailbox | DNS routes the domain through Microsoft 365. `privacy@identityscaffolding.com` was not route-confirmed, and no tenant retention policy was available to the audit.       | Mailbox and 12-month retention gates fail.                                                                               | <https://learn.microsoft.com/en-us/purview/retention-policies-exchange>                |

The proposed routine-log and incident-log claims are unsupported. Do not add a
Cadence Log Drain, change a provider plan, or change retention settings without
a separate authorized task and cost review. Backups and deleted-account backup
remnants fit within the proposed 30-day maximum. Browser-push payload storage is
bounded to one day. Sequenzy transactional retention, browser-vendor
operational-log retention, and support-message retention remain unknown.

Provider-retention verification therefore fails. The privacy mailbox is not
confirmed, and legal review has not occurred. Keep the Privacy and Terms drafts
unpublished and public registration closed. Existing authenticated accounts
remain available.

### Ticket 106 completion attestation, 2026-08-31

The preceding audit remains the historical read-only checkpoint. The owner
later confirmed that active retention settings were verified against the final
policy, `privacy@identityscaffolding.com` passed its harmless route test, legal
review approved the final Privacy and Terms text and facts, and all publication
approvals are complete. This attestation contains no credentials, user data,
message content, private provider payloads, or resource identifiers.

The final policy follows the verified active windows. Routine logs retain for
no more than seven days: Vercel runtime logs retain one day and Supabase API and
database logs retain seven days. Supabase daily backups and deleted-account
backup remnants retain no more than seven days. Browser-push payloads expire
after no more than 24 hours. Support messages retain for 12 months after
resolution. Security-incident records may be preserved for up to 90 days or
the end of the investigation when an investigation requires preservation.

All three publication gates pass. Privacy and Terms may publish, and public
registration is approved. The completion changes no authentication provider
setting.

## Desktop implementation and release gates

Tickets 107–114 implement the macOS track in `docs/DESKTOP_BUILD.md`. Ticket 115
owns Apple-trusted distribution acceptance and is in progress. Tickets 116–122 plan optional
desktop account synchronization. Preserve unrelated working-tree edits and both
current deployments. Next.js stays at the repository root.

Use Node.js 24.x and the pinned desktop dependencies. Native builds also need
Rust, macOS/Xcode tooling, and the configured Apple Silicon target. Record
missing tools or credentials explicitly; do not report frontend builds or
browser mocks as macOS execution.

Desktop commands introduced by Ticket 108:

```bash
npm run desktop:dev
npm run desktop:dev:web
npm run desktop:build
npm run desktop:typecheck
npm run desktop:native:test
npm run desktop:native:build
```

`desktop:build` verifies frontend output. `desktop:native:build` produces
an ad hoc signed development app with a bound bundle identity; it does not
satisfy Developer ID signing, notarization, or final-release gates. The local
signing config must not be used for final release builds. Ticket 113's separate
ad hoc preview procedure is recorded in `docs/DESKTOP_RELEASE.md`.
`desktop:dev:web` exposes the
developer bench without claiming native APIs work in a browser. For Codex local QA, select the first free port
in 4321–4330 and bind loopback. Never let the server choose outside that pool.
Open a Codex browser session scoped to the selected origin.

Run the standard repository checks, `npm run interactions:check`,
`npm run design-system:check`, `npm run marketing:check`, and
`npm run marketing:build` throughout the track. The strict
`npm run desktop:parity:check` must fail until applicable interactions have
implementation and required evidence. It now passes all 64 applicable desktop
interactions; structural success alone does not satisfy Ticket 115.
Preview candidate-building checks must be separate from updater acceptance that
requires those candidates. Do not falsify registry evidence or relax production
release checks to build a preview.

`preview-build` also requires `VITE_SUPABASE_URL` plus either
`VITE_SUPABASE_PUBLISHABLE_KEY` or the legacy `VITE_SUPABASE_ANON_KEY`.
The URL must use HTTPS, and the key must be public. The release preflight rejects
missing configuration, service-role keys, and secret-key formats before Tauri runs.
Release tooling runs the desktop frontend build with the reviewed environment,
disables Tauri's nested frontend build, and verifies both public values exist in
the fresh frontend output before Tauri runs. Native staged-app configured-state
acceptance remains the packaging and runtime gate.
Production `check` and `build` also require public `VITE_CALENDAR_BROKER_ORIGIN`.
Calendar, Daily Brief, and Travel share this origin; use `https://app.cadence-me.com`.
Production preflight rejects credentials, paths, queries, fragments, and origins
without an exact reviewed native CSP `connect-src` entry. Fresh frontend output
must contain the configured origin before Tauri runs. Build reports record public
variable names and presence without values; this does not prove installed acceptance.
Preview and local builds may omit the broker origin. Both CSP policies retain
the legacy broker and allow the current production origin without arbitrary widening.
Ad hoc preview builds also select the legacy macOS login-Keychain path and fail
verification when its compiled marker is absent. Production candidates do not
inherit this preview-only flag and retain the Data Protection Keychain path.

Tickets 118–122 may require Supabase auth configuration, migrations, and hosted
RLS verification. Follow `docs/SUPABASE_WORKFLOW.md`. Do not change hosted auth,
schema, or deployments without explicit owner authorization. Ticket 122 must
upgrade an older installed desktop version through the real updater after a
protected database backup; unit migration tests do not replace that gate.

Run real adapter contracts separately from the default test suite:

```bash
npm run desktop:contract:test
SUPABASE_TELEMETRY_DISABLED=1 CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts
```

The Supabase contract accepts only the isolated local API on port 55321. It
captures local CLI credentials internally, uses ordinary sessions for domain
operations, and limits admin access to synthetic account setup and cleanup.
It compares shared Behavior and portability plans with the production SQL
adapter. Never point it at hosted data. Do not accept request timeouts as proof
of rollback: deterministic stale writes must return application conflicts.

Before broad extraction, verify persistent SQLite writes, atomic rollback,
native scheduling/cancellation, notification activation, and restart behavior.
Before a production release, verify the shared local-Supabase/real-SQLite
contract suite, full tracking parity, offline launch, actual WKWebView rendering,
upgrade preservation, and accurate verified native reminder coverage. For the
first schema-changing desktop update, also test an older installed version
upgrading through the real updater with a protected database backup.

Native reminders target the next 30 days and prioritize nearest eligible
reminders. The owner accepted a clearly displayed OS-limited horizon on
2026-08-30. Read pending requests back from the OS and verify contiguous
coverage before the first missing intended request. Display the actual
scheduled-through date/time and clearly disclose shorter or unverified
coverage. Successful callbacks and the furthest retained request are not proof.
Do not assume the observed 100-request retention is a universal cap.

Reconcile on launch, resume, local day change, and relevant mutations. Exercise
permission denial, cancellation, sleep/resume, fully quit delivery, activation,
and OS limits. Shorter verified coverage may pass; inaccurate coverage fails.
Do not silently truncate the schedule or install a background helper. Native
activation proof before broad extraction and every other release gate remain
required; the horizon decision does not complete Ticket 108.

Keep signing/updater credentials out of source, logs, and browser code. Ticket
113's ad hoc Apple Silicon preview and updater acceptance are complete. Ticket
115 owns Apple Developer Program access, Developer ID signing, notarization,
stapled app/DMG verification, quarantined notarized-DMG Gatekeeper acceptance,
and installed acceptance on the current Apple Silicon host. The owner deferred
macOS 14 runtime acceptance without changing the declared and compiled minimum.
Record the candidate's exact tested macOS version and build. See
`docs/DESKTOP_RELEASE.md`.

The owner authorized Cadence distribution of the six exact asset hashes in
`docs/qa/2026-08-30-desktop-asset-provenance.md`. Keep MIT exclusions, reserved
marks, and third-party notices unchanged. The approved preview feed is public.
Any production publication, uploads, hosted migrations, deployments, and
provider changes remain separate explicit actions. Ticket 106
legal/public-registration gates passed under the completion attestation above.

## Ticket 104 security inbox follow-up

Read-only inspection on 2026-09-04 confirmed the prior synthetic message
reached a filtered folder. The root cause is not verified because provider
diagnostics require operator access. No filtering rule has changed. Keep
provider diagnostics and configuration details in private operator notes.

The repository owner owns review of Inbox, Junk/Spam, and quarantine
each business day, plus immediate review after any authorized route test.
Keep malware and spam filtering enabled. Provider access and one separately
authorized harmless test remain required for Ticket 104 acceptance. The prior
Ticket 099 message does not substitute for a new test.

## Ticket 105 browser-push compatibility exception

The npm registry still publishes web-push 3.6.7 as latest (2026-09-04). The
installed direct dependency calls legacy `url.parse()` in
`src/web-push-lib.js` during VAPID audience construction and HTTPS request
construction. Node 24 reports DEP0169 on that path. Upstream issue
https://github.com/web-push-libs/web-push/issues/943 is closed by the merged
https://github.com/web-push-libs/web-push/pull/948, but the fix has no newer
published npm release. Keep the installed version and lockfile unchanged.
Do not patch node_modules, suppress warnings, or replace the push provider.

The repository owner owns rechecking when npm publishes a newer stable version
or a supported Node upgrade changes this warning into a failure. Run
`npx vitest run tests/web-push-compatibility.test.ts tests/web-push-subject.test.ts tests/reminder.service.test.ts`,
then the full release checks and an authorized Preview deployment. The real
package test uses generated synthetic keys and a fake HTTPS transport. It
checks encryption, VAPID, endpoint/query preservation, TTL, and successful
response handling without network traffic.

## Note shortcut rollout (Tickets 126–128)

Deterministic matching uses the owned database only and needs no external model.
Keep all provider calls disabled until Ticket 126's synthetic evaluation and
provider/privacy go decision are documented. Cloud consent cannot synchronize.
Do not log Notes, shortcut text, evidence hashes, provider payloads, or account IDs.
Record aggregate synthetic checks and sanitized failures only.

Apply tracked Postgres and SQLite migrations with the normal local replay,
ownership, rollback, backup, and old-client compatibility checks. Hosted migration,
deployment, distribution, new provider access, and spending beyond authorization
remain explicit gates. Marketing/privacy copy must state the actual provider,
training use, retention/deletion limits, data sent, device-specific consent,
revocation, and fallback before cloud analysis becomes available.

## Google Calendar connector operation (Tickets 134–137)

Local implementation does not authorize provider setup, live-account access, hosted
migration, deployment, or desktop distribution. Keep the connector unavailable
until those gates pass. Use a separate Google Cloud project from Supabase sign-in.
Request only OpenID and the Calendar-list/events read-only scopes documented in
`docs/qa/google-calendar-capabilities.md`. Exact scope validation rejects broader
grants. Complete the provider's sensitive-scope verification before public use.

Server environment names: `GOOGLE_CALENDAR_CLIENT_ID`,
`GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_CALLBACK_URL`,
`GOOGLE_CALENDAR_ENCRYPTION_KEY` (canonical base64, 32 bytes),
`GOOGLE_CALENDAR_KEY_ID`, and optional `GOOGLE_CALENDAR_DECRYPTION_KEYS`
(JSON map of prior key IDs to canonical base64 keys). The callback must use the
configured HTTPS `/auth/google-calendar/callback` path. Desktop uses only public
`VITE_CALENDAR_BROKER_ORIGIN`; it never packages these server secrets.

For key rotation, retain old decrypt keys while credentials use those key IDs.
New consent seals with the current key. Remove an old key only after every
connection using it reconnects or disconnects. Missing keys fail closed and
require reconnect. Never print configuration values or provider payloads.

Global disconnect fences new reads and deletes stored credentials before attempting
Google revocation. A revocation outage leaves a factual warning to remove the grant
in Google Account settings. Other devices clear content on their next connector
check. Account deletion captures revocation work without changing the Calendar connection,
then attempts revocation only after Auth deletion succeeds. Failed Auth deletion
preserves the connection; provider outages do not block completed deletion.
The private credential row cascades with the Auth user. Ordinary web sign-out
retains the global connection; desktop sign-out clears the local event cache.

Hosted ciphertext can exist in infrastructure backups under the existing retention
policy. Cadence exports, account synchronization, and user-created desktop backups
exclude credentials and cached events. Test the local SQL contract before any hosted
rollout. The combined release ledger remains `docs/qa/day-progress-release.md`.

## Public Calendar verification execution (Tickets 138–141)

The 2026-09-17 continuation used the owner-selected Cloudflare dashboard.
The empty Cadence zone now has two DNS-only Vercel A records and Google's TXT
challenge. Both domains return HTTPS 200; Search Console confirmed ownership
for Identity Scaffolding. Nameservers, unrelated zones, and old aliases remain.
Exact records, callback inventory, isolated release provenance, and rollback
are in `VERCEL_WORKFLOW.md#authorized-dashboard-continuation-2026-09-17`.
The CLI wrapper remains unlinked because no Cloudflare token was created.

Supabase retains every old redirect and adds the exact new `/auth/callback`.
Its Site URL is now `https://app.cadence-me.com`. The separate Calendar client
retains the legacy callback and adds the exact new callback. Its authorized
domains retain legacy entries and add verified `cadence-me.com`. The owner
confirmed production-audience expansion on September 17; Google reports In
production. Google verified and published the consent name `Cadence` after an
app-name/homepage mismatch correction. The September 20 check confirms Calendar
data access and the sensitive events-readonly scope are verified. Post-approval
web/native consent smoke checks remain outstanding; rollout gates remain. The owner retained `info@identityscaffolding.com` as support/developer
inbox and named Emiliano Bache Rodriguez as its human monitor. The replacement verified-brand video is Unlisted at
https://youtu.be/vUi5s2B51Uo. Google accepted the data-access submission on
September 18, 2026 at 10:52 EDT; approval was observed September 20. Daily 09:00 local
Verification Center follow-up is active in the existing task; it reports meaningful
changes only. Emiliano remains responsible for the inbox. The isolated releases are promoted; production IDs,
post-promotion public checks, and rollback are recorded in release QA.

Calendar domain migration adds optional server setting
`GOOGLE_CALENDAR_LEGACY_CALLBACK_URL`. Keep primary and legacy exact callbacks
registered on the same Calendar OAuth client during the transition. The routes
select the configured callback matching their request origin, preserving web
cookies and installed broker compatibility. Encryption settings and scopes do
not change. Unknown request origins fail before provider access. Deploy and
smoke-test both origins before treating this local regression evidence as live
acceptance. Keep the sign-in project separate.

Ticket 139 adds a September 17 Privacy revision after the approved August 31
baseline. The earlier approval still applies to its original text. The recorded
September 17 review scope covers the Optional Google Calendar section,
provider-table corrections,
Calendar retention rows, and Limited Use disclosure/link. The owner approved
that text and recorded scope for publication on September 17. This owner decision
supersedes the separate new-review publication blocker; it is not an independent
legal review. The August 31 approval remains unchanged. Domain, deployment,
technical acceptance, and Google review gates still apply.
Homepage and FAQ now publicly describe pending Calendar review after the
production-audience change. Repository user-guide copy matches that state;
production status is not approval.
Canonical Privacy, Terms, and Trust remain on app routes. Ticket 139 is
complete after public publication and saved Google link verification. No Terms
revision or marketing legal-page duplicate was needed.

The timed recording script, scope justifications, playback checklist, and
submission fields live in `qa/google-calendar-capabilities.md`. Record actual
English web/native flows only after final domains, disclosures, and callback
smoke checks pass. The owner approved a dedicated Gmail identity for demonstration
and ongoing Cadence tests. Use only a known name and harmless test calendars/events.
Do not invent personal details or reuse a password. A human must choose the
password, complete verification, and accept account terms. Identify the destination
YouTube channel before any unlisted upload. A script does not complete Ticket 140,
and Testing or submission does not complete Ticket 141. Keep Google’s approval
separate from Ticket 137 technical acceptance and Ticket 115 Apple trust.

## In-app daily briefing planning (Tickets 145–148)

The September 20 owner correction places Cadence Daily Brief in the existing
Timeline horse's text bubble. Read `docs/plans/first-external-consumer.md` and
`docs/DECISIONS.md` before continuing. The old filename is retained for links;
the external consumer, delegated OAuth, second login and prewritten-summary
approval assumptions are superseded.

Ticket 146 reopens completion-history inputs and first-party fencing. Ticket 147
uses existing sign-in for bounded server generation with OpenAI `gpt-5.6-luna`.
Keep a small provider-neutral facts/result boundary and one server adapter.
Ticket 148 implements automatic daily opening, dismiss/ignore/retry behavior and
web/linked-desktop acceptance. Recommendations cannot execute changes.

Model-data disclosure is separate from ordinary Calendar display permission.
Verify actual model access, server secret custody, retention/deletion, Google
onward-use requirements and exact live-test authority before real-data testing.
Do not put keys or app sessions in prompts or client bundles. Do not ask users
to approve a generated briefing as a prerequisite to reading it.

### Existing September 19 implementation

The old endpoint still denies every credential. Do not enable delegated access;
Ticket 147 explicitly retires or repurposes that adapter. The read service,
private admission metadata, SQL checks and synthetic consumer are dated evidence
in `qa/advisor-read-only.md`. `qa/advisor-auth-isolation.md` documents a historical
external-token risk, not a current first-party implementation blocker.
### Implemented generation and operational lifecycle

`POST /api/advisor/brief` uses existing web/desktop authentication and strict live
session RPCs. `GET/PUT /api/advisor/preferences` manage explicit model-data controls.
Enablement defaults off. The server reads `OPENAI_API_KEY`; clients receive no key.
The old GET remains a permanently disabled compatibility boundary. The former
external consumer module now implements provider-neutral internal generation.

OpenAI `gpt-5.6-luna` uses Responses with `store:false`, no background execution,
no tools, strict JSON output and a 2,000-token output budget. Response parsing caps
bytes at 64 KiB and briefing text at 2,000 characters. Read/model phases each cap
at 30 seconds; the entire generation attempt caps at 60 seconds. Source and
session/disclosure fences run before submission and delivery. Context expires
within five minutes or at local midnight; the UI removes expired text.

Cadence retains no prompt or briefing history. Private operational rows retain
current preferences, at most eight latest installation attempts and six start
timestamps. Disablement clears attempts; account deletion cascades all metadata.
Browser storage holds only an installation ID and presentation metadata. Memory
may reuse a pending result, but never persist generated text. Provider retention
still applies: `store:false` does not promise zero abuse-monitoring or prompt-cache
retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The owner approved reuse of the existing key. A synthetic-only Luna request passed
with the production adapter. No real account/Calendar data was sent. Hosted migration
push, production key configuration, real-data acceptance and installed desktop
acceptance remain separate recorded deployment checks. Do not publish an AI claim
until those checks pass. Disable through Settings or remove the server key to roll
back generation without affecting tracking or Calendar event records.

## Internal briefing workbench (Tickets 151–155)

Open `/design-system?preview=briefing-workbench` on the selected loopback development
port. Compare opens first; Days supports chronological review, and Saved reviews
holds local cases and exact prose feedback. Opening controls never invokes a model.
A new comparison captures one snapshot for A/B. Historical exploration performs
explicit no-model reads. Save one selected day before running it. Captured inputs
preserve their original clock; current reads of past dates are Retrospective.
Unsupported reconstruction remains unavailable. Per-source coverage explains gaps,
late changes, unknown duration and missing historical Note/reminder state.

The workbench reserves provider calls before generation. The process-wide hourly
ceiling defaults to 100 (`CADENCE_BRIEFING_BENCH_CALL_LIMIT`, 1–100), replacing the
old six-comparison limit. At most two provider calls execute concurrently across
tabs. Every dispatch counts, including rejection, failure and dispatched cancellation.
Undispatched cancellation releases its reservation. Calls, tokens and price remain
different measures; unavailable provider usage is reported as unavailable.
Production admission remains separate. Restarting the process resets this local budget.

Days requires a no-model chronological plan before generation. Warm-up is explicit
(empty in the UI); simulation assumes selected tips were delivered. Actual sequence
history retains only successful tips and never writes production tip history.
Diagnostic previews bypass cross-lane ranking/cooldown, preserve evidence and consent
checks, and remain separate from complete daily-brief quality review. Retry creates
a new attempt. Cancel stops queued work, preserves completed output, and claims no
provider refund. Saved runs persist; unsaved sequence output remains inspectable in
process memory for one hour. Private browser state clears on account/consent changes.

My account uses existing sign-in and Daily Brief disclosure. Optional Calendar reads
also require current disclosure, connection and selection. Past Calendar is a separate
explicit request and remains Retrospective; it never activates the historical
Calendar-pattern lane. Current owner, source access and retained Behavior access
are checked before transmissions. Live time controls auth/expiry/cancellation;
replay time controls evaluation only. Local-only and unsynced desktop data are absent.
The owner runs private comparisons personally; agents do not run them.

Cases, candidates, runs, feedback and reports live under `.local/briefing-bench/`
with owner-only permissions and 30-day retention enforced on access. Inputs above
the capture cap become Review only or fail an explicit historical save. Old cases
remain readable. Individual cases support deletion. Review packets and sequence
reports stay local; never commit private case text or identifiers.

The preset data lives in `packages/core/src/data/briefing-presets.json`.
`activeBriefingConfig()` in `lib/services/briefing-pipeline.ts` selects the default.
Drafts, simulations, feedback and lane previews never promote a preset. Ticket 184
requires owner-set criteria and explicit comparison acceptance before promotion.
Ticket 185 is a separate stored-production-brief proposal, not this local case store.

Catalog summaries are original paraphrases with source dates and limitations in
`packages/core/src/data/briefing-references.json`. Review the original source before
changing a summary; bump its revision and catalog version. Mark a withdrawn source
`withdrawn`; selection reports an omission and cannot validate a citation to it.
Reference text is untrusted. A valid ID proves provenance, not evidential support.

Open **Glossary: statuses and settings** for searchable contract definitions.
`docs/ontology/briefing-workbench.json` gives each term a stable ID, its owning code
symbols and related terms. Definitions explain runtime contracts; they do not replace
the types, validators or resolvers. Preserve term IDs when wording changes. Update
the ontology with contract changes; `tests/briefing-ontology.test.ts` checks coverage
and trace targets. A glossary fragment such as `#briefing-term-config.tone` opens
the definition directly.

Open **Preset and reference documents** to inspect and download the exact JSON used
by the pipeline. Copy a file path into any editor, or use the VS Code link when
installed. These are repository documents, separate from browser drafts. Editing
`cadence-default` changes the local daily configuration after reload; it still needs
ordinary review and deployment for hosted promotion. Reference edits must retain
unique IDs, valid dates, HTTPS sources, provenance and limitations. Bump the entry
revision and catalog version. Reference kinds and statuses are validated on import.
After editing, run `npm run test -- tests/briefing-config.test.ts tests/briefing-references.test.ts tests/briefing-ontology.test.ts`,
then reload the workbench. Viewing documents never captures account context or
generates a comparison. Original-source links open only when explicitly clicked.

Rollback: restore the reviewed `cadence-default` entry from this change, including
empty referenceIds and movableBehaviorRefs. For full feature rollback, use the
existing Daily Brief disablement. Never reset admission/dismissal metadata to force
regeneration. Hosted deployment, real-data and installed linked/offline desktop
acceptance remain separate under Tickets 147–148 and 155. See
`docs/qa/briefing-workbench.md` for source and synthetic evidence.


## Daily Brief recipe configuration (Tickets 156–158)

Daily Brief (`daily_brief`, recipe 1.0) is the only supported recipe. Configuration
1.2 binds context choices, presentation, references and planning to that recipe.
The exact legacy 1.0 shape migrates to Daily Brief with its existing history and
Calendar choices. Saved drafts retain their storage key and normalize on load.
Unknown recipes, recipe versions, configuration versions and extra fields fail
validation. Exported configurations use 1.2. Selecting a recipe grants no access.

The repository default excludes completion-history counts from the model. Explicit
controls independently select completion history, recorded elapsed totals, historical
average duration and configured default duration. Actual finish timestamps remain unavailable; historical marking times are independently selectable under configuration 1.2.
manual status-update timestamps are not actual finish times. Duration preference and
fallback are explicit. A selected average can use eligible server-side history even
when raw totals/counts are excluded. The 90-complete-day estimate window and three
positive, stopped Completed Occurrence minimum remain. Shorter history scope filters
selected raw elapsed totals and completion counts before serialization.

The private inspector returns only selected model facts, input decisions and planner
evidence. It never returns the internal planner context or excluded raw duration
candidates. Recipe, configuration, source and policy revisions fence pending results.
Policy 2.1 suppresses completion/adherence recaps and raw diagnostics in prose. It
permits practical uncertainty only for a specific recommendation and cannot infer
availability or a fit from absent sources. Existing access and explicit-run rules
remain; agents do not run My account comparisons. Ticket 161 owns model-quality and
rollout review. Authored synthetic examples live in `docs/qa/briefing-workbench.md`.


## Travel rollout and rollback (Tickets 162–165)

Travel remains unavailable unless `CADENCE_TRAVEL_PROVIDER_CLEARANCE=approved`
and a restricted `GOOGLE_MAPS_SERVER_API_KEY` are configured on the server.
Do not set these until the operator gates in `qa/travel-release.md` pass.
Apply both tracked travel migrations and deploy matching web/desktop sync contracts
as one reviewed rollout. Older desktop clients must update before account sync.
No release version or hosted rollout has been verified for this work.

The repository bounds admission to 24 owner-local-day admissions and 100 UTC-day recomputations. Rejected attempts do not count.
Each request covers at most eight route legs, two concurrent route calls, one transient
retry and 45 seconds of provider work. Geocoding and driving refinement also consume
provider billable calls; the request counter is not a monetary spending cap.
Configure provider quotas and a reviewed budget before enabling the gate.

Rollback first removes the clearance flag. Foreground clients clear transient evidence
when they refresh, lose focus, go offline or reach their five-minute expiry.
User-authored locations and tracking remain intact. Do not roll back the additive
schema while newer desktop clients can synchronize. Travel never resets Daily Brief
admission or dismissal; no travel facts enter the model in this release.

## Historical completion-time context

Configuration 1.2 replaces the unsupported timestamp placeholder with opt-in
`includeHistoricalCompletionTimes`. Exact 1.0/1.1 drafts normalize with this input
disabled. Presets also default to disabled. Pipeline 2.1 and prose policy 2.1 fence the new contract.
Apply the historical completion-time snapshot migration through the usual reviewed
local/hosted workflow before expecting real-account evidence. An older snapshot
reports source unavailable without blocking unrelated briefing inputs. No new
actual-finish capture exists. Private comparisons remain owner-run only.

## Deterministic day evidence (Ticket 159)

Planner 1.1, pipeline 2.2 and prose policy 2.2 separate observations from move
permission. Existing configured windows apply to day evidence even with no movable
Behaviors. The private comparison inspector retains full evidence and rejection
details. The model receives ranked supported findings and no rejection diagnostics.
An individual feasible opportunity is not a combined schedule or move permission.
Incomplete coverage, stale sources and unsupported durations never prove a fit.
All-day reservations block availability without inventing timed-overlap warnings.
Travel remains excluded pending its existing release gates.

No new control, database migration, provider authority or automatic rerun is added.
Existing configuration revision fencing covers the new planner and policy versions.
Ticket 161 still owns model-quality review, owner-run private comparisons and rollout.
