import type { AppPlugin, PluginContext } from '../contracts/index.js'
import { ServiceTokens } from '../contracts/index.js'
import { JobService } from './job/job-service.js'
import { auditService } from '../lib/utils/audit.js'
import { backupService } from '../lib/utils/backup.js'
import { eventBus } from './events/event-bus.js'
import { registerEventSubscribers } from './events/subscribers.js'

export function createPlatformPlugin(jobService: JobService): AppPlugin {
  return {
    name: 'platform',
    version: '1',
    register(ctx: PluginContext) {
      registerEventSubscribers()
      ctx.set(ServiceTokens.JobPort, jobService)
      ctx.set(ServiceTokens.Audit, auditService)
      ctx.set(ServiceTokens.Backup, backupService)
      ctx.set(ServiceTokens.EventBus, eventBus)
    },
  }
}
