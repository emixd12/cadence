# Cadence Project and Repository Rename Implementation Plan

> **Execution:** Owner-authorized October 7, 2026. Execute serial cutovers with verification between them; independent backup and compatibility preparation may proceed before relocation.

**Goal:** Rename the project folder and GitHub repository to `cadence` while preserving work, account data, deployment identities, downloads, and historical evidence URLs.

**Source of truth:** The owner's October 7, 2026 request and explicit choice to preserve historical URLs through an archive site. Governing documents: `AGENTS.md`, `STATUS.md`, `docs/OPERATIONS.md`, `docs/VERCEL_WORKFLOW.md`, `docs/PUBLIC_REPOSITORY_RELEASE.md`, `docs/DESKTOP_RELEASE.md`, and `docs/SUPABASE_WORKFLOW.md`.

**Architecture:** Rename the existing resources in place. Keep runtime identities and production domains stable. Use a static GitHub user-site archive to retain historical Pages URLs; keep new evidence publication in the renamed repository.

**Tech Stack:** Git, GitHub Actions/Pages/Releases, Codex, Popmelt, Next.js, Astro, Vercel, Tauri, and the existing Supabase CLI setup.

---

## October 7 execution amendments

The owner approved retaining `habit-tracking-app` as an old-path compatibility
symlink after moving the physical directory to `cadence`. Codex's display-name
edit retained the same project ID and chats. The symlink keeps existing source
bindings operational; removing it is gated on verified consumer migration.
This replaces the pre-move requirement to reassociate every old chat path.
Use an authorized atomic directory/link swap, verify the same inode and files,
repair worktrees, and retain an executable reverse swap. Never use the link to
bypass filesystem permissions or claim that old path references disappeared.

The release base is the already-deployed app commit `9eda5c0`, not older `main`.
The migration patch must preserve its ten deployed commits. Marketing content is
unchanged between those bases. Record and verify production source metadata and
reconcile default-branch history before staging/promotion or scheduled publication.

## 1. Scope and fixed decisions

| Item | Current | Target / decision |
| --- | --- | --- |
| Local project folder | `/Users/emi/Coding Projects/habit-tracking-app` | `/Users/emi/Coding Projects/cadence` |
| Parent directory | `/Users/emi/Coding Projects` | Unchanged |
| GitHub repository | `emixd12/habit-tracking-app` | `emixd12/cadence`; rename the existing repository |
| Repository identity | GitHub ID `1261353608` | Preserve this ID |
| Git remote | `git@github.com:emixd12/habit-tracking-app.git` | `git@github.com:emixd12/cadence.git` |
| New evidence root | `https://emixd12.github.io/habit-tracking-app/` | `https://emixd12.github.io/cadence/` |
| Historical evidence URLs | Existing `/habit-tracking-app/trust/...` paths | Preserve exact URLs and file bytes through `emixd12/emixd12.github.io` |
| Vercel projects | `cadence`, `cadence-marketing` | Preserve names, IDs, settings, and domains |
| Desktop identity | `Cadence`, `app.cadence.desktop`, `cadence:` | Preserve all three |
| Local Supabase identity | `habit-tracking-app` | Preserve project ID, Docker labels, containers, and volumes |
| Hosted identity | Existing Supabase, Google OAuth, Sequenzy, push, and Apple configuration | Preserve |
| Package names | `cadence-tracker`, `@cadence/core`, `@cadence/ui`, existing workspace names | Preserve |

The owner selected exact historical URL preservation during planning. This authorizes that design in this plan; planning performs no repository creation or publication.

Do not create a replacement GitHub repository named `habit-tracking-app`. GitHub warns that reusing the old name removes repository redirects. The archive repository has the different name `emixd12.github.io`.

Do not rewrite historical commits, signed release archives, provenance records, old QA observations, or conversation transcripts. Update current operational references and record the migration separately.

## 2. Verified baseline and audit limits

Evidence below was inspected on October 7, 2026. Recheck dynamic values immediately before execution.

