# dns-pro

`dns-pro` 是一个面向个人或小团队使用的 DNS 与隧道管理面板。项目集成 DNSPod、Cloudflare、Cloudflare for SaaS、Cloudflare Tunnel 和腾讯云 EdgeOne，提供域名、解析记录、SaaS 自定义主机名、隧道路由和加速域名的一体化管理能力。

本分支为 Node.js 版本，后端基于 Fastify 和 TypeScript，前端基于 Vue 3 和 Vite。运行数据使用本地 JSON 文件保存，不依赖数据库。

## 功能特性

- DNSPod 域名与解析记录管理
- Cloudflare 域名与解析记录管理
- Cloudflare for SaaS 自定义主机名管理
- Cloudflare fallback origin 管理
- SaaS 偏好 CNAME 域名管理
- Cloudflare Tunnel 创建、令牌轮换、安装指引和 public hostname 路由管理
- 腾讯云 EdgeOne 站点与加速域名管理
- SaaS、EdgeOne、Cloudflared 相关 DNS 同步与清理流程
- 单用户登录认证
- Docker 部署支持

## 技术栈

| 类型 | 技术 |
|---|---|
| 后端 | Node.js 20+、Fastify、TypeScript、Zod |
| 前端 | Vue 3、Vite、TypeScript、Vue Router、Pinia、Ant Design Vue |
| 存储 | 本地 JSON 文件 |
| 外部接口 | Cloudflare REST API、腾讯云 API TC3 签名 |

## 后端架构

后端采用 Fastify 模块化架构，职责边界如下：

```text
server.ts (入口：配置、数据目录、缓存、监听)
  │
  ▼
app.ts (buildApp：插件 + 模块注册)
  │
  ├── plugins/     ──►  跨切面插件（security / static / error-handler）
  ├── lib/         ──►  共享库（http / storage / cache / auth / utils）
  ├── modules/     ──►  功能模块（Fastify 插件：routes + controller + service…）
  ├── config/      ──►  应用默认配置与 Provider 元数据
  ├── app-context  ──►  服务组装工厂（createAppContext）
  └── types/       ──►  Session 等类型扩展
```

### 一次请求的处理流程

以“查询 Cloudflare 域名列表”为例：

```text
GET /api/cloudflare/providers/:providerId/zones
        │
        ▼
protectedModules (authRequired 钩子校验登录状态)
        │
        ▼
modules/cloudflare (cloudflareModule → routes)
        │
        ▼
controllers/zone-controller.ts (提取 providerId / page / name 等参数)
        │
        ▼
services/zone-service.ts (业务逻辑：读取 Provider、调用网关、缓存结果)
        │
        ▼
gateways/gateway.ts (调用 Cloudflare REST API)
        │
        ▼
返回 success({ items, page, per_page, total })
```

### 数据持久化

所有运行时数据保存在 `data/` 目录下的 JSON 文件中，关键文件：

| 文件 | 说明 |
|---|---|
| `data/config.json` | 登录账号密码 |
| `data/providers.json` | Provider 配置（含密钥） |
| `data/saas-preferences.json` | SaaS 偏好域名 |
| `data/saas-hosts-*.json` | 各 Provider 的 SaaS 自定义主机名缓存 |
| `data/sessions/` | 安全 session 文件（由 `@fastify/secure-session` 管理） |
| `data/saas/` | SaaS/EdgeOne 同步过程中生成的 side effect 记录 |

`data/` 已被 Git 忽略，不会提交到仓库。首次启动时若文件缺失，程序会使用内置默认值；后台保存时自动创建对应文件。

JSON 写操作通过 `JsonStore.transaction()` 加文件锁，避免并发写入损坏。

### 缓存

使用内存缓存 `CacheService` 缓存外部 API 的读取结果，减少重复请求。缓存配置在 `src/config/app.ts` 中通过默认值控制，启动后由 `server.ts` 初始化。

### Provider 模型

Provider 是本项目最核心的抽象。每种 Provider 包含：

