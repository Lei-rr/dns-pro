import { JsonStore } from '../../platform/storage/json-store.js'

interface SaaSPreferencesFile {
  items: Record<string, unknown>
}

export class SaaSPreferenceRepository {
  constructor(private readonly store: JsonStore<SaaSPreferencesFile>) {}

  async read(options: { fresh?: boolean } = {}): Promise<SaaSPreferencesFile> {
    return options.fresh ? this.store.readFresh() : this.store.read()
  }

  async transaction<U>(
    mutator: (current: SaaSPreferencesFile) => { next: SaaSPreferencesFile; result?: U }
  ): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }
}
