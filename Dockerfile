# syntax=docker/dockerfile:1
#
# CalDAV Desktop —— 自托管（NAS / 服务器）镜像
#
# 一个容器同时提供：
#   - 后端 API（/api/*）
#   - 前端静态页面（/）
#   - 提醒推送调度（企业微信 / Server酱 / PushPlus / Bark / ntfy / Webhook）
#
# 数据（workspace.md + config.json）挂在 /data，升级镜像不丢。

# ---------- 构建阶段：装全部依赖并编译 ----------
FROM node:22-alpine AS build
WORKDIR /app
# 国内网络可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY
# 容器里 DNS 常先返回 IPv6，而默认 bridge 没有 IPv6 路由 → 下载会卡住。
# 优先 IPv4 可以避免这个坑（国内镜像尤其常见）。
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# 用 npm 装固定版本 pnpm：corepack 需要额外下载 pnpm 二进制，
# 在部分网络环境下会卡住；npm 走同一个 registry，稳定得多。
RUN npm install -g pnpm@11.8.0

# 先只拷依赖清单，利用 Docker 层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/renderer/package.json apps/renderer/package.json
# 国内镜像源在高并发下常出现单包超时（pnpm 默认 fetch-timeout 60s 不够）。
# 降低并发、放宽超时与重试，比整天重跑一次构建划算。
# 只装两个 workspace 包需要的依赖：根目录的 vitest/testing-library 等测试工具
# 在镜像构建里用不到，跳过它们能少下 100+ 个包（国内网络下差别很大）。
RUN pnpm install --frozen-lockfile --registry=$NPM_REGISTRY \
      --filter caldav-server... --filter caldav-renderer... \
      --network-concurrency=4 \
      --fetch-timeout=180000 \
      --fetch-retries=5

COPY apps/server apps/server
COPY apps/renderer apps/renderer
COPY schema schema

# VITE_API_URL 置空 = 前端走同源（否则会被 apps/renderer/.env 里的
# localhost:3001 带偏，别的设备打开页面就会去连自己的 localhost）
RUN pnpm --filter caldav-server build \
 && VITE_API_URL= pnpm --filter caldav-renderer build

# ---------- 运行依赖：只装生产依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN npm install -g pnpm@11.8.0
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/renderer/package.json apps/renderer/package.json
# .npmrc 里是 node-linker=hoisted，所以依赖会平铺在 /app/node_modules
RUN pnpm install --prod --frozen-lockfile --filter caldav-server... --registry=$NPM_REGISTRY \
      --network-concurrency=4 \
      --fetch-timeout=180000 \
      --fetch-retries=5

# ---------- 运行时 ----------
FROM node:22-alpine AS runtime
# 国内网络可传 --build-arg APK_MIRROR=mirrors.aliyun.com
ARG APK_MIRROR=dl-cdn.alpinelinux.org
# 复用 node:22-alpine 自带的 node 用户（uid/gid 都是 1000）：
#   - alpine 的 gid 100 是 users 组；node 镜像里 gid 1000 已属于 node，不能重建
#   - uid/gid 1000 是绝大多数 Linux 桌面发行版的默认首个用户，
#     这样 bind mount 的 data/ 宿主机用户天然可读写，不用额外 PUID/PGID
RUN sed -i "s#dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories \
 && apk add --no-cache tzdata su-exec \
 && mkdir -p /data /app/public /app/apps/server \
 && chown -R node:node /data /app

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    TZ=Asia/Shanghai \
    STATIC_DIR=/app/public \
    WORKSPACE_FILE=/data/workspace.md \
    APP_CONFIG_PATH=/data/config.json

COPY --from=deps /app/node_modules ./node_modules
# pnpm 的依赖软链在 apps/server/node_modules 下，指向 ../../../node_modules/.pnpm；
# 两个目录都要拷，否则运行时会 ERR_MODULE_NOT_FOUND（实测踩过）。
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/renderer/dist ./public
COPY apps/server/package.json ./apps/server/package.json
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

WORKDIR /app/apps/server
# entrypoint 以 root 启动（必要时给 /data 改属主），随即 su-exec 降权为 node
ENTRYPOINT ["/app/docker-entrypoint.sh"]
