# S-7 验证报告：server 模板审计 + docker-compose + CI

日期 2026-11-08 · 执行环境：本地 Windows/GitBash node 24.6.0 + 生产服务器 43.160.219.44（deploy 账号，Docker 29.9.2 / Compose v5.6.1）· 判据出处：02-TDD §15.3

## 一、判据核对

判据原文：**「compose 起 pg+server，注册登录刷新通过」** —— **PASS**

| 判据环节 | 实测证据（服务器 curl 127.0.0.1:8051） |
|---|---|
| compose 起 pg+server | `constella-s7-pg-1 Up (healthy)`、`constella-s7-server-1 Up (healthy)`；非 root（uid=100 app）；内存 pg 33MiB/512M、server 51MiB/512M；宿主绑定仅 `127.0.0.1:8051` |
| Prisma 7 迁移（全新 pg） | entrypoint `prisma migrate deploy` 日志：`1 migration found` → `Applying 20260429000000_init` → `All migrations successfully applied`；`_prisma_migrations` 表有记录，User/RefreshToken 表真实落库 |
| 注册 | `POST /auth/register` → **HTTP 201**，返回 `{accessToken, refreshToken}` |
| 登录 | `POST /auth/login` → **HTTP 200**，返回新 accessToken |
| 刷新 | `POST /auth/refresh` → **HTTP 200** 新令牌对；旧 refreshToken 重放 → **401**（一次性轮换验证） |
| 附加 | `/healthz` 200；`/user/profile` 带 JWT 200 / 无 JWT 401；重复注册 409；错误密码 401 |
| 收尾 | `down -v` 后 constella 容器/卷/网络 0 残留、8051 释放、4 个在营产品（mantis/zfk/forge/aim-nginx/aim-pg）状态不变；`/opt/aim` 全程未触碰 |

## 二、锁定版本

| 组件 | 版本 | 说明 |
|---|---|---|
| 模板 commit | `a7641e5`（2026-04-29） | github.com/YaoGeng/Hono-Prisma-PostgreSql-Template |
| hono / @hono/node-server | **4.12.15** / 2.0.0 | 满足 02 冻结「Hono 4+」 |
| prisma / @prisma/client / @prisma/adapter-pg | **7.8.0** | 满足 02 冻结「Prisma 7」，**无升级需求**；注意上游已有 8.0.0-rc，锁 7.x 勿漂移 |
| zod / typescript / bcryptjs / pg | 4.3.6 / 6.0.3 / 3.0.3 / 8.16.3 | npm ci 精确解析 |
| node base 镜像 | `node:24.6-alpine` | 与本地 node 24.6.0 对齐 |
| pg 镜像 | `postgres:16.14-alpine` | 一次性 spike 库，固定小版本 |

## 三、模板审计结论（供 TDD-S-01 出卡）

**保留（auth 域核心，02 §5.2 认定质量高于模板平均线）**：`POST /auth/register`（zod+邮箱唯一+bcrypt(10)）、`POST /auth/login`（dummy bcrypt 防时序探测）、`POST /auth/refresh`（SHA256 落库+一次性轮换，重放实测 401）、`auth.middleware.ts`（hono/jwt HS256）、`GET /user/profile`、`prisma/models/` 多文件 schema（与 02 §7.2 同构）、utils 四件（env zod 校验 / logger JSON stdout / prisma adapter 单例 / process-handlers 优雅关闭）。

**与 02 契约差异（TDD-S-01 改造项）**：① register/login 响应缺 `user:{id,email,role}`；② 错误体是平文 `{error:"..."}`，需改 02 §6.1 统一结构 `{error:{code,message,requestId}}` 与 AUTH-\* 错误码；③ User 缺 `role/isAuthor/status` 字段（迁移）；④ `RefreshToken.tokenHash` 模板为 `@@index`，02 要求 `@unique`（顺带封堵并发轮换竞态）；⑤ 路由需挂 `/api` 前缀。

**需剥离**：README/README_EN（模板自述）；`JWT_REFRESH_SECRET` 校验（refresh 非 JWT、当前未使用，出卡时删）；模板无其他 demo 域（很干净）。

**TDD-S-01~S-05 之外多出（建议保留的基础设施）**：`.env.{APP_ENV}` 三环境加载、SIGTERM/SIGINT 处理、JSON 结构化日志、prettier/eslint 配置。