| Surface | Finding |
| --- | --- |
| GitHub | Repository is public, unarchived, default branch `main`, and the authenticated account has admin access. |
| Name availability | Authenticated lookups returned 404 for `emixd12/cadence` and `emixd12/emixd12.github.io`. This is not a reservation. |
| Local destination | `/Users/emi/Coding Projects/cadence` did not exist. |
| Main checkout | Branch `claude/tickets-169-173-advisor-analysis`; HEAD `190d875cfddd24e9821c2fab1216eff3d5669f97`. |
| Uncommitted work | 17 tracked paths differ, including a deletion. These changes belong to other work. |
| Worktrees | One existing detached `apple-distribution` worktree points into the main checkout's `.git`. Five other registrations are prunable. |
| GitHub Pages | Actions source, HTTPS enabled, no custom domain; current root is the old repository path. |
| Trust configuration | `TRUST_PAGES_ORIGIN` contains the old URL at repository scope and in both `public-trust-preview` and `public-trust-production`. |
| Trust history | Public `snapshots.json` contains 37 entries. Both the index and `latest.json` returned HTTP 200. Individual historical files remain to be inventoried and hashed. |
| Existing freshness | Latest evidence reports September 26, 2026. Existing stale evidence must not be reported as a rename regression or relabeled fresh. |
| Trust history code | The downloader rejects URLs outside the current Pages path. The input preparer and collector require Pages paths matching the repository name. |
| GitHub hooks | Repository hooks API returned an empty list. This does not inventory GitHub App installations or external integrations. |
| Desktop feeds | Public preview feed advertises `0.1.1-preview.24`; QA feed advertises `0.1.1-rc.3`. Both contain old repository download URLs and signatures. |
| Desktop release assets | Both release channels exist. Some assets are deliberately invalid QA fixtures. They must never become install candidates. |
| Vercel | Connector confirmed project IDs `prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs` and `prj_BLlsxoaz1wSvWuK7xcZLLkHglQcR`, both on Node 24. |
| Vercel audit limit | Connector summaries did not expose complete Git linkage or authoritative production alias state. Record these before cutover. |
| Codex | Saved project, trusted-project table, environment selection, chat writable roots, and other references contain the old path. |
| Automations | `cadence-google-review-follow-up` and `cadence-notarization-status` contain old paths. Both are PAUSED. |
| Popmelt | Project-local `.popmelt/` contains memory and conversations. Current primary store is `store-7b732c2eb477`. Bridge association uses the old root. |
| Other references | Design-system manifests contain absolute roots. Current app, marketing, release, legal, and briefing-reference files contain old repository URLs. |
| External scan limit | A bounded scan found no matching references in BehaviorLog-Bundle, LaunchAgents, and selected shell/Git files. This was not a whole-device audit. |

No rename, setting change, release, schema change, workflow dispatch, or desktop installation occurred during planning.

## 3. Risk register and closure evidence

| Risk | Prevention | Required evidence |
| --- | --- | --- |
| Lost uncommitted or ignored files | Move the whole directory; create a private restorable backup first | Before/after hashes and Git state match |
| Writes during the move | Stop project writers and wait for release/build processes | No project writer remains; final baseline captured afterward |
| Broken worktree connection | Repair Git administrative paths after moving the main checkout | Every existing worktree resolves the same Git common directory and HEAD |
| Codex loses project/chat access | Prove supported project reassociation and new filesystem permission first | Existing chats remain accessible; a new-root session can read/write the project |
| Popmelt splits project memory | Preserve `.popmelt/`, store identity, and existing records | Same store and record IDs load after restart |
| Paused automations resume accidentally | Preserve complete automation configuration except required path fields | Same IDs, PAUSED state, schedules, and notification policies |
| Local database appears empty | Preserve Supabase project ID and volumes; never reset the owner's stack | Same volume IDs and local project; existing database remains available |
| Docker bind mounts target the old path | Inspect mounts; restart only affected project services without deleting volumes | Mount sources point to the new location where needed |
| Desktop appears as a new app | Preserve bundle ID, Keychain service, updater key, and SQLite location | Existing installed app retains identity and data |
| Historical Pages links break | Publish the exact legacy subtree through the user-site archive | Every old snapshot and detail URL returns matching bytes after rename |
| History disappears on the next publication | Add bounded legacy-path compatibility and seed the new Pages deployment | Two consecutive publications preserve the full historical set |
| Trust loses provenance or misreports freshness | Keep old snapshot contents; collect new evidence for the actual deployment pair | Source/deployment IDs match; stale/failed/unavailable states remain truthful |
| Installed updater cannot follow redirects | Test old and new manifests plus signed download chains | Native updater check and download/signature verification succeed without installation |
| An updater check installs automatically | Inspect the installed client's behavior first; use an isolated check-only harness if necessary | Owner's app bundle and data remain unchanged |
| Vercel stops automatic deployments | Verify both Git connections and preview builds after rename | Both projects build the reviewed commit under their existing IDs |
| Unrelated work reaches production | Use a clean release checkout from refreshed production history | Reviewed diff contains only migration changes; no unrelated commits |
| GitHub permissions/integrations change | Snapshot settings and compare by repository ID | Branch rules, environments, Apps, scans, keys, and workflow permissions retained |
| Old links become unreliable later | Update current links; never reuse the old repository name | Remaining references have explicit historical/compatibility reasons |
| Local runtime caches retain paths | Restart first; regenerate only affected caches/environments | Web, marketing, desktop, and local tools build from the new root |
| Rollback itself breaks new evidence | Preserve both URL namespaces before any reverse rename | Newly published immutable evidence remains reachable |

