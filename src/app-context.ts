/**
 * Composition root — WIRING ONLY.
 *
 * Rules:
 * - new services here; no business rules
 * - controllers use request.server.ctx.* only (no registry/DI tokens)
 * - Fastify plugins live in src/plugins/* only
 */
import type { AppConfig } from './config/app.js'
import { AppConfigRepository, DEFAULT_APP_CONFIG } from './lib/auth/app-config-repository.js'
import { AuthConfig } from './lib/auth/auth-config.js'
import { SessionService } from './modules/auth/service.js'
import { ProviderRepository } from './modules/provider/repository.js'
import { ProviderNormalizer } from './modules/provider/normalizer.js'
import { ProviderPresenter } from './modules/provider/presenter.js'
import { ProviderService } from './modules/provider/service.js'
import { ProviderConnectionService } from './modules/provider/services/connection-service.js'
import { ProviderDependencyService } from './modules/provider/services/dependency-service.js'
import { PreferredDomainRepository } from './modules/saas/repositories/preferred-domain-repository.js'
import { SaasPreferenceRepository } from './modules/saas/repositories/preference-repository.js'
import { PreferredDomainService } from './modules/saas/services/preferred-domain-service.js'
import { SaasPreferenceService } from './modules/saas/services/preference-service.js'
import { SaasPreferredApplyService } from './modules/saas/services/preferred-apply-service.js'
import { SaasBatchJobService } from './modules/saas/services/batch-job-service.js'
import { DnsBatchJobService } from './modules/dns-batch/services/batch-job-service.js'
import { CloudflareDnsBatchAdapter } from './modules/dns-batch/services/cloudflare-dns-batch-adapter.js'
import { CloudflareZoneService } from './modules/cloudflare/services/zone-service.js'
import { CloudflareDnsRecordService } from './modules/cloudflare/services/dns-record-service.js'
import { DnsPodZoneService } from './modules/dnspod/services/zone-service.js'
import { DnsPodRecordService } from './modules/dnspod/services/record-service.js'
import { CloudflareCustomHostnameGateway } from './modules/saas/gateways/custom-hostname-gateway.js'
import { CloudflareFallbackOriginGateway } from './modules/saas/gateways/fallback-origin-gateway.js'
import { SaasHostnameService } from './modules/saas/services/hostname-service.js'
import { SaasSyncConfigService } from './modules/saas/services/sync-config-service.js'
import { DnsPodRecordOps } from './modules/sync/services/dnspod-record-ops.js'
import { SyncOrchestrator } from './modules/sync/services/sync-orchestrator.js'
import { SaasWorkflowService } from './modules/saas/services/workflow-service.js'
import { EdgeOneZoneService } from './modules/edgeone/services/zone-service.js'
import { EdgeOneDomainService } from './modules/edgeone/services/domain-service.js'
import { EdgeOneWorkflowService } from './modules/edgeone/services/workflow-service.js'
import { CloudflaredTunnelService } from './modules/cloudflared/services/tunnel-service.js'
import { CloudflaredDnsService } from './modules/cloudflared/services/dns-service.js'
import { CloudflaredRouteService } from './modules/cloudflared/services/route-service.js'
import { EdgeOneBatchJobService } from './modules/edgeone/services/batch-job-service.js'
import { JobService } from './platform/job/job-service.js'
import { JsonStore } from './lib/storage/json-store.js'
import { registerEventSubscribers } from './platform/events/subscribers.js'

export async function createAppContext(config: AppConfig) {
  // Side-effect bus (cache invalidate)
  registerEventSubscribers()

  const appConfigRepository = new AppConfigRepository(new JsonStore('config.json', DEFAULT_APP_CONFIG))
  const authConfig = new AuthConfig(appConfigRepository)
  const sessionService = new SessionService(authConfig)

  const providerRepository = new ProviderRepository(
    new JsonStore('providers.json', { items: [] }),
  )
  const preferredDomainRepository = new PreferredDomainRepository(
    new JsonStore('saas/preferred-domains.json', { items: [] }),
  )
  const saasPreferenceRepository = new SaasPreferenceRepository(
    new JsonStore('saas/preferences.json', { items: {} }),
  )

  const preferredDomainService = new PreferredDomainService(preferredDomainRepository)
  const saasPreferenceService = new SaasPreferenceService(saasPreferenceRepository)

  const cloudflareZoneService = new CloudflareZoneService(providerRepository)
  const cloudflareDnsRecordService = new CloudflareDnsRecordService(providerRepository)
  const dnspodZoneService = new DnsPodZoneService(providerRepository)
  const dnspodRecordService = new DnsPodRecordService(providerRepository)

  const customHostnameGateway = new CloudflareCustomHostnameGateway(providerRepository)
  const fallbackOriginGateway = new CloudflareFallbackOriginGateway(providerRepository)
  const saasSyncConfigService = new SaasSyncConfigService(providerRepository, saasPreferenceService)
  const saasHostnameService = new SaasHostnameService(
    cloudflareZoneService,
    customHostnameGateway,
    fallbackOriginGateway,
    preferredDomainService,
    saasPreferenceService,
    saasSyncConfigService,
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

  const jobService = new JobService(new JsonStore('jobs/jobs.json', { items: [] }))
  // Constructing batch services registers Job runners
  const saasPreferredApplyService = new SaasPreferredApplyService(
    jobService,
    saasWorkflowService,
    saasHostnameService,
  )
  const saasBatchJobService = new SaasBatchJobService(jobService, saasWorkflowService, saasHostnameService)
  const dnsBatchJobService = new DnsBatchJobService(jobService, {
    dnspod: dnspodRecordService,
    // CF batch must resolve zone name → zone id (single-record controllers already do this).
    cloudflare: new CloudflareDnsBatchAdapter(cloudflareZoneService, cloudflareDnsRecordService),
  })
  const edgeoneBatchJobService = new EdgeOneBatchJobService(
    jobService,
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

  const providerDependencies = new ProviderDependencyService(providerRepository, saasPreferenceService)
  const providerConnections = new ProviderConnectionService(providerRepository, {
    dnspodZones: dnspodZoneService,
    cloudflareZones: cloudflareZoneService,
    edgeoneZones: edgeoneZoneService,
    cloudflaredTunnels: cloudflaredTunnelService,
  })
  const providerService = new ProviderService(
    providerRepository,
    new ProviderNormalizer(),
    new ProviderPresenter(),
    providerDependencies,
    providerConnections,
  )

  await jobService.resumeActiveJobs()

  return {
    config,
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
    edgeoneZoneService,
    edgeoneDomainService,
    edgeoneWorkflowService,
    cloudflaredTunnelService,
    cloudflaredRouteService,
  }
}

export type AppContext = Awaited<ReturnType<typeof createAppContext>>

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
