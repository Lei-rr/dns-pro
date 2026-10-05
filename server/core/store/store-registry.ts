import path from 'node:path'
import { JsonStore } from './json-store.js'

/** 数据文件规格：路径、默认值的唯一来源 */
interface StoreSpec {
  readonly path: string
  readonly defaults: Record<string, unknown>
}

/**
 * JsonStore 管理的业务数据文件登记表；新增业务数据文件必须在此登记（建目录由此派生）。
 * credential.key、session-secret、__meta.json、backups/ 等运行时文件由各自模块直接读写，
 * 既不在此表内，也不参与建目录与迁移判定。
 */
const storeSpecs = {
  auth: { path: 'config.json', defaults: { auth: { username: '' } } },
  providers: { path: 'providers.json', defaults: { items: [] } },
  preferredDomains: { path: 'saas/preferred-domains.json', defaults: { items: [] } },
  saasPreferences: { path: 'saas/preferences.json', defaults: { items: {} } },
} satisfies Record<string, StoreSpec>

export type StoreName = keyof typeof storeSpecs

/** 按注册表创建 store；数据根由装配层传入，调用方以类型参数声明自己的数据形状 */
export function createStore<T extends object>(name: StoreName, dataRoot: string): JsonStore<T> {
  const spec: StoreSpec = storeSpecs[name]
  return new JsonStore<T>(spec.path, spec.defaults as T, dataRoot)
}

/** 注册表派生的数据子目录（相对 data 根），供启动建目录 */
export function storeSubdirectories(): string[] {
  const directories = Object.values(storeSpecs)
    .map((spec) => path.posix.dirname(spec.path))
    .filter((directory) => directory !== '.')
  return [...new Set(directories)]
}

/** 全部数据文件相对路径（迁移判定现有数据用） */
export function storePaths(): string[] {
  return Object.values(storeSpecs).map((spec) => spec.path)
}

/**
 * 单个数据文件的相对路径。
 * 供需要自行读写该文件的模块复用（例如首启以 wx 独占创建 config.json），
 * 使读路径、写路径与报错文案共用同一权威，避免改路径时漏改其中一处。
 */
export function storePath(name: StoreName): string {
  return storeSpecs[name].path
}
