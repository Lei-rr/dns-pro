# dns-pro

[![Verify](https://github.com/lei-rr/dns-pro/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/lei-rr/dns-pro/actions/workflows/verify.yml)
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

| 层   | 技术                                              |
| ---- | ------------------------------------------------- |
| 后端 | Fastify 5 + TypeScript                            |
| 前端 | Vue 3 + Vite + Tailwind CSS + shadcn-vue 风格组件 |
| 存储 | 本地 JSON，无数据库                               |

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

## 最近更新

### 2026-09

- **发布 v1.1.0**：全量代码审计与重构。消除三处重复实现的厂商响应守卫与分页护栏、统一 FQDN 归一化；清理死代码与冗余依赖；修复空响应体崩溃、凭证泄露面、`NaN` 污染等缺陷；请求超时按调用场景分级；开启 `noUncheckedIndexedAccess`。
- **引入版本机制**：根 `package.json` 为唯一版本源，`npm run version:sync` 同步，`npm run version:check` 接入 `npm run verify` 门禁；前端经 Vite `define` 注入 `__APP_VERSION__`，构建产物内的版本号不再硬编码。
- 新增 `CHANGELOG.md` 记录版本变更。

### 2026-08

- 优化 DNS 批量任务恢复：打开域名时静默检查是否存在未完成任务，只有确认发现真实 Job 后才显示进度，不再把恢复探测误显示成“DNS 批量任务”转圈。
- 保留批量任务的持久化、重启恢复、进度轮询和失败重试能力。
- 修复 Cloudflare Tunnel 安装面板在手机窄屏下被长 Token、命令和 Tabs 撑破页面宽度的问题。
- 安装命令支持窄屏自动断行，系统与架构 Tabs 在移动端可在容器内横向滚动。
- 补充移动端宽度与 Job 进度恢复的隔离 Probe，并纳入项目验证流程。

## 快速开始

### 环境要求

- Node.js `>= 20.19.0`
- npm `>= 10`
- 可选：Docker / Docker Compose

### 安装运行

```bash
git clone -b main https://github.com/lei-rr/dns-pro.git
cd dns-pro
npm ci
npm run build
npm start
```

浏览器访问：

```text
http://127.0.0.1:2022
```

首次运行且 `data/config.json` 不存在时，系统会自动生成默认登录：

```text
用户名：admin
密码：admin
```

> 首次启动会自动生成随机初始密码并打印在日志中（只落盘 scrypt 哈希，不保存明文）。登录后可在「修改密码」中更换。Session 密钥优先读取 `SESSION_SECRET`；未设置时会在 `data/session-secret` 自动生成并持久化，升级时请保留该文件。

> `data/` 是运行时数据目录，不应提交到 Git，也不应在升级时用代码目录覆盖。生产部署只同步源码和镜像，保留原有 `data/`。

## Docker 部署

GitHub Actions 在推送 `main` 后自动构建并推送到 GHCR：

```text
ghcr.io/lei-rr/dns-pro:latest
ghcr.io/lei-rr/dns-pro:main
```

### 直接运行镜像（推荐）

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

| 服务          | 地址                    |
| ------------- | ----------------------- |
| Docker / 生产 | `http://127.0.0.1:2022` |
| 本地后端开发  | `http://127.0.0.1:3022` |
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

```text
server/
  src/
    app.ts / server.ts       # Fastify 应用与进程入口
    bootstrap/               # 唯一组装根：配置、Platform、Modules、Workflows、Routes
    plugins/                 # Fastify 插件：上下文、安全、静态资源、错误处理
    modules/                 # 单一业务能力与 Provider client；不反向依赖 Workflows
    workflows/               # 跨模块用例、DNS 同步与批量任务编排
    platform/
      cache/                # 仅 memory-cache.ts + provider-cache.ts；永久进程内缓存
      jobs/                 # 持久 Job、单进程 inflight、恢复/重试与终态收敛
      storage/              # JsonStore、进程内串行队列与原子文件替换
    shared/                  # auth、HTTP 契约、Provider 基础设施与通用工具
    types/fastify.d.ts

web/src/
  app/                      # 路由与应用壳
  pages/                    # 页面编排
  features/                 # DNS / SaaS / EdgeOne / Tunnel 业务能力
  shared/                   # shadcn-vue UI、HTTP、列表/分页/异步所有权工具
```

### 前端组件说明

项目采用 **shadcn-vue 风格**：组件源码保存在项目的 `web/src/shared/ui/`，样式由 Tailwind CSS 控制，交互原语使用 Vue 生态的 `reka-ui`。这不是两套重复的 UI 框架，而是“shadcn-vue 风格封装 + Reka UI 无样式交互基础”的组合。业务页面只依赖项目自己的 `shared/ui`，不直接依赖底层原语。

### API 与路由

- HTTP API 统一使用 `/api` 前缀，不使用 `/api/v1`。
- 公开系统接口只有 `GET /api/health`；业务接口需要登录。
- 前端使用原生 `fetch`，会话使用 HttpOnly AES-GCM cookie。
- `/api`、`/api/v1/*`、不存在的静态资源和当前 hashed asset 的状态与 MIME 类型属于发布验收契约。

### 终态原则

- 无 DI 容器、无服务注册表；所有实例只在 `bootstrap/` 构造并显式注入
- 依赖方向固定为 `bootstrap → workflows → modules → platform/shared`
- HTTP schema、handler、service 分离；API 统一挂在 `/api`，不保留旧字段 alias
- 供应商查询为进程内永久缓存（无 TTL、容量淘汰或 sweeper）；冷缺失回填，仅显式 `refresh=1` 绕过并覆盖，mutation 按 key/tag 精确失效
- JsonStore 是本地状态源；跨文件引用完整性使用锁内 fresh read
- Durable Job 在供应商调用前落盘 `running + operation_id`，重启后按持久状态恢复；终态不可回写
- 前端 list / row mutation / Job progress 都使用 generation owner，旧 scope 的迟到响应不得改写新页面
- SaaS Editor/Jobs、EdgeOne/Providers/Tunnel 表格与表单均由独立 owner 负责，Panel/Page 只做编排

## 运行参数

优先级：命令行参数 > 环境变量 > 默认值。

| 环境变量          | 默认值         | 说明                                                                             |
| ----------------- | -------------- | -------------------------------------------------------------------------------- |
| `HOST` / `PORT`   | `0.0.0.0:2022` | 监听地址（命令行 `--port` 可覆盖）                                               |
| `DATA_DIR`        | `./data`       | 数据目录（权限 0700，文件 0600）                                                 |
| `LOG_LEVEL`       | 关闭           | `info` / `warn` 等（命令行 `--log-level`）；Cookie、凭据字段自动脱敏             |
| `SESSION_SECRET`  | 自动生成       | ≥32 位；未设置时持久化在 `data/session-secret`                                   |
| `COOKIE_SECURE`   | `false`        | 启用 HTTPS 后务必设为 `true`                                                     |
| `COOKIE_SAMESITE` | `lax`          | `lax` / `strict` / `none`（`none` 必须同时 `COOKIE_SECURE=true`）                |
| `TRUST_PROXY`     | `false`        | 反向代理跳数（如 `1`）或可信代理 IP/CIDR 列表；不建议 `true`（会信任任意转发头） |
| `HTTP_TIMEOUT_MS` | `30000`        | 服务商 API 超时                                                                  |

```bash
SESSION_SECRET='至少 32 位随机字符串' COOKIE_SECURE=true TRUST_PROXY=1 node dist/server.js --port 2022
```

## 常用命令

| 命令                 | 说明                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev:server` | 后端开发（3022）                                                                       |
| `npm run dev:web`    | 前端开发（5173）                                                                       |
| `npm run build`      | 构建前后端                                                                             |
| `npm start`          | 生产启动                                                                               |
| `npm run typecheck`  | TypeScript 检查                                                                        |
| `npm run lint`       | ESLint                                                                                 |
| `npm run verify`     | 格式、Lint、双端 Typecheck、架构、死代码、依赖、路由、专项 Probe、构建、静态资源全门禁 |

## 安全建议

- 首次启动请从日志中获取随机初始密码；修改密码后所有已登录会话立即失效（当前设备保持登录）
- 若仍在使用旧的 `admin/admin`：登录后会被强制要求修改密码，在此之前其它接口不可用
- 忘记密码时：在 `data/config.json` 写入 `"auth": { "username": "admin", "password": "新密码" }` 后重启，启动时会自动转换为哈希
- 生产环境放在 HTTPS 反向代理之后，并设置 `COOKIE_SECURE=true`、`TRUST_PROXY=1`；`compose.yaml` 默认监听 `0.0.0.0:2022`，有反向代理时建议改为 `127.0.0.1:2022:2022`
- 容器以非 root（UID 1000）、只读根文件系统、无 capability 运行；宿主机数据目录需 `chown -R 1000:1000 data`
- 不要把 `data/`、Provider Token、Session Secret 或生产日志提交到公开仓库

内置防护：

- 密码：scrypt 哈希存储（自描述参数，便于升级），旧版本明文配置在启动/首次登录时自动转换
- 会话：AES-256-GCM 加密 Cookie（HKDF 派生密钥），绑定账号指纹；登出或改密码吊销所有设备会话
- 暴力破解：单 IP 15 分钟 5 次 + 全局 10 次失败锁定（伪造 `X-Forwarded-For` 无法绕过）
- CSRF：写请求校验 `Origin` / `Sec-Fetch-Site`，叠加 `SameSite=Lax`
- 输入：所有路径参数按白名单校验；上游 URL 拒绝 `.`/`..` 段与跨域，杜绝路径穿越与「删记录变删站点」
- 输出：错误 details 白名单，不返回上游原始响应与服务器路径；匿名健康检查仅返回 `status`
- 响应头：CSP、`X-Frame-Options`、`nosniff`、API `Cache-Control: no-store`

## 发布边界

- `main` 是当前持续发布分支；推送后 GitHub Actions 会先执行 `npm run verify`，成功后再构建 GHCR 镜像。
- `latest` 镜像只代表通过验证的发布产物；更新现有实例时应保留挂载的数据目录，并在重建后检查 health、登录会话、静态资源 MIME 和任务状态。
- 本项目面向个人与小团队，不以内置多实例、分布式锁、Redis、消息队列或数据库为目标。若未来需要多实例，应先引入标准外部存储/队列/锁，而不是继续扩展本地 JSON 方案。

## 贡献

Issue / PR 欢迎。建议：

1. `npm run verify` 通过
2. 保持依赖方向：`bootstrap → workflows → modules → platform/shared`，组装只在 `bootstrap/`
3. 不引入 Nest / DI 容器 / 额外文档目录

提交前请确认：没有把 `data/`、密钥、Token、构建产物或本地配置加入提交；涉及 UI 的改动还应覆盖桌面与移动端状态。

## 许可证

[MIT](LICENSE) © lei-rr

---

如果这个项目对你有用，欢迎 Star。
