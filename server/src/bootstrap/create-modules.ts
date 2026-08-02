import { AppConfigRepository, DEFAULT_APP_CONFIG } from '../modules/auth/auth-config.repository.js'
import { AuthConfig } from '../modules/auth/auth-config.service.js'
import { SessionService } from '../modules/auth/auth.service.js'
import { CloudflareDnsRecordService } from '../modules/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../modules/cloudflare/cloudflare-zone.service.js'
import { DnsPodRecordOps } from '../modules/dns-pod/dns-pod-record-sync.service.js'
import { DnsPodRecordService } from '../modules/dns-pod/dns-pod-record.service.js'
import { DnsPodZoneService } from '../modules/dns-pod/dns-pod-zone.service.js'
import { EdgeOneDomainService } from '../modules/edge-one/edge-one-domain.service.js'
import { EdgeOneZoneService } from '../modules/edge-one/edge-one-zone.service.js'
import { ProviderConnectionService } from '../modules/providers/provider-connection.service.js'
import { ProviderNormalizer } from '../modules/providers/provider-normalizer.js'
import { ProviderPresenter } from '../modules/providers/provider-presenter.js'
import { ProviderRepository } from '../modules/providers/provider.repository.js'
import { ProviderService } from '../modules/providers/provider.service.js'
import { CloudflareCustomHostnameGateway } from '../modules/saas/saas-custom-hostname.client.js'
import { CloudflareFallbackOriginGateway } from '../modules/saas/saas-fallback-origin.client.js'
import { SaaSHostnameService } from '../modules/saas/saas-hostname.service.js'
import { PreferredDomainRepository } from '../modules/saas/preferred-domain.repository.js'
import { PreferredDomainService } from '../modules/saas/preferred-domain.service.js'
import { SaaSPreferenceRepository } from '../modules/saas/saas-preference.repository.js'
import { SaaSPreferenceService } from '../modules/saas/saas-preference.service.js'
import { SaaSSyncConfigService } from '../modules/saas/saas-sync-config.service.js'
import { CloudflaredDnsService } from '../modules/tunnels/tunnel-dns.service.js'
import { CloudflaredRouteService } from '../modules/tunnels/tunnel-route.service.js'
import { CloudflaredTunnelService } from '../modules/tunnels/tunnel.service.js'
import { JsonStore } from '../platform/storage/json-store.js'
import { ProviderIntegrity } from '../modules/providers/provider-integrity.js'

export function createModules() {
  const appConfig = new AppConfigRepository(new JsonStore('config.json', DEFAULT_APP_CONFIG))
  const authConfig = new AuthConfig(appConfig)
  const session = new SessionService(authConfig)

  const providerIntegrity = new ProviderIntegrity()
  const providerRepository = new ProviderRepository(new JsonStore('providers.json', { items: [] }))
  const providerService = new ProviderService(providerRepository, new ProviderNormalizer(), new ProviderPresenter())

  const cloudflareZones = new CloudflareZoneService(providerRepository)
  const cloudflareRecords = new CloudflareDnsRecordService(providerRepository)
  const dnsPodZones = new DnsPodZoneService(providerRepository)
  const dnsPodRecords = new DnsPodRecordService(providerRepository)
  const dnsPodRecordOps = new DnsPodRecordOps(providerRepository, dnsPodZones, dnsPodRecords)

  const preferredDomains = new PreferredDomainService(
    new PreferredDomainRepository(new JsonStore('saas/preferred-domains.json', { items: [] }))
  )
  const saasPreferences = new SaaSPreferenceService(
    new SaaSPreferenceRepository(new JsonStore('saas/preferences.json', { items: {} })),
    providerIntegrity,
    providerRepository
  )
  const saasHostnames = new SaaSHostnameService(
    cloudflareZones,
    new CloudflareCustomHostnameGateway(providerRepository),
    new CloudflareFallbackOriginGateway(providerRepository),
    preferredDomains,
    saasPreferences,
    new SaaSSyncConfigService(providerRepository, saasPreferences)
  )

  const edgeOneZones = new EdgeOneZoneService(providerRepository)
  const edgeOneDomains = new EdgeOneDomainService(providerRepository)
  const tunnels = new CloudflaredTunnelService(providerRepository)
  const tunnelRoutes = new CloudflaredRouteService(
    providerRepository,
    cloudflareZones,
    new CloudflaredDnsService(cloudflareZones, cloudflareRecords)
  )
  const providerConnections = new ProviderConnectionService(providerRepository, {
    dnspodZones: dnsPodZones,
    cloudflareZones,
    edgeoneZones: edgeOneZones,
    cloudflaredTunnels: tunnels,
  })

  return {
    auth: { session },
    providers: {
      repository: providerRepository,
      service: providerService,
      connections: providerConnections,
      integrity: providerIntegrity,
    },
    cloudflare: { zones: cloudflareZones, records: cloudflareRecords },
    dnsPod: { zones: dnsPodZones, records: dnsPodRecords, recordOps: dnsPodRecordOps },
    saas: { preferredDomains, preferences: saasPreferences, hostnames: saasHostnames },
    edgeOne: { zones: edgeOneZones, domains: edgeOneDomains },
    tunnels: { tunnels, routes: tunnelRoutes },
  }
}

export type AppModules = ReturnType<typeof createModules>
