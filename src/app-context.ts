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

export function createAppContext(config: AppConfig) {
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
    saasPreferenceService
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
    saasPreferenceService
  )
  const dnsPodRecordOps = new DnsPodRecordOps(providerRepository, dnspodZoneService, dnspodRecordService)
  const syncOrchestrator = new SyncOrchestrator(
    providerRepository,
    saasHostnameService,
    dnsPodRecordOps,
    cloudflareZoneService,
    cloudflareDnsRecordService,
  )
  const saasWorkflowService = new SaasWorkflowService(
    saasHostnameService,
    saasPreferenceService,
    syncOrchestrator,
  )

  const edgeoneZoneService = new EdgeOneZoneService(providerRepository)
  const edgeoneDomainService = new EdgeOneDomainService(providerRepository)
  const edgeoneWorkflowService = new EdgeOneWorkflowService(edgeoneDomainService, dnsPodRecordOps)

  const cloudflaredTunnelService = new CloudflaredTunnelService(providerRepository)
  const cloudflaredDnsService = new CloudflaredDnsService(cloudflareZoneService, cloudflareDnsRecordService)
  const cloudflaredRouteService = new CloudflaredRouteService(
    providerRepository,
    cloudflareZoneService,
    cloudflaredDnsService
  )

  return {
    config,
    sessionService,
    providerService,
    cloudflareZoneService,
    cloudflareDnsRecordService,
    dnspodZoneService,
    dnspodRecordService,
    preferredDomainService,
    saasHostnameService,
    saasWorkflowService,
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
