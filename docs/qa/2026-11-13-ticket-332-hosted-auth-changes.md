# Ticket 332: hosted Auth changes for email sign-in

Written November 13, 2026, for Ticket 332 (D31.2, D31.3). **Steps 1–4 were applied on
November 13, 2026, about 17:15–17:20Z, by the verifier** (see "Applied" below). **Step 5 was
applied, and steps 6–7 applied and then set back, by the Task 10 agent, 17:38–19:01Z**
(see "Applied, Task 10"); steps 8–9 wait on owner row 13. Agents apply the steps in order under the
coordinator's ruling of November 13, 07:35Z (owner blockers rows 1 and 6): record each
before and after value in this file, read the setting back, and recheck Google sign-in on
production after each step. `CADENCE_SIGN_IN_EMAIL` stays unset in Production until
Ticket 337 passes for email.

Project `qjodzutjxtmtzczbloxa`. Settings are read and written with the Management API
(`GET` and `PATCH /v1/projects/qjodzutjxtmtzczbloxa/config/auth`) through
`npm run agent:secret -- --caller <caller> --env SUPABASE_ACCESS_TOKEN=supabase-access-token -- <command>`.
The "Before" column was read on November 13, 2026 at about 16:12Z, read-only.

## Ordered steps

| # | Change | Before | After | Rollback | State |
|---|---|---|---|---|---|
| 1 | Read-only: count hosted users with a stored password whose address is not on a reserved test name (`.test`, `.invalid`, `.example`, `.localhost`, `example.com/net/org`) | Not read | **17:14Z: 7 users, 4 with a stored password, 0 of them on a real address** | None needed | **Done.** If the count is above 0, the owner decides whether to clear those passwords; the trigger in step 2 does not remove existing ones |
| 2 | Push migration `20261113160000_refuse_auth_passwords.sql`: trigger `refuse_auth_password` on `auth.users` drops a new password for a real address | No trigger | **Present and enabled (`tgenabled` O), function owner `postgres`, not security definer, EXECUTE `postgres` only; still 4 stored passwords** | A new migration: `drop trigger refuse_auth_password on auth.users; drop function cadence_private.refuse_auth_password();` | **Done 17:16Z.** Authority: owner blockers row 1 (coordinator ruling 07:35Z), not the additive approval alone: the trigger rewrites what Auth writes. Formerly: additive; the standing approval for additive migrations (`docs/DECISIONS.md`, 2026-11-10) applies; the coordinator confirms before the push. After it: Google sign-in on production |
| 3 | Sign-in email for a new address: `mailer_subjects_confirmation`, `mailer_templates_confirmation_content` | `Confirm your email address`; Supabase's content (masked in the read; save the full value to the private run folder before the change) | `Sign in to Cadence`; `supabase/templates/sign-in.html` | `PATCH` the saved subject and content back | **Done 17:19Z; read back equal to the file** |
| 4 | Sign-in email for a known address: `mailer_subjects_magic_link`, `mailer_templates_magic_link_content` | `Your sign-in link`; Supabase's content (save it as in step 3) | `Sign in to Cadence`; `supabase/templates/sign-in.html` | `PATCH` the saved values back | **Done 17:19Z; read back equal to the file** |
| 5 | Code length `mailer_otp_length` | `8` | **`6`, 17:44Z, read back** (owner row 8, D31.2) | `8` | **Done.** Recheck passed (sessions A and B, Google sign-in as A) |
| 6 | Custom SMTP: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`, `smtp_max_frequency` | All null except `smtp_max_frequency` 60 | **Now: all null again (19:00Z).** Applied 17:44Z with the vault key and set back 17:54Z; applied 17:55Z with the Identity Scaffolding company key for acceptance only and set back 19:00Z. Values when on: `smtp.sequenzy.com`, `587`, `api`, key, `login@cadence-me.com`, `Cadence`, `60` | Null the five connection fields (the sender name clears with them) | **Waiting: owner rows 11 and 12.** Hosted Auth keeps SMTP only as a full set: a PATCH of host, port, user and key without the sender returns 200 and stores nothing, so SMTP and sender are one change |
| 7 | Email rate limit `rate_limit_email_sent` | `2` an hour | **Now `2`.** `10` from 17:45Z for the acceptance window, back to `2` at 19:00Z. Planned: `3` while CAPTCHA is off (at most about 2,160 a month, inside Sequenzy's free 2,500 shared with reminders), `30` once Turnstile is on | `2` | **Waiting: step 6.** Supabase refuses a value other than the built-in one without SMTP ("Custom SMTP required to configure … RATE_LIMIT_EMAIL_SENT"); lower it before nulling SMTP |
| 8 | Bot check: `security_captcha_enabled`, `security_captcha_provider`, `security_captcha_secret` | `false`, `hcaptcha`, null | Unchanged | `security_captcha_enabled` `false` | **Waiting: owner row 13** (the Cloudflare token gets 403 on Turnstile widgets). Prerequisite done in PR #268: test login signs in with a link token |
| 9 | Vercel Production and Preview: `CADENCE_TURNSTILE_SITE_KEY` | Unset | Unchanged | Unset | **Waiting: owner row 13** |
| 10 | Redirect allow list `uri_allow_list` | 47 entries | Unchanged | None | No change: the link uses `{{ .SiteURL }}/login/confirm`, which needs no allow-list entry |
| 11 | Unchanged and checked: `external_email_enabled` true, `disable_signup` false, `mailer_autoconfirm` false (confirmation on), `mailer_allow_unverified_email_sign_ins` false, `mailer_otp_exp` 3600, `mfa_totp_*` true, `security_manual_linking_enabled` false | As listed | As listed | None | Local `supabase/config.toml` now matches these |

After step 4, an email sign-in on hosted Auth works only for Supabase team addresses, 2
an hour, until step 6. The emailed link opens `https://app.cadence-me.com/login/confirm`,
which sends a person to Login while the flag is off. The code works on any deployment
with the flag on, including a Preview; the link always opens the Site URL.

