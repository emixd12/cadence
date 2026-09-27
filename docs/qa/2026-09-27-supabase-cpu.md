# September 25 Supabase CPU alert

Investigated September 27, 2026 against main `5e7ebdeb67082ebae12b41713507b027bdf726c8`.
Only aggregate hosted diagnostics and function definitions were read. No hosted
schema, data, session, configuration or compute changes were made.

## Finding

The strongest cause is a persistent PostgREST transaction retry loop in
`cadence_advisor_private.begin_daily_brief`. A changed Calendar selection or
connection makes the saved disclosure fence stale. The function raises
`40001` (serialization_failure) before admission. Retrying cannot update that
disclosure, and older PostgREST transaction handling retries this code.

Evidence:

| Observation | Result |
| --- | --- |
| Alert time | September 25, 12:25:46 PM America/New_York; above 80% CPU |
| September 25 local-day Postgres logs | 8,638,404 `Daily Brief Calendar disclosure changed.` errors with SQLSTATE `40001` |
| Hourly distribution | Approximately 360,000 errors/hour throughout the day, roughly 100/second |
| September 27, 12:20–1:20 PM New York | 359,874 identical errors across five database sessions |
| Live activity | PostgREST executing `begin_daily_brief`; short repeated transactions, not one long-running query |
| Live disclosure check | An enabled Calendar disclosure no longer matches the connection/selection revision |
| Existing timeouts | `authenticated` and `authenticator` already have 8-second statement timeouts |

The fast individual failures do not reach the statement timeout. A client-side
60-second deadline cannot be relied upon to stop server-side transaction retries.
The errors occur before the six-starts/minute admission counter, so that limit
does not stop them either. The same repository previously corrected this error
classification for Occurrence status and schedule conflicts.

This is a high-confidence diagnosis, not a measured CPU attribution. Historical
CPU graphs and the running PostgREST version were not obtained. Production CPU
reduction remains unverified until deployment and comparable observation.

