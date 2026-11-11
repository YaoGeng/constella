# constella server 生产部署手册（SOP）

> 交付：T6-14（TDD-S-01 §3 DeployArtifacts 生产化）。依据＝《服务器部署标准》V1.5（仓库外文档，03 §7.5 登记）§5.3/§5.5/§6/§7/§8/§10。
> 目标：aimServer `43.160.219.44`（Ubuntu 24.04，日常账号 deploy，NOPASSWD sudo）；产品目录 `/opt/aim/constella`；端口 `8051`（§2.3「8051 起按 10 递增」首位）；域名 `constella.aim8848.com`（灰云直连）。
> 工件清单：`server/Dockerfile`（pnpm workspace 两段构建＋tsx 源码承载＋版本标签）、根 `.dockerignore`（上下文根防膨胀/密钥隔离）、`server/compose.yml`（生产版，build.context=仓库根）、`server/docker-entrypoint.sh`（迁移后启动）、`server/deploy/nginx/constella.aim8848.com.conf`（反代）、`server/deploy/env.example`（.env 模板）、本手册。
> T6-15 增补（A-01 admin 静态托管＋Basic Auth——部署标准 §5.3/§5.4/§6.3/§8 步 4·7）：conf `/admin` 段补真（占位注释撤）、步 4 收尾（zone=admin 检查＋htpasswd SOP＋401 验证）、步 7 全文（构建/同步/`admin_bak` 秒级回退/三态终验）、回滚流程②落形。
> 工件运行序（部署树内 migrate deploy → `node --import tsx src/index.ts` 启动 → AdminSeed 幂等首建 → healthz）已在本仓库以**与容器 CMD 同形**的部署树本地等价验证（`pnpm deploy --prod` 产出树实测：healthz/login/幂等全绿——记录见 T6-14 交付报告）；本手册为生产端 SOP。

---

## ⛔⛔ 用户确认门（两项均未确认前，本手册任何远端操作不得执行）

> ### 【标红·门 1】仓库推送 GitHub
> CI 镜像构建与推送依赖远端仓库（§6.5 步 1「CI 完成镜像构建并推送」）。**用户未确认推送前：不执行 git push、不创建/配置 GitHub 仓库、不做任何远端写入。** 门未过时镜像分发仅可走路径 B（开发机构建＋docker save｜ssh load 直推——zfk 已验证先例，见步 3）。

> ### 【标红·门 2】子域 constella.aim8848.com
> 子域名为**设计值**（T6-14 任务卡）。步 1 DNS 记录、步 4 nginx server_name、步 8 拨测地址均以此为标识——**用户确认前不创建 DNS 记录**；若改用其他子域，同步改 nginx conf 三处标识（server_name/日志名/证书不变）与步 8 地址即可。

