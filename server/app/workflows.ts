import { cloudflareRecordPort } from '../modules/cloudflare/dns/cloudflare-record.adapter.js'
import { dnsPodRecordPort } from '../modules/dnspod/dns/dns-pod-record.adapter.js'
import { DnsBatchWorkflow } from '../workflows/dns-batch/dns-batch.workflow.js'
import { DnsWriter } from '../workflows/derived-records/dns-writer.js'
import { edgeOneDerivedPlanner } from '../workflows/derived-records/planners/edge-one.planner.js'
import { saasDerivedPlanner } from '../workflows/derived-records/planners/saas.planner.js'
import { tunnelDerivedPlanner } from '../workflows/derived-records/planners/tunnel.planner.js'
import { ReconcileService } from '../workflows/derived-records/reconcile.service.js'
import { EdgeOneBatchWorkflow } from '../workflows/edge-one-dns-sync/edge-one-batch.workflow.js'
import { EdgeOneDnsSyncWorkflow } from '../workflows/edge-one-dns-sync/edge-one-dns-sync.workflow.js'
import { ProviderDependencyWorkflow } from '../workflows/provider-management/provider-dependency.workflow.js'
import { ProviderManagementWorkflow } from '../workflows/provider-management/provider-management.workflow.js'
import { SaaSPreferredApplyWorkflow } from '../workflows/saas-dns-sync/preferred-apply.workflow.js'
import { SaaSBatchWorkflow } from '../workflows/saas-dns-sync/saas-batch.workflow.js'
import { SaaSDnsSyncCoordinator } from '../workflows/saas-dns-sync/saas-dns-sync.coordinator.js'
import { SaaSDnsSyncWorkflow } from '../workflows/saas-dns-sync/saas-dns-sync.workflow.js'
import type { AppModules } from './modules.js'
import type { AppPlatform } from './context.js'

/** 工作流装配：跨模块用例；批量工作流在构造时注册任务执行器 */
export function createWorkflows(platform: AppPlatform, domains: AppModules) {
  const { providers, saas, dnsPod, cloudflare, edgeOne } = domains

  // 端口实例在手写装配处共享：批量任务、SaaS 同步与 D3 写入口用同一组适配器
  const dnsPorts = {
    dnspod: dnsPodRecordPort(dnsPod.records),
    cloudflare: cloudflareRecordPort(cloudflare.zones, cloudflare.records),
  }
  const dnsWriter = new DnsWriter(dnsPorts, domains.ownership)

  const saasDnsSync = new SaaSDnsSyncWorkflow(
    saas.hostnames,
    saas.preferences,
    new SaaSDnsSyncCoordinator(
      saas.hostnames,
      saas.syncConfigs,
      dnsPod.access,
      dnsPod.catalog,
      cloudflare.catalog,
      dnsWriter
    )
  )
  const edgeOneDnsSync = new EdgeOneDnsSyncWorkflow(edgeOne.domains, dnsPod.access, dnsPod.catalog, dnsWriter)

  // §4.2 统一 reconcile 引擎：三条产品线的派生关系共用同一检测与执行入口
  const reconcile = new ReconcileService(
    [
      saasDerivedPlanner({
        providers: providers.repository,
        hostnames: saas.hostnames,
        syncDefaults: saas.syncConfigs,
        access: dnsPod.access,
        catalog: dnsPod.catalog,
        cloudflareZones: cloudflare.catalog,
      }),
      tunnelDerivedPlanner({
        providers: providers.repository,
        tunnels: domains.tunnels.tunnels,
        routes: domains.tunnels.routes,
        catalog: cloudflare.catalog,
      }),
      edgeOneDerivedPlanner({
        providers: providers.repository,
        zones: edgeOne.zones,
        domains: edgeOne.domains,
        catalog: dnsPod.catalog,
      }),
    ],
    dnsPorts,
    dnsWriter
  )

  return {
    providerManagement: new ProviderManagementWorkflow(
      providers.service,
      new ProviderDependencyWorkflow(providers.repository, saas.preferences),
      providers.connections,
      providers.integrity
    ),
    reconcile,
    saasDnsSync,
    saasPreferredApply: new SaaSPreferredApplyWorkflow(platform.jobs, saasDnsSync, saas.hostnames),
    saasBatch: new SaaSBatchWorkflow(platform.jobs, saasDnsSync, saas.hostnames),
    dnsBatch: new DnsBatchWorkflow(platform.jobs, dnsPorts),
    edgeOneDnsSync,
    edgeOneBatch: new EdgeOneBatchWorkflow(platform.jobs, edgeOne.domains, edgeOneDnsSync),
  }
}
