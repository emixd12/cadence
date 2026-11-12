# Internal QA-only interactions

This appendix is for controlled development and QA environments. Its controls
are intentionally unavailable in production and are not part of the public
user workflow.

## INT-AUTH-002: Continue as a temporary test user

**Prerequisites:** Run on `localhost`, outside production, with
`CADENCE_ENABLE_TEST_LOGIN=1`, valid public and service-role Supabase server
configuration, and an authorized test database. If the configured Supabase URL
is hosted rather than local, `CADENCE_ALLOW_HOSTED_TEST_LOGIN=1` is also an
explicit safety gate. Never enable or exercise this route against production.

1. Open `/login` in the allowed environment.
2. Confirm the copy **Local QA only.** and the control
   **Continue as temporary test user** are visible.
3. Activate **Continue as temporary test user** with a sanitized local `next`
   route if a specific protected destination is required.
4. Confirm that Cadence creates and signs in a disposable
   `cadence-test-...@example.invalid` account through the ordinary auth session
   and RLS path, then opens the safe destination.

**Result and persistence:** The route creates a confirmed disposable Supabase
Auth user, signs it in with a generated password, and establishes the normal
session cookie. If sign-in fails after creation, the route attempts to delete
the created user. A successful account remains until explicitly cleaned up.

**Recovery and cleanup:** If a safety gate fails, Cadence returns to `/login`
with a factual unavailable error and creates no user. After QA, delete the
disposable account through the normal **Delete account** flow or the approved
test-fixture cleanup path, then verify the synthetic user and owned records are
gone. Do not retain generated credentials in logs or screenshots.

**Safety:** The hosted-Supabase allow flag is not blanket authorization to
mutate a shared project. Use only a task-approved synthetic account and never a
personal identity. The temporary-login action must remain hidden and refused
in production.

**Keyboard and viewport:** The control is a normal link and works with Tab plus
Enter at desktop and mobile widths.

## INT-SHELL-007: Preview the login screen while authenticated

**Prerequisites:** Be authenticated. The app shell exposes **Preview login**
only outside production. In production, open `/login?preview=1` directly.

1. Outside production, activate **Preview login** from the desktop rail or
   mobile drawer. Its accessible name is **Preview login screen**. In
   production, open `/login?preview=1` directly.
2. Confirm that `/login?preview=1` renders while the current protected path is
   retained as the safe `next` value.
3. Inspect the login screen without completing an unnecessary provider flow.
4. Use browser Back or the retained app destination to return to the protected
   app.

**Result and persistence:** Only navigation changes. The authenticated session
and product records remain unchanged. A `/login` request without `preview=1`
keeps the normal authenticated redirect behavior.

**Recovery:** Use browser Back. If an environment unexpectedly loses the
session, sign in through the normal test identity and record the environment,
route, and cookie behavior as a QA issue.

**Safety:** Login preview is for visual and interaction QA, not an account
switcher. Do not start Google OAuth with an unintended account merely to leave
the preview.

**Keyboard and viewport:** In the mobile drawer, focus remains trapped until
the link navigates. The link works with Tab plus Enter in expanded and
collapsed desktop navigation and at mobile widths.

## INT-SETTINGS-019: Connect ChatGPT to use your ChatGPT plan

**Prerequisites:** A Cadence for Mac build made with `VITE_CADENCE_CHATGPT_PLAN=1`, linked
to a Cadence test account. The switch is off by default and stays off in shipped builds
(owner decision, November 12, 2026). Hosted plan briefs also need
`CADENCE_DAILY_BRIEF_DEVICE_MODEL` on the target deployment, which stays unset in
production. Use only a test ChatGPT account.

1. Open **Settings › Planning** and find **Use your ChatGPT plan**.
2. Activate **Continue with ChatGPT**. ChatGPT sign-in opens in the system browser; the
   card shows **Finish signing in to ChatGPT in your browser.** and **Cancel ChatGPT
   sign-in**.
3. Finish sign-in. The card shows the ChatGPT email and **Using ChatGPT plan**. The first
   connection with plan usage shows **You’re using your ChatGPT plan** with **Got it**.
4. The Daily Brief's reconnect and plan-usage-off states offer the same **Continue with
   ChatGPT** control; a finished sign-in there retries the brief.

**Result and persistence:** Rust keeps the tokens in the `chatgpt-session` Keychain item.
The webview sees only the state and email, and holds the access token in memory for one
model call. The one-time confirmation sets a local flag with no account data.

**Recovery and cleanup:** A cancel, timeout or denial saves nothing. Disconnect with
**Disconnect ChatGPT** after QA.

## INT-SETTINGS-020: Manage ChatGPT usage

**Prerequisites:** As INT-SETTINGS-019, with ChatGPT connected with plan usage.

1. Activate **Manage usage** on the card, on the Daily Brief's **Using ChatGPT plan** line,
   or as the primary action of the Daily Brief's usage-limit notice.
2. Confirm that `https://chatgpt.com/settings/usage` opens in the system browser.

**Result and persistence:** Only the system browser opens. Cadence sends nothing.

## INT-SETTINGS-021: Disconnect ChatGPT

**Prerequisites:** As INT-SETTINGS-019, with ChatGPT connected.

1. Activate **Disconnect ChatGPT**.
2. Confirm **ChatGPT is disconnected.** and that **Continue with ChatGPT** returns.

**Result and persistence:** Rust revokes the refresh token at OpenAI, then removes the
`chatgpt-session` Keychain item; the installation item stays. Disconnecting the Cadence
account does the same first. If OpenAI does not confirm the revocation, the local tokens
are still removed and the card says Cadence may still be listed in ChatGPT settings.
