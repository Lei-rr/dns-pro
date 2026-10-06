# Changelog

本文件记录 dns-pro 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.2] - 2026-10-07

跨模块小标签外观统一：徽章只用灰/黑三档，状态语义改由文案承担。

### 变更

- 标签统一：Badge 删除 `success`（绿）与 `warning`（黄）两个变体，全站只剩 `default`（黑底）/ `secondary`（灰底）/ `outline`（灰描边）/ `destructive`（仅按钮与菜单项使用，没有标签在用）。状态标签收敛为三档——常态 → `secondary`、中间态 → `outline`、异常 → `default`，区分靠 `statusLabel` / `edgeOneStatusLabel` 的中文词表，不再靠色相。
- 影响面：`saas/lib/status.ts` 的 `statusVariant()` 与 `edge-one/lib/status.ts` 的 `STATUS_VARIANTS` 共 11 条状态映射；`RecordImportDialog` 的导入预览标签，以及同一区块里原本是绿/黄的「新增 / 覆盖」统计数字（同行的「重复跳过」早已是灰的）。
- 新增 `saas/lib/status.test.ts`（3 例）并为 `edge-one/lib/status.test.ts` 追加 4 例——「只用灰黑三档」这条契约此前没有测试兜底，谁把彩色变体加回来都不会被发现。
- CSS 产物减少约 1.7 kB（81.90 kB → 80.19 kB），即移除的颜色工具类。

## [1.2.1] - 2026-10-07

DNS 记录页交互回调，同步健康（统一对账）功能下线。

### 变更

- DNS 记录页：折叠组恢复整体前置。1.2.0 曾把分组与独立记录改为按排序混排（见 1.2.0 的「记录表排序不再被分组打乱」），本次改回「折叠组集中在顶部、独立记录随后」，组内与组间顺序仍由 `compareRecordsForGroup` 决定。新增 `web/src/features/dns/lib/record-display.test.ts` 钉住该顺序——此前只有集成测试覆盖「先分组后分页」，排序本身没有测试。
- DNS 记录页：备注列去掉归属标签（SaaS / 隧道 / EdgeOne / 人工），只保留备注文本；`web/src/features/dns/lib/record-owner.ts` 及其测试、`DnsRecord` 上的 `owner` 字段随之删除。折叠组行上的用途标签（业务 CNAME / DCV 委派 / 所有权验证）不受影响。

### 移除

- 移除「同步健康」页面与统一对账功能：前端删除 `web/src/pages/sync/SyncPage.vue`、`web/src/features/sync/`（10 个文件）、路由项、桌面与移动导航入口、命令面板项；后端删除 `/api/reconcile` 路由与 `ReconcileService`、三个派生 planner 中只服务对账的部分（`saasDerivedPlanner`、`edgeOneDerivedPlanner`、`tunnel.planner.ts`）以及 `derived-record.types.ts`，共 20 个源文件。
- 保留共用底座与独立功能：`derived-records/` 下的 `dns-writer`、`ownership`、`sync-plan`、`current-records` 与 `saas-records` / `saas-targets` 两个 planner 仍服务 SaaS、EdgeOne、隧道的同步与 repair；三条产品线各自的 `dns-repair` 与 SaaS 详情「刷新状态」（`POST /api/saas/.../reconcile`）未受影响。
- 审计动作白名单收缩为三类（批量 / 凭据变更 / 会话吊销），去掉已无写入方的 `reconcile`；`/api/audit` 查询接口保留——审计留痕被 6 处写入路径调用，属独立安全能力。
- 路由清单重新生成：94 → 92 条。

## [1.2.0] - 2026-10-06

后端全量重构（Phase 1-4：数据安全、可观测性、契约链路、探针瘦身；Phase 5a：五顶层结构；Phase 5b：D2 共享底座与 D1-1 DNS 端口）、交付成熟度补齐（Phase 6）、性能优化与安全加固、测试体系迁移（探针退役 → Vitest）与第三轮门禁补全。

### 新增

