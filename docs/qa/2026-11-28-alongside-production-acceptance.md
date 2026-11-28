# Alongside Production, Mac, and MCP Acceptance: Ticket 365 (November 28, 2026)

Follows the local-stack acceptance in `docs/qa/2026-11-26-alongside-local-acceptance.md` for
D33 and D37 (`docs/DECISIONS.md`, 2026-11-25), Tickets 356–365 and 383–386.

## Environment and rollout

| Item | Value |
|---|---|
| Merged commit | `f9ad52a8` (PR #407) |
| Hosted migrations | `20261126200000`–`20261126260000` pushed to hosted Supabase on November 28, 2026 (owner approved; local and remote histories match) |
| Advice card | `do-it-during-something-else` (Ticket 385) reviewed and activated by owner (`reviewer: "Emi"`, `reviewed_at: "2026-11-28"`) |
| Production flag | `CADENCE_ALONGSIDE=on` set in Vercel Production and redeployed (`cadence-4ewyaj6ur-emis-projects-4c886aeb.vercel.app`, aliased to `https://app.cadence-me.com`) |
| Test Mac | `test-mac` (`macOS 27.2.1 (26B131) arm64 Mac14,10`), upgraded from published `0.1.18` to dev-signed `0.1.19-dev.1` built with `VITE_CADENCE_ALONGSIDE=1` (`binarySha256: 5f8a7b1785347d418be98833c28c7bb2a36e0d299aeee6762dd0eed455454c2d`, SQLite schema 30, account sync contract 11) |
| Test accounts | Test account A (web, `test-mac`, MCP) and test account B (MCP isolation) |

## Results

### 1. Hosted Production web (test account A, `CADENCE_ALONGSIDE=on`)
- `GET https://app.cadence-me.com/api/behaviors/alongside` returned HTTP `200` with `enabled: true`.
- `/behaviors` → **Create behavior** rendered **Can be done alongside other things** with options `Not answered`, `Yes`, `No`.
- Created `"Alongside QA 2026-11-28"` with `alongside = Yes` (browser notifications off). On `/timeline`, the **Alongside** (`data-alongside="person"`) label rendered across all 8 visible days.
- Cleaned up afterwards by archiving `"Alongside QA 2026-11-28"`.

### 2. Installed Mac acceptance on `test-mac` (`0.1.19-dev.1`, `VITE_CADENCE_ALONGSIDE=1`)
- Preflight: `npm run qa:preflight -- --suite desktop-test-mac` exited `0` (8/8 ready).
- Pre-upgrade backward compatibility: published `0.1.18` (schema 28, contract 9) synced cleanly at `2026-11-28T06:05:37.032Z` after all 7 hosted migrations were pushed (`pending = 0`, 73 Behaviors, 273 Occurrences).
- Dev-signed `0.1.19-dev.1` install: verified `codesign --verify --strict`, `CFBundleShortVersionString = 0.1.19-dev.1`, and matching `binarySha256`.
- Schema upgrade 28 → 30: `PRAGMA integrity_check = ok`, `PRAGMA foreign_key_check = 0`, `behaviors.alongside` column (`INTEGER`) added, 73 Behaviors and 273 Occurrences preserved, 0 pending outbox writes, launch sync succeeded at `2026-11-28T06:07:29.794Z`.
- Live UI gate: in **Behaviors → Create behavior**, `test-mac` rendered `Can be done alongside other things` (`Not answered`), confirming both `VITE_CADENCE_ALONGSIDE=1` and hosted `GET /api/behaviors/alongside` (`enabled: true`).
- Web → Mac sync round-trip: after creating `"Alongside QA 2026-11-28"` (`alongside = Yes`) on Production web, relaunching `test-mac` synced at `2026-11-28T06:14:53.365Z` and wrote `Alongside QA 2026-11-28|1` into `test-mac`'s SQLite schema 30 (`pending = 0`, `fk_errors = 0`).

### 3. Production MCP acceptance (`https://app.cadence-me.com`, `CADENCE_ALONGSIDE=on`)
- **Tier 0 (`prod-20261128-t0`):** all 5 alongside protocol checks passed (`alongside-unanswered-on-create` = `null`, `update-alongside`, `alongside-saved`, `get-alongside`, `alongside-read-back`), `tools-list-equals-registry` passed (`count=30 apps=off`), cross-account isolation passed, and all 5 grants were revoked cleanly (`all-grants-revoked`). Two unrelated `list_behaviors` page-1 assertions failed because test account A holds 73 Behaviors (> default page size 50); `get_behavior` and `search` found the created Behavior.
- **Tier 1 (`prod-20261128-t1`, US$5 spend cap authorized):** **3/3 active clients passed, 0 failures** (`claude-code: pass`, `anthropic-api: pass`, `openai-api: pass`; `inspector` skipped only because `@modelcontextprotocol/inspector@2.13.0` was not locally cached; `claude-ai` connector grant not run).

### 4. User guide
- Added alongside Behaviors and guessed Where documentation to `docs/user-guide/behaviors-and-review.md` and `docs/user-guide/timeline.md`.

## Remaining release gates (owner decisions)
- Published notarized Cadence for Mac release (next version `0.1.19` with `VITE_CADENCE_ALONGSIDE` enabled once the owner decides to ship Mac alongside to users; `0.1.19-dev.1` is dev-signed only and never published).
- Folding MCP contract 1.9.0 alongside schema into the public developer reference and messaging pass (`P-093`, `P-103`).