Zero interruption cannot be guaranteed for provider-controlled routing. Archive staging reduces risk; immediate routing checks and rollback limit any outage.

## 4. Platform impact

| Platform | Scope and implementation references |
| --- | --- |
| Web | Trust feed and source URLs: `lib/services/public-trust-evidence.service.ts`, `components/trust/TrustEvidencePanel.tsx`, `components/settings/LegalContent.tsx`. No tracking/auth behavior change. |
| Desktop | Release URL constants and declarations: `apps/desktop/scripts/release-config.mjs`, `apps/desktop/scripts/release-config.d.mts`. Preserve installed identity and update channels. |
| Marketing | Repository and download links: `apps/marketing/src/data/site.ts`. Keep the selected release asset unchanged. |
| Future mobile | Not applicable: no mobile implementation exists. No new mobile identifier or architecture decision. |

Use the existing interaction registry and design-system catalog when recording ticket impact. Do not create a parallel interaction inventory. URL-only target maintenance keeps interaction IDs stable unless actual interaction behavior changes.

## 5. Ordered implementation tasks

### Task 1: Establish a recoverable execution baseline

**Objective:** Capture everything needed to resume or reverse either rename.

**Files:** Create a private execution bundle outside both folder names; create sanitized `docs/qa/cadence-project-rename.md` during implementation.

**Decisions:** Keep private data, credentials, environment files, and tool state out of Git. A Git bundle alone is insufficient: it excludes uncommitted, untracked, and ignored files. Preserve the complete checkout and Git administration, each existing worktree's local changes, `.local/`, `.popmelt/`, and release evidence. Use the established credential skill for secret-bearing backup handling; never print values.

**Implementation notes:**

1. Record branches, tags, remotes, HEADs, index state, working-tree diffs, untracked files, worktree configuration, and symlink targets.
2. Record GitHub repository ID, visibility, default branch, refs, release asset IDs/hashes, rulesets, branch protection, environments, variable scopes, secret names only, App installations, deploy keys, Pages, and workflow states.
3. Record both Vercel project IDs, Git repository ID/slug, production branch, root directory, build settings, aliases, deployed commits, integrations, and environment-variable names/scopes. Do not export secret values into the QA document.
4. Record Codex project identity and path bindings, automation configurations, and Popmelt store/record identity.
5. Inspect running dev servers, Codex/Claude work, Popmelt bridges, Docker mounts, native builds, and notarization jobs. Coordinate quiescence before any move.
6. Verify destination-name availability again. The names must remain unused until cutover.
7. Refresh the baseline after writers stop. Verify the private backup can restore representative ignored files and the Git index.

**Verification:** `git status --porcelain=v1`, `git rev-parse HEAD`, `git worktree list --porcelain`, and `git show-ref` agree with the private baseline. Record executable recovery paths, not merely backup filenames. Do not prune stale worktrees as part of this task.

### Task 2: Prove local tool relocation before moving the folder

**Objective:** Identify a supported way to retain Codex and Popmelt continuity.

**Files/settings:** `.codex/environments/environment.toml`; `.popmelt/`; Codex saved-project settings; `~/.codex/config.toml`; the two identified automation records. These are operational state, not blanket search-and-replace targets.

