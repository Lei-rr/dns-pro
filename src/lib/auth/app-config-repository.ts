import { JsonStore } from '../storage/json-store.js'

export interface AppConfigData {
  auth: {
    username: string
    password: string
  }
}

const DEFAULT_CONFIG: AppConfigData = {
  auth: { username: 'admin', password: 'admin' },
}

export class AppConfigRepository {
  constructor(
    private readonly store: JsonStore<AppConfigData> = new JsonStore<AppConfigData>('config.json', DEFAULT_CONFIG)
  ) {}

  async read(): Promise<AppConfigData> {
    return this.store.read()
  }
}
