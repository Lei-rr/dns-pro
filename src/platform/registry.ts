import { ApiError } from '../lib/http/api-error.js'
import type { AppPlugin, PluginContext } from '../contracts/index.js'

/**
 * Lightweight service registry for modular plugin loading.
 * Progressive step toward full DI without rewriting every module.
 */
export class ServiceRegistry implements PluginContext {
  private readonly services = new Map<string, unknown>()

  set<T>(token: string, value: T): void {
    this.services.set(token, value)
  }

  get<T>(token: string): T | undefined {
    return this.services.get(token) as T | undefined
  }

  require<T>(token: string): T {
    const value = this.get<T>(token)
    if (value === undefined) {
      throw new ApiError('service_not_registered', `Service not registered: ${token}`, 500)
    }
    return value
  }

  has(token: string): boolean {
    return this.services.has(token)
  }

  async load(plugins: AppPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.register(this)
    }
  }
}

export const registry = new ServiceRegistry()
