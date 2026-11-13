# Ticket 337: sign-in acceptance, first pass

Run November 13, 2026, 20:20–20:52Z, by the Ticket 337 agent (Task 9). This pass did every
row that needs no owner step. Run folder (git-ignored): `.intent/acceptance/t337/` in the
Intent workspace worktree (`evidence.jsonl`, `rechecks.jsonl`, `auth-*.json`, `shots/`,
and the scripts `hosted.mjs`, `drive.mjs`, `mcp.mjs`, `recheck.mjs`). No token, cookie,
key, share link or link token was printed or recorded. Addresses are masked to their
domain in the evidence.

**Result: no production flag was turned on.** `CADENCE_SIGN_IN_EMAIL`,
`CADENCE_SIGN_IN_APPLE` and `CADENCE_SIGN_IN_LINKING` stay unset in Production. Hosted
manual identity linking is now on (Ticket 334 step 4). Production `/api/auth/sign-in-methods`
lists Google only.

## Test access

- New preflight suite `sign-in` (`.agentic/test-access.json`; `docs/qa/agent-secrets.md`,
  "Sign-in suite"). It reads six hosted Auth settings through
  `scripts/acceptance/access/auth-config.mjs`, which prints booleans only.
- First run, 20:24Z: ready 15, owner steps 2, error 1. Owner steps: SMTP host not set
  (owner row 11) and CAPTCHA off (owner row 13). Error: manual linking off, an agent step,
  which this pass then applied. Email provider, Apple provider and secure email change: on.
- `apple-test-account-a` is not in the manifest: Apple refused the owner a test account
  (owner row 5); the owner's own Apple Account stands in, with the owner present.

## Hosted steps (Ticket 334 change list, steps 1, 3 and 4)

Recorded in `docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md`, "Applied".

| Step | Before | After | Recheck |
|---|---|---|---|
| 1. Read | manual linking `false`, secure email change `true`, 48 redirect entries | recorded | – |
| 3. Secure email change | `true` | no change | – |
| 4. Manual identity linking | `false` | `true` (first read stale, second read `true`; nothing else changed) | Passed 20:26:50Z: kept sessions A and B, fresh Google sign-in as A on `app.cadence-me.com` |

## Where the app ran

An unaliased production-target deployment of `origin/main` `e5441797`, built with
`vercel deploy --prod --skip-domain --env CADENCE_SIGN_IN_LINKING=on --build-env CADENCE_SIGN_IN_LINKING=on`.
It has the production variables and production Supabase; the flag applies to that
deployment only. `CADENCE_SIGN_IN_EMAIL` and `CADENCE_SIGN_IN_APPLE` stayed off on it, so
its login page shows Continue with Google only. Redirect allow-list entry
`<deployment>/auth/callback**` was added for the run and removed after it.

- Two earlier deployments were removed before use: Vercel answers 409 to a second
  shareable-link request for a deployment and does not return the first link, and the
  first attempt sent the link with the wrong query name. Lesson: the link's query name is
  `_vercel_share`; keep the value in a 0600 file in the run folder on the first request.
- Browser: the Cadence QA Chrome profile. Test accounts A and B sign in with Google there.
- Email-only accounts: email delivery is not live (SMTP host not set), so the run created
  them with the Auth admin API on reserved addresses (`t337-<label>@example.com`,
  `email_confirm: true`) and signed them in with an admin magic-link token verified
  server-side. No email was sent. The session went into the test host's cookie.

## Rows (linking flag on, test deployment)

| Row | Result | Evidence (`evidence.jsonl` row) |
|---|---|---|
| Settings shows the Sign-in methods row | **Passed.** A (Google only): row "Sign-in methods", state "Google", Google with A's address, no Remove and no Add button. Email-only E1: state "Email", the address and "Add Google". Production (flag off): no row | `settings-A-google-only`, `settings-e1-email-only`, `calendar-A-production-flag-off` |
| A Google account adds a second method | **Not possible in this pass.** A can add only email (needs email live) or Apple (needs `CADENCE_SIGN_IN_APPLE`). A's row offers no Add button, as designed | `settings-A-google-only` |
| An account adds Google (real linking screens) | **Partly.** E1's Add Google reached Google's real account chooser and returned to the row. A successful add needs a Google account that is not already a Cadence account; the run has none (see "Remaining") | `add-e1-adds-B`, `add-e1-adds-A` |
| A Google account that belongs to another account is refused, with no account named | **Passed.** E1 chose B's Google account, then A's. Both returned "That Google account already signs in to a different Cadence account, so it cannot be added here. Cadence does not merge accounts. Choose another Google account." E1 kept one identity; hosted users with two Google identities: 0 | `add-e1-adds-B`, `add-e1-adds-A`, `sql-identities` |
| 15-minute recent sign-in rule | **Passed.** A signed in at 20:35:03Z. At 20:50:47Z a removal post sent A to `/login?next=/settings#sign-in-methods&error=reauth_required`, which said "Sign in again to change how you sign in. Cadence asks when the last sign-in was more than 15 minutes ago." and ended the old session. Continue with Google returned to `/settings#sign-in-methods` with a fresh sign-in time. E1 (stale, 20:51Z) pressing Add Google got the same page; with email off, an email-only account cannot sign back in there (see Remaining) | `signin-A`, `remove-A-stale`, `continue-A-reauth`, `add-e1-stale` |
| Removing the last method is refused | **Passed.** A (Google only) shows no Remove button. A removal posted directly, after the fresh sign-in, returned "Add another way to sign in before removing this one."; A still has its Google identity. Email is never removable (`not_removable`), so E1 has no Remove control | `remove-A-last` |
| Calendar for an account with one Google sign-in is unchanged | **Passed.** A's Calendar: API `connected`, no `googleSignIn` field; the panel text is identical to production with the flag off | `calendar-A`, `calendar-A-production-flag-off` |
| Remove Google refused while Calendar is connected | **Not run.** It needs an account with Google, a second method and Calendar connected. A has one method, so its removal stops at the last-method rule first | – |
| MCP consent for an account with no Google sign-in | **Passed** on `app.cadence-me.com` with manual linking on: E1, dynamic client, consent page, Allow, token for E1, `get_account_context` 200 with the three scopes; after revocation 401 and 0 grants | `mcp-consent-e1` |
| Account deletion | **Passed** for an email-only account with the flag on: E1 deleted through Settings at 390 px (the confirmation text is the address); landed on `/login`, session 401, Auth `GET /user` with the old token 403; no `t337-` user remains | `account-deletion-e1` |
| 390 px and desktop | **Passed.** The Sign-in methods row for A and E1 at 390 and 1280 px; no horizontal overflow | `shots/` |