**Decisions:** Preserve the current Codex project identity where supported and retain historical chats. Re-adding a path does not prove old chats or permissions migrated. Do not manually rewrite live Codex databases or global-state JSON. Do not edit the autogenerated environment file outside its supported settings flow.

**Implementation notes:** Determine the supported app reassociation procedure using the installed app. Record it in the QA document. Preserve existing Popmelt storage metadata; restart its bridge against the moved root. Stop if relocation creates a different store without a verified migration procedure.

Use `automation_update` to update existing automation IDs when execution reaches cutover. Preserve every unrelated field, especially PAUSED status. Do not create replacements or wake them.

The destination and linked worktree lie outside this chat's current writable scope. Establish an authorized execution context for the move, worktree repair, and tool updates. A symlink must not bypass filesystem permissions.

**Tests:** Open a historical chat after reassociation; verify its project context. Verify a new-root session's `pwd`, Git access, and disposable-file write/remove. Inspect the same Popmelt thread and store IDs.

**Gate:** Do not move the folder until the supported procedure and recovery route are documented. A temporary old-path symlink is only a separately verified compatibility aid, not proof of completed migration.

### Task 3: Move the local checkout and repair its consumers

**Objective:** Run the unchanged project from `/Users/emi/Coding Projects/cadence`.

**Files:** Move the complete project directory. Update absolute roots in `design-system.manifest.json` and `design-system.usage.json`. Repair Git worktree administration through Git. Update supported tool path settings from Task 2.

**Implementation notes:** Run the move from the parent directory, with all project writers stopped and the destination absent. Rename on the same filesystem. Do not copy only tracked files or reclone.

```bash
mv '/Users/emi/Coding Projects/habit-tracking-app' '/Users/emi/Coding Projects/cadence'
git -C '/Users/emi/Coding Projects/cadence' worktree repair
git -C '/Users/emi/Coding Projects/cadence' worktree list --porcelain
git -C '/Users/emi/.codex/worktrees/apple-distribution/habit-tracking-app' rev-parse --git-common-dir
```

Re-inventory worktrees immediately before these commands. Repair all existing worktrees, including any created after planning. Preserve the linked worktree's own directory name unless separately needed; its basename does not determine repository identity. Inspect `config.worktree`, `gitdir`, `commondir`, hooks, `includeIf`, and safe-directory settings for absolute paths.

Restart Docker services only when mount inspection requires it. Preserve `supabase/config.toml` project ID and the matching proxy/test constants. Do not run `db reset`, delete volumes, relink hosted Supabase, or replace the local profile.

Keep local browser origins stable where possible. Start servers explicitly on the first available port from 4321 through 4330, bound to loopback. Do not use the current root `npm run dev` unchanged: it specifies port 3000. Use an explicit Next/Popmelt command with an allowed port and a fresh browser session for that origin.

Inspect workspace symlinks, Python virtualenv shebangs, `.vercel/project.json`, `.claude/launch.json`, local release overlays, and credential-file paths. Regenerate disposable caches only when necessary. Do not discard local evidence, credentials, or user data as cache cleanup.

**Verification:** Baseline HEADs, index, unrelated changes, ignored-file hashes, desktop data location, local database identity, and Popmelt records match. Run the local verification set in Task 9 before proceeding to GitHub cutover.

### Task 4: Prepare the rename patch on isolated release history

**Objective:** Produce a reviewed migration-only patch without publishing unrelated development work.

**Files — current source references:**

- `README.md`
- `apps/marketing/src/data/site.ts`
- `components/trust/TrustEvidencePanel.tsx`
- `components/settings/LegalContent.tsx`
- `app/design-system/page.tsx`
- `lib/services/public-trust-evidence.service.ts`
- `apps/desktop/scripts/release-config.mjs`
- `apps/desktop/scripts/release-config.d.mts`
- `packages/core/src/data/briefing-references.json`

**Files — current documentation:** `docs/OPERATIONS.md`, `docs/VERCEL_WORKFLOW.md`, `docs/DESKTOP_BUILD.md`, `docs/DESKTOP_RELEASE.md`, `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`; append migration evidence to `docs/PUBLIC_REPOSITORY_RELEASE.md` without altering historical acceptance.

