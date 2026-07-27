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
| 前端 | Vue 3 + Vite + Tailwind CSS + shadcn 风格组件 |
| 存储 | 本地 JSON，无数据库 |

---

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

## 开发

| 服务 | 地址 |
|---|---|
| Docker / 生产 | `http://127.0.0.1:2022` |
| 本地后端开发 | `http://127.0.0.1:3022` |
| 本地前端 Vite | `http://127.0.0.1:5173` |

### 启动后端

```bash
npm run dev:server
```

### 启动前端

```bash
npm run dev:web
```

## 架构

```
src/
  app.ts              # Fastify 组装
  server.ts           # 进程入口
  app-context.ts      # 接线：new 服务 → ctx（唯一组装点）
  compose/
    http-modules.ts   # 路由表
  plugins/            # Fastify 插件（安全、静态、session、错误处理）
  platform/           # job / events / ensure-data-dirs / batch-helpers
  config/app.ts
  lib/
    cache/            # 内存缓存 + tag 失效
    http/             # BaseGateway + ApiError + 第三方签名
    storage/          # JsonStore
    auth/             # AES-GCM session
    providers/        # 供应商响应 schema
  modules/
    auth provider system
    dnspod cloudflare saas edgeone cloudflared
    sync              # 内部 DNS 同步（无 HTTP、不进 ctx）
    dns-batch         # DNS 批量（挂 dnspod/cloudflare 路由）
  types/fastify.d.ts
```

### 接线原则

- 无 DI 容器，无服务注册表
- 所有 service 构造器无默认参数，`app-context.ts` 是唯一组装点
- Gateway 实例通过 `CloudflareGateway.forToken()` / `DnsPodGateway.forCredentials()` 等工厂获取
- 缓存失效通过 `eventBus.emit` + `cache_tags` 统一路径
- 批量任务循环、互斥、计数、finish 通过 `platform/job/batch-helpers.ts`

## 配置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | HTTP 监听端口 | `2022` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `DATA_DIR` | 数据持久化目录 | `./data` |
| `SESSION_SECRET` | 会话加密密钥 | `dns-pro-secure-session` |
| `TRUST_PROXY` | 是否信任反向代理 IP | `false` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `HTTP_TIMEOUT_MS` | 上游 API 超时 | `30000` |
| `CACHE_MAX_ENTRIES` | 内存缓存最大条目 | `1000` |
| `CACHE_SWEEP_INTERVAL_MS` | 缓存清理间隔 | `600000` |

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev:server` | 后端开发（3022） |
| `npm run dev:web` | 前端开发（5173） |
| `npm run build` | 构建前后端 |
| `npm start` | 生产启动 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run lint` | ESLint |
| `npm run verify` | lint + typecheck + build |

## 安全建议

- 生产环境务必设置强 `SESSION_SECRET`
- 启用 HTTPS 反向代理
- 修改默认 `admin` 密码

## 贡献

Issue / PR 欢迎。建议：

1. `npm run verify` 通过
2. 保持模块边界：业务进 `modules/`，HTTP 壳进 `plugins/`，接线只在 `app-context.ts`
3. 不引入 Nest / DI 容器 / 额外文档目录

## 许可证

[MIT](LICENSE) © lei-rr

---

如果这个项目对你有用，欢迎 Star。