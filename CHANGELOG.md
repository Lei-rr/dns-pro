# Changelog

本文件记录 dns-pro 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

后端全量重构、性能优化与安全加固。

### 安全

- 修复：Cloudflare 批量删除/修改中记录 ID 为 `..` 时，上游 URL 被规范化为站点路径，可导致**删除整个站点**。现路径参数与记录 ID 统一白名单校验，HTTP 客户端拒绝 `.`/`..`/空段与跨域地址。
- 会话改为可吊销：Cookie 绑定「用户名+密码+会话代次」指纹；登出吊销所有设备，修改密码后旧会话立即失效；密钥改用 HKDF 派生（旧会话需重新登录）。
- 新增 CSRF 防护（`Origin` / `Sec-Fetch-Site`），新增全局登录失败锁，`TRUST_PROXY` 支持跳数与可信地址列表。
- 错误响应 details 白名单脱敏；日志脱敏 Cookie 与凭据；匿名 `/api/health` 仅返回 `status`；`x-request-id` 仅接受安全字符。
- Docker 以非 root、只读根文件系统运行；数据目录 0700。

### 变更

- 跨工作流互斥：批量任务按「底层写入资源键」判定冲突，DNS 批量、SaaS 批量/优选、EdgeOne 批量共享同一把锁；任务类型 ID 统一登记在 platform/jobs/job-types.ts。
- SaaS 契约清理：可从接口清空同步目标（空串即关闭自动同步）；移除后端未消费的 `min_tls`/`ssl`/`hostname_prefix`；`dns_cleanup_status` 取值统一。
- 日志不再记录 `x-request-id` 原始值以外的关联信息（见安全修复）。
- 缓存语义调整：条目带存活时间（5 分钟）与容量上限（500，LRU 淘汰），过期/超限在读写时惰性清理，不引入后台定时器；移除从未被调用的按键失效路径，代次映射加上限。
- 移除未使用的功能与死字段：任务取消接口（前端从未启用）、`JobService.ensure()`、任务条目的 `operation_id`。
- 密码改为 scrypt 哈希存储：首次启动生成随机初始密码（仅落盘哈希，明文打印在日志）；旧版明文配置在启动或首次登录时自动升级。
- 新增 `POST /api/auth/password` 修改密码：校验当前密码、拒绝弱口令，改密码后吊销其它设备会话并轮换当前设备 Cookie。
- 仍在使用 `admin/admin` 时，除改密码外的业务接口一律返回 403 `password_change_required`；前端弹出不可关闭的改密对话框。
- 请求量优化：DNSPod 查询把主机记录/类型过滤下推上游（此前每次同步都全量拉取整个域名），列表分页使用官方上限 3000；Cloudflare 记录查找改用精确 `name` 参数且不再污染列表缓存；SaaS 批量逐条只失效详情缓存、EdgeOne 批量使用任务级 CNAME 快照，消除随条目数放大的 O(N²) 拉取。
- 新增 `GET /api/dnspod/providers/:providerId/zones/:zone/lines` 解析线路接口；前端线路选项改为按域名套餐动态加载并提交 `record_line_id`，不再硬编码。
- 新增环境变量：`HOST` `PORT` `DATA_DIR` `LOG_LEVEL` `COOKIE_SECURE` `COOKIE_SAMESITE` `TRUST_PROXY` `HTTP_TIMEOUT_MS`。
- 统一命名：`*Gateway` → `*Client`；`CloudflaredXxxService` → `TunnelXxxService`；`DnsPodRecordOps` → `DnsPodRecordSyncService`；`XxxBatchJobWorkflow` → `XxxBatchWorkflow`。
- 抽取公共能力：`provider-call.ts`（错误包装 + 分页采集）、`BatchJobKind`（批量任务查询/重试/互斥）、`saas-sync-records.ts`（SaaS DNS 记录构造）、`tunnel-account.ts`。
- EdgeOne 加速域名创建/删除收归模块服务；删除仅转发的 Repository/类型文件与未使用的 Job 方法。
- `JsonStore` 遇到损坏 JSON 时报错而不是静默覆盖；只读挂载下读取不再因 chmod 失败。

### 修复

