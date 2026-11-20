#!/usr/bin/env bash
# v0.2.x -> v0.3.0 升级演练（本地，不联网，不碰真实数据）
#
# 用一份「v0.2.x 风格」的 workspace.md（无 uid / 无 remind / frontmatter 有自定义字段 /
# 故意夹一个缺 id 的坏块），以 WORKSPACE_FILE 指向它、不带任何 token 启动 dist/index.js，
# 验证：token 自动生成、鉴权、坏块容错、frontmatter 保真、编码路径拦截、同步概览可用。
#
# 用法：先 pnpm -C apps/server build，然后在仓库根目录执行 bash scripts/upgrade-drill.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3991}"
TMP=$(mktemp -d)
SRV=""
cleanup() {
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

cd "$ROOT/apps/server"
[ -f dist/index.js ] || { echo "缺少 dist/index.js，先跑 pnpm -C apps/server build"; exit 1; }

echo "=== 1. 造一份 v0.2.x 风格数据 ==="
cat > "$TMP/workspace.md" <<'EOF'
---
schema: caldav-desktop/workspace
schemaVersion: 1
myCustomField: keep-me
---

# 工作台

## 2026-11-10 09:00:00 · 老会议

- id: aaaaaaa1
- kind: event
- start: 2026-11-10T09:00:00
- end: 2026-11-10T10:00:00
- list: 工作
- tags: [周会, 重要]

老事件的备注正文。

## 2026-11-11 · 老任务

- id: bbbbbbb2
- kind: task
- due: 2026-11-11
- done: false
- priority: mid
- list: 收件箱
- parent: aaaaaaa1

## 一条坏的块（没有 id）

- kind: task
- title: 手动写坏的
EOF

echo "=== 2. 用 v0.3.0 服务端启动（不带 token 文件，模拟升级）==="
PORT=$PORT \
WORKSPACE_FILE="$TMP/workspace.md" \
APP_CONFIG_PATH="$TMP/config.json" \
ALLOW_UNSAFE_FS=1 \
node dist/index.js > "$TMP/server.log" 2>&1 &
SRV=$!

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1 && break
  sleep 0.2
done

head -12 "$TMP/server.log"

TOKEN_FILE="$TMP/api-token.txt"
echo "--- token 文件 ---"
ls -l "$TOKEN_FILE"
TOKEN=$(cat "$TOKEN_FILE")
echo "token 长度: ${#TOKEN}"

echo "=== 3. 无 token 读 -> 必须 401 ==="
curl -s -o /dev/null -w "  /api/workspace/items  -> %{http_code}\n" "http://127.0.0.1:$PORT/api/workspace/items"

echo "=== 4. 带 token 读 -> 200，坏块不影响好条目 ==="
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/workspace/items" > "$TMP/items.json"
node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log("  count:", d.count, "notes:", (d.notes || []).length);
for (const it of d.items) console.log("   -", it.id, it.kind, it.title, "| list:", it.list, "| uid:", it.uid ?? "(none)");
if (d.count !== 2) { console.error("FAIL: 期望 2 条可解析条目"); process.exit(1); }
console.log("  OK: 坏块被跳过，好条目保留");
' "$TMP/items.json"

echo "=== 5. 编码路径绕过 -> 必须 400 / 401 ==="
curl -s -o /dev/null -w "  /%%61pi/workspace/items -> %{http_code}\n" "http://127.0.0.1:$PORT/%61pi/workspace/items"
curl -s -o /dev/null -w "  /API/workspace/items  -> %{http_code}\n" "http://127.0.0.1:$PORT/API/workspace/items"

echo "=== 6. 写一条并确认 frontmatter/未知字段保留 ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"task","title":"升级后新建","due":"2026-12-01","list":"收件箱"}' \
  "http://127.0.0.1:$PORT/api/workspace/items" > /dev/null
head -6 "$TMP/workspace.md"
if grep -q "myCustomField: keep-me" "$TMP/workspace.md"; then
  echo "  OK: frontmatter 自定义字段保留"
else
  echo "  FAIL: frontmatter 丢失"; exit 1
fi

echo "=== 7. 同步概览（不联网，未配置也要能开）==="
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/sync/overview" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const o = JSON.parse(s);
  console.log("  caldav.configured:", o.caldav?.configured, "| webdav.configured:", o.webdav?.configured,
              "| events:", o.events?.length, "| conflicts:", o.conflicts?.length);
});'

echo
echo "=== 升级演练完成 ==="
