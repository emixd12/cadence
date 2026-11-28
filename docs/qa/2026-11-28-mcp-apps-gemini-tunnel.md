# MCP Apps: tunnel route and first Gemini run — November 28, 2026

Tickets 378 and 381. One run, by an agent, as test account A in the Cadence QA Chrome
profile. The server was a disposable local stack with `CADENCE_MCP_APPS=true`, reached
through a `cloudflared` quick tunnel. Production was not touched.

## Tunnel route

```bash
cloudflared tunnel --no-autoupdate --url https://127.0.0.1:<app-port> --no-tls-verify   # prints the public URL
node .claude/skills/mcp-acceptance/local-stack.mjs up --name cadence-accept-<x> --app-port <app-port> \
  --public-url https://<name>.trycloudflare.com --mcp-apps
```

- `--public-url` makes the tunnel origin the OAuth issuer and the MCP resource. Supabase stays
  on loopback.
- Test login still answers only on `127.0.0.1`. The run signed in there and copied that
  session cookie to the tunnel host in the same browser. Nobody else can create a session
  through the public URL.
- `tier0` and `tier1` need a loopback issuer and do not run against a public issuer.
- Checked through the tunnel with a scripted client: registration, consent, token exchange,
  `initialize`, `tools/list` (31 tools, `show_day` with its view URI), `show_day` and
  `resources/read` of `ui://cadence/day/v1.html` (271,216 characters,
  `text/html;profile=mcp-app`, empty CSP lists).

## Gemini (consumer web, Customize → Connectors → Custom)

| Step | Result |
|---|---|
| Custom connector offered to a free consumer account | Yes. No Developer Mode switch was needed. |
| Discovery and dynamic client registration | Pass. Gemini registered itself; the client name is "Google". |
| Redirect URI | `https://oauth-redirect.googleusercontent.com/r/<id>` |
| Authorization request | PKCE S256, all three tracking scopes, and the `resource` parameter. |
| `state` length | 1,170 characters. Cadence allowed 1,024 and answered `invalid_request`. **Defect, fixed in Ticket 381** (limit now 4,096, code and database). |
| Consent, token exchange, `initialize`, `tools/list` | Pass after the fix. Gemini listed 31 actions. |
| `show_day` from a chat prompt | Called, `success` in Cadence's activity record. |
| Day view | **Not rendered.** Gemini answered in text and never read the view resource. |

Not tested: writes from Gemini, refresh after token expiry (Google's guidance prefers a
refresh token that does not rotate), a second day's use, and Gemini on mobile.

## Other hosts

ChatGPT web, Claude web, Claude Desktop and mobile, and VS Code Copilot were not run. The
QA Chrome profile is signed out of ChatGPT and Claude, and those are the owner's accounts.

## Tooling fix

`scripts/acceptance/google-signin.mjs` stopped with `challenge-unsupported` for test
account B. Google offered a passkey first and Chrome's passkey dialog covered the page. The
script now adds an empty virtual authenticator, so the password and authenticator steps
are reachable. B signed in on the next run.

## Security review: OAuth `state` limit, 1,024 to 4,096 (Ticket 381)

- **What changes:** the longest `state` an authorization request may carry, in
  `lib/services/oauth/server.ts` (`OAUTH_STATE_MAX_LENGTH`) and in the check on
  `cadence_oauth_private.pending_authorizations.state`. Nothing else in the flow changes.
- **What `state` is:** an opaque value the client chooses. Cadence stores it for at most
  10 minutes and returns it unchanged, only to the client's registered redirect URI.
  Cadence never interprets it, logs it or shows it.
- **Abuse:** a larger value costs storage for 10 minutes per request. The request URL
  stays capped at 8,192 characters and control characters are still refused. The redirect
  target is unchanged, so a longer `state` gives no new place to send data.
- **Rules kept:** tokens stay opaque, hashed at rest, bound to the MCP URL and revocable.
  `resource` is still required and checked. PKCE S256 is still required. No D31 rule and
  no MCP security rule changes.
- **Existing clients:** Claude and ChatGPT send shorter values and are unaffected. No
  re-consent.
- **Order:** push the migration before the code deploys. Code first would turn a long
  `state` into `server_error` instead of `invalid_request`; shorter values work either way.
