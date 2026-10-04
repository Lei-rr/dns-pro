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
| `arch:final`       | 架构守卫：层矩阵 `app → use-cases → modules → core → shared`、产品线互不引用、缓存实现白名单、禁止重建 EventBus 等 |
| `deadcode`         | knip 死代码 / 无用导出检查（配置提示也视为错误）                                                                   |
| `deps:check`       | 依赖一致性脚本 + `npm audit --omit=dev --audit-level=high`                                                         |
| `routes:check`     | 路由指纹漂移门禁（`scripts/api-route-manifest.json` 与代码不一致即失败）                                           |
| `probe:api`        | 以真实装配 + Fastify inject 验证 API 契约（含路由、鉴权、错误体）                                                  |
| `probe:job`        | 前端任务进度模型（`useJobProgress`、`runBatchJob`、行忙碌 / 选择 / 作用域代次）                                    |
| `probe:platform`   | 平台并发、敏感文件、维护契约、数据迁移、缓存五个探针                                                               |
| `probe:workflow`   | 任务失败重试、隧道路由、请求参数、EdgeOne 载荷、默认配置、批量请求量、上游重试                                     |
| `probe:functional` | 前端审计、EdgeOne HTTPS 状态、SaaS DNS repair、稳定性断言                                                          |
| `probe:security`   | 安全回归（会话吊销 / CSRF / 路径注入 / 信息泄露 / 暴力破解）、密码、凭据加密                                       |
| `build`            | esbuild 打包 `dist/server.js` + Vite 构建 `web/dist`                                                               |
| `probe:static`     | 基于构建产物的静态资源与 SPA 回退契约                                                                              |

单步排查示例：

```bash
npm run arch:final            # 只跑架构守卫
npm run routes:check          # 只查路由漂移
npm run probe:security        # 只跑安全回归
npm run build                 # 只构建
```

---

## 3. 探针清单与单跑

探针以仓库根为工作目录运行（内部使用相对路径 `server/...`），**必须在项目根执行**。多数探针用 `os.tmpdir()` 建临时数据目录并通过 `setDataRoot` 指向它，不读写生产 `data/`；少数探针额外读取仓库文件（如 `Dockerfile`、前端源码）做契约断言。

| 探针                                              | 覆盖内容                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `scripts/isolated-api-probe.ts`                   | 真实装配 + inject 的 API 契约与路由指纹（最大的一份）                                |
| `scripts/isolated-backend-safe-probe.ts`          | 装配、输入归一化、presenter 输出的安全面                                             |
| `scripts/isolated-backend-careful-probe.ts`       | 边界值：`ApiError`、HTTP 客户端、密码哈希、厂商响应守卫                              |
| `scripts/isolated-platform-concurrency-probe.ts`  | `JsonStore` 串行、内存 `JobService`、批量条目汇总                                    |
| `scripts/isolated-workflow-recovery-probe.ts`     | SaaS 批量任务失败重试语义（不重放已完成阶段）                                        |
| `scripts/isolated-tunnel-route-probe.ts`          | 隧道路由写回顺序、扩展字段与 `catch_all` 保留、并发串行、CNAME 归属保护、repair 幂等 |
| `scripts/isolated-batch-request-probe.ts`         | 请求量守卫：过滤下推上游、不随条目数重复全量拉取                                     |
| `scripts/isolated-provider-retry-probe.ts`        | 上游限流重试与任务快照剥离（失败任务保留快照）                                       |
| `scripts/isolated-request-param-probe.ts`         | 路径参数与 schema 校验                                                               |
| `scripts/isolated-edgeone-payload-probe.ts`       | EdgeOne 加速域名载荷归一化                                                           |
| `scripts/isolated-saas-dns-repair-probe.ts`       | SaaS DNS repair 编排                                                                 |
| `scripts/isolated-frontend-audit-probe.ts`        | 前端：任务恢复失败与"无活跃任务"必须可区分                                           |
| `scripts/isolated-job-progress-probe.ts`          | 前端任务进度 / 行忙碌 / 选择 / 作用域代次                                            |
| `scripts/isolated-edgeone-https-status-probe.ts`  | 前端 EdgeOne HTTPS 状态标签                                                          |
| `scripts/isolated-stability-readability-probe.ts` | 错误语义、厂商响应 schema、同步适配器                                                |
| `scripts/isolated-default-config-probe.ts`        | 配置优先级与非法值 fail-fast                                                         |
| `scripts/isolated-security-probe.ts`              | 会话吊销 / CSRF / 上游路径注入 / 信息泄露 / 暴力破解                                 |
| `scripts/isolated-password-probe.ts`              | 密码存储与强制改密流程                                                               |
| `scripts/isolated-credential-encryption-probe.ts` | 凭据加密（`enc:v1:`）与存量迁移                                                      |
| `scripts/isolated-sensitive-files-probe.ts`       | 敏感文件权限与内容保护                                                               |
| `scripts/isolated-data-migration-probe.ts`        | 迁移框架与备份保留策略                                                               |
| `scripts/isolated-cache-probe.ts`                 | 缓存存活时间、容量上限、标签失效、在途加载拦截                                       |
| `scripts/isolated-maintenance-contract-probe.ts`  | 部署契约：镜像内无 curl/wget，健康检查必须走 node                                    |
| `scripts/isolated-static-probe.ts`                | 静态资源与 SPA 回退契约（依赖构建产物）                                              |

单跑方式：

```bash
npx tsx scripts/isolated-cache-probe.ts                       # 后端探针
npx tsx --tsconfig web/tsconfig.json scripts/isolated-job-progress-probe.ts   # 前端探针（需 web tsconfig）
npm run probe:platform                                        # 按分组跑
```

`probe:static` 依赖 `dist/` 与 `web/dist/`，先跑 `npm run build`。`probe:api` 等会打印失败断言与首个不匹配的字段，定位方式同单元测试。

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
- 容器 healthcheck 内置于镜像（Dockerfile `HEALTHCHECK`）：`fetch('http://127.0.0.1:2022/api/health')`，间隔 30s、超时 5s、重试 3 次、启动宽限 5s。镜像内**没有** `curl` / `wget`，不要用它们写探针（`isolated-maintenance-contract-probe.ts` 守卫该契约）。
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
