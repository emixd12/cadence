# Ticket 333: production acceptance of Apple sign-in

Run November 13, 2026, 18:35–20:44Z, by the Apple enablement agent. Run
folder (git-ignored): `.intent/acceptance/t333-enable/` in the Intent workspace worktree
(`evidence.jsonl`, `rechecks.jsonl`, `auth-*.json`, `events.jsonl` for the vault reads).
No token, client secret, key, cookie or email address was printed or recorded; addresses
appear only as their domain.

**Result: every Apple row passed (the relay email row was skipped by the owner). Apple is
live on production web since 21:36Z,** turned on together with `CADENCE_SIGN_IN_LINKING`
(Ticket 334) on the coordinator's go, after every linking row passed. Linking going on with
Apple means an existing Google user who picks Apple with Hide My Email can join the second
account from Settings. See "Go-live".

## Setup

- **Client secret.** Made at 18:58:09Z with `release-credentials.mjs apple-sign-in-secret`
  (PR #269). The owner approved the key read (`release-secrets` for this run). It
  **expires May 12, 2027, 18:58Z**. **Rotate by April 12, 2027.** Apple's token endpoint
  answered `invalid_grant` to a dummy code (it accepted the client), not `invalid_client`.
- **Hosted changes.** Before and after values: `docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md`, "Applied".
- **Where the app ran.** Preview has no Supabase variables, so, as in Ticket 332, the
  agent made an unaliased production-target deployment from `origin/main` 736aace4 with
  the flag on for that deployment only (`dpl_WA8MkhB6CRNyVZChkaddwAxFYxXv`). The agent
  opened it in Cadence QA Chrome with the project's automation bypass, which was never
  printed. `app.cadence-me.com` kept serving the production deployment with the flag
  off: Login showed only Continue with Google after every change.
- **Browser.** The Intent in-app browser tab never mounted, so the agent used the Cadence
  QA Chrome window for runs 1 and 2. The owner signed in with their personal Apple Account
  (Apple refused to create a test account, owner row 5). For run 3 the agent used a
  separate Chrome with its own temporary profile. Two attempts in QA Chrome failed, both
  before reaching Cadence: at 20:30Z the deployment's access pass had expired, so Vercel's
  login page caught Apple's return; at 20:38Z another agent's acceptance run was driving
  the shared window. Lesson: run owner sign-ins in a dedicated browser profile, not the
  shared QA profile.

## Rows

| Row | Result | Evidence |
|---|---|---|
| First sign-in creates an account and keeps the name | **Passed** after one rerun. The first attempt (19:06Z) created the account, with the full name in Auth metadata and the profile, but returned to `app.cadence-me.com` instead of the test deployment. See "Finding: redirect allow list" | `apple-users` reads: user `61133341…`, `name_present: true`, `profile_name: true` |
| Supabase returns `provider_refresh_token`; a sealed row exists | **Passed.** The session after the 19:10:42Z sign-in carried a provider refresh token (presence read only). One row in `apple_sign_in_tokens` for that user, subject digest `638b28a6…`, one Apple identity. No `apple_sign_in_token_missing` event | `who`, `apple-token-rows`, `logs-scan` |
| Returning sign-in reaches the same account | **Passed.** The 19:10:42Z sign-in reached user `61133341…`, created 19:06:48Z. No second user | `apple-users` |
| What Settings shows | **Passed.** The email row shows the address Apple shared. On this run that was the owner's real address (`gmail.com`), because Apple's sharing prompt was answered with Share My Email | `settings` read, addresses masked |
| Relay address (Hide My Email) | **Passed.** After the deletion revoked Cadence's authorization, Apple asked the sharing question again (20:30Z attempt), and the owner chose Hide My Email. The 20:41:33Z sign-in created a new account `f6f5c0f7…` with one Apple identity, an address on `privaterelay.appleid.com`, no data beyond the 8 default categories, and one sealed token row with the same subject digest as run 1. Settings shows the relay address. No account with a non-relay address has an Apple identity, so nothing joined the owner's Google account. Apple sent no name on this run: the name came with the 20:30Z authorization, which never reached Cadence | `relay-session`, `relay-settings`, `apple-users`, `user-data` |
| An email reaches the relay address | **Skipped** by the owner ("skip the test email"). The Apple email sources pass SPF (Owner blockers note, "Apple portal session") | — |
| Deleting the relay account | **Passed.** Settings → Delete account at 20:42:36Z after confirming the account was fresh; session 401; user and token row gone; no warn-level line in the deletion window | `relay-account-deletion`, `relay-logs-scan` |
| Account deletion revokes at Apple and removes the row | **Passed.** Settings → Delete account (export box checked, the address typed) at 19:12:30Z. Session 401 afterwards; the Auth user and the token row are gone. Runtime logs for the deployment hold no warn or error line in the deletion window, so neither `account_deletion_apple_token_absent` nor `account_deletion_apple_revocation_failed` fired (both log at warn). A successful revoke logs nothing; the fresh consent prompt on the next first sign-in is the Apple-side check | `account-deletion`, `logs-scan` |
| Google sign-in and kept sessions after each change | **Passed** at baseline (18:42Z) and after the Apple provider (19:00Z): kept sessions A and B refresh; a fresh Google sign-in as A on `app.cadence-me.com` returns A's user ID. Google as A on the test deployment returned to it after the allow-list fix (19:09Z) | `rechecks.jsonl`, `evidence.jsonl` |

## Finding: redirect allow list

Supabase Auth compares `redirect_to` with each allow-list entry as a whole-URL glob,
query string included. An exact entry `https://<host>/auth/callback` therefore does not
match `/auth/callback?next=…&via=apple`, and Supabase falls back to the Site URL.
Production is not affected: Supabase accepts any redirect on the Site URL's own host
(`app.cadence-me.com`). Ticket 333's change list said the exact entry is enough because
"Google already returns with a query on that entry"; that worked only because of the Site
URL rule. For any other host (a test deployment, a future custom domain), add
`https://<host>/auth/callback**`. The test entry was swapped at 19:09Z and is removed
after the run.

## Cleanup (done 20:43–20:44Z)

- Removed `https://cadence-311hbjk9f-emis-projects-4c886aeb.vercel.app/auth/callback**`
  from the allow list (49 → 48; the remaining extra entry belongs to another agent's test
  deployment) and deleted the test deployment. The trial deployment was deleted at 18:40Z.
- Cleared the 4 `apple.com` cookies from Cadence QA Chrome; closed the separate Chrome and
  deleted its profile.
- Both test accounts were deleted through Settings; none remain with an Apple identity.
- Still set, by design: the Supabase Apple provider (enabled, client ID `app.cadence.web`,
  secret set) and Vercel Production `APPLE_SIGN_IN_SERVICES_ID` and
  `APPLE_SIGN_IN_CLIENT_SECRET`. `CADENCE_SIGN_IN_APPLE` is unset in Production.

## Go-live (November 13, 2026, 21:35–21:42Z)

- **Vercel Production before (21:35Z):** 49 variables. Sign-in related: `APPLE_SIGN_IN_SERVICES_ID`,
  `APPLE_SIGN_IN_CLIENT_SECRET`, plus `CADENCE_TURNSTILE_SITE_KEY` and `CADENCE_SIGN_IN_EMAIL`
  set by the email go-live agent minutes earlier. `CADENCE_SIGN_IN_APPLE` and
  `CADENCE_SIGN_IN_LINKING` unset.
- **Change:** `CADENCE_SIGN_IN_LINKING=on` and `CADENCE_SIGN_IN_APPLE=on` (config, read back as
  exactly `on`). **After:** 51 variables; the diff is exactly those two.
- **Redeploy:** one production redeploy (`cadence-9ik8hgqdn…`). The email agent redeployed at
  the same time; `app.cadence-me.com` served `dpl_6EbQniQvr9GGzbAu2NZPp1igu1dS`
  (`cadence-fnithtg83…`, created 21:36:13Z, after both flags), which carries them.

| Check (production) | Result |
|---|---|
| `/login` at 390 px and 1280 px in a fresh Chrome profile | **Passed.** Continue with Google, Continue with Apple, Continue with email (email is the other agent's flag); no horizontal overflow; each control 44 px high. The one-account hint reads "Have an account already? Sign in the way you did before, then add other ways in Settings. Another way can start a second account." Screenshots in the run folder |
| Apple start | **Passed.** Reaches `appleid.apple.com/auth/authorize` with `client_id=app.cadence.web`, the Supabase callback as `redirect_uri`, `form_post`, scope `email name`. No real Apple sign-in (not needed again) |
| Google sign-in as test account A | **Passed.** Fresh sign-in from a cleared cookie returns A's user ID |
| Kept sessions A and B | **Passed** (refresh) |
| A's Settings | **Passed.** The Sign-in methods row shows "Google and email" |
| `GET /api/auth/sign-in-methods` | **Passed.** 200; Google, Apple and email; code length 6 |
| A's Google Calendar status | **Passed.** 200, connected (no earlier read to compare the generation with) |
| Signed-in Sign-in methods actions with hosted CAPTCHA on | **Passed.** A throwaway account made with the admin API on a reserved `example.com` address signed in through `/login/confirm`. Settings → Change address → "If that address can be used, Cadence sent it a confirmation link…"; Auth shows the change pending and the address unchanged. Add Apple reached Apple with `client_id=app.cadence.web`. The account was deleted with the admin API (200) |
