# ADR-0005：StoreRegistry 作为存储单一数据源（单进程单数据目录）

- 状态：Accepted（主干已落地：注册表 + 迁移框架 + 凭据加密；写前 schema 校验与首启引导路径待收尾）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D5；落地提交 `e5fe9ab`（Phase 1）
- 相关代码：`server/core/store/store-registry.ts`、`server/core/store/migrations.ts`、`server/core/store/json-store.ts`、`server/main.ts`

## 背景

存储知识此前分散：数据目录硬编码在 `ensure-data-dirs.ts`；`config.json` 存在绕过 `JsonStore` 的第二写入路径；数据版本与迁移没有登记处，演进依赖代码里的容错分支；升级前没有自动备份。

同时必须正视部署边界：**一个进程独占一个数据目录**（`Dockerfile` 单进程、`compose.yaml` 单容器、数据卷挂载 `/app/data`）。这不是可选项，而是用户约束（个人项目，不引入数据库 / 队列 / 分布式锁）。

## 决策

1. **注册表即清单**：`store-registry.ts` 登记全部持久化文件（相对路径、默认值、写入形态），`createStore(name)` 是唯一构造入口，数据子目录由 `storeSubdirectories()` 派生（`main.ts:15`），删除目录硬编码。
2. **写入经 `JsonStore`**：同一路径串行队列 + 临时文件 + `fsync` + `rename` 原子替换，权限 0600；损坏 JSON 报错而不静默覆盖。
3. **迁移注册表**：`migrations.ts` 以 `data/__meta.json` 的 `schema_version` 判定待执行迁移，迁移前整目录备份（`core/backup/`，保留最近 5 份），每个迁移必须幂等；失败不推进版本，下次启动重跑。
4. **凭据加密**：provider 秘密字段（`secret_key` / `api_token`）以 AES-256-GCM 落盘（`enc:v1:` 前缀），密钥为数据目录内 `credential.key`；启动迁移自动加密存量明文。
5. **明确不做**：不引入分布式锁 / 租约 / fencing / 多写者协议；多实例需求出现时应改用标准外部数据库或队列，而不是扩展本地 JSON 基础设施。

## 后果

正面：

- 新增数据文件只改注册表一处，目录、迁移判定、备份范围自动跟随。
- 升级有自动备份兜底，迁移失败可安全重跑。
- 磁盘泄露不再等于凭据全失守；解密失败显式报错（`credential_decrypt_failed`），绝不静默降级为空值。
- 单写者假设被写进代码而非口头约定，避免"顺手加锁"式的复杂度膨胀。

负面：

- 注册表成为所有持久化的必经之路：注册表出错影响面大，需要探针覆盖（`probe:platform`、`probe:data-migration`）。
- 写前 schema 校验尚未内建（`StoreDef.schema` 未实现），类型约束只在编译期。
- 首启引导路径 `createInitialAuthConfig` 仍以 `fs.writeFile(..., { flag: 'wx' })` 直接创建 `config.json`（语义是"仅当不存在时创建"，不是第二写入路径），但确实绕过了 `JsonStore`，属于待收尾项。
- 单实例边界意味着不能横向扩容；这是有意选择，不是缺陷。

## 替代方案

- **引入数据库 / ORM**：否决。用户约束明确，且单用户规模下 JSON 足够。
- **各模块自管文件路径与目录**：否决。已验证会漂移（目录硬编码、第二写入路径）。
- **迁移时原地修改不做备份**：否决。数据安全优先，备份成本远低于丢数据。
- **为多实例预留锁协议**：否决。为不存在的需求引入分布式复杂度，违反复杂度预算。

## 验证

`npm run probe:platform`、`npm run probe:data-migration`、`npm run probe:credential-encryption`、`npm run probe:sensitive-files` 覆盖原子写、迁移、加密与文件权限。