- **类型**：`dnspod`、`cloudflare`、`edgeone`、`saas`、`cloudflared`
- **字段**：由 `src/config/providers.ts` 定义，例如 DNSPod 需要 `secret_id` / `secret_key`
- **依赖关系**：EdgeOne 复用 DNSPod 凭据；SaaS / Cloudflared 复用 Cloudflare 凭据

```text
edgeone     -> dnspod       # 复用腾讯云凭据
saas        -> cloudflare   # Cloudflare for SaaS
saas        -> dnspod       # 可选 DNS 同步目标
saas        -> cloudflare   # 可选 Cloudflare DNS 同步目标
cloudflared -> cloudflare   # Tunnel 和路由 CNAME 管理
```

删除 Provider 前会检查是否仍被其他 Provider 或 SaaS 同步引用。

## 配置说明

本项目**不依赖任何环境变量**，所有运行参数使用 `src/config/app.ts` 中的默认值：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` | `0.0.0.0` | 监听地址 |
| `port` | `2022` | 监听端口 |
| `dataDir` | `./data` | 运行数据目录 |
| `logLevel` | `false` | 默认关闭日志 |
| `sessionSecret` | `dns-pro-secure-session` | session 签名密钥 |
| `sessionMaxAgeSeconds` | `604800` | session 有效期（7 天） |
| `rateLimitLoginMax` | `10` | 登录接口限流 |
| `httpTimeoutMs` | `30000` | 外部 API 超时 |

生产环境请通过修改 `src/config/app.ts` 中的默认值来调整配置，尤其是 `sessionSecret`。

如需临时开启后端请求日志，可启动时传入 `--log-level`：

```bash
npm run dev:server:debug
# 等价于 tsx watch src/server.ts --log-level info | pino-pretty
```

## 快速开始

```bash
git clone -b fast https://github.com/lei-rr/dns-pro.git
cd dns-pro
npm install
npm run build
npm start
```

访问服务后使用默认账号登录：

```text
用户名：admin
密码：admin
```

生产环境部署后请立即修改默认登录信息。

## 开发调试

启动后端开发服务：

```bash
npm run dev:server
```

需要查看 Fastify 请求日志时使用调试模式：

```bash
npm run dev:server:debug
```

启动前端开发服务：

```bash
npm run dev:web
```

默认端口：

| 服务 | 地址 |
|---|---|
| 后端 | `http://127.0.0.1:2022` |
| 前端开发服务 | `http://0.0.0.0:5173` |

常用命令：

```bash
npm run lint
npm run typecheck
npm run typecheck:web
npm run build
npm run verify
```

## Docker 部署

GitHub Actions 会自动构建并推送公开镜像到 GHCR：

```text
ghcr.io/lei-rr/dns-pro:latest
```

默认分支 `fast` 也会保留同名标签：

```text
ghcr.io/lei-rr/dns-pro:fast
```

使用 Docker Compose 启动：

```bash
docker compose pull
docker compose up -d
```

查看运行状态和日志：

```bash
docker compose ps
docker compose logs -f dns-pro
```

停止或重新部署：

```bash
docker compose down
docker compose pull
docker compose up -d
```

`compose.yaml` 默认映射端口：

```text
2022:2022
```

运行数据默认挂载到：

```text
./data:/app/data
```

不使用 Compose 时，也可以直接拉取公开镜像运行：

```bash
docker pull ghcr.io/lei-rr/dns-pro:latest
docker run -d \
  --name dns-pro \
  --restart unless-stopped \
  -p 2022:2022 \
  -v "$PWD/data:/app/data" \
  ghcr.io/lei-rr/dns-pro:latest
```

查看日志、停止和删除容器：

```bash
docker logs -f dns-pro
docker stop dns-pro
docker rm dns-pro
```

服务启动后访问：

```text
http://服务器IP:2022
```

如需本地开发或调试镜像，再手动构建：

```bash
docker build -t dns-pro:local .
```

## Provider 配置

Provider 凭据在登录后通过后台页面配置，并保存到 `data/providers.json`。

### DNSPod

使用腾讯云 `SecretId` 和 `SecretKey`，需要具备 DNSPod 相关权限，例如：

