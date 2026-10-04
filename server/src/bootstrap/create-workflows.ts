import { dnsPodBatchPort, cloudflareBatchPort } from '../workflows/dns-batch/dns-batch.adapters.js'
import { DnsBatchWorkflow } from '../workflows/dns-batch/dns-batch.workflow.js'
import { EdgeOneBatchWorkflow } from '../workflows/edge-one-dns-sync/edge-one-batch.workflow.js'
import { EdgeOneDnsSyncWorkflow } from '../workflows/edge-one-dns-sync/edge-one-dns-sync.workflow.js'
import { ProviderDependencyWorkflow } from '../workflows/provider-management/provider-dependency.workflow.js'
import { ProviderManagementWorkflow } from '../workflows/provider-management/provider-management.workflow.js'
import { SaaSPreferredApplyWorkflow } from '../workflows/saas-dns-sync/preferred-apply.workflow.js'
import { SaaSBatchWorkflow } from '../workflows/saas-dns-sync/saas-batch.workflow.js'
import { SaaSDnsSyncCoordinator } from '../workflows/saas-dns-sync/saas-dns-sync.coordinator.js'
import { SaaSDnsSyncWorkflow } from '../workflows/saas-dns-sync/saas-dns-sync.workflow.js'
import type { AppModules } from './create-modules.js'
import type { AppPlatform } from './create-context.js'

/** 工作流装配：跨模块用例；批量工作流在构造时注册任务执行器 */
export function createWorkflows(platform: AppPlatform, modules: AppModules) {
  const { providers, saas, dnsPod, cloudflare, edgeOne } = modules

  const saasDnsSync = new SaaSDnsSyncWorkflow(
    saas.hostnames,
    saas.preferences,
    new SaaSDnsSyncCoordinator(
      saas.hostnames,
      saas.syncConfigs,
      dnsPod.recordSync,
      cloudflare.zones,
      cloudflare.records
    )
  )
  const edgeOneDnsSync = new EdgeOneDnsSyncWorkflow(edgeOne.domains, dnsPod.recordSync)

  return {
    providerManagement: new ProviderManagementWorkflow(
      providers.service,
      new ProviderDependencyWorkflow(providers.repository, saas.preferences),
      providers.connections,
      providers.integrity
    ),
    saasDnsSync,
    saasPreferredApply: new SaaSPreferredApplyWorkflow(platform.jobs, saasDnsSync, saas.hostnames),
    saasBatch: new SaaSBatchWorkflow(platform.jobs, saasDnsSync, saas.hostnames),
    dnsBatch: new DnsBatchWorkflow(platform.jobs, {
      dnspod: dnsPodBatchPort(dnsPod.records),
      cloudflare: cloudflareBatchPort(cloudflare.zones, cloudflare.records),
    }),
    edgeOneDnsSync,
    edgeOneBatch: new EdgeOneBatchWorkflow(platform.jobs, edgeOne.domains, edgeOneDnsSync),
  }
}
