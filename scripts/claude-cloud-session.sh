#!/usr/bin/env bash
set -uo pipefail

# SessionStart hook for Claude Code cloud sessions (docs/OPERATIONS.md,
# "Claude cloud sessions"). Local sessions exit before doing anything.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 0

node_major=24
notes=()

node_home="/opt/node${node_major}"
if ! mkdir -p "$node_home" 2>/dev/null || [ ! -w "$node_home" ]; then
  node_home="${HOME}/.cache/cadence-node${node_major}"
fi

current_node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

# CI and the Dagger checks use Node 24; the cloud image puts Node 22 on PATH.
install_node() {
  local arch base tarball archive
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) return 1 ;;
  esac
  base="https://nodejs.org/dist/latest-v${node_major}.x"
  archive="$(mktemp -d)" || return 1
  curl -fsSL --max-time 60 -o "$archive/all.txt" "$base/SHASUMS256.txt" &&
    tarball="$(awk -v suffix="-linux-${arch}.tar.gz" 'substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }' "$archive/all.txt")" &&
    [ -n "$tarball" ] &&
    grep " ${tarball}\$" "$archive/all.txt" >"$archive/SHASUMS256.txt" &&
    curl -fsSL --max-time 300 -o "$archive/$tarball" "$base/$tarball" &&
    (cd "$archive" && sha256sum --check --status SHASUMS256.txt) &&
    rm -rf "$node_home" && mkdir -p "$node_home" &&
    tar -xzf "$archive/$tarball" -C "$node_home" --strip-components=1
  local status=$?
  rm -rf "$archive"
  return $status
}

if [ "$(PATH="$node_home/bin:$PATH" current_node_major)" != "$node_major" ]; then
  install_node || notes+=("Node ${node_major} could not be installed from nodejs.org; commands use $(node -v 2>/dev/null || echo 'no Node').")
fi

if [ -x "$node_home/bin/node" ]; then
  export PATH="$node_home/bin:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    # $PATH stays literal so later shells prepend Node 24 to their own PATH.
    # shellcheck disable=SC2016
    printf 'export PATH="%s/bin:$PATH"\n' "$node_home" >>"$CLAUDE_ENV_FILE"
  fi
fi

# Node ignores HTTPS_PROXY by default. On the direct route, the AgentMail CLI
# postinstall downloads its binary but never exits, so npm ci hangs.
export NODE_USE_ENV_PROXY=1

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export NODE_USE_ENV_PROXY=1'
    echo 'export NEXT_TELEMETRY_DISABLED=1'
    echo 'export SUPABASE_TELEMETRY_DISABLED=1'
  } >>"$CLAUDE_ENV_FILE"
fi

# Reinstall only when a manifest, the lockfile or this script changed.
install_inputs=(scripts/claude-cloud-session.sh package.json package-lock.json apps/*/package.json packages/*/package.json)
install_hash=node_modules/.cadence-cloud-install.sha256
install_mode=node_modules/.cadence-cloud-install.mode
install_log="${TMPDIR:-/tmp}/cadence-npm-ci.log"
# A clean install takes about 25 s. npm can spend 30 s rolling back after
# SIGTERM, so SIGKILL follows 10 s later. Two attempts and the Node download
# stay inside the 900 s hook timeout in .claude/settings.json.
npm_ci_timeout=240

if ! sha256sum --check --status "$install_hash" 2>/dev/null || ! grep -qxE 'full|ignore-scripts' "$install_mode" 2>/dev/null; then
  rm -f "$install_hash" "$install_mode"
  timeout -k 10 "$npm_ci_timeout" npm ci --no-audit --no-fund >"$install_log" 2>&1
  npm_ci_status=$?
  if [ "$npm_ci_status" -eq 0 ]; then
    printf 'full\n' >"$install_mode"
    sha256sum "${install_inputs[@]}" >"$install_hash"
  # A failed or hung install script, such as the agentmail-cli binary
  # download, must not block the install.
  elif timeout -k 10 "$npm_ci_timeout" npm ci --no-audit --no-fund --ignore-scripts >>"$install_log" 2>&1; then
    printf 'ignore-scripts\n' >"$install_mode"
    sha256sum "${install_inputs[@]}" >"$install_hash"
    case "$npm_ci_status" in
      124 | 137) npm_ci_result="timed out after ${npm_ci_timeout} s" ;;
      *) npm_ci_result="failed" ;;
    esac
    notes+=("npm ci ${npm_ci_result} and succeeded only with --ignore-scripts. Log: $install_log")
  else
    notes+=("npm ci failed. Read $install_log before running checks.")
  fi
fi

if [ -f "$install_hash" ] && [ "$(cat "$install_mode" 2>/dev/null)" = "ignore-scripts" ]; then
  notes+=("Dependencies were installed with --ignore-scripts: install scripts did not run and the AgentMail CLI binary is missing. This remains true on cached resumes until a full install succeeds.")
fi

if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  notes+=("The clone is shallow. Run git fetch --unshallow before npm run public-source:check.")
fi

echo "Cadence cloud session: Node $(node -v 2>/dev/null || echo missing), dependencies $([ -f "$install_hash" ] && echo installed || echo NOT installed)."
echo "- Dagger is not installed here. Run the AGENTS.md checks as npm commands."
echo "- macOS-only work (Tauri native builds, signing, installed acceptance) is unavailable."
echo "- Provider access follows docs/OPERATIONS.md, \"Claude cloud sessions\"."
for note in "${notes[@]}"; do
  echo "- $note"
done
exit 0
