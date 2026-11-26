# MCP Apps spike: Ticket 375

Date: November 26, 2026 (UTC). Decision: `docs/DECISIONS.md`, 2026-11-25, D36. Plan:
`docs/plans/2026-11-25-mcp-apps-expansion.md`, package B and section 7.

## Result

The local questions are answered. The `show_day` schema and the view contract are frozen
below, so Tickets 376 and 377 can start. The real-host questions are not answered: the
test-access preflight for `mcp-web` exited 10, and no flag-on server is reachable from
Claude or ChatGPT yet. Ticket 375 stays `in_progress` until those answers are added here.

| # | Plan unknown (section 7) | Answer | Evidence class |
|---|---|---|---|
| 1 | Does a view-initiated `tools/call` raise the host's approval prompt for a write tool? | Not obtained. `basic-host` and Inspector raise none. | Tested locally; not obtained on Claude or ChatGPT |
| 2 | Does the stateless handler serve `resources/read` on both protocol paths with a fresh server per request? | Yes, on 2026-07-28 and on the legacy path. | Tested locally |
| 3 | What does a host do with a 403 step-up challenge on a view call? | Not obtained on a host. The SDK client turns the 403 into a thrown `InsufficientScopeError`, so the view gets a rejected call, not a tool error. | Tested locally (SDK client); not obtained on Claude or ChatGPT |
| 4 | Bundle size with React 19 inlined | 461,435 bytes raw, 129,836 gzip. Use Preact: 261,056 raw, 70,140 gzip. | Tested locally |
| 5 | View caching per host | Not obtained. `basic-host` and Inspector read the resource once per opened view. | Tested locally; not obtained on Claude or ChatGPT |
| 6 | Which redirect URI VS Code uses, and whether Cadence accepts it | Two HTTPS redirects and two loopback redirects, registered as a native client. Cadence's rules accept all four. | Documentation only, plus a local test of Cadence's rules |
| 7 | Does Gemini send the `resource` parameter? | Not obtained. Moved to Ticket 378. | Not obtained |
| 8 | Can a preview deployment run the acceptance suites against test accounts? | No, not as configured. Vercel scopes 2 variables to Preview and 61 to Production. Preview has no Supabase URL and no MCP flag. | Read from Vercel (names and scopes only) and from source |

One more fact was asked for: the client capability `io.modelcontextprotocol/ui` reaches
the server on `tools/list` on the 2026-07-28 path only. See "Client capability".

## What was built

Branch `spike/mcp-apps-375`, commit `46cf255dc978c2f9f2b1847e5a90b60caf9c2f2f`. It is
local only, never merges and was not pushed. Worktree, under the primary checkout:
`.claude/worktrees/agent-a2e1bc9cf3ab6e926`.

| Path on the spike branch | Content |
|---|---|
| `lib/mcp/apps.ts` | `show_day`, `resources/list`, `resources/read`, the flag and the schemas |
| `lib/mcp/server.ts` | The handlers wired into the per-request `Server`, behind `CADENCE_MCP_APPS` |
| `lib/mcp/generated/day-view-html.ts` | The built view as one TypeScript string |
| `packages/mcp-views` | Vite 8.3.6, `vite-plugin-singlefile` 2.3.4, six build variants of one view |
| `tests/mcp-apps-spike*.test.ts` | Both protocol paths with the SDK client; the VS Code registration body; the schema dump |
| `scripts/spike-375/` | `basic-host` and Inspector drivers, two probes, and token-free transcripts under `evidence/` |

Versions: `@modelcontextprotocol/server` and `client` 2.4.0, `@modelcontextprotocol/ext-apps`
2.0.4, React 19.3.1, Preact 10.27.2, Node 24.22.2.

## Local answers

### Resources on both protocol paths (unknown 2)

Yes. `tests/mcp-apps-spike.test.ts` connects the SDK `Client` 2.4.0 to `POST /mcp` through
`createMcpHandler(..., { legacy: "stateless" })`, which builds a fresh `Server` per POST.
It runs once pinned to `2026-07-28` and once in legacy mode (negotiated `2025-11-25`).
Each run lists the resource, reads it, calls `show_day` and checks the result. 3 tests pass.

Transcript from the test (method, then the `MCP-Protocol-Version` header):

