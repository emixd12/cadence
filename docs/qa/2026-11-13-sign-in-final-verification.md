# Sign-in options: final production verification — November 13, 2026

Independent check of Tickets 331–337 (D31) after email, Apple and Settings sign-in methods
went live on production web. Run 22:00–22:20Z by an agent that did none of the work.
Read-only on production and hosted settings, except one throwaway email account that was
created and then deleted. Run files (git-ignored) stayed in the agent's private temp folder;
no secret, code, link token or cookie was printed or recorded.

## A. Production state, read back

| Item | Read back | Matches the docs |
| --- | --- | --- |
| Vercel Production | `CADENCE_SIGN_IN_EMAIL`, `CADENCE_SIGN_IN_APPLE`, `CADENCE_SIGN_IN_LINKING` = `on`; `APPLE_SIGN_IN_SERVICES_ID` = `app.cadence.web`; `APPLE_SIGN_IN_CLIENT_SECRET` and `CADENCE_TURNSTILE_SITE_KEY` set; no test-login variable | Yes |
| Hosted Auth | SMTP `smtp.sequenzy.com:587`, user `api`, sender `Cadence <login@cadence-me.com>`; code 6 digits, 3600 s; email rate 30/h, OTP 30, verify 30; CAPTCHA on, Turnstile; manual linking on; secure email change on; confirmation on; unverified sign-ins refused; Apple on with `app.cadence.web`; Google on; no Auth hooks; Site URL `https://app.cadence-me.com` | Yes |
| Redirect allow list | 47 entries, same count as before the track: production and `cadence-blush-three.vercel.app` callbacks, `cadence://` entries, and `localhost`/`127.0.0.1` entries (including `http://localhost:3000/**`). No test-deployment entry left | Yes; see C5 |
| Migrations | 123 on hosted, 123 in git, newest `20261113210000` on both | Yes |
| Auth triggers | `on_auth_user_created`, `on_auth_user_email_updated`, `refuse_auth_password` (invoker, `search_path=''`), `keep_one_auth_identity` (definer, `search_path=''`), all enabled; trigger functions revoked from `public`, `anon`, `authenticated` | Yes |
| Apple token functions | `apple_sign_in_keep_token`, `apple_sign_in_read_tokens`, `apple_sign_in_forget_token`: definer, `search_path=''`, execute for `service_role` only. Token table: RLS on, no grants beyond the owner, 0 rows | Yes |
| Users | 7: 3 Google-only, 4 `cadence-captu…@example.invalid` from July 1 (load-test captures with passwords). No AgentMail, `example.com` or relay user; no user without an identity; no user with two Google identities; no connected Calendar without its Google identity | Yes (July users predate the track) |
| Vercel deployments | Older and preview deployments sit behind Vercel SSO (302). No alias other than the Git branch aliases | Yes |
| Cloudflare | DKIM `sq1`/`sq2`, return path `rp`/`rp2`, DMARC `p=none`, root SPF for Sequenzy; **no MX**. Turnstile widget `cadence-turnstile-secret-key` (Managed): `cadence-me.com`, `cadence-blush-three.vercel.app`, `localhost`, `127.0.0.1` | Yes; localhost noted |
| Sequenzy | Default sender `Identity Scaffolding <hello@cadence-me.com>`; Reply-To `Cadence <login@cadence-me.com>`; click tracking off; open tracking on; footer kept; tracking domain `links.cadence-me.com` registered in Sequenzy, pending (no CNAME) | Partly: the 332 change record says the tracking CNAME was "not added", which is true for DNS only |

## B. Acceptance criteria

