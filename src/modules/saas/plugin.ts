import type { AppPlugin, PluginContext } from '../../contracts/index.js'
import type { JobService } from '../../platform/job/job-service.js'
import type { SaasWorkflowService } from './services/workflow-service.js'
import type { SaasHostnameService } from './services/hostname-service.js'
import { SaasPreferredApplyService } from './services/preferred-apply-service.js'
import { SaasBatchJobService } from './services/batch-job-service.js'

export const SaasServiceTokens = {
  PreferredApply: 'svc.saas.preferred_apply',
  BatchJob: 'svc.saas.batch_job',
  Workflow: 'svc.saas.workflow',
  Hostnames: 'svc.saas.hostnames',
} as const

export function createSaasPlugin(input: {
  jobs: JobService
  workflow: SaasWorkflowService
  hostnames: SaasHostnameService
  preferredApply?: SaasPreferredApplyService
  batchJob?: SaasBatchJobService
}): AppPlugin {
  return {
    name: 'saas',
    version: '1',
    capabilities: ['saas_hostnames'],
    register(ctx: PluginContext) {
      const preferredApply =
        input.preferredApply ??
        new SaasPreferredApplyService(input.jobs, input.workflow, input.hostnames)
      const batchJob = input.batchJob ?? new SaasBatchJobService(input.jobs, input.workflow)
      ctx.set(SaasServiceTokens.PreferredApply, preferredApply)
      ctx.set(SaasServiceTokens.BatchJob, batchJob)
      ctx.set(SaasServiceTokens.Workflow, input.workflow)
      ctx.set(SaasServiceTokens.Hostnames, input.hostnames)
    },
  }
}
