# dns-pro

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GHCR](https://img.shields.io/badge/GHCR-lei--rr%2Fdns--pro-blue?logo=github)](https://ghcr.io/lei-rr/dns-pro)

轻量 DNS / 隧道管理面板，面向个人与小团队。

一站管理：

- DNSPod
- Cloudflare DNS
- Cloudflare for SaaS
- Cloudflare Tunnel
- 腾讯云 EdgeOne

后端：Fastify + TypeScript  
前端：Vue 3 + Vite + Ant Design Vue  
存储：本地 JSON，无数据库

---

## 目录

- [功能特性](#功能特性)
- [截图](#截图)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [开发](#开发)
- [配置](#配置)
- [Provider 配置](#provider-配置)
- [架构说明](#架构说明)
- [目录结构](#目录结构)
- [安全建议](#安全建议)
- [分支说明](#分支说明)
- [许可证](#许可证)

## 功能特性

- DNSPod 域名 / 解析记录管理
- Cloudflare 域名 / 解析记录管理
- Cloudflare for SaaS 自定义主机名管理
- Cloudflare Fallback Origin 管理
- SaaS 偏好 CNAME 域名管理
- Cloudflare Tunnel：创建、令牌、安装指引、Public Hostname 路由
- 腾讯云 EdgeOne 站点与加速域名管理
- SaaS / EdgeOne / Tunnel 相关 DNS 同步与清理
- 单用户登录
- Docker / 本地 Node 双模式运行

## 截图

> 可选：把后台截图放到 `docs/images/` 后在这里引用。

```text
docs/images/dashboard.png
docs/images/records.png
docs/images/saas.png
```

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

> 首次部署后请立即修改默认账号密码。

## Docker 部署

GitHub Actions 会自动构建并推送到 GHCR：

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

本地调试镜像：

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

需要请求日志时：

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

## 配置

项目默认**不依赖环境变量**，核心配置在 `src/config/app.ts`：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` | `0.0.0.0` | 监听地址 |
| `port` | `2022` | 生产默认端口 |
| `dataDir` | `./data` | 运行数据目录 |
| `logLevel` | `false` | 默认关闭日志 |
| `sessionSecret` | `dns-pro-secure-session` | session 签名密钥 |
| `sessionMaxAgeSeconds` | `604800` | session 有效期（7 天） |
| `httpTimeoutMs` | `30000` | 外部 API 超时 |

本地开发可用：

```bash
tsx watch src/server.ts --port 3022
```

生产环境请务必修改：

1. 默认登录密码
2. `sessionSecret`

## Provider 配置

登录后台后在页面中配置 Provider，数据写入 `data/providers.json`。

### DNSPod

使用腾讯云 `SecretId` / `SecretKey`，至少需要：

- `DescribeDomainList`
- `CreateDomain`
- `DeleteDomain`
- `DescribeRecordList`
- `CreateRecord`
- `ModifyRecord`
- `DeleteRecord`

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
- `CreateAccelerationDomain`
- `ModifyAccelerationDomain`
- `ModifyAccelerationDomainStatuses`
- `DeleteAccelerationDomains`
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

### 技术栈

| 类型 | 技术 |
|---|---|
| 后端 | Node.js 20+、Fastify、TypeScript |
| 前端 | Vue 3、Vite、TypeScript、Vue Router、Pinia、Ant Design Vue |
| 存储 | 本地 JSON 文件 |
| 外部接口 | Cloudflare REST API、腾讯云 API TC3 签名 |

### 请求链路

```text
HTTP Request
  -> auth hook
  -> routes
  -> controller
  -> service
  -> gateway / repository
  -> external API or local JSON store
```

### 数据目录

| 路径 | 说明 |
|---|---|
| `data/config.json` | 登录账号 |
| `data/providers.json` | Provider 配置（含密钥） |
| `data/saas-preferences.json` | SaaS 偏好域名 |
| `data/saas-hosts-*.json` | SaaS 主机名缓存 |
| `data/saas/` | 同步 side-effect 记录 |

`data/` 已加入 `.gitignore`，不会提交到仓库。  
JSON 写入通过文件锁保护，避免并发写坏。

### 缓存

使用内存缓存减少上游 API 重复请求。缓存策略由 `src/config/app.ts` 控制。

## 目录结构

```text
dns-pro/
├── src/                       # Fastify 后端
│   ├── app.ts                 # 插件与模块注册
│   ├── app-context.ts         # 服务组装
│   ├── server.ts              # 启动入口
│   ├── config/                # 默认配置 / Provider 元数据
│   ├── plugins/               # security / static / error-handler
│   ├── lib/                   # http / storage / cache / auth / providers / utils
│   ├── modules/               # auth / provider / cloudflare / dnspod / edgeone / saas / cloudflared
│   └── types/
├── web/                       # Vue 3 前端
├── tests/                     # 轻量回归测试
├── docker/                    # 容器入口脚本
├── data/                      # 运行数据（Git 忽略）
├── Dockerfile
├── compose.yaml
└── package.json
```

生产构建后，Fastify 托管 `web/dist/` 静态资源。

## 安全建议

- 不要提交 `data/` 或真实密钥
- 首次部署后立即修改默认 `admin/admin`
- 生产环境替换默认 `sessionSecret`
- Cloudflare / 腾讯云权限按最小原则授权
- 建议通过 HTTPS 访问
- 定期备份 `data/`

## 分支说明

| 分支 | 说明 |
|---|---|
| `fast` | 当前 Node.js / Fastify / Vue 版本（推荐） |
| `main` | 历史 PHP 版本 |

## 许可证

[MIT](LICENSE)

---

如果你觉得这个项目有用，欢迎 Star。  
Issue / PR 也欢迎，尤其是 Provider 兼容、部署体验和界面改进。
