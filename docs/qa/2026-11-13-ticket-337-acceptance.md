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

## Second pass: freeing test account B (not done)

The coordinator proposed freeing B's Google identity for a while: export B, delete B's Cadence
account, run the three remaining linking rows with B's Google account, then rebuild B. Checked
20:55Z, read-only. **B was not touched**, for these reasons:

1. **B's user ID is fixed in code and in retained hosted evidence.** `c05b0d9d-…` is a constant in
   `scripts/mcp-session-broker.mjs` (`ACCOUNTS.B`), `scripts/acceptance/watch.mjs`,
   `scripts/mcp-hosted-fixtures.entry.mjs`, `scripts/mcp-fixture-cleanup.mjs`,
   `scripts/mcp-acceptance-cleanup.mjs`, `tests/mcp-hosted-fixtures.test.mjs` and
   `docs/qa/mcp-server.md`. A rebuilt B gets a new user ID, so every MCP acceptance tool would
   refuse B until a code change lands.
2. **B holds MCP hosted fixtures that must not be replaced.** `mcp-hosted-fixtures.entry.mjs`
   keeps the October 28 capture for A and B ("never replace that baseline"). Deleting B removes
   those rows by cascade. An export and BehaviorLog import create new row IDs, so they cannot
   restore the fixtures. Re-seeding hosted fixtures uses the MCP signing key, which needs the
   owner's approval each time (`docs/qa/agent-secrets.md`).
3. **B's Google account is the owner's own address,** not an agent-made test identity.
   Deleting and recreating a Cadence account on it is not an agent step.

B today: 3 Behaviors, 13 Occurrences, 9 Categories, 4 status events, one Google identity,
created September 17, 2026. The three rows stay on owner row 16 (a third Google test account).
Using A instead has the same problems, plus A's Calendar connection and the test Mac's link.

## Verification of PR #273 (direct Supabase calls with every flag off)

Run November 13, 2026, 20:55–21:03Z, by the PR #273 verifier. Run folder (git-ignored):
`.intent/acceptance/v337-verify/` in the Intent workspace worktree (`evidence.jsonl`,
`probe.mjs`). No hosted setting changed. Hosted Auth read before and after: manual linking
on, secure email change on, email and Google and Apple providers on, SMTP host not set,
CAPTCHA off, 47 redirect entries with no test-deployment entry, trigger
`keep_one_auth_identity` enabled with the Calendar rule. The four test deployments of Tickets
333 and 337 answer 404. Production `/api/auth/sign-in-methods` lists Google only.

A throwaway email-only user (`v337-v1@example.com`, admin-created, no email sent) called
Supabase Auth directly with the public key and its own session:

| Call | Result |
|---|---|
| Unlink its only identity | 422 `single_identity_not_deletable` |
| Start linking Google or Apple (`/user/identities/authorize`) | 200, a provider URL: flags do not gate the Auth endpoint |
| Finish linking test account A's Google (owned by another account), in the verifier's own Chrome profile | Supabase redirected to `/auth/callback` with `identity_already_exists`; nothing linked |
| Unlink a Google identity while a Calendar connection names it (identity and connection rows written for the throwaway user) | 500 `cadence_calendar_connected` from the trigger; both identities kept |
| Two unlinks at once, 4 trials | One 200 and one 422 each time; one identity always kept |
| Start Apple sign-in with no session (`/authorize?provider=apple`) | 302 to Apple: anyone can start Apple sign-up while `CADENCE_SIGN_IN_APPLE` is off |

The user was deleted after. Hosted users 7, none without an identity, none with more than one.
Afterwards a fresh Google sign-in as A in the verifier's profile reached `/timeline` as A, and kept
sessions A and B answered "session ok".

Reachable with every flag off, through direct calls only, each limited to the caller's own
account. Items 1–3 are read from the code and the results above, not run end to end: no
Google or Apple identity outside a Cadence account was available.

1. Link a second method the caller owns (Apple, or a second Google account). The app has no
   Settings row to show or remove it with the linking flag off. A linked Apple identity skips
   Cadence's callback, so no Apple refresh token is kept for revocation on deletion (L-025).
2. Then unlink Google, leaving Apple only. The login page offers Google only, so the account is
   reachable only through a direct Apple sign-in, and Continue with Google with that Google
   account creates a new account.
3. A second Google identity makes Calendar report `multiple` and refuse event reads
   (`calendarGoogleSubject`) until the caller unlinks one directly.
4. Apple sign-up through `/authorize` creates an Apple-only account while the Apple flag is off
   (the hosted Apple provider is on).

