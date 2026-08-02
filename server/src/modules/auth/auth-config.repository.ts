import fs from 'node:fs/promises'
import path from 'node:path'
import { JsonStore } from '../../platform/storage/json-store.js'

export interface AppConfigData {
  auth: {
    username: string
    password: string
  }
}

export const DEFAULT_APP_CONFIG: AppConfigData = {
  auth: { username: 'admin', password: 'admin' },
}

export async function ensureDefaultAppConfig(dataDir: string): Promise<void> {
  const filePath = path.join(dataDir, 'config.json')
  await fs.mkdir(dataDir, { recursive: true })
  try {
    const handle = await fs.open(filePath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(DEFAULT_APP_CONFIG, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return
    throw error
  }
}

export class AppConfigRepository {
  constructor(private readonly store: JsonStore<AppConfigData>) {}

  async read(): Promise<AppConfigData> {
    return this.store.read()
  }
}
