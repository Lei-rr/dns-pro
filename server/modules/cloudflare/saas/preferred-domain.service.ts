import type { JsonStore } from '../../../core/store/json-store.js'
import type { PreferredDomainsFile } from '../../../core/store/store-shapes.js'
import { ApiError } from '../../../core/http/api-error.js'

interface PreferredDomain {
  domain: string
  sort: number
}

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
    // 查旧值必须与 create/isAllowed 共用同一份归一化：'x.com.' / 'https://x.com' 只在写入侧判真、
    // 在改名侧落到 404，会让用户看到「刚提交成功的域名却不存在」；归一化失败按不存在处理
    const normalizedOld = this.normalize(oldDomain) ?? ''

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
    // 同 rename：删除键与写入键必须等价，非法/空值统一落到 not_found（见 requireIndex）
    const normalized = this.normalize(domain) ?? ''

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
        // 与 create/rename/delete 共用归一化，避免带尾点、协议前缀等等价写法在排序时被静默忽略
        const domain = this.normalize(value) ?? ''
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

  /**
   * 归一化域名：去协议/路径/尾点、小写；格式非法返回 null。
   * 白名单写入侧（create/rename）与校验侧共用同一份归一化，避免 'https://x.com'、'x.com.' 这类
   * 等价写法在「写入」判真、在「能不能用」判假。
   */
  normalize(domain: string): string | null {
    try {
      return this.normalizeDomain(domain)
    } catch {
      return null
    }
  }

  async isAllowed(domain: string): Promise<boolean> {
    const normalized = this.normalize(domain)
    if (normalized === null || normalized === '') return false
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
      const raw = typeof item === 'string' ? item : String((item as Record<string, unknown> | undefined)?.domain ?? '')
      // 与写入/校验侧共用 normalizeDomain：存量未归一化条目（'x.com.'、'https://x.com'）不能
      // 只在写入侧判真、在读取侧判假；归一化失败（非法/为空）的条目直接丢弃
      const domain = this.normalize(raw)
      if (domain === null || domain === '') continue
      if (seen.has(domain)) continue
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
