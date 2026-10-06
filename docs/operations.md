# dns-pro 运维手册

面向部署、升级、排障与验证。设计依据见 `dns-pro-target-architecture.md`（唯一权威蓝图）与 `docs/adr/`（决策记录）。

**部署边界（必须遵守）**：一个应用进程独占一个数据目录。不要对同一 `DATA_DIR` 启动两个进程，也不要期望多实例共享 JSON 文件——需要多实例时应改用标准外部数据库 / 队列 / 锁，而不是扩展本地 JSON 方案。

---

## 1. 数据目录与 JSON 存储布局

`DATA_DIR` 默认 `./data`（容器内 `/app/data`）。目录权限 `0700`，文件权限 `0600`。

```text
data/
├── config.json                  # 账号、密码哈希、会话代次（store: auth）
├── providers.json               # 服务商清单；secret_key / api_token 为 enc:v1: 密文（store: providers）
├── saas/
│   ├── preferred-domains.json   # 优选域名白名单（store: preferredDomains）
│   └── preferences.json         # 主机名偏好与同步状态（store: saasPreferences）
├── credential.key               # 凭据加密主密钥（32 字节 base64url）
├── session-secret               # 未设置 SESSION_SECRET 时生成的会话密钥
├── __meta.json                  # 数据结构版本：{ "schema_version": 1, ... }
└── backups/                     # 自动备份（迁移前）
    └── pre-v0-20261004-235959/
```

**批量任务不落盘**：任务只存在于服务进程内存（内存执行器），进程重启后任务记录清空；前端轮询、失败重试与跨工作流资源键互斥行为不变。旧版本遗留的 `jobs/jobs.json` 不再读取，可手动删除。

**数据文件清单的单一来源**是 `server/core/store/store-registry.ts`：新增持久化文件必须在此登记，数据子目录由 `storeSubdirectories()` 派生（`server/main.ts` 启动时按注册表建目录）。`credential.key`、`session-secret`、`__meta.json`、`backups/` 属于运行时文件，不在 store 注册表内。

**JsonStore 写入语义**（`server/core/store/json-store.ts`）：

- 同一路径的读写进入进程内串行队列，并发写不会交叉。
- 写入 = 临时文件 `<file>.<pid>.<ts>.<rand>.tmp` → `fsync` → `rename` 原子替换（权限 `0600`）；不存在"写一半"的文件。
- 读取走进程内内存缓存；`readFresh()` 与 `transaction()` 始终以磁盘最新内容为准（跨文件引用校验依赖这一点）。
- 损坏的 JSON 抛 `server_error` 且**不覆盖原文件**；空文件按默认值处理。遇到该错误先备份再人工修复，不要直接删除文件。

**数据结构迁移**（`server/core/store/migrations.ts`）：启动时比较 `__meta.json` 的 `schema_version` 与代码内 `CURRENT_SCHEMA_VERSION`，有缺口则先整目录备份到 `backups/pre-v<from>-<时间戳>/`（保留最近 5 份），再按版本顺序执行迁移。迁移必须幂等；失败时版本不推进，修好可重跑。

---

## 2. `npm run verify` 各步骤含义

`npm run verify` 是唯一总门禁（替换为下列顺序执行）。任一步失败即整体失败。

| 步骤               | 作用                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `format:check`     | Prettier 校验 `server`、`web/src`、`scripts` 与根配置                                                              |
| `version:check`    | 根 `package.json` 版本 vs `web/package.json` vs `server/core/version.ts`，漂移即失败                               |
| `lint`             | ESLint（`server`、`web/src`、`scripts`）                                                                           |
| `typecheck`        | 后端 `tsc --noEmit`                                                                                                |
| `typecheck:web`    | 前端 `vue-tsc --noEmit`                                                                                            |
| `test`             | Vitest 全量测试（scripts / server / web 三项目：架构守卫规则、纯函数、契约、组件行为；见 §3）                      |
| `arch:final`       | 架构守卫：层矩阵 `app → workflows → modules → core → shared`、产品线互不引用、缓存实现白名单、禁止重建 EventBus 等 |
| `deadcode`         | knip 死代码 / 无用导出检查（配置提示也视为错误）                                                                   |
| `deps:check`       | 依赖一致性脚本 + `npm audit --omit=dev --audit-level=high`                                                         |
| `routes:check`     | 路由指纹漂移门禁（`scripts/api-route-manifest.json` 与代码不一致即失败）                                           |
| `build`            | esbuild 打包 `dist/server.js` + Vite 构建 `web/dist`                                                               |
| `test:static`      | 静态资源与 SPA 回退契约（`server/app/static-files.test.ts`）；针对构建产物，必须紧跟 `build` 之后单独跑              |

