import type { FastifyInstance } from 'fastify'

/** Attach dnsProviderType on request for shared dns-batch controllers. */
export async function withDnsProviderType(app: FastifyInstance, providerType: string): Promise<void> {
  app.decorateRequest('dnsProviderType', '')
  app.addHook('onRequest', async (request) => {
    request.dnsProviderType = providerType
  })
}
