import { AppConfigRepository } from '../repositories/app-config-repository.js'
import { ApiError } from './api-error.js'

export class AppConfig {
  private cache: { username: string; password: string } | null = null

  constructor(private readonly repository: AppConfigRepository = new AppConfigRepository()) {}

  async authUsername(): Promise<string> {
    const auth = await this.auth()
    return auth.username
  }

  async authPassword(): Promise<string> {
    const auth = await this.auth()
    return auth.password
  }

  async verifyCredentials(username: string, password: string): Promise<boolean> {
    const expectedUser = await this.authUsername()
    const expectedPass = await this.authPassword()

    if (expectedUser === '' || expectedPass === '') {
      throw new ApiError('server_error', 'Authentication is not configured: data/config.json auth.username or auth.password is empty', 500)
    }

    return expectedUser === username && expectedPass === password
  }

  private async auth(): Promise<{ username: string; password: string }> {
    if (this.cache === null) {
      const config = await this.repository.read()
      this.cache = config.auth ?? { username: '', password: '' }
    }
    return this.cache
  }
}
