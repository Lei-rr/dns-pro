import type { FastifyInstance } from 'fastify'
import {
  zonesIndex,
  zoneShow,
} from './controllers/zone-controller.js'
import {
  domainsIndex,
  domainStore,
  domainUpdate,
  domainDelete,
  domainStatusUpdate,
  domainCertificateUpdate,
  domainCnameSync,
} from './controllers/acceleration-domain-controller.js'
import {
  batchDisableStore,
  batchDeleteStore,
  batchJobShow,
  batchJobActive,
  batchJobRetry,
} from './controllers/batch-controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', zonesIndex)
  app.get('/zones/:zoneId', zoneShow)
  app.get('/zones/:zoneId/records', domainsIndex)
  app.post('/zones/:zoneId/records', domainStore)
  app.put('/zones/:zoneId/records/:domainName', domainUpdate)
  app.delete('/zones/:zoneId/records/:domainName', domainDelete)
  app.put('/zones/:zoneId/records/:domainName/status', domainStatusUpdate)
  app.put('/zones/:zoneId/records/:domainName/certificate', domainCertificateUpdate)
  app.post('/zones/:zoneId/records/:domainName/cname-sync', domainCnameSync)

  app.get('/zones/:zoneId/batch/active', batchJobActive)
  app.post('/zones/:zoneId/batch/disable', batchDisableStore)
  app.post('/zones/:zoneId/batch/delete', batchDeleteStore)
  app.get('/batch/:jobId', batchJobShow)
  app.post('/batch/:jobId/retry', batchJobRetry)
}
