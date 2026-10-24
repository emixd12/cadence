# Desktop location entitlement — October 22, 2026

## State

Source only, Ticket 165. Nothing was signed, notarized, uploaded or published.
This change is split from draft PR #131 (Where-based Ticket 165 guidance), so it
can ship without the held Ticket 215 rollout. PR #131 keeps the Travel Settings
guidance, the directions plan and the full investigation in
`docs/qa/travel-release.md`.

## Finding

Signed Cadence builds enable Hardened Runtime but did not sign the Hardened Runtime
location entitlement `com.apple.security.personal-information.location`.

- Installed Developer ID Cadence 0.1.2 reports `flags=0x10000(runtime)`. Its signed
  entitlements are only the App ID, team and Keychain group. 0.1.3 was built from
  the same `Entitlements.plist`.
- Apple's Hardened Runtime documentation lists this entitlement under Resource
  Access.
- Google Chrome on the same Mac is Developer ID signed with Hardened Runtime, is
  authorized for Location Services, and signs this entitlement.
- The native Core Location adapter showed no defect.

This is well evidenced but not verified. macOS may still skip its prompt; the
manual Location Services path in PR #131 covers that case.

## Change

- `apps/desktop/src-tauri/Entitlements.plist` adds
  `com.apple.security.personal-information.location = true`.
- `apps/desktop/scripts/verify-entitlements.py` accepts that key without
  provisioning-profile authorization and requires it to be `true`. The shipped
  "Cadence Desktop Developer ID" profile grants only the App ID, team and Keychain
  group, so without this change the next production build would fail verification.
- `tests/desktop-release-entitlements.test.ts` covers the profile-free key, a false
  value, an unlisted runtime exception and the repository plists.

Previews stay ad hoc signed without entitlements, so a preview cannot test this.

## Version proposal

Recommended: ride the 0.1.4 stable update. Version 0.1.4 already needs a new signed
build, artifact verification and installed checks before publication
(`2026-10-21-desktop-0.1.4-preparation.md`). Merge this change before choosing the
0.1.4 release commit. The 0.1.4 candidate is then the test build, and the prompt
test below joins its installed checks. No extra version is needed.

Fallback, only if the prompt test must run before the 0.1.4 release commit is
chosen: build an unpublished prerelease `0.1.4-rc.1` in an isolated checkout, as
with `0.1.1-rc.1` to `rc.3`. Set the version only in that checkout's
`apps/desktop/src-tauri/tauri.conf.json`; never commit, upload or publish it.
SemVer orders `0.1.3 < 0.1.4-rc.1 < 0.1.4`. So the prerelease cannot equal any
published version, the 0.1.3 stable feed never offers it a downgrade, and the
published 0.1.4 update supersedes it. Use the next rc number for any rebuild.

## Build commands, after owner approval

Run from a clean, isolated checkout of the chosen main commit with Node 24. Do
not reuse the 0.1.3 checkout or its `apps/desktop/.release/` evidence. `build`
submits the app and DMG to Apple for notarization; that is the owner-gated step.

```bash
node apps/desktop/scripts/release.mjs check
node apps/desktop/scripts/release.mjs build
node apps/desktop/scripts/release.mjs verify apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle
codesign -d --entitlements - --xml apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Cadence.app | plutil -p -
```

`build` already runs the strict artifact checks; the standalone `verify` repeats
them. The last command must list
`com.apple.security.personal-information.location => true`.

Environment, names only: `APPLE_SIGNING_IDENTITY`; one notarization set
(`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, or `APPLE_API_ISSUER`,
`APPLE_API_KEY`, `APPLE_API_KEY_PATH`); `CADENCE_APPLE_PROVISIONING_PROFILE`;
`TAURI_SIGNING_PRIVATE_KEY` and its password if set; `CADENCE_UPDATER_PUBLIC_KEY`;
`CADENCE_UPDATER_ENDPOINT` set to
`https://github.com/emixd12/cadence/releases/download/desktop-stable/latest.json`;
`VITE_SUPABASE_URL`; `VITE_SUPABASE_PUBLISHABLE_KEY`; and
`VITE_CALENDAR_BROKER_ORIGIN` set to `https://app.cadence-me.com`.

## Owner prompt test

Do not reset TCC or change global location settings. Record no coordinates and no
map screenshots.

Main check, on a never-authorized macOS user:

1. Use a new standard macOS user on either Mac, or a Mac that never ran Cadence.
   `locationd` keys its clients by user and bundle, so a new user should be a fresh
   client (inferred from log keys, not verified). Confirm Location Services is on
   and Cadence is not listed.
2. Install the candidate from its DMG and open it. Local mode is enough; no
   account, Calendar or Google Maps call is needed.
3. Open Settings, Travel. Keep Cadence frontmost and choose **Check device location
   permission** (the main-branch panel still has this button; Ticket 215 replaces
   it). Within 12 seconds record whether macOS asks to allow Cadence to use your
   location.
4. If it asks, choose Allow. Record "A current position is available. This check
   did not save or send it." and "Device location: allowed."
5. If it does not ask, record the status line and diagnostic, and whether Cadence
   now appears in Location Services. Turn on Cadence there by hand, return to
   Cadence and choose Check device location permission again. Record the result.
6. Denial: turn Cadence off in Location Services, return and check again. Record
   "Device location: blocked."

Optional, on the first Mac's main user, with this main-based candidate only:

7. Main has no desktop SQLite migration and no local store change after the 0.1.3
   source (`dcefe7e`), and no Where synchronization contract. A linked account
   therefore stays compatible, and reinstalling the published 0.1.3 DMG rolls back.
   Never install a build from the Ticket 215 branch on a linked account before the
   hosted Where migration.
8. Before installing, note whether Location Services lists Cadence and whether its
   switch is on. Quit Cadence, keep the 0.1.3 DMG for rollback, then install the
   candidate.
9. Repeat step 3. Record whether a prompt appears for this existing client entry.
   The check does not turn on travel or change saved settings.

Record the candidate version, `codesign -dv` flags, macOS version, Mac model and
whether the user was new.