## Installed Mac (read-only)

The test Mac runs Cadence 0.1.11-dev.4 (production values), signed in as A with the account
link paused on the known first-link defect (owner row 15). Read through accessibility only;
nothing was clicked. The window shows the paused link and no sign-in method button. The Mac
reads its method list from production `/api/auth/sign-in-methods`, which returned Google
only (20:40Z). The method chooser shows only when signed out; reaching it would change the
test Mac's state, so it waits on owner row 15.

## Status per flag

| Flag | Passed on production Supabase | Remaining, and what each waits on |
|---|---|---|
| `CADENCE_SIGN_IN_EMAIL` | Ticket 332's email rows (`docs/qa/2026-11-13-ticket-332-production-acceptance.md`); MCP consent and deletion for an email-only account (332 and this pass) | Hosted SMTP with the right Sequenzy key (owner row 11); reply-to, click tracking and footer (owner row 12); Turnstile and CAPTCHA (owner row 13); then a recheck of one email and of rows 1–2 at phone width with CAPTCHA on. Acceptance row 3 needs email added to a Google account, which waits on the same rows |
| `CADENCE_SIGN_IN_APPLE` | Ticket 333's Apple rows (`docs/qa/2026-11-13-ticket-333-production-acceptance.md`, draft PR #272) | The Hide My Email sign-in (the Apple agent's owner step). Not run here, by instruction |
| `CADENCE_SIGN_IN_LINKING` | Hosted manual linking on; Sign-in methods row for Google-only and email-only accounts; neutral refusal of a Google account owned by another account (real Google chooser); 15-minute rule with return to the row; last-method refusal; Calendar unchanged for a one-Google account; MCP consent and deletion with linking on; 390 px and desktop | A successful add of a method; Remove Google refused while Calendar is connected; Calendar connect from an account with no Google sign-in (acceptance row 5); acceptance row 3. Each needs a Google account that is not yet a Cadence account (owner row 16), or email live (rows 11–13) or the Apple flag plus changes to test account A |

Rows of the track's acceptance list: 1 (email part) passed under Ticket 332, Apple part under
Ticket 333 except Hide My Email; 2 passed under Ticket 332; 3 waits (above); 4 passed under
Ticket 332 (an unconfirmed address cannot reach A's account; admin-confirmed addresses here
are not that test); 5 waits on owner row 16; 6 (Mac) waits on owner rows 14 and 15 and on a
flag being on; 7 passed for an email-only account (332 and this pass); 8 passed for email-only
(332, this pass) and Apple (333) accounts; Google-account deletion passed under Ticket 334's
verifier; 9 passed: production lists Google only, and every recheck after a hosted change
passed.

## Remaining

1. Owner row 16 (new): a third Google test account, `google-test-account-c`. Unblocks the
   successful add of Google, Calendar from an account with no Google sign-in, and Remove
   Google refused while Calendar is connected.
2. Owner rows 11–13: email delivery and CAPTCHA, then the email flag rows above and A adding
   email (acceptance row 3).
3. The Apple agent's Hide My Email row; then A adding Apple on a test deployment with both
   flags on (acceptance row 3).
4. Owner rows 14 and 15: a Mac release with Ticket 336 and the test Mac database restore,
   then acceptance row 6 on the installed Mac for each enabled method.
5. When email is live: the 15-minute rule for an email-only account (it signs back in by
   email), and Change address with secure email change (two links).

## Cleanup

- E1 (`d8cad61d-…`, `t337-e1@example.com`) deleted through Settings; no `t337-` user remains.
  Hosted users 7, none without an identity, none with two Google identities.
- Test deployment removed at 20:51:42Z (`/login` then answered 404), with its share link;
  its redirect entry removed (47 entries, matching the list before the run). The two earlier
  deployments and their entries were removed the same way.
- After cleanup (20:51:56Z): kept sessions A and B ok; fresh Google sign-in to
  `app.cadence-me.com` as A returned A's user ID; login shows Google only.
- Hosted manual linking stays on (Ticket 334 step 4); every production flag stays off.

## Incident

The coordinator reported that this run replaced another agent's Apple sign-in tab in the
shared Cadence QA Chrome window twice while the owner was signing in. The cause is not
confirmed; the likely ones are the recheck script, which clears `app.cadence-me.com` cookies
in that window, and Google sign-ins there switching the shared Google session. From 20:42Z
the run used its own Chrome instance and profile (port 4437), signed A in to Google there
with the vault item, and removed the profile at the end. Lesson: acceptance runs that share
the QA Chrome window with another agent use their own profile instead.
