import type { ProviderService } from '../../provider/service.js'

/**
 * Thin application usecase for provider catalog mutations.
 */
export class ProviderMutationUseCase {
  constructor(private readonly providers: ProviderService) {}

  create(data: Record<string, unknown>) {
    return this.providers.create(data)
  }

  update(id: string, data: Record<string, unknown>) {
    return this.providers.update(id, data)
  }

  delete(id: string) {
    return this.providers.delete(id)
  }

  sort(order: string[]) {
    return this.providers.sort(order)
  }
}
