import { PreferredDomainRepository, type PreferredDomain } from '../repositories/preferred-domain-repository.js'
import { ApiError } from '../../../lib/http/api-error.js'

export class PreferredDomainService {
  constructor(private readonly store: PreferredDomainRepository = new PreferredDomainRepository()) {}

  async list(): Promise<PreferredDomain[]> {
    const domains = await this.readDomains()
    return domains.map((domain, index) => ({ domain, sort: index }))
  }

  async create(domain: string): Promise<PreferredDomain> {
    const normalized = this.normalizeDomain(domain)

    await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      if (items.includes(normalized)) {
        throw new ApiError('preferred_domain_duplicate', `Preferred domain ${normalized} already exists`, 422)
      }
      items.push(normalized)
      return { next: { items } }
    })

    return { domain: normalized, sort: await this.indexOf(normalized) }
  }

  async rename(oldDomain: string, newDomain: string): Promise<PreferredDomain> {
    const normalizedNew = this.normalizeDomain(newDomain)
    const normalizedOld = oldDomain.toLowerCase().trim()

    await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      const index = this.requireIndex(normalizedOld, items)

      if (items[index] !== normalizedNew && items.includes(normalizedNew)) {
        throw new ApiError('preferred_domain_duplicate', `Preferred domain ${normalizedNew} already exists`, 422)
      }

      items[index] = normalizedNew
      return { next: { items } }
    })

    return { domain: normalizedNew, sort: await this.indexOf(normalizedNew) }
  }

  async delete(domain: string): Promise<void> {
    const normalized = domain.toLowerCase().trim()

    await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      const index = this.requireIndex(normalized, items)
      items.splice(index, 1)
      return { next: { items } }
    })
  }

  async reorder(domains: string[]): Promise<PreferredDomain[]> {
    await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      const seen = new Set<string>()
      const ordered: string[] = []

      for (const value of domains) {
        const domain = value.trim().toLowerCase()
        if (domain === '' || seen.has(domain)) continue
        if (items.includes(domain)) {
          ordered.push(domain)
          seen.add(domain)
        }
      }

      for (const domain of items) {
        if (!seen.has(domain)) ordered.push(domain)
      }

      return { next: { items: ordered } }
    })

    return this.list()
  }

  async isAllowed(domain: string): Promise<boolean> {
    const normalized = domain.trim().toLowerCase()
    if (normalized === '') return false
    const domains = await this.readDomains()
    return domains.includes(normalized)
  }

  private async readDomains(): Promise<string[]> {
    const file = await this.store.read()
    return this.normalizeItems(file.items)
  }

  private normalizeItems(items: unknown[] | undefined): string[] {
    if (!Array.isArray(items)) return []
    const normalized: string[] = []
    const seen = new Set<string>()

    for (const item of items) {
      const domain =
        typeof item === 'string'
          ? item.trim().toLowerCase()
          : String((item as Record<string, unknown> | undefined)?.domain ?? '').trim().toLowerCase()
      if (domain === '' || seen.has(domain)) continue
      seen.add(domain)
      normalized.push(domain)
    }

    return normalized
  }

  private normalizeDomain(domain: string): string {
    let value = domain.toLowerCase().trim()
    value = value.replace(/^[a-z]+:\/\//, '')
    value = value.split('/')[0] ?? value
    value = value.replace(/\.$/, '')

    if (value === '' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
      throw new ApiError('preferred_domain_invalid', `Invalid domain format: ${domain}`, 422)
    }

    return value
  }

  private requireIndex(domain: string, items: string[]): number {
    const index = items.indexOf(domain)
    if (index === -1) {
      throw new ApiError('preferred_domain_not_found', `Preferred domain ${domain} not found`, 404)
    }
    return index
  }

  private async indexOf(domain: string): Promise<number> {
    const domains = await this.readDomains()
    const index = domains.indexOf(domain)
    return index === -1 ? 0 : index
  }
}
