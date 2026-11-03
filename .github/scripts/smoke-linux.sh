#!/usr/bin/env bash
set -euo pipefail

# This checks process/window startup under X11, not complete desktop behavior.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
log_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dynisland-smoke.log"
app_pid=''

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if (( status != 0 )); then
    cat "$log_file" >&2 || true
  fi
  exit "$status"
}
trap cleanup EXIT

GDK_BACKEND=x11 src-tauri/target/release/dynisland >"$log_file" 2>&1 &
app_pid=$!

if ! timeout --kill-after=2s 15s xdotool search --sync --onlyvisible --name '^DynIsland$'; then
  echo 'DynIsland did not show an X11 window within 15 seconds.' >&2
  exit 1
fi

sleep 2
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo 'DynIsland exited after creating its window.' >&2
  exit 1
fi

echo 'Linux startup smoke test passed: visible X11 window and live process.'