Upstream evidence: [PostgREST issue 3673](https://github.com/PostgREST/postgrest/issues/3673)
describes indefinite `40001` retries. The
[PostgREST changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md)
records the upstream fix. PostgreSQL documents that failed statements do not
contribute normal execution statistics to
[`pg_stat_statements`](https://www.postgresql.org/docs/current/pgstatstatements.html).
Thus successful-query rankings alone miss this workload.

## Other paths checked

| Path | Evidence and assessment |
| --- | --- |
| Recent main | Daily Brief landed September 20 (`b127df2`, merged as `362eb97`). Subsequent September 25–26 verification, tests, dependencies and travel changes do not correct its SQLSTATE. |
| Account synchronization | Cumulative statistics since June 6 show 33,451 snapshot reads averaging 2,724.7 ms and 30,283 applies averaging 2,732.9 ms. These expensive full-account operations merit later profiling. September 25 edge logs contain only 17 successful calls to each, unlike the continuous error storm. |
| Desktop sync scheduling | Single in-flight synchronization, coalesced follow-up, at most five failure retries with jittered exponential backoff. No fixed rapid sync polling interval found. |
| Calendar polling | Web and desktop use 15-minute foreground refreshes. Desktop pauses its timer while blurred/hidden; web suppresses it while hidden. |
| Realtime | No application `.channel()`/`postgres_changes` subscription found; no published Realtime tables and zero replication slots in the live database. |
| Vercel jobs | Reminder processing every five minutes; occurrence sync daily at 00:05 UTC. September 25 has 288 archive RPC calls, matching the five-minute cadence. |
| Other jobs | No `cron.job` table in the application database and no Edge Functions. Public Trust evidence runs once daily at 07:17 UTC and defaults its mutating RLS smoke off. |
| Tables and queries | Largest public relation including indexes is about 2.2 MB; current dead-row estimates are small. This does not support a large-table/bloat explanation for a continuous storm. |
| Performance advisors | 31 per-row auth/RLS evaluations, 14 uncovered foreign keys, six unused-index findings and one absolute Auth-connection setting. These are separate tuning findings, not demonstrated incident causes. |

Advisor remediation references:
[RLS initialization](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan),
[foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys),
[unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index),
[Auth connection allocation](https://supabase.com/docs/guides/deployment/going-into-prod).
Do not add/drop indexes or resize compute solely from this inventory.

## Mitigation

`20260927172354_fix_daily_brief_nonretryable_conflicts.sql` changes three
application-conflict guards from `40001` to `55000`: stale/missing/disabled
preferences on acquisition, stale Calendar disclosure, and stale preference save.
The existing repository maps `55000` to `context_changed`; the route returns
HTTP 409. No TypeScript runtime change or dependency change is needed.

The migration reads and replaces only the error markers in the installed
functions. Expected-count assertions fail atomically on unexpected definitions.
It preserves grants, security settings, disclosure enforcement and admission
limits. When the optional-source v2 preference writer exists, it patches that
writer instead of its compatibility wrapper. It changes no RPC signature or
generated type.

Web and linked desktop benefit through the hosted RPCs. Local-only desktop and
marketing do not call these RPCs. Future native mobile remains deferred.

## Verification

- Focused repository/route/service/migration tests: 24 passed.
- Full Vitest suite: 2,211 passed, 40 skipped; 264 files passed, seven skipped.
- Agents, interactions, resolvers, lint, TypeScript and production build passed.
- SQL regression reproduced `40001` before the migration and passed afterward
  in an isolated PGlite PostgreSQL fixture. Both main's writer and the newer
  production writer versions passed. Checks covered missing/disabled/stale
  preferences, changed Calendar connection/selection, rollback of rejected
  writes, fresh admission, the active-generation limit, preservation of function
  bodies/ACLs/settings, and atomic failure on unexpected migration input.
- The executable regression is `tests/sql/daily-brief-nonretryable-conflicts-smoke.sql`.
  Run it through `psql -v ON_ERROR_STOP=1 -f ...` against a disposable local
  Supabase database after migration replay. The existing Ticket 147 smoke now
  expects `55000` for these conflicts.
- Full `supabase db reset --local` could not run: Docker socket access is denied.
  PGlite exercised actual PL/pgSQL with minimal Auth/Calendar prerequisites and
  the relevant function/table definitions; it is not a full Supabase/PostgREST
  integration test. No hosted error-producing smoke was run.
- `npm ci` hit an unrelated AgentMail binary extraction failure. Dependency
  installation with `--ignore-scripts` succeeded without lockfile changes.

## Hosted rollout and owner actions

This change is prepared, not deployed. No CPU recovery is claimed.

1. Reconcile migration history before rollout. Production already has
   `20260926150000_daily_brief_bounded_recovery` from PR #82 and
   `20260926170000_daily_brief_analysis_sources` from PR #83, absent from main.
   Their PR descriptions still list hosted deployment as pending. Preserve the
   existing work; bring those migration files into the release history before
   pushing this later migration. Do not rewrite or repair migration history to
   conceal the difference. Re-run the new smoke against that reconciled release.
2. Approve and deploy the migration using the repository's authorized Supabase
   CLI workflow. Merge/deploy must not run automatically from this investigation.
   Applying this SQL migration, not merely deploying the web bundle, fixes the
   retry classification. No compute or dashboard configuration change is required
   for the code fix. Keep the two older migrations before this fix in replay order
   so their `CREATE OR REPLACE` bodies cannot reintroduce `40001` afterward.
3. Check the same error count and the CPU graph after rollout. If already-running
   PostgREST sessions keep retrying, authorize a targeted service/session recovery
   with Supabase support. A project restart is a fallback with service disruption,
   not an action taken here. Confirm the migration first to avoid recurrence.
4. In Cadence Settings, deliberately save the intended Daily Brief Calendar
   disclosure to renew it, or disable Calendar inclusion. The migration must not
   silently renew consent. Do this after the error fix so Settings conflicts
   cannot start another retry loop.
5. Ask Supabase to confirm the project's PostgREST version and upgrade path for
   the upstream retry fix. Compute resizing is optional only if CPU stays high
   after the loop stops; no cost change is justified from this evidence alone.

Hosted mutations require explicit authorization under `AGENTS.md` and
`docs/SUPABASE_WORKFLOW.md`. The user's investigation request asked to separate
remaining provider actions, so this task leaves them for the owner.
