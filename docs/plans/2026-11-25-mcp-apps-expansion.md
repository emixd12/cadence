# MCP Apps expansion: plan (v3, audited)

Date: 2026-11-25. Audited against `origin/main` at `22aa4d85` (PR #403). The primary
checkout is far behind `origin/main`; read sources with `git show origin/main:<path>`.

Corrected November 26, 2026 by Ticket 375, against `origin/main` at `29e461fe`. The audit
base predates three merges: the Periods plan (D35, PR #408), PR #406 and the alongside
follow-ups (D37, PR #412). The corrections: contract edition numbers (sections 3.2 and
4), a Periods row (section 4), the tool count (section 1) and what gates the production
flag (sections 5 and 6). Spike results: `docs/qa/2026-11-26-mcp-apps-spike.md`.

Reviewed by two independent auditors: Astra 6.2 (`gpt-6.2-astra`, default effort, 7
findings) and Gemini 4 Neon (high, 7 findings). Section 10 lists each finding and the
decision taken.

Owner direction, 2026-11-25:

1. MCP Apps moves into scope. Update the scope documents, then build.
2. Every submission and listing step waits for the marketing site overhaul (P-048,
   Ticket 246): the Claude directory update and Verified listing, the ChatGPT plugin
   resubmission, Google's Connected Apps interest form and console, and public copy.
3. Preparation that publishes nothing proceeds now.
4. The build must support features from ongoing work.

Numbers allocated in the scope pull request, after a scan of `origin/main`, every remote
branch and every open pull request: decision D36; Tickets 375–382 (packages B to I, in
that order); messaging entries P-097 to P-101. No legal (`L-`) entry was needed.

## 1. Finding

One implementation can serve every major host. Claude, ChatGPT, Gemini, VS Code
Copilot, Microsoft 365 Copilot and Cursor are listed as rendering the same open
standard: MCP Apps (SEP-1865, spec `2026-01-26`, extension `io.modelcontextprotocol/ui`).
Cadence already has one remote MCP server, its own OAuth server, 26 annotated tools
with scoped writes, and Claude and ChatGPT plugins. The code change is one new tool, a
resource handler and one bundled HTML view. Per-host acceptance takes longer than the
code. Host support below is documented support, not tested behavior.

Tool count: the registry holds 26 tools at contract 1.7.0. Ticket 370 (Periods, contract
1.8.0) will add four: `list_periods`, `create_period`, `update_period` and `end_period`.
`show_day` is counted apart while it lives outside the registry.

## 2. What the documentation says (read 2026-11-25)

| Host | Renders MCP Apps | How a user gets Cadence | What Cadence lacks |
|---|---|---|---|
| Claude web, Desktop, mobile | Yes | Existing connector and plugin | A view. Listing needs 3–5 PNG screenshots, 1000px or wider, with paired prompts. Entry points need a Verified listing. Both deferred. |
| Claude Code | No | Existing plugin | Nothing. It keeps the text result. |
| ChatGPT | Yes. OpenAI says to build on MCP Apps and add `window.openai` only for extras. | Existing plugin | A view. Review checks the declared CSP against behavior. Resubmission deferred. |
| Codex | Tool workflows documented; iframe rendering not established | Existing plugin | Nothing assumed. Text result. |
| Gemini (consumer, Connected Apps Platform) | Yes, through `_meta.ui.resourceUri` | Console listing (deferred). Gemini Apps Developer Mode connects a deployed server as a custom MCP app without a listing. | See the OAuth note below. |
| Gemini Enterprise | Yes | An admin registers a Custom MCP Server data store | A client ID and secret, plus Cloud Run IAM in Google's guide. Not planned. |
| VS Code Copilot | Yes, announced January 26, 2026 | User adds the server URL | Acceptance. Cadence's redirect rules reject custom schemes such as `vscode://`; which redirect VS Code uses is not verified. |
| Microsoft 365 Copilot, Cursor, Goose, Postman | Yes, per the community-maintained MCP extension matrix | User adds the server URL | Not researched beyond the matrix. |

Gemini OAuth (Google's Connected Apps OAuth guide, read 2026-11-25). Google registers
through Dynamic Client Registration or a manually entered client ID and secret. PKCE is
mandatory for OAuth 2.1. Redirects go to `https://oauth-redirect*.googleusercontent.com`
under `/r/*` and `/a/*`. Cadence supports DCR and PKCE S256, so the DCR route may work
unchanged. Not verified: whether Google sends the RFC 8707 `resource` parameter, which
Cadence requires on authorization and token requests. If it does not, Gemini needs an
OAuth change, and that is an owner decision. Developer Mode is the test path that
publishes nothing.

Design facts:

- A tool links to a view with `_meta.ui.resourceUri`. The view is an HTML resource at a
  `ui://` URI, MIME type `text/html;profile=mcp-app`. The host reads it with
  `resources/read` and runs it in a sandboxed iframe.
- The view talks to the host by JSON-RPC over `postMessage`. It receives the tool
  result and can call server tools through the host under the user's existing grant.
- Hosts without MCP Apps ignore `_meta.ui` and use the text result.
- The default CSP blocks all network access.
- OpenAI recommends separate data tools and render tools, so the iframe does not
  remount on every read. It treats the resource URI as a cache key.
- `@modelcontextprotocol/ext-apps` (2.0.4 on npm) peers on the MCP SDK `^2.0.0` and
  `zod@^4.2.0`. It belongs only in the view package, not the Next.js root.

## 3. Design

### 3.1 First view: the day

"Cadence day" shows one date. It stays sparse inside a chat host:

- Today's Occurrences, each with Completed, Not Completed and Note.
- Needs decision as one line with its count ("4 earlier items need a decision"). It
  does not expand in the first view. A Needs decision view is a later ticket; until
  then the line asks the assistant, and the text tools still serve it.
- Parent Behavior slots collapsed to their derived progress. Each child renders once.
- One note editor open at a time, inline. No modal and no nested scroll.
- Touch targets of at least 44 points. Phone width first.

New read tool `show_day` (name tentative), scope `cadence.read`, optional `date`:

- A one-day adapter over the existing Timeline service
  (`lib/services/integration-read.service.ts`), with the same JSON as text for hosts
  that show no view.
- Its output is its own projection. It adds one server-computed field per Occurrence:
  whether a Completed status came from a connected service, and which one. The
  Timeline service already reads this evidence for the web app. `get_timeline` does not
  change.
- Granted scopes travel in the result's `_meta`, so the view can hide controls it
  cannot use and the model's context stays unchanged.
- `_meta.ui.resourceUri` is `ui://cadence/day/v1.html`. A breaking view change gets a
  new URI.

Writes from the view use existing tools through `app.callServerTool`:

| Action | Tool | Precondition sent |
|---|---|---|
| Mark an Occurrence | `set_occurrence_status` | `expected_status` from the displayed row |
| Mark a parent slot | `set_parent_occurrence_status` | `expected_statuses` from the displayed children |
| Save a note | `update_occurrence_note` | `expected_revision` from the displayed row |

- Every write carries an `idempotency_key`, reused only for an identical retry.
- On a conflict the view refreshes and asks again. Cadence keeps no previous note text,
  so a note save never overwrites silently.
- On 429 the view honors `Retry-After` and shows the rate-limit notice.
- After a successful write the view re-reads the day, so parent progress and Needs
  decision stay correct.
- When the grant lacks a write scope, the view shows "Reconnect to allow changes" in
  place of the controls. It does not rely on a host starting OAuth step-up from a view.
- After each write the view sends one `ui/update-model-context` line naming the
  Behavior and the new status. Note text is never sent there.
- The view computes nothing. Grouping, status rules and dates come from the resolvers.

### 3.2 Server

`lib/mcp/server.ts` uses the low-level `Server` and builds a fresh server for each
POST, so nothing learned at initialization survives to a later request.

1. Add `resources: {}` and the `io.modelcontextprotocol/ui` extension to capabilities.
   `tests/mcp-server.test.ts` asserts today that `resources` is undefined; it changes.
2. `resources/list` returns descriptors only. `resources/read` returns the HTML for an
   exact known URI, with `_meta.ui: { prefersBorder: true, csp: { connectDomains: [],
   resourceDomains: [] } }`. The explicit empty CSP gives reviewers something to audit.
3. Both resource methods need a valid grant with `cadence.read`, count against the
   per-grant read limit, log a fixed operation label, and have a byte cap. Today the
   rate limit and logging run only under `tools/call`.
4. `show_day` is always listed while the flag is on. No hiding by host capability:
   older protocol versions do not carry client capabilities on `tools/list`, and the
   text result already serves hosts without views.
5. Flag `CADENCE_MCP_APPS` (working name), off in production. Turning it off removes
   the tool and the resources. `tools/list` carries a five-minute private cache hint,
   so rollback tests cover a host holding a stale descriptor.
6. The `/mcp` origin allowlist stays as it is.

Contract edition: sequential, not independent. Both auditors rejected the independent
`apps` option from v2, and they are right: it would give two tool inventories one
version, and `version.ts` requires a minor bump for any new tool.

- During the trial, `show_day` lives in the MCP transport layer (`lib/mcp/`), outside
  the contract registry. Cadence Chat builds its tools from the registry, so it never
  sees `show_day`. No change to `editions.ts`.
- For general release, `show_day` joins the registry as the next minor version after
  the alongside edition folds in (Ticket 365). D35 gave 1.8.0 to Periods and moved the
  alongside edition to 1.9.0, so `show_day` takes the minor version after whichever
  number the alongside edition holds when it folds in. General release therefore follows
  Ticket 365.
- A test asserts that Chat neither lists nor executes `show_day`.

### 3.3 View build

- New workspace package (working name `packages/mcp-views`): Vite 8,
  `vite-plugin-singlefile`, React 19, `@modelcontextprotocol/ext-apps`.
- The build writes the single HTML file into a generated TypeScript string module that
  the Next.js route imports. A check rebuilds it and fails on any byte difference.
- Styling: host CSS variables with Cadence token fallbacks, using the surface-scoped
  token names now on main (PR #377). The host's light or dark theme wins.
- Text comes from the notices library.
- A `/design-system` bench page hosts the view against fixtures (404 in production).
- Tests run the shipped bundle in a sandboxed frame with no network allowlist, hostile
  note text and no external assets.

### 3.4 Rules

- User text renders as text, never HTML.
- No network requests, analytics or external assets from a view. No credentials reach
  the iframe.
- Calendar events, travel, leave times, Daily Brief text and location stay excluded
  from MCP, so they never appear in a view.
- A click on a status button is the user's confirmation, as on `/timeline`.

## 4. Ongoing work the build must support

Field facts verified by both auditors against `operations.ts` and `domain.ts`.
`get_timeline` carries `day_note`, `parent_groups`, `origin`, `added_by`,
`effective_start_at` and `move`. It carries no connector provenance, no tracked
sessions and no intended duration.

| Ongoing work | State | What the view and tool do |
|---|---|---|
| Alongside (D33, Tickets 356–365; PR #407 draft holds 362 and 363) | Flag off; a flag-selected contract edition, 1.8.0 in source today and 1.9.0 once Ticket 370 lands (D35) | Show "Alongside" only when `alongside` is `true`. Fixtures cover true, false, null and absent. Never show a guess. `show_day` reaches the registry after the alongside edition folds in. |
| Periods (D35, Tickets 367–374; PR #411 open holds 368) | In progress; Ticket 370, which adds Periods to the contract as 1.8.0, has not started | The first day view does not show Periods. `show_day` is its own projection and ignores the `periods` field that Ticket 370 adds to each `get_timeline` day. A later view can add it (Ticket 382). |
| Sub-behaviors (Ticket 349) | Shipped | Render `parent_groups` collapsed, each child once; children also appear in `occurrences`. Mark a parent with `set_parent_occurrence_status`. |
| Behaviors of Opportunity (contract 1.6.0) | Shipped | Label rows whose `origin` is `opportunity`. Add and remove from the view: later ticket. |
| Day notes (contract 1.1.0) | Shipped | Show `day_note`. Editing: later ticket. |
| Move for today | Shipped | Show a moved item at `effective_start_at`. No move controls in the first view. |
| Connector completion (D28) | Live | `show_day` adds the provenance field (section 3.1). The view labels such a completion and never presents it as the user's mark. The user can change it. |
| Tracked time and intended duration (D34, Ticket 366) | In source | Not shown in the first view. The Timeline output does not carry them, and per-row detail calls would spend the read limit. |
| Paused and Ended Behaviors (Ticket 342) | Shipped | Nothing; the server decides what a day contains. |
| Cadence Chat (`/chat`) | Live on web | Never sees `show_day` (section 3.2). |
| Plugin skills (`integrations/skills/`), Ticket 291 scenarios | Shipped | `daily-check-in` tells the model to call `get_timeline` and confirm before writing. Draft an unpublished skill update that names `show_day`, with skill-rule tests. Publishing it is listing work and is deferred. |
| Google Calendar MCP migration (PR #398 and PR #406 merged; deadline February 1, 2027) | In progress | Separate direction: Cadence as an MCP client. It takes priority when the two compete for acceptance time. PR #406 holds Ticket 245 video evidence that listing preparation can reuse. |
| Repository move to `cadence-me` (Ticket 350; PR #365 draft) | Waiting on owner | The MCP URL does not change. Plugin marketplace paths change; deferred listing work. |
| Consent returns 500 before hydration (finding in the Tickets 247–258 row of `STATUS.md`) | Open, no ticket | Gets its own ticket and is fixed before the flag goes on in production. |
| iOS plan | Docs only | Each ticket's "Future mobile" line notes that host mobile apps render the view. |
| Daily Brief on the ChatGPT plan, avatar, leave reminders | Various | Not applicable; none crosses the MCP contract. |

## 5. Work packages

Durations are estimates, not measurements. Re-estimate E after the first authenticated
write from a real host.

| # | Package | Content | Estimate |
|---|---|---|---|
| A | Scope | Decision record; `AGENTS.md`, `docs/FUTURE_UPDATES.md`, `docs/MCP_INTEGRATION.md` sections 1 and 3, `docs/PRODUCT_SPEC.md`; tickets with platform and messaging impact; `docs/MESSAGING_CHANGES.md` entries logged here, when the scope changes; `STATUS.md` row. Docs-only PR. | 0.5 day |
| B | Spike | Throwaway branch: resource handlers and a static view on the local stack; `ext-apps` `basic-host` and MCP Inspector; then Claude and ChatGPT as test account A on a preview. Answers section 7. Output: the frozen `show_day` schema and view contract. | 1–2 days |
| C | Server | `show_day` in the transport layer, provenance field, resource handlers with limits and logging, flag, protocol tests on both protocol paths, rollback and stale-descriptor tests, Chat exclusion test; `docs/MCP_CONTRACT.md`, `docs/AGENT_RESOLVERS.md`, `docs/ROUTE_MAP.md`. | 2–3 days |
| D | View | `packages/mcp-views`, day view, notices, bench page; impeccable and design-system-bench workflows; DOM tests for write, conflict, missing scope, rate limit, the Needs decision count and empty day; `interaction-registry.json`, `DESIGN.md`, `docs/UI_SPEC.md`, `npm run map:build`. | 3–4 days |
| E | Acceptance | `mcp-acceptance` suites on the local stack and a Vercel preview: Claude web and ChatGPT web in the QA Chrome profile. Cases: denied approval, expired grant, read-only consent, reconnect without replaying a pending write. Record host, client version, connection method and fallback for each run. Claude Desktop and mobile, VS Code Copilot and Gemini Developer Mode are required by owner decision and need new harnesses. | 5–7 days |
| F | Consent fix | Ticket for the consent 500 before hydration. | 0.5–1 day |
| G | Listing preparation, nothing published | Unpublished drafts in `docs/qa/mcp-directory-submission.md`, following that file's precedent: screenshot prompts, CSP statement, reviewer test cases, and corrections to stale Ticket 231 text (it still says Google-only sign-in). A script that captures listing screenshots from acceptance runs. The unpublished skill update. A checklist of deferred owner steps. No credentials or reviewer accounts in the repository. | 1–2 days |
| H | Host sign-in compatibility | Only if the spike shows a gap: an OAuth change for consumer Gemini (the `resource` parameter) and for VS Code's redirect, each with a security review and its own ticket. | Unknown until the spike |
| I | Later views | Needs decision view; weekly adherence review; Behavior preview and confirm; day-note edit, opportunity add and remove, move controls, tracked time. One ticket each. | Later |

Deferred until the marketing overhaul, each needing the owner's instruction: Claude
directory screenshots and resubmission; Verified listing and the Artifacts entry point;
ChatGPT plugin resubmission; Google interest form and console; publishing the skill
update; and `/developers` and marketing copy.

Privacy, Terms and Trust text is messaging-track work (entries P-097 to P-101, Tickets
245 and 246). It gates only outward actions: submissions, listings and public launch. It
does not gate the flag.

Order: A, then B. C and D run in parallel after B freezes the schema. F runs any time.
E follows C and D. G runs beside E.

## 6. Production rollout

Acceptance ends on a preview deployment. The production flag is not part of package E.
The server has no per-account allowlist, so turning the flag on in production shows
views to every user who has already connected Claude or ChatGPT. The owner's decision
gates that step: D36 holds the flag off until the marketing overhaul. It also needs the
consent fix (package F) and the contract fold after Ticket 365. Disclosure text does not
gate it.

## 7. Unknowns the spike answers

1. Does a view-initiated `tools/call` raise the host's approval prompt for write tools?
2. Does the SDK's stateless handler serve `resources/read` on the 2026-07-28 and legacy
   paths, with a fresh server per request?
3. What does a host do with a 403 step-up challenge on a view call?
4. Bundle size with React 19 inlined. If large, use Preact or plain DOM.
5. View caching per host, and how fast a new URI takes effect.
6. Which redirect URI VS Code uses, and whether it passes Cadence's rules.
7. Whether Gemini sends the `resource` parameter (Developer Mode, if included).
8. Whether a preview deployment can run the acceptance suites against test accounts.

## 8. Owner decisions (2026-11-25)

1. **Rollout:** the production flag waits for the marketing overhaul. Build and accept
   on preview now.
2. **Hosts that must pass before release:** Claude web, ChatGPT web, Claude Desktop and
   mobile, VS Code Copilot, and Gemini Developer Mode.
3. **Density:** today only. Needs decision is a count line, not a list.
4. **Gemini:** if consumer Gemini cannot connect as-is, adapt Cadence's OAuth server
   for it, with a security review. Gemini Enterprise stays out. This changes the D31
   and MCP security rules only as far as that ticket states; record it in
   `docs/DECISIONS.md`.

## 9. Risks

- Host behavior differs where the standard is silent: approval prompts, caching,
  display modes, step-up. The design stays on the common path and tests each host.
- General release depends on Ticket 365 folding alongside into the contract.
- Each view adds per-host acceptance cost.
- The spec has a draft in progress. Use only the nested `_meta.ui` form.
- Acceptance time competes with the Google Calendar MCP migration deadline.

## 10. Audit record

| Finding | Source | Decision |
|---|---|---|
| Write preconditions differ per tool; notes can be overwritten | Both | Accepted; section 3.1 table. |
| Production flag in acceptance is a release decision | Both | Accepted; section 6. |
| Independent `apps` edition gives one version two inventories | Both | Accepted; sequential. Neon's transport-layer option is used for the trial, Astra's "next minor after alongside" for release. |
| Fresh server per POST; capability hiding unreliable | Both | Accepted. Astra asked to test discovery; Neon asked to drop hiding. Decision: drop hiding. |
| Rate limit, logging and byte cap on resource methods | Neon | Accepted. |
| Timeline lacks provenance, tracked time, intended duration | Both | Accepted. Provenance field on `show_day`; tracked time deferred. Astra's neutral-label fallback is not needed, because `show_day` is a new projection. |
| Gemini OAuth guide is public; DCR or secret; `resource` unverified; Developer Mode | Neon | Accepted after reading the guide. Neon rated the gap critical; decision: an unknown for the spike, since DCR may work unchanged. |
| Scopes in `_meta`, explicit empty CSP, reconnect state | Neon | Accepted. |
| VS Code custom-scheme redirects are rejected | Neon | Accepted as an unknown; VS Code is not committed to package E. |
| Host support exceeds evidence; Codex | Astra | Accepted; section 2 wording. |
| Stale facts: PR #377 merged, PR #407, consent finding's source, `ext-apps` placement | Neon | Accepted. Neon cites `ext-apps` 2.1.0 on its main branch; the plan uses the npm release, 2.0.4. |
| Plugin skills do not mention `show_day` | Neon | Accepted; unpublished draft in package G. |
| `P-` entries belong in package A; consent fix needs a package; estimates | Neon | Accepted. |
| Sparse phone layout | Neon | Accepted; the owner chose the sparser "today only" form. |
| The public repository cannot hold an unpublished submission packet | Astra | Partly rejected. `docs/qa/mcp-directory-submission.md` already holds unpublished drafts in this repository. Credentials and reviewer accounts stay out. |
| Freeze the view contract before parallel work | Astra | Accepted; output of package B. |
