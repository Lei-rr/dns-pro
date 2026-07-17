import type { ProviderService } from '../../provider/service.js'
import { runMutation } from '../../../platform/usecase/run-mutation.js'

/**
 * Thin application usecase for provider catalog mutations.
 * create/update/delete already emit via ProviderService; sort is covered here.
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
    return runMutation(
      {
        type: 'provider.mutated',
        action: 'provider.sort',
        meta: { count: order.length },
      },
      () => this.providers.sort(order),
    )
  }
}
