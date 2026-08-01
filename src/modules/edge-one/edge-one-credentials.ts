import { ApiError } from '../../shared/http/api-error.js'
import type { ProviderRepository } from '../providers/provider.repository.js'
import type { DnsPodProvider, EdgeOneProvider } from '../providers/provider.types.js'

/** EdgeOne API credentials are read from the linked durable DNSPod provider each time. */

export async function resolveEdgeOneApiCredentials(
  providers: ProviderRepository,
  edgeoneProviderId: string
): Promise<DnsPodProvider> {
  const edgeoneProvider = await providers.requireType<EdgeOneProvider>(
    edgeoneProviderId,
    'edgeone',
    'EdgeOne provider not found',
    'edgeone_provider_not_found'
  )
  const dnspodProviderId = edgeoneProvider.dnspod_provider.trim()
  if (dnspodProviderId === '') {
    throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne provider is not linked to a DNSPod provider', 422)
  }

  const dnspodProvider = await providers.requireType<DnsPodProvider>(
    dnspodProviderId,
    'dnspod',
    'DNSPod provider not found',
    'dnspod_provider_not_found'
  )
  return dnspodProvider
}
