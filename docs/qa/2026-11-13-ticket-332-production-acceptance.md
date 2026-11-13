# Ticket 332: production acceptance of email sign-in

Run November 13, 2026, 17:36–19:01Z, by the Task 10 agent. Run folder (git-ignored):
`.intent/acceptance/v332-enable/` in the worktree `.claude/worktrees/sign-in-332-enable`
(`evidence.jsonl`, `rechecks.jsonl`, `auth-*.json`, `dns-*.json`, `accept.mjs`). No code,
link, token hash, cookie or key was printed or recorded. One exception, noted under
"Incidents".

**Result: every email row passed on production Supabase.** The first run (below) left
`CADENCE_SIGN_IN_EMAIL` off, because bot protection was not on (owner row 13) and the
production SMTP key was from the wrong Sequenzy company (owner rows 11 and 12). **After the
owner answered those rows, the go-live run (21:13–21:40Z) passed with Turnstile on, and
`CADENCE_SIGN_IN_EMAIL` is `on` in Production since 21:35Z.** See "Go-live run" at the end.

## Setup

- **Where the app ran.** Preview deployments have no Supabase variables in this project
  (`vercel env ls`: every Supabase variable is Production only), so a Preview cannot point
  at production Supabase without copying production secrets. Instead the agent made an
  unaliased production-target deployment from this branch:
  `vercel deploy --prod --skip-domain --env CADENCE_SIGN_IN_EMAIL=on --build-env CADENCE_SIGN_IN_EMAIL=on`
  (`dpl_FrXp3bfoaPa4xNL7aM58EZyBDWKA`, `cadence-mhqx5on2y-emis-projects-4c886aeb.vercel.app`).
  It has the production variables and production Supabase. The flag applies to that
  deployment only: no project variable changed, and `app.cadence-me.com` kept serving the
  current production deployment with the flag off. Vercel Authentication protects the
  URL; the agent opened it with a temporary share bypass
  (`PATCH /aliases/<deployment>/protection-bypass`, as `scripts/prepare-public-trust-input.mjs`
  does), never stored in the repo.
- **Redirects.** No allow-list entry was needed. The email link always opens the Site URL
  (`https://app.cadence-me.com/login/confirm?token_hash=…`), where the flag is off. For the
  link rows the agent opened the same path and query on the test deployment, which runs
  the same code.
- **Browsers.** Google Chrome (headless, Playwright `channel: chrome`). "Another browser"
  is a separate Chrome process with no shared state. Real browsers send `Origin` and
  `Sec-Fetch-Site`, so the cross-site check ran as it does for people.
- **Inbox.** AgentMail inbox `cadence-332-main@agentmail.to` (plus-addresses route to it).
  AgentMail allows three inboxes on this account; the other two already exist.
- **SMTP during the run.** See "Hosted SMTP during the run" below.

## Rows

| Row | Result | Evidence (`evidence.jsonl` row) |
|---|---|---|
| A new address creates an account (`+new`) | **Passed.** Code step, then `/timeline`; session API 200 for a new user ID | `request-new-address`, `code-signs-in-new-account` |
| A link opened in another browser signs in (`+link`) | **Passed.** Requested in browser 1; link opened in a separate Chrome process; `/timeline`, session 200 | `link-other-browser-signs-in` |
| The 6-digit code signs in | **Passed** (email carried 6 digits; `+new`) | `mail-received`, `code-signs-in-new-account` |
| Wrong code refused | **Passed.** `error=code_rejected`, the code step stays, "That code did not work…" | `wrong-code-refused` |
| Used code refused | **Passed.** Second browser with the same pending cookie: `code_rejected`, session 401 | `used-code-refused` |
| Used link refused | **Passed.** Third browser: session 401 | `used-link-refused` |
| Expired code refused (over 60 min) | **Passed** at 64 min (see "Expiry rows") | `expired-code-refused` |
| Expired link refused (over 60 min) | **Passed** at 64 min | `expired-link-refused` |
| Resend limit | **Passed.** "Send a new email" at once: `error=email_rate_limited`, "Cadence sent an email to this address a moment ago. Wait a minute, then send another." | `resend-limit` |
| An address that already has a Google account reaches the same account | **Passed** with test account A's own address. AgentMail cannot receive mail for a Gmail address, so the agent read the email in A's Gmail in the Cadence QA Chrome profile. The code signed in to user `caefd1b8-…` = A's ID | `google-address-same-account` |
| SPF, DKIM and DMARC pass in the received headers | **Passed.** `Authentication-Results: … spf=pass … envelope-from=…@rp2.cadence-me.com; dkim=pass header.i=@cadence-me.com; dmarc=pass header.from=cadence-me.com`; `DKIM-Signature: … s=sq1; d=cadence-me.com` | `mail-received` (headers) |
| MCP consent works for an email-only account | **Passed.** The `+new` session on `app.cadence-me.com`; DCR client; consent page showed that address; Allow; token for that user; `get_account_context` 200 with three scopes. Grant revoked after | `mcp-consent-email-only`, `mcp-grant-revoked` |
| Account deletion works for an email-only account | **Passed** for `+new` and `+link`. Settings showed the address as the confirmation text; after Delete, session 401 and Auth `GET /user` with the old token 403 | `account-deletion-new`, `account-deletion-link` |
| Test login (local, new link-token path) | **Passed.** Real Chrome against `next dev` on the local stack: `/auth/test-login?next=/behaviors` → `/behaviors`, session 200 | `local-test-login-link-token` |