```text
[spike 2026-07-28] posts: server/discover(2026-07-28), resources/list(2026-07-28), resources/read(2026-07-28), resources/read(2026-07-28), tools/list(2026-07-28), tools/call(2026-07-28)
[spike 2026-07-28] server saw: resources/list era=modern ui=true; resources/read era=modern ui=true; tools/list era=modern ui=true; tools/call era=modern ui=true
[spike legacy] posts: initialize(no header), notifications/initialized(2025-11-25), resources/list(2025-11-25), resources/read(2025-11-25), resources/read(2025-11-25), tools/list(2025-11-25), tools/call(2025-11-25)
[spike legacy] server saw: resources/list era=legacy ui=false; resources/read era=legacy ui=false; tools/list era=legacy ui=false; tools/call era=legacy ui=false
```

Also confirmed by that test:

- The server capabilities carry `resources: {}` and
  `extensions: { "io.modelcontextprotocol/ui": {} }` on both paths.
- `resources/list` returns the descriptor and no HTML.
- `resources/read` returns `mimeType: "text/html;profile=mcp-app"` and
  `_meta.ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }`.
  An unknown URI fails the request.
- With the flag off, `resources/read` returns HTTP 404 with JSON-RPC `-32601`, the tool
  is absent from `tools/list`, and a call to `show_day` from a stale descriptor returns a
  tool error.
- On 2026-07-28 a `resources/read` POST needs the `Mcp-Name` header set to the URI. A
  request without it fails with `-32020`. The SDK client sends it.

Two real clients repeated this against the local stack. `basic-host` (legacy,
`2025-11-25`) and Inspector 2.13.0 (legacy, and `--protocol-era modern` on `2026-07-28`)
each read the resource with status 200.

### Client capability (question d)

Recorded as a fact. The decision not to hide the tool stands.

- 2026-07-28: every request carries the client's capabilities in its `_meta` envelope, so
  the server sees `io.modelcontextprotocol/ui` on `tools/list`. Shown by the SDK client
  test (`ui=true`) and by Inspector 2.13.0 in modern mode.
- Legacy: the capability travels only in `initialize`. A fresh `Server` per POST never
  sees it on `tools/list` (`ui=false`). Inspector CLI with `--advertise-apps` sent the
  capability in `initialize`, and the later `tools/list` POST carried none.
- `basic-host` 2.0.4 does not declare the capability at all, and still renders the view.

### The view in `basic-host` and Inspector (question b)

Yes in both. The server was the mcp-acceptance local stack (`cadence-accept-375`, issuer
`https://127.0.0.1:4455`, `CADENCE_MCP_APPS=true`). Neither client could sign in to
Cadence's OAuth server unattended, so `scripts/spike-375/local-hosts.mjs` granted two
tokens through the real consent page (one full, one read-only) and ran a loopback proxy
that adds the bearer token. The data came from a local test-login user.

| Host | Version | Protocol path | Result |
|---|---|---|---|
| `ext-apps` `basic-host` | Tag `v2.0.4`, `@modelcontextprotocol/client` 2.0.0, headless Chrome | Legacy, `2025-11-25` | Rendered. Status write, note save, parent slot write, conflict and read-only state all passed. |
| MCP Inspector web, "Apps" tab | 2.13.0 | Legacy | Rendered. A status write from the view returned 200 and the view re-read the day. |
| MCP Inspector web, "Apps" tab | 2.13.0, `--protocol-era modern` | `2026-07-28` | Same result. |
| MCP Inspector CLI | 2.13.0 | Legacy | `resources/list`, `resources/read` and `--app-info` returned the URI, CSP and MIME type. |

`basic-host` steps, each checked against a direct `show_day` read with the same grant:

| Step | Tool the view called | Server after the step |
|---|---|---|
| Completed on one Occurrence | `set_occurrence_status` with `expected_status` | `completed` |
| Save a note holding `<img src=x onerror=...>` | `update_occurrence_note` with `expected_revision` | Note stored unchanged; the view rendered it as text, with no `img` element |
| Completed on a parent slot | `set_parent_occurrence_status` with `expected_statuses` | `derived_status: completed`, `2/2` |
| Click after the status changed elsewhere | `set_occurrence_status` | `conflict`; the view re-read the day and showed "This changed somewhere else. Check it and try again." |
| Read-only grant | `show_day` only | The view showed "Reconnect to allow changes" and no write control |

Further facts from these runs:

- The view frame made 0 network requests in every run.
- Every step passed with three builds: React with `ext-apps`, Preact with `ext-apps`, and
  plain DOM with the hand-written bridge.
- Neither host showed an approval prompt for a view-initiated write. Both are developer
  tools, so this says nothing about Claude or ChatGPT.
- Each host read the resource once per opened view. `basic-host` keeps the HTML in memory
  per connection (`appHtmlCache` in its source). Neither host persists it.
- Inspector also calls `resources/templates/list`. Cadence answers `-32601` and Inspector
  continues.