## Applied

- The full before values of steps 3 and 4 are saved in the gitignored run folder
  `.intent/acceptance/v332-hosted/auth-before.json` on the verifier's Mac (subjects
  `Confirm your email address` and `Your sign-in link`; Supabase's default bodies, 184 and
  173 characters). Rollback: `PATCH` those four values.
- Unchanged and read back after the steps: `mailer_otp_length` 8, `mailer_autoconfirm`
  false, `external_email_enabled` true, `disable_signup` false, `smtp_host` null,
  `rate_limit_email_sent` 2, `security_captcha_enabled` false, Google on.
- The template PATCH returned 200 and the first read a second later still showed the old
  values; a later read showed the new ones. Read twice before concluding a change failed.

## Applied, Task 10 (November 13, 2026)

Record kept in the git-ignored run folder `.intent/acceptance/v332-enable/` (worktree
`.claude/worktrees/sign-in-332-enable`): `auth-before.json`, `after-change-*.json`,
`auth-final.json`, `dns-*.json`, `rechecks.jsonl`. Acceptance:
`docs/qa/2026-11-13-ticket-332-production-acceptance.md`.

| Time (Z) | Provider change | Before | After |
|---|---|---|---|
| 17:38 | Sequenzy company "Identity Scaffolding": sending domain `cadence-me.com` added (`sequenzy websites add`) | One domain, the shared `identityscaffolding.sequenzymail.com` | Two; `cadence-me.com` verified 17:41, ready to send about 17:43 (`POST /api/v1/websites/cadence-me.com/verify`) |
| 17:40 | Cloudflare zone `cadence-me.com`: records Sequenzy asked for (DNS only) | 3 records: A `cadence-me.com`, A `app.cadence-me.com`, TXT google-site-verification | + CNAME `sq1._domainkey` → `sq1.wwfsmjra.d.sequenzydns.com`; CNAME `sq2._domainkey` → `sq2.wwfsmjra.d.sequenzydns.com`; CNAME `rp` → `r1.wwfsmjra.d.sequenzydns.com`; CNAME `rp2` → `r2.wwfsmjra.d.sequenzydns.com` |
| 17:40 | Cloudflare: DMARC (none existed) | None | TXT `_dmarc` `v=DMARC1; p=none;` |
| 18:10 | Cloudflare: root SPF, for Apple's email relay (coordinator, after the Apple portal session) | No root SPF | TXT `cadence-me.com` `v=spf1 include:spf.sequenzydns.com ~all`. Checked first: `spf.sequenzydns.com` covers `include:amazonses.com` and Sequenzy's IPs; the zone has no MX and no other sender (reminders send from Sequenzy's shared domain) |
| 17:44 | Hosted Auth step 6 (vault key) | SMTP null | Set; then 17:54 back to null (wrong Sequenzy company, owner row 11) |
| 17:44 | Hosted Auth step 5 | `mailer_otp_length` 8 | 6 |
| 17:45 | Hosted Auth step 7 | 2 | 10; 17:54 back to 2 |
| 17:55 | Hosted Auth step 6 for acceptance (Identity Scaffolding key) and step 7 | SMTP null, 2 | Set, 10 |
| 19:00 | Rollback after acceptance | SMTP set, 10 | SMTP null, 2 |

Not added: Sequenzy's optional link-tracking CNAME `links.cadence-me.com` (tracking is not
wanted on sign-in email). Unchanged throughout: the redirect allow list, the Site URL,
confirmation on, Google on, the templates.