**Files — tests:** `tests/desktop-release-cli.test.ts`, `tests/desktop-release.test.ts`, `tests/public-trust-evidence.resolver.test.ts`, `tests/public-trust-publication.test.ts`, `tests/public-trust-collector.test.ts`, and the existing Trust fixtures as necessary. Keep explicit old-URL compatibility cases instead of replacing every fixture string.

**Decisions:** Refresh `origin/main`, compare it with live deployment commits, and create a focused `codex/` migration branch from the reviewed release base. Do not merge the current feature branch wholesale. Propagate the reviewed patch into ongoing development afterward, preserving its uncommitted work.

Update repository components of URLs only. Keep existing release tags, versions, filenames, keys, and channel semantics. Update release `.mjs` constants and `.d.mts` literal declarations together. If private release environment configuration still supplies an old endpoint, migrate the operational value before dropping that value from build validation; old installed clients remain supported through HTTP compatibility.

Treat reference-catalog URL edits under the catalog revision rules in `docs/OPERATIONS.md`. Preserve source meaning, stable IDs, and historical dates. Use required revisions without inventing a content review.

Read applicable Next.js local documentation before editing framework code. Invoke design-system-bench for manifest/catalog changes and the project's impeccable workflow before editing UI files. No new layout, component, or visual redesign is required.

**Verification:** Review the migration diff against its release base. Remaining old-name occurrences are classified as infrastructure identities, immutable history, compatibility tests, or pending operational updates. No unexplained active dependency remains.

### Task 5: Preserve historical Pages evidence and prepare history compatibility

**Objective:** Keep every existing evidence URL and make future publication retain the same history.

**Files — Cadence:** `scripts/download-public-trust-history.mjs`, `tests/public-trust-publication.test.ts`; inspect `scripts/publish-public-trust-evidence.mjs`, `scripts/prepare-public-trust-input.mjs`, `scripts/collect-public-trust-evidence.mjs`, and `.github/workflows/public-trust-evidence.yml` for the bootstrap procedure.

**Files — new archive repository:** `README.md`, `.nojekyll`, and `habit-tracking-app/trust/` containing the captured public subtree. Publish a static user site at `emixd12.github.io`, with no custom domain. Use the supported Pages publication method; this site requires no database, service credentials, or application runtime.

**Decisions:**

1. Download the public index, every indexed snapshot, every referenced details file, and `latest.json`. Verify schemas, HTTP success, safe paths, and SHA-256 hashes. Capture exact bytes separately: the existing downloader parses and serializes JSON, so its output alone is not a byte-preserving backup.
2. Confirm every indexed URL is accounted for. Missing historical files block the claim of full preservation and require recovery before cutover.
3. Stage only validated public evidence in the archive repository. Never upload `.local/`, private QA records, provider payloads, or the complete project backup.
4. Retain every legacy snapshot's content, `snapshot_url`, details URL, source commit, deployment IDs, and timestamps. Keep old `latest.json` as a frozen compatibility response; it is not a new current result.
5. Extend the existing history downloader minimally: when the current root is exactly `https://emixd12.github.io/cadence/`, also accept indexed history under exactly `https://emixd12.github.io/habit-tracking-app/trust/`. Other roots retain existing behavior. Do not allow arbitrary siblings or cross-host archives.
6. Fetch each legacy entry from its canonical legacy URL. Validate its unchanged `snapshot_url` and details. Retain those canonical URLs in the mixed index. Mirrored historical files do not receive rewritten metadata.
7. Preserve JSON bytes after validation when downloading retained evidence. Keep existing size, count, HTTPS, schema, and sanitization checks. Reject encoded traversal, unsafe filesystem paths, and duplicate target collisions rather than overwriting files.
8. Bootstrap the renamed Pages site from the verified captured history. Its initial index contains all legacy URLs; its initial `latest.json` may contain the frozen old snapshot. Do not invoke `initialize_empty_history=true` or `--allow-empty` to erase history.

The archive's deployment must complete before renaming. Verify its artifact and a harmless staging path before cutover. The existing project site currently owns the legacy path; its transfer to the user-site subtree still requires live verification immediately after the rename. No claim of provider routing success precedes that check.

**Tests:**

- A new-root index containing one old snapshot and one new snapshot restores both unchanged.
- Legacy details remain reachable and match their captured hashes.
- A foreign host, sibling project path, traversal path, duplicate filesystem target, missing details, or mismatched `snapshot_url` fails.
- Ordinary non-Cadence callers do not gain legacy exceptions.
- Two successive publications preserve every prior index entry and refuse immutable overwrite.
- The first renamed publication consumes the seeded index without empty-history initialization.
- Existing failed/stale evidence and source/deployment mismatch behavior remain unchanged.

**Verification:** Run `npm run test -- tests/public-trust-publication.test.ts tests/public-trust-collector.test.ts tests/public-trust-evidence.resolver.test.ts`. Rehearse seed → restore → publish twice with synthetic files before uploading real history.

### Task 6: Prepare deployment and updater acceptance

**Objective:** Make the remote cutover bounded and reversible.

**Files/settings:** Both existing Vercel projects; GitHub Pages, Actions variables/environments, and the existing release channels. No schema migration.

**Implementation notes:**

1. Stage the reviewed production-configured marketing build without assigning production domains. Record its deployment ID. Set `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` for the application to that exact ID, retaining its prior value for rollback. Then stage the application build from the same reviewed commit. Preserve both Vercel project IDs and record both artifact identities. Changing the environment afterward does not prove an existing build received it.
2. Reconcile production source commits with the Trust provenance contract. Both deployment subjects must match the exact source commit used for new evidence. Verify the app's effective marketing-deployment ID against the staged marketing build. Do not promote a preview while assuming it preserves the tested build.
3. Confirm repo-scoped GitHub App access, branch restrictions, OIDC trust conditions, packages/registries, badges, external callbacks, deploy hooks, and remote checkouts contain no unidentified name-dependent settings. Record absent surfaces as not applicable.
4. Save both current updater manifests and asset hashes. Extract all reachable download/signature URLs. Include the marketing-linked preview.19 DMG, advertised preview.24 archive, and QA rc.3 archive.
5. Identify an existing supported desktop client or isolated native harness for check-only acceptance. Do not install QA-invalid assets, switch update channels, publish a new release, notarize, or modify the owner's app/data for a naming change.
6. Record whether normal updater checking automatically downloads or installs. Select the isolated harness if checking could cause an installation.
7. Pause the Trust workflow during final capture/cutover and record its previous state. Wait for in-flight evidence publications. Refresh the archive after the last writer finishes; 37 is the planning baseline, not a hardcoded final count.

**Verification:** Staged builds pass the selected checks; both legacy feed/download chains work before rename; the frozen evidence bundle matches the final old-site state. Capture pre-existing failures separately.

### Task 7: Rename GitHub and prove compatibility before promotion

**Objective:** Change the repository slug while retaining repository identity and working legacy access.

**Preconditions:** Tasks 1–6 pass. Archive deployment is ready. New names remain available. No release publisher or evidence writer is running.

**Mutation:** Rename the existing repository to `cadence` through GitHub. Immediately read it back and assert ID `1261353608`, visibility, default branch, refs, and settings remain intact.

```bash
git -C '/Users/emi/Coding Projects/cadence' remote set-url origin git@github.com:emixd12/cadence.git
git -C '/Users/emi/Coding Projects/cadence' ls-remote origin HEAD
```

Update every other independent clone's remote; linked worktrees normally share the common configuration, but inspect worktree-specific overrides.

**Immediate verification, before any new public evidence:**

1. Probe every old snapshot and details URL. Require HTTP 200 and matching bytes through the archive site. Also check the frozen old index/latest response.
2. Check new repository access, representative old issue/PR/commit/blob/raw links, clone/fetch access, and release pages.
3. Check old and new updater manifests and every advertised asset/signature URL. Compare versions, signatures, and digests with the baseline.
4. Run native check/download/signature verification without installation. A browser download alone does not establish native redirect compatibility.
5. Verify both Vercel Git connections identify the same GitHub repository ID under the new slug. Reconnect only if necessary, within the existing projects, preserving all settings.
6. Recheck GitHub rules, environment protections, security scanning, Actions permissions, App access, and release assets.

**Rollback trigger:** Any lost legacy evidence URL, repository-identity mismatch, failed installed-client update path, or unrecoverable integration mismatch stops promotion. Use the early remote rollback in section 7.

### Task 8: Publish the new evidence root and promote reviewed builds

**Objective:** Serve current Cadence URLs while preserving old clients and historical evidence.