单步排查示例：

```bash
npm run arch:final            # 只跑架构守卫
npm run routes:check          # 只查路由漂移
npx vitest run server/app/security.test.ts   # 只跑安全回归
npm run test                  # 全量测试（scripts / server / web）
npm run build                 # 只构建
```

---

## 3. 测试套件与单跑

验证入口是 `npm run test`（Vitest，配置见 `vitest.config.ts`），一次跑三个 project：

- `scripts`：Node 环境，跑架构守卫规则与仓库级契约（Dockerfile 健康检查、前端接线静态断言）。
- `server`：Node 环境，直接执行 `server/` 下的 ESM 源码（相对导入带 `.js` 后缀），覆盖装配、API 契约、存储、安全与工作流。
- `web`：happy-dom 环境，extends `web/vite.config.ts` 复用 Vue SFC 编译与 `@` 别名，覆盖前端模型、组件与网络层。

测试文件就近放在源码旁（各 project include `scripts/**`、`server/**`、`web/src/**` 下的 `*.{test,spec}.ts`），**必须在项目根执行**。旧版探针脚本已全部删除，断言迁入这些测试文件（多数文件头部注释保留了迁移来源）。

单跑：

```bash
npx vitest run server/app/security.test.ts      # 单个文件
npx vitest run server/core/security             # 一个目录
npx vitest run --project web                    # 只跑前端
npx vitest run --project server                 # 只跑后端
npm run test                                    # 全量（三 project）
npm run test:static                             # 构建产物契约（需先 npm run build，见 3.9）
```

每个用例的数据目录都建在系统临时目录下、前缀统一为 `dns-pro-`：整轮结束后由 `vitest.global-setup.ts` 按运行前后快照删除**本轮新建的**目录——用例内不删，失败现场保留到本轮结束、不干扰下一轮。排查失败需要跨轮保留现场时设 `KEEP_TMP=1`，此时需自行清理（它保留的是本轮全部临时目录）。

下表按域索引「要验证什么 → 跑哪个文件」：

### 3.1 架构与仓库级契约（scripts）

| 文件 | 覆盖内容 |
| ---- | -------- |
| `scripts/check-architecture.test.ts` | 架构守卫规则样例（层矩阵、产品线互不引用、缓存实现白名单等） |
| `scripts/maintenance-contract.test.ts` | 部署契约：Dockerfile 健康检查必须走 node 请求 `/api/health`，镜像内不得依赖 curl / wget；npm audit 用例默认跳过（`DNS_PRO_RUN_NPM_AUDIT=1` 显式开启） |

### 3.2 API 契约与装配（server/app）

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/app/api-contract.test.ts` | 真实装配 + Fastify inject 的对外 HTTP 契约与 API 路由清单 |
| `server/app/api-records.test.ts` | DNS / EdgeOne 记录端点契约 |
| `server/app/api-jobs.test.ts` | 批量任务族端点、任务详情视图与归属校验 |
| `server/app/api-providers.test.ts` | 服务商 CRUD / 关联与数据目录初值 |
| `server/app/routes.test.ts` | 批量任务端点按服务商归属隔离 |
| `server/app/config.test.ts` | 配置解析：`TRUST_PROXY` 拒绝 `true` / 跳数、`LOG_LEVEL` 归一与非法值 fail-fast、首启与明文配置的凭据落盘 |
| `server/app/static-files.test.ts` | 静态资源与 SPA 回退契约（依赖构建产物，见 3.9） |

### 3.3 安全

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/app/security.test.ts` | 安全回归：会话吊销 / CSRF / 上游路径注入 / 信息泄露 / 暴力破解 |
| `server/core/security/password.test.ts` | 密码哈希与校验（scrypt） |
| `server/core/security/password-flow.test.ts` | 默认凭据拦截与改密吊销 |
| `server/core/security/credential-encryption.test.ts` | 凭据静态加密（`enc:v1:`）与存量迁移 |
| `server/core/security/sensitive-files.test.ts` | 敏感文件权限与内容保护 |
| `server/core/crypto/secret-box.test.ts` | `secret-box` 完整形态判定 |