> ### 镜像形态＝容器内 tsx 源码承载（设计值；登记：PM 裁决 2026-11-11，T6-14 停卡上报→裁定路径 B）
> CMD=`node --import tsx src/index.ts`（cwd=部署树 server 包根），镜像以 pnpm workspace 构建（构建上下文=仓库根）。
> 采此形态四条理由：①零改 shared/server src/根配置（领地纪律）；②启动链=仓库自身验证链（admin-smoke 同款 tsx 形态——本地等价验证升级为精确等价）；③部署标准 §6/§8 与 TDD-S-01 §3 均未冻结 dist 编译形态（dist 形=S-7 spike 时代自选，且已被证明从未对当前代码形态生效：`@constella/shared` 纯源码包〔exports 指 .ts〕致 `node dist` ESM 解析失败、spike 版 package-lock 与 workspace 事实矛盾——两遗物已随本裁决删除）；④路径 A（shared 出 dist）触 exports/构建策略，外溢 client/admin 消费面，超本卡当量。
> pnpm 策略：corepack 按根 `packageManager`（pnpm@12.11.2）解析；`pnpm install --filter ./server... --frozen-lockfile`（禁改 lockfile）；部署树=`pnpm --filter ./server... deploy --prod`（可行性阶梯首选，实测 pnpm 12.11.2 无 inject-workspace-packages 前置限制；workspace 依赖实拷自包含）；运行件 prisma@7.8.0＋tsx@4.23.15（=根 lockfile 解析值，精确锁）装独立 `/opt/run-tools` npm 树（实测 npm 无法写入 pnpm 形态 node_modules）。
> **部署执行时验证项（本机无 Docker，留待 Docker 机补测；评审 NEEDS-REWORK 后扩三项）**：①容器可启动（entrypoint exec 链成功——ENTRYPOINT 裸名经 /usr/local/bin 命中＋迁移后 exec CMD）；②容器内 `prisma migrate deploy` **离线**可执行（`--network none` 形或断网验证 engine 二进制已随镜像层自包含——run-tools 安装不带 --ignore-scripts 的目的即此，见 Dockerfile B-2 注）；③esbuild linux 二进制 musl 实际形态（tsx 转译依赖 `@esbuild/linux-musl`，M-4 一并核）；④镜像体积代价实测（tsx 源码承载 vs 纯 dist 的差值）；⑤镜像内 HEALTHCHECK 联动。本地等价已覆盖的部分见文首「同形验证」句与文末「部署树本地同形验证 SOP」。

---

## §8 十步上线 SOP

> 步骤编号沿用标准 §8 表格；**执行时序**＝步 1 → 2 → 5（建库）→ 3（compose up 含迁移与 AdminSeed 首建）→ 4（nginx）→ 6（验证）→ 7 → 8 → 9 → 10。步 3 的完成标准（容器 running 且 healthy）隐含库已就绪，故建库（步 5）实际先于首启。

### 步 1 · Cloudflare A 记录（§8-1；依赖【门 2】）

Cloudflare 控制台 → aim8848.com → DNS：新增 A 记录 `constella → 43.160.219.44`，**保持灰云直连**（DNS only；不设通配符，逐条显式添加）。

完成标准：`nslookup constella.aim8848.com` 解析为 43.160.219.44。

### 步 2 · 产品目录与 .env（§8-2 / §4 目录结构）

```bash
ssh deploy@43.160.219.44
sudo mkdir -p /opt/aim/constella
sudo chown deploy:deploy /opt/aim/constella          # 目录 755（§4.2）
```

- 上传 `server/compose.yml` → `/opt/aim/constella/compose.yml`（配置即文件，纳入私有 git 追踪——§1.3#2）。
- 按 `server/deploy/env.example` 模板创建 `.env` 并填真实值（DB 密码/JWT_SECRET/ADMIN 凭据均新生成，经密码管理器传递——§6.4 禁聊天/日志明文），随后：

```bash
chmod 600 /opt/aim/constella/.env                    # 凭据文件，禁止放宽（§4.2/R2）
```

完成标准：目录 755、`.env` 存在且权限 600。

### 步 3 · 镜像分发与 compose up（§8-3 / §6.5「服务器不做构建，只做拉取与重启」）

**路径 A（首选，依赖【门 1】通过后配置）**：GitHub Actions 按 tag 触发构建并推送镜像仓库（zfk 先例：Actions tag 构建＋冒烟门）；构建命令形=路径 B 同款（仓库根上下文 `-f server/Dockerfile … .`）；随后把 `compose.yml` 的 `image:` 补全 registry 前缀（形 `<REGISTRY>/constella-server:${CONSTELLA_VERSION}`）并在本手册此行登记最终地址。服务器侧 `docker compose pull`。

**路径 B（门 1 未过时的直推等价——构建在开发机完成，服务器零构建）**：