No call reached another account, removed the last identity, or removed a Google identity a
Calendar uses. Cadence's 15-minute recent sign-in rule does not cover direct calls (already
noted in the Ticket 334 change list, step 4).

## Third pass: the remaining linking rows with the owner's spare Google accounts

Run November 13, 2026, 21:04–21:33Z, by a top-level agent with the owner present. Run folder
(git-ignored): `.intent/acceptance/t337/p3/` in the Intent workspace worktree (`evidence.jsonl`,
`rechecks.jsonl`, `auth-p3-*.json`, `shots/`, scripts `hosted.mjs`, `drive.mjs`). Addresses
are masked to their domain; Google subjects are recorded as 16-character SHA-256 prefixes.
No token, link or bypass value was printed or kept; the session files were deleted at the end.
**No production flag was turned on.**

### Setup

- **Test deployment:** an unaliased production-target build of `origin/main` `e5441797` with
  `CADENCE_SIGN_IN_LINKING=on` and `CADENCE_SIGN_IN_EMAIL=on` (both for that deployment only;
  email was on only so a one-time sign-in link would work in any browser; no email was sent),
  aliased to `cadence-t337-linking.vercel.app`. For that deployment only,
  `GOOGLE_CALENDAR_LEGACY_CALLBACK_URL` named the alias's Calendar callback, so Cadence would
  start Calendar there (`readCalendarOAuthConfig` refuses an origin that is not a configured
  callback). Google refuses that callback (`redirect_uri_mismatch`, seen once), so **the Calendar
  consent itself ran on `app.cadence-me.com`**, where the production code connects an account
  with exactly one Google sign-in whatever the flag.
- Redirect allow-list entry `https://cadence-t337-linking.vercel.app/auth/callback**` added and
  removed. Vercel's shareable link does not apply to an alias; the project's automation bypass
  cookie was used in the agent's window instead, and the owner passed Vercel's own sign-in.
- **Throwaway accounts:** `t337-p3a@example.com` (`ff8042b8-…`) and `t337-p3b@example.com`
  (`a933136e-…`), created with the Auth admin API (`email_confirm: true`). They signed in on the
  test deployment through `/login/confirm?token_hash=…` with an admin-generated magic-link
  hash (no email sent): in the agent's own Chrome profile, and opened by the agent in the
  owner's everyday Chrome profile, where the owner's spare Google accounts were signed in.
- **Google clients:** linking uses the sign-in client (project `habit-tracker-498717`,
  scope `email profile`, Supabase callback); Calendar uses `cadence-calendar-498717`, In
  production and verified. The sign-in project's publishing status cannot be read through an
  API; the spare accounts were not refused.
- The owner used the everyday profile instead of a dedicated window. The agent could not
  drive or read it, so the owner clicked there, and every result was read from the hosted
  database and API. The removal and deletion rows ran in the agent's own profile (port 4438).

### Rows

| Row | Result | Evidence |
|---|---|---|
| Calendar for an account with no Google sign-in adds Google first (D31.5) | **Passed.** p3a (email only): the Calendar panel said "Connecting adds the Google account you choose as a way to sign in to Cadence."; Connect started Supabase linking with the sign-in client; the owner chose a spare Google account (outlook.com address); p3a gained a Google identity at 21:17:00Z. Repeated for p3b with a second spare (gm.slc.edu): Google identity at 21:27:07Z. No Cadence account used either address beforehand (checked by address) | `calendar-p3a-start`, `p3-calendar-start-probe-2`, `sql-p3times`, `spare-check` |
| Adding Google reaches the same account on the next sign-in (row 1) | **Passed.** On `app.cadence-me.com`, Continue with Google signed p3a in at 21:21:00Z and p3b at 21:27:45Z, each the same user ID with both identities | `sql-recent` |
| Calendar connects for that account | **Passed** for p3b: connected, generation 1, one sealed credential, bound to the added Google subject | `calendar-row` (21:28:10Z), `calendar-p3b-connected` |
| Remove Google refused while Calendar is connected (row 3) | **Passed.** At 390 and 1280 px, Remove → Remove Google showed "Google Calendar uses this Google account. Disconnect Google Calendar first, then remove Google."; both identities kept; no horizontal overflow | `remove-ui-p3b-calendar-connected`, `…-desktop`, `shots/remove-*` |
| A direct Supabase unlink is refused by the database | **Passed.** `DELETE /auth/v1/user/identities/{google}` with p3b's own token: 500, `P0001` `cadence_calendar_connected`; both identities kept | `unlink-direct-p3b-calendar-connected` |
| Disconnect Calendar (row 4) | **Passed.** Disconnect → Disconnect: `DELETE /api/google-calendar/connection` 200; row `disconnected`, generation 2, credential deleted. The service revokes the grant at Google during that call; the page's message, which says whether Google confirmed the revocation, was not captured | `calendar-disconnect-p3b`, `calendar-row` (21:30:42Z) |
| After disconnect, Google can be removed; the last method cannot | **Passed.** Remove Google: "Google removed. It no longer signs in to this account."; identities `email`. A removal post for the email identity: "Email stays while this account has an address. You can change the address."; a direct unlink of it: 422 `single_identity_not_deletable`. The account still works: Timeline 200; signed out (API 401) and back in by link | `remove-ui-p3b-after-disconnect`, `remove-p3b-last-method`, `unlink-direct-p3b-last-identity`, `timeline-p3b-after`, `signout-p3b`, `confirm-p3b` |
| Deletion frees the Google accounts (row 5) | **Passed.** p3b and p3a (p3a still had its Google identity) deleted through Settings at 390 px: `/login`, session 401, old token 403. Afterwards, for both Google subjects: identities 0, Calendar rows 0, users and identities on the address 0, so a new Google sign-in would create a fresh account (not done) | `account-deletion-p3b`, `account-deletion-p3a`, `subject-gone` ×2 |

