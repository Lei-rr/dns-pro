import { cloudflareRecordPort } from '../domains/cloudflare/dns/cloudflare-record.adapter.js'
import { dnsPodRecordPort } from '../domains/dnspod/dns/dnspod-record.adapter.js'
import { DnsBatchWorkflow } from '../use-cases/dns-batch/dns-batch.workflow.js'
import { DnsWriter } from '../use-cases/derived-records/dns-writer.js'
import { edgeOneDerivedPlanner } from '../use-cases/derived-records/planners/edgeone.planner.js'
import { saasDerivedPlanner } from '../use-cases/derived-records/planners/saas.planner.js'
import { tunnelDerivedPlanner } from '../use-cases/derived-records/planners/tunnel.planner.js'
import { ReconcileService } from '../use-cases/derived-records/reconcile.service.js'
import { EdgeOneBatchWorkflow } from '../use-cases/edge-one-dns-sync/edge-one-batch.workflow.js'
import { EdgeOneDnsSyncWorkflow } from '../use-cases/edge-one-dns-sync/edge-one-dns-sync.workflow.js'
import { ProviderDependencyWorkflow } from '../use-cases/provider-management/provider-dependency.workflow.js'
import { ProviderManagementWorkflow } from '../use-cases/provider-management/provider-management.workflow.js'
import { SaaSPreferredApplyWorkflow } from '../use-cases/saas-dns-sync/preferred-apply.workflow.js'
import { SaaSBatchWorkflow } from '../use-cases/saas-dns-sync/saas-batch.workflow.js'
import { SaaSDnsSyncCoordinator } from '../use-cases/saas-dns-sync/saas-dns-sync.coordinator.js'
import { SaaSDnsSyncWorkflow } from '../use-cases/saas-dns-sync/saas-dns-sync.workflow.js'
import type { AppModules } from './modules.js'
import type { AppPlatform } from './context.js'

/** 工作流装配：跨模块用例；批量工作流在构造时注册任务执行器 */
export function createWorkflows(platform: AppPlatform, modules: AppModules) {
  const { providers, saas, dnsPod, cloudflare, edgeOne } = modules

  // 端口实例在手写装配处共享：批量任务、SaaS 同步与 D3 写入口用同一组适配器
  const dnsPorts = {
    dnspod: dnsPodRecordPort(dnsPod.records),
    cloudflare: cloudflareRecordPort(cloudflare.zones, cloudflare.records),
  }
  const dnsWriter = new DnsWriter(dnsPorts, modules.ownership)

  const saasDnsSync = new SaaSDnsSyncWorkflow(
    saas.hostnames,
    saas.preferences,
    new SaaSDnsSyncCoordinator(
      saas.hostnames,
      saas.syncConfigs,
      dnsPod.access,
      dnsPod.catalog,
      cloudflare.zones,
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
        syncConfigs: saas.syncConfigs,
        access: dnsPod.access,
        catalog: dnsPod.catalog,
        cloudflareZones: cloudflare.zones,
      }),
      tunnelDerivedPlanner({
        providers: providers.repository,
        tunnels: modules.tunnels.tunnels,
        routes: modules.tunnels.routes,
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
