#!/bin/sh
# S-7 spike 容器入口：先应用迁移，再启动应用（对齐 02-TDD §5.3「迁移在启动钩子执行」）
set -e
echo '{"level":"info","message":"prisma migrate deploy starting"}'
npx prisma migrate deploy
echo '{"level":"info","message":"prisma migrate deploy done"}'
exec "$@"
