#!/usr/bin/env bash
# Runs the real hook against synthetic npm outcomes. No Node installation,
# network access or provider command runs. Only the temporary project changes.
set -uo pipefail

node() {
  if [ "${1:-}" = "-p" ]; then printf '24\n'; else printf 'v24.22.1\n'; fi
}

mkdir() {
  # Exercise the existing fallback without creating /opt/node24.
  if [ "${1:-}" = "-p" ] && [ "${2:-}" = "/opt/node24" ]; then return 1; fi
  command mkdir "$@"
}

git() { printf 'false\n'; }
curl() { echo 'Unexpected Node download in cache fixture' >&2; return 1; }
timeout() { "${@:4}"; }

npm() {
  printf '%s\n' "$*" >>"$CADENCE_HOOK_TEST_NPM_LOG"
  if [ "$CADENCE_HOOK_TEST_MODE" = "fallback" ] && [[ " $* " != *" --ignore-scripts "* ]]; then return 1; fi
  command mkdir -p node_modules
}

source "$CLAUDE_PROJECT_DIR/scripts/claude-cloud-session.sh"