- The view's `ui/update-model-context` line reached `basic-host`'s "Model Context" panel.

Connector provenance was checked against the local database
(`scripts/spike-375/provenance-probe.mjs`, with `CADENCE_CONNECTOR_COMPLETION=on`). A real
connector completion needs a Hevy source link, so the probe rewrote one status event's
provenance columns to the connector's values. Results: person-marked Completed gives
`connector_completion: null`; the connector event gives
`{ "source": "hevy", "source_label": "Hevy" }`; after the person changes the status it is
`null` again.

Not verified: that `show_day` and resource reads write an activity row. The spike
ignores a failed write of that row.

### Bundle size (unknown 4)

Vite 8.3.6, minified, one HTML file, measured by `packages/mcp-views/scripts/measure.mjs`.

| Variant | Raw bytes | gzip -9 | Brotli |
|---|---|---|---|
| React 19 + `ext-apps` | 461,435 | 129,836 | 111,672 |
| Preact + `ext-apps` | 261,056 | 70,140 | 60,875 |
| Plain DOM + `ext-apps` | 241,453 | 62,858 | 54,140 |
| React 19 + hand-written bridge | 228,637 | 71,010 | 61,246 |
| Preact + hand-written bridge | 28,555 | 11,178 | 10,132 |
| Plain DOM + hand-written bridge | 9,240 | 3,850 | 3,303 |

`ext-apps` costs about 232 KB raw, because it bundles zod and the MCP SDK core. React
costs about 220 KB more. Preact costs about 20 KB.

**Recommendation: Preact through `preact/compat`, with `ext-apps`.** The same `.tsx`
source builds for both, so nothing in the view changes. It is 200 KB smaller than React
and the view is too small to need React. Keep `ext-apps`: it owns the host handshake,
sizing and host context, and the spec has a draft in progress. The hand-written bridge is
about 40 lines and worked in `basic-host`; hold it as the fallback if a host sets a size
limit that 261 KB breaks. One read of the Preact view costs one read from the per-grant
limit and a 262 KB response.

### What the SDK does with the 403 (part of unknown 3)

`scripts/spike-375/stepup-probe.mjs` called `set_occurrence_status` with the read-only
grant through the SDK client 2.4.0 on both paths. Cadence answered HTTP 403 with
`WWW-Authenticate: ... error="insufficient_scope", scope="cadence.read cadence.occurrences.write"`
and a tool-error body. The client threw `InsufficientScopeError` and never returned the
body. A host built on the SDK therefore hands the view a rejected `callServerTool`, with
no `structuredContent.error.code`. The view contract below covers this.

## Real hosts: not obtained

`npm run qa:preflight -- --suite mcp-local,mcp-web` exited 10. `mcp-local` alone exits 0.
The owner list, unchanged:

```text
Owner steps. Please do these, then tell the agent to rerun the preflight:
1. Google asked for a check the script cannot pass; finish this test account's sign-in in the Cadence QA Chrome window. (test account B)
2. Sign in to ChatGPT in the Cadence QA Chrome window.
3. Sign in to Claude in the Cadence QA Chrome window.
4. Connect the Cadence QA connector in claude.ai as test account A once (mcp-acceptance skill, Emi's whole part). (test account A)
```

The spike stopped the real-host part there. Unknowns 1, 3 and 5 have no answer for Claude
web or ChatGPT web.

What the hosts' documentation says, read November 26, 2026. None of it is tested.

- Claude: "MCP tool calls are proxied through Claude's backend." Claude may ask
  permission to display an app ("Allow once", "Always allow"). A tool result above about
  150,000 characters is written to a sandbox file when code execution is on, and the view
  then never receives it. A `show_day` result was about 7 KB.
- Claude: `_meta.ui.domain` is needed only when a view runs its own OAuth flow. The day
  view does not, so it sets none.
- OpenAI: "version resource identifiers when HTML, JavaScript, or CSS changes", and
  "Require confirmation for consequential write actions". The page read does not say
  whether a view-initiated call is confirmed.
- MCP Apps spec 2026-01-26: a host "MAY prefetch and cache UI resource content", and
  "MAY decide to block some messages or subject them to further user approval".
- Known from Ticket 256, live: ChatGPT starts no step-up from a read-only grant.

### Reaching a flag-on server from a real host (unknown 8)

A preview deployment cannot do it today.

