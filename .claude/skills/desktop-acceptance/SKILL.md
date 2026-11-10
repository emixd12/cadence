---
name: desktop-acceptance
description: Installed and live acceptance of Cadence for Mac. Use when building or installing a dev-signed build, running installed desktop acceptance, checking a change "on the Mac" or "on the installed app", or verifying desktop sync, Where, location or connectors against the hosted app.
---

# Cadence desktop acceptance

Run installed and live checks yourself. Ask the owner only for the steps that stay
theirs.

1. Start with the test-access preflight for the run's suite: `desktop-owner-mac`
   (dev-signed build and checks on the owner's Mac), `desktop-test-mac` (test Mac as
   test account A) or `desktop-release` (notarized release). List every suite the run
   reaches, comma-separated, so the owner gets one list:
   `npm run qa:preflight -- --suite desktop-owner-mac --run-dir .intent/acceptance/<run-id>`.
   Exit 0: go on. Exit 10: send its numbered owner list as one message, end your turn,
   rerun after the owner answers. Exit 11: a probe or renewal failed; fix it yourself.
   Details: `docs/qa/agent-secrets.md`, "Test-access preflight".
2. Read `AGENTS.md`, "Installed and live acceptance", for the order of methods and the
   owner-only steps.
3. Follow `docs/DESKTOP_RELEASE.md`, "Dev-signed builds" and "Agent-run installed
   acceptance": install script, read-only database queries, sync triggers, the Where
   round trip and the connector check.
4. Before asking the owner for any Mac UI step, try Computer Use (if this session has
   it) and the apple-automation skill (System Events accessibility tree). Reading the
   visible window needs no click. On a test device, `node scripts/test-device.mjs
   screenshot <device> <file>.png` shows what accessibility cannot (for example the
   next-trip marker); keep the file outside the repository and delete it after reading.
   Clicking a notification banner still needs the owner (`docs/TEST_DEVICES.md`).
5. Never quit Cadence, restore a protected database, notarize, upload or publish
   without the owner's instruction (`docs/DECISIONS.md`, 2026-10-23).
6. Sign-in, credential, consent and permission asks come only from the preflight's
   list. Agents sign Cadence for Mac in as test account A on test devices
   (`docs/DECISIONS.md`, 2026-11-07). Send any other owner ask, such as quitting
   Cadence, as one numbered list. If a tool is missing, name it and ask the owner to
   enable it.
