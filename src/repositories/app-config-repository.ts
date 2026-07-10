import { JsonStore } from '../support/json-store.js'

export interface AppConfig {
  auth: {
    username: string
    password: string
  }
}

const DEFAULT_CONFIG: AppConfig = {
  auth: { username: 'admin', password: 'admin' },
}

export class AppConfigRepository {
  private readonly store = new JsonStore<AppConfig>('config.json', DEFAULT_CONFIG)

  async read(): Promise<AppConfig> {
    return this.store.read()
  }
}
