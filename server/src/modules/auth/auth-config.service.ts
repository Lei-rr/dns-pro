import crypto from 'node:crypto'
import { AppConfigRepository } from './auth-config.repository.js'
import { ApiError } from '../../shared/http/api-error.js'

function timingSafeEqualStr(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest()
  const hashB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

export class AuthConfig {
  constructor(private readonly repository: AppConfigRepository) {}

  async initialize(): Promise<void> {
    await this.repository.read()
  }

  async verifyCredentials(username: string, password: string): Promise<boolean> {
    const config = await this.repository.read()
    const expectedUser = config.auth?.username ?? ''
    const expectedPass = config.auth?.password ?? ''

    if (expectedUser === '' || expectedPass === '') {
      throw new ApiError(
        'server_error',
        'Authentication is not configured: data/config.json auth.username or auth.password is empty',
        500
      )
    }

    return timingSafeEqualStr(expectedUser, username) && timingSafeEqualStr(expectedPass, password)
  }

  async isDefaultCredential(): Promise<boolean> {
    const config = await this.repository.read()
    return (config.auth?.username ?? '') === 'admin' && (config.auth?.password ?? '') === 'admin'
  }
}
