import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonStore } from '../support/json-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = path.resolve(__dirname, '../../data')

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
  private readonly store: JsonStore<PreferredDomainsFile>

  constructor() {
    void this.migrateLegacyFile('hostname/preferred-domains.json', 'saas/preferred-domains.json')
    this.store = new JsonStore<PreferredDomainsFile>('saas/preferred-domains.json', DEFAULT_PREFERRED_DOMAINS)
  }

  async read(): Promise<PreferredDomainsFile> {
    return this.store.read()
  }

  async transaction<U>(
    mutator: (current: PreferredDomainsFile) => { next: PreferredDomainsFile; result?: U }
  ): Promise<U | undefined> {
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