After every change: kept sessions A and B refreshed, and a fresh Google sign-in to
`app.cadence-me.com` as A (cookie cleared first) returned as A. All 7 rechecks passed. The
existing reminder email still sent from `hello@identityscaffolding.sequenzymail3.com` after
the domain was added (17:42Z).

To finish (after owner rows 11–13): set SMTP with the new key and step 7 to 3; send one
test to AgentMail and check sender, reply-to and links; create the Turnstile widget; set
step 9, redeploy; merge PR #268; then step 8 and step 7 to 30; recheck the test login,
Google sign-in and kept sessions; then the flag.

## Before turning on CAPTCHA (step 8)

CAPTCHA is project-wide. Measured on the local stack with Cloudflare's always-pass test
secret, November 13, 2026 (`docs/qa/2026-11-13-ticket-332-email-sign-in.md`):

| Call | Needs a Turnstile token |
|---|---|
| `/auth/v1/otp` (request a link and code) | Yes |
| `/auth/v1/signup` | Yes |
| `/auth/v1/token?grant_type=password` | Yes |
| `/auth/v1/verify` (link token hash or typed code) | No |
| `/auth/v1/token?grant_type=refresh_token` | No |
| `/auth/v1/authorize?provider=google` | No |
| Admin API with the service role (`admin/users`, `admin/generate_link`) | No |

Effects:

- **Web email sign-in.** Needs step 9 first. Without the site key the form sends no token
  and every request fails with "The check that you are a person did not finish."
- **Test login (`app/auth/test-login`).** Its `signInWithPassword` fails against a hosted
  project with CAPTCHA on, so hosted test login (`CADENCE_ALLOW_HOSTED_TEST_LOGIN=1`) stops
  working. Local test login is unaffected while local CAPTCHA stays off. Fix, if hosted
  test login is still needed: sign the temporary user in with
  `admin.generateLink({ type: "magiclink" })` and `verifyOtp({ token_hash, type: "email" })`;
  both passed without a token in the local check. Not built in Ticket 332.
- **Scripts that sign in with a password against a hosted project** (load-test fixtures,
  RLS and push-cap smoke scripts) stop working the same way. They target loopback
  Supabase by default.
- **Mac (Ticket 336).** Typing the code needs no token. Requesting the email does. Two
  options for Ticket 336: render Turnstile in the app's webview (the widget's hostname
  list must include the webview's origin; not tested), or request the email from the web
  form in the system browser and type the code in the app. Not decided here.
- **Google sign-in, MCP consent and token refresh** are unaffected.
- **Turnstile hostnames.** List `app.cadence-me.com` and the stable Preview host
  `cadence-blush-three.vercel.app`. Other Preview hosts fail the check.

## Notes

- Password refusal: hosted Auth has no setting that turns passwords off alone. The read
  of November 13 shows only `password_min_length`, `password_required_characters` and
  `password_hibp_enabled`. Turning off the email provider would also turn off email
  sign-in. Step 2's trigger is the control. With confirmation on, a password sign-up for
  someone else's address already gets no session; the trigger also removes the password,
  so it never works later, and stops a signed-in person adding one through `updateUser`.
- Server requests share Vercel's addresses. Supabase Auth limits sign-in requests and
  verifications per IP address (30 each per 5 minutes on hosted). The request and verify
  routes call Auth from the server, so all people may share those limits. Not measured;
  Ticket 337 checks it.
- Rows 1–9 each get a dated STATUS.md line when applied.