```bash
# 开发机（于仓库根执行——构建上下文=根，见「镜像形态」节 pnpm 策略；VERSION 与 .env 的 CONSTELLA_VERSION、发布 tag 三者一致）
VERSION=$(node -p "require('./server/package.json').version")
docker build --build-arg VERSION="$VERSION" -f server/Dockerfile -t constella-server:"$VERSION" .
docker save constella-server:"$VERSION" | ssh deploy@43.160.219.44 docker load
```

**服务器启动**（前提：infra compose 已运行、aim-pg healthy——§11.2 已就位；infra 网络 external 缺失时 compose 会显式报错，不静默自建）：

> 注：`compose.yml` 的 `build:` 段（context=仓库根）服务于开发机/CI 构建——服务器侧镜像经 pull/load 就位后 `up -d` 直接用 `image:` 不触发构建（context 缺失无害）；服务器如需精简可删 build 两行，条款行为不变。

```bash
ssh deploy@43.160.219.44
cd /opt/aim/constella && docker compose up -d
docker compose -p constella ps                        # 完成：constella-server 状态 running（healthy）
docker image prune -f                                 # §6.5#4 健康通过后清理悬空镜像
```

### 步 4 · nginx conf 安装与 reload（§8-4 / §5.5 四步）

```bash
# 开发机 → 服务器
scp server/deploy/nginx/constella.aim8848.com.conf deploy@43.160.219.44:/tmp/constella.conf
ssh deploy@43.160.219.44
sudo mv /tmp/constella.conf /opt/aim/infra/nginx/conf.d/constella.conf
docker exec aim-nginx nginx -t                        # 校验通过才允许 reload
docker exec aim-nginx nginx -s reload
# 回源验证（§5.5#4 先本机回源、后全链路；forge 先例 --resolve 走 https）
curl -s --resolve constella.aim8848.com:443:127.0.0.1 https://constella.aim8848.com/healthz
```

完成标准：`nginx -t` 通过、reload 生效、回源返回 `{"status":"ok"}`。

**/admin 后台段已入 conf（T6-15 · A-01 交付）**——`location /admin` 四件套：静态托管 `www/admin/`＋`auth_basic`＋`limit_req zone=admin`＋`try_files` SPA 回退（§5.3 模板逐指令照抄）。conf 引用 zone=admin，`nginx -t` 在 zone 缺失时会直接报错（`unknown limit_req zone "admin"`）——主块校验前先核 zone；随 reload 一并收尾三件：

```bash
# ① zone=admin 存在性检查（§5.7：定义于 infra 00-hardening.conf，与 zone=api 同机制——
#    limit_req_zone $binary_remote_addr zone=admin:10m rate=1r/s;）。
#    缺失则在该 conf 补上述一行（服务器侧动作），随后重跑主块 nginx -t → reload。
grep -n 'zone=admin' /opt/aim/infra/nginx/conf.d/00-hardening.conf

# ② htpasswd 生成（§5.4 后台强制——「未启用 Basic Auth 的后台不得对外开放」；命令=§5.4 原文）。
#    Basic 口令独立于 .env 的 ADMIN_PASSWORD（双防线：Basic 门=运维层、应用 JWT=应用层，
#    §5.4「同时保留应用自身的强密码…作为第二道防线」——静态后台页面与 /api/ 异路径，无头冲突，§5.3 注）。
htpasswd -bc /opt/aim/infra/nginx/conf.d/admin.htpasswd <用户名> '<强密码>'
#    ※ admin.htpasswd 为全产品共用单文件（§5.4 单一路径式，各产品 conf 同引 /etc/nginx/conf.d/admin.htpasswd）：
#      文件已存在时改 `htpasswd -b`（追加用户/改密），勿 -c 覆盖他产品条目。
#    ※ 凭据经密码管理器传递——§6.4 红线原文「凭据不进入 git、不写入日志、不通过聊天工具传输」，
#      并汇总至 /opt/aim/infra/CREDENTIALS.md（600）。文件随 conf.d 只读挂载进 aim-nginx，生成即生效无需重启。
#    ※ 可选（有固定出口 IP 时，§5.4）：conf 的 /admin 段内追加 `allow <出口IP>; deny all;` 白名单。

# ③ Basic 门验证（主块 reload 之后；401=无凭据即拒=门已生效——步 7 前唯一可验态）
curl -s -o /dev/null -w "%{http_code}" https://constella.aim8848.com/admin/    # 期望 401（无凭据）
curl -s -o /dev/null -w "%{http_code}" -u '<用户名>:<强密码>' https://constella.aim8848.com/admin/
# 凭据正确时：步 7 前期望 404（www/admin/ 尚未同步、try_files 落空）；步 7 同步后=200——终验三态见步 7③
```