**Files/settings:** `.github/workflows/public-trust-evidence.yml` as needed for the reviewed one-time seed; repository and environment `TRUST_PAGES_ORIGIN`; existing Vercel projects.

**Implementation notes:**

1. Deploy the verified seed artifact to the renamed repository's Pages site. Use the existing Actions artifact publication mechanism. If a temporary manual seed workflow is needed, review its exact artifact source/digest and remove that temporary path afterward.
2. Verify `/cadence/trust/snapshots.json`, `latest.json`, and retained files before enabling normal publication. Keep legacy canonical URLs in historical JSON.
3. Change `TRUST_PAGES_ORIGIN` to `https://emixd12.github.io/cadence/` at all three observed scopes: repository, `public-trust-preview`, and `public-trust-production`. Recheck for any additional overriding scope.
4. Ensure the migration code is on the workflow's actual execution ref and the future scheduled default branch. Supplying an old `source_commit` could check out the old downloader or path rules.
5. Promote the reviewed production builds, preserving app/marketing domains. Verify Git-triggered deployment behavior with a reviewed migration commit; do not use an unrelated feature push as a probe.
6. Collect evidence for the exact deployed commit and both deployment IDs. Preserve existing hosted-operation authority: `run_rls` stays false unless the separate disposable-account smoke is authorized. A skipped or stale check must stay factual.
7. Publish twice through the normal history path. Prove that all captured historical entries and both new publications remain accessible.
8. Restore the Trust workflow's previous enabled/disabled state. Both paused Codex automations stay paused.

**Verification:** Both Vercel projects are Ready on the intended commits; production aliases still resolve; source/download links use `emixd12/cadence`; Trust reports the actual named deployment pair and factual freshness.

### Task 9: Run acceptance across local, hosted, and desktop surfaces

**Objective:** Demonstrate that naming changes did not break supported workflows.