- The app's Vercel project has 61 variables scoped to Production and 2 scoped to Preview
  (`GEOAPIFY_API_KEY` and `TRAVEL_CONCLUSIONS_SIGNING_SECRET`). Preview has no
  `NEXT_PUBLIC_SUPABASE_URL`, no `CADENCE_MCP_ENABLED` and no `CADENCE_OAUTH_ISSUER`. A
  preview has no database to sign in to. By the code, `/mcp` answers 503 without
  `CADENCE_MCP_ENABLED`; no preview was called. Read with `vercel env ls`, names and
  scopes only.
- Without `CADENCE_OAUTH_ISSUER`, the code defaults the issuer to
  `https://app.cadence-me.com`. A preview would then advertise the production resource
  URL, which does not match the URL a host connected to.
- `npm run mcp:accept:web` is fixed to the production target. It cannot run against a
  preview or a tunnel without a change under `scripts/acceptance/` (Ticket 378).
- `docs/VERCEL_WORKFLOW.md` gives agents no permission to set a Preview variable. Its
  nearest rule calls setting a flag in Production or Preview "an owner-gated rollout
  step". The spike changed no Vercel variable.
- Giving Preview the production Supabase values would run unmerged branch code with the
  service-role key against the production database. That is an owner decision.

A tunnel to the local stack avoids all of that and touches no production data. It needs a
tunnel tool, and none is installed here (`cloudflared`, `ngrok` and `tailscale` are not on
PATH). It also needs the local stack started with the tunnel's HTTPS origin as
`CADENCE_OAUTH_ISSUER`. The test user would be a local test-login user, not production
test account A.

While reading Vercel, `vercel link` wrote a `.env.local` into a scratch folder outside the
repository. The agent deleted it without reading it.

## VS Code redirect and Ticket 381

Documentation only for VS Code's side. No VS Code client was run.

- VS Code's MCP guide says to allow `http://127.0.0.1:33418` and
  `https://vscode.dev/redirect`.
- `microsoft/vscode`, `src/vs/base/common/oauth.ts`, `fetchDynamicRegistration`, read on
  `main` on November 26, 2026, registers `redirect_uris`
  `https://insiders.vscode.dev/redirect`, `https://vscode.dev/redirect`,
  `http://127.0.0.1/` and `http://127.0.0.1:33418/`, with `application_type: "native"`,
  `token_endpoint_auth_method: "none"` and `response_types: ["code"]`.
- Cadence's rules (`validRedirect` and `redirectAllowed` in
  `lib/services/oauth/protocol.ts`, `validateClientMetadata` in
  `lib/services/oauth/clients.ts`) accept that body and each of the four redirects at
  authorization, plus a loopback redirect on another port.
  `tests/mcp-apps-spike-vscode.test.ts` on the spike branch runs the body through them.
- VS Code registers no custom scheme. Cadence would still reject `vscode://`.
- The acceptance depends on `application_type: "native"`. Without it Cadence treats the
  client as `web` and rejects the loopback redirects.
- VS Code's authorization URL adds `resource` when it has one
  (`src/vs/workbench/api/node/extHostAuthentication.ts`). Whether its token request
  sends `resource`, which Cadence requires, was not confirmed.

**Is Ticket 381 needed?** No gap was found for VS Code: its documented redirects pass
Cadence's rules. For consumer Gemini the question is open, because no Gemini client was
run and Google's `resource` behavior is still unverified. Ticket 381 stays conditional.
Ticket 378's first VS Code and Gemini Developer Mode connections decide it.

## Frozen `show_day` contract

Tickets 376 and 377 build to this. A change needs a new note and a new resource URI if
it breaks the view.

### Tool descriptor

| Field | Value |
|---|---|
| `name` | `show_day` |
| `title` | `Show day` |
| Scope | `cadence.read` |
| `annotations` | `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `_meta.ui.resourceUri` | `ui://cadence/day/v1.html` |
| `_meta.ui.visibility` | Omitted, so the default applies: the model and the view may both call it |
| `securitySchemes` | `[{ "type": "oauth2", "scopes": ["cadence.read"] }]`, also under `_meta`, as every Cadence tool has |
| Listed | Always, while the flag is on. Never hidden by client capability. |
| Registry | Not in it during the trial. Cadence Chat never sees the tool. |

