# Ticket 295 — Daily Brief request on a ChatGPT plan (spike)

## State

**The live run passed on November 12, 2026 (UTC), on the owner's ChatGPT Pro account.**
Sign-in, plan usage, the catalog, refresh and revocation work. All four tested models ran
the Daily Brief through Cadence's validation: 31 of 32 briefs were valid, and the one
failure was a provider `server_is_overloaded`. No call took longer than 15 seconds.
The webview may call both endpoints. No secrets, prompts or model output are in this file.

Two earlier live runs that night found a spike bug, not a provider problem: the plan
route's streaming HTTP 200 carries no `Content-Type` header, and the script treated any
reply without `text/event-stream` as JSON. The script now reads every reply as SSE unless
its type says JSON, and the mock omits the header the same way. Both earlier runs still
proved sign-in, CORS, the catalog, the three rejected fields, refresh and revocation.

## What the spike proves

1. Sign in with ChatGPT works for Cadence as an open-source local app, following
   OpenAI's public docs for open-source apps
   (`developers.openai.com/siwc/token-sharing-open-source`). No DevKit code is used.
2. The ID token validates, and the grant includes `chatgpt.tokens.use.direct`.
3. The account's model catalog (`GET /v1/models`) lists which models.
4. Which Responses request fields the plan route accepts and rejects, with error codes.
5. The Daily Brief prompt on synthetic fixtures, per model: latency (median and
   maximum) and the share of outputs that pass Cadence's existing validation.
6. Whether a webview with `Origin: tauri://localhost` may call the token endpoint and
   `/v1/responses` (CORS), which decides webview or Rust transport for the Mac app.
7. Refresh works and rotates the refresh token; revocation returns 200.

## How the spike works

- Script: `scripts/chatgpt-plan-spike.ts`, mock: `scripts/chatgpt-plan-spike-mock.ts`,
  launcher: `scripts/run-chatgpt-plan-spike.mjs`, tests: `tests/chatgpt-plan-spike.test.ts`.
  Dev-only; not part of the Mac app or the web build.
- The launcher loads the TypeScript with Vite's module runner (`runnerImport`), so the
  repo's `@/` aliases resolve without a new dependency.
- Sign-in: a `urn:uuid` host ID and the issued client ID are kept in
  `~/.config/cadence-chatgpt-spike/host.json` (mode 0600, no tokens). The script listens
  on `http://127.0.0.1:1455/auth/callback` and opens the system browser at
  `https://auth.openai.com/api/accounts/authorize` with `client_id=dynamic_agent_client`,
  `agent_name_hint=Cadence`, the documented scopes, `resource=https://api.openai.com/v1`,
  PKCE S256, `state` and `nonce`.
- The ID token is checked with `node:crypto` against the JWKS from OpenID discovery:
  RS256 signature, issuer, audience equal to the issued client ID, nonce and expiry.
- The Daily Brief runs through the real pipeline (`generateDailyBrief`) on fixtures from
  `lib/services/briefing-fixtures.ts`. Only the generator changes: it wraps today's
  hosted adapter (`generateOpenAIDailyBrief`), rewrites the request it builds to the
  plan contract, sends it with the ChatGPT access token, and folds the event stream back
  into the body the adapter already parses. Validation is unchanged.
- Plan contract applied to every brief request: `store: false`, `stream: true`, `input`
  as an array, `max_output_tokens` and `background` removed, the model from the catalog.
  `text.format` (strict `json_schema`), `reasoning` and `tools`/`tool_choice` stay only
  if that model's probe accepted them.
- Field probes use a tiny synthetic prompt per model: baseline, strict `json_schema`,
  `reasoning.effort: low`, `tools: []` with `tool_choice: none`, `max_output_tokens`,
  `background: false`, `input` as a string, `stream: false`, and one baseline request
  sent with `Origin: tauri://localhost`.
- The run stops sending requests after `subscription_sharing_usage_limit_exceeded`,
  `subscription_sharing_user_not_eligible`, `subscription_sharing_invalid_user` or a
  `chatpass_v2_*` code. It does not retry them.