Run the required repository checks against the isolated migration branch with Node 24:

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run public-source:check
npm run public-trust:check
npm run public-trust:fixtures
npm run marketing:build
npm run marketing:check
npm run desktop:typecheck
npm run desktop:build
npm run core:check
npm run design-system:check
```

Also run `npm run test -- tests/desktop-release.test.ts tests/desktop-release-cli.test.ts tests/supabase-docker-proxy.test.ts tests/briefing-references.test.ts` when those files/configurations change. Existing native checks remain necessary if relocation affects native build tooling; a signed release build is not required merely to rename source paths.

Record baseline failures in the unrelated working checkout separately. Do not fix unrelated work or describe an already-failing check as a rename regression. Check CI at the exact reviewed commit; no skipped required check counts as passing.

**Manual acceptance:**

- Local web and marketing start from the new folder on permitted origins; desktop frontend/native development tooling resolves the new folder.
- Codex opens the renamed project and retained chats; Popmelt loads the same store, thread, and Imprint records.
- Existing local Supabase data remains available; no schema migration, reset, or volume replacement occurred.
- Production marketing, sign-in, Timeline, Behaviors, Export, Settings, Trust, and desktop download links load. Reuse approved test-account access; avoid user-data changes or new email sends.
- Existing OAuth callback origins, Calendar broker origins, cookies, push configuration, and reminder configuration remain unchanged. Verify representative sign-in/desktop account continuity where authorized; do not infer full provider acceptance from a landing-page response.
- Existing installed desktop app retains its SQLite/Keychain identity. Old endpoint update checking and signature verification pass without replacing the app.
- All captured old evidence URLs and new evidence URLs remain reachable and immutable.
- Verify the next scheduled Trust publication preserves history. Until that run is inspected, scheduled continuity remains pending; do not invent an automation or silently mark it complete.

### Task 10: Reconcile documentation and close the migration

**Objective:** Leave current instructions accurate and every residual dependency explained.

**Files:** `STATUS.md`, `docs/TICKETS.md`, current operational docs listed in Task 4, and `docs/qa/cadence-project-rename.md`. Allocate the next available ticket during implementation; do not assume 186 remains free. Reference this plan rather than duplicating its risk register.

**Decisions:** Planning alone does not start or complete a ticket. At implementation start, record scope and platform impacts. At completion, record exact commits, migration timestamps, repository IDs, deployment IDs, archive publication, asset/history hash checks, and any pending verification.

Run a final tracked-file search for `habit-tracking-app`, old absolute paths, old GitHub URLs, and old Pages URLs. Classify every remaining match. Historical documents, preserved Supabase identifiers, archive compatibility, and regression fixtures are legitimate residuals.

Update current cross-repository references only where found. Preserve signed provenance and historical source URLs. Keep private operational evidence outside Git. Do not commit `.env`, tool databases, or `.local/` content.

**Verification:** The migration-only diff is reviewed; unrelated changes remain intact; no unclassified active dependency remains. Record backup retention and temporary compatibility cleanup criteria without automatically deleting recovery material.

## 6. Execution stop conditions

Stop the affected cutover if any condition holds:

- Backup restoration or before/after comparison fails.
- New folder/repository names are occupied or permissions are unavailable.
- A project writer or release job cannot safely quiesce.
- Codex cannot retain usable project/chat access through a supported relocation procedure.
- Popmelt changes store identity or loses existing records.
- Existing worktree, database volume, or desktop identity changes unexpectedly.
- Any historical evidence file is missing, changes bytes, or cannot retain its URL.
- The archive site cannot serve the legacy path after the rename.
- An installed updater cannot use its original feed and valid signed artifact chain.
- A required check fails, or the release diff includes unrelated development work.
- Either deployment's provenance does not match the source selected for evidence collection.

The local and remote renames are separate checkpoints. A blocked GitHub migration does not require undoing a verified local-folder rename.

## 7. Rollback procedures

### Local rollback

Stop project writers. Move the directory back only if the old path is absent. Run `git worktree repair` from the restored main checkout. Restore supported tool path mappings and automation path fields. Reopen the project with its proper permissions. Verify baseline hashes and identities. Do not restore over newer work; preserve any post-move edits separately first.

### Early remote rollback: before new immutable evidence

Pause publication. Rename the same repository back to `habit-tracking-app`; assert its original ID. Restore the old Git remote and all recorded variable values/scopes. Redeploy the saved original Pages artifact and verify old URLs. Verify existing Vercel links and legacy releases. Keep the archive repository intact until recovery is verified. Production builds remain on their previous aliases if promotion has not occurred.

### After production promotion or new evidence publication

Prefer reverting the focused code change and promoting the recorded previous Vercel deployments while retaining the `cadence` repository name. New evidence already contains `/cadence/` URLs; renaming back immediately would create another history break.

If reversing the repository name is unavoidable, first archive the new `/cadence/trust/` subtree through the user site and prove its routing. Preserve every newly published immutable file. Restore Git/configuration settings afterward. An app rollback does not undo GitHub variables, Pages publications, or repository settings automatically.

Do not reset Supabase, change desktop keys/identifiers, overwrite signed assets, or replace application data during rollback. Preserve truthful stale evidence when deployment IDs change.

## 8. Remaining execution-time uncertainties

1. The exact supported Codex project/chat reassociation operation is not verified. This is a pre-move gate.
2. Popmelt's store relocation behavior is not verified end to end. Existing storage and identity must survive a controlled restart.
3. GitHub user-site fallback at the exact legacy project path needs post-rename verification. Staging alone cannot establish it.
4. All 37 historical snapshots/details have not yet been individually fetched and hashed. The final frozen count may differ.
5. Complete Vercel Git linkage, production alias state, and name-dependent external integrations require execution preflight.
6. Native updater behavior through renamed URLs cannot be verified until cutover. Preserve rollback until it passes.
7. Other machines, independent clones, third-party bookmarks, and unopened external tooling may contain old references. Inventory owned consumers and retain GitHub redirects.

These are explicit gates, not assurances that unknown dependencies do not exist.

## 9. Primary reference documentation

- [GitHub repository renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository): repository/Git redirects, Pages exception, and old-name reuse warning.
- [GitHub Pages user-site setup](https://docs.github.com/en/pages/quickstart): the separate `emixd12.github.io` user-site model.
- [Git worktree repair](https://git-scm.com/docs/git-worktree): repairing linked worktrees after moving the main checkout.
- [Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github): deployment integration and repository metadata.
- [Vercel deployment promotion](https://vercel.com/docs/deployments/promoting-a-deployment): preserve reviewed deployment/configuration identity when promoting.
