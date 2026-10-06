import fs from 'node:fs/promises'
import path from 'node:path'
import type { JsonStore } from '../../../core/store/json-store.js'
import type { AuthConfigData } from '../../../core/store/store-shapes.js'
import { storePath } from '../../../core/store/store-registry.js'
import { generatePassword, hashPassword } from '../../../core/security/password.js'
import { isErrorCode } from '../../../shared/values.js'

/** 形状权威在 store 注册表同层（各数据文件的形状清单）；此处再导出，既有导入路径不变 */
export type { AuthConfigData } from '../../../core/store/store-shapes.js'

export interface AuthState {
  username: string
  /** 用于校验的凭据材料（哈希优先） */
  credential: string
  /** 明文凭据（待升级时存在） */
  plaintext: string | null
  sessionEpoch: number
}

// 数据文件路径的权威在 store 注册表：首启写路径与 JsonStore 读路径共用同一来源
const CONFIG_FILE = storePath('auth')

/** 会话代次：非安全整数或负数一律归零，避免脏数据进入自增链 */
function normalizeEpoch(value: unknown): number {
  const epoch = Number(value ?? 0)
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0
}

/** 会话代次 +1（登出/改密时递增，使已签发会话全部失效） */
function nextSessionEpoch(value: unknown): number {
  return normalizeEpoch(value) + 1
}

/**
 * first run：生成随机初始密码，只落盘哈希；明文通过返回值交给启动日志输出。
 * 已存在配置时不做任何改动。
 */
export async function createInitialAuthConfig(dataDir: string): Promise<string | null> {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const password = generatePassword()
  const initial: AuthConfigData = { auth: { username: 'admin', password_hash: await hashPassword(password) } }
  try {
    await fs.writeFile(path.join(dataDir, CONFIG_FILE), `${JSON.stringify(initial, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    return password
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) return null
    throw error
  }
}

/** data/config.json：每次按磁盘最新内容读取，手工改密码无需重启 */
export class AuthConfigRepository {
  constructor(private readonly store: JsonStore<AuthConfigData>) {}

  async read(): Promise<AuthState> {
    const config = await this.store.readFresh()
    const hash = String(config.auth?.password_hash ?? '').trim()
    const plaintext = String(config.auth?.password ?? '')
    return {
      username: String(config.auth?.username ?? ''),
      credential: hash !== '' ? hash : plaintext,
      plaintext: plaintext !== '' ? plaintext : null,
      sessionEpoch: normalizeEpoch(config.session_epoch),
    }
  }

  /** 明文密码升级为哈希；返回是否发生变更 */
  async hashPlaintextCredential(): Promise<boolean> {
    const state = await this.read()
    if (!state.plaintext) return false
    await this.writeCredential(await hashPassword(state.plaintext))
    return true
  }

  /** 写入新密码哈希并吊销既有会话 */
  async setPassword(password: string): Promise<void> {
    await this.writeCredential(await hashPassword(password))
  }

  /** 会话代次 +1（保留文件其余内容） */
  async bumpSessionEpoch(): Promise<void> {
    await this.store.transaction((current) => {
      return { next: { ...current, session_epoch: nextSessionEpoch(current.session_epoch) } }
    })
  }

  private async writeCredential(passwordHash: string): Promise<void> {
    await this.store.transaction((current) => {
      const { password: _plaintext, ...auth } = current.auth ?? { username: '' }
      return {
        next: {
          ...current,
          auth: { ...auth, password_hash: passwordHash },
          session_epoch: nextSessionEpoch(current.session_epoch),
        },
      }
    })
  }
}
