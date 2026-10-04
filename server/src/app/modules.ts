import { AuthConfigRepository, type AuthConfigData } from '../domains/system/auth/auth-config.repository.js'
import type { AppConfig } from './config.js'
import { AuthService } from '../domains/system/auth/auth.service.js'
import { CloudflareDnsRecordService } from '../domains/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../domains/cloudflare/cloudflare-zone.service.js'
import { DnsPodLineService } from '../domains/dnspod/dns-pod-line.service.js'
import { DnsPodRecordSyncService } from '../domains/dnspod/dns-pod-record-sync.service.js'
import { DnsPodRecordService } from '../domains/dnspod/dns-pod-record.service.js'
import { DnsPodZoneService } from '../domains/dnspod/dns-pod-zone.service.js'
import { EdgeOneDomainService } from '../domains/edgeone/edge-one-domain.service.js'
import { EdgeOneZoneService } from '../domains/edgeone/edge-one-zone.service.js'
import { ProviderConnectionService } from '../kernel/providers/provider-connection.service.js'
import { ProviderIntegrity } from '../kernel/providers/provider-integrity.js'
import { ProviderRepository, type ProvidersFile } from '../kernel/providers/provider.repository.js'
import { ProviderService } from '../kernel/providers/provider.service.js'
import {
  PreferredDomainService,
  type PreferredDomainsFile,
} from '../domains/cloudflare/saas/preferred-domain.service.js'
import { SaaSCustomHostnameClient } from '../domains/cloudflare/saas/saas-custom-hostname.client.js'
import { SaaSFallbackOriginClient } from '../domains/cloudflare/saas/saas-fallback-origin.client.js'
import { SaaSHostnameService } from '../domains/cloudflare/saas/saas-hostname.service.js'
import { SaaSPreferenceService, type SaaSPreferencesFile } from '../domains/cloudflare/saas/saas-preference.service.js'
import { SaaSSyncConfigService } from '../domains/cloudflare/saas/saas-sync-config.service.js'
import { TunnelDnsService } from '../domains/cloudflare/tunnel/tunnel-dns.service.js'
import { TunnelRouteService } from '../domains/cloudflare/tunnel/tunnel-route.service.js'
import { TunnelService } from '../domains/cloudflare/tunnel/tunnel.service.js'
import { createSecretBox } from '../kernel/crypto/secret-box.js'
import { createStore } from '../kernel/store/store-registry.js'

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
