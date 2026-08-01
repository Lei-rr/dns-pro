import { ApiError } from '../../shared/http/api-error.js'
import type { PresentedProvider } from '../../modules/providers/provider.types.js'
import type { ProviderService } from '../../modules/providers/provider.service.js'
import type {
  ProviderConnectionResult,
  ProviderConnectionService,
} from '../../modules/providers/provider-connection.service.js'
import type { ProviderDependencyWorkflow } from './provider-dependency.workflow.js'
import type { ProviderIntegrity } from '../../modules/providers/provider-integrity.js'

/** API-facing provider orchestration: enrichment, delete protection and connection tests. */
export class ProviderManagementWorkflow {
  constructor(
    private readonly providers: ProviderService,
    private readonly dependencies: ProviderDependencyWorkflow,
    private readonly connections: ProviderConnectionService,
    private readonly integrity: ProviderIntegrity
  ) {}

  definitions() {
    return this.providers.definitions()
  }

  async list(): Promise<PresentedProvider[]> {
    return this.withDependencies(await this.providers.all())
  }

  async get(id: string): Promise<PresentedProvider | null> {
    const providers = await this.list()
    return providers.find((provider) => provider.id === id) ?? null
  }

  create(data: Record<string, unknown>): Promise<PresentedProvider> {
    return this.integrity.run(() => this.providers.create(data))
  }

  update(id: string, data: Record<string, unknown>): Promise<PresentedProvider> {
    return this.integrity.run(() => this.providers.update(id, data))
  }

  async delete(id: string): Promise<void> {
    await this.integrity.run(async () => {
      const providers = await this.providers.all({ fresh: true })
      const dependencies = await this.dependencies.forProvider(id, providers, { freshPreferences: true })
      if (dependencies.length > 0) {
        throw new ApiError('provider_in_use', 'Provider is still in use', 409, { dependencies })
      }
      await this.providers.delete(id)
    })
  }

  async sort(ids: string[]): Promise<PresentedProvider[]> {
    return this.withDependencies(await this.providers.sort(ids))
  }

  test(id: string): Promise<ProviderConnectionResult> {
    return this.connections.test(id)
  }

  private async withDependencies(providers: PresentedProvider[]): Promise<PresentedProvider[]> {
    const dependencyMap = await this.dependencies.map(providers)
    return providers.map((provider) => ({
      ...provider,
      dependencies: dependencyMap[provider.id] ?? [],
    }))
  }
}
