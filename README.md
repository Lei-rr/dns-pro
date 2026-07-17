# dns-pro

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GHCR](https://img.shields.io/badge/GHCR-lei--rr%2Fdns--pro-blue?logo=github)](https://ghcr.io/lei-rr/dns-pro)
[![GitHub](https://img.shields.io/badge/GitHub-lei--rr%2Fdns--pro-181717?logo=github)](https://github.com/lei-rr/dns-pro)

轻量 **DNS / 隧道管理面板**，面向个人与小团队。

一站管理：

- DNSPod
- Cloudflare DNS
- Cloudflare for SaaS
- Cloudflare Tunnel
- 腾讯云 EdgeOne

| 层 | 技术 |
|---|---|
| 后端 | Fastify 5 + TypeScript |
| 前端 | Vue 3 + Vite + Ant Design Vue |
| 存储 | 本地 JSON，无数据库 |

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [开发](#开发)
- [配置](#配置)
- [Provider 配置](#provider-配置)
- [架构说明](#架构说明)
- [目录结构](#目录结构)
- [数据与任务](#数据与任务)
- [安全建议](#安全建议)
- [贡献](#贡献)
- [分支说明](#分支说明)
- [许可证](#许可证)

## 功能特性

- DNSPod 域名 / 解析记录管理
- Cloudflare 域名 / 解析记录管理
- Cloudflare for SaaS 自定义主机名管理
- Cloudflare Fallback Origin 管理
- SaaS 偏好 CNAME / 自动优选切换（后台任务）
- Cloudflare Tunnel：创建、令牌、Public Hostname 路由
- 腾讯云 EdgeOne 站点与加速域名管理
- SaaS / EdgeOne / Tunnel 相关 DNS 同步与清理
- 批量任务落盘（`data/jobs/`），重启可恢复
- 单用户登录（AES-GCM session cookie）
- Docker / 本地 Node 双模式运行

## 快速开始

### 环境要求

- Node.js `>= 20`
- npm `>= 10`
- 可选：Docker / Docker Compose

### 安装运行

```bash
git clone -b fast https://github.com/lei-rr/dns-pro.git
cd dns-pro
npm install
npm run build
npm start
```

浏览器访问：

```text
http://127.0.0.1:2022
```

默认登录：

```text
用户名：admin
密码：admin
```

> 首次部署后请立即修改默认账号密码，并更换 `sessionSecret`。

## Docker 部署

GitHub Actions 在推送 `fast` 后自动构建并推送到 GHCR：

```text
ghcr.io/lei-rr/dns-pro:latest
ghcr.io/lei-rr/dns-pro:fast
```

### Compose（推荐）

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f dns-pro
```

默认端口与数据目录：

```text
2022:2022
./data:/app/data
```

### 直接运行镜像

```bash
docker pull ghcr.io/lei-rr/dns-pro:latest

docker run -d \
  --name dns-pro \
  --restart unless-stopped \
  -p 2022:2022 \
  -v "$PWD/data:/app/data" \
  ghcr.io/lei-rr/dns-pro:latest
```

访问：

```text
http://服务器IP:2022
```

本地构建镜像：

```bash
docker build -t dns-pro:local .
```

## 开发

本地开发端口与 Docker 生产端口分开，避免冲突：

| 服务 | 地址 |
|---|---|
| Docker / 生产 | `http://127.0.0.1:2022` |
| 本地后端开发 | `http://127.0.0.1:3022` |
| 本地前端 Vite | `http://127.0.0.1:5173` |

### 启动后端

```bash
npm run dev
# 或
npm run dev:server
```

需要请求日志：

```bash
npm run dev:server:debug
```

### 启动前端

```bash
npm run dev:web
```

Vite 已代理 `/api` 到 `http://127.0.0.1:3022`。

### 常用命令

```bash
npm run lint
npm run typecheck
npm run typecheck:web
npm run build
npm run verify
```

`verify` = lint + typecheck（含前端）+ 全量 build，适合发版前自检。

## 配置

项目默认**不依赖环境变量**，核心配置在 `src/config/app.ts`：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` | `0.0.0.0` | 监听地址 |
| `port` | `2022` | 生产默认端口 |
| `dataDir` | `./data` | 运行数据目录 |
| `logLevel` | `false` | 默认关闭访问日志 |
| `sessionSecret` | `dns-pro-secure-session` | session 密钥（生产务必改） |
| `sessionMaxAgeSeconds` | `604800` | session 有效期（7 天） |
| `httpTimeoutMs` | `30000` | 外部 API 超时 |

本地开发可指定端口：

```bash
tsx watch src/server.ts --port 3022
```

生产环境请务必：

1. 修改默认登录密码（`data/config.json`）
2. 替换默认 `sessionSecret`

## Provider 配置

登录后台后在页面中配置 Provider，数据写入 `data/providers.json`。

### DNSPod

使用腾讯云 `SecretId` / `SecretKey`，至少需要：

- `DescribeDomainList` / `CreateDomain` / `DeleteDomain`
- `DescribeRecordList` / `CreateRecord` / `ModifyRecord` / `DeleteRecord`

### Cloudflare

使用 Cloudflare API Token，按需最小化授权：

| 功能 | 权限 | 范围 |
|---|---|---|
| 域名列表 | Zone / Zone / Read | 目标 Zone |
| DNS 记录 | Zone / DNS / Edit | 目标 Zone |
| Cloudflare for SaaS | Zone / SSL and Certificates / Edit | 目标 Zone |
| Cloudflare Tunnel | Account / Cloudflare Tunnel / Edit | 目标 Account |

创建 Zone、Tunnel 相关操作需要配置 `account_id`。

### EdgeOne

EdgeOne 复用关联 DNSPod Provider 凭据。常用权限：

- `DescribeZones`
- `DescribeAccelerationDomains`
- `CreateAccelerationDomain` / `ModifyAccelerationDomain`
- `ModifyAccelerationDomainStatuses` / `DeleteAccelerationDomains`
- `ModifyHostsCertificate`

### Provider 依赖关系

```text
edgeone     -> dnspod
saas        -> cloudflare
saas        -> dnspod / cloudflare   # 可选 DNS 同步目标
cloudflared -> cloudflare
```

删除 Provider 前会检查是否仍被其他模块引用。

## 架构说明

> 权威说明见 [docs/FOUNDATION.md](docs/FOUNDATION.md)。

### 两个词，不要混

| 词 | 含义 | 目录 |
|---|---|---|
| **插件 Plugin** | Fastify HTTP 能力 | 仅 `src/plugins/*` + `@fastify/*` |
| **模块 Module** | 业务功能（路由 + 服务） | `src/modules/*` |

### 请求链路

```text
HTTP /api/v1
  → public: health + session
  → authRequired envelope
  → controller
  → request.server.ctx.<service>
  → gateway / repository
  → 外部 API 或本地 JSON
```

批量任务：`JobService`（构造 batch service 时 `registerRunner`）  
副作用：`eventBus`（审计日志 + 缓存失效）

### 加功能 3 步

1. 新增 `src/modules/<name>/`
2. 在 `app-context.ts` 中 `new` 服务并放入 `ctx`（仅控制器要用的）
3. 在 `compose/http-modules.ts` 加一行 `register`

## 目录结构

```text
dns-pro/
├── src/
│   ├── app.ts                 # Fastify 组装
│   ├── server.ts              # 进程入口 + ensureDataDirs
│   ├── app-context.ts         # 接线：服务 → ctx
│   ├── compose/http-modules.ts
│   ├── plugins/               # 官方 Fastify 插件（security/static/…）
│   ├── platform/              # job / events / ensure-data-dirs
│   ├── lib/                   # http / storage / cache / auth / providers
│   ├── modules/               # 业务模块
│   │   ├── auth provider system
│   │   ├── dnspod cloudflare saas edgeone cloudflared
│   │   ├── sync               # 内部 DNS 同步（无独立 HTTP）
│   │   └── dns-batch          # 批量删除（挂在 dnspod/cf 路由）
│   ├── config/app.ts
│   └── types/fastify.d.ts
├── web/                       # Vue 3 前端
├── docs/
│   ├── FOUNDATION.md          # 底座权威说明
│   └── ARCHITECTURE.md
├── docker/                    # 容器入口脚本
├── data/                      # 运行数据（Git 忽略）
├── Dockerfile
├── compose.yaml
├── LICENSE
└── package.json
```

生产构建后，Fastify 托管 `web/dist/` 静态资源。

## 数据与任务

| 路径 | 说明 |
|---|---|
| `data/config.json` | 登录账号 |
| `data/providers.json` | Provider 配置（含密钥） |
| `data/saas/preferences.json` | SaaS 主机偏好 |
| `data/saas/preferred-domains.json` | 优选域名列表 |
| `data/jobs/jobs.json` | 后台任务状态 |
| `data/sessions/` | 会话相关（若启用） |

启动时 `ensureDataDirs` 仅创建 `saas/`、`jobs/` 等目录，**无** `meta.json` / schema 版本迁移。

`data/` 已加入 `.gitignore`，不会提交到仓库。  
JSON 写入通过文件锁保护，避免并发写坏。

可重建的查询数据（DNS 记录列表等）走**内存缓存**；账号 / Provider / 偏好 / 任务等**本地主数据**走 JsonStore 文件。

## 安全建议

- 不要提交 `data/` 或真实密钥
- 首次部署后立即修改默认 `admin/admin`
- 生产环境替换默认 `sessionSecret`
- Cloudflare / 腾讯云权限按最小原则授权
- 建议通过 HTTPS 访问
- 自行备份 `data/`（项目不提供内置备份 API）

公开接口：

- `GET /api/v1/health`
- `POST|GET|DELETE /api/v1/session`

其余业务 API 与 `GET /api/v1/audit` 需登录。

## 贡献

欢迎 Issue / PR，尤其是：

- Provider 兼容与权限说明
- 部署体验 / Docker
- 界面与交互改进

建议流程：

1. Fork，基于 `fast` 开分支
2. 本地 `npm run verify` 通过
3. 小步 PR，说明动机与验证方式

更细的底座约定见 [docs/FOUNDATION.md](docs/FOUNDATION.md)。

## 分支说明

| 分支 | 说明 |
|---|---|
| `fast` | 当前 Node.js / Fastify / Vue 版本（**推荐**） |
| `main` | 历史 PHP 版本 |

## 许可证

[MIT](LICENSE) © lei-rr

---

如果这个项目对你有用，欢迎 Star。  
Issue / PR 也欢迎。