- `DescribeDomainList`
- `CreateDomain`
- `DeleteDomain`
- `DescribeRecordList`
- `CreateRecord`
- `ModifyRecord`
- `DeleteRecord`

### Cloudflare

使用 Cloudflare API Token。按实际使用模块授予最小权限：

| 功能 | 权限 | 范围 |
|---|---|---|
| 域名列表 | Zone / Zone / Read | 目标 Zone |
| DNS 记录 | Zone / DNS / Edit | 目标 Zone |
| Cloudflare for SaaS | Zone / SSL and Certificates / Edit | 目标 Zone |
| Cloudflare Tunnel | Account / Cloudflare Tunnel / Edit | 目标 Account |

创建 Zone 和 Cloudflare Tunnel 相关操作需要配置 `account_id`。

### EdgeOne

EdgeOne 复用关联的 DNSPod Provider 凭据。腾讯云密钥需要具备 EdgeOne 权限；如果启用 DNS 同步，还需要 DNSPod 记录读写权限。

常用 EdgeOne 权限包括：

- `DescribeZones`
- `DescribeAccelerationDomains`
- `CreateAccelerationDomain`
- `ModifyAccelerationDomain`
- `ModifyAccelerationDomainStatuses`
- `DeleteAccelerationDomains`
- `ModifyHostsCertificate`

## 目录结构

```text
dns-pro/
├── src/                       # Fastify 后端源码
│   ├── app.ts                 # Fastify 应用组装（插件、模块）
│   ├── app-context.ts         # 服务上下文工厂
│   ├── server.ts              # 服务启动入口
│   ├── config/                # 应用默认配置与 Provider 元数据
│   ├── plugins/               # 跨切面插件（security / static / error-handler）
│   ├── lib/                   # 共享库（http / storage / cache / auth / utils）
│   ├── modules/               # 功能模块（每个模块自相似布局）
│   │   ├── auth/
│   │   │   ├── hooks/         # auth-required 等钩子
│   │   │   ├── controller.ts
│   │   │   ├── service.ts
│   │   │   ├── routes.ts
│   │   │   ├── schemas.ts
│   │   │   └── index.ts
│   │   ├── system/
│   │   ├── provider/          # 扁平小模块：controller / service / repository / schemas…
│   │   ├── cloudflare/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── gateways/      # gateway.ts
│   │   │   ├── schemas/       # request.ts + response.ts
│   │   │   ├── routes.ts
│   │   │   └── index.ts
│   │   ├── dnspod/            # 同 cloudflare 布局
│   │   ├── edgeone/           # 同 cloudflare 布局
│   │   ├── cloudflared/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── schemas/       # request.ts
│   │   │   ├── routes.ts
│   │   │   └── index.ts
│   │   └── saas/
│   │       ├── controllers/
│   │       ├── services/      # 含 dns-pod-sync.ts 等
│   │       ├── repositories/
│   │       ├── gateways/      # custom-hostname-gateway.ts
│   │       ├── schemas/       # request.ts
│   │       ├── sync-drivers/
│   │       ├── utils/
│   │       ├── routes.ts
│   │       └── index.ts
│   └── types/                 # Session 等类型扩展
├── web/                       # Vue 3 + Vite 前端源码
├── docker/                    # Docker 启动脚本
├── data/                      # 运行数据目录，Git 忽略
├── Dockerfile
├── compose.yaml
└── package.json
```

前端源码位于 `web/`。生产构建后，Fastify 只负责托管 Vite 生成的 `web/dist/` 静态资源。

## 安全建议

- 不要提交 `data/` 目录或真实 Provider 凭据
- 首次部署后立即修改默认 `admin/admin` 登录信息
- 生产环境请替换默认 `sessionSecret`
- Cloudflare 和腾讯云密钥建议按最小权限授权
- 生产环境建议通过 HTTPS 访问
- 建议定期备份 `data/` 目录

## 分支说明

- `fast`：Node.js / Fastify / Vue 版本
- `main`：原 PHP 版本，未在本次发布中修改

## 许可证

MIT
