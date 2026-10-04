import { AuthConfigRepository, type AuthConfigData } from '../domains/system/auth/auth-config.repository.js'
import type { AppConfig } from './config.js'
import { AuthService } from '../domains/system/auth/auth.service.js'
import { CloudflareAccess } from '../domains/cloudflare/access.js'
import { CloudflareDnsRecordService } from '../domains/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../domains/cloudflare/cloudflare-zone.service.js'
import { ZoneCatalog } from '../domains/cloudflare/zone-catalog.js'
import { DnsPodLineService } from '../domains/dnspod/dns-pod-line.service.js'
import { DnsPodAccess } from '../domains/dnspod/access.js'
import { DnsPodZoneCatalog } from '../domains/dnspod/zone-catalog.js'
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
import { cloudflareRecordPort } from '../domains/cloudflare/dns/cloudflare-record.adapter.js'
import { TunnelDnsService } from '../domains/cloudflare/tunnel/tunnel-dns.service.js'
import { TunnelRouteService } from '../domains/cloudflare/tunnel/tunnel-route.service.js'
import { TunnelService } from '../domains/cloudflare/tunnel/tunnel.service.js'
import {
  OwnershipService,
  edgeOneOwnershipSource,
  saasOwnershipSource,
  tunnelOwnershipSource,
} from '../use-cases/derived-records/ownership.js'
import { createSecretBox } from '../kernel/crypto/secret-box.js'
import { createStore } from '../kernel/store/store-registry.js'

/** 模块装配：仅做依赖注入，无业务逻辑 */
export function createModules(config: AppConfig, deps: { credentialKey: Buffer }) {
  // 数据根由装配层传入各 store（D7：不存在模块级可变全局）
  const dataRoot = config.dataDir
  const auth = new AuthService(new AuthConfigRepository(createStore<AuthConfigData>('auth', dataRoot)), {
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
    maxAgeSeconds: config.sessionMaxAgeSeconds,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
  })

  const integrity = new ProviderIntegrity()
  const providers = new ProviderRepository(
    createStore<ProvidersFile>('providers', dataRoot),
    createSecretBox(deps.credentialKey)
  )

  const cloudflareAccess = new CloudflareAccess(providers, config.httpTimeoutMs)
  const cloudflareZones = new CloudflareZoneService(cloudflareAccess)
  const cloudflareRecords = new CloudflareDnsRecordService(cloudflareAccess)
  const zoneCatalog = new ZoneCatalog(cloudflareAccess, cloudflareZones)
  const dnsPodZones = new DnsPodZoneService(providers, config.httpTimeoutMs)
  const dnsPodRecords = new DnsPodRecordService(providers, config.httpTimeoutMs)
  const edgeOneZones = new EdgeOneZoneService(providers, config.httpTimeoutMs)
  const edgeOneDomains = new EdgeOneDomainService(providers, config.httpTimeoutMs)
  const tunnels = new TunnelService(cloudflareAccess)

  const preferredDomains = new PreferredDomainService(createStore<PreferredDomainsFile>('preferredDomains', dataRoot))
  const saasPreferences = new SaaSPreferenceService(
    createStore<SaaSPreferencesFile>('saasPreferences', dataRoot),
    integrity,
    providers
  )
  const saasSyncConfigs = new SaaSSyncConfigService(providers, saasPreferences)
  const saasHostnames = new SaaSHostnameService(
    cloudflareZones,
    zoneCatalog,
    new SaaSCustomHostnameClient(cloudflareAccess),
    new SaaSFallbackOriginClient(cloudflareAccess),
    preferredDomains,
    saasPreferences,
    saasSyncConfigs
  )
  const tunnelRoutes = new TunnelRouteService(
    cloudflareAccess,
    zoneCatalog,
    new TunnelDnsService(cloudflareRecordPort(cloudflareZones, cloudflareRecords))
  )
  // D4：归属由派生关系即时解析（不落盘），DnsWriter 仲裁与记录列表徽标共用同一份查询
  const ownership = new OwnershipService([
    tunnelOwnershipSource({ providers, tunnels, routes: tunnelRoutes }),
    saasOwnershipSource({ providers, hostnames: saasHostnames }),
    edgeOneOwnershipSource({ providers, zones: edgeOneZones, domains: edgeOneDomains }),
  ])

  return {
    auth: { service: auth },
    ownership,
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
      lines: new DnsPodLineService(providers, dnsPodZones, config.httpTimeoutMs),
      records: dnsPodRecords,
      access: new DnsPodAccess(providers),
      catalog: new DnsPodZoneCatalog(dnsPodZones),
    },
    saas: {
      preferredDomains,
      preferences: saasPreferences,
      syncConfigs: saasSyncConfigs,
      hostnames: saasHostnames,
    },
    edgeOne: { zones: edgeOneZones, domains: edgeOneDomains },
    tunnels: { tunnels, routes: tunnelRoutes },
  }
}

export type AppModules = ReturnType<typeof createModules>
