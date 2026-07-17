import type { AppPlugin, PluginContext } from '../../kernel/index.js'
import type { EdgeOneZoneService } from './services/zone-service.js'
import type { EdgeOneDomainService } from './services/domain-service.js'
import type { EdgeOneWorkflowService } from './services/workflow-service.js'
import type { EdgeOneBatchJobService } from './services/batch-job-service.js'
import { eventBus } from '../../platform/events/event-bus.js'

export const EdgeOneServiceTokens = {
  Zones: 'svc.edgeone.zones',
  Domains: 'svc.edgeone.domains',
  Workflow: 'svc.edgeone.workflow',
  BatchJob: 'svc.edgeone.batch_job',
} as const

export async function emitEdgeDomainMutated(input: {
  providerId: string
  zoneId: string
  domainName?: string
  action: string
}) {
  await eventBus.emit({
    type: 'edge.domain.mutated',
    provider_id: input.providerId,
    zone: input.zoneId,
    hostname: input.domainName,
    action: `edgeone.domain.${input.action}`,
    cache_tags: [`edgeone:domains:${input.providerId}:${input.zoneId}`, `edgeone:zones:${input.providerId}`],
  })
}

export function createEdgeOnePlugin(input: {
  zones: EdgeOneZoneService
  domains: EdgeOneDomainService
  workflow: EdgeOneWorkflowService
  batchJob?: EdgeOneBatchJobService
}): AppPlugin {
  return {
    name: 'edgeone',
    version: '1',
    capabilities: ['edge_domains'],
    register(ctx: PluginContext) {
      ctx.set(EdgeOneServiceTokens.Zones, input.zones)
      ctx.set(EdgeOneServiceTokens.Domains, input.domains)
      ctx.set(EdgeOneServiceTokens.Workflow, input.workflow)
      if (input.batchJob) ctx.set(EdgeOneServiceTokens.BatchJob, input.batchJob)
    },
  }
}