### 3.4 存储、迁移与缓存

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/core/store/json-store.test.ts` | `JsonStore` 结构损坏判定（损坏即报错、不静默覆盖） |
| `server/core/store/migrations.test.ts` | 迁移框架、版本推进与备份保留 |
| `server/core/cache/memory-cache.test.ts` | `MemoryCache` 存活时间（惰性过期） |
| `server/core/cache/provider-cache.test.ts` | `withProviderCache` 命中 / `refresh` / 标签失效 |

### 3.5 任务、并发与审计

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/core/jobs/job-concurrency.test.ts` | `JsonStore` 跨实例写队列、内存 `JobService` 并发 |
| `server/core/jobs/job.service.test.ts` | 任务快照体积守卫 |
| `server/core/jobs/job-mutex.test.ts` | 资源键交集互斥的单一口径 |
| `server/core/observability/audit-log.test.ts` | 审计环形缓冲 |

### 3.6 厂商模块与核心契约

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/core/contracts/dns-record.port.test.ts` | 记录值比较（域名类忽略大小写与尾点，其余类型精确比较） |
| `server/core/http/base-http.client.test.ts` | HTTP 限流重试（429 遵循上游等待时间） |
| `server/core/http/error-messages.test.ts` | 错误消息翻译（原型链键不得被当成错误码） |
| `server/core/providers/provider-error.test.ts` | `isExplicitNotFound` 只认结构化证据 |
| `server/core/providers/provider.repository.test.ts` | `providers.json` 损坏不得被读成空表 |
| `server/core/providers/provider-connection.service.test.ts` | 关联链校验先于探测 |
| `server/core/providers/provider-normalizer.test.ts` | 服务商 ID 保留键与原型链键 |
| `server/core/providers/provider-presenter.test.ts` | 未知类型只输出安全字段 |
| `server/core/providers/side-effect-result.test.ts` | 嵌套失败项上浮为 failed |
| `server/core/providers/tencent-cloud.client.test.ts` | 腾讯云业务错误码限流 |
| `server/modules/cloudflare/cloudflare-dns-record.handlers.test.ts` | 记录列表归属徽标降级策略 |
| `server/modules/cloudflare/cloudflare-dns-record.service.test.ts` | 加速域名分页缓存键 |
| `server/modules/cloudflare/cloudflare-response.schema.test.ts` | 响应结构不符即 502 |
| `server/modules/cloudflare/cloudflare-zone.service.test.ts` | 站点 create：先失效再解析 |
| `server/modules/cloudflare/saas/saas-custom-hostname.client.test.ts` | 主机名索引快照：一次拉取、多次匹配 |
| `server/modules/cloudflare/saas/saas-hostname.service.test.ts` | 主机名删除的站点归属校验 |
| `server/modules/cloudflare/saas/saas-preference.service.test.ts` | 孤儿偏好清理 |
| `server/modules/cloudflare/saas/saas-sync-config.service.test.ts` | 同步配置归一化（目标切换与脏配置修复） |
| `server/modules/cloudflare/tunnel/tunnel.service.test.ts` | 令牌轮换：部分成功必须对外可见 |
| `server/modules/cloudflare/tunnel/tunnel-route.service.test.ts` | 隧道路由写回顺序、扩展字段与 `catch_all` 保留、并发串行、CNAME 归属保护、repair 幂等 |
| `server/modules/dnspod/dns-pod-line.service.test.ts` | 线路解析：`refresh` 透传到套餐等级 |
| `server/modules/dnspod/dns-pod-record.handlers.test.ts` | 记录列表归属徽标降级策略 |
| `server/modules/dnspod/dns-pod-record.service.test.ts` | IDN 缓存键同源 |
| `server/modules/dnspod/dns-pod-response.test.ts` | 响应结构不符即 502 |
| `server/modules/dnspod/dns-pod-zone.service.test.ts` | 站点 create：先失效再解析 |
| `server/modules/dnspod/zone-catalog.test.ts` | FQDN 归一：账号侧与查询侧必须同形 |
| `server/modules/edge-one/edge-one-domain-payload.test.ts` | 加速域名载荷归一化（创建路径） |
| `server/modules/edge-one/edge-one-params.test.ts` | 路径参数解码与白名单 |
| `server/modules/edge-one/edge-one-response.test.ts` | 响应结构不符即 502 |

### 3.7 工作流

| 文件 | 覆盖内容 |
| ---- | -------- |
| `server/workflows/saas-dns-sync/saas-batch.workflow.test.ts` | SaaS 批量任务删除阶段顺序 |
| `server/workflows/saas-dns-sync/saas-preference-migration.test.ts` | 偏好键身份 `(zone, FQDN)`：启动收编、写入即收编、按 FQDN 清理 |
| `server/workflows/saas-dns-sync/saas-dns-repair.test.ts` | SaaS DNS repair 编排：复用既有 upsert 而非另写一套 |
| `server/workflows/saas-dns-sync/batch-request-budget.test.ts` | 请求量守卫：过滤下推上游、不随条目数重复全量拉取 |
| `server/workflows/saas-dns-sync/saas-sync-adapter.test.ts` | 同步适配器记录采集（DNSPod / Cloudflare 两侧） |
| `server/workflows/derived-records/ownership.test.ts` | 归属查询：未声明即 `manual` |
| `server/workflows/derived-records/planners/saas.test.ts` | 清理按名称定位、备注证明归属 |
| `server/workflows/derived-records/sync-plan.test.ts` | 记录身份与查询条件（写入与 repair 共用判据） |
| `server/workflows/dns-batch/dns-record-payload.test.ts` | 创建记录槽位去重不吞掉不同取值 |
| `server/workflows/provider-management/provider-dependency.workflow.test.ts` | 服务商依赖反查与原型链隔离 |

### 3.8 前端（web）

| 文件 | 覆盖内容 |
| ---- | -------- |
| `web/src/shared/job/model/run-batch-job.test.ts` | 批量任务执行模型 |
| `web/src/shared/job/model/use-job-progress.test.ts` | 任务进度模型与恢复失败区分 |
| `web/src/shared/lib/row-busy.test.ts` | 行忙碌 |
| `web/src/shared/lib/row-selection.test.ts` | 行选择与忙行 |
| `web/src/shared/lib/scope-generation.test.ts` | 作用域代次（在飞请求作废） |
| `web/src/shared/lib/use-page-visibility.test.ts` | 页面可见性开关 |
| `web/src/shared/api/http.test.ts` | 网络层的中断分类 |
| `web/src/shared/query/client.test.ts` | 全局 `queryClient` |
| `web/src/shared/query/use-resource-query.test.ts` | `useResourceQuery` 错误提示分流 |
| `web/src/shared/ui/confirm/confirm.test.ts` | 确认弹窗的勾选项 |
| `web/src/shared/ui/confirm/ConfirmHost.test.ts` | 勾选项渲染 |
| `web/src/features/dns/lib/record-import.test.ts` | DNS 导入文件解析 |
| `web/src/features/dns/lib/record-group.test.ts` | 邮箱套件聚组与折叠 |
| `web/src/features/dns/lib/record-owner.test.ts` | 记录归属标签（D4） |
| `web/src/features/dns/ui/RecordsPanel.test.ts` | 面板先分组后分页 |
| `web/src/features/dns/ui/RecordsTable.test.ts` | 行内选择框可访问名称 |
| `web/src/features/edge-one/model/domain-command.test.ts` | 加速域名表单值 |
| `web/src/features/edge-one/model/domain-status-actions.test.ts` | 状态动作矩阵（真机实测语义） |
| `web/src/features/edge-one/model/status-transitions.test.ts` | 过渡态派生 |
| `web/src/features/edge-one/model/status-poll-policy.test.ts` | 常规轮询节奏 |
| `web/src/features/edge-one/lib/status.test.ts` | HTTPS 状态文案 |
| `web/src/features/edge-one/api/edge-one-api.test.ts` | `deleteAccelerationDomain` 的 `auto_cleanup` 映射 |
| `web/src/features/edge-one/ui/AccelerationDomainsPanel.spec.ts` | 面板轮询编排（可见性门控、退避重排、卸载清理） |
| `web/src/features/edge-one/ui/AccelerationDomainsTable.spec.ts` | 表格行内操作菜单渲染与事件链路 |
| `web/src/features/saas/ui/SaasHostsPanel.test.ts` | 详情加载与刷新的所有权隔离 |
| `web/src/features/saas/model/use-saas-host-editor.test.ts` | 保存与优选域名加载的所有权分离 |
| `web/src/features/saas/api/saas-api.test.ts` | `deleteHostname` 的 `auto_cleanup` 映射 |
| `web/src/features/tunnels/model/use-tunnel-detail.test.ts` | 令牌读写所有权 |

### 3.9 构建产物契约（`test:static`）

静态资源与 SPA 回退由 `server/app/static-files.test.ts` 守卫，它走两条路径：

- `web/dist/` 存在时：按真实产物断言外壳引用可达、`/assets/` 不可变缓存、缺失资源 404 且不回退成 HTML、深链回退、API 404 错误体。
- 未构建时：真实产物用例自动跳过，改用最小 dist fixture 跑同一条装配与断言路径（`verify` 中 `test` 阶段早于 `build`，靠它保证未构建环境也有覆盖）。

因此 `npm run verify` 把 `npm run test:static` 放在 `npm run build` 之后单独执行：`npm run test` 单独运行时若未构建，只覆盖 fixture 分支；构建产物就绪（`npm run build` 同时产出 `dist/` 与 `web/dist/`）后再跑 `npm run test:static`，真实产物断言才真正执行。

---

## 4. Docker 部署与健康检查

镜像由 GitHub Actions 在推送 `v*` 标签时构建并推送至 `ghcr.io/lei-rr/dns-pro`（日常提交只跑 `verify`）。供应链检查由独立 workflow `.github/workflows/security.yml` 承担：Trivy 扫描（`HIGH,CRITICAL`，存在修复版本的漏洞阻断）并把 SARIF 上报 Security 面板，Anchore Syft 生成 SPDX SBOM 作为制品上传。

```bash
docker run -d \
  --name dns-pro \
  --restart unless-stopped \
  -p 2022:2022 \
  -v "$PWD/data:/app/data" \
  ghcr.io/lei-rr/dns-pro:latest
