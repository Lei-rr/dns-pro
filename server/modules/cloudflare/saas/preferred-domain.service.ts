import type { JsonStore } from '../../../core/store/json-store.js'

export interface PreferredDomain {
  domain: string
  sort: number
}

/** data/saas/preferred-domains.json：有序域名列表 */
export interface PreferredDomainsFile {
  items: string[]
}
import { ApiError } from '../../../core/http/api-error.js'

export class PreferredDomainService {
  constructor(private readonly store: JsonStore<PreferredDomainsFile>) {}

  async list(): Promise<PreferredDomain[]> {
    const domains = await this.readDomains()
    return domains.map((domain, index) => ({ domain, sort: index }))
  }

  async create(domain: string): Promise<PreferredDomain> {
    const normalized = this.normalizeDomain(domain)

    // 序号在事务内取：提交后再读列表，并发写入/删除会让序号错位甚至匹配不到
    const sort = await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      if (items.includes(normalized)) {
        throw new ApiError('preferred_domain_duplicate', `Preferred domain ${normalized} already exists`, 422)
      }
      items.push(normalized)
      return { next: { items }, result: items.length - 1 }
    })

    return { domain: normalized, sort: requireSort(sort) }
  }

  async rename(oldDomain: string, newDomain: string): Promise<PreferredDomain> {
    const normalizedNew = this.normalizeDomain(newDomain)
    const normalizedOld = oldDomain.toLowerCase().trim()

    const sort = await this.store.transaction((current) => {
      const items = this.normalizeItems(current.items)
      const index = this.requireIndex(normalizedOld, items)

      if (items[index] !== normalizedNew && items.includes(normalizedNew)) {
        throw new ApiError('preferred_domain_duplicate', `Preferred domain ${normalizedNew} already exists`, 422)
      }

      items[index] = normalizedNew
      return { next: { items }, result: index }
    })

    return { domain: normalizedNew, sort: requireSort(sort) }
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
          : String((item as Record<string, unknown> | undefined)?.domain ?? '')
              .trim()
              .toLowerCase()
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
}

/** 事务未回传序号说明写入根本没发生：宁可报错也不返回会伪装成「排在首位」的 0 */
function requireSort(sort: number | undefined): number {
  if (sort === undefined) {
    throw new ApiError('server_error', 'Preferred domain order was not resolved', 500)
  }
  return sort
}
