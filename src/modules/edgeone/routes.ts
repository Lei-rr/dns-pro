import type { FastifyInstance } from 'fastify'
import {
  edgeOneZonesIndex,
  edgeOneZoneShow,
} from './controllers/zone-controller.js'
import {
  edgeOneAccelerationDomainsIndex,
  edgeOneAccelerationDomainStore,
  edgeOneAccelerationDomainUpdate,
  edgeOneAccelerationDomainDelete,
  edgeOneAccelerationDomainStatusUpdate,
  edgeOneAccelerationDomainCertificateUpdate,
  edgeOneAccelerationDomainCnameSync,
} from './controllers/acceleration-domain-controller.js'
import {
  edgeOneBatchDisableStore,
  edgeOneBatchDeleteStore,
  edgeOneBatchJobShow,
  edgeOneBatchJobActive,
  edgeOneBatchJobRetry,
} from './controllers/batch-controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', edgeOneZonesIndex)
  app.get('/zones/:zoneId', edgeOneZoneShow)
  app.get('/zones/:zoneId/records', edgeOneAccelerationDomainsIndex)
  app.post('/zones/:zoneId/records', edgeOneAccelerationDomainStore)
  app.put('/zones/:zoneId/records/:domainName', edgeOneAccelerationDomainUpdate)
  app.delete('/zones/:zoneId/records/:domainName', edgeOneAccelerationDomainDelete)
  app.put('/zones/:zoneId/records/:domainName/status', edgeOneAccelerationDomainStatusUpdate)
  app.put('/zones/:zoneId/records/:domainName/certificate', edgeOneAccelerationDomainCertificateUpdate)
  app.post('/zones/:zoneId/records/:domainName/cname-sync', edgeOneAccelerationDomainCnameSync)

  app.get('/zones/:zoneId/batch/active', edgeOneBatchJobActive)
  app.post('/zones/:zoneId/batch/disable', edgeOneBatchDisableStore)
  app.post('/zones/:zoneId/batch/delete', edgeOneBatchDeleteStore)
  app.get('/batch/:jobId', edgeOneBatchJobShow)
  app.post('/batch/:jobId/retry', edgeOneBatchJobRetry)
}
