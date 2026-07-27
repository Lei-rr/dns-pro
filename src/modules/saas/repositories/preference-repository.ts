import { JsonStore } from '../../../lib/storage/json-store.js'

interface SaasPreferencesFile {
  items: Record<string, unknown>
}


export class SaasPreferenceRepository {
  constructor(private readonly store: JsonStore<SaasPreferencesFile>) {}

  async read(): Promise<SaasPreferencesFile> {
    return this.store.read()
  }

  async transaction<U>(
    mutator: (current: SaasPreferencesFile) => { next: SaasPreferencesFile; result?: U },
  ): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }
}
