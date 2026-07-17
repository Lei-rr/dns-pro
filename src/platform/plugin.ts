import type { AppPlugin, PluginContext } from '../kernel/contracts.js'
import { ServiceTokens } from '../kernel/contracts.js'
import { JobService } from './job/job-service.js'
import { auditService } from '../lib/utils/audit.js'
import { eventBus } from './events/event-bus.js'
import { registerEventSubscribers } from './events/subscribers.js'

/** Platform DI plugin — job / audit / events. */
export function createPlatformPlugin(jobService: JobService): AppPlugin {
  return {
    name: 'platform',
    version: '1',
    capabilities: ['jobs'],
    register(ctx: PluginContext) {
      registerEventSubscribers()
      ctx.set(ServiceTokens.JobPort, jobService)
      ctx.set(ServiceTokens.Audit, auditService)
      ctx.set(ServiceTokens.EventBus, eventBus)
    },
  }
}