- Tokens, the authorization code and the PKCE verifier stay in memory. Every log line
  is scrubbed against them, and the run fails if the report contains one. The refresh
  token is revoked at the end, also after an error or Ctrl-C. Ctrl-C stops the current
  request at once; a second Ctrl-C only prints a reminder, so it cannot skip revocation.
- Before sign-in, the script stops unless discovery succeeds, names the issuer
  `https://auth.openai.com`, serves the JWKS from that origin and lists a revocation
  endpoint. A token is never issued that the run cannot revoke.

## Commands

Mock mode (no network, no sign-in):

```bash
node scripts/run-chatgpt-plan-spike.mjs --mock
npx vitest run tests/chatgpt-plan-spike.test.ts
```

Live run (owner signs in once):

```bash
node scripts/run-chatgpt-plan-spike.mjs --live
```

Defaults: up to 3 listed models in catalog order, plus `gpt-5.6-luna` if the catalog
lists it; 8 fixtures (`sparse`, `dense`, `hostile`, `overlap`, `tight_transition`,
`supported_gap`, `uneventful`, `travel_day`); 1 run each; a 120-second measurement
deadline per call. The report goes to `/tmp/cadence-chatgpt-plan-spike-<time>.json`
and `.md`; the Markdown holds the tables for this file.

## Mock-mode evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/chatgpt-plan-spike.test.ts --exclude '.claude/**'` | 28 passed (2026-11-08) |
| `node scripts/run-chatgpt-plan-spike.mjs --mock` | Exit 0; 16 of 16 briefs valid on 2 mock models; refresh rotated; revoke 200 |
| Node | Run on Node 26.12.0. Uses only APIs present in Node 24 (`fetch`, `AbortSignal.any`, JWK `createPublicKey`) |

The mock follows the rules in OpenAI's docs. It is not evidence of OpenAI's behavior.

## Results (live run)

The tables below are the run's `.md` report, unchanged except for the plan name.

Run: live, ChatGPT Pro, 2026-11-12T02:56:29.543Z, 326552 ms, spike 2026-11-07.1.

### Sign-in

| Check | Result |
| --- | --- |
| Registration | returning |
| Issued client ID returned (oaiapp_ form) | no (yes) |
| ID token valid (signature, issuer, audience, nonce, expiry) | yes |
| Token scopes | chatgpt.tokens.use.direct email offline_access openid profile resource.invoke |
| Callback scopes | chatgpt.tokens.use.direct email offline_access openid profile resource.invoke |
| chatgpt.tokens.use.direct granted | yes |
| Refresh token issued | yes |
| Access token lifetime (s) | 3599 |
| Discovery authorize / token match docs | yes / yes |
| Revocation endpoint | https://auth.openai.com/api/accounts/oauth/revoke |

### CORS preflight (Origin tauri://localhost)

| Target | Status | Allow-Origin | Allow-Methods | Allow-Headers | Webview can call |
| --- | --- | --- | --- | --- | --- |
| token_endpoint | 200 | * | DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT | content-type | yes |
| responses | 200 | * | DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT | authorization,content-type | yes |

### Model catalog

Status 200; model fields: additional_speed_tiers, allow_only_chatgpt_workspace_executor, allow_only_codex_cloud_agent_orchestrator, apply_patch_tool_type, auto_compact_token_limit, auto_review_model_override, availability_nux, available_access_programs, available_in_plans, base_instructions, comp_hash, context_window, default_reasoning_level, default_reasoning_summary, default_service_tier, default_verbosity, description, display_name, experimental_supported_tools, guardian, include_apps_usage_instructions, include_plugin_usage_instructions, include_skills_usage_instructions, input_modalities, max_context_window, minimal_client_version, model_messages, model_specialty, multi_agent_reasoning_effort, multi_agent_version, node_repl_auto_review_required, node_repl_disabled, prefer_websockets, priority, requires_sandboxed_review, service_tiers, shell_type, slug, support_verbosity, supported_in_api, supported_reasoning_levels, supports_experimental_context, supports_image_detail_original, supports_parallel_tool_calls, supports_reasoning_effort_updates, supports_reasoning_summaries, supports_reasoning_summary_parameter, supports_search_tool, tool_mode, truncation_policy, upgrade, use_responses_lite, visibility, web_search_tool_type; gpt-5.6-luna listed: yes.

