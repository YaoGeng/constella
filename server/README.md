# Hono + Prisma PostgreSQL 生产模板

基于 Hono + Prisma v7 的 TypeScript REST API 生产骨架，内置 JWT 认证体系。

## 特性

- **认证体系**：注册 / 登录 / Token 刷新 / JWT 中间件，bcrypt 哈希 + Refresh Token 轮换
- **严格类型**：TypeScript strict 模式，Zod v4 校验请求体与环境变量
- **代码规范**：ESLint + Prettier，`import type` 强制使用
- **结构化日志**：JSON 行输出，零外部依赖
- **Prisma v7**：`prisma.config.ts` + `@prisma/adapter-pg` 适配器直连 PostgreSQL
- **进程安全**：SIGTERM/SIGINT 优雅关闭，uncaughtException / unhandledRejection 捕获

## 快速开始

```bash
npm install

# 创建本地环境变量文件
cp .env.example .env
# 编辑 .env 填入你的 DATABASE_URL 和 JWT_SECRET

npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm run build
```

## API 端点

所有认证端点挂载在 `/auth` 路径下：

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/auth/register` | 否 | 注册新用户（email + password ≥ 8 位）→ 返回 `{ accessToken, refreshToken }` |
| `POST` | `/auth/login` | 否 | 登录 → 返回 `{ accessToken, refreshToken }` |
| `POST` | `/auth/refresh` | 否 | 刷新令牌（传入 refreshToken）→ 返回新令牌对（旧令牌立即失效） |
| `GET` | `/user/profile` | Bearer JWT | 获取当前用户信息 `{ id, email, createdAt }` |

### 请求示例

**注册**

```bash
curl -X POST http://localhost:4399/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# 响应 201
# {
#   "accessToken": "eyJ...",
#   "refreshToken": "xxx-xxx-xxx"
# }
```

**获取用户信息**

```bash
curl http://localhost:4399/user/profile \
  -H "Authorization: Bearer <accessToken>"

# 响应 200
# { "id": "uuid", "email": "user@example.com", "createdAt": "..." }
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地启动（watch 模式） |
| `npm run dev:test` | 测试环境启动（`APP_ENV=test`） |
| `npm run dev:prod` | 生产环境启动（`APP_ENV=prod`） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 静态检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |
| `npm run format:check` | 格式检查 |
| `npm run build` | 构建输出到 `dist/` |
| `npm run start` | 运行构建产物 |
| `npm run start:test` | 测试环境运行构建产物（`APP_ENV=test`） |
| `npm run start:prod` | 生产环境运行构建产物（`APP_ENV=prod`） |
| `npm run prisma:migrate` | 执行数据库迁移 |
| `npm run prisma:migrate:test` | 测试环境迁移 |
| `npm run prisma:migrate:prod` | 生产环境部署迁移 |
| `npm run prisma:studio` | 打开 Prisma Studio |

## 目录结构

```
├── prisma/
│   ├── schema.prisma        # datasource + generator（主文件）
│   ├── models/              # 按业务拆分的模型文件（递归扫描）
│   │   └── auth/
│   │       ├── credential.prisma  # model User
│   │       └── session.prisma     # model RefreshToken
│   └── migrations/
├── src/
│   ├── index.ts              # 应用入口：启动服务、注册进程处理
│   ├── routes/               # 路由注册中心 + 业务路由
│   │   ├── index.ts          # 路由注册中心（聚合子路由）
│   │   ├── auth/
│   │   │   ├── auth.routes.ts    # /auth/register, /auth/login, /auth/refresh
│   │   │   ├── auth.schemas.ts   # Zod 请求体验证
│   │   │   └── auth.middleware.ts # JWT Bearer 认证中间件
│   │   └── user/
│   │       └── user.routes.ts    # /user/profile（获取当前用户信息）
│   ├── utils/                # 通用工具
│   │   ├── env.ts                # 环境变量加载与校验（Zod）
│   │   ├── prisma.ts             # Prisma 客户端单例（pg adapter）
│   │   ├── logger.ts             # 结构化 JSON 日志
│   │   └── process-handlers.ts   # 进程信号与异常处理
├── generated/                # Prisma 客户端输出（`prisma generate` 生成）
├── prisma.config.ts          # Prisma CLI 环境变量配置
├── .env.example              # 环境变量模板
├── tsconfig.json
└── package.json
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `APP_ENV` | 运行环境（`dev` / `test` / `prod`），自动映射 `NODE_ENV` | `dev` |
| `NODE_ENV` | Node.js 模式，由 `APP_ENV` 自动推导 | `development` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Access Token 签名密钥（≥ 32 字符） | `your-jwt-secret-at-least-32-chars` |
| `JWT_REFRESH_SECRET` | Refresh Token 签名密钥（≥ 32 字符，当前未使用 JWT 格式） | `your-refresh-secret-...` |
| `PORT` | HTTP 服务监听端口 | `4399` |

## 环境管理

应用根据 `APP_ENV` 加载对应的 `.env.{APP_ENV}` 文件，再用 `.env` 补全缺失项。
`dotenv` 设置了 `override: false`，即平台注入的环境变量始终优先于文件值。

加载优先级：**平台 / cross-env > `.env.{APP_ENV}` > `.env`**

### 本地开发

```bash
cp .env.example .env          # 开发数据库
cp .env.example .env.test     # 修改 DATABASE_URL 指向测试数据库
```

- `npm run dev` — 读 `.env.dev`（若无则 `.env`）
- `npm run dev:test` — 读 `.env.test`

### 部署（测试 / 生产）

在平台 Secret 中注入 `APP_ENV` 和 `DATABASE_URL`，无需任何文件：

| 环境 | `APP_ENV` | `NODE_ENV`    |
| ---- | --------- | ------------- |
| 开发 | `dev`     | `development` |
| 测试 | `test`    | `test`        |
| 生产 | `prod`    | `production`  |

所有 `.env` 和 `.env.*` 文件均被 `.gitignore` 忽略，避免密钥进入 Git。

## 安全设计

- **密码**：bcrypt 加盐哈希（成本因子 10），永不明文存储
- **Refresh Token**：SHA256 哈希后存储，原始令牌仅返回客户端，服务端不可逆
- **Token 轮换**：每次 refresh 后旧 Refresh Token 立即删除，防止重放
- **防时序攻击**：登录时用户不存在仍执行 bcrypt compare，避免通过响应时间推断邮箱
- **JWT 中间件**：`Authorization: Bearer <token>` 自动验证，使用 HS256 对称签名
