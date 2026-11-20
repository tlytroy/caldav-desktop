#!/bin/sh
# 以 root 启动，把数据目录属主对齐到容器内 node 用户，然后降权运行。
#
# 背景：镜像基于 node:22-alpine，自带 node 用户 uid/gid = 1000，
# 而 1000 正好是绝大多数 Linux 桌面发行版的默认首个用户。
# 所以 bind mount 出来的 ./data 通常天然就是 uid 1000，容器直接可读写；
# 宿主机用户也能用自己的编辑器改 workspace.md（它是唯一事实源）。
#
# 如果你的 uid 不是 1000，用 PUID / PGID 覆盖：
#   PUID=1001 PGID=1001 docker compose up -d
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$PUID" != "1000" ] || [ "$PGID" != "1000" ]; then
  # alpine 的 busybox 没有 usermod，只能删了重建（node 用户此时无进程占用）
  deluser node >/dev/null 2>&1 || true
  delgroup node >/dev/null 2>&1 || true
  addgroup -g "$PGID" -S node >/dev/null 2>&1 || true
  adduser -S -G node -u "$PUID" node >/dev/null 2>&1 || true
  echo "[entrypoint] 容器内 node 用户 -> uid=$PUID gid=$PGID"
fi

if [ -d /data ]; then
  # 不做无条件 chown -R：备份可能有几万条，每次启动递归改属主会让
  # NAS 上的容器启动拖到几十秒。先探测能不能写，不行才 chown 一次。
  if ! su-exec node test -w /data 2>/dev/null; then
    echo "[entrypoint] /data 对 node 用户不可写，修正属主…"
    chown -R node:node /data 2>/dev/null || true
  fi
fi

exec su-exec node node /app/apps/server/dist/index.js
