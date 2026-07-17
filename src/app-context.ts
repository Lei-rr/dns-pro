import type { AppConfig } from './config/app.js'
import { AppConfigRepository } from './lib/auth/app-config-repository.js'
import { AuthConfig } from './lib/auth/auth-config.js'
import { SessionService } from './modules/auth/service.js'
import { ProviderRepository } from './modules/provider/repository.js'
import { ProviderNormalizer } from './modules/provider/normalizer.js'
import { ProviderPresenter } from './modules/provider/presenter.js'
import { ProviderService } from './modules/provider/service.js'
import { PreferredDomainRepository } from './modules/saas/repositories/preferred-domain-repository.js'
import { SaasPreferenceRepository } from './modules/saas/repositories/preference-repository.js'
import { PreferredDomainService } from './modules/saas/services/preferred-domain-service.js'
import { SaasPreferenceService } from './modules/saas/services/preference-service.js'
import { SaasPreferredApplyService } from './modules/saas/services/preferred-apply-service.js'
import { SaasBatchJobService } from './modules/saas/services/batch-job-service.js'
import { DnsBatchJobService } from './modules/common/services/dns-batch-job-service.js'
import { CloudflareZoneService } from './modules/cloudflare/services/zone-service.js'
import { CloudflareDnsRecordService } from './modules/cloudflare/services/dns-record-service.js'
import { DnsPodZoneService } from './modules/dnspod/services/zone-service.js'
import { DnsPodRecordService } from './modules/dnspod/services/record-service.js'
import { CloudflareCustomHostnameGateway } from './modules/saas/gateways/custom-hostname-gateway.js'
import { SaasHostnameService } from './modules/saas/services/hostname-service.js'
import { DnsPodRecordOps } from './modules/sync/services/dnspod-record-ops.js'
import { SyncOrchestrator } from './modules/sync/services/sync-orchestrator.js'
import { SaasWorkflowService } from './modules/saas/services/workflow-service.js'
import { EdgeOneZoneService } from './modules/edgeone/services/zone-service.js'
import { EdgeOneDomainService } from './modules/edgeone/services/domain-service.js'
import { EdgeOneWorkflowService } from './modules/edgeone/services/workflow-service.js'
import { CloudflaredTunnelService } from './modules/cloudflared/services/tunnel-service.js'
import { CloudflaredDnsService } from './modules/cloudflared/services/dns-service.js'
import { CloudflaredRouteService } from './modules/cloudflared/services/route-service.js'
import { ServiceRegistry } from './platform/registry.js'
import { createPlatformPlugin } from './platform/plugin.js'
import { createSyncPlugin } from './modules/sync/plugin.js'
import { createDnsPodPlugin } from './modules/dnspod/plugin.js'
import { createCloudflarePlugin } from './modules/cloudflare/plugin.js'
import { createSaasPlugin } from './modules/saas/plugin.js'
import { createEdgeOnePlugin } from './modules/edgeone/plugin.js'
import { createCloudflaredPlugin } from './modules/cloudflared/plugin.js'
import { EdgeOneBatchJobService } from './modules/edgeone/services/batch-job-service.js'
import { DnsRecordMutationUseCase } from './modules/common/usecases/dns-record-mutation-usecase.js'
import { SaasHostnameMutationUseCase } from './modules/common/usecases/saas-hostname-mutation-usecase.js'
import { DnsZoneMutationUseCase } from './modules/common/usecases/dns-zone-mutation-usecase.js'
import { ProviderMutationUseCase } from './modules/common/usecases/provider-mutation-usecase.js'
import { EdgeOneDomainMutationUseCase } from './modules/common/usecases/edgeone-domain-mutation-usecase.js'
import { TunnelMutationUseCase } from './modules/common/usecases/tunnel-mutation-usecase.js'
import { JobService } from './platform/job/job-service.js'
import type { SyncPort } from './contracts/index.js'

/**
 * Compose application services and load platform plugins.
 *
 * Progressive modularization:
 * - concrete services still assembled here for Fastify ctx compatibility
 * - ports / job runners / events are registered via plugins
 * - new read paths should resolve ports from registry
 */
