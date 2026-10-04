import fs from 'node:fs/promises'
import path from 'node:path'
import type { JsonStore } from '../../platform/storage/json-store.js'
import { generatePassword, hashPassword } from '../../shared/auth/password.js'

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

export interface AuthState {
  username: string
  /** 用于校验的凭据材料（哈希优先） */
  credential: string
  /** 明文凭据（待升级时存在） */
  plaintext: string | null
  sessionEpoch: number
}

const CONFIG_FILE = 'config.json'

/**
 * first run：生成随机初始密码，只落盘哈希；明文通过返回值交给启动日志输出。
 * 已存在配置时不做任何改动。
 */
export async function createInitialAuthConfig(dataDir: string): Promise<string | null> {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const password = generatePassword()
  const initial: AuthConfigData = { auth: { username: 'admin', password_hash: hashPassword(password) } }
  try {
    await fs.writeFile(path.join(dataDir, CONFIG_FILE), `${JSON.stringify(initial, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    return password
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return null
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
    const epoch = Number(config.session_epoch ?? 0)
    return {
      username: String(config.auth?.username ?? ''),
      credential: hash !== '' ? hash : plaintext,
      plaintext: plaintext !== '' ? plaintext : null,
      sessionEpoch: Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0,
    }
  }

  /** 明文密码升级为哈希；返回是否发生变更 */
  async hashPlaintextCredential(): Promise<boolean> {
    const state = await this.read()
    if (!state.plaintext) return false
    await this.writeCredential(hashPassword(state.plaintext))
    return true
  }

  /** 写入新密码哈希并吊销既有会话 */
  async setPassword(password: string): Promise<void> {
    await this.writeCredential(hashPassword(password))
  }

  /** 会话代次 +1（保留文件其余内容） */
  async bumpSessionEpoch(): Promise<void> {
    await this.store.transaction((current) => {
      const epoch = Number(current.session_epoch ?? 0)
      return { next: { ...current, session_epoch: (Number.isSafeInteger(epoch) ? epoch : 0) + 1 } }
    })
  }

  private async writeCredential(passwordHash: string): Promise<void> {
    await this.store.transaction((current) => {
      const { password: _plaintext, ...auth } = current.auth ?? { username: '' }
      const epoch = Number(current.session_epoch ?? 0)
      return {
        next: {
          ...current,
          auth: { ...auth, password_hash: passwordHash },
          session_epoch: (Number.isSafeInteger(epoch) ? epoch : 0) + 1,
        },
      }
    })
  }
}
