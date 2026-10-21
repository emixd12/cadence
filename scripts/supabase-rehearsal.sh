#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# This resets only a fresh GitHub-hosted Linux runner's disposable local stack.
# Operator-owned local databases use the separate Supabase workflow runbook.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_OS:-}" = Linux
test "${RUNNER_ARCH:-}" = X64
test -d "${RUNNER_TEMP:?}"
test -n "${GITHUB_STEP_SUMMARY:?}"

phase=preflight
proxy_pid=""
migration_count=0
sql_count=0
project_labels=(
  --filter label=com.supabase.cli.project=habit-tracking-app
  --filter label=com.docker.compose.project=habit-tracking-app
)

finish() {
  local result=$? ids_output
  local -a ids=()
  trap - EXIT
  set +e
  if ((result != 0)); then
    printf '::error::Local Supabase rehearsal failed during %s (exit %s).\n' "$phase" "$result"
    if [[ -n "$proxy_pid" ]]; then
      # These fields contain no container environments, keys or raw service logs.
      timeout 10s docker ps -a "${project_labels[@]}" \
        --format '{{.Names}} | {{.Status}} | {{.Ports}} | {{.Networks}}'
    fi
  fi
  if [[ -n "$proxy_pid" ]]; then
    if ids_output="$(timeout 10s docker ps -aq "${project_labels[@]}")"; then
      if [[ -n "$ids_output" ]]; then
        mapfile -t ids <<< "$ids_output"
        timeout --kill-after=5s 30s docker stop --time 10 "${ids[@]}" >/dev/null 2>&1
        if (($? != 0)); then
          printf '::error::Disposable Cadence containers could not all be stopped.\n'
          result=1
        fi
      fi
    else
      printf '::error::Disposable Cadence container cleanup could not be inspected.\n'
      result=1
    fi
    kill "$proxy_pid" 2>/dev/null
    for attempt in {1..20}; do
      kill -0 "$proxy_pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$proxy_pid" 2>/dev/null; then
      kill -KILL "$proxy_pid" 2>/dev/null
    fi
    wait "$proxy_pid" 2>/dev/null
  fi
  if ((result == 0)); then
    {
      printf 'Migration replay: **%s passed**; exact tracked/applied versions matched.\n\n' "$migration_count"
      printf 'Rollback SQL fixtures: **%s passed**.\n\n' "$sql_count"
      printf 'Local RLS, account-sync and authenticated BehaviorStore contracts: **passed**.\n\n'
      printf 'Loopback bindings, service health and synthetic account cleanup: **passed**.\n'
    } >> "$GITHUB_STEP_SUMMARY" || result=1
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

begin_phase() {
  phase="$1"
  printf 'Local Supabase rehearsal: %s\n' "$phase"
}

verify_stack() {
  local state health_deadline=$((SECONDS + 60))
  local -a names=(supabase_{db,kong,auth,inbucket,realtime,rest,storage}_habit-tracking-app)
  while ((SECONDS < health_deadline)); do
    state="$(timeout 10s docker inspect --format \
      '{"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}' \
      "${names[@]}")"
    # Reject unsafe bindings immediately; only health readiness may be retried.
    printf '%s\n' "$state" | jq -es '
      length == 7 and all(.[]; .network == "cadence-local")
      and all(.[] | .ports | .. | objects | select(has("HostIp"));
        .HostIp == "127.0.0.1")
    ' >/dev/null
    if printf '%s\n' "$state" | jq -es '
      all(.[]; .running and (.health == "healthy" or .health == "none"))
    ' >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

for command in docker psql jq timeout node npm git; do
  command -v "$command" >/dev/null
done
test -z "${DOCKER_CONTEXT:-}"
test -z "${DOCKER_TLS_VERIFY:-}"
CADENCE_DOCKER_DAEMON="$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')"
[[ "$CADENCE_DOCKER_DAEMON" == unix:///* ]]
test -S "${CADENCE_DOCKER_DAEMON#unix://}"
export DOCKER_HOST="$CADENCE_DOCKER_DAEMON"
node -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'
docker version --format 'Docker server: {{.Server.Version}}'
psql --version
test ! -e .env.local
test ! -e supabase/.temp/project-ref
test -z "$(docker ps -aq --filter label=com.supabase.cli.project=habit-tracking-app)"
volume_names="$(docker volume ls --format '{{.Name}}')"
while IFS= read -r volume; do
  case "$volume" in
    supabase_db_habit-tracking-app|supabase_storage_habit-tracking-app) exit 1 ;;
  esac
done <<< "$volume_names"

export SUPABASE_TELEMETRY_DISABLED=1 SUPABASE_ACCESS_TOKEN="" SUPABASE_DB_PASSWORD=""
export SUPABASE_CLI_BINARY_OVERRIDE="$PWD/node_modules/@supabase/cli-linux-x64/bin/supabase-go"
test "$(npm run --silent supabase -- --version)" = 2.105.0

begin_phase 'preparing the unlinked workdir'
CADENCE_DOCKER_PROXY_DIR="$(mktemp -d "$RUNNER_TEMP/cadence-sql.XXXXXX")"
export SUPABASE_WORKDIR="$CADENCE_DOCKER_PROXY_DIR/work"
mkdir -p "$SUPABASE_WORKDIR/supabase/migrations"
cp supabase/config.toml supabase/seed.sql "$SUPABASE_WORKDIR/supabase/"
mapfile -t migrations < <(git ls-files 'supabase/migrations/*.sql')
migration_count=${#migrations[@]}
test "$migration_count" -gt 0
for migration in "${migrations[@]}"; do
  [[ "$migration" =~ ^supabase/migrations/([0-9]{14})_[^/]+\.sql$ ]]
  printf '%s\n' "${BASH_REMATCH[1]}" >> "$CADENCE_DOCKER_PROXY_DIR/expected-versions.txt"
  cp "$migration" "$SUPABASE_WORKDIR/supabase/migrations/"
done
LC_ALL=C sort -o "$CADENCE_DOCKER_PROXY_DIR/expected-versions.txt" \
  "$CADENCE_DOCKER_PROXY_DIR/expected-versions.txt"

docker network create --driver bridge \
  -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 cadence-local >/dev/null
test "$(docker network inspect cadence-local --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}')" = 127.0.0.1
node scripts/supabase-docker-proxy.mjs \
  "$CADENCE_DOCKER_PROXY_DIR/docker.sock" "${CADENCE_DOCKER_DAEMON#unix://}" &
proxy_pid=$!
export DOCKER_HOST="unix://$CADENCE_DOCKER_PROXY_DIR/docker.sock"
for attempt in {1..100}; do
  test -S "$CADENCE_DOCKER_PROXY_DIR/docker.sock" && break
  sleep 0.1
done
test -S "$CADENCE_DOCKER_PROXY_DIR/docker.sock"

begin_phase 'starting the local stack (12-minute limit)'
# Startup/status output contains local API keys. Never print or upload it.
timeout --kill-after=5s 12m npm run --silent supabase -- start \
  --workdir "$SUPABASE_WORKDIR" --network-id cadence-local \
  --exclude imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor \
  >/dev/null 2>&1
verify_stack

# This connection string is the disposable local default, never a hosted target.
psql_local=(psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -X -v ON_ERROR_STOP=1)
test "$("${psql_local[@]}" -At -c 'select count(*) from auth.users')" = 0

begin_phase 'resetting and replaying tracked migrations (8-minute limit)'
timeout --kill-after=5s 8m npm run --silent supabase -- db reset --local \
  --workdir "$SUPABASE_WORKDIR" --network-id cadence-local >/dev/null 2>&1
verify_stack
"${psql_local[@]}" -At \
  -c 'select version from supabase_migrations.schema_migrations order by version' \
  > "$CADENCE_DOCKER_PROXY_DIR/applied-versions.txt"
diff -u "$CADENCE_DOCKER_PROXY_DIR/expected-versions.txt" \
  "$CADENCE_DOCKER_PROXY_DIR/applied-versions.txt"
printf 'Replayed %s tracked migrations.\n' "$migration_count"

for sql_file in tests/sql/*.sql; do
  begin_phase "$sql_file"
  "${psql_local[@]}" -q -f "$sql_file" >/dev/null
  sql_count=$((sql_count + 1))
done
begin_phase 'local RLS smoke'
npm run smoke:rls:local
begin_phase 'local account-sync smoke'
npm run smoke:account-sync:local
begin_phase 'authenticated BehaviorStore contract'
CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts
begin_phase 'final service health and synthetic account cleanup'
test "$("${psql_local[@]}" -At -c 'select count(*) from auth.users')" = 0
verify_stack
