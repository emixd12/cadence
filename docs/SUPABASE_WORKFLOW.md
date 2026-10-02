# Supabase CLI Workflow

Supabase work in this repository is CLI-first. Agents should not spend time rediscovering how to move local database work to the hosted project: use the commands and rules in this file.

Authoritative upstream docs checked during this setup:
- Local Development & CLI: install with `npm install supabase --save-dev`, initialize with `npx supabase init`, start with `npx supabase start`.
- Database Migrations: create migrations with `supabase migration new`, apply locally with `supabase migration up` or `supabase db reset`, deploy with `supabase db push`, and never change the hosted database directly once migrations exist.
- Generating TypeScript Types: generate local types with `supabase gen types typescript --local` or hosted types with `supabase gen types typescript --project-id "$PROJECT_REF" --schema public`.

## Installed pathway

The Supabase CLI is installed as a project dev dependency. Prefer the project-local binary so every agent uses the same version:

```bash
npm run supabase -- --version
npm run supabase -- <command>
```

Examples:

```bash
npm run supabase -- start
npm run supabase -- db reset
npm run supabase -- migration new create_initial_schema
```

`npx supabase <command>` is acceptable when quoting is simpler, but package scripts are the default in repo docs.

## Prerequisites

Local Supabase requires a container runtime compatible with Docker APIs, such as Docker Desktop, OrbStack, Rancher Desktop, or Podman.

Hosted Supabase commands require an authenticated CLI session and a linked project. Do not ask the user for API keys unless the task genuinely needs one. Prefer `supabase login`, which uses a Personal Access Token flow owned by the user.

## Local environment lifecycle

Use these commands during Ticket 002 and later Supabase work:

```bash
npm run supabase -- init      # only once, when the supabase/ directory does not exist
npm run supabase -- start     # starts local stack
npm run supabase -- status    # prints local API, DB, Studio, and auth URLs/keys
npm run supabase -- stop      # stops local stack
```

If the machine is on an untrusted public network, bind local Supabase to localhost through a Docker network before starting it, as recommended by Supabase docs:

```bash
docker network create -o 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' local-network
npm run supabase -- start --network-id local-network
```

Never expose the local Supabase stack publicly.

Local verification on 2026-08-30 found that CLI 2.105 recreates the database
container during `db reset`, losing an existing loopback binding and custom
network unless those settings accompany container creation. A Docker network
binding default alone did not enforce loopback on this version. Use the
reviewed project-scoped Docker create proxy and the explicit network for this
local stack; never change global Docker settings or other projects. Verify
published bindings after startup/reset and stop Cadence's database immediately
if it exposes `0.0.0.0` or `::`. A completed migration replay does not excuse a
failed or unsafe container restart.

CLI 2.105 also creates unnamed schema-initialization jobs. A name-only proxy
rejects those jobs after dropping the database. The verified local reset used
a separate temporary proxy with a narrow exception: both exact Cadence project
labels, the `cadence-local` network, no published ports or host mounts, and the
exact pinned Realtime, Storage, and Auth images and migration commands. It also
validated the Cadence database host in each job's environment without logging
credentials. Do not allow arbitrary unnamed containers. The successful reset
on 2026-08-30 applied all 45 migrations and kept every published Cadence port
on `127.0.0.1`. The operator preserved the original proxy and other projects.

The BehaviorLog 0.3 verification repeated this reset with all 47 migrations,
through `20260831014424`. Before resetting, aggregate reads proved zero Auth
users, public rows, Storage buckets/objects, and Vault secrets. The reset kept
all published ports on loopback. The subsequent RLS smoke passed 92 ownership
checks and cleaned its three temporary users. Generated database types matched
the checked-in types. The temporary initialization proxy stopped after the
reset; the original proxy and local stack remained running.
The real authenticated SQL contract also passed after the reset. Its four
temporary users exercised Behavior writes, cross-account isolation, import,
restore, and BehaviorLog 0.3 history roundtrips. Re-export preserved complete
configuration records and IDs after restore. Passive imported observations
accepted the canonical channel/status vocabulary without creating operational
reminders. Final aggregate cleanup again found no user or application data.

### Reproducible local contract proxy — September 27, 2026

