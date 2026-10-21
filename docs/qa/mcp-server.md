# MCP server local acceptance — Ticket 228

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
