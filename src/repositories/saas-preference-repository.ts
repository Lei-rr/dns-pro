import { JsonStore } from '../support/json-store.js'

interface SaasPreferencesFile {
  items: Record<string, unknown>
}

const DEFAULT_PREFERENCES: SaasPreferencesFile = { items: {} }

export class SaasPreferenceRepository {
  constructor(
    private readonly store: JsonStore<SaasPreferencesFile> = new JsonStore<SaasPreferencesFile>(
      'saas/preferences.json',
      DEFAULT_PREFERENCES
    )
  ) {}

  async read(): Promise<SaasPreferencesFile> {
    return this.store.read()
  }

  async transaction<U>(mutator: (current: SaasPreferencesFile) => { next: SaasPreferencesFile; result?: U }): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }
}