### Input schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "Day to show. Defaults to today in the account timezone.",
      "format": "date",
      "examples": ["2026-10-18"]
    }
  },
  "required": [],
  "additionalProperties": false
}
```

### Output

`structuredContent` holds the object below. `content[0].text` is the same object as JSON.

| Field | Type | Meaning |
|---|---|---|
| `local_date` | date | The day shown |
| `is_today` | boolean | |
| `timezone` | string | Account timezone |
| `today_local_date` | date | Today in the account timezone |
| `day_note` | string or null | Always present, unlike `get_timeline` |
| `occurrences` | array | Every Occurrence of the day, sub-behavior Occurrences included |
| `parent_groups` | array | Always present. The contract's parent group, unchanged. |
| `needs_decision` | `{ count, truncated }` | The count only. Never a list. `truncated` is true when more than 100 exist; `count` is then 100. |
| `freshness` | object | As in `get_timeline` |

Each Occurrence is the contract 1.7.0 Occurrence plus two fields:

| Field | Type | Meaning |
|---|---|---|
| `connector_completion` | `{ source, source_label }` or null, required | Server-computed. Set only when the status is Completed and the latest status event came from a connected service. `source` is a stable id such as `hevy`; `source_label` is the display name. Null when the person set the status. |
| `alongside` | boolean or null, optional | Present only in the alongside contract edition. The view shows "Alongside" only for `true`. |

Rules:

- `show_day` is its own projection. `get_timeline` does not change.
- It never carries Calendar events, travel, leave times, Daily Brief text, location,
  tracked time or intended duration.
- It ignores Periods. See "Periods".
- A later contract edition may add optional Occurrence fields. The view ignores fields it
  does not know.

Result `_meta`:

| Key | Value |
|---|---|
| `com.cadence-me/granted_scopes` | The grant's tracking scopes, for example `["cadence.read", "cadence.occurrences.write"]`. Never in `structuredContent` or the text. |

Errors use the existing tool-error shape (`isError: true`, `structuredContent.error`):
`invalid_input`, `insufficient_scope`, `rate_limited`, `service_unavailable`,
`internal_error`.

<details>
<summary>Full output JSON Schema, as the spike served it</summary>

```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "local_date": {
   "type": "string",
   "description": "The day shown.",
   "format": "date",
   "examples": [
    "2026-10-18"
   ]
  },
  "is_today": {
   "type": "boolean"
  },
  "timezone": {
   "type": "string",
   "description": "IANA timezone name.",
   "minLength": 1,
   "maxLength": 64,
   "pattern": "^[A-Za-z0-9_+\\-/]+$",
   "examples": [
    "America/New_York"
   ]
  },
  "today_local_date": {
   "type": "string",
   "description": "Calendar date (YYYY-MM-DD) in the account timezone.",
   "format": "date",
   "examples": [
    "2026-10-18"
   ]
  },
  "day_note": {
   "type": [
    "string",
    "null"
   ],
   "description": "The person's day note for this date, or null."
  },
  "occurrences": {
   "type": "array",
   "description": "Every Occurrence of the day, sub-behavior Occurrences included.",
   "items": {
    "type": "object",
    "description": "An Occurrence as get_timeline returns it, plus `connector_completion`.",
    "properties": {
     "id": {
      "type": "string",
      "format": "uuid"
     },
     "behavior_id": {
      "type": "string",
      "format": "uuid"
     },
     "behavior_title": {
      "type": "string"
     },
     "category_name": {
      "type": [
       "string",
       "null"
      ]
     },
     "local_date": {
      "type": "string",
      "description": "Calendar date (YYYY-MM-DD) in the account timezone.",
      "format": "date",
      "examples": [
       "2026-10-18"
      ]
     },
     "timezone": {
      "type": "string",
      "description": "IANA timezone name.",
      "minLength": 1,
      "maxLength": 64,
      "pattern": "^[A-Za-z0-9_+\\-/]+$",
      "examples": [
       "America/New_York"
      ]
     },
     "scheduled_for": {
      "type": "string",
      "description": "Planned start as a UTC instant. It never changes when the Occurrence is moved for the day.",
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "effective_start_at": {
      "type": "string",
      "description": "Where the Occurrence sits today: its moved start when `move` is set, otherwise the planned start. Show, remind and match by this time.",
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "move": {
      "description": "Set while a per-day move places the Occurrence away from its planned time. Null otherwise.",
      "anyOf": [
       {
        "type": "object",
        "properties": {
         "planned_start_at": {
          "type": "string",
          "description": "The planned start. It does not change when the item moves.",
          "format": "date-time",
          "pattern": "[Zz]$"
         },
         "start_at": {
          "type": "string",
          "description": "The moved start.",
          "format": "date-time",
          "pattern": "[Zz]$"
         },
         "end_at": {
          "type": "string",
          "description": "The moved end. A move keeps the item's length.",
          "format": "date-time",
          "pattern": "[Zz]$"
         }
        },
        "required": [
         "planned_start_at",
         "start_at",
         "end_at"
        ],
        "additionalProperties": false
       },
       {
        "type": "null"
       }
      ]
     },
     "schedule": {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "enum": [
         "exact",
         "range"
        ]
       },
       "preset": {
        "type": [
         "string",
         "null"
        ],
        "enum": [
         "morning",
         "afternoon",
         "evening",
         "night",
         null
        ]
       },
       "start_time": {
        "type": "string",
        "description": "Local wall-clock time, 24-hour HH:MM.",
        "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$",
        "examples": [
         "07:30"
        ]
       },
       "end_time": {
        "type": [
         "string",
         "null"
        ],
        "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$",
        "examples": [
         "07:30"
        ],
        "description": "Local wall-clock time, 24-hour HH:MM."
       },
       "label": {
        "type": "string"
       }
      },
      "required": [
       "kind",
       "preset",
       "start_time",
       "end_time",
       "label"
      ],
      "additionalProperties": false
     },
     "status": {
      "type": "string",
      "enum": [
       "unresolved",
       "completed",
       "not_completed"
      ],
      "description": "Stored status."
     },
     "status_label": {
      "type": "string",
      "enum": [
       "Unresolved",
       "Completed",
       "Not Completed"
      ]
     },
     "needs_decision": {
      "type": "boolean",
      "description": "Derived: true when the status is unresolved and local_date is before today. Never stored."
     },
     "origin": {
      "type": "string",
      "enum": [
       "scheduled",
       "opportunity"
      ],
      "description": "scheduled comes from the Behavior's schedule; opportunity was added to its day from the person's opportunities (contract 1.6.0)."
     },
     "added_by": {
      "type": [
       "string",
       "null"
      ],
      "enum": [
       "user",
       "daily_brief",
       "chat",
       "mcp",
       null
      ],
      "description": "Who added an opportunity Occurrence: user, daily_brief, chat or mcp. Null for scheduled Occurrences."
     },
     "completed_at": {
      "type": [
       "string",
       "null"
      ],
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "status_marked_at": {
      "type": [
       "string",
       "null"
      ],
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "note": {
      "type": [
       "string",
       "null"
      ]
     },
     "parent_behavior_id": {
      "type": [
       "string",
       "null"
      ],
      "format": "uuid",
      "description": "Parent Behavior id when the Occurrence belongs to a sub-behavior, otherwise null. Present on reads and on set_parent_occurrence_status (contract 1.7.0)."
     },
     "parent_title": {
      "type": [
       "string",
       "null"
      ],
      "description": "Parent Behavior title when the Occurrence belongs to a sub-behavior, otherwise null."
     },
     "updated_at": {
      "type": "string",
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "revision": {
      "type": "string",
      "description": "Opaque version token of this record. Send it back as `expected_revision` to avoid overwriting a newer change.",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9._:-]+$"
     },
     "alongside": {
      "type": [
       "boolean",
       "null"
      ],
      "description": "The Behavior's alongside setting. Present only in the alongside contract edition."
     },
     "connector_completion": {
      "description": "Server-computed. Null when the person set the status, or when the Occurrence is not Completed.",
      "anyOf": [
       {
        "type": "object",
        "properties": {
         "source": {
          "type": "string",
          "description": "Stable id of the connected service, for example `hevy`."
         },
         "source_label": {
          "type": "string",
          "description": "Display name of the connected service, for example `Hevy`."
         }
        },
        "required": [
         "source",
         "source_label"
        ],
        "additionalProperties": false
       },
       {
        "type": "null"
       }
      ]
     }
    },
    "required": [
     "id",
     "behavior_id",
     "behavior_title",
     "category_name",
     "local_date",
     "timezone",
     "scheduled_for",
     "effective_start_at",
     "move",
     "schedule",
     "status",
     "status_label",
     "needs_decision",
     "origin",
     "added_by",
     "completed_at",
     "status_marked_at",
     "note",
     "updated_at",
     "revision",
     "connector_completion"
    ],
    "additionalProperties": false
   }
  },
  "parent_groups": {
   "type": "array",
   "description": "The day's parent Behavior slots. Their Occurrences also appear in `occurrences`.",
   "items": {
    "type": "object",
    "description": "A parent Behavior's slot: its sub-behaviors' Occurrences at one time on one day, with a derived rollup.",
    "properties": {
     "parent_behavior_id": {
      "type": "string",
      "format": "uuid"
     },
     "title": {
      "type": "string",
      "description": "Parent Behavior title."
     },
     "local_date": {
      "type": "string",
      "description": "Calendar date (YYYY-MM-DD) in the account timezone.",
      "format": "date",
      "examples": [
       "2026-10-18"
      ]
     },
     "slot_key": {
      "type": "string",
      "description": "Start of the slot: the earliest effective start among its Occurrences. Send it to set_parent_occurrence_status.",
      "format": "date-time",
      "pattern": "[Zz]$"
     },
     "scheduled_time_label": {
      "type": "string",
      "description": "Display time, for example `7:30 AM` or `Morning`."
     },
     "derived_status": {
      "type": "string",
      "enum": [
       "unresolved",
       "completed",
       "not_completed",
       "partial"
      ],
      "description": "Derived and never stored: the shared status when every Occurrence has it, otherwise partial."
     },
     "progress_label": {
      "type": "string",
      "description": "Completed over scheduled, for example `2/3`."
     },
     "completed_count": {
      "type": "integer",
      "minimum": 0
     },
     "not_completed_count": {
      "type": "integer",
      "minimum": 0
     },
     "unresolved_count": {
      "type": "integer",
      "minimum": 0
     },
     "total_count": {
      "type": "integer",
      "minimum": 1
     },
     "needs_decision": {
      "type": "boolean",
      "description": "Derived: true when an Occurrence in the slot is Unresolved and before today."
     },
     "occurrence_ids": {
      "type": "array",
      "description": "The sub-behavior Occurrences in this slot, in sub-behavior order.",
      "items": {
       "type": "string",
       "format": "uuid"
      },
      "minItems": 1
     }
    },
    "required": [
     "parent_behavior_id",
     "title",
     "local_date",
     "slot_key",
     "scheduled_time_label",
     "derived_status",
     "progress_label",
     "completed_count",
     "not_completed_count",
     "unresolved_count",
     "total_count",
     "needs_decision",
     "occurrence_ids"
    ],
    "additionalProperties": false
   }
  },
  "needs_decision": {
   "type": "object",
   "properties": {
    "count": {
     "type": "integer",
     "description": "Unresolved Occurrences before today, within the lookback window. A count only.",
     "minimum": 0
    },
    "truncated": {
     "type": "boolean",
     "description": "True when more exist than the count states."
    }
   },
   "required": [
    "count",
    "truncated"
   ],
   "additionalProperties": false
  },
  "freshness": {
   "type": "object",
   "properties": {
    "as_of": {
     "type": "string",
     "description": "When Cadence read this data.",
     "format": "date-time",
     "pattern": "[Zz]$"
    },
    "occurrences_generated_through": {
     "type": [
      "string",
      "null"
     ],
     "format": "date",
     "examples": [
      "2026-10-18"
     ],
     "description": "Last local date for which Occurrences exist. Later dates have none yet."
    }
   },
   "required": [
    "as_of",
    "occurrences_generated_through"
   ],
   "additionalProperties": false
  }
 },
 "required": [
  "local_date",
  "is_today",
  "timezone",
  "today_local_date",
  "day_note",
  "occurrences",
  "parent_groups",
  "needs_decision",
  "freshness"
 ],
 "additionalProperties": false
}
```

</details>

### View resource

| Field | Value |
|---|---|
| URI | `ui://cadence/day/v1.html`. A breaking view change gets a new URI. |
| `mimeType` | `text/html;profile=mcp-app` |
| `_meta.ui` | `{ "prefersBorder": true, "csp": { "connectDomains": [], "resourceDomains": [] } }`, on the list descriptor and on the read content |
| `_meta.ui.domain` | Not set |
| `resources/list` | Descriptor only: `uri`, `name: "cadence-day"`, `title: "Cadence day"`, `description`, `mimeType`, `_meta` |
| `resources/read` | The exact URI only. One `contents` entry with `text`. Needs `cadence.read`. Counts as one read against the per-grant limit. |
| Server capabilities | `resources: {}` and `extensions: { "io.modelcontextprotocol/ui": {} }` |