Rechecks after every hosted change (`rechecks.jsonl`): kept sessions A and B refreshed, and
a fresh Google sign-in to `app.cadence-me.com` as A (cookie cleared first) returned to the
app as A's user ID. All passed.

## Expiry rows

Address `+expiry2`; email received 17:55:40Z; checked 18:59Z (64 minutes).

1. The browser that requested it, reopened at `/login/email?sent=1`, no longer shows the
   code step: the one-hour pending cookie has expired, so a person sees the address step.
   (`expired-pending-cookie-gone`)
2. With that cookie rebuilt (it is plain base64url JSON of the address and return path),
   the expired code reached Auth and was refused: `error=code_rejected`, session 401.
   (`expired-code-refused`)
3. The expired link, in a fresh browser: the Sign in button left the person signed out
   (session 401). (`expired-link-refused`)

The first `+expiry` email (the "Habit Tracker" one) carried no code, so it was not used
for these rows.

## Hosted SMTP during the run

1. 17:44Z: SMTP set with the vault key `sequenzy-supabase-smtp-key` (sender
   `login@cadence-me.com`, "Cadence"). The first email (17:50Z, `+expiry`) arrived from
   `Habit Tracker <hello@habittracker.sequenzymail1.com>`, subject "Confirm your signup",
   with Sequenzy's own Supabase template: no code, a click-tracked link, and
   `Reply-To: Emi Bache Rodriguez <emibache@gmail.com>`. The vault key belongs to the
   Sequenzy company "Habit Tracker", which does not hold `cadence-me.com`. Hosted templates
   were unchanged (read back equal to `supabase/templates/sign-in.html`).
