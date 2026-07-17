import type { FastifyInstance } from 'fastify'
import {
  zonesIndex,
  hostnamesIndex,
  hostnamesStore,
  hostnamesShow,
  hostnamesUpdate,
  hostnamesRefresh,
  hostnamesDelete,
  fallbackOriginShow,
  fallbackOriginUpdate,
  fallbackOriginDelete,
  preferredApplyPreview,
  preferredApplyStore,
  preferredApplyShow,
  preferredApplyActive,
  preferredApplyRetry,
} from './controllers/saas-controller.js'
import {
  preferredDomainsIndex,
  preferredDomainsStore,
  preferredDomainsUpdate,
  preferredDomainsDelete,
  preferredDomainsSort,
} from './controllers/preferred-domain-controller.js'

async function preferredDomainRoutes(app: FastifyInstance) {
  app.get('/', preferredDomainsIndex)
  app.post('/', preferredDomainsStore)
  app.put('/sort', preferredDomainsSort)
  app.put('/:domain', preferredDomainsUpdate)
  app.delete('/:domain', preferredDomainsDelete)
}

async function saasProviderRoutes(app: FastifyInstance) {
  app.get('/zones', zonesIndex)
  app.get('/zones/:zoneName/hostnames', hostnamesIndex)
  app.post('/zones/:zoneName/hostnames', hostnamesStore)
  app.get('/zones/:zoneName/hostnames/:hostnameFqdn', hostnamesShow)
  app.put('/zones/:zoneName/hostnames/:hostnameFqdn', hostnamesUpdate)
  app.delete('/zones/:zoneName/hostnames/:hostnameFqdn', hostnamesDelete)
  app.post('/zones/:zoneName/hostnames/:hostnameFqdn/refresh', hostnamesRefresh)
  app.get('/zones/:zoneName/fallback-origin', fallbackOriginShow)
  app.put('/zones/:zoneName/fallback-origin', fallbackOriginUpdate)
  app.delete('/zones/:zoneName/fallback-origin', fallbackOriginDelete)

  app.get('/zones/:zoneName/preferred-apply/active', preferredApplyActive)
  app.post('/zones/:zoneName/preferred-apply/preview', preferredApplyPreview)
  app.post('/zones/:zoneName/preferred-apply', preferredApplyStore)
}

async function preferredApplyJobRoutes(app: FastifyInstance) {
  app.get('/:jobId', preferredApplyShow)
  app.post('/:jobId/retry', preferredApplyRetry)
}

export async function routes(app: FastifyInstance) {
  app.register(preferredDomainRoutes, { prefix: '/preferred-domains' })
  app.register(saasProviderRoutes, { prefix: '/providers/:providerId' })
  app.register(preferredApplyJobRoutes, { prefix: '/preferred-apply' })
}
