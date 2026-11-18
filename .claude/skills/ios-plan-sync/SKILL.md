---
name: ios-plan-sync
description: Update the running iOS plan (docs/IOS_PLAN.md) from web work merged since its last sync. Use when asked to sync, refresh or update the iOS plan, on the weekly scheduled run, or before any discussion of iOS scope, parity or activation. Never use it to start iOS implementation.
---

# iOS plan sync

`docs/IOS_PLAN.md` is a running plan for a future iPhone and Apple Watch app. It
follows web development. This skill brings it up to date. It starts no iOS work.

## Rules

- Edit `docs/IOS_PLAN.md` only. Edit this skill only when the procedure changes.
- Never edit code, `STATUS.md`, `docs/TICKETS.md`, `interaction-registry.json`
  or any ticket's "Future mobile" line.
- Allocate no ticket number and no decision number. Plan steps keep `IOS-` IDs.
- Never block, delay or comment on a web ticket, pull request or deployment.
- Do not decide an owner decision. Record it in A.6 as open, with the facts.
- Do not re-read Apple's documentation in a sync. A.7 lists what to recheck at
  activation.
- Write "not rechecked" or "unknown" when you did not verify a row. Do not copy
  a state forward as if you had.

## Procedure

1. Run `npm run git:fresh`. Work in a worktree on a new branch from
   `origin/main`.
2. Read Part A of `docs/IOS_PLAN.md`. Take the commit after "Synced through" as
   `<cursor>`.
3. List what merged since the cursor:

   ```bash
   git log --first-parent --format='%h %ad %s' --date=short <cursor>..origin/main
   git diff --stat <cursor>..origin/main -- AGENTS.md docs/DECISIONS.md docs/TICKETS.md interaction-registry.json docs/LEGAL.md docs/MESSAGING_CHANGES.md
   ```

4. Read these diffs in full, in this session, not through a subagent:
   - `docs/DECISIONS.md`: new decisions and owner answers.
   - `docs/TICKETS.md`: new or changed tickets. Read each "Future mobile" line.
   - `AGENTS.md`: the "Product constraints" lists.
   - `docs/LEGAL.md` and `docs/MESSAGING_CHANGES.md`: entries that mention
     Apple, the App Store or iPhone.
5. Recount the registry for A.3:

   ```bash
   jq -r '.interactions[] | [(.surfaces[0]), .platforms.mobile.status] | @tsv' interaction-registry.json | sort | uniq -c
   ```

6. Recheck each A.4 row whose evidence is a file or a command. Rows whose state
   is "Unknown" stay unknown unless `main` now records the answer.
7. Update Part A:
   - A.2: close a difference only when a recorded owner decision settles it.
   - A.3: new counts and the registry's `updated` date.
   - A.4: new states, each with its evidence.
   - A.5: one row per web addition since the baseline that the plan does not
     cover. Every web addition is in iOS scope (A.1, principle 2); the note
     says how it might land, never whether. Remove a row once Part B covers it.
   - A.9: Mac App Store inputs that `main` now records.
   - A.6: add new open decisions; mark one decided only with a `DECISIONS.md`
     reference.
   - A.8: one log row with the date, the new cursor and the changes.
   - "Synced through": the new `origin/main` commit.
8. Correct Part B in place where a merged change makes a line false. Keep the
   edit to that line or table row. Do not redesign Part B in a sync; a redesign
   needs the owner.
9. If nothing in steps 3–6 changes any section, stop. Open no pull request and
   leave the cursor where it is.
10. Otherwise run `dagger check --cadence --progress=report`, or
    `npm run agents:check` when Dagger is unavailable. Commit, open a docs-only
    pull request titled "iOS plan sync: <date>" and turn on auto-merge.
11. Report in three lines or fewer: what changed in the plan, any new open
    owner decision, and the pull request link.

## Activation

Activation is the owner's instruction to start iOS work. It is not part of a
sync. At activation: recheck A.7, settle A.6 with the owner, allocate real
ticket numbers for the `IOS-` steps, and update the mobile scope lines in
`AGENTS.md`, `docs/PRODUCT_SPEC.md` and `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.