### View contract

Messages the view uses (MCP Apps spec 2026-01-26, JSON-RPC over `postMessage`):

| Direction | Message | Use |
|---|---|---|
| View to host | `ui/initialize`, then `ui/notifications/initialized` | Handshake, through `App.connect()` |
| Host to view | `ui/notifications/tool-result` | The `show_day` result, with `structuredContent` and `_meta`. Set the handler before connecting. |
| View to host | `tools/call` through `app.callServerTool` | `show_day`, `set_occurrence_status`, `set_parent_occurrence_status`, `update_occurrence_note`. Nothing else. |
| View to host | `ui/update-model-context` | One text line after a successful write |
| View to host | `ui/notifications/size-changed` | Automatic sizing |

The view sends no `ui/message`, opens no link and makes no network request.

Writes:

| Action | Tool | Arguments | Precondition |
|---|---|---|---|
| Mark an Occurrence | `set_occurrence_status` | `occurrence_id`, `status` | `expected_status`: the displayed status |
| Mark a parent slot | `set_parent_occurrence_status` | `parent_behavior_id`, `status`, `occurrence_ids` from the displayed group | `expected_statuses`: one `{ occurrence_id, status }` per displayed child |
| Save a note | `update_occurrence_note` | `occurrence_id`, `note` | `expected_revision`: the displayed Occurrence's `revision` |

