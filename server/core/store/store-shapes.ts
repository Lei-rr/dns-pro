import type { Provider } from '../providers/provider.types.js'

/**
 * 各数据文件的顶层形状清单：键与 store-registry 的 StoreName 一一对应。
 *
 * 定义在 core 而非各领域模块内，是因为注册表必须让「文件名 → 数据形状」在编译期绑定：
 * core 不得反向依赖 modules，形状类型只有先被注册表引用，注册表写错形状才会变成编译错误，
 * 而不是运行期才发现的静默错位。各领域仍从原文件导入同名类型并在那里再导出（导出面不变）。
 */

/** data/config.json */
export interface AuthConfigData {
  auth: {
    username: string
    /** 仅用于兼容手工编辑；启动时自动转换为 password_hash 并删除明文 */
    password?: string
    password_hash?: string
  }
  /** 会话代次：登出时递增，使所有已签发会话失效 */
  session_epoch?: number
}

/** data/providers.json */
export interface ProvidersFile {
  items: Provider[]
}

/** data/saas/preferred-domains.json：有序域名列表 */
export interface PreferredDomainsFile {
  items: string[]
}

/** data/saas/preferences.json */
export interface SaaSPreferencesFile {
  items: Record<string, unknown>
}
