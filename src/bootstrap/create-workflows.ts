import { CloudflareDnsBatchAdapter } from '../workflows/dns-batch/cloudflare-dns-batch.adapter.js'
import { DnsPodDnsBatchAdapter } from '../workflows/dns-batch/dns-pod-dns-batch.adapter.js'
import { DnsBatchJobWorkflow } from '../workflows/dns-batch/dns-batch.workflow.js'
import { EdgeOneBatchJobWorkflow } from '../workflows/edge-one-dns-sync/edge-one-batch.workflow.js'
import { EdgeOneDnsSyncWorkflow } from '../workflows/edge-one-dns-sync/edge-one-dns-sync.workflow.js'
import { ProviderDependencyWorkflow } from '../workflows/provider-management/provider-dependency.workflow.js'
import { ProviderManagementWorkflow } from '../workflows/provider-management/provider-management.workflow.js'
import { SaaSPreferredApplyWorkflow } from '../workflows/saas-dns-sync/preferred-apply.workflow.js'
import { SaaSBatchJobWorkflow } from '../workflows/saas-dns-sync/saas-batch.workflow.js'
import { SaaSDnsSyncCoordinator } from '../workflows/saas-dns-sync/saas-dns-sync.coordinator.js'
import { SaaSDnsSyncWorkflow } from '../workflows/saas-dns-sync/saas-dns-sync.workflow.js'
import type { AppModules } from './create-modules.js'
import type { AppPlatform } from './create-platform.js'

export function createWorkflows(platform: AppPlatform, modules: AppModules) {
  const providerManagement = new ProviderManagementWorkflow(
    modules.providers.service,
    new ProviderDependencyWorkflow(modules.providers.repository, modules.saas.preferences),
    modules.providers.connections,
    modules.providers.integrity
  )
  const saasDnsSync = new SaaSDnsSyncWorkflow(
    modules.saas.hostnames,
    modules.saas.preferences,
    new SaaSDnsSyncCoordinator(
      modules.providers.repository,
      modules.saas.hostnames,
      modules.dnsPod.recordOps,
      modules.cloudflare.zones,
      modules.cloudflare.records
    )
  )
  const edgeOneDnsSync = new EdgeOneDnsSyncWorkflow(
    modules.providers.repository,
    modules.edgeOne.domains,
    modules.dnsPod.recordOps
  )

  return {
    providerManagement,
    saasDnsSync,
    saasPreferredApply: new SaaSPreferredApplyWorkflow(platform.jobs, saasDnsSync, modules.saas.hostnames),
    saasBatch: new SaaSBatchJobWorkflow(platform.jobs, saasDnsSync, modules.saas.hostnames),
    dnsBatch: new DnsBatchJobWorkflow(platform.jobs, {
      dnspod: new DnsPodDnsBatchAdapter(modules.dnsPod.records),
      cloudflare: new CloudflareDnsBatchAdapter(modules.cloudflare.zones, modules.cloudflare.records),
    }),
    edgeOneDnsSync,
    edgeOneBatch: new EdgeOneBatchJobWorkflow(platform.jobs, modules.edgeOne.domains, edgeOneDnsSync),
  }
}

export type AppWorkflows = ReturnType<typeof createWorkflows>