export function createAppContext(config: AppConfig) {
  const registry = new ServiceRegistry()

  const appConfigRepository = new AppConfigRepository()
  const authConfig = new AuthConfig(appConfigRepository)
  const sessionService = new SessionService(authConfig)

  const providerRepository = new ProviderRepository()
  const preferredDomainRepository = new PreferredDomainRepository()
  const saasPreferenceRepository = new SaasPreferenceRepository()

  const preferredDomainService = new PreferredDomainService(preferredDomainRepository)
  const saasPreferenceService = new SaasPreferenceService(saasPreferenceRepository)

  const providerService = new ProviderService(
    providerRepository,
    new ProviderNormalizer(),
    new ProviderPresenter(),
    saasPreferenceService,
  )

  const cloudflareZoneService = new CloudflareZoneService(providerRepository)
  const cloudflareDnsRecordService = new CloudflareDnsRecordService(providerRepository)
  const dnspodZoneService = new DnsPodZoneService(providerRepository)
  const dnspodRecordService = new DnsPodRecordService(providerRepository)

  const customHostnameGateway = new CloudflareCustomHostnameGateway(providerRepository)
  const saasHostnameService = new SaasHostnameService(
    providerRepository,
    cloudflareZoneService,
    customHostnameGateway,
    preferredDomainService,
    saasPreferenceService,
  )
  const dnsPodRecordOps = new DnsPodRecordOps(providerRepository, dnspodZoneService, dnspodRecordService)
  const syncOrchestrator = new SyncOrchestrator(
    providerRepository,
    saasHostnameService,
    dnsPodRecordOps,
    cloudflareZoneService,
    cloudflareDnsRecordService,
  )
  const saasWorkflowService = new SaasWorkflowService(saasHostnameService, saasPreferenceService, syncOrchestrator)

  const edgeoneZoneService = new EdgeOneZoneService(providerRepository)
  const edgeoneDomainService = new EdgeOneDomainService(providerRepository)
  const edgeoneWorkflowService = new EdgeOneWorkflowService(edgeoneDomainService, syncOrchestrator)

  const jobService = new JobService()
  const saasPreferredApplyService = new SaasPreferredApplyService(
    jobService,
    saasWorkflowService,
    saasHostnameService,
  )
  const saasBatchJobService = new SaasBatchJobService(jobService, saasWorkflowService)
  const dnsBatchJobService = new DnsBatchJobService(jobService, {
    dnspod: dnspodRecordService,
    cloudflare: cloudflareDnsRecordService,
  })
  const edgeoneBatchJobService = new EdgeOneBatchJobService(
    jobService,
    edgeoneDomainService,
    edgeoneWorkflowService,
  )
  const dnsRecordMutationUseCase = new DnsRecordMutationUseCase(
    dnspodRecordService,
    cloudflareDnsRecordService,
    cloudflareZoneService,
  )
  const saasHostnameMutationUseCase = new SaasHostnameMutationUseCase(saasWorkflowService)
  const dnsZoneMutationUseCase = new DnsZoneMutationUseCase(dnspodZoneService, cloudflareZoneService)
  const providerMutationUseCase = new ProviderMutationUseCase(providerService)
  const edgeOneDomainMutationUseCase = new EdgeOneDomainMutationUseCase(
    edgeoneDomainService,
    edgeoneWorkflowService,
  )

  const cloudflaredTunnelService = new CloudflaredTunnelService(providerRepository)
  const cloudflaredDnsService = new CloudflaredDnsService(cloudflareZoneService, cloudflareDnsRecordService)
  const cloudflaredRouteService = new CloudflaredRouteService(
    providerRepository,
    cloudflareZoneService,
    cloudflaredDnsService,
  )
  const tunnelMutationUseCase = new TunnelMutationUseCase(cloudflaredTunnelService, cloudflaredRouteService)

  void registry.load([
    createPlatformPlugin(jobService),
    createSyncPlugin(syncOrchestrator as unknown as SyncPort),
    createDnsPodPlugin(dnspodZoneService, dnspodRecordService),
    createCloudflarePlugin(cloudflareZoneService, cloudflareDnsRecordService),
    createSaasPlugin({
      jobs: jobService,
      workflow: saasWorkflowService,
      hostnames: saasHostnameService,
      preferredApply: saasPreferredApplyService,
      batchJob: saasBatchJobService,
    }),
    createEdgeOnePlugin({
      zones: edgeoneZoneService,
      domains: edgeoneDomainService,
      workflow: edgeoneWorkflowService,
      batchJob: edgeoneBatchJobService,
    }),
    createCloudflaredPlugin({
      tunnels: cloudflaredTunnelService,
      routes: cloudflaredRouteService,
    }),
  ])

  return {
    config,
    registry,
    jobService,
    sessionService,
    providerService,
    cloudflareZoneService,
    cloudflareDnsRecordService,
    dnspodZoneService,
    dnspodRecordService,
    preferredDomainService,
    saasHostnameService,
    saasWorkflowService,
    saasPreferredApplyService,
    saasBatchJobService,
    dnsBatchJobService,
    edgeoneBatchJobService,
    dnsRecordMutationUseCase,
    saasHostnameMutationUseCase,
    dnsZoneMutationUseCase,
    providerMutationUseCase,
    edgeOneDomainMutationUseCase,
    tunnelMutationUseCase,
    syncOrchestrator,
    edgeoneZoneService,
    edgeoneDomainService,
    edgeoneWorkflowService,
    cloudflaredTunnelService,
    cloudflaredRouteService,
  }
}

export type AppContext = ReturnType<typeof createAppContext>

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