```

`compose.yaml` 已内置加固：`read_only: true`、`cap_drop: ALL`、`no-new-privileges`、`tmpfs: /tmp`、数据卷 `./data:/app/data`。

- 容器以非 root（UID 1000）运行，宿主数据目录必须 `chown -R 1000:1000 data`；`docker/entrypoint.sh` 在启动时检查 `/app/data` 可写，不可写直接退出并给出提示。
- 容器 healthcheck 内置于镜像（Dockerfile `HEALTHCHECK`）：`fetch('http://127.0.0.1:2022/api/health')`，间隔 30s、超时 5s、重试 3 次、启动宽限 5s。镜像内**没有** `curl` / `wget`，不要用它们写探针（`scripts/maintenance-contract.test.ts` 守卫该契约）。
- 排查容器状态：`docker inspect --format '{{json .State.Health}}' dns-pro` 查看最近几次 healthcheck 结果与退出码；`unhealthy` 时先看应用日志（配置错误、数据目录不可写、迁移失败都会导致进程退出）。
- 升级实例：保留 `data/` 卷 → 拉新镜像 → 重建容器 → 检查日志、`/api/health`、登录会话与静态资源。
- 反向代理后推荐 `COOKIE_SECURE=true`、`TRUST_PROXY=127.0.0.1`（填可信代理的 IP/CIDR），并把端口映射收紧为 `127.0.0.1:2022:2022`。
- 当前只有匿名 `GET /api/health`（仅返回 `status`）；`healthz` / `readyz` 分离与 `/api/metrics` 属于蓝图 §5 的待落地项，尚未实现。

---

## 5. 版本同步

根 `package.json` 的 `version` 是唯一手写版本源。

```bash
npm run version:sync     # 同步到 web/package.json 与 server/core/version.ts（APP_VERSION）
npm run version:check    # 检查三处是否漂移；已接入 npm run verify
```

前端构建时由 `web/vite.config.ts` 注入 `__APP_VERSION__`（来源 `web/package.json`），页脚与登录会话的版本显示不再硬编码。

发布流程：`npm run version:sync` → 更新 `CHANGELOG.md` → 提交 → 打标签（`git tag v1.2.0 && git push origin v1.2.0`）。CI 会校验标签版本与 `package.json` 一致，不一致直接失败。

---

## 6. 备份与恢复

**自动备份**：数据迁移前自动把整个数据目录复制到 `data/backups/<label>/`（标签形如 `pre-v0-20261004-235959`，字典序即时间序），保留最近 5 份（`server/core/backup/backup.service.ts`）。

**手工备份**：

```bash
# 停服务后执行，保证复制期间没有写入
tar czf dns-pro-data-$(date +%Y%m%d).tar.gz -C /path/to data
```

备份内容必须包含 `credential.key` 与 `session-secret`：

- `credential.key` 是 `providers.json` 中 `enc:v1:` 密文的解密密钥。**两者必须成对**，只恢复其一等于凭据不可用。
- `session-secret` 决定已签发会话 Cookie 是否继续有效；不恢复它 = 所有设备需重新登录。
- `__meta.json` 决定启动时是否需要重跑迁移，不要手工删除。

**恢复**：

```bash
# 1) 停止服务（docker stop dns-pro 或 kill 进程）
# 2) 把当前数据目录改名保留现场，不要直接覆盖
mv data data.broken
# 3) 解包备份为新的 data/，确认属主与权限
tar xzf dns-pro-data-YYYYMMDD.tar.gz
chown -R 1000:1000 data && chmod 700 data
# 4) 启动并检查日志、/api/health、登录状态与 provider 列表
```

备份产物含密钥与凭据密文，按机密件保存（至少 `0600`，宿主机目录 `0700`），不要与代码目录一起分发。

---

## 7. 常见故障排查

### 7.1 密钥解密失败（provider 相关接口 500）

症状：日志出现 `Failed to decrypt stored credential`，错误码 `credential_decrypt_failed`（`server/core/crypto/secret-box.ts`）。

成因：`data/credential.key` 丢失、被替换，或 `providers.json` 来自另一份数据目录；手工编辑把 `enc:v1:` 密文改坏也会命中。

处置：

1. 从备份恢复**与 `providers.json` 配对**的 `credential.key`，重启即可。
2. 无法配对时，只能重新录入受影响 provider 的凭据字段（密文不可逆）；其余数据文件不受影响。
3. 不要尝试"清空该字段继续跑"——解密失败是显式报错，不会静默降级为空值。

### 7.2 端口占用（EADDRINUSE）

```bash
ss -lntp | grep 2022          # Linux
lsof -i :2022                 # macOS
netstat -ano | findstr :2022  # Windows（配合 tasklist 查 PID）
```

处置：停掉占用进程，或用 `--port` / `PORT` 换端口；容器场景改 `ports` 映射。注意本地后端开发默认 3022，Vite 开发默认 5173，不要与生产 2022 混淆。

### 7.3 数据目录不可写

症状：容器启动即退出，日志提示 `/app/data` 不可写（`docker/entrypoint.sh`）。

处置：`chown -R 1000:1000 <宿主数据目录>` 后重启；或改用命名卷。只读根文件系统是刻意配置，不要为绕过它而加 `--privileged`。

### 7.4 迁移失败导致启动失败

症状：启动日志 `data migration <版本>: <描述>` 之后抛错退出。

处置：`__meta.json` 不会推进，先修数据再重启即可重跑（迁移幂等）；需要回滚时用 `data/backups/pre-v*` 对应目录整体替换数据目录（见 §6）。不要手工把 `schema_version` 改大——那会让迁移被跳过，后续启动读到不兼容结构。

### 7.5 镜像扫描告警处置

`security.yml` 只扫描**镜像**，分两类来源：

- OS 包 / 基础镜像：等待 `node:20-bookworm-slim` 上游更新，或由 Dependabot 的 `docker` 生态 PR 提示升级；紧急时可评估切换基础镜像版本。
- npm 生产依赖：优先升级依赖，其次用根 `package.json` 的 `overrides` 提升传递依赖；`npm run deps:check` 同步把关。

判定与豁免：

- 门禁只对**存在修复版本**的 `HIGH` / `CRITICAL` 失败（`ignore-unfixed`）；不可修复项不会阻断流水线，但仍会出现在 Security 面板，需要评估暴露面并记录处置结论。
- 确实误报或暂不适用时，在 GitHub Security 面板 dismiss 并写明原因；确需流水线级豁免时新增 `.trivyignore`（需单独评审，不要改动 `verify.yml` 的既有步骤）。

### 7.6 登录与会话问题

- 初始密码只在首次启动日志打印一次（`[SECURITY] 已生成初始密码：...`），数据库里只有 scrypt 哈希。
- 忘记密码：在 `data/config.json` 写入 `"auth": { "username": "admin", "password": "新密码" }` 后重启，启动时会转为哈希并删除明文。
- 修改密码会递增 `session_epoch`，其它设备会话立即失效（当前设备保持登录）；这是预期行为，不是故障。

### 7.7 数据看起来"没更新"

进程内缓存承载了厂商列表等读路径，接口层面的 `refresh=1` 会绕过并覆盖缓存；直接重启进程等价于清空缓存。排查顺序：先确认写操作返回成功 → 再确认是否被缓存挡住 → 最后确认数据文件内容（`data/` 下对应 JSON）。