- 第二批审计修复（前后端）：
  - 会话指纹与域名兜底：`guessZoneFromFqdn` 改为去掉最左标签（`example.co.uk` 不再被猜成 `co.uk`），DNSPod 显式站点失效时回退到权威最长后缀匹配；Cloudflare DNS 同步在未配置目标站点时回退到主机名所在站点。
  - IDN：Cloudflare 记录精确匹配前做 punycode 归一。
  - 服务商删除：模块内新增引用守卫，禁止删除仍被其它服务商引用的配置；展示层未知类型不再展开原始对象（避免密钥外泄）。
  - 登录锁定改为按来源 IP（10 次/15 分钟）并保留高阈值全局兜底（50 次/5 分钟），管理员不再被任意来源的少量失败锁死。
  - 前端：登录页不再拒绝含空格密码（与后端/改密弹窗一致）；会话检查失败不再被当成未登录并缓存；任务恢复探测在 reset 后仍可用；SaaS 面板搜索框缺少组件导入（搜索无效）；主机记录支持空格分隔多个名称；DNS 导入解析改为引号感知（TXT 中的 `;` 不再被截断）、支持 `( )` 续行与缩进继承、支持 TTL 单位、无表头 CSV 不再吞掉首行、导入前本地去重；单条编辑回传原有启停状态与权重；优选域名可清空；优选预览 `will_change` 为 0 时不再回落为总数；详情「刷新状态」改为调用 reconcile（所有权 TXT 清理才真正生效）；默认回源弹窗未配置时不再误调删除接口；线路加载纳入作用域校验并在刷新时重取；清单页 load 抛错会给出反馈；服务商密钥字段按后端 `secret_fields` 判定（SecretId 恢复明文显示）；补服务商相关错误码中文提示；记录表排序不再被分组打乱。
- 第三批审计修复（前端为主）：
  - 隧道详情：Token 轮换不再被并发刷新覆盖（轮换作废在途读取），读取瞬时失败不再清空已展示的 Token。
  - 服务商入口：路由存在性判断改为「全部服务商」，未配置完整时在页面给出明确提示与跳转，不再静默跳回首页；服务商列表区分「一个都没有」与「该类型为空」。
  - EdgeOne：站点元数据未就绪时禁止新增（避免用 zoneId 拼出错误主机名）；端口改为显式校验并如实提交（空值/越界不再被静默丢弃）；表格选择状态改为 computed（原实现每次渲染重建 Set）。
  - SaaS：同步域名请求去重（新增弹窗此前会发两次）；详情「刷新状态」改用 reconcile。
  - 通用：错误响应改为「已本地化消息优先，否则用错误码中文映射」，内部英文校验文本不再直接出现在中文界面（86 处英文消息随之本地化）；分页在历史 pageSize 不在选项内时不再显示空白；记录导出与当前筛选一致；编辑缺少记录 ID 时明确报错而不是退化为新建；Windows 安装命令按 32/64 位给出对应 MSI；提交中禁止关闭主机名/加速域名弹窗；移除会全局覆盖 Tailwind `animate-spin` 的非分层样式；HTTP 客户端在成功路径摘除 abort 监听。
- 第四批审计修复（前端收尾）：
  - 副作用读取器合并为一个实现（`shared/lib/side-effects.ts`），删除重复的 `dns-side-effects.ts`。
  - SaaS 状态判定集中到 `features/saas/lib/status.ts`（`isHostnameSettled` / `isSslSettled`），详情弹窗不再各自维护状态数组。
  - 优选弹窗移除 800ms 定时复位，改用父级任务状态解除按钮锁定（快速连点不再被吞）。
  - SaaS 主机名更新后静默重载，补齐更新响应不含的 `effective_sync_*` 派生字段（再次编辑不再回落到空）。
  - EdgeOne 批量任务恢复使用作用域快照（切换站点后不会打到新站点），并在成功结束时给出提示。
  - 优选预览不再触发「任务执行中…」的假进度横幅（预览无任务，反馈由弹窗按钮承担）。
  - 移除 `record-remark` 中不可达的邮箱前缀判断分支，以及无 UI 调用方的 `providersApi.reorder` 包装（服务商排序接口仅保留后端，路由目录为 append-only）。
- 审计修复：`X-Request-Id` 伪造可绕过清洗写入日志（改为自建 ID 生成并校验）；路径参数上限 100 导致 101-253 字符的合法域名直接 414；改密码接口未限流且失败不计入锁定；TTL/Weight 越界值透传上游；预清理冲突会删除默认 NS 记录；清理删除未按备注匹配可能误删人工记录；分页在上游 total 滞后时提前结束；隧道路由写回丢失 `originRequest` 等扩展字段与自定义 catch_all，且并发读-改-写会互相覆盖；删除隧道未失效路由配置缓存；Cloudflare 批量端口永久缓存 zoneId；SaaS 孤儿偏好清理残留 sync_zone；所有权 TXT 在清理被跳过时被误记为已清理。
- 上游限流：遵循 `Retry-After`，限流（429/业务限流码）对任意方法安全重试，超过 10 秒的等待快速失败。
- 任务文件膨胀：已完成任务剥离执行期快照、任务文件紧凑写入、启动无变更不写盘。
- DNSPod 批量修改把任务条目状态（`running`）误当作记录启停状态提交。
- SaaS 同步配置的引用校验与写入不在同一把锁内（并发删除服务商时可写入悬空引用）。
- DNSPod 记录 ID 非数字时以 `NaN` 发往上游。
- 未捕获异常未做有序退出。

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