### 步 5 · aim-pg 建库建账号（§8-5 / §7.1 SOP）

```bash
ssh deploy@43.160.219.44
docker exec -it aim-pg psql -U postgres
```

```sql
-- §7.1#1（数据架构文档 9.1 初始化 SQL 等价形；R3 红线——constella 专属账号、权限限定本库，禁超级用户运行应用）
CREATE ROLE constella_app LOGIN PASSWORD '<DB_PASSWORD>';
CREATE DATABASE constella OWNER constella_app;
```

- §7.1#2：连接串 `postgresql://constella_app:<DB_PASSWORD>@aim-pg:5432/constella?schema=public` 写入 `.env`（步 2 模板位）并复核 600。
- §7.1#3：**建表由应用迁移完成**——首启经 entrypoint `prisma migrate deploy` 自动执行，**禁止手工 DDL 建表**。

完成标准：应用可连接并完成迁移（首启日志 `prisma migrate deploy done`，步 6 一并核）。

### 步 6 · 会话验证：AdminSeed 首启确认＋JWT 登录（§8-6）

```bash
ssh deploy@43.160.219.44
docker compose -p constella logs server | grep -E 'migrate deploy done|admin\.seed'
# 期望：prisma migrate deploy done ＋ admin.seed result=created（首启）；再次重启后 result=skipped（幂等，不重复建）
# JWT 登录验证（凭据从 .env 读入环境，避免明文进 shell history——§6.4）
cd /opt/aim/constella && set -a && . ./.env && set +a
curl -s -X POST http://127.0.0.1:8051/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
# 期望 200：{"accessToken":"…","refreshToken":"…","user":{…,"role":"admin"}} —— JWT 会话自管理可用（契约#5）
```

完成标准：登录 200 且返回 accessToken；管理凭据记入 CREDENTIALS.md（600）。

### 步 7 · admin 构建产物同步 www（§8-7 / §6.3；T6-15 · A-01 交付）

constella V1 无用户端 Web（client=桌面端 Tauri 应用），`location /` 保持 404；本步对象=**admin 静态后台**——开发机构建 → scp 同步至 `/opt/aim/constella/www/admin/`（§6.3「CI 构建产物通过 rsync/scp 同步至 www/」；本开发机 Git Bash 无 rsync，取 scp 形——仓库外 `aim/deploy.sh` scp 先例）→ 步 4 Basic 门后三态终验。发布保留上一版本为 `admin_bak`（§6.3「保留上一版本为 `www_bak`，用于秒级回退」的 admin 形态），异常换回即回滚（§6.6②）。

**① 构建（开发机，仓库根执行）**：

```bash
pnpm -F ./admin run build        # vite build → admin/dist（base='/admin/'＝A-01 §4 设计值，vite.config.ts 已冻结）
grep -o '/admin/assets/[^" ]*' admin/dist/index.html | sort -u    # base 落位核对：资源引用前缀须全为 /admin/
```

**② 同步（Windows Git Bash → deploy@43.160.219.44；先备份后同步，防半传状态对外可见）**：