`scripts/supabase-docker-proxy.mjs` replaces the missing temporary create proxy.
It supports this repository's installed `supabase-go` 2.105.0 backend. Its
service images and three initialization commands come from that version's
[Dockerfile](https://github.com/supabase/cli/blob/v2.105.0/apps/cli-go/pkg/config/templates/Dockerfile)
and [schema initialization](https://github.com/supabase/cli/blob/v2.105.0/apps/cli-go/internal/db/start/start.go).
Review those pins before using a different CLI version. Do not widen the
unnamed-job rule merely to bypass a rejected request.

The proxy requires both exact project labels, project `habit-tracking-app`,
and network `cadence-local`. It rewrites every explicit published binding to
`127.0.0.1`. It rejects implicit publishing, host mounts, host namespaces,
privileged configuration, unknown creates, and other-project mutations.
Only the three exact Auth, Storage, and Realtime initialization jobs may omit
a name. Their database host must be `supabase_db_habit-tracking-app` on port
5432. The proxy never prints request bodies, environments, or daemon errors.

The proxy reads ownership before container or volume lifecycle mutations.
It requires the existing loopback bridge network and never changes networks.
It supports normal HTTP response streaming, including Docker's raw log frames.
It rejects exec, attach/hijack, global prune, build, and settings operations.
CLI 2.105.0 starts and resets this stack through container lifecycle calls,
log reads, and PostgreSQL connections; these operations do not need Docker exec.
Stop the local stack through explicit project container lifecycle commands.
Do not run `supabase stop` through this proxy because its prune calls are rejected.

Run the focused fake-daemon tests before operator review:

```bash
npx vitest run tests/supabase-docker-proxy.test.ts
```

Use Node 24. The tests use fake Unix sockets and never contact Docker.
Actual stack start, reset, binding readback, and authenticated contract remain
separate acceptance gates. Do not count fake-daemon tests as those gates.

After reviewing the proxy, inspect the existing network and start the proxy:

```bash
docker network inspect cadence-local --format '{{json .Options}}'
CADENCE_DOCKER_PROXY_DIR="$(mktemp -d /private/tmp/cadence-docker-proxy.XXXXXX)"
mkdir -p "$CADENCE_DOCKER_PROXY_DIR/work/supabase"
cp supabase/config.toml supabase/seed.sql "$CADENCE_DOCKER_PROXY_DIR/work/supabase/"
cp -R supabase/migrations "$CADENCE_DOCKER_PROXY_DIR/work/supabase/"
CADENCE_DOCKER_DAEMON="$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')"
node scripts/supabase-docker-proxy.mjs \
  "$CADENCE_DOCKER_PROXY_DIR/docker.sock" "${CADENCE_DOCKER_DAEMON#unix://}" &
CADENCE_DOCKER_PROXY_PID=$!
```

The network inspection must show `com.docker.network.bridge.host_binding_ipv4`
equal to `127.0.0.1`. Wait for `Cadence Docker proxy ready.` before continuing.
The socket uses mode 0600 inside the new private directory. The proxy refuses
an existing socket; it never replaces another process's socket.

The temporary workdir intentionally omits `.temp`, linked-project metadata,
credentials, and cached hosted image versions. CLI 2.105.0's `start` checks
hosted service versions when the workdir contains a project link and CLI
credentials. Always pass the unlinked temporary workdir below. The copied
config preserves the same local project ID; no hosted query is needed.

Use the installed Go backend through the npm shim. This avoids the invalid
signature on the native launcher and also reaches the contract's internal
`npm run supabase -- status -o env` reader:

```bash
export SUPABASE_TELEMETRY_DISABLED=1
export SUPABASE_CLI_BINARY_OVERRIDE="$PWD/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go"
export DOCKER_HOST="unix://$CADENCE_DOCKER_PROXY_DIR/docker.sock"
npm run supabase -- start --workdir "$CADENCE_DOCKER_PROXY_DIR/work" --network-id cadence-local \
  --exclude imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor \
  >/dev/null 2>&1
```

The excluded services do not participate in the adapter contract. Studio,
Edge Runtime, and Vector otherwise mount host files or the Docker socket.
The start command discards provider output because it contains local keys.
Require a zero exit status. Do not enable debug logging or save status output.

Inspect only labels, port bindings, network membership, and service health.
Every published binding must show `127.0.0.1`; stop Cadence's affected container
immediately if any binding shows `0.0.0.0`, `::`, or an empty address. Before a
destructive local reset, confirm the disposable local database contains no
owner data. Then replay and run the existing authenticated contract:

```bash
npm run supabase -- db reset --local --workdir "$CADENCE_DOCKER_PROXY_DIR/work" \
  --network-id cadence-local >/dev/null 2>&1
CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts
```

Require a zero reset exit status and repeat binding and health readback after
the reset. The contract captures CLI keys internally. Its synthetic account
cleanup must succeed. After local acceptance, stop only the Cadence containers,
preserve named volumes, and end this proxy with `kill "$CADENCE_DOCKER_PROXY_PID"`.
Do not reset or delete other projects, change Docker defaults, or substitute
hosted account data.

## Schema change workflow

All schema work must be represented by migration files under `supabase/migrations/`.

1. Create a migration locally:

   ```bash
   npm run supabase -- migration new <short_description>
   ```

2. Edit the generated SQL file.

   New migrations created after
   `20260825075255_fix_settings_timezone_conflict_errors.sql` must use explicit
   `begin;` and `commit;` boundaries when they backfill rows or apply
   `SET NOT NULL`. This prevents a failed hosted push from committing only the
   early statements and leaving retries unable to recreate prior objects.
   `npm run agents:check` enforces this rule. The two known historical cases,
   `20260609202707_add_behavior_schedule_slots.sql` and
   `20260626140000_add_behavior_schedules.sql`, remain unchanged because they
   have already been applied. Never rewrite an applied migration to add the
   boundary retroactively.

3. Apply and test locally:

   ```bash
   npm run supabase -- db reset
   ```

### Occurrence sync batch index

Migration `20260825080815_add_occurrence_sync_batch_order_index.sql` adds
`occurrence_sync_state_batch_order_idx`. Its columns match the daily batch query
exactly: `stale DESC`, `synced_through_local_date ASC NULLS FIRST`,
`updated_at ASC`, and `user_id ASC`. Verify both the migration and repository
order together before changing either contract.

   Use `db reset` as the default verification because it proves a clean database can be recreated from migrations and seed data.

4. Update docs and generated types in the same task:
   - `docs/DATA_MODEL.md`
   - `lib/db/database.types.ts` after type generation exists
   - relevant resolver/service tests

5. Run the standard checks:

   ```bash
   npm run agents:check
   npm run resolvers:check
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

## Type generation

When the local stack is running, generate types from local schema:

```bash
mkdir -p lib/db
npm run supabase -- gen types typescript --local > lib/db/database.types.ts
```

When the local stack uses a custom Docker network, pass the same network to
type generation. The 2026-08-30 isolated desktop verification stack uses
`--network-id cadence-local`. Without that flag, CLI 2.105's temporary type
generator cannot resolve `db`. Generate into a temporary file first and replace
the checked-in types only after generation succeeds.

When a hosted project is intentionally being inspected, generate hosted types with an explicit project ref:

```bash
npm run supabase -- gen types typescript --project-id "$SUPABASE_PROJECT_REF" --schema public > lib/db/database.types.ts
```

Do not paste generated types into docs. Commit the generated TypeScript file when schema changes require it.

## Hosted project workflow

Hosted project changes are gated. Only run hosted commands when the user has authorized the target project or the active ticket explicitly requires deployment.

```bash
npm run supabase -- login
npm run supabase -- link
npm run supabase -- migration list
npm run supabase -- db push
```

Rules:

- Migrations are the only normal path from local to hosted.
- Never change the hosted database directly in the Dashboard SQL editor or Table editor.
- Never use the hosted Dashboard to make schema changes that are not captured in git.
- Coordinate `supabase db push`; only one actor should push migrations at a time.
- Use `supabase migration list` before hosted deployment when there is any doubt about state.
- Do not run `supabase db push --include-seed` unless the ticket explicitly authorizes hosted seed data.

### Desktop Google authentication

Ticket 118 uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
in the installed macOS app. The legacy public anon key remains a compatibility
fallback. Never package a service-role key or Google provider credential.

The registered callback base is `cadence://auth/callback`. Add the narrow query
glob `cadence://auth/callback?state=*` to the intended project's Auth redirect
allowlist before native acceptance. Keep the base callback only when native
registration or a provider-denial path proves it is required. Do not use the
broader `cadence://auth/callback*` pattern. Cadence keeps dynamic state in the
query because Supabase resolves provider callbacks using the full allow-listed
`redirect_to` value. That hosted change requires explicit authorization for
the exact project.

Cadence starts PKCE with `skipBrowserRedirect`, opens the returned HTTPS URL in
the system browser, and validates callback origin, state, and the five-minute
lifetime. It consumes pending state before `exchangeCodeForSession`. Session,
refresh, verifier, and pending-state values use fixed macOS Keychain entries,
not SQLite, web storage, logs, exports, or backups. Accept any successful 2xx
token response; Supabase changed its OAuth token endpoint from 201 to 200 on
2026-06-01.

Installed macOS acceptance also requires a real Apple Development or Developer
ID signature with a valid Keychain access group. Ad hoc signing can verify the
bundle but cannot authorize Data Protection Keychain storage. Do not silently
fall back to the legacy login Keychain; temporary legacy QA requires an
explicit owner choice and manual macOS login keychain password entry.

## Many-user RLS smoke QA

Use the project smoke command when a ticket calls for hosted or local
many-independent-user RLS verification:

```bash
npm run smoke:rls:local # local stack; ignores .env.local and requires loopback
npm run smoke:rls       # selected environment; hosted use requires authorization
```

The command reads `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` from the environment or `.env.local`. It uses the
service-role key only to create and delete three temporary auth users. It signs
those users in through ordinary publishable-key clients, creates one behavior
and owned time-session fixture per user, and verifies one account cannot read,
insert, or update another account's rows. It also verifies own-only,
foreign-only, and mixed-owner reads through both Ticket 094 time-session RPCs.
Ticket 083 additionally proves the Settings timezone function rolls back a
profile update after a later Behavior precondition failure. Its success case
commits the profile, active Behavior, one configuration event, and exactly one
sync-state version increment.

Do not print Supabase keys, temporary user ids, emails, or auth responses in
handoff notes. The command summary intentionally reports only counts.

## Ticket 082 push-subscription cap workflow

Migration `20260825072106_cap_push_subscriptions_and_rate_limit.sql` extends the
owner-scoped `launch_rate_limits` action set and adds the push-subscription cap
trigger. The trigger is `SECURITY INVOKER`, has an empty search path, and is not
directly executable by app roles. An active insert or activation takes one
transaction-scoped advisory lock derived from `user_id`, keeps the registering
row plus the 19 most recently updated other active rows, and deactivates the
rest. The migration applies the same ordering to pre-existing excess rows.

Registration consumes `push_subscription_registration` through the existing
authenticated `consume_launch_rate_limit(text)` RPC. The fixed policy is six
attempts per account per 60 seconds. It does not key on IP address, endpoint,
recipient, or browser data.

Verify locally before any hosted rollout:

```bash
npm run supabase -- db reset
npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts
npm run test -- tests/push-subscription-cap-migration.test.ts tests/push-subscriptions.repo.test.ts tests/push-subscribe-route.test.ts tests/reminder.service.test.ts tests/sign-out-route.test.ts tests/push-browser.test.ts
npm run smoke:push-cap:local
```

The smoke creates one disposable local Auth user, registers 21 ordered
endpoints, proves LRU eviction, then races additional ordinary authenticated
registrations and proves the active count remains 20. It deletes the exact user
in `finally`. It never contacts a push provider. Hosted deployment still
requires explicit authorization.

## Ticket 083 Settings transaction workflow

Migration `20260825075255_fix_settings_timezone_conflict_errors.sql` replaces
only the existing Settings timezone function. The Ticket 095-097 configuration
history boundary remains intact. Stale profile, active-set, and Behavior
preconditions use non-retryable `P0001`; never use `40001` for these permanent
input conflicts because PostgREST can retry them until gateway timeout.

Verify locally before any hosted rollout:

```bash
npm run supabase -- db reset
npm run test -- tests/settings-timezone-atomicity-migration.test.ts tests/settings.service.test.ts tests/account-deletion.service.test.ts tests/rls-smoke-script.test.ts
npm run smoke:rls:local
```

The authenticated smoke deliberately passes a stale Behavior timestamp after
the function updates the profile inside its transaction. The returned error
must be the non-retryable Behavior conflict. Follow-up reads must show the old
profile, Behavior, configuration-event pointer, event count, and sync-state
version. A valid retry must advance the event count and sync-state version once.
Hosted migration deployment still requires explicit authorization.

## Ticket 094 time-session RPC workflow

Migration `20260812172823_add_time_session_query_rpcs.sql` adds two
authenticated owner-scoped reads and the evidence-backed
`occurrence_time_sessions_user_started_id_idx` index. Both functions are
`STABLE`, `SECURITY INVOKER`, use an empty `search_path`, require
`auth.uid()`, and retain owner RLS. Their exact signatures are:

- `public.list_my_occurrence_time_sessions(uuid[])`
- `public.list_my_occurrence_time_session_history(date, date, boolean, timestamptz, timestamptz, uuid, integer)`

The migration revokes each exact signature from `PUBLIC`, `anon`,
`authenticated`, and `service_role`. It then grants execute only to
`authenticated`. Do not replace either read with a service-role client.

The local Data API sets `max_rows = 1000`. The hosted Data API cap was also
verified as 1,000 on 2026-08-12 with one disposable 1,001-session owner
fixture. The unpaged arbitrary-ID RPC returned 1,000 rows. Its explicit
response ranges returned `[1000, 1]`, and the history RPC returned `[1000, 1]`
keyset pages. Cleanup removed the temporary user, and an aggregate auth query
confirmed zero matching users remained. Reconfirm the cap after any hosted
Data API configuration change.

Ticket 081 treats that cap as a transport boundary, not a record limit.
`lib/db/paginated-read.ts` issues deterministic 1,000-row `.range()` pages
until a short page returns. An exact 1,000-row page therefore always triggers
a continuation request. The helper rejects duplicate or non-advancing pages,
propagates any page error before returning data, and fails loudly above the
100,000-row absolute read ceiling. It never returns a partial materialization.

The shared range helper owns complete reads for user Behaviors, Behavior
schedules, schedule slots, Occurrences, Occurrence status events, imported
Notes, BehaviorLog record mappings, imported interventions, and compatible
arbitrary-ID time-session reads. Behavior rows, schedule parents, and slots are
read separately and reassembled by owner and foreign key, so embedded-resource
caps cannot truncate the restore graph.
Occurrence status-event filters use deterministic 500-ID batches before
merging back into global `recorded_at ASC, id ASC` order. Definition and
configuration history keep their fixed-high-water keyset pagination, and
historical time sessions keep Ticket 094's fixed-high-water keyset RPC. Those
keyset reads share the same 1,000-row page size and 100,000-row fail-loud
ceiling. The main Export-page RPC remains unchanged because it returns one JSON
row whose nested arrays are materialized inside PostgreSQL.

This response cap is independent of the arbitrary-ID function's 2,000-ID input
guard. The repository normalizes IDs, sends sequential batches of at most
2,000, and follows each batch through 1,000-row PostgREST response ranges. A
typical 666-ID input returning fewer than 1,000 sessions uses one request. An
exact 1,000-row response requires a continuation request. The repository
deduplicates sessions by ID and restores global `started_at ASC, id ASC` order
across response pages and ID batches. Do not remove response-range continuation
because the current production input usually returns fewer rows than IDs.

Historical reads do not send ID arrays. They join Occurrences and Time Sessions
inside PostgreSQL, filter by Occurrence `local_date`, and use 1,000-row
`(started_at, id)` keyset pages. The archive predicate is
`include_archived OR behavior.active`, preserving current Export semantics.
The service supplies one
`through_started_at` high-water value for the entire read. All-time reads send
`0001-01-01` as the required start-date sentinel. Analytics supplies its
resolved range, `includeArchived: true`, and injected `now`. Export uses this
path only when time tracking is requested and supplies its resolved dates,
archive choice, and injected `now`. Timeline and single-Occurrence reads stay
on the arbitrary-ID path. Repositories are the only RPC callers.

Verify this migration locally before any hosted rollout:

```bash
npm run supabase -- db reset
npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts
npm run test -- tests/time-sessions-rpc-migration.test.ts tests/time-sessions.repo.test.ts tests/analytics.service.test.ts tests/timeline.service.test.ts tests/export.service.test.ts tests/rls-smoke-script.test.ts
npm run smoke:rls:local
```

Also run the repository-wide completion checks from `AGENTS.md`. The RLS smoke
must use ordinary authenticated clients for both RPC reads. The service role
remains limited to exact temporary-user setup and cleanup.

Ticket 094's index decision used `EXPLAIN (ANALYZE, BUFFERS)` against a
rollback-only local fixture with 3,650 daily Occurrences and 7,300 stopped
sessions for one owner. The 90-day plan kept the existing Occurrence date
index. The all-time first page and a later cursor page changed from sequential
scan and sort plans to
`occurrence_time_sessions_user_started_id_idx`, improving those local runs from
2.801 ms to 0.798 ms and from 1.516 ms to 0.876 ms. Treat this as planning
evidence, not a hosted capacity benchmark.

Hosted rollout is migration-first and requires explicit authorization:

1. Confirm the linked target and compare hosted migration history with git.
2. Confirm the hosted Data API row cap is 1,000 before application deployment.
3. Push the additive migration with `npm run supabase -- db push`.
4. Verify both exact signatures, invoker mode, empty search path, grants, and
   two-account isolation through ordinary authenticated clients.
5. Deploy the compatible application only after the schema checks pass.
6. Smoke Behaviors ranges 7, 30, and 90, Timeline timing, and a time-tracking
   export. Check logs for request, permission, timeout, and isolation errors.

If application rollout fails, roll back the application first. Leave the
unused additive functions in place until a later migration removes them. Never
edit an applied migration or drop a hosted function manually.

## Synthetic many-account load fixtures

Ticket 064's read baseline uses the project-local Supabase stack only. The
target classification must be exactly `local`, and the resolved Supabase and
Cadence URLs must both be loopback. Do not infer safety from `.env.local`: it
may intentionally contain hosted credentials for another workflow. A hosted
URL, linked project, or valid hosted key is a preflight failure for Ticket 064.

The privilege boundary is strict:

- A server-side lifecycle process may receive the local service-role key for
  exact run-scoped Auth provisioning, cohort seeding, and cleanup, including
  their pre/post aggregate boundary checks.
- Account creation, password sign-in, and cookie preparation finish before
  timed route statistics.
- Each active virtual user receives one unique ordinary signed-in identity and
  cookie jar, including while it selects a public-document task. Identity
  exhaustion fails the user or run; it does not permit sharing.
- Timed product reads use ordinary sessions and normal RLS.
- The service-role key must not be written to the session file, exposed through
  a worker environment or command line, copied to a report, or made available
  to Locust.
- `npm run smoke:rls` must pass against the local target after the load run.

Disposable users must match the exact run-scoped
`cadence-load-...@example.invalid` convention. Provisioning is idempotent for
one exact run ID. Cleanup must reject blank, malformed, wildcard-bearing,
path-like, or overly broad selectors; use only the captured exact run and Auth
users; remove their owned rows and private session material; verify zero
residual fixtures; and be safe to retry. Never delete users by the
`example.invalid` domain alone or by a broad `cadence-load-` prefix.

Session artifacts are run-specific, ignored, outside tracked source, and
owner-only. They contain ordinary cookies plus the minimum cohort and owned
fixture selectors required by the reader. Do not log cookies, passwords,
tokens, keys, user IDs, emails, selectors, behavior titles, notes, response
bodies, or export contents. Retained results contain only aggregate cohort
counts and sanitized statistics.

The five data cohorts are `empty`, `typical_daily`, `review_heavy`,
`export_heavy`, and `heavy_schedule`. The heavy-schedule cohort is opt-in and
must not enter the default mix. A full default 100-user fixture may reserve five
additional inactive heavy-schedule identities for a separately tagged stage.
Default fixtures disable email reminders, omit push subscriptions, and do not
contact any provider or invoke reminder or occurrence processing.

Ticket 064 does not authorize:

- a hosted Supabase target, even for synthetic data;
- schema changes or hosted migration deployment;
- Auth-capacity measurement;
- product mutations, import, restore, account deletion, or other destructive
  load;
- Google OAuth automation, real email, Web Push, provider calls, or process
  routes;
- direct Dashboard SQL or Table Editor setup/cleanup.

Hosted synthetic load requires a later ticket's isolated staging target,
explicit user authorization, provider/platform coordination, cost and traffic
ceilings, monitoring, and its own cleanup proof. Missing authorization blocks
the run; it does not authorize production or a linked hosted project as a
fallback.

### Ticket 066 hosted staging load

Supabase's current production checklist recommends load testing in staging.
Use a dedicated synthetic-only Supabase staging project. Do not copy production
users, behaviors, notes, subscriptions, or recipients. Match the production-
relevant region, compute tier, migrations, RLS, indexes, and environment shape
without reusing the production project ref.

Before traffic, compare hosted migration history with git. Run the hosted RLS
smoke, Supabase advisors, a one-user product smoke, monitoring collection test,
and the exact-cleanup dry run. Record the project ref only in private task
notes. Locust receives ordinary sessions only. It never receives a service-role
key.

The current read-only discovery found the existing Supabase organization on
Pro and found no separate Cadence staging project. That discovery does not
authorize creating a project or running load. If the selected target uses Team
or Enterprise and the workload is heavy or prolonged, coordinate with
Supabase support at least two weeks ahead. Record the support reference in the
private stage manifest. Under the current production checklist, a Pro target
records coordination as not required, but every other isolation and safety
gate still applies.

References:

- <https://supabase.com/docs/guides/deployment/going-into-prod>
- <https://supabase.com/docs/guides/deployment/managing-environments>
- <https://supabase.com/changelog?types=breaking-change>

The end-to-end local procedure and failure recovery are documented in
`docs/LOAD_TESTING_RUNBOOK.md`. The canonical commands are
`npm run load:read:smoke`, `npm run load:read:baseline`,
`npm run load:read:ramp`, and `npm run load:read:full`; each owns setup through
verified cleanup for one independent exact run. The supervisor reads the
project-local values from `npm run supabase -- status -o env`, validates
loopback endpoints, and does not trust `.env.local`. Do not invoke raw Locust
in a way that bypasses local-target validation, identity allocation, integrity
checks, or exact cleanup.

Ticket 064 changes no schema. It requires a healthy local stack with the
current migrations, but it does not require `npm run supabase -- db reset`.
Use a reset for independent clean-migration verification after schema work,
never as load-fixture cleanup or failed-run recovery.

## Launch cost controls

Supabase's cost-control documentation and billing changelog were rechecked on
2026-08-01. Read-only Ticket 066 discovery identified the current organization
as Pro. It did not verify the Spend Cap setting, compute size, add-ons, current
usage, invoice estimate, billing contact, or notification delivery.

On Pro, the Spend Cap covers these current usage items:

- Disk Size
- Egress
- Edge Function Invocations
- Logs Ingest and Logs Query
- Monthly Active Users, SSO Users, and Third Party Users
- Realtime Messages and Realtime Peak Connections
- Storage Image Transformations and Storage Size

The Spend Cap does not currently cover:

- Compute, Branching Compute, or Read Replica Compute
- Custom Domain
- additionally provisioned Disk IOPS or Disk Throughput
- IPv4 address
- Log Drain Hours or Log Drain Events
- Multi-Factor Authentication Phone
- Point-in-Time Recovery

The Spend Cap is not a fine-grained budget and does not provide per-item
threshold notifications. Covered usage can be restricted after quota, but
already-incurred usage remains. Compute is billed independently while a
project runs. Provider restrictions may affect availability across an
organization. Recheck the current dashboard and documentation before every
setting change.

Before broad launch, an organization Owner must privately record:

1. the current billing cycle, plan, project count, compute size, disk posture,
   add-ons, included quotas, overage rates, and current baseline;
2. whether the Spend Cap is enabled;
3. the accepted availability tradeoff for every covered item;
4. the owner and backup who receive and have tested billing notifications;
5. compute and add-on exposure that remains when the cap is enabled.

Changing the Spend Cap, pausing a project, resizing compute, adding resources,
or changing a plan is a provider mutation. Each action requires exact owner
authorization. Ticket 067 never toggles these controls automatically.

Recovery after a restriction:

1. Capture aggregate usage, affected item, current restriction, project health,
   and migration state without identifiers or user data.
2. Stop the proven application source with the narrow Ticket 067 circuit
   breaker when possible.
3. Do not disable the Spend Cap or resize compute until the owner accepts the
   resulting cost.
4. Before resumption, verify migration congruence, advisors, RLS smoke,
   application integrity, queue state, and one ordinary authenticated flow.
5. Record the owner go decision. Provider restrictions may take time to clear
   after a billing-cycle reset.

References:

- <https://supabase.com/docs/guides/platform/cost-control>
- <https://supabase.com/docs/guides/platform/billing-on-supabase>
- <https://supabase.com/docs/guides/platform/manage-your-usage/compute>
- <https://supabase.com/changelog.md>

## Local and hosted congruence

The desired invariant is: git migrations define schema, local can reset from git, and hosted migration history matches git.

Default loop:

1. Pull latest git.
2. Run `npm run supabase -- db reset` locally.
3. Implement schema changes as a new migration.
4. Reset locally again.
5. Generate types.
6. Commit migration, docs, types, and tests together.
7. Push to hosted with `npm run supabase -- db push` only after verification and authorization.

If hosted appears ahead or different:

1. Stop and document the drift in the final response or `STATUS.md` if it affects handoff.
2. Run `npm run supabase -- migration list` to compare histories.
3. If direct hosted changes were made, use `npm run supabase -- db pull` to capture the hosted schema into a migration, review it, and commit it.
4. Use `npm run supabase -- migration repair` only when the migration history table is wrong and the real schema state is already understood. It updates tracking history; it does not apply or revert SQL.

## Agent decision table

| Scenario | Use CLI? | Command path |
|---|---:|---|
| Start local database/auth stack | Yes | `npm run supabase -- start` |
| Check local URLs and keys | Yes | `npm run supabase -- status` |
| Create schema change | Yes | `npm run supabase -- migration new <name>` |
| Verify migrations from scratch | Yes | `npm run supabase -- db reset` |
| Generate TypeScript database types | Yes | `npm run supabase -- gen types typescript --local > lib/db/database.types.ts` |
| Link hosted project | Yes, with user authorization | `npm run supabase -- login` then `npm run supabase -- link` |
| Deploy migrations to hosted | Yes, with user authorization | `npm run supabase -- db push` |
| Make hosted schema edit in dashboard | No | Create a migration locally instead |
| Investigate hosted drift | Yes, cautiously | `migration list`, then `db pull` only if needed |

## Secrets

Do not commit `.env`, `.env.local`, Supabase access tokens, service-role keys, or CLI config files.

`.env.example` contains names only. Real values belong in local env files, deployment secrets, or user-owned CLI auth storage.

## Local Google sign-in callbacks — September 21, 2026

The owner authorized fixing local Google sign-in. Hosted project
`qjodzutjxtmtzczbloxa` now permits `/auth/callback` on `http://localhost` and
`http://127.0.0.1`, for each port 4321–4330. Each origin has an exact callback
entry and a callback entry ending `?next=**`. The wildcard applies only to the
return-path query, not the host, port, or callback path. `supabase/config.toml`
records these same 40 entries for the local stack's next startup.

Management API readback confirmed all 40 additions, preservation of every
previous redirect, and the unchanged Site URL `https://app.cadence-me.com`.
No schema, Google scopes, provider credentials, or other auth settings changed.
Rollback removes only these 40 entries from the current allowlist.

`authRequestUrl()` in `lib/auth/redirects.ts` preserves the initiating local
hostname across OAuth start, callback, sign-out, test-login, and proxy redirects.
Calendar and Daily Brief request authentication also uses this helper for exact
same-origin checks, preventing local writes from returning a false HTTP 401.
Next.js normalizes loopback URLs and can substitute the server bind address.
The helper recovers only an exact, same-port loopback Host header during
development in the approved port pool. Production keeps its existing URL handling.
Do not replace this bound with unrestricted Host or forwarded-header trust.

Web local sign-in is affected. Desktop uses its existing native callback;
marketing has no sign-in; future mobile implementation remains deferred.

## Hosted incident diagnostics through the existing CLI credential

Use the configured CLI/API path before requesting dashboard access. Missing
`SUPABASE_ACCESS_TOKEN` and `~/.supabase/access-token` do not prove CLI logout.
The installed CLI uses macOS Keychain service `Supabase CLI`, account matching
the selected profile (default `supabase`), then legacy account `access-token`.
Verify this lookup against the installed CLI when its version changes.

For read-only Management API diagnostics, retrieve only that credential into
process memory. Capture credential-command output privately; never print it,
place it in command arguments, or persist it in a report or temporary file.
Send it only as the Authorization header to `https://api.supabase.com`.
Use a bounded request timeout and the confirmed project reference.

Useful GET endpoints under `/v1/projects/{ref}`:

- `/health?services=auth&services=db&services=rest` checks individual services.
  A project-wide `ACTIVE_HEALTHY` flag does not prove each service is healthy.
  Omit optional `timeout_ms`: the API rejected its query-string value on
  September 10, 2026. Bound the HTTP client request instead.
- `/analytics/endpoints/logs.all` accepts `sql`, `iso_timestamp_start`, and
  `iso_timestamp_end`. Select timestamps, paths, status codes, and aggregate
  error categories from `edge_logs`, `auth_logs`, and `postgres_logs`.
- `/config/disk/util` reports filesystem usage; `/config/disk` reports capacity.
- `/billing/addons` reports selected and available add-ons. An empty selected
  list alone does not establish the exact current compute class.

Keep raw OAuth callback URLs, codes, tokens, identities, and product data out
of output. Inspect Auth error text only after sanitizing it in memory.
Use `SUPABASE_TELEMETRY_DISABLED=1` for sandboxed CLI diagnostics if telemetry
writes prevent CLI startup. Confirm command options with `--help`.

Read-only investigation does not authorize restart, pause, resize, deployment,
or provider configuration changes. Record project-level evidence separately
from any inferred connection to a public provider incident.

When the owner explicitly authorizes recovery by restart, use
`POST /v1/projects/{ref}/restart` after checking the target name and reference.
Treat a successful empty response as accepted; do not require JSON or retry
the mutation because response parsing failed. Read project status and service
health until recovery, then verify database start time and ordinary sign-in.
Transient connection refusal is expected while services restart. Respect
provider retry intervals; do not substitute pause/restore or database reset.
Endpoint reference: <https://supabase.com/docs/reference/api/v1-restart-a-project>.

## Ticket 102 public evidence collection

The Public Trust workflow reads the final hosted migration version through the
Management API migration inventory `GET` endpoint. It must not use the SQL
query endpoint for this check. The protected environment stores a scoped,
expiring `SUPABASE_ACCESS_TOKEN`; its variable stores the project reference.
Its RLS result remains fresh for seven days. A manual authorized
run may execute the existing smoke command. Scheduled runs reuse its completion
time only while the source commit and both deployment IDs remain identical.
Subject mismatch makes the result Not run. Deadline expiry makes it Stale.
The smoke reports success only after all three temporary users delete
successfully. Cleanup failure is Failed and blocks a Passed release.
