# syntax=docker/dockerfile:1
# S-7 spike：Hono+Prisma7 模板容器化（base 固定版本，非 root，HEALTHCHECK=/healthz）
FROM node:24.6-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
# Prisma 7 的 prisma.config.ts 顶层求值即要求 DATABASE_URL 存在，generate 不连库、占位即可
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

FROM node:24.6-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    APP_ENV=prod
RUN addgroup -S app && adduser -S app -G app
# 运行时产物：编译后的 dist（含 dist/generated，见 tsconfig include）+ prod 依赖
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
# prisma CLI（devDep）单独安装：entrypoint 需要它执行 migrate deploy
RUN npm install --no-save --ignore-scripts prisma@7.8.0 \
 && npm cache clean --force
# migrate deploy 输入：schema + migrations + config
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app prisma.config.ts ./
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER app
EXPOSE 8051
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8051}/healthz" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