```bash
# 备份上一版本（服务器侧；admin_bak=秒级回退点——§6.3。首发布无 admin 目录时提示无害）
ssh deploy@43.160.219.44 'mkdir -p /opt/aim/constella/www && rm -rf /opt/aim/constella/www/admin_bak; mv /opt/aim/constella/www/admin /opt/aim/constella/www/admin_bak 2>/dev/null || echo "(首发布：无旧版可备份)"'
# 上传（先落临时名）
scp -r admin/dist deploy@43.160.219.44:/opt/aim/constella/www/_admin_incoming
# 原子换名落位（同分区 mv 秒级完成；服务器不做构建，只接收静态产物——§6.5）
ssh deploy@43.160.219.44 'mv /opt/aim/constella/www/_admin_incoming /opt/aim/constella/www/admin'
```

**③ 三态终验（凭据=步 4② htpasswd；SPA 回退=深链刷新仍 200——§6.3「SPA 应用必须配置 `try_files ... /index.html` 回退」）**：

```bash
curl -s -o /dev/null -w "%{http_code}" https://constella.aim8848.com/admin/                                # 期望 401（无凭据）
curl -s -o /dev/null -w "%{http_code}" -u '<用户名>:<强密码>' https://constella.aim8848.com/admin/        # 期望 200
curl -s -o /dev/null -w "%{http_code}" -u '<用户名>:<强密码>' https://constella.aim8848.com/admin/users   # 期望 200（SPA 回退）
```

**④ 发布异常秒级回退（§6.6②「前端异常：将 `www_bak` 换回 `www`」——admin 形态=`admin_bak` 换回 `admin`）**：

```bash
ssh deploy@43.160.219.44 'rm -rf /opt/aim/constella/www/admin && mv /opt/aim/constella/www/admin_bak /opt/aim/constella/www/admin'
# 回退后以 ③ 复验三态；故障现象/回滚时间/原因按 §6.6#4 登记
```

### 步 8 · UptimeRobot 拨测（§8-8）

UptimeRobot 控制台：新增 HTTPS 监控 `https://constella.aim8848.com/healthz`，间隔 5 分钟（§9 表）。完成标准：探测返回 200。

### 步 9 · 备份脚本加库（§8-9 / §7.1#4 / §7.2）

既有脚本＝`/opt/aim/scripts/backup.sh`（cron 每日 03:00，§7.2）。加库操作（forge 先例：改前备份原件、sed 后核 diff）：

```bash
ssh deploy@43.160.219.44
sudo cp /opt/aim/scripts/backup.sh /opt/aim/scripts/backup.sh.bak_constella_$(date +%Y%m%d)
grep -n 'ljr\|zfk\|mantis\|forge' /opt/aim/scripts/backup.sh        # 先确认清单变量名与写法（字符串/数组）
# 字符串清单形（变量名按上一步结果调整）：
sudo sed -i 's/^\(DBS="[^"]*\)"/\1 constella"/' /opt/aim/scripts/backup.sh
# 数组清单形：sudo sed -i 's/^\(DBS=(.*\))\s*$/\1 constella)/' /opt/aim/scripts/backup.sh
grep -n constella /opt/aim/scripts/backup.sh                        # 核对追加成功
sudo /opt/aim/scripts/backup.sh                                     # 手动触发一次（§11.1），确认 constella dump 非零
```

完成标准：次日备份文件生成且包含 constella 库。

### 步 10 · 资源分配表登记两份（§8-10 / §7.1#5）

两份文档均仓库外维护（§7.5）——登记字段：产品 constella / 端口 8051（回环）/ 库 constella / 账号 constella_app / 目录 /opt/aim/constella / DNS constella.aim8848.com / 镜像 constella-server:\<VERSION\>：

1. 《数据架构文档》5.4 资源分配表——新增 constella 行；
2. 《服务器部署标准》——§2.3 端口分配总表 8051 行生效＋11.2 追加 constella 部署记录段（zfk/forge 先例）。

完成标准：文档与线上一致。

---

## 回滚流程（§6.6）