| Slug | Display name | Visibility | Tested |
| --- | --- | --- | --- |
| gpt-6.1-sol | GPT-6.1-Sol | list | yes |
| gpt-6-astra | GPT-6-Astra | list | yes |
| gpt-6.1-terra | GPT-6.1 Terra | list | yes |
| gpt-6-sol | GPT-6-Sol | list | no |
| gpt-reserve | GPT-Reserve | hide | no |
| gpt-6-luna | GPT-6-Luna | list | no |
| gpt-5.6-sol | GPT-5.6-Sol | list | no |
| gpt-5.6-terra | GPT-5.6-Terra | list | no |
| gpt-5.6-luna | GPT-5.6-Luna | list | yes |
| codex-auto-review | Codex Auto Review | hide | no |

### Request fields

| Model | Probe | Expected | Accepted | HTTP | Error code | Param | ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | baseline | accept | yes | 200 | — | — | 2740 |
| gpt-6.1-sol | json_schema_strict | observe | yes | 200 | — | — | 2435 |
| gpt-6.1-sol | reasoning_low | observe | yes | 200 | — | — | 2396 |
| gpt-6.1-sol | tools_none | observe | yes | 200 | — | — | 2693 |
| gpt-6.1-sol | max_output_tokens | reject | yes | 200 | — | — | 4884 |
| gpt-6.1-sol | background_false | reject | no | 400 | — | — | 584 |
| gpt-6.1-sol | input_string | reject | no | 400 | — | — | 524 |
| gpt-6.1-sol | stream_false | reject | no | 400 | — | — | 485 |
| gpt-6.1-sol | cors_actual | observe | yes | 200 | — | — | 4401 |
| gpt-6-astra | baseline | accept | yes | 200 | — | — | 8863 |
| gpt-6-astra | json_schema_strict | observe | yes | 200 | — | — | 9512 |
| gpt-6-astra | reasoning_low | observe | yes | 200 | — | — | 5476 |
| gpt-6-astra | tools_none | observe | yes | 200 | — | — | 12773 |
| gpt-6-astra | max_output_tokens | reject | yes | 200 | — | — | 14296 |
| gpt-6-astra | background_false | reject | no | 400 | — | — | 640 |
| gpt-6-astra | input_string | reject | no | 400 | — | — | 554 |
| gpt-6-astra | stream_false | reject | no | 400 | — | — | 470 |
| gpt-6-astra | cors_actual | observe | yes | 200 | — | — | 9769 |
| gpt-6.1-terra | baseline | accept | yes | 200 | — | — | 1566 |
| gpt-6.1-terra | json_schema_strict | observe | yes | 200 | — | — | 2958 |
| gpt-6.1-terra | reasoning_low | observe | yes | 200 | — | — | 1883 |
| gpt-6.1-terra | tools_none | observe | yes | 200 | — | — | 1803 |
| gpt-6.1-terra | max_output_tokens | reject | yes | 200 | — | — | 3085 |
| gpt-6.1-terra | background_false | reject | no | 400 | — | — | 591 |
| gpt-6.1-terra | input_string | reject | no | 400 | — | — | 468 |
| gpt-6.1-terra | stream_false | reject | no | 400 | — | — | 520 |
| gpt-6.1-terra | cors_actual | observe | yes | 200 | — | — | 1632 |
| gpt-5.6-luna | baseline | accept | yes | 200 | — | — | 2448 |
| gpt-5.6-luna | json_schema_strict | observe | yes | 200 | — | — | 1478 |
| gpt-5.6-luna | reasoning_low | observe | yes | 200 | — | — | 1561 |
| gpt-5.6-luna | tools_none | observe | yes | 200 | — | — | 1828 |
| gpt-5.6-luna | max_output_tokens | reject | yes | 200 | — | — | 6487 |
| gpt-5.6-luna | background_false | reject | no | 400 | — | — | 526 |
| gpt-5.6-luna | input_string | reject | no | 400 | — | — | 574 |
| gpt-5.6-luna | stream_false | reject | no | 400 | — | — | 472 |
| gpt-5.6-luna | cors_actual | observe | yes | 200 | — | — | 1715 |

