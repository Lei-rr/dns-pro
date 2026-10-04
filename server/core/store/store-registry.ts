import path from 'node:path'
import { JsonStore } from './json-store.js'

/** 数据文件规格：路径、默认值的唯一来源 */
interface StoreSpec {
  readonly path: string
  readonly defaults: Record<string, unknown>
}

/** 全部持久化文件登记表；新增数据文件必须在此登记（建目录由此派生） */
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
