import type { SecretBox } from '../crypto/secret-box.js'
import { JsonStore } from '../store/json-store.js'
import { ApiError } from '../http/api-error.js'
import { openProviderSecrets, sealProviderSecrets } from './provider-secrets.js'
import type { Provider, ProviderInput, ProviderType } from './provider.types.js'

export interface ProvidersFile {
  items: Provider[]
}

export class ProviderRepository {
  constructor(
    private readonly store: JsonStore<ProvidersFile>,
    private readonly secrets: SecretBox
  ) {}

  async all(options: { fresh?: boolean } = {}): Promise<Provider[]> {
    const data = options.fresh ? await this.store.readFresh() : await this.store.read()
    return this.requireItems(data).map((item) => openProviderSecrets(item, this.secrets))
  }

  async find(id: string): Promise<Provider | null> {
    const providers = await this.all()
    return providers.find((p) => p.id === id) ?? null
  }

  async requireType<T extends Provider>(id: string, type: ProviderType, message?: string, code?: string): Promise<T> {
    const provider = await this.find(id)
    if (!provider || provider.type !== type) {
      throw new ApiError(code ?? 'provider_not_found', message ?? 'Provider not found', 404)
    }
    return provider as T
  }

  async mutateAll(mutator: (current: Provider[]) => Provider[]): Promise<Provider[]> {
    const { saved } = await this.runTransaction((current) => ({ next: mutator(current), result: undefined }))
    return saved
  }

  /**
   * 与 mutateAll 相同的事务写，但把 mutator 的结果经事务通道透传：
   * 调用方不必用闭包副作用回收结果，避免事务跳过/重试时结果与落盘状态脱节。
   */
  async mutateAllWithResult<U>(
    mutator: (current: Provider[]) => { next: Provider[]; result: U }
  ): Promise<{ saved: Provider[]; result: U }> {
    return this.runTransaction(mutator)
  }

  /** 事务公共骨架：落盘密文，返回明文副本与 mutator 结果 */
  private async runTransaction<U>(
    mutator: (current: Provider[]) => { next: Provider[]; result: U }
  ): Promise<{ saved: Provider[]; result: U }> {
    const outcome = await this.store.transaction((current) => {
      const items = this.requireItems(current).map((item) => openProviderSecrets(item, this.secrets))
      const { next, result } = mutator(items)
      const plaintext = next.map((provider) => this.normalizeForStorage(provider))
      const sealed = plaintext.map((provider) => sealProviderSecrets(provider, this.secrets))
      // 落盘密文，返回值保持明文：mutator 与调用方的语义不变
      return { next: { items: sealed }, result: { saved: plaintext, result } }
    })
    if (outcome === undefined) {
      throw new ApiError('server_error', 'Provider transaction produced no result', 500)
    }
    return outcome
  }

  /**
   * 结构校验：`items` 必须是数组。
   * 文件被写成 `{}` 或 `items` 非数组时绝不能兜底成空表——读路径会静默返回空清单，
   * 写事务再按「整文件替换」把空表落盘，其余服务商连同 AES 密文凭据一并消失。
   * 因此按损坏处理：显式报错并要求人工修复，写事务在落盘前即被拒绝。
   */
  private requireItems(data: ProvidersFile): Provider[] {
    const items = (data as { items?: unknown } | null | undefined)?.items
    if (!Array.isArray(items)) {
      throw new ApiError('server_error', 'Corrupted providers.json: "items" must be an array', 500)
    }
    return items as Provider[]
  }

  private normalizeForStorage(provider: ProviderInput): Provider {
    const type = provider.type
    const head = {
      type,
      id: provider.id ?? '',
      name: provider.name ?? '',
    }
    const body: Record<string, unknown> = {}
    for (const field of Object.keys(provider)) {
      if (field === 'type' || field === 'id' || field === 'name') continue
      const value = (provider as Record<string, unknown>)[field]
      body[field] = typeof value === 'string' ? value : String(value ?? '')
    }
    return { ...head, ...body } as Provider
  }
}
