# Ticket 299 integration review

PR #243 remains hidden behind `VITE_CADENCE_CHATGPT_PLAN`. This review preserves the
owner's November 12 pause after Ticket 299 and deferred Ticket 300 acceptance.
The hosted device-model flag must remain unset. Its live value was not verified here.

## Source and implementation plan

The candidate builds on reviewed PR #241 (`7944a7a7`) and includes main's owner
decision (`c720a77c`). It retains PR #243's concurrent device-only availability fix
from `9cb781db` and the documentation merge in `5d275548`.

| Defect | Implemented fix | Regression evidence |
|---|---|---|
| Vite could enable a signed build through `.env.production` or `.env.local` even when process environment validation passed. | Release and preview builds set an explicit empty feature value. Development builds retain explicit enablement. | `desktop-release.test.ts` runs Vite's real `loadEnv` against both file names. |
| Native token handoff checked plan scope before acquiring the refresh lock. A refresh could narrow that scope. | Check scope under the session lock before handoff and after refresh. Save the rotated refresh token before rejecting a narrowed grant. | New Rust regression checks denial, persisted rotation and no second refresh. Native CI must run it. |
| Native status could outlive the request deadline. Cancellation or transport failure after complete left a pending lease behind. | Bound status, model work and preferences. Stop cancelled work before further requests. Release every failed prepared attempt with a separate deadline. | `desktop-chatgpt-plan.test.ts` covers stalled status, late replies, expired envelopes, unresponsive model calls, completion failure and cancellation. |
| A failed Keychain cleanup could still disconnect Cadence. Cancelling the first account link omitted ChatGPT cleanup. | Require successful native cleanup before either account transition. A returned provider-revocation warning still permits teardown after local tokens are gone. | `desktop-auth.test.tsx` checks ordering, storage failures and the normal revocation-failure outcome. |
| Stale controls could start ChatGPT sign-in during account teardown or reuse a late account response. | Share a synchronous account scope across every entry point. Guard operations before and after awaiting native work. | `desktop-chatgpt-connection.test.ts` checks stale controls, transitions and late results. |
| Connection changes could leave ready output or in-flight work visible, and Settings could show stale status. | Emit shared lifecycle events, cancel and discard the remembered attempt, reload status and fence reconnect callbacks. | Connection and Settings/launcher DOM regressions cover observer errors, navigation, cancellation, invalidation and account changes. |
| Hosted availability could hide controls when only device mode was available. | Normalize UI availability for a usable plan while retaining raw server settings for route selection. | Plan tests cover device-only mode, flag-off behavior and strict no hosted fallback. |

The candidate retains PR #240's pending-only release RPC and replay protection.
The device service, release route, migration and device service tests remain unchanged
from reviewed PR #241. It also removes unrelated interaction-registry formatting churn.

## Local verification

The worktree used its own fresh `npm ci`. No dependency overlay was used.

| Check | Result |
|---|---|
| `agents:check`, `interactions:check`, `resolvers:check` | Passed. |
| Full lint | Passed with six existing warnings and no errors. |
| Root and desktop typechecks | Passed. The root check first caught fixture-only types; those were corrected. |
| Complete Vitest suite | 5,776 passed, 230 skipped and 29 failed in two unchanged Unix-socket suites. |
| Focused flow/release/adapter/service tests | 94 passed. |
| Focused auth/connection/Settings/launcher tests | 60 passed. |
| Plan and release fixture rerun after type corrections | 38 passed. |
| Web, desktop frontend and marketing builds | Passed. |
| Marketing checks | Passed with no diagnostics. |
| Public-source boundary, Public Trust checks and fixture collector | Passed. |
| `git diff --check` | Passed. |

The complete suite's failures are 21 session-broker tests and eight Docker-proxy
tests. Each fails because this executor rejects Unix-socket binding with `listen
EPERM`. The affected infrastructure files are unchanged. The earlier dependency
overlay failure in `daily-brief-consumer.test.ts` did not recur with fresh dependencies.

## Boundaries and remaining gates

- Default builds create no ChatGPT connection and render no plan controls. Signed
  release and preview environments pin the build flag off, including env-file cases.
- The native command remains registered in the main webview. It returns only a fresh
  access token for an existing plan grant. The build flag gates the UI and call path;
  it is not a native command permission boundary. Refresh tokens remain in Keychain.
- The ChatGPT access token reaches only the OpenAI request. It is absent from Cadence
  request bodies, durable client storage and logs. CSP adds the exact OpenAI API origin.
- A connected plan never falls back to Cadence's key when device mode is unavailable.
- Native CI must pass before merge. No Rust compiler is available in this executor.
- The design-system verifier is absent at its configured path. Chromium cannot start
  because `socket()` returns `EPERM`; no new bench screenshots or visual pass exist.
- Ticket 300 installed feature acceptance remains deferred. The L-019 logo gap and
  P-029 to P-031, P-045 and P-046 messaging review remain activation gates.

No live provider sign-in, feature activation, hosted migration or release ran during
this PR review.
