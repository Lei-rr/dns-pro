import type { PluginContext, RecordPort, ZonePort } from '../kernel/index.js'
import { ServiceTokens } from '../kernel/index.js'
import { ApiError } from '../lib/http/api-error.js'

export function zonePortToken(providerType: string): string {
  if (providerType === 'dnspod') return ServiceTokens.DnsPodZonePort
  if (providerType === 'cloudflare') return ServiceTokens.CloudflareZonePort
  throw new ApiError('batch_provider_unsupported', `No zone port for provider type: ${providerType}`, 422)
}

export function recordPortToken(providerType: string): string {
  if (providerType === 'dnspod') return ServiceTokens.DnsPodRecordPort
  if (providerType === 'cloudflare') return ServiceTokens.CloudflareRecordPort
  throw new ApiError('batch_provider_unsupported', `No record port for provider type: ${providerType}`, 422)
}

export function resolveZonePort(ctx: PluginContext, providerType: string): ZonePort {
  return ctx.require<ZonePort>(zonePortToken(providerType))
}

export function resolveRecordPort(ctx: PluginContext, providerType: string): RecordPort {
  return ctx.require<RecordPort>(recordPortToken(providerType))
}
