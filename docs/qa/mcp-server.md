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
