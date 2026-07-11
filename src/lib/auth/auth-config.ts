import { AppConfigRepository } from './app-config-repository.js'
import { ApiError } from '../http/api-error.js'

export class AuthConfig {
  constructor(private readonly repository: AppConfigRepository = new AppConfigRepository()) {}

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

    return expectedUser === username && expectedPass === password
  }
}
