import type { FastifyInstance } from 'fastify'
import { zonesIndex, zoneShow } from './controllers/zone-controller.js'
import {
  domainsIndex, domainStore, domainUpdate, domainDelete, domainStatusUpdate,
  domainCertificateUpdate, domainCnameSync,
} from './controllers/acceleration-domain-controller.js'
import { batchDisableStore, batchDeleteStore, batchJobShow, batchJobActive, batchJobRetry } from './controllers/batch-controller.js'
import {
  edgeoneBatchDeleteSchema, edgeoneBatchDisableSchema, edgeoneCertificateSchema, edgeoneDomainDeleteSchema,
  edgeoneDomainParamsSchema, edgeoneDomainStoreSchema, edgeoneDomainUpdateSchema, edgeoneDomainsIndexSchema,
  edgeoneJobParamsSchema, edgeoneStatusSchema, edgeoneZoneParamsSchema, edgeoneZonesIndexSchema, edgeoneZoneShowSchema,
} from './schemas.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: edgeoneZonesIndexSchema }, zonesIndex)
  app.get('/zones/:zoneId', { schema: edgeoneZoneShowSchema }, zoneShow)
  app.get('/zones/:zoneId/records', { schema: edgeoneDomainsIndexSchema }, domainsIndex)
  app.post('/zones/:zoneId/records', { schema: edgeoneDomainStoreSchema }, domainStore)
  app.put('/zones/:zoneId/records/:domainName', { schema: edgeoneDomainUpdateSchema }, domainUpdate)
  app.delete('/zones/:zoneId/records/:domainName', { schema: edgeoneDomainDeleteSchema }, domainDelete)
  app.put('/zones/:zoneId/records/:domainName/status', { schema: edgeoneStatusSchema }, domainStatusUpdate)
  app.put('/zones/:zoneId/records/:domainName/certificate', { schema: edgeoneCertificateSchema }, domainCertificateUpdate)
  app.post('/zones/:zoneId/records/:domainName/cname-sync', { schema: edgeoneDomainParamsSchema }, domainCnameSync)

  app.get('/zones/:zoneId/batch/active', { schema: edgeoneZoneParamsSchema }, batchJobActive)
  app.post('/zones/:zoneId/batch/disable', { schema: edgeoneBatchDisableSchema }, batchDisableStore)
  app.post('/zones/:zoneId/batch/delete', { schema: edgeoneBatchDeleteSchema }, batchDeleteStore)
  app.get('/batch/:jobId', { schema: edgeoneJobParamsSchema }, batchJobShow)
  app.post('/batch/:jobId/retry', { schema: edgeoneJobParamsSchema }, batchJobRetry)
}
