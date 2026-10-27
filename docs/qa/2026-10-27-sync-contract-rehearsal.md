# Account sync contract rehearsal — October 27, 2026

## Result and scope

The complete disposable local rehearsal passed on the reviewed PR #153 source:
93 migrations with exact tracked/applied version equality, all 27 rollback SQL
fixtures, both authenticated smokes, and the authenticated BehaviorStore
contract. All seven services remained on the restricted Docker network with
loopback-only published bindings. The final local Auth user count was zero;
all Cadence containers and the project-scoped proxy were stopped after testing.

This is manual full-stack evidence from an isolated Vercel Sandbox, following
[the unlinked local workflow](../SUPABASE_WORKFLOW.md). It does not change the
failed GitHub Actions result. The GitHub attempts stopped at image download,
before database startup or SQL verification.

## Exact source and execution identity

| Item | Observed value |
| --- | --- |
| Source commit | `ab7483d50a0fd4728320c03513fcb3768ff1c244` |
| Source tree | `52894ccc3e8e9af82fa153dc39691453946ade80` |
| Source directory | `/vercel/cadence` |
| Worktree | Clean before and after the rehearsal; final tree unchanged |
| Sandbox session | `sbx_fJnv0VEKQTdlY7liFEJMcGPO8juu` |
| Rehearsal command | `cmd_f9a12f06c5a54966b38413db9dec` |
| Started | `2026-10-27T19:02:50.719Z` |
| Completed | `2026-10-27T19:05:07Z` |
| Command result | Exit `0`; reported duration `136634` ms |
| Temporary manual script SHA-256 | `5c37041cf5acbc1463156adf860f27d4985bfa7ff7ada942b30e56d93b1bddd7` |
| Unchanged GitHub harness SHA-256 | `10683d889db6e7b3e4e5045a6ebb4e1ac7e5e010cd8e40f434d0fd9671a67ed9` |
| Pending migration SQL SHA-256 | `a21ab54b6b9049b2a65d905229eefbfaea38f607de5d5aef0f0da65ac4f3c4a6` |

The migration was then named
`supabase/migrations/20261027120000_account_sync_contracts.sql`.
The temporary script lived outside the repository, at
`/tmp/cadence-manual-rehearsal.sh`. Its byte-identical review copy and diff were
independently reviewed before the pass was accepted. The script was a manual
application of the documented procedure; the repository's GitHub-only harness
was neither edited nor invoked with fabricated GitHub environment variables.

## Environment and images

The fresh, nonpersistent Sandbox used 4 vCPU / 8 GB in `iad1`, with no exposed
Sandbox ports and no owner data or hosted credentials. Its image was
`vercel/sandbox/node@sha256:af6fcc5fb25a1de69ba98f5aa7cb782e792e755be35dd657dcc68a0b51a71780`.
Direct runtime inspection found Ubuntu 26.04.1 LTS, x86_64, Node 24.22.1, and npm
11.19.1. Official Ubuntu packages supplied Docker 29.1.3, PostgreSQL client
18.6, and jq 1.8.1. A new daemon exposed only a private Unix socket (mode 0600).
`npm ci --no-audit --no-fund` completed successfully from the committed lockfile.

The project-local `supabase-go` backend was exactly 2.105.0. Its seven approved
service pins were pulled sequentially from the already-allowed official
`public.ecr.aws/supabase` registry, through the unchanged Docker proxy. All seven
pulls succeeded on their first attempt in this environment. No tag, image,
platform override, mirror, or proxy permission was added.

| Service | Exact image |
| --- | --- |
| Database | `public.ecr.aws/supabase/postgres:17.6.1.132` |
| API gateway | `public.ecr.aws/supabase/kong:2.8.1` |
| Auth | `public.ecr.aws/supabase/gotrue:v2.189.0` |
| Mail | `public.ecr.aws/supabase/mailpit:v1.22.3` |
| Realtime | `public.ecr.aws/supabase/realtime:v2.103.2` |
| REST | `public.ecr.aws/supabase/postgrest:v14.12` |
| Storage | `public.ecr.aws/supabase/storage-api:v1.60.4` |

## Gates and observed evidence

Commands below refer to the exact checked source and its private unlinked
workdir. Provider startup/status output and temporary credentials were captured
privately and were not printed or retained in this report.