- 交付成熟度（Phase 6）：新增 `.github/workflows/security.yml`——构建镜像后跑 Trivy 扫描（`severity: HIGH,CRITICAL`，存在修复版本的漏洞阻断流水线）并将 SARIF 上报 GitHub Security，同时用 Anchore Syft 生成 SPDX SBOM 作为制品上传；触发条件为 main 推送、PR 与每周定时。
- 交付成熟度（Phase 6）：新增 `.github/dependabot.yml`——npm（根工作区 / `web` 工作区）、`docker`、`github-actions` 每周更新，npm 按生产 / 开发依赖分组（组内只合并 minor + patch），每个生态 `open-pull-requests-limit: 5`，提交信息前缀 `chore(deps)`。
- 交付成熟度（Phase 6）：新增 8 篇架构决策记录（`docs/adr/0001`–`0008`，对应目标架构 D1–D8）与运维手册 `docs/operations.md`（数据目录布局、verify 步骤、探针清单、部署与健康检查、版本同步、备份恢复、故障排查）。
- 数据安全（Phase 1）：`StoreRegistry` 成为数据文件与目录的单一来源（`server/core/store/store-registry.ts`）；新增迁移框架（`migrations.ts` + `data/__meta.json` 的 `schema_version`），迁移前自动整目录备份并保留最近 5 份；provider 凭据（`secret_key` / `api_token`）改为 AES-256-GCM 加密落盘（`enc:v1:` 前缀，密钥为 `data/credential.key`），存量明文在启动迁移中自动加密。
- 可观测性（Phase 2）：日志级别默认 `info`，非法值 fail-fast；迁移、孤儿偏好清理、任务恢复、明文凭据升级等关键操作写入结构化日志。
- 契约（Phase 3）：前端经 `@server` 路径复用后端类型，类型漂移在编译期暴露。
- 快赢三项：优选域名白名单校验前置到任务创建（不再"任务创建成功、全员失败"）；新增隧道 repair 端点；隧道 `ensureCname` 补归属校验。
- 运行边界成文：README 新增「已知边界」章节，写明单实例运行、跨文件写入无事务、供应商缓存重启即空、无指标与追踪、无浏览器端到端测试、上游 404 折叠、副作用位于 `data` 下、持久化模式版本固定为 1 这八条约束，并说明「被打破时会发生什么」，而不只是罗列原则。

### 变更

- 结构重构（Phase 5a）：后端迁移为五顶层 `app / domains / workflows / kernel / lib` + `main.ts`（142 个文件移动、140 个文件导入重写）；架构守卫的层矩阵同步更新为 `app → workflows → modules → core → shared`，`version.mjs`、`knip.json`、`package.json` 入口一并调整。
- 共享底座（Phase 5b / D2）：抽出 `CloudflareAccess`（provider → 账号 → client 的唯一定义）与 `ZoneCatalog`（FQDN 最长后缀匹配 + DCV 委派），DNS / SaaS / 隧道三条产品线只依赖底座、互不引用；删除 `tunnel-account.ts`、`cloudflareClientFor`、`bestMatchId` 等重复路径。
- DNS 端口（Phase 5b / D1-1）：引入 `DnsRecordPort` 与 Cloudflare / DNSPod 适配器，厂商字段映射（`content`/`comment`、`subdomain`/`record_line`/`mx`）收敛到适配器；`dns-batch` 只依赖端口，删除厂商 body 构造器与逐厂商等值判定（`dns-batch.adapters.ts`、`dns-record-equivalence.ts`）。
- 契约层试点（D1 延续）：新增 `AccelerationDomainPort`（加速域名）与 `ZoneListPort`（站点目录）两个端口，EdgeOne 同步 / 批量工作流、归属取证与派生扫描改依赖端口而非模块服务类；模块服务显式 `implements` 端口，端口读模型取对外契约里的归一化字段（`name` / `cname` / `zone_id` / `status`），不暴露 SDK 原始字段。
- 命名对齐：`scripts/isolated-edgeone-*.ts` → `isolated-edge-one-*.ts`（与 server / web 的切分式 `edge-one` 拼写统一，探针输出标识一并跟随；`docs/operations.md` 同步更新）。
- 命名对齐：`server/modules/edgeone/` → `server/modules/edge-one/`（全仓最后一处"目录连写、文件却切分"的位置；目录内 11 个文件随目录整体移动，12 处 import / knip 路径同步，服务类名、任务 ID、错误码前缀等运行时标识符与数据取值不变）。
- CI：GHCR 镜像仅在推送 `v*` 标签时构建（日常提交只跑 `verify`），并校验标签版本与 `package.json` 一致。

### 移除

