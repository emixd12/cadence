---
name: desktop-acceptance
description: Installed and live acceptance of Cadence for Mac. Use when building or installing a dev-signed build, running installed desktop acceptance, checking a change "on the Mac" or "on the installed app", or verifying desktop sync, Where, location or connectors against the hosted app.
---

# Cadence desktop acceptance

Run installed and live checks yourself. Ask the owner only for the steps that stay
theirs.

1. Read `AGENTS.md`, "Installed and live acceptance", for the order of methods and the
   owner-only steps.
2. Follow `docs/DESKTOP_RELEASE.md`, "Dev-signed builds" and "Agent-run installed
   acceptance": install script, read-only database queries, sync triggers, the Where
   round trip and the connector check.
3. Before asking the owner for any Mac UI step, try Computer Use (if this session has
   it) and the apple-automation skill (System Events accessibility tree). Reading the
   visible window needs no click.
4. Never quit Cadence, restore a protected database, notarize, upload or publish
   without the owner's instruction (`docs/DECISIONS.md`, 2026-10-23).
5. Send owner asks as one numbered list. If a tool is missing, name it and ask the
   owner to enable it.
