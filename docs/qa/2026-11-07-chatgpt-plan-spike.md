# Ticket 295 — Daily Brief request on a ChatGPT plan (spike)

## State

**Mock mode passes; the live run has not happened.** The live run waits for the owner to
sign in to ChatGPT with the owner's Pro account and approve consent once. The result
tables below are empty until then. No secrets, prompts or model output belong in this
file.

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

Paste the tables from the run's `.md` report here; the columns below match it.

Run: — (mode, start time, duration in ms, spike version; add the account plan)

### Sign-in

| Check | Result |
| --- | --- |
| Registration | |
| Issued client ID returned (oaiapp_ form) | |
| ID token valid (signature, issuer, audience, nonce, expiry) | |
| Token scopes | |
| Callback scopes | |
| chatgpt.tokens.use.direct granted | |
| Refresh token issued | |
| Access token lifetime (s) | |
| Discovery authorize / token match docs | |
| Revocation endpoint | |

### CORS preflight (Origin tauri://localhost)

| Target | Status | Allow-Origin | Allow-Methods | Allow-Headers | Webview can call |
| --- | --- | --- | --- | --- | --- |
| token_endpoint | | | | | |
| responses | | | | | |

The Allow-Origin on an actual `/v1/responses` request is the `cors_actual` probe in
"Request fields" (see the JSON report's `allowOrigin`).

### Model catalog

Status —; model fields: —; gpt-5.6-luna listed: —.

| Slug | Display name | Visibility | Tested |
| --- | --- | --- | --- |
| | | | |

### Request fields

| Model | Probe | Expected | Accepted | HTTP | Error code | Param | ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | baseline | accept | | | | | |
| | json_schema_strict | observe | | | | | |
| | reasoning_low | observe | | | | | |
| | tools_none | observe | | | | | |
| | max_output_tokens | reject | | | | | |
| | background_false | reject | | | | | |
| | input_string | reject | | | | | |
| | stream_false | reject | | | | | |
| | cors_actual | observe | | | | | |

### Daily Brief per model

| Model | json_schema | reasoning | tools | Runs | Completed | Valid | Pass rate | Median ms | Max ms | Median first text ms | Over 30 s | Median input tokens | Median output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | | | | |

"Over 30 s" counts calls longer than today's hosted model budget
(`lib/services/daily-brief.service.ts`, 30 seconds inside a 60-second attempt).

### Daily Brief failures

| Model | Fixture | Run | Transport | HTTP | Error code | Validation code |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

### Refresh and revocation

| Step | Attempted | OK | HTTP | Detail |
| --- | --- | --- | --- | --- |
| Refresh | | | | rotated —, plan scope kept — |
| Revoke refresh token | | | | attempts — |

### Stops and errors

The report adds this section only when the run stopped early or recorded an error.

## Recommendations (after the live run)

| Decision | Recommendation | Evidence |
| --- | --- | --- |
| Request contract for Ticket 296 | | |
| Model selection rule | | |
| Attempt deadline on the plan route | | |
| Mac transport: webview or Rust | | |

## Notes for the live run

- The owner sees ChatGPT's sign-in and consent screens in the default browser, then a
  Cadence page on `127.0.0.1` that says the tab can close.
- The registered "Cadence" app stays in the owner's ChatGPT settings after the run.
  Revocation ends the session, not the registration. The owner can remove it there.
- Briefing fixtures are synthetic. OpenAI receives them with `store: false`.
