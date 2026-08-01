import { JsonStore } from '../../platform/storage/json-store.js'

export interface PreferredDomain {
  domain: string
  sort: number
  [key: string]: unknown
}

interface PreferredDomainsFile {
  items: string[]
}

export class PreferredDomainRepository {
  constructor(private readonly store: JsonStore<PreferredDomainsFile>) {}

  async read(): Promise<PreferredDomainsFile> {
    return this.store.read()
  }

  async transaction<U>(
    mutator: (current: PreferredDomainsFile) => { next: PreferredDomainsFile; result?: U }
  ): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }
}
