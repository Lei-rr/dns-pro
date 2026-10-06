import path from 'node:path'
import { JsonStore } from './json-store.js'
import type { AuthConfigData, PreferredDomainsFile, ProvidersFile, SaaSPreferencesFile } from './store-shapes.js'

/** StoreName → 数据形状 的唯一映射：createStore 由名字推导返回类型，调用点不再手写泛型 */
type StoreShapes = {
  auth: AuthConfigData
  providers: ProvidersFile
  preferredDomains: PreferredDomainsFile
  saasPreferences: SaaSPreferencesFile
}

type StoreName = keyof StoreShapes

/** 数据文件规格：路径 + 默认值。defaults 必须匹配 StoreShapes 声明的形状，写错形状在这里就编译失败 */
interface StoreSpec<K extends StoreName> {
  readonly path: string
  readonly defaults: StoreShapes[K]
}

/**
 * JsonStore 管理的业务数据文件登记表；新增业务数据文件必须在此登记（建目录由此派生）。
 * 键集由 StoreShapes 决定：漏登记、多登记、形状与 defaults 不一致都在编译期报错，
 * 路径与形状不再各说各话。credential.key、session-secret、__meta.json、backups/ 等
 * 运行时文件由各自模块直接读写，既不在此表内，也不参与建目录与迁移判定。
 */
const storeSpecs: { [K in StoreName]: StoreSpec<K> } = {
  auth: { path: 'config.json', defaults: { auth: { username: '' } } },
  providers: { path: 'providers.json', defaults: { items: [] } },
  preferredDomains: { path: 'saas/preferred-domains.json', defaults: { items: [] } },
  saasPreferences: { path: 'saas/preferences.json', defaults: { items: {} } },
}

/** 按注册表创建 store；数据根由装配层传入，形状由 StoreName 推导，不再由调用方声明 */
export function createStore<K extends StoreName>(name: K, dataRoot: string): JsonStore<StoreShapes[K]> {
  const spec = storeSpecs[name]
  return new JsonStore(spec.path, spec.defaults, dataRoot)
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
