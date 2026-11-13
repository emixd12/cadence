# Ticket 332: hosted Auth changes for email sign-in

Written November 13, 2026, for Ticket 332 (D31.2, D31.3). **Nothing on this list was
done.** Ticket 332 changed no hosted setting. Agents apply the steps in order under the
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
| 1 | Read-only: count hosted users with a stored password whose address is not on a reserved test name (`.test`, `.invalid`, `.example`, `.localhost`, `example.com/net/org`) | Not read | A count, recorded here | None needed | Ready. If the count is above 0, the owner decides whether to clear those passwords; the trigger in step 2 does not remove existing ones |
| 2 | Push migration `20261113160000_refuse_auth_passwords.sql`: trigger `refuse_auth_password` on `auth.users` drops a new password for a real address | No trigger | Trigger and `cadence_private.refuse_auth_password()` present | A new migration: `drop trigger refuse_auth_password on auth.users; drop function cadence_private.refuse_auth_password();` | Ready. Additive; the standing approval for additive migrations (`docs/DECISIONS.md`, 2026-11-10) applies; the coordinator confirms before the push. After it: Google sign-in on production |
| 3 | Sign-in email for a new address: `mailer_subjects_confirmation`, `mailer_templates_confirmation_content` | `Confirm your email address`; Supabase's content (masked in the read; save the full value to the private run folder before the change) | `Sign in to Cadence`; `supabase/templates/sign-in.html` | `PATCH` the saved subject and content back | Ready |
| 4 | Sign-in email for a known address: `mailer_subjects_magic_link`, `mailer_templates_magic_link_content` | `Your sign-in link`; Supabase's content (save it as in step 3) | `Sign in to Cadence`; `supabase/templates/sign-in.html` | `PATCH` the saved values back | Ready |
| 5 | Code length `mailer_otp_length` | `8` | `6` (D31.2, local config, `EMAIL_SIGN_IN_CODE_LENGTH`) | `8` | **Waiting: owner decision** (6 or 8). If the owner chooses 8: change `EMAIL_SIGN_IN_CODE_LENGTH` and `otp_length` to 8 in one pull request and leave hosted unchanged |
| 6 | Custom SMTP: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`, `smtp_max_frequency` | All null except `smtp_max_frequency` 60 (built-in sender: 2 an hour, team addresses only) | `smtp.sequenzy.com`, `587`, `api`, the Sequenzy key, `login@cadence-me.com`, `Cadence`, `60` | Set the six values back to null (the built-in sender returns) | **Waiting:** owner rows 2 (sender and `sequenzy-supabase-smtp-key`) and 3 (DNS for `cadence-me.com`) |
| 7 | Email rate limit `rate_limit_email_sent` | `2` an hour | `30` an hour, then adjust from measured volume (`docs/COSTS.md`) | `2` | **Waiting:** step 6 (Supabase allows a higher limit only with custom SMTP) |
| 8 | Bot check: `security_captcha_enabled`, `security_captcha_provider`, `security_captcha_secret` | `false`, `hcaptcha`, null | `true`, `turnstile`, the Turnstile secret | `security_captcha_enabled` `false` | **Waiting:** owner row 3 (Turnstile widget and keys). Do the prerequisites below first |
| 9 | Vercel Production and Preview: `CADENCE_TURNSTILE_SITE_KEY` | Unset | The Turnstile site key (public) | Unset | **Waiting:** owner row 3. Set before or with step 8, then redeploy |
| 10 | Redirect allow list `uri_allow_list` | 47 entries | Unchanged | None | No change: the link uses `{{ .SiteURL }}/login/confirm`, which needs no allow-list entry |
| 11 | Unchanged and checked: `external_email_enabled` true, `disable_signup` false, `mailer_autoconfirm` false (confirmation on), `mailer_allow_unverified_email_sign_ins` false, `mailer_otp_exp` 3600, `mfa_totp_*` true, `security_manual_linking_enabled` false | As listed | As listed | None | Local `supabase/config.toml` now matches these |

After step 4, an email sign-in on hosted Auth works only for Supabase team addresses, 2
an hour, until step 6. The emailed link opens `https://app.cadence-me.com/login/confirm`,
which sends a person to Login while the flag is off. The code works on any deployment
with the flag on, including a Preview; the link always opens the Site URL.

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
