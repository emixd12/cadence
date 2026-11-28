#!/usr/bin/env bash
# Vercel Ignored Build Step for the cadence-marketing project.
# Exit 0 skips the build (no build minutes). Exit 1 runs the build.
# Production builds when a dependency path changed and fails open when the diff
# cannot be computed. Previews build only on opt-in: a preview/* branch or a
# "[vercel preview]" commit marker. "[vercel force]" always builds; "[vercel preview marketing]" builds
# a preview only. A shallow clone fetches a missing base commit before diffing.
set -u

# Fail open (build) if the repository root cannot be found.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
cd "$REPO_ROOT" || exit 1

PATHS=(
  apps/marketing
  package.json
  package-lock.json
  packages/ui/package.json
  packages/ui/tokens.css
  packages/ui/fonts.css
  packages/ui/LICENSE.fonts.txt
  public/brand/google-calendar.svg
  # apps/marketing/scripts/build-example-bundle.mjs and its import graph.
  # tests/vercel-ignore.test.ts fails when this list misses an imported file.
  lib/resolvers/export.resolver.ts
  lib/services/zip.ts
  lib/services/zip-format.ts
  packages/core/package.json
  packages/core/src/behavior-store.ts
  packages/core/src/behaviorlog.schema.json
  packages/core/src/data-store.ts
  packages/core/src/hash.ts
  packages/core/src/resolvers/behavior-configuration.resolver.ts
  packages/core/src/resolvers/behavior-run.resolver.ts
  packages/core/src/resolvers/day-note.resolver.ts
  packages/core/src/resolvers/export.resolver.ts
  packages/core/src/resolvers/note-suggestion.resolver.ts
  packages/core/src/resolvers/period.resolver.ts
  packages/core/src/resolvers/status.resolver.ts
  packages/core/src/resolvers/time-tracking.resolver.ts
  packages/core/src/resolvers/time.resolver.ts
  packages/core/src/types/behavior-configuration-event.ts
  packages/core/src/types/behavior-definition-event.ts
  packages/core/src/types/behavior.ts
  packages/core/src/types/database.ts
  packages/core/src/types/export.ts
  packages/core/src/types/json.ts
  packages/core/src/types/note-shortcut.ts
  packages/core/src/types/period.ts
  packages/core/src/types/place-labels.ts
  packages/core/src/types/portability-rows.ts
  packages/core/src/types/recurrence.ts
  packages/core/src/types/schedule.ts
  packages/core/src/types/time-tracking.ts
  packages/core/src/types/travel.ts
  packages/core/src/types/weather.ts
)

ENV="${VERCEL_ENV:-}"
REF="${VERCEL_GIT_COMMIT_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
MSG="${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --pretty=%B "$HEAD_SHA" 2>/dev/null || true)}"
MSG="$(printf '%s' "$MSG" | tr '[:upper:]' '[:lower:]')"

log() { printf '[vercel-ignore:marketing] %s\n' "$*"; }

# Resolve a commit, fetching just that commit when the shallow clone lacks it.
resolve_commit() {
  local sha="$1" full
  if full="$(git rev-parse --verify --quiet "${sha}^{commit}" 2>/dev/null)"; then
    printf '%s' "$full"
    return 0
  fi
  git fetch --no-tags --depth=1 origin "$sha" >/dev/null 2>&1 || true
  git rev-parse --verify --quiet "${sha}^{commit}" 2>/dev/null || true
}

# Find where this branch left main, fetching main when the clone is single-branch.
main_merge_base() {
  local base
  base="$(git merge-base origin/main "$HEAD_SHA" 2>/dev/null || git merge-base main "$HEAD_SHA" 2>/dev/null || true)"
  if [ -z "$base" ]; then
    git fetch --no-tags --depth=50 origin main:refs/remotes/origin/main >/dev/null 2>&1 || true
    base="$(git merge-base origin/main "$HEAD_SHA" 2>/dev/null || true)"
  fi
  if [ -z "$base" ] && [ -n "$REF" ] && [ "$REF" != "HEAD" ]; then
    # The branch may have more commits than the clone depth.
    git fetch --no-tags --deepen=50 origin "$REF" >/dev/null 2>&1 || true
    base="$(git merge-base origin/main "$HEAD_SHA" 2>/dev/null || true)"
  fi
  printf '%s' "$base"
}

case "$MSG" in
  *"[vercel force]"*) log "commit message has [vercel force]; building."; exit 1 ;;
esac

BASE_SHA=""
if [ "$ENV" = "production" ] || [ "$REF" = "main" ]; then
  BASE_SHA="$PREV_SHA"
else
  case "$MSG" in
    *"[vercel preview marketing]"*) log "commit message has [vercel preview marketing]; building."; exit 1 ;;
  esac
  # A manual Redeploy of an existing preview reuses the same commit.
  if [ -n "$PREV_SHA" ]; then
    PREV_FULL="$(git rev-parse --verify --quiet "${PREV_SHA}^{commit}" 2>/dev/null || true)"
    HEAD_RESOLVED="$(git rev-parse --verify --quiet "${HEAD_SHA}^{commit}" 2>/dev/null || true)"
    if [ "$PREV_SHA" = "$HEAD_SHA" ] || { [ -n "$PREV_FULL" ] && [ "$PREV_FULL" = "$HEAD_RESOLVED" ]; }; then
      log "same-commit redeploy; building."
      exit 1
    fi
  fi
  case "$REF" in
    preview/*) OPTED_IN=1 ;;
    *) case "$MSG" in *"[vercel preview]"*) OPTED_IN=1 ;; *) OPTED_IN=0 ;; esac ;;
  esac
  if [ "$OPTED_IN" != "1" ]; then
    log "preview for '$REF' skipped: not a preview/* branch and no [vercel preview] marker."
    exit 0
  fi
  if [ -n "$PREV_SHA" ] && [ -n "$(resolve_commit "$PREV_SHA")" ]; then
    BASE_SHA="$PREV_SHA"
  else
    BASE_SHA="$(main_merge_base)"
  fi
fi

if [ -z "$BASE_SHA" ]; then
  log "no base commit to diff against; building (fail open)."
  exit 1
fi

BASE_FULL="$(resolve_commit "$BASE_SHA")"
if [ -z "$BASE_FULL" ]; then
  log "base commit $BASE_SHA is not in this clone; building (fail open)."
  exit 1
fi
if ! HEAD_FULL="$(git rev-parse --verify --quiet "${HEAD_SHA}^{commit}")"; then
  log "head commit $HEAD_SHA is not in this clone; building (fail open)."
  exit 1
fi
if [ "$BASE_FULL" = "$HEAD_FULL" ]; then
  log "base equals head (redeploy of the same commit); building."
  exit 1
fi

# Two-dot diff compares the two trees, so it needs no history between them.
git diff --quiet "$BASE_FULL" "$HEAD_FULL" -- "${PATHS[@]}"
DIFF_STATUS=$?
case "$DIFF_STATUS" in
  0)
    log "no cadence-marketing dependency changed in ${BASE_FULL:0:12}..${HEAD_FULL:0:12}; skipping."
    exit 0
    ;;
  1)
    log "cadence-marketing dependencies changed in ${BASE_FULL:0:12}..${HEAD_FULL:0:12}; building:"
    git diff --name-only "$BASE_FULL" "$HEAD_FULL" -- "${PATHS[@]}" | head -n 10 | sed 's/^/  /'
    exit 1
    ;;
  *)
    log "git diff failed with status $DIFF_STATUS; building (fail open)."
    exit 1
    ;;
esac
