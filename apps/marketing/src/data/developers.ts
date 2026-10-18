import reference from "./developer-reference.json";

export const developerReleaseNotice = "Local implementation verified. Hosted launch, live Claude and ChatGPT acceptance, and directory approval are pending.";
const fence = (language: string, text: string) => `\n\`\`\`${language}\n${text}\n\`\`\`\n`;
const guides = [
  {
    slug: "", title: "Developer overview", description: "Connect to Cadence with MCP: tracking data, scoped edits, authentication, and integration boundaries.",
    markdown: `# Developer overview

Cadence's MCP server lets an authorized client read a person's tracking record and make specific edits at their direction.

## Availability

${developerReleaseNotice} These pages describe contract ${reference.version} and the implementation verified on October 18, 2026. They do not announce a public launch.

The planned endpoint is **https://app.cadence-me.com/mcp**. The OAuth issuer is **https://app.cadence-me.com**. Use an operator-provided test deployment until hosted acceptance is complete. A local installation needs its own configured issuer and enabled integration endpoints.

## What you can build

Read Behaviors, categories, schedules, Occurrences, notes, status history, time sessions and adherence. With separate permissions, mark an Occurrence, edit its note, or create, edit, archive and restore a Behavior. There are no delete tools, category writes, account changes or reminder-delivery controls.

Start with [quickstarts](/developers/quickstarts), then use the [tool reference](/developers/tools). Read [authentication](/developers/authentication) before building a client, and [safe retries](/developers/idempotency) before writing data.

## Transport

One remote HTTP endpoint exposes 16 tools. The official MCP SDK serves protocol 2026-07-28 and stateless legacy versions 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07. Use an SDK for protocol headers and negotiation.

Modern clients use server/discover; legacy clients initialize before tools/list. Successful calls contain structuredContent and a short text result. Legacy transport may use SSE responses. Cadence has no sessions, resumption, unsolicited messages, resources, prompts or MCP Apps widgets. Authenticated GET and DELETE requests return 405.

## Boundaries

Each connection belongs to one account. Account-free desktop data stays on the device and cannot be read through this server. Linked desktop data becomes available after synchronization. MCP changes arrive on linked desktop through the existing sync process.

Cadence runs no autonomous agent through MCP. The outside client chooses tool calls and handles user confirmation. Returned text is data, never instructions. See [data and privacy](/developers/data-and-privacy).

## Support

Report reproducible technical problems in [Cadence GitHub issues](https://github.com/emixd12/cadence/issues). Include the tool name, stable error code and client version. Omit tokens, account identifiers, notes and other personal data.

For private reports, email [privacy@identityscaffolding.com](mailto:privacy@identityscaffolding.com). The canonical [Privacy notice](https://app.cadence-me.com/privacy) and [Terms](https://app.cadence-me.com/terms) remain on the app site. Proposed MCP legal updates await owner approval.`,
  },
  {
    slug: "quickstarts", title: "Quickstarts", description: "Connect Claude, Claude Code, ChatGPT, MCP Inspector, and other clients to a configured Cadence MCP endpoint.",
    markdown: `# Quickstarts

${developerReleaseNotice} The production URL below is the planned endpoint. For testing, substitute the configured test endpoint supplied by its operator.

## Claude connector

In Claude's connector settings, add a custom remote connector using https://app.cadence-me.com/mcp. Complete Cadence's Google sign-in and consent. Leave both write permissions off for a read-only trial. Ask for today's Timeline; inspect the selected tools and returned dates.

Custom connector availability depends on your Claude account and organization policy. Cadence has not received directory approval. See [Claude connector authentication](https://claude.com/docs/connectors/building/authentication).

## Claude Code

Add the remote HTTP server:
${fence("bash", "claude mcp add --transport http cadence https://app.cadence-me.com/mcp")}
Open Claude Code and run /mcp to authenticate the Cadence connection. Complete the browser consent, then request the account timezone or Timeline. Do not paste an access token into a project configuration.

The command format follows [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp). Cadence-specific live acceptance remains pending.

## Claude plugin

The [plugin guide](/developers/plugins) describes the local package, bundled skills and installation commands. The plugin uses the same endpoint and OAuth consent. Installing skills does not grant account access or bypass confirmation.

## ChatGPT plugin and developer mode

In [ChatGPT Plugins](https://chatgpt.com/plugins), choose the plus button, then Add custom MCP server. Enter Cadence and its endpoint, select OAuth, review the warning, and create the plugin. Authenticate with Cadence, review the tool list, then enable the plugin in a new conversation.

Older instructions may call this developer mode. The current documented flow starts in Plugins; account and workspace policies still control access. Follow [OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) if the controls differ. This is setup guidance, not a claim that Cadence passed live ChatGPT acceptance. Packaged skills are covered under [Plugins](/developers/plugins).

## MCP Inspector

Use Inspector's Streamable HTTP transport with the configured endpoint. Run discovery and OAuth, approve read access, list tools and call get_account_context with an empty object. Then try get_timeline with a date returned by the account context. Test writes only on disposable data with the corresponding permission enabled.

Inspector 2.11.0 completed local DCR, PKCE, consent and all 16 successful calls. Its error viewer can incorrectly validate an error against the success schema and report -32602. Inspect isError and the Cadence error code; official SDK clients preserve these errors. See [troubleshooting](/developers/troubleshooting).

## Other clients

Use an MCP SDK with remote HTTP, OAuth discovery, PKCE S256, CIMD or DCR, and resource-bound tokens. Set resource to the exact MCP URL. Request cadence.read and only necessary write scopes. Request offline_access if refresh tokens are needed.

For the installed SDK v2 client, versionNegotiation mode auto selects the modern protocol; its default remains legacy. Discover schemas rather than copying them into prompts. A first call can use this SDK payload:
${fence("json", '{"name":"get_account_context","arguments":{}}')}
This payload is not a complete HTTP request. The SDK supplies transport framing and headers.`,
  },
  {
    slug: "concepts", title: "Concepts", description: "Behaviors, Occurrences, manual statuses, timezones, recurrence, and adherence in Cadence's MCP contract.",
    markdown: `# Concepts

## Behaviors and Occurrences

A Behavior is a recurring thing a person tracks. Its schedules define recurrence and exact times or time ranges. An Occurrence is one scheduled instance. Categories organize Behaviors. Archive and restore change future scheduling without deleting history.

Editable records carry opaque revision values. Use the actual record ID and revision returned by a read. A title is not a unique identifier.

## Status and Needs decision

The stored values are unresolved, completed and not_completed. Their display labels are Unresolved, Completed and Not Completed. Only an explicit user decision changes the status. Silence never becomes failure.

Needs decision is a derived group: unresolved Occurrences with local_date before today. It is not a status you can write. A resolved status can be corrected later; note edits do not imply a status decision. Status history records decisions, not proof of actual start or finish times.

## Dates and timezones

Use get_account_context for the account's IANA timezone, today_local_date and freshness. Local dates use YYYY-MM-DD; they are calendar dates, not UTC instants. The day boundary is local midnight. The default timezone is America/New_York.

Inputs accept RFC 3339 timestamp offsets where an instant is required. Outputs use UTC timestamps ending in Z. Keep local_date and timezone when moving records between systems. Do not parse a local date as a JavaScript Date or assume every local day lasts 24 hours.

## Recurrence

Supported rules are daily, every N days, weekly on selected weekdays, every N weeks on selected weekdays, and monthly on day N. When a month lacks the requested day, Cadence uses that month's last day. Structured schedules define these rules; the server does not parse natural-language recurrence or cron syntax.

See [create_behavior](/developers/tools/create_behavior) for each recurrence variant and time-entry shape. Reminder settings are returned with Behaviors. MCP does not send reminders itself or expose delivery logs.

## Adherence

Adherence is Completed divided by Completed plus Not Completed. Multiply by 100 to display a percentage. Unresolved and Needs decision stay separate. If nothing is resolved, adherence is null.

For example, 3 Completed, 1 Not Completed and 2 Unresolved gives 0.75 adherence. Do not divide by all six Occurrences. Cadence exposes no streak metric and no clinical interpretation.`,
  },
  {
    slug: "authentication", title: "Authentication and permissions", description: "OAuth discovery, client registration, PKCE, scopes, consent, token rotation, revocation, and Connected apps.",
    markdown: `# Authentication and permissions

Cadence owns the OAuth authorization server. MCP access uses opaque bearer tokens bound to one account, client and exact resource URL. An ordinary web session is not an MCP token.

## Discovery and registration

An unauthenticated MCP request returns 401 with a WWW-Authenticate challenge naming resource_metadata. For the planned issuer, discovery routes are:

- https://app.cadence-me.com/.well-known/oauth-protected-resource/mcp
- https://app.cadence-me.com/.well-known/oauth-authorization-server
- https://app.cadence-me.com/.well-known/openid-configuration (OAuth metadata compatibility route; not an OpenID identity-token service).

The metadata advertises /oauth/authorize, /oauth/token, /oauth/register and /oauth/revoke. Prefer discovery over hardcoding endpoints. The implementation supports public clients with token_endpoint_auth_method none. It does not support client secrets or private_key_jwt.

CIMD uses an HTTPS client_id URL containing public client metadata. Cadence fetches bounded JSON, validates redirects and rejects private-network addresses. Metadata caching respects freshness up to one hour. DCR accepts a public-client registration at /oauth/register when the client lacks CIMD. Unused DCR registrations expire after 24 hours. Client metadata and names do not establish verification; consent labels unverified clients.

## Authorization code with PKCE

1. Create state and a fresh PKCE verifier. Derive an S256 code challenge.
2. Request response_type=code, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method=S256, and resource equal to the MCP URL.
3. The user signs in with Google on Cadence, checks the client and redirect host, and chooses permissions.
4. Check state and iss on the callback. Exchange the single-use code at /oauth/token with the verifier, matching client_id, redirect_uri and resource.
5. Send the access token only in the Authorization: Bearer header.

Registered redirect URIs must match exactly, except supported native loopback port matching. Browser-bound pending requests and codes expire after ten minutes. Denial returns access_denied without creating a grant. Reusing a code revokes its token family.

## Scopes and consent

| Scope | Effect |
|---|---|
| cadence.read | Required. Reads the included tracking data. |
| cadence.occurrences.write | Optional. Changes Occurrence status and notes. |
| cadence.behaviors.write | Optional. Creates, edits, archives and restores Behaviors. |
| offline_access | OAuth request option for refresh tokens, not a tool permission. |

Consent can remove either write scope. Inspect granted_scopes from get_account_context before offering an edit. Missing permission produces insufficient_scope and an authentication challenge. Reconnect and let the user approve the missing permission. Never silently broaden a grant.

## Token lifetime and refresh

Access tokens expire after one hour. Refresh tokens rotate on every use, expire after 30 idle days, and cannot outlive their 90-day family. Store the replacement refresh token atomically. Serialize refresh attempts: replaying an old refresh token revokes the whole family.

Cadence stores token hashes. Clients must protect their own token storage and avoid URLs, logs, exports or shared files. A token for a different MCP resource fails verification.

## Disconnect and Connected apps

In Cadence Settings, open Connected apps to review permissions, connection dates, last use and recent activity. Disconnect revokes the grant and tokens; the next request fails. Clients can also use /oauth/revoke. Reconnecting creates a new grant and does not reactivate revoked tokens.

The optional OpenAI profile marker is absent because its identity-only schema conflicts with Cadence's account-context schema. Account labels and duplicate detection may be less reliable. All 16 tool schemas remain unchanged.`,
  },
  { slug: "tools", title: "Tools reference", description: "All 16 Cadence MCP tools, generated from the versioned operation registry.", markdown: `# Tools reference

The reference and examples are generated from contract ${reference.version}. Each page lists input and output fields, permissions, annotations and errors. Examples use synthetic records and validate against contract fixtures.

## Read and write tools

${reference.tools.map((tool) => `- [${tool.title}](/developers/${tool.slug}): ${tool.description.split(":")[0]}.`).join("\n")}

## Confirmation

Read tools are read-only. Existing-record writes carry destructiveHint=true; create_behavior is non-destructive but still needs the user's direction. Annotations inform the host client. They are not a server-side confirmation dialog or a replacement for permission checks.

## Maintaining the reference

The registry owns schemas, descriptions, scopes and annotations. Update its fixtures alongside a contract change. Run npm run developers:check -- --write to regenerate the reference, then npm run developers:check to detect drift. Marketing checks enforce the same check.` },
  { slug: "errors", title: "Errors", description: "Stable Cadence error codes, HTTP admission failures, tool errors, and retry guidance.", markdown: `# Errors

## Reading a failure

Admission errors use HTTP status codes: invalid tokens return 401, missing scope 403, and exhausted grant limits 429 with Retry-After. Authentication challenges identify the protected resource or missing scope. OAuth uses its own protocol errors, such as invalid_grant and access_denied.

Tool failures carry isError=true and a structured Cadence error. The catalog's HTTP status describes the error mapping; a completed MCP tools/call exchange can carry a tool error inside an HTTP 200 response. Do not treat HTTP 200 alone as a successful edit.

## Error catalog

${reference.errors}

## Retrying safely

Read retry and retry_after_seconds. The retryable flag does not mean retry immediately. After conflict, reread the record and ask whether the intended edit still applies. Retry an uncertain write with the same idempotency_key and unchanged arguments. See [idempotency and concurrency](/developers/idempotency).

Never include tokens or returned note text in error reports. Inspector 2.11.0 has a known display issue with error structuredContent; see [troubleshooting](/developers/troubleshooting).` },
  { slug: "limits", title: "Limits and rate limits", description: "Pagination, date windows, text sizes, response budgets, and per-grant MCP rate limits.", markdown: `# Limits and rate limits

## Contract limits

${reference.limits}

Existing longer notes can be read unchanged, subject to the result byte limit. The 2,000-character note cap applies to MCP writes. A response that exceeds 100,000 UTF-8 bytes fails; use a smaller page or date range. A single oversized record may still exceed the limit.

## Rate limits

Each grant allows 120 read calls and 30 write calls per minute in independent buckets. Scope checks happen before these counters. Honor Retry-After and retry_after_seconds instead of rapid polling.

OAuth protocol endpoints enforce 600 requests per minute globally and 60 per minute per source. Registration adds 10 per hour per source. Local and unrecognized proxy environments share one source bucket. Availability can therefore depend on other traffic.

## Transport limits

MCP request bodies allow 65,536 bytes and two seconds to read. Operation network requests share a 45-second abort deadline within the route's 60-second maximum. OAuth bodies allow 16 KiB and two seconds; OAuth database calls have an eight-second deadline.

Browser Origins are limited to the configured issuer, https://claude.ai and https://chatgpt.com. Development additionally permits HTTP localhost and 127.0.0.1 on ports 4321–4330. Server-to-server requests without Origin remain valid. Arbitrary third-party browser origins are not enabled; use a backend integration.

## Pagination and freshness

Follow next_cursor until null; keep filters unchanged across pages. Treat cursors as opaque and restart the query if a cursor is rejected. Timeline's Needs decision group has a bounded lookback and item cap; use list_occurrences for a wider history review. Freshness reports the server's data, not unsynchronized desktop changes.` },
  { slug: "idempotency", title: "Idempotency and concurrency", description: "Retry Cadence writes without duplication and prevent overwriting records that changed after a read.", markdown: `# Idempotency and concurrency

## Retry keys

Every write accepts an optional idempotency_key of 8–128 characters. Generate a unique key for each intended action. The server keeps a replay receipt for 24 hours, scoped to the account and client. The same key with the same input returns the original result. A different input or operation with that key returns idempotency_key_reused.

A retry receipt can contain the original result, including user text. It is private persistence, separate from the metadata-only activity log. Expiry makes a receipt ineligible; physical deletion depends on the purge job.

After a timeout, keep both the key and arguments unchanged. After the replay window expires, reread before attempting a new action. create_behavior without a key is not idempotent and can create duplicates.

## Check before changing

set_occurrence_status accepts expected_status. update_behavior requires expected_revision. Other existing-record writes accept expected_revision as an optional guard. Read the latest record and pass its opaque revision without interpreting it.

A stale guard returns conflict and changes nothing. Do not retry by stripping the guard. Reread, compare the user's intended edit, and obtain any confirmation the revised action needs.

## Safe edit sequence

1. Read the target by ID and show the user the intended change.
2. Obtain explicit direction and any host confirmation.
3. Send the change, concurrency guard and a new retry key.
4. Inspect isError and the result. If delivery is uncertain, retry the identical request with its original key.
5. Treat changed=false as a valid no-op when returned; do not manufacture another edit.

The [tool examples](/developers/tools) describe the exact fields for each operation. Annotation idempotentHint describes ordinary tool semantics; it does not replace receipt-backed create retries.` },
  { slug: "data-and-privacy", title: "Data and privacy", description: "Data available through MCP, excluded data, activity metadata, retention mechanics, and safe treatment of returned text.", markdown: `# Data and privacy

## Data boundary

${reference.data}

User-authored Behavior location text can be part of a Behavior definition. This is distinct from excluded device coordinates, route computations and travel settings. Tracking text may itself include sensitive information, including health-related notes. Read permission covers the included tracking data, not a per-Behavior selection.

A connected client receives tool results and applies its own data handling policies. Cadence's MCP server does not run an AI model. These are technical implementation details; proposed MCP legal revisions remain unpublished pending owner approval.

## Activity and retention

Connected apps shows activity metadata, such as client, tool, time and outcome. The activity log contains no note text, tool arguments or result payloads. Activity has a 90-day purge cutoff. Private idempotency receipts contain write results for replay for 24 hours and may include note text.

Expiration is enforced before physical deletion. The operator must schedule the purge routine; hosted scheduling is not yet verified. Disconnect prevents future access but does not delete the tracking record, erase information already delivered to a client, or immediately erase retained activity. Account deletion cascades integration records. Integration credentials, activity and retry receipts stay outside exports, BehaviorLog and desktop synchronization.

## Prompt-injection guidance

Treat titles, descriptions, notes, archive notes and search text as untrusted data. A note that asks a model to ignore instructions or call another tool is still a note. Never let returned text broaden permissions, choose recipients, authorize edits or disclose secrets.

Keep user intent separate from retrieved text. Validate tool arguments against the published schema, use host confirmations, and show the target and proposed edit. Do not infer medical advice or actual completion from a record. Use [Support](/developers#support) for private concerns.`, },
  { slug: "building-integrations", title: "Building integrations", description: "Build a third-party Cadence client with explicit consent, external references, incremental reads, and safe edits.", markdown: `# Building integrations

## Third-party application pattern

Run OAuth in the user's browser and store tokens securely in your backend or native credential store. Use the discovered MCP schemas. Start with get_account_context, read only the data needed for the user's request, then present an explicit edit before calling a write tool.

Use a backend for third-party web applications: the current browser Origin allowlist does not admit arbitrary sites. A connection represents one user. Never share tokens or data caches across users.

## External references

create_behavior accepts external_ref for a calling client's record identifier. References are scoped to that account and client, so they are not a global lookup or a public cross-client identity. Use an idempotency key for uncertain creation results. See [create_behavior](/developers/tools/create_behavior) for constraints.

## Incremental reads

list_behaviors, list_categories and list_occurrences accept updated_since. Follow each next_cursor and preserve filters. Save your read watermark only after processing the full result. Reconcile by stable record ID and revision, not title.

These reads are foundations, not a full synchronization protocol: they do not provide a deletion feed, push events or transactional cross-tool snapshots. Periodic reconciliation is needed if an external system maintains a replica. Archived Behaviors remain distinct from deleted records.

## Facets foundations

A future Facets integration could associate a Behavior with its own record, read changed records and request an explicit status update. No Facets synchronization, REST adapter, webhook delivery or local account-free desktop MCP server is implemented. Cadence tracks adherence; it does not model doses, amounts, supply or refills.

## Verification

Test with disposable records: read-only consent, each permitted edit, missing scope, stale revision, duplicate retry key, revoked access and a second account's IDs. Confirm that no second-account record can be read or changed. Inspect error fields without logging tokens or note text.`, },
  { slug: "plugins", title: "Plugins", description: "Cadence's Claude and ChatGPT plugin sources, bundled workflow skills, and pending distribution status.", markdown: `# Plugins

${developerReleaseNotice} The repository contains local plugin packages; a package is not a directory listing or live-client acceptance result.

## Bundled skills

- Daily check-in: read the account context and Timeline, then record only the user's explicit decisions.
- Weekly review: review counts and notes with Unresolved separate from adherence; avoid invented causes or medical advice.
- Routine setup: prepare structured Behavior schedules and create them only with the user's direction.

Skills never skip host confirmations or grant permissions. They use the same 16 tools and OAuth endpoint as a direct connection.

## Source and local packaging

The source lives in [integrations/claude-plugin](https://github.com/emixd12/cadence/tree/mcp-create/integrations/claude-plugin) and [integrations/chatgpt-plugin](https://github.com/emixd12/cadence/tree/mcp-create/integrations/chatgpt-plugin). These branch links become available when the reviewed branch is published.

From a checkout containing these packages:
${fence("bash", "node scripts/check-plugins.mjs\nnode scripts/package-plugins.mjs")}
The packaging script writes versioned ZIP archives under integrations/.artifacts. Review the package before installing it. Build artifacts are local and are not published downloads.

## Installation and authorization

See [quickstarts](/developers/quickstarts) for connecting the MCP endpoint. Load the local Claude package:
${fence("bash", "claude --plugin-dir ./integrations/claude-plugin")}
After the reviewed package reaches the default branch, the marketplace commands are:
${fence("bash", "claude plugin marketplace add emixd12/cadence\nclaude plugin install cadence@cadence-plugins")}
These installation commands have not been exercised against a live Cadence deployment. ChatGPT package installation follows [OpenAI's local plugin testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

After installation, connect the account through Cadence consent. Test a read before enabling writes. Disconnect in Cadence Settings when finished. Directory submission, publication and live installation acceptance remain pending.`, },
  { slug: "versioning", title: "Versioning and changelog", description: "Cadence MCP contract versioning, compatibility rules, deprecation, and the local implementation changelog.", markdown: `# Versioning and changelog

## Contract version

The current operation contract is ${reference.version}. get_account_context returns contract_version; errors include it too. The operation contract version is separate from the MCP transport protocol version.

## Compatibility and deprecation

${reference.versioning}

## Changelog

### 1.0.0 · October 18, 2026 · Local implementation

Sixteen tools, three data scopes, OAuth code flow with PKCE, CIMD and DCR, consent, Connected apps, bounded reads, guarded writes and replay receipts. The local Inspector and SDK test suites verify the implementation. Hosted deployment, live client acceptance, legal approval and directory publication remain pending.

### Transport compatibility

The implementation uses official MCP server/client SDK 2.3.1 with modern 2026-07-28 and documented legacy negotiation. Cadence does not implement MCP Apps widgets, prompts or resources. Refresh cached tool metadata after a reviewed server change.`, },
  { slug: "troubleshooting", title: "Troubleshooting", description: "Resolve Cadence MCP reachability, authorization, permission, conflict, and Inspector display errors.", markdown: `# Troubleshooting

## Claude: Couldn't reach the MCP server

Confirm the exact endpoint ends in /mcp and is reachable by the client. The documented production URL is still pending hosted acceptance. A server with integrations disabled returns service_unavailable; changing client credentials cannot fix that.

Test discovery and OAuth with Inspector against the same configured endpoint. Use remote HTTP, not an invented SSE path. A browser GET to /mcp is not a connection test: authenticated GET returns 405. Check HTTPS, protocol negotiation, proxy headers and the Origin allowlist. Send only the error code and client version to [Support](/developers#support).

## Authorization fails

For invalid_grant, restart consent after checking the issuer, exact resource URL, redirect URI and PKCE verifier. Codes expire after ten minutes and can be used only once. Parallel refreshes can reuse an old token and revoke the family; serialize them.

If login loses the request, restart from the client in the same browser. Consent binds the signed-in account and browser request. A revoked connection needs a new consent; signing into the web app alone does not restore it.

## Read works but write fails

Check granted_scopes. Reconnect and approve the relevant write permission only if the user wants it. A client's cached tool list does not prove permission. For conflict, reread and compare the intended edit; do not remove the concurrency guard.

## Missing records or unexpected dates

Check the account timezone and local_date. Expand a bounded history window or follow next_cursor. Account-free desktop records are not hosted; linked changes must sync first. Needs decision is bounded in get_timeline. There is no automatic missed status.

## Inspector shows -32602 or schema warnings

Inspector 2.11.0 may validate error structuredContent against a success schema and display -32602. The server still returns isError and its stable code. Inspect the raw result or verify with an official SDK client. Nullable JSON Schema type arrays can also trigger Inspector portability warnings; do not rewrite the contract to silence them.

## Rate limits and uncertain edits

Wait for Retry-After or retry_after_seconds. For an uncertain write, reuse the original idempotency key and identical input within 24 hours. A new key can create a duplicate. See [safe retries](/developers/idempotency).

## ChatGPT account labels

Cadence omits the optional OpenAI profile marker to preserve the existing account-context schema. Account labels or duplicate-connection detection may be less reliable. Review the signed-in account on Cadence's consent screen.`, },
];

export const developerPages = [...guides, ...reference.tools];
