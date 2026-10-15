#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
node_bin=""
for candidate in "$(command -v node || true)" "$HOME"/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
  if [ -x "$candidate" ] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
    node_bin="$candidate"
    break
  fi
done
if [ -z "$node_bin" ]; then echo '请先安装 Node.js 22 或更高版本；脚本不会改动你的默认 Node。' >&2; exit 1; fi
"$node_bin" "$project_dir/scripts/check.mjs"
"$node_bin" "$project_dir/scripts/build.mjs"
"$node_bin" "$project_dir/scripts/install-native.mjs"
"$node_bin" "$project_dir/scripts/doctor.mjs"