- 探针瘦身（Phase 4）：删除源码文本断言型探针（含 `isolated-functional-surface-probe.ts`，约 -233 行），全部行为探针保留。
- 摘掉 Phase 4 遗漏的两处「源码文本断言」残留及其同类项（读源码断言字符串出现：注释掉关键字照样通过、表格加一列却误报）：`scripts/reconcile-ui-wiring.test.ts`、`scripts/saas-repair-ui.test.ts`，以及 `status.test.ts` 里的表格结构用例。路由注册契约改由 `web/src/app/router/routes.test.ts` 直接断言导出的路由表（兜底路由、登录页 public、布局子路由含 sync/providers、`/p` 前缀与旧链接重定向）。
- 删除 `server/types/` 顶层：该层只有一个 12 行的 `fastify.d.ts` 模块增强，其内容本就是 HTTP 请求与路由配置的扩展，移入 `server/core/http/fastify.d.ts`；后端顶层由 6 个收敛为 5 个（守卫的层清单与布局样例同步更新）。

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
- 重构收尾（探针退役与门禁补全）：
  - 删除全部 `scripts/isolated-*.ts` 探针（26 个文件），断言逐条迁入 Vitest——48 → 94 个测试文件、260 → 560 个用例，`scripts` / `server` / `web` 三 project 分别对应架构守卫、后端 ESM 源码与 happy-dom 前端；`package.json` 移除全部 `probe:*` 脚本，`verify` 改为纯 Vitest 流程（`test` 覆盖 fixture 分支，`build` 之后由 `test:static` 覆盖真实构建产物）。
  - 门禁补全：`eslint` 覆盖范围补上 `scripts/**`（此前 `lint` 命令列出 scripts 却零覆盖，扩展后立即暴露架构守卫内的死变量）；清理 3 个随探针删除而失去消费者的孤儿导出与 `knip` 两处失效的忽略项。
  - 契约收紧：`core/contracts` 补齐领域联合类型与不变量——`DnsProviderType`、`DnsRecordStatus`、`SyncTarget`、`BatchScopeKey` 与 `JobType` + `ZONE_WRITE_SCOPE`（"哪些任务持有站点写锁"从注释约定变成编译期约束）；前端 `shared/api` 以 `ApiResult<T>` 加 `unwrapList` / `unwrapItem` 收口响应校验，取代各调用点就地断言。
  - 文件级拆分：`features/dns/lib/record-group.ts` 拆出 `record-purpose.ts`（用途判定），化解原文件用途 ↔ 聚组的双向依赖；`use-saas-hosts-panel.ts` 的 58 个返回键按职责分组；`planners/` 内 `saas-records.ts` / `saas-targets.ts` 更名为 `*.planner.ts`，与目录约定一致。
  - 测试临时目录不再堆积：新增 `vitest.global-setup.ts`，整轮结束后按运行前后快照删除本轮新建的 `dns-pro-*` 数据目录（`KEEP_TMP=1` 可保留失败现场）。

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
- EdgeOne 清空自定义回源 HOST 后回读被误判为「自定义」：真机实测确认上游把「清空」表达为回读加速域名自身（非空），前端原先按「非空即自定义」判定，用户清空后重新打开对话框会看到一个自己从未填过的 HOST，再次提交还会把「清空」误解成「自定义为域名自身」。
- 第五批审计修复（全仓精简，只读审计 437 个文件）：
  - 前端 15 处裸表查表在 key 为 `constructor` / `__proto__` 时会命中原型链，统一改走 `shared/lib/own-value.ts` 的 `ownValue()`；其中 `shared/api/transport-errors.ts` 用 `key in MAP` 更严重——`in` 不做小写归一，`'toString'` 会命中原型方法并把函数当作提示文案返回给用户。
  - `shared/lib/field-errors.ts` 对缺少 `message` 的服务端错误对象渲染出 `[object Object]`，改为丢弃该条（这类载荷本就没有可读文本）。
  - `features/tunnels/lib/status.ts` 缺 `trim()`，`' down '` 被判为「状态未知」；`features/providers/model/provider-config-items.ts` 顶层纯空白值会遮蔽 `fields` 里的有效值。
  - `vitest.global-setup.ts`：projects 模式下 `globalSetup` 按 project 各跑一次，先结束的 project 会删掉仍在运行的 project 正在使用的临时数据目录（表现为 fixture 登录 401/500），改为「延后一轮」删除。
  - `cloudflare.client.ts` 用 `as CloudflareApiResponse` 断言把上游网关返回的纯文本 / HTML 冒充成响应对象，调用方读 `.result` 恒为 `undefined` 却不报错，故障被显示成空数据；现在非对象一律按 502 `cloudflare_invalid_response` 拒绝。
  - `saas-targets.planner.ts` 两处同步站点来源未归一：`sync_zone` 由前端配置，带首尾空白时仍是 truthy，会绕过「空则退回后缀匹配」判定，拿脏值打一次必然失败的上游查询。
  - `.gitignore` 末条注释是 GBK 编码（全仓唯一的非 UTF-8 文件），重写为 UTF-8。
  - 测试规模 94 → 118 个文件、560 → 878 个用例：补齐此前零覆盖的 handler / planner / client（DNSPod 站点与线路、EdgeOne 站点与域名、Cloudflare SaaS 与 Tunnel、审计接口、SaaS 与 EdgeOne 派生计划器等）以及前端 12 个文件 102 个用例；同时修正 18 处「断言说谎」的既有测试——断言与实现同谋，或只断言调用次数而不断言语义。

## [1.1.0] - 2026-09-28

全量代码审计与重构版本：消除重复实现、清理死代码、修复请求期缺陷、统一工程约束。

### 新增

- 版本机制：根 `package.json` 为唯一版本源，`npm run version:sync` 同步至 `web/package.json` 与 `server/shared/version.ts`，`npm run version:check` 已接入 `npm run verify` 门禁，防止版本漂移。
- 前端版本注入：`web/vite.config.ts` 构建时注入 `__APP_VERSION__`（来源 `web/package.json`），页脚与登录会话的版本显示不再硬编码。
- web 工作区新增 `npm run lint`（`eslint src`）。
- 新增共享模块 `server/shared/providers/pagination.ts`：统一厂商分页护栏常量与比较语义。
- 新增共享模块 `server/shared/providers/response-guards.ts`：统一厂商响应载荷解析守卫。
- 新增共享模块 `server/shared/lib/fqdn.ts`：统一 FQDN 归一化。

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