2. 17:54Z: SMTP set back to off.
3. A direct SMTP test send (17:54Z) through the company that holds `cadence-me.com`
   ("Identity Scaffolding", the repo's reminder key) arrived intact from
   `Cadence <login@cadence-me.com>`, with the code and SPF, DKIM and DMARC passing.
4. 17:55Z: SMTP set with that company key for the acceptance window only, then set back to
   off after the run (see the hosted change list).

Observed on every email from `login@cadence-me.com` (owner row 12):

- `Reply-To: Emi Bache Rodriguez <emibache@gmail.com>` (the company's sender default).
- The HTML link goes through `sequenzylink3.com/track/click/…?url=<the sign-in link>`; the
  plain-text part has the direct link.
- A "Sent with Sequenzy" footer (free plan).

## Incidents

- The first request for A's address (17:56Z) was accepted by Auth but never reached A's
  Gmail (searched `in:anywhere` at 17:59 and 18:00Z). The second (18:00Z) arrived in about
  25 s. Cause not found; hosted Auth logs were not readable (the Management API logs
  endpoint returned 410).
- While diagnosing the "Habit Tracker" email, the agent printed that email's text with
  digits masked; about 40 hex characters of its token hash were left in the agent's
  transcript. That token belonged to the throwaway `+expiry` address, expired after one
  hour, and the account was deleted.

## Test accounts

Created on production and deleted through Settings in the run, each confirmed by session
401 and Auth `GET /user` 403 with the old token: `cadence-332-main+new@agentmail.to`
(`d2e1bfbe-…`), `+link` (`821ce157-…`), `+expiry` (`6166ec82-…`), `+expiry2`
(`e4bf92bc-…`). Test account A was signed in, not changed. The AgentMail inbox
`cadence-332-main@agentmail.to` is kept for the verifier; delete it after review.

Supabase sent 8 emails in the run (one with the wrong key, seven in the window). The test
deployment was removed at 19:00Z (`vercel remove`), which also ends its share bypass.

## Go-live run (November 13, 2026, 21:13–21:40Z)

Run by the go-live agent after owner rows 11–13 were answered (21:11Z). Run folder
(git-ignored): `.intent/acceptance/t332-live/` in the Intent workspace worktree
(`evidence.jsonl`, `rechecks.jsonl`, `accept.mjs`, screenshots in `shots/`). Hosted changes
and their before and after values: `docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`,
"Applied, go-live". No code, link, token hash, cookie, key or bypass value was printed or
recorded.

**Setup.** Hosted SMTP with the new Identity Scaffolding key, CAPTCHA (Turnstile) on, email
rate limit 30. An unaliased production-target deployment of `origin/main` `5a9d4e16` with
`CADENCE_SIGN_IN_EMAIL=on` for that deployment only (`dpl_7gt5c7a64n8NCo9wtxUjnDggv8eV`,
`cadence-75492nx23-…vercel.app`), opened with a new Vercel share pass. For the run its
callback (`/auth/callback**`) was on the redirect allow list and its host on the Turnstile
widget; both were removed and the deployment was deleted at 21:34Z. Browser: real Google
Chrome in the agent's own profile (not the shared QA profile), attached over CDP; each
"browser" below is a separate browser context with no shared cookies. Inbox: AgentMail
`cadence-332-main@agentmail.to` with plus-addresses.

| Row | Result |
|---|---|
| The Turnstile widget renders and passes | **Passed.** Every request form got a `cf-turnstile-response` token (Managed mode, no interaction) |
| A request without a token is refused by Supabase | **Passed.** Direct `/auth/v1/otp` with no token: 400 `captcha_failed` ("no captcha_token found"); with a made-up token: 400 `captcha_failed` (`invalid-input-response`, so Supabase checks with Cloudflare using a valid secret). Cadence's form posted with the token field removed: `error=email_check_failed`, "The check that you are a person did not finish. Try again.", no email |
| A new address creates an account (`+new`) | **Passed.** Request with token → code step; email from `Cadence <login@cadence-me.com>`, "Sign in to Cadence", 6 digits, link direct, Reply-To `Cadence <login@cadence-me.com>`, SPF/DKIM/DMARC pass; the code → `/timeline`, session 200, providers `email` |
| The 6-digit code signs in | **Passed** (`+new`) |
| Used code refused | **Passed.** A second browser holding the same pending cookie: `code_rejected`, session 401 |
| Wrong code refused | **Passed** (`+wrong`): `code_rejected`, "That code did not work…", session 401 |
| A link opened in another browser signs in (`+link`) | **Passed.** Requested in browser 4; the link's path and query opened in browser 5: Sign in → `/timeline`, session 200 |
| Used link refused | **Passed.** Browser 6: `error=link_rejected`, session 401 |
| `/login/email/mac` for the Mac flow (page and POST only) | **Passed** (`+mac`): with the address in the fragment, the Turnstile check passed, the page posted to `/auth/email/mac` and showed "Cadence sent a 6-digit code… Type it in Cadence for Mac." with a link back to `cadence://`; the email arrived with a code. No Mac build used |
| Test accounts deleted | **Passed.** `+new`, `+wrong`, `+link`, `+mac` (and `+smtp1` from the SMTP check) deleted with the admin API; none left; `+new`'s old session cookie then got 401 |

**Production with the flag on** (`app.cadence-me.com`, after the 21:35Z redeploy):

| Row | Result |
|---|---|
| `/login` at 390 px and 1280 px | **Passed.** Continue with Google and Continue with email present, no horizontal overflow; the email page shows the Turnstile check ("Success!") at both widths (`shots/prod-login-390.png`, `shots/prod-email-390.png`). From 21:36Z Continue with Apple also shows: the Apple go-live agent turned `CADENCE_SIGN_IN_APPLE` and `CADENCE_SIGN_IN_LINKING` on and redeployed; this run did not touch those flags |
| One real email sign-in on production (`+prod1`) | **Passed.** Request with token, email as above, code → `/timeline`, session 200. Account deleted; its session then 401 |
| Kept sessions A and B, Google sign-in as A | **Passed** (21:39Z) |

Supabase sent 7 sign-in emails in this run (`+smtp1`, `+new` twice because the driver lost the first pending cookie, `+wrong`, `+link`, `+mac`, `+prod1`), and Sequenzy one test reminder.