| Criterion | State | Evidence |
| --- | --- | --- |
| New account with email, no Google | Proven on production | This run, 22:10Z: new address, link, account `af5b30ef`, providers `email` |
| New account with Apple, no Google | Proven on production | `2026-11-13-ticket-333-production-acceptance.md` (owner's Apple Account, also Hide My Email). This run: Apple start reaches Apple with `app.cadence.web` |
| Link in another browser signs in; used or expired link or code does not | Proven on production (expired: earlier run) | This run: link in a second context signed in; used link → `link_rejected`; wrong code → `code_rejected`; used code → `otp_expired`. Expired values: `2026-11-13-ticket-332-production-acceptance.md` |
| A Google account adds Apple and email and reaches the same data by all three | Partly proven on production | Email half: this run, A's Google address signed in by code reached A (`caefd1b8`), A's identities unchanged. Apple half not proven: Add Apple reached Apple's page only (333 record); completing it needs the owner's Apple Account |
| An unconfirmed address cannot reach an existing account | Proven on production | Hosted: confirmation on, unverified sign-ins refused, secure email change on. This run: a change to an unreceivable address stays pending and the address is unchanged. Neutral refusal of an owned identity: 337 record |
| Google Calendar as decided for a no-Google account; no reconnect for existing ones | Proven on production | 337 third pass; this run: A's Calendar `connected` after sign-in; 0 connected Calendars without their Google identity |
| Mac: links by each method, syncs, refuses a second account | Proven locally only | `2026-11-13-ticket-336-mac-sign-in.md` (dev builds, local stack). 0.1.11 not published |
| MCP consent for an account without Google | Proven on production | This run: email-only account, existing test client, consent, token for that user, probe 200 with three scopes, revoke → 401, 0 grants |
| Account deletion for each kind | Proven on production | Email-only: this run, Settings → Delete account (asks for the address), user, profile, categories and grants gone. Apple-only: 333 record. Google with Calendar: 337 third pass |
| With every new flag off, production sign-in is unchanged | Proven on production before go-live | 335 and 336 production checks with flags off (STATUS). Not repeatable now without turning flags off |

Also re-run: `/login` at 390 px and 1280 px (Google, Apple, email and the one-account hint;
no overflow); Google sign-in as A to `/timeline`; kept sessions A and B; A's Sign-in
methods row reads "Google and email"; `/api/auth/sign-in-methods` lists all three with
code length 6; `/login/email/mac` 200; test login on production redirects with
`test_login_unavailable`.

## C. Security pass

Held:

- Cross-site posts to `/auth/sign-in/email`, `/auth/confirm`, `/auth/email/verify` and
  `/auth/email/mac` → 403. `next` values `//evil`, `https://evil`, `/\evil`, encoded forms
  and `javascript:` all fall back to `/timeline`.
- CAPTCHA: Cadence's email routes refuse a missing or fake token. Direct Supabase calls with
  the public key and no token are refused for password sign-up, OTP, password grant,
  recovery and anonymous sign-up (`captcha_failed`).
- Passwords: a password set through `PUT /auth/v1/user` for a real address returns 200 but
  is dropped (`encrypted_password` empty).
- Last identity: Supabase refuses to unlink the only identity (`single_identity_not_deletable`);
  the `keep_one_auth_identity` trigger backs it.
- `POST /api/auth/apple-sign-in-token` without a session → 401.

Findings, most severe first:

1. **Per-IP Auth limits may be shared by every user (medium, not verified).** Cadence calls
   `signInWithOtp` and `verifyOtp` from its server, so Supabase sees Vercel's address, not
   the person's. If Supabase applies the OTP and verify limits (30 each) per IP, one person
   posting wrong codes could block code and link sign-in for everyone for a few minutes,
   and the limits never apply per person. `/auth/email/verify` needs only the pending cookie,
   which one solved CAPTCHA gives. Not tested on production because the test would be the
   outage. Check on a test copy, or read Auth logs for the remote address of
   `/verify` calls. Confirmed and fixed inactive under Ticket 338
   (`docs/qa/2026-11-13-ticket-338-email-rate-limit.md`).
2. **Replies bounce (medium, user-visible).** Sign-in and reminder email carry
   `Reply-To: Cadence <login@cadence-me.com>`; the domain has no MX record. Already noted in
   P-052 and OPERATIONS.
3. **The email form forgets the address after a refused CAPTCHA (low, UX).** If the
   Turnstile check has not finished, Send returns "The check that you are a person did not
   finish" and the address field is empty. In this run a fresh browser context never passed
   the check in 90 s; the profile's own window passed at once.
4. **Direct Supabase calls skip Cadence's rules, self-only (low).** With manual linking and
   Apple on, a signed-in person can call Supabase directly to link a second Google identity
   (Calendar then reads `multiple` until one is removed), add or change a method without the
   15-minute rule, or sign up with Apple without Cadence's callback (no kept Apple token, so
   deletion cannot revoke at Apple). The database triggers still hold the last identity and
   Calendar's identity. None reaches another account.
