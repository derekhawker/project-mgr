#!/usr/bin/env bash
set -euo pipefail

# Protocol/discovery smoke. This intentionally uses a temporary HOME and never
# touches the user's OpenCode configuration or conversation history.
ROOT="$(mktemp -d /tmp/project-mgr-mcp-smoke.XXXXXX)"
PORT="${MCP_SMOKE_PORT:-4197}"
SERVER_PASSWORD="${MCP_SMOKE_PASSWORD:-mcp-smoke-password}"
cleanup() { [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo" "$ROOT/task" "$ROOT/project"
SESSION_ID="ses_mcp_smoke"
git -C "$ROOT/repo" init -q -b main
git -C "$ROOT/repo" config user.name smoke
git -C "$ROOT/repo" config user.email smoke@example.invalid
printf 'fixture\n' > "$ROOT/repo/README"
git -C "$ROOT/repo" add README && git -C "$ROOT/repo" commit -qm initial
git -C "$ROOT/repo" worktree add -q -b task-branch "$ROOT/task/repo" main
cat > "$ROOT/context.json" <<EOF
{"workspace_id":"workspace-1","task_id":"task-1","session_id":"$SESSION_ID","task_root":"$ROOT/task","repositories":[{"repository_id":"repo-1","path":"$ROOT/repo"}]}
EOF
MCP="$(cd "$(dirname "$0")" && pwd)/target/debug/registration-mcp"
cargo build --quiet --manifest-path "$(dirname "$0")/Cargo.toml" --bin registration-mcp
cat > "$ROOT/project/opencode.json" <<EOF
{"mcp":{"registration":{"type":"local","command":["$MCP","--context","$ROOT/context.json"],"enabled":true}}}
EOF

OPENCODE_CONFIG_DIR="$ROOT/config" HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/config" \
  OPENCODE_SERVER_PASSWORD="$SERVER_PASSWORD" \
  opencode serve --hostname 127.0.0.1 --port "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/api/info" >/dev/null 2>&1 && break; sleep .1; done
echo "OpenCode MCP discovery (local config):"
echo "wrote $ROOT/project/opencode.json (local MCP command configuration)"
if [[ "${RUN_MCP_LIST:-0}" == 1 ]]; then
  (cd "$ROOT/project" && HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/config" opencode mcp list) || {
    echo "opencode mcp list is not isolated in v2.0.27: it starts the managed service on its configured port." >&2
  }
else
  echo "skipping 'opencode mcp list' by default (set RUN_MCP_LIST=1; it may start the separate managed service)"
fi
echo "Protocol call (no model generation):"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | "$MCP" --context "$ROOT/context.json"

if [[ "${LIVE_MODEL:-0}" == 1 ]]; then
  MODEL="${MODEL:-openai/gpt-6-luna}"
  LIVE_TIMEOUT="${LIVE_TIMEOUT:-180}"
  LIVE_STDOUT="$ROOT/live.stdout"
  LIVE_STDERR="$ROOT/live.stderr"
  INVOCATION_LOG="$ROOT/mcp-invocations.log"
  PROMPT="Call the register_task_setup MCP tool now. Use exactly this prepared fixture report, including the exact caller session_id ${SESSION_ID}. Do not merely describe the call; invoke the tool and report its returned result. The report is:
{\"operation_id\":\"setup-op-live\",\"workspace_id\":\"workspace-1\",\"task_id\":\"task-1\",\"session_id\":\"${SESSION_ID}\",\"items\":[{\"item_id\":\"repo-1-worktree\",\"repository_id\":\"repo-1\",\"repository_path\":\"${ROOT}/repo\",\"git_identity\":\"${ROOT}/repo/.git\",\"branch\":\"task-branch\",\"worktree_path\":\"${ROOT}/task/repo\",\"result\":\"ready\",\"error_code\":null,\"detail\":null}]}"
  echo "Live OpenCode MCP invocation (model=$MODEL, session=$SESSION_ID):"
  set +e
  (cd "$ROOT/project" && \
    OPENCODE_CONFIG_DIR="$ROOT/config" HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/config" \
    OPENCODE_PASSWORD="$SERVER_PASSWORD" \
    MCP_INVOCATION_LOG="$INVOCATION_LOG" timeout --signal=TERM "$LIVE_TIMEOUT" \
    opencode run --server "http://127.0.0.1:$PORT" --session "$SESSION_ID" \
      --model "$MODEL" --format json --auto "$PROMPT") >"$LIVE_STDOUT" 2>"$LIVE_STDERR"
  LIVE_STATUS=$?
  set -e
  echo "--- OpenCode stdout ---"
  cat "$LIVE_STDOUT"
  echo "--- OpenCode stderr ---" >&2
  cat "$LIVE_STDERR" >&2
  echo "--- MCP invocation evidence ---"
  if [[ -f "$INVOCATION_LOG" ]]; then cat "$INVOCATION_LOG"; fi

  if (( LIVE_STATUS != 0 )); then
    echo "live smoke failed: OpenCode exited with status $LIVE_STATUS (provider, auth, model, or timeout)" >&2
    exit "$LIVE_STATUS"
  fi
  if [[ ! -s "$INVOCATION_LOG" ]] || \
     ! grep -q '"event":"tool_call".*"name":"register_task_setup"' "$INVOCATION_LOG" || \
     ! grep -q '"event":"tool_result".*"name":"register_task_setup".*"isError":false' "$INVOCATION_LOG" || \
     ! grep -q '"operation_id":"setup-op-live"' "$INVOCATION_LOG"; then
    echo "live smoke failed: no successful register_task_setup invocation and returned registration result was observed" >&2
    exit 1
  fi
  echo "Live smoke passed: OpenCode invoked register_task_setup and the MCP server returned setup-op-live."
fi
