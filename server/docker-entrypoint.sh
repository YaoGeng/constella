#!/bin/sh
# S-01 生产版容器入口 v2（T6-14；PM 裁决 2026-11-11 路径 B）——启动序=迁移先行后启动：
#   prisma migrate deploy（02-TDD §5.3「迁移在启动钩子执行」；§7.1#3 应用迁移建表、禁手工 DDL）
#   → exec CMD（node --import tsx src/index.ts——容器内 tsx 源码承载，见 Dockerfile 注释）。
#   prisma CLI 经 PATH 命中 /opt/run-tools/node_modules/.bin/prisma（离线容器禁 npx——可能触发网络安装）；
#   migrate deploy 输入=部署树内 prisma/（schema+migrations）+ prisma.config.ts（cwd=/app）。
#   AdminSeed（T2-11）由应用启动承担：src/index.ts bootstrap 内 ADMIN_* env 驱动幂等首建
#   （同 email 已存在 → 跳过不覆盖；未设 → noop）——迁移先行、seed 随首启，此处勿重复造 seed 调用。
#   契约#4：日志走 stdout/stderr JSON 行（logger=console JSON 序列化），由 Docker json-file 驱动轮转（§6.1）。
#   契约#2：DATABASE_URL 等凭据经容器 env 注入（compose environment/env_file），prisma.config.ts 运行期读取。
set -e
echo '{"level":"info","message":"prisma migrate deploy starting"}'
prisma migrate deploy
echo '{"level":"info","message":"prisma migrate deploy done"}'
exec "$@"