5. **Localhost on production (low).** The redirect allow list keeps `localhost` and
   `127.0.0.1` entries, including `http://localhost:3000/**`, and the Turnstile widget
   allows both hosts. A token or CAPTCHA pass can be sent to, or made on, a local page.
6. **Leftovers (low).** 32 acceptance OAuth clients on production; 4 July load-test users
   with passwords (password sign-in now needs CAPTCHA). Sequenzy stores email content
   (`emailContentStorageEnabled`), so copies of sign-in emails with their one-hour code sit
   at Sequenzy.

## D. Side effects on existing features

- **Reminder email.** No production Behavior has email reminders on, and no email reminder
  delivery has ever been recorded, so no user has received one. From Sequenzy's records
  (`seq-before.json`/`seq-after.json` of the go-live run): before November 13 a reminder
  came from `Identity Scaffolding <hello@identityscaffolding.sequenzymail.com>` with
  Reply-To the owner's personal Gmail, click tracking on (links through
  `sequenzylink3.com`), open tracking and the free-plan footer. Now it comes from
  `Identity Scaffolding <hello@cadence-me.com>` (default sender since 17:38Z; the 17:42Z
  check still saw the shared domain), Reply-To `Cadence <login@cadence-me.com>`, direct
  links, the same pixel and footer. The sender name is not a regression: it was "Identity
  Scaffolding" before. The address now uses Cadence's domain and the owner's Gmail is no
  longer exposed; replies now bounce. Smallest fix: rename sender profile
  `oqf1lrv9mmvxjkj8admg39cv` to "Cadence" in Sequenzy (one provider setting, no code).
  Alternative in code: pass `senderProfileId` or `from` in `sendReminderEmail`.
- **Web push.** Same pattern as earlier days: 11 sent and 8 failed today, every failure "No
  active browser push subscription"; no pending reminder overdue. None was due after 21:35Z.
- **Daily Brief, connectors and jobs.** No server code calls a CAPTCHA-protected Auth
  endpoint except the email sign-in routes; jobs mint their own tokens. Token refresh is not
  CAPTCHA-checked (kept sessions refreshed). Not observed live after go-live.
- **MCP OAuth.** Consent, token, probe and revoke passed (B).
- **Mac 0.1.10 with Google.** Not verified after go-live: the only sync receipts in 30 hours
  are test account A's (last 18:00Z) and no other session refreshed after 17:33Z.

## E. Docs corrected in this change

- `AGENTS.md`: Tickets 310–324 "no code has shipped" (they are complete and on); sign-in
  line now names Apple and Settings sign-in methods as live on web.
- `docs/ROUTE_MAP.md` `/login`: "Google is the only method in production" and "both flags
  are off".
- `docs/OPERATIONS.md`: the flag paragraph omitted Apple and linking being on.
- `docs/TICKETS.md`: Ticket 332 "in progress, draft PR"; Ticket 337 "every production flag
  stays off"; Ticket 336 release state.
- `docs/LEGAL.md` L-024: "open, the owner decides" (the owner chose to keep the glyph).
- `STATUS.md`: Open work row said "337 first pass, no flag on; rows wait on owner row 16";
  follow-ups now have their own row.

Checked and correct: `docs/DATA_MODEL.md` (token table, triggers), `docs/COSTS.md` (Sequenzy
free plan shared with reminders, rate 30/h), `docs/MESSAGING_CHANGES.md` P-051 to P-054,
the Apple client secret dates (expires May 12, 2027; rotate by April 12, 2027) in STATUS and
OPERATIONS, and the key reader `release:credentials apple-sign-in-secret`. Not corrected:
the GitHub release title for `desktop-stable` still reads "Cadence for Mac 0.1.9" while it
serves 0.1.10.