| Phase | Command or check | Evidence |
| --- | --- | --- |
| Source/freshness | Exact `git rev-parse` checks; clean worktree; no `.env.local`, project link, project containers, or DB/Storage volumes | Passed before any stack operation |
| Dependency install | `npm ci --no-audit --no-fund` | Exit 0 |
| Proxy/diagnostics | `npx vitest run tests/supabase-docker-proxy.test.ts tests/supabase-rehearsal-diagnostics.test.ts` | Passed |
| Isolation | Private unlinked workdir; only tracked migration files; `cadence-local` bridge default `127.0.0.1`; unchanged `scripts/supabase-docker-proxy.mjs` | Passed; hosted token/password variables explicitly empty |
| Image pulls | `docker pull --quiet` for each pin returned by the existing diagnostics helper, through the proxy | All 7 cached, first attempts; same shared 8-minute startup budget |
| Startup | `supabase start --workdir ... --network-id cadence-local --exclude imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor` | Exit 0 on first start; all 7 services running/healthy |
| Pre-reset data check | Local `select count(*) from auth.users` | Zero |
| Clean replay | `supabase db reset --local --workdir ... --network-id cadence-local` | Exit 0 within the unchanged 8-minute reset bound |
| Ledger equality | Sorted tracked filename versions compared with `supabase_migrations.schema_migrations` | All 93 versions exactly equal, including the pending migration |
| SQL fixtures | `psql -X -v ON_ERROR_STOP=1 -q -f` for every `tests/sql/*.sql` | All 27 passed, including both account-sync contract fixtures and existing canonical/lifecycle fixtures |
| Authenticated RLS | `npm run smoke:rls:local` | Exit 0; 92 ownership checks; synthetic users cleaned |
| Authenticated account sync | `npm run smoke:account-sync:local` | Exit 0; contract 1 projection/preservation/replay, contract 2, rejection, concurrency, timestamp, deletion, and isolation assertions passed |
| BehaviorStore | `CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts` | 1 authenticated integration test passed, including its shared transaction, isolation, import/restore, lineage, and category exercises |
| Final database cleanup | Local `select count(*) from auth.users` | Zero |
| Binding/health readback | Inspect all 7 exact service names after startup, after reset, and after the authenticated tests | All running/healthy; `cadence-local`; every published `HostIp` was `127.0.0.1` |
| Shutdown | Project-filtered `docker stop`, then proxy termination | All 7 containers exited; independent running-container count 0; no proxy process |
| Source integrity | `git status --porcelain` empty; exact tree comparison | Clean and unchanged after all tests |

The final stopped-container readback preserved these bindings: Database
`127.0.0.1:55322`, API gateway `127.0.0.1:55321`, and mail UI
`127.0.0.1:55324`. Auth, Realtime, REST, and Storage had no published host ports.
All seven retained `cadence-local` network configuration.

The account-sync smoke reports a named assertion suite rather than a numeric
assertion total; no numerical count is inferred here. The BehaviorStore result
is one integration test, not one assertion. A bounded observer retained only
the numeric RLS/Vitest totals and the fixed account-sync success flag from the
private test output.

## Differences from the GitHub job

The manual procedure used a fresh Vercel microVM and Ubuntu 26.04.1 instead of
the GitHub job's Ubuntu 24.04 runner. Exact source/freshness checks replaced the
GitHub runner identity checks; `GITHUB_ACTIONS` had to be absent. The manual
script wrote a private local summary instead of a GitHub step summary. It used
the same Linux CLI backend, all image pins, all excluded ancillary services,
the same proxy, network/binding rules, tracked-file copy, version comparison,
fixtures, and authenticated commands. It additionally asserted the expected
93 migration and 27 fixture counts, bounded each smoke/contract to five
minutes, and checked final source integrity. The raw output of every test was
kept private; failures could not be mistaken for success because each command
exit code was required to be zero.

## GitHub image-registry failures

[Run 40563810090](https://github.com/emixd12/cadence/actions/runs/40563810090)
tested the same PR head before this manual execution. Both attempts passed
dependency setup and focused proxy/diagnostic tests, then failed before local
stack startup:

| Attempt | Job | Observed failure |
| --- | --- | --- |
| 1 | [122399585751](https://github.com/emixd12/cadence/actions/runs/40563810090/job/122399585751) | First pin `public.ecr.aws/supabase/postgres:17.6.1.132`; 4 failed pulls; only `registry_rate_limit`; backoff 10/20/40 seconds then stop |
| 2, fresh GitHub runner | [122401402280](https://github.com/emixd12/cadence/actions/runs/40563810090/job/122401402280) | Same first pin and 4-attempt throttle result; no image cached; no database or SQL tests ran |

Each retained safe diagnostic had `tail_truncated:false` and no captured HTTP
status code. The classification establishes observed registry throttling;
it does not identify a quota owner or promise future registry availability.
The successful Sandbox pulls are separate evidence of this exact image set's
availability from the alternate execution environment at that time.

## Hosted deployment — blocked; schema unchanged

Both authorized Supabase MCP `apply_migration` attempts returned
`Invalid or expired requestState`. After the first error, the 19:11:33 UTC
readback still showed 92 hosted migrations, no contract registry, no integer
snapshot-reader overload, and the existing legacy reader. After the second
error, the 19:18:05 UTC readback again showed the same 92-migration state and
zero in-flight contract migrations. No migration SQL was deployed and no
generated hosted version was returned.

The source migration therefore remains
`20261027120000_account_sync_contracts.sql`, with the SQL hash recorded above.
No filename rename, history repair, direct schema write, or substitute migration
was performed. Hosted registry/function/grant readback and generated public
RPC types for the new contract remain deployment follow-ups. The local pass
does not imply that the hosted contract is available.

## Final source and environment disposition

No renamed-source replay was needed: the hosted migration did not execute, no
version was generated, and the source SQL was unchanged. Changes since the tested
source are limited to release documentation updates; runtime code, migration
SQL, and the rehearsal harness must remain byte-identical to the tested tree
above for this evidence to apply. The initial source identity remains a
historical record and must not be replaced with the later documentation commit.

After the complete local pass, all seven Cadence containers had already been
stopped and the proxy had exited. The nonpersistent Vercel Sandbox was then
explicitly stopped at `2026-10-27T19:19:30.125Z`; the stop response and a separate
session readback reported terminal state `stopped`. Its reported total runtime
was 1,296,934 ms (about 21 minutes 37 seconds), within the original 40-minute
limit. No snapshot or persistent filesystem was retained.

Installed macOS 0.1.5 and replacement development-client acceptance remain
separate checks. This local service rehearsal does not establish either native
client's installation, signing, or interactive acceptance.
