# Changelog

本文件记录 dns-pro 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-09-28

全量代码审计与重构版本：消除重复实现、清理死代码、修复请求期缺陷、统一工程约束。

### 新增

- 版本机制：根 `package.json` 为唯一版本源，`npm run version:sync` 同步至 `web/package.json` 与 `server/src/shared/version.ts`，`npm run version:check` 已接入 `npm run verify` 门禁，防止版本漂移。
- 前端版本注入：`web/vite.config.ts` 构建时注入 `__APP_VERSION__`（来源 `web/package.json`），页脚与登录会话的版本显示不再硬编码。
- web 工作区新增 `npm run lint`（`eslint src`）。
- 新增共享模块 `server/src/shared/providers/pagination.ts`：统一厂商分页护栏常量与比较语义。
- 新增共享模块 `server/src/shared/providers/response-guards.ts`：统一厂商响应载荷解析守卫。
- 新增共享模块 `server/src/shared/lib/fqdn.ts`：统一 FQDN 归一化。

### 变更

- 请求超时分级：作业轮询、会话检查等轻量调用改为 10 秒（`POLL_TIMEOUT_MS`），全量列表与批量作业保留 120 秒，避免后端阻塞时进度界面长时间无反馈。
- 开启 TypeScript `noUncheckedIndexedAccess`，为数组越界访问补充类型与运行时守卫。
- 厂商分页护栏去重：原先 2 份常量定义、3 种比较符写法、6 处 `1000` 硬编码，收敛为单一常量与单一比较语义。
- 厂商响应解析守卫去重：原先在 3 个模块中逐字复制的 5 个函数，收敛为共享实现。
- `provider-management` 单条读取由全量 `list()` 改为按 id 查找，避免无谓的全表克隆与依赖扫描。
- FQDN 归一化实现统一，消除多处等价但独立的正则处理。

### 修复

- 修复空响应体（HTTP 204 / 空 body）导致列表接口 `.map()` 与 `for...of` 抛错的问题：空载荷统一归一为空数组。
- 修复跨域请求凭据配置：`credentials` 由 `include` 改为 `same-origin`。
- 修复 `Number()` 转换缺少校验导致 `NaN` 与 `null` 污染记录字段的问题。
- 修复 `decodeURIComponent` 裸调用在畸形输入下抛 `URIError` 的问题。
- 修复作业恢复流程绕过数据归属校验（`scopeOwner`）的问题。
- 修复 `||` 判空吞掉合法假值（`0` / `false`）导致配置静默丢失的问题。
- 修复前端路由缺少 catch-all 兜底导致空白页的问题。
- 修复供应商分页超限时抛出裸 `Error` 绕过统一错误包装的问题，改为返回 `502` 语义错误。
- 修复依赖安全告警（`fast-uri`、`fastify`），`npm audit --omit=dev` 归零。

### 移除

- 移除死代码与无用导出：knip 报告存量 130 项、后续 23 项，以及 5 个无引用 Vue 组件。
- 移除 `previousStatus` 状态机制（写入后从未被读取）。
- 移除 HTTP 客户端中不可达的跨域分支。

### 说明

- 本次改动涉及 105 个文件，净减少 306 行代码，新增 3 个共享模块。
- 全部变更经 `npm run verify` 验证通过：31 条架构约束、88 条路由指纹、18 个隔离探针、类型检查、Lint、格式化、死代码与依赖审计。

## [1.0.0] - 2026-07-10

首个发布版本：DNSPod / Cloudflare / Cloudflare for SaaS / Cloudflare Tunnel / 腾讯云 EdgeOne 一体化管理面板。

- 后端 Fastify 5 + TypeScript，前端 Vue 3 + Vite + Tailwind CSS。
- 本地 JSON 存储，无外部数据库依赖。
- 单用户登录（AES-GCM 会话 Cookie）。
- 批量任务落盘与重启恢复。
- Docker / 本地 Node 双模式运行。