### Incident: an extra account

At 21:23:02Z, during the Calendar step, the owner's Google sign-in on `app.cadence-me.com` used
the gm.slc.edu account, which then had no Cadence account, so it **created a new Cadence
account** (`e7131d5e-…`, 0 Behaviors), and Calendar connected there. The owner disconnected
Calendar and deleted that account through Settings (gone at 21:26:40Z), and the gm.slc.edu
account was then used for p3b. Cause: the Google chooser in the everyday profile lists several
accounts, and step 2 sent the owner to `/login` with a Google session that could pick any
of them. Lesson: name the exact account at each chooser, and check the hosted users after
every owner step.

### Cleanup and rechecks

- Both throwaway accounts deleted; no `t337-p3` user remains. Hosted users 8, none without an
  identity, none with two Google identities. The eighth is an agentmail.to email account
  that another agent created at 21:29:42Z.
- Test deployment and alias removed (`/login` 404 on both at 21:33Z); the first build of this
  pass (`cadence-72yp8om31`) was removed when the second replaced it. Redirect entry removed.
  The allow-list then had 48 entries: another agent's test-deployment entry
  (`cadence-75492nx23`) was added during the run and left in place. Hosted SMTP and CAPTCHA
  changed to on during the run, by another agent.
- 21:32:40Z: kept sessions A and B ok; a fresh Google sign-in as A in the agent's profile reached
  A's user ID; production login shows Google only.
- The agent's Chrome (port 4438) was closed and its profile deleted.

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
| `CADENCE_SIGN_IN_LINKING` | Hosted manual linking on; Sign-in methods row for Google-only and email-only accounts; neutral refusal of a Google account owned by another account (real Google chooser); 15-minute rule with return to the row; last-method refusal; Calendar unchanged for a one-Google account; MCP consent and deletion with linking on; 390 px and desktop. Third pass: Google added from the Calendar panel to email-only accounts, the same account on the next Google sign-in, Calendar connected, Remove Google refused while connected (UI and database), disconnect, removal afterwards, deletion freeing the Google account | Adding Google from Sign-in methods › Add Google ran only to Google's chooser (same `startAddSignInMethod` as the Calendar path). Acceptance row 3 for email and Apple waits on those flags |

Rows of the track's acceptance list: 1 (email part) passed under Ticket 332, Apple part under
Ticket 333 except Hide My Email; 2 passed under Ticket 332; 3 waits (above); 4 passed under
Ticket 332 (an unconfirmed address cannot reach A's account; admin-confirmed addresses here
are not that test); 5 passed in the third pass; 6 (Mac) waits on owner rows 14 and 15 and on a
flag being on; 7 passed for an email-only account (332 and this pass); 8 passed for email-only
(332, this pass) and Apple (333) accounts; Google-account deletion passed under Ticket 334's
verifier; 9 passed: production lists Google only, and every recheck after a hosted change
passed.

## Remaining

1. Owner row 16 is no longer needed for the linking rows: the third pass used the owner's
   spare Google accounts. A vault item `google-test-account-c` would still let agents repeat
   these rows alone.
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
  its redirect entry removed (47 entries: the four permanent non-local entries plus the local
  ones; the run started at 48 because Ticket 333's test-deployment entry, `cadence-311hbjk9f`,
  was still listed, and the Apple agent removed it during the run). The two earlier
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
