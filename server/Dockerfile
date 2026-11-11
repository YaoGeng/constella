# syntax=docker/dockerfile:1
# S-01 生产版容器 v2（T6-14；PM 裁决 2026-11-11 采路径 B：容器内 tsx 源码承载）
#   形态变更缘由（四条，登记=DEPLOY.md「镜像形态」节）：①零改 shared/server src/根配置；②启动链=仓库自身
#   验证链（admin-smoke 同款 tsx 形态）；③部署标准 §6/§8 与 TDD-S-01 §3 均未冻结 dist 编译形态（dist 形
#   =S-7 spike 时代自选，对当前代码形态从未生效）；④路径 A 触 shared exports 外溢 client/admin 消费面。
#   构建上下文=仓库根（compose build.context: ..；构建命令形 docker build -f server/Dockerfile -t constella-server:<V> .）。
#   版本镜像标签（§6.1 禁 latest）：ARG VERSION（默认=server/package.json version，二者同步维护）
#   → LABEL org.opencontainers.image.version；产物镜像名 constella-server:<VERSION>。
#   契约#2 密钥不进镜像：根 .dockerignore 排除 .env*；构建期 DATABASE_URL 仅为 prisma generate 顶层求值占位。

# 版本默认值与 server/package.json "version" 同步维护（当前 0.0.0=模板遗留；首次上线建议随 release 同步升为 0.1.0）
ARG VERSION=0.0.0

FROM node:24.6-alpine AS builder
WORKDIR /repo
# pnpm 由 corepack 按根 package.json packageManager 字段解析（pnpm@12.11.2）——与 lockfile 生成器同版
RUN corepack enable
# manifest 先行（层缓存）：根三件 + server 闭包成员 package.json（--filter ./server... = server 及其 workspace 依赖 shared）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
# 只装 server 闭包；--frozen-lockfile=禁改 lockfile 的任何 install 变体（PM 裁决约束）
RUN pnpm install --filter ./server... --frozen-lockfile
# 源码后拷：shared 源（exports 指 .ts——tsx 承载必需）+ server 全量（src/prisma/entrypoint/tsconfig）
COPY shared ./shared
COPY server ./server
# Prisma client 生成（server/generated 被 .gitignore 排除——CI 新鲜 clone 无此目录，构建期必须显式生成）。
# Prisma 7 的 prisma.config.ts 顶层求值要求 DATABASE_URL 存在，generate 不连库、占位即可（spike 先例）。
RUN cd server \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate
# 部署树（可行性阶梯首选，实测 pnpm 12.11.2 无 inject-workspace-packages 前置限制）：
# pnpm deploy 实拷 workspace 依赖自包含（@constella/shared 实体入树内 .pnpm，非指向仓库的 symlink）；
# --prod=仅生产依赖。本地等价验证以同产出树+同 CMD 形态实测通过（见 server/deploy/DEPLOY.md）。
# rm .env*=第二层密钥防线（评审 M-1）：pnpm deploy 会把 server/ 下 .env* 原样拷进树（本地脏树实测证实）；
# 第一层=根 .dockerignore 排除 **/.env*（构建上下文外挡），此处防御本地绕过 ignore 的脏树形态。
RUN pnpm --filter ./server... deploy --prod /deploy \
 && rm -f /deploy/.env /deploy/.env.*

FROM node:24.6-alpine AS runner
ARG VERSION
WORKDIR /app
ENV NODE_ENV=production \
    APP_ENV=prod \
    # 运行件 bin（prisma CLI）入 PATH——entrypoint 直调（npx 在离线容器可能触发网络安装，弃用）
    PATH="/opt/run-tools/node_modules/.bin:${PATH}"
# §6.1：生产镜像使用明确版本标签、禁 latest；版本随 docker inspect 可核
LABEL org.opencontainers.image.title="constella-server" \
      org.opencontainers.image.version="${VERSION}"
RUN addgroup -S app && adduser -S app -G app
# 部署树→/app（server 包根形态：package.json/prisma/src/generated/node_modules 铺于 /app）
COPY --from=builder --chown=app:app /deploy ./
# ENTRYPOINT 显式安装位（评审 B-1，spike 先例恢复）：git 内文件 100644 无执行位＋/app 不在 PATH——
# 两道保障缺一则 ENTRYPOINT 裸名不可解析；装 /usr/local/bin（默认 PATH）并补执行位后裸名形可保留。
# 源取 builder 的 /deploy（pnpm deploy 全拷 server/ 时带入树，与上下文根构建的 server/ 子树解耦）。
COPY --from=builder --chown=app:app /deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# 运行件独立 npm 树（spike「单独装 prisma CLI」先例扩展 +tsx）：实测 npm 无法写入 pnpm 形态 node_modules
# （Arborist 于 symlink 树崩溃）→ 装隔离目录 /opt/run-tools；独立 package.json 防 npm 向上解析到
# /app/package.json 的 workspace:* 依赖而崩溃；版本精确锁=根 pnpm-lock 解析值 tsx@4.23.15＋server devDep prisma@7.8.0
# 不加 --ignore-scripts（评审 B-2）：prisma registry tarball 零二进制——@prisma/engines postinstall 经网络
# 把平台 schema-engine（linux-musl）二进制下进包根；构建期容器有网、正是要它下（引擎入镜像层=自包含，
# 离线容器内 migrate deploy 才能跑）。test 行=engines postinstall 已执行的 fail-fast 复核（二进制缺失即构建失败）。
RUN mkdir -p /opt/run-tools \
 && printf '{"name":"constella-run-tools","private":true}\n' > /opt/run-tools/package.json \
 && cd /opt/run-tools && npm install --no-audit --no-fund prisma@7.8.0 tsx@4.23.15 \
 && test -n "$(ls /opt/run-tools/node_modules/@prisma/engines/*schema-engine* 2>/dev/null)" \
 && npm cache clean --force
USER app
EXPOSE 8051
# 契约#3：/healthz 健康检查（§6.7#3 禁止跳过健康检查直接宣告发布成功）
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8051}/healthz" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
# 路径 B：tsx 源码承载（cwd=/app=部署树 server 包根；shared exports 指 .ts 源，tsx loader 转译＋解析；
# 本地等价链以同形启动实测通过——healthz/login/AdminSeed 幂等，记录见 server/deploy/DEPLOY.md）
CMD ["node", "--import", "/opt/run-tools/node_modules/tsx/dist/loader.mjs", "src/index.ts"]
