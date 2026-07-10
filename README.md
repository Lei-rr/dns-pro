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

## 环境要求

- Node.js >= 20
- npm >= 10
- 生产环境建议使用 HTTPS

## 快速开始

```bash
git clone -b fast https://github.com/lei-rr/dns-pro.git
cd dns-pro
npm install
npm run build
HOST=0.0.0.0 PORT=2022 SESSION_SECRET="replace-with-a-long-random-secret" NODE_ENV=production npm start
```

访问服务后使用默认账号登录：

```text
用户名：admin
密码：admin
```

生产环境部署后请立即修改默认登录信息，并设置强 `SESSION_SECRET`。

## 开发调试

启动后端开发服务：

```bash
npm run dev:server
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

使用 Docker Compose：

```bash
docker compose up -d --build
```

`compose.yaml` 默认映射端口：

```text
2022:2022
```

运行数据默认挂载到：

```text
./data:/app/data
```

生产环境请修改 `compose.yaml` 中的 `SESSION_SECRET`，不要使用默认占位值。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 后端监听地址 |
| `PORT` | `2022` | 后端监听端口 |
| `SESSION_SECRET` | 开发兜底值 | Cookie Session 签名密钥，生产环境必须设置强随机值 |
| `NODE_ENV` | 未设置 | 设置为 `production` 后启用安全 Cookie 配置 |
| `LOG_LEVEL` | `info` | Fastify 日志等级 |
| `DATA_DIR` | `./data` | 运行数据目录 |

## 运行数据

项目运行数据保存在 `data/` 目录中，包括登录配置、Provider 凭据、SaaS 偏好和会话文件。

`data/` 已被 Git 忽略，不会提交到仓库。

缺少运行 JSON 文件时，程序会使用内置默认值。Provider 配置和 SaaS 偏好会在后台保存时自动创建对应文件。

默认登录配置为：

```json
{
  "auth": {
    "username": "admin",
    "password": "admin"
  }
}
```

如需在首次启动前修改登录信息，可以手动创建 `data/config.json`。

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

## Provider 关系

```text
edgeone     -> dnspod       # 复用腾讯云凭据
saas        -> cloudflare   # Cloudflare for SaaS
saas        -> dnspod       # 可选 DNS 同步目标
cloudflared -> cloudflare   # Tunnel 和路由 CNAME 管理
```

## 目录结构

```text
dns-pro/
├── src/                       # Fastify 后端源码
│   ├── app.ts                 # 应用组装和路由注册
│   ├── server.ts              # 服务启动入口
│   ├── config/                # Provider 定义
│   ├── controllers/           # HTTP 控制器
│   ├── gateways/              # 外部 API 网关
│   ├── middleware/            # Fastify hooks
│   ├── repositories/          # JSON 持久化边界
│   ├── routes/                # 路由插件
│   ├── schemas/               # Zod 校验 schema
│   ├── services/              # 业务服务和工作流
│   ├── support/               # 基础设施与通用工具
│   └── types/                 # TypeScript 类型
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
- 生产环境必须设置强 `SESSION_SECRET`
- 首次部署后立即修改默认 `admin/admin` 登录信息
- Cloudflare 和腾讯云密钥建议按最小权限授权
- 生产环境建议通过 HTTPS 访问
- 建议定期备份 `data/` 目录

## 分支说明

- `fast`：Node.js / Fastify / Vue 版本
- `main`：原 PHP 版本，未在本次发布中修改

## 许可证

MIT