- Every write carries an `idempotency_key`. The view makes a new key per action and
  reuses it only to retry the same tool with the same arguments.
- Clicking the status an Occurrence already has sets it to `unresolved`.
- After a successful write the view calls `show_day` again with the displayed `date`.
- After a successful write it sends one `ui/update-model-context` text line that names
  the Behavior and the new status, or says a note was saved. Never note text.
- `conflict`: re-read the day and tell the person to check and try again. Never resend
  the write without a new click.
- `rate_limited`: show the wait from `retry_after_seconds` and keep the key.
- Scopes: read `com.cadence-me/granted_scopes` from the result `_meta`. Without
  `cadence.occurrences.write`, show "Reconnect to allow changes" in place of the write
  controls. If a host passes no `_meta`, show the controls and rely on the error.
- `insufficient_scope` as a tool error: switch to the reconnect state.
- A rejected `callServerTool`: re-read `show_day` and apply its scopes. An SDK-built host
  rejects on the 403 instead of returning the tool error, and a denied approval may
  arrive the same way.
- Top-level rows are the parent groups plus each Occurrence whose id is in no group's
  `occurrence_ids`. Order them by `slot_key` and `effective_start_at`, groups first on a
  tie. A child renders once, inside its group. The view derives nothing else.

## Periods

Decided: the first day view does not show Periods (D35, Tickets 367–374; Ticket 370,
which adds Periods to the contract, has not started). `show_day` is its own projection,
so it ignores the `periods` field that Ticket 370 adds to each `get_timeline` day, and
its output schema has no such field. Ticket 382 (later views) can add it.

## What Tickets 376 and 377 should do differently from the plan

1. **Use Preact, not React.** Section 3.3 names React 19. See "Bundle size".
2. **Do not log the method name as the operation.** The activity table accepts only
   `^[a-z][a-z0-9_]{0,63}$`, so `resources/read` is refused. The spike used
   `read_view_resource` and `list_view_resources`. Test that the activity row is written;
   the spike did not.
3. **Teach the protocol suite about the flag.** With the flag on, Tier 0 passed 114 of
   115 checks. `tools-list-equals-registry` failed with `count=27`, because `show_day` is
   outside the registry.
4. **Handle a rejected write as a possible missing scope.** The plan assumes the view
   sees `insufficient_scope`. An SDK-built host throws instead.
5. **Decide `resources/templates/list`.** Inspector calls it. The spike left it
   unimplemented (`-32601`).
6. **Budget the evidence read.** `show_day` adds the two source-evidence reads the web
   Timeline makes, on top of the Timeline read. The reader is gated by
   `CADENCE_CONNECTOR_COMPLETION=on`; with it off the field is always null. Ticket 376
   should move `readTimelineSourceEvidence` out of `lib/services/timeline.service.ts`,
   where the spike only exported it.
7. **Handle more than 100 Needs decision items.** `get_timeline` fails with
   `limit_exceeded` there. The spike retries without the group and reports
   `{ count: 100, truncated: true }`.
8. **Add the server tests the spike skipped:** the rate limit on resource reads, the
   byte cap, and the Chat exclusion.
9. **Check sizing after a re-render.** In `basic-host` the frame clipped the last row
   after the list grew.
10. **Plan acceptance on a tunnel or a configured Preview.** Preview is not usable today.
    See "Reaching a flag-on server from a real host".

## Remaining steps for Ticket 375

1. The owner completes the four preflight steps above.
2. The owner chooses how a real host reaches a flag-on server: install a tunnel tool so
   an agent can expose the local stack, or configure the Preview environment.
3. An agent connects Claude web and ChatGPT web, then records: whether a view-initiated
   write raises an approval prompt; what each host does with the 403 on a read-only
   consent; and how each host caches the view HTML.
4. The agent adds those answers here and marks Ticket 375 complete.

## Cleanup

- Local stack `cadence-accept-375`: removed. Its checks reported active grants (10 of 10,
  then 1 of 7) before each removal, because the drivers revoked tokens and not grants.
  The stack and its database are deleted.
- No production call, no hosted Supabase change, no Vercel change.