**关键缺陷（spike 已修复，出卡必须带上）**：模板 `npm start` 链路**从未跑通**（印证 02「无 CI 佐证」风险）——tsc 产物在 node ESM 下双重断裂：(a) src 相对导入无扩展名（`ERR_UNSUPPORTED_DIR_IMPORT`）；(b) Prisma 7 `prisma-client` generator 默认输出 TS 且内部 import 无扩展名。修复=src 导入补 `.js` + generator 补 `runtime="nodejs" moduleFormat="esm" importFileExtension="js"` 三项 + `tsconfig include generated`（改动文件：src 全部 .ts 相对导入、prisma/schema.prisma generator 块、tsconfig.json）。其他注意：模板无 LICENSE 文件（fork 后补，02 §5.2 已提示）；`prisma generate` 也要求 DATABASE_URL 存在（prisma.config.ts 顶层求值，CI/Docker 用占位值）；register 的 findUnique+create 有竞态（并发抛 P2002 而非 409，tokenHash 方案无关，可 catch P2002 转 409）；`hono/utils/jwt/jwt` 属内部 API 路径，建议改 `hono/jwt`；v7 CLI `migrate diff` 参数更名（`--to-schema-datamodel`→`--to-schema`）且 stdout 混入 dotenv 提示行需过滤。

## 四、部署标准 §6 契约符合性

| # | 契约 | 结果 |
|---|---|---|
| 1 | 容器内 0.0.0.0:端口，宿主 127.0.0.1:80X1 | ✅ 实测容器内 `:::8051`（IPv6 any 双栈）、宿主 `127.0.0.1:8051`（ss 确认非 0.0.0.0） |
| 2 | 配置全环境变量注入，密钥不进镜像 | ✅ env_file + environment；.dockerignore 排除 `.env*`；凭据一次性随机值、服务器 .env 600、用后已删 |
| 3 | GET /healthz 返回 200 | ✅ spike 新增最小实现（模板原本没有），实测 200 |
| 4 | 日志 stdout/stderr + json-file 轮转 | ✅ logger JSON 行输出；compose logging 10m×3 |
| 5 | 会话自管理（JWT 无状态/PG session） | ✅ 15min JWT + PG RefreshToken 表，无共享缓存依赖 |
| 6 | 连 aim-pg:5432 专属账号 | ⚠️ **spike 差异**：按隔离红线用自带一次性 pg 16 容器 + 独立网络 s7net，未连 aim-pg；生产接入时仅需改 DATABASE_URL 指向 aim-pg、compose 去掉 pg 服务 |

§6.1 差异：restart 用 `no`（spike 不驻留红线）而非 unless-stopped；项目名 constella-s7；compose 内 build（生产按标准走 CI 镜像推送，服务器不构建）。

## 五、复现命令（全链路）与 CI 就绪度

```bash
# 本地准备（spikes/s7-server/template，已含 spike 改动）
npm ci && DATABASE_URL=postgresql://p:p@localhost:5432/p npx prisma generate && npm run typecheck && npm run build
# 上服务器（隔离目录，deploy 账号）
tar czf - --exclude={.git,node_modules,generated,dist} . | ssh deploy@43.160.219.44 "mkdir -p ~/constella-s7 && tar xzf - -C ~/constella-s7"
ssh deploy@43.160.219.44 'cd ~/constella-s7 && { echo "PG_PASSWORD=$(openssl rand -hex 16)"; echo "JWT_SECRET=$(openssl rand -hex 32)"; echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"; } > .env && chmod 600 .env'
# 冒烟（build → up → 迁移日志 → 三接口 → healthz）
ssh deploy@43.160.219.44 'cd ~/constella-s7 && docker compose -p constella-s7 build && docker compose -p constella-s7 up -d && sleep 25 && docker compose -p constella-s7 ps && docker compose -p constella-s7 logs server | head -15 && curl -s -w " [%{http_code}]" http://127.0.0.1:8051/healthz'
#   注册/登录/刷新：POST /auth/{register,login,refresh}（证据见上表；完整脚本见本报告归档命令历史）
# 清理
ssh deploy@43.160.219.44 'cd ~/constella-s7 && docker compose -p constella-s7 down -v && rm -f .env && docker ps --format "{{.Names}}" | grep -c constella || true'
```

**CI 就绪度**：`spikes/s7-server/ci/server-ci.yml`（lint → typecheck → build → 镜像构建 → compose 冒烟三接口断言，teardown always），**actionlint 1.7.7 校验通过（exit 0）**；实际运行留待 constella 仓库推送 GitHub 后（本次未创建任何 GitHub 仓库）。该 workflow 假设 server 代码位于仓库 `server/` 子目录，接入时按实际路径调整。

## 六、剩余风险

- 模板单人维护、上游已出现 Prisma 8 RC——fork 后冻结 lockfile，升级独立评估。
- Spike 修复的 ESM/generator 改动尚未回写模板上游，TDD-S-01 出卡时以本 spike 目录 `template/` 为基线（勿从上游重新 clone 直接用）。
- CI 冒烟未实跑（无远端仓库），首次推送后需人工盯一次流水线。
