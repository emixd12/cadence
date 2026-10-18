# MCP server local acceptance — Ticket 228

Date: 2026-10-18. Starting foundation: `1cb5314d42d1e22e577d3b3685586a4ba924bd61`.
Branch: `mcp-create`. No hosted actions or deployment. Inspector acceptance is
pending the Ticket 227 local runtime handoff; this document does not claim it passed.

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

Initial evidence: focused 24 tests pass; local 12 tests pass; full suite 2,757
passes and 91 skips before the final discovery regression. Lint,
`interactions:check` and `resolvers:check` pass. `agents:check` initially detected
Ticket 227 interaction-map entries still in progress. Final repository gates
and Inspector evidence will be recorded below after the shared runtime handoff.

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
