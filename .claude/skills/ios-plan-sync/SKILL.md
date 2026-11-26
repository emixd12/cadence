---
name: ios-plan-sync
description: Refresh the modular iOS blueprint (docs/IOS_PLAN.md and docs/ios-plan/) from web work merged since its last sync. Use when asked to sync, refresh or update the iOS plan, on the every-other-day scheduled run, or before any discussion of iOS scope, parity or activation. Never use it to start iOS implementation.
---

# iOS plan sync

`docs/IOS_PLAN.md` (hub and decision inbox) and `docs/ios-plan/` (seven modular specs)
form a running, build-ready blueprint for the future iPhone app, Apple Watch app and Mac
App Store listing. It follows web development so that when the owner activates iOS work,
the blueprint is already current and pre-packaged. This skill refreshes the blueprint; it
never starts implementation.

## Rules

- A sync edits `docs/IOS_PLAN.md` and `docs/ios-plan/*.md` only.
- When the owner decides something new about the plan, that is not a routine sync: record
  the decision in `docs/DECISIONS.md` and update the blueprint, and `AGENTS.md` / this
  skill if the procedure changes, in one docs-only pull request (`AGENTS.md`, "iOS
  running plan").
- Never edit code, `STATUS.md`, `docs/TICKETS.md`, `interaction-registry.json` or any
  ticket's "Future mobile" line.
- Allocate no ticket number and no decision number. Plan steps keep plan-local `IOS-` IDs.
- Never block, delay or comment on a web ticket, pull request or deployment.
- **Standing Port Rules (auto-port vs. ask):**
  - Auto-port routine web changes (new fields, Timeline or Behavior UI updates, Settings
    rows, shared core resolvers, Advisor/Chat updates, Mac sync contract or schema bumps)
    directly into the affected `docs/ios-plan/*.md` modules using mobile-web 1:1 parity.
  - **Only log an Open Question** in `docs/IOS_PLAN.md` ("Open questions inbox") when a
    merged web change introduces a genuine product ambiguity on an **iOS-only surface**
    (Live Activities, Widgets, Controls, Siri/Shortcuts/Spotlight, Apple Watch,
    Notifications, Location permissions) or changes **App Store / Mac App Store
    compliance** (privacy label, age rating, AI consent, auth, sandbox).
  - Never invent an owner decision; record ambiguous product choices as open with concise,
    plain-English options and a recommended default.
- Do not re-read Apple's documentation in a routine sync unless an owner decision asks for
  it. `docs/IOS_PLAN.md` ("Claims to recheck at activation") and
  `docs/ios-plan/07-build-phases.md` track claims to verify at activation.
- Write "not rechecked" or "unknown" when you did not verify a prerequisite row. Do not
  copy a state forward as if you had.
- Never write the retired email provider name substring in any doc (write "send again"
  for the verb; `npm run agents:check` rejects the substring).

## Procedure

1. Run `npm run git:fresh`. Work in a clean worktree on a new branch from `origin/main`
   (never touch uncommitted files in the main checkout).
2. Read `docs/IOS_PLAN.md`. Take the commit after "Synced through" as `<cursor>`.
3. Inspect everything merged to `origin/main` since `<cursor>`:

   ```bash
   git log --first-parent --format='%h %ad %s' --date=short <cursor>..origin/main
   git diff --stat <cursor>..origin/main -- AGENTS.md docs/DECISIONS.md docs/TICKETS.md docs/UI_SPEC.md docs/ROUTE_MAP.md interaction-registry.json docs/LEGAL.md docs/MESSAGING_CHANGES.md
   ```

4. Read these diffs in full in this session:
   - `docs/DECISIONS.md`: new decisions and owner answers.
   - `docs/TICKETS.md`: new or changed tickets and their "Future mobile" lines.
   - `AGENTS.md`: the "Product constraints" lists.
   - `docs/UI_SPEC.md` and `docs/ROUTE_MAP.md`: new screens, controls, flows or routes.
   - `docs/LEGAL.md` and `docs/MESSAGING_CHANGES.md`: entries mentioning Apple, App Store,
     iPhone, iOS, Watch, AI disclosures, privacy, location, or Mac distribution.
5. Recount the interaction registry for `docs/IOS_PLAN.md`:

   ```bash
   jq -r '.interactions[] | [(.surfaces[0]), .platforms.mobile.status] | @tsv' interaction-registry.json | sort | uniq -c
   ```

6. Recheck each prerequisite row in `docs/IOS_PLAN.md` whose evidence is a file or command
   (e.g., `localeCompare`/`toLocaleLowerCase` count in `packages/core/src`,
   `account-sync.resolver.ts`, `same_account_required`, `packages/`, `.gitignore`,
   untracked signing/sound files). Rows whose state is "Unknown" stay unknown unless
   `origin/main` now records the answer.
7. Update the affected modular files under `docs/ios-plan/` directly (keep edits surgical
   and concise):
   - `01-port-map.md`: auto-port new or changed web screens, flows, controls, tokens and
     shared rules.
   - `02-iphone-native.md`: update Live Activities, Siri/Shortcuts/Spotlight, Widgets,
     Controls, Notifications, Location or Future Roadmap if a merged change affects them.
   - `03-apple-watch.md`: update Watch snapshot/actions if Today, Needs decision, Timer or
     Notes rules changed.
   - `04-accounts-sync-offline.md`: update offline matrix, auth methods, sync contract /
     SQLite schema numbers, command contract or core prerequisites if they moved.
   - `05-mac-app-store.md`: update Mac packaging/sandbox/updater notes if Desktop release
     or Tauri capabilities changed.
   - `06-app-store-readiness.md`: update Privacy label, AI consent, legal/messaging gates
     or repo hygiene items if anything closed or expanded.
   - `07-build-phases.md`: update `IOS-` step descriptions, prerequisites or acceptance
     scenarios if a merged change closes or adds work.
8. Update `docs/IOS_PLAN.md` (the hub):
   - Parity snapshot counts and registry `updated` date.
   - Prerequisite tracker states and evidence.
   - Open questions inbox: add new plain-English questions only when triggered by the
     Standing Port Rules; close an open question only with a `docs/DECISIONS.md` citation.
   - Sync log: prepend one row with the date, new `<cursor>` and a short summary.
   - "Synced through": the new `origin/main` short SHA and date.
9. If steps 3–6 produce no meaningful change to any blueprint file, stop cleanly. Open no
   pull request and leave the cursor unchanged.
10. Otherwise run `dagger check --cadence --progress=report`, or `npm run agents:check`
    when Dagger is unavailable. Commit, open a docs-only pull request titled
    `iOS plan sync: <YYYY-MM-DD>` and turn on auto-merge (or merge on green if allowed).
11. Report in five lines or fewer: what changed in the blueprint, any new Open Questions
    for the owner (or "None"), and the pull request link.

## Activation

Activation is the owner's instruction to start iOS work. It is not part of a sync. At
activation: follow the activation checklist in `docs/ios-plan/07-build-phases.md` (recheck
claims, settle any remaining Open Questions, allocate real ticket numbers for the `IOS-`
steps, update mobile scope lines in `AGENTS.md`, `docs/PRODUCT_SPEC.md` and
`docs/PUBLIC_PRODUCT_ARCHITECTURE.md`, and transition from the every-other-day planning
refresh to real-time web→Mac→iPhone co-development).
