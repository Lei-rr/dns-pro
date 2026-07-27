import { ApiError } from '../../lib/http/api-error.js'
import type { ProviderRepository } from '../provider/repository.js'
import type { DnsPodProvider, EdgeOneProvider } from '../provider/types.js'

/**
 * EdgeOne API credentials are stored on the linked DNSPod provider.
 * Shared resolver with per-process cache so zone/domain services stay thin.
 */
const cache = new Map<string, DnsPodProvider>()

export async function resolveEdgeOneApiCredentials(
  providers: ProviderRepository,
  edgeoneProviderId: string,
): Promise<DnsPodProvider> {
  const cached = cache.get(edgeoneProviderId)
  if (cached) return cached

  const edgeoneProvider = await providers.requireType<EdgeOneProvider>(
    edgeoneProviderId,
    'edgeone',
    'EdgeOne provider not found',
    'edgeone_provider_not_found',
  )
  const dnspodProviderId = edgeoneProvider.dnspod_provider.trim()
  if (dnspodProviderId === '') {
    throw new ApiError(
      'edgeone_dnspod_provider_not_found',
      'EdgeOne provider is not linked to a DNSPod provider',
      422,
    )
  }

  const dnspodProvider = await providers.requireType<DnsPodProvider>(
    dnspodProviderId,
    'dnspod',
    'DNSPod provider not found',
    'dnspod_provider_not_found',
  )
  cache.set(edgeoneProviderId, dnspodProvider)
  return dnspodProvider
}