### Daily Brief per model

| Model | json_schema | reasoning | tools | Runs | Completed | Valid | Pass rate | Median ms | Max ms | Median first text ms | Over 30 s | Median input tokens | Median output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | yes | yes | yes | 8 | 8 | 8 | 1 | 4556 | 5951 | 3218 | 0 | 2394 | 69 |
| gpt-6-astra | yes | yes | yes | 8 | 7 | 7 | 0.875 | 11160 | 14304 | 9386 | 0 | 2392 | 91 |
| gpt-6.1-terra | yes | yes | yes | 8 | 8 | 8 | 1 | 2853 | 5376 | 1961 | 0 | 2394 | 60 |
| gpt-5.6-luna | yes | yes | yes | 8 | 8 | 8 | 1 | 7044 | 10809 | 5082 | 0 | 2394 | 300 |

### Daily Brief failures

| Model | Fixture | Run | Transport | HTTP | Error code | Validation code |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-6-astra | dense | 1 | failed | 200 | server_is_overloaded | advisor_unavailable |

### Refresh and revocation

| Step | Attempted | OK | HTTP | Detail |
| --- | --- | --- | --- | --- |
| Refresh | yes | yes | 200 | rotated yes, plan scope kept yes |
| Revoke refresh token | yes | yes | 200 | attempts 1 |

## Recommendations

The owner approved these on November 12, 2026, with the model order changed as shown.

| Decision | Recommendation | Evidence |
| --- | --- | --- |
| Request contract for Ticket 296 | `stream: true`, `store: false`, `input` as a message list, no `background`. Keep strict `json_schema`, `reasoning`, `tools: []` with `tool_choice: none`, and `max_output_tokens: 2000` from today's hosted body. Read the reply as SSE whatever its `Content-Type`, through `response.completed`, under the 64 KB cap. | All four models accepted the optional fields and `max_output_tokens`. `background`, a string `input` and `stream: false` return 400 with a message and no error code. Streaming 200s had no `Content-Type`. |
| Model selection rule | **Owner decision, November 12, 2026:** take the first model the catalog lists with visibility `list`, in this order: `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`. Never pick a `hide` model. With none listed, the plan cannot run a brief and there is no fallback (D27). `gpt-6-luna` was listed but not tested in this run. Brief quality per model was not reviewed. | `gpt-6.1-sol` and `gpt-6.1-terra` passed 8 of 8 (medians 4.6 s and 2.9 s). The agent had recommended `gpt-5.6-luna` first; the owner chose this order instead. |
| Attempt deadline on the plan route | Keep today's 30-second model budget inside the 60-second attempt. | The slowest brief took 14.3 s (`gpt-6-astra`); none passed 30 s. |
| Error mapping | Treat `response.failed` with `server_is_overloaded` as retry later. The usage-limit and eligibility codes from the docs were not seen and stay mapped from the docs. | One `gpt-6-astra` brief failed this way. |
| Mac transport: webview or Rust | CORS allows the webview (`Access-Control-Allow-Origin: *` on the token endpoint and `/v1/responses`). Ticket 297 still decides where tokens live. Doing token-endpoint calls in Rust keeps the refresh token out of the webview, as Keychain-only storage requires. | Preflight 200 for `tauri://localhost` on both; the actual `/v1/responses` request with that origin succeeded on all four models. |

## Notes for the live run

- The owner sees ChatGPT's sign-in and consent screens in the default browser, then a
  Cadence page on `127.0.0.1` that says the tab can close.
- The registered "Cadence" app stays in the owner's ChatGPT settings after the run.
  Revocation ends the session, not the registration. The owner can remove it there.
- Briefing fixtures are synthetic. OpenAI receives them with `store: false`.
