#!/usr/bin/env bash
# 端到端验收：起一个**隔离**的临时服务，跑两个验收脚本。
#
# 为什么要隔离：
#   - v0.3 起 /api/* 需要 Bearer token，手跑脚本很容易整片 401；
#   - 验收脚本会写数据、改配置，绝不能碰用户真实的 workspace.md / config.json；
#   - 仓库根目录的 .env / config.json 里有真实 CalDAV / WebDAV 账号，
#     隔离服务必须用临时 config.json 覆盖掉，否则会去连真实服务器。
#
# 用法：
#   pnpm -C apps/server build && bash scripts/run-e2e.sh
#   可选环境变量：PORT（默认 3011）、KEEP_TMP=1（保留临时目录便于排查）
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3011}"
TMP="$(mktemp -d)"
SRV=""

cleanup() {
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null || true
  if [ "${KEEP_TMP:-0}" = "1" ]; then
    echo "临时目录保留在：$TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

cd "$ROOT/apps/server"
[ -f dist/index.js ] || { echo "缺少 dist/index.js，先跑 pnpm -C apps/server build"; exit 1; }

# ── 临时配置：CalDAV 指向必然连不上的地址，WebDAV 留空，AI 关闭 ──
cat > "$TMP/config.json" <<'JSON'
{
  "ai": { "enabled": false, "baseUrl": "", "apiKey": "" },
  "caldav": {
    "rootUrl": "http://127.0.0.1:9/",
    "username": "e2e",
    "password": "e2e-secret",
    "calendarUrl": "http://127.0.0.1:9/dav/cal/",
    "autoSyncMinutes": 0
  },
  "webdav": { "enabled": false, "url": "", "username": "", "password": "", "remoteDir": "CalDAV-Desktop" },
  "notifications": { "enabled": false }
}
JSON

cat > "$TMP/workspace.md" <<'MD'
---
schema: workbench/v1
---

# 工作台
MD

TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

echo "=== 启动隔离服务（port $PORT）==="
PORT="$PORT" \
HOST=127.0.0.1 \
WORKSPACE_FILE="$TMP/workspace.md" \
APP_CONFIG_PATH="$TMP/config.json" \
API_TOKEN="$TOKEN" \
CALDAV_SYNC_STATE_FILE="$TMP/.caldav-sync-state.json" \
node dist/index.js > "$TMP/server.log" 2>&1 &
SRV=$!

for _ in $(seq 1 100); do
  curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1 && break
  sleep 0.2
done
if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo "服务启动失败，日志："
  cat "$TMP/server.log"
  exit 1
fi

export VERIFY_BASE_URL="http://127.0.0.1:$PORT"
export VERIFY_TOKEN="$TOKEN"

STATUS=0
echo ""
echo "=== 验收 1/2：acceptance.e2e.mjs ==="
node src/__tests__/acceptance.e2e.mjs || STATUS=1

echo ""
echo "=== 验收 2/2：workspace-acceptance.e2e.mjs ==="
node src/__tests__/workspace-acceptance.e2e.mjs || STATUS=1

if [ "$STATUS" -ne 0 ]; then
  echo ""
  echo "--- 服务端日志（尾部）---"
  tail -30 "$TMP/server.log"
fi
exit "$STATUS"