1. 镜像回退：`.env` 中 `CONSTELLA_VERSION` 改回上一可用版本 → `docker compose up -d`（标签回退即回滚，禁 latest 的原因之一）；
2. 前端异常：`www_bak` 换回 `www`——constella admin 形态=`admin_bak` 换回 `admin`（命令见步 7④）；
3. **数据不回滚**：结构变更遵循 expand–contract，数据修复走补偿脚本（§7.4）；
4. 记录故障现象、回滚时间与原因。

## 部署禁止事项（§6.7 三禁止）

- 禁止在生产容器内手动修改文件或手工 `npm install`；
- 禁止开放调试端口（如 9229、5678）到任何非回环地址；
- 禁止跳过健康检查直接宣告发布成功（`docker compose ps` 须 healthy＋步 6 全过才算完成）。

## 安全红线（§10）

| 编号 | 红线 |
|---|---|
| **R4** | **破坏性结构变更（删列/改类型/缩容字段）前必须确认当日备份可用**（§7.4：一律经迁移工具、迁移文件进 git、大表 expand–contract、禁未评审 SQL 直上生产库） |
| R1 | 数据库/Redis 端口对公网开放（数据层仅容器网络：aim-pg 不发布端口、server 仅回环 8051） |
| R2 | 密码/密钥写入代码仓库或聊天记录（仅存服务器 .env〔600〕与密码管理器；工件全占位符） |
| R3 | 应用使用数据库超级用户运行（constella_app 权限限定本库） |
| R5 | 生产环境长期运行未容器化进程（一切长期进程由 compose 托管） |
| R6 | 关闭防火墙或长期临时放行 |
| R7 | 使用 root 日常操作（一律 deploy 账号） |

---

## 附：§6 接入契约六条对照表

| # | 契约条款 | 工件落点 | 状态 |
|---|---|---|---|
| 1 | 容器内监听 0.0.0.0:8051，compose 映射宿主 127.0.0.1:8051 | `@hono/node-server` 监听全接口（spike 已验）＋compose `ports: "127.0.0.1:8051:8051"`（禁 0.0.0.0） | ok |
| 2 | 全部配置经环境变量注入（各自 .env），密钥不打包进镜像 | compose `env_file`＋`environment` `${VAR:?}` 强制；Dockerfile 无真实凭据（构建期 DATABASE_URL=占位符）；根 `.dockerignore` 排除 `**/.env*`（上下文根密钥隔离）；`deploy/env.example` 全占位符 | ok |
| 3 | 提供 GET /healthz，正常返回 200 | server `/healthz`（本地等价验证第 4 步实测 `{"status":"ok"}`）＋Dockerfile HEALTHCHECK＋nginx `location = /healthz` 透传 | ok |
| 4 | 日志写 stdout/stderr，json-file 驱动统一轮转 | logger=console JSON 行（stdout）；compose `logging: json-file max-size 10m max-file 3`；entrypoint 迁移日志同为 JSON 行 | ok |
| 5 | 会话自管理（JWT 无状态或 PG session 表），不依赖共享缓存 | TokenService HS256 access(15min)/refresh SHA256 一次性轮换（PG 表存储，S-01 C4/C5），无 Redis 依赖 | ok |
| 6 | 数据库连接指向 aim-pg:5432，使用本产品专属账号 | compose `networks: [infra]`（external）＋DATABASE_URL 主机名=容器名 `aim-pg:5432`＋constella_app 专属账号（步 5 §7.1） | ok |

## 附：§6.1 容器规范对照表

| 条款 | 工件落点 | 状态 |
|---|---|---|
| 每产品一个 compose 项目，项目名与产品目录同名 | `name: constella`（目录 /opt/aim/constella；`docker compose -p constella`） | ok |
| 所有服务 restart: unless-stopped | server 服务 `restart: unless-stopped`（spike 版 no 已改回） | ok |
| 后端容器内存限制 512M | `deploy.resources.limits.memory: 512M` | ok |
| json-file 日轮转 max-size 10m / max-file 3 | `logging` 配置逐字对齐 | ok |
| 明确版本标签，禁 latest | `image: constella-server:${CONSTELLA_VERSION:?…}`＋Dockerfile `ARG VERSION`/LABEL；构建命令显式 `-t constella-server:<V>` | ok |
| 后端端口仅绑 127.0.0.1 | `ports: "127.0.0.1:8051:8051"` | ok |

