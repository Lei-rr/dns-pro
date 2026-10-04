import { AuthConfigRepository, type AuthConfigData } from '../modules/auth/auth-config.repository.js'
import type { AppConfig } from './app-config.js'
import { AuthService } from '../modules/auth/auth.service.js'
import { CloudflareDnsRecordService } from '../modules/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../modules/cloudflare/cloudflare-zone.service.js'
import { DnsPodLineService } from '../modules/dns-pod/dns-pod-line.service.js'
import { DnsPodRecordSyncService } from '../modules/dns-pod/dns-pod-record-sync.service.js'
import { DnsPodRecordService } from '../modules/dns-pod/dns-pod-record.service.js'
import { DnsPodZoneService } from '../modules/dns-pod/dns-pod-zone.service.js'
import { EdgeOneDomainService } from '../modules/edge-one/edge-one-domain.service.js'
import { EdgeOneZoneService } from '../modules/edge-one/edge-one-zone.service.js'
import { ProviderConnectionService } from '../modules/providers/provider-connection.service.js'
import { ProviderIntegrity } from '../modules/providers/provider-integrity.js'
import { ProviderRepository, type ProvidersFile } from '../modules/providers/provider.repository.js'
import { ProviderService } from '../modules/providers/provider.service.js'
import { PreferredDomainService, type PreferredDomainsFile } from '../modules/saas/preferred-domain.service.js'
import { SaaSCustomHostnameClient } from '../modules/saas/saas-custom-hostname.client.js'
import { SaaSFallbackOriginClient } from '../modules/saas/saas-fallback-origin.client.js'
import { SaaSHostnameService } from '../modules/saas/saas-hostname.service.js'
import { SaaSPreferenceService, type SaaSPreferencesFile } from '../modules/saas/saas-preference.service.js'
import { SaaSSyncConfigService } from '../modules/saas/saas-sync-config.service.js'
import { TunnelDnsService } from '../modules/tunnels/tunnel-dns.service.js'
import { TunnelRouteService } from '../modules/tunnels/tunnel-route.service.js'
import { TunnelService } from '../modules/tunnels/tunnel.service.js'
import { createSecretBox } from '../platform/security/secret-box.js'
import { createStore } from './store-registry.js'

/** 模块装配：仅做依赖注入，无业务逻辑 */
export function createModules(config: AppConfig, deps: { credentialKey: Buffer }) {
  const auth = new AuthService(new AuthConfigRepository(createStore<AuthConfigData>('auth')), {
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
    maxAgeSeconds: config.sessionMaxAgeSeconds,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
  })

  const integrity = new ProviderIntegrity()
  const providers = new ProviderRepository(createStore<ProvidersFile>('providers'), createSecretBox(deps.credentialKey))

  const cloudflareZones = new CloudflareZoneService(providers)
  const cloudflareRecords = new CloudflareDnsRecordService(providers)
  const dnsPodZones = new DnsPodZoneService(providers)
  const dnsPodRecords = new DnsPodRecordService(providers)
  const edgeOneZones = new EdgeOneZoneService(providers)
  const edgeOneDomains = new EdgeOneDomainService(providers)
  const tunnels = new TunnelService(providers)

  const preferredDomains = new PreferredDomainService(createStore<PreferredDomainsFile>('preferredDomains'))
  const saasPreferences = new SaaSPreferenceService(
    createStore<SaaSPreferencesFile>('saasPreferences'),
    integrity,
    providers
  )
  const saasSyncConfigs = new SaaSSyncConfigService(providers, saasPreferences)

  return {
    auth: { service: auth },
    providers: {
      repository: providers,
      service: new ProviderService(providers),
      connections: new ProviderConnectionService(providers, {
        dnspodZones: dnsPodZones,
        cloudflareZones,
        edgeoneZones: edgeOneZones,
        tunnels,
      }),
      integrity,
    },
    cloudflare: { zones: cloudflareZones, records: cloudflareRecords },
    dnsPod: {
      zones: dnsPodZones,
      lines: new DnsPodLineService(providers, dnsPodZones),
      records: dnsPodRecords,
      recordSync: new DnsPodRecordSyncService(providers, dnsPodZones, dnsPodRecords),
    },
    saas: {
      preferredDomains,
      preferences: saasPreferences,
      syncConfigs: saasSyncConfigs,
      hostnames: new SaaSHostnameService(
        cloudflareZones,
        new SaaSCustomHostnameClient(providers),
        new SaaSFallbackOriginClient(providers),
        preferredDomains,
        saasPreferences,
        saasSyncConfigs
      ),
    },
    edgeOne: { zones: edgeOneZones, domains: edgeOneDomains },
    tunnels: {
      tunnels,
      routes: new TunnelRouteService(
        providers,
        cloudflareZones,
        new TunnelDnsService(cloudflareZones, cloudflareRecords)
      ),
    },
  }
}

export type AppModules = ReturnType<typeof createModules>
