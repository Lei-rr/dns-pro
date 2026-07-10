import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonStore } from '../support/json-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = path.resolve(__dirname, '../../data')

interface SaasPreferencesFile {
  items: Record<string, unknown>
}

const DEFAULT_PREFERENCES: SaasPreferencesFile = { items: {} }

export class SaasPreferenceRepository {
  private readonly store: JsonStore<SaasPreferencesFile>

  constructor() {
    void this.migrateLegacyFile('hostname/preferences.json', 'saas/preferences.json')
    this.store = new JsonStore<SaasPreferencesFile>('saas/preferences.json', DEFAULT_PREFERENCES)
  }

  async read(): Promise<SaasPreferencesFile> {
    return this.store.read()
  }

  async transaction<U>(mutator: (current: SaasPreferencesFile) => { next: SaasPreferencesFile; result?: U }): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }

  private async migrateLegacyFile(legacyRelativePath: string, targetRelativePath: string): Promise<void> {
    const legacyPath = path.resolve(DATA_ROOT, legacyRelativePath)
    const targetPath = path.resolve(DATA_ROOT, targetRelativePath)

    try {
      await fs.access(legacyPath)
    } catch {
      return
    }

    try {
      await fs.access(targetPath)
      return
    } catch {
      // target does not exist, proceed with migration
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.rename(legacyPath, targetPath)
  }
}