---

## 附：部署树本地同形验证 SOP（无 Docker 机的等价验证链；T6-14 实测通过，供 Docker 机补测前复验）

> 目的：以 `pnpm deploy` 产出树＋独立运行件树，在本机复现容器内「entrypoint 迁移 → CMD tsx 启动 → healthz/login → AdminSeed 幂等」全链（与 Dockerfile runner 形态逐步对应）。
> 前置：本地 pg 可达；专用等价库（勿污染既有测试库）。命令为 bash 形（Linux/macOS/Git Bash）；占位符 `<…>` 处填本地值，凭据不入本手册、不入日志。

```bash
# 0) 等价库（一次性；在本地 pg 上新建专用库）
#    psql -h <HOST> -p <PORT> -U <ADMIN_USER> -c "CREATE DATABASE constella_deploy_eq"

# 1) 重建部署树（仓库根执行；产物 server/.deploy-eq 已被根 .dockerignore 排除，不入构建上下文）
pnpm --filter ./server... deploy --prod server/.deploy-eq

# 2) 运行件树（容器 /opt/run-tools 同形；独立 package.json 防 npm 向上解析 workspace:* 崩溃）
mkdir -p server/.run-tools-eq
printf '{"name":"constella-run-tools","private":true}\n' > server/.run-tools-eq/package.json
( cd server/.run-tools-eq && npm install --no-audit --no-fund prisma@7.8.0 tsx@4.23.15 )

cd server/.deploy-eq   # 以下 cwd=部署树（=容器 WORKDIR /app 同形）
TOOLS="$PWD/../.run-tools-eq/node_modules/.bin"

# 3) entrypoint 同形：树内迁移（PATH 直调 prisma——容器内经 /opt/run-tools/.bin 前缀，同机制）
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:<PORT>/constella_deploy_eq" APP_ENV=prod \
  PATH="$TOOLS:$PATH" prisma migrate deploy
# 期望：3 migrations found → 全部应用（或已应用态 No pending）

# 4) CMD 同形启动（后台）＋断言（loader 绝对路径=file URL 形；Windows Git Bash 下注意 $PWD 需转 file:///C:/… 形）
NODE_ENV=production APP_ENV=prod PORT=18053 \
  DATABASE_URL="postgresql://<同上>" JWT_SECRET="<≥32字符临时值>" \
  ADMIN_EMAIL="admin-eq@example.com" ADMIN_PASSWORD="<≥8字符临时值>" STORAGE_DIR="storage-eq" \
  node --import "file://$PWD/../.run-tools-eq/node_modules/tsx/dist/loader.mjs" src/index.ts &
sleep 3
curl -s http://127.0.0.1:18053/healthz          # 期望 {"status":"ok"}（契约#3）
curl -s -X POST http://127.0.0.1:18053/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin-eq@example.com","password":"<同上临时值>"}'   # 期望 200 含 accessToken（AdminSeed 首建证明；二次启动日志 result=skipped 同 userId=幂等证明）

# 5) 清理（必做：树内 test 文件会被 vitest 收集造成假失败；进程先杀后删树）
kill %1
cd ../.. && rm -rf server/.deploy-eq server/.run-tools-eq
```

> 与镜像形态的两点已知差（Docker 机补测项缘由）：本地 run-tools 安装于宿主平台（win-x64 engines/esbuild 二进制），镜像内为 linux-musl——故「离线 migrate deploy」「esbuild musl 形态」须在 Docker 机实测（见「镜像形态」节验证项②③）。
