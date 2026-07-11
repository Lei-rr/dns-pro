import { JsonStore } from '../../../lib/storage/json-store.js'

export interface PreferredDomain {
  domain: string
  sort: number
  [key: string]: unknown
}

interface PreferredDomainsFile {
  items: string[]
}

const DEFAULT_PREFERRED_DOMAINS: PreferredDomainsFile = { items: [] }

export class PreferredDomainRepository {
  constructor(
    private readonly store: JsonStore<PreferredDomainsFile> = new JsonStore<PreferredDomainsFile>(
      'saas/preferred-domains.json',
      DEFAULT_PREFERRED_DOMAINS
    )
  ) {}

  async read(): Promise<PreferredDomainsFile> {
    return this.store.read()
  }

  async transaction<U>(
    mutator: (current: PreferredDomainsFile) => { next: PreferredDomainsFile; result?: U }
  ): Promise<U | undefined> {
    return this.store.transaction(mutator)
  }
}
