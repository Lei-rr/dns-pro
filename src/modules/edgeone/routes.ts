import type { FastifyInstance } from 'fastify'
import {
  edgeOneZoneListSchema,
  edgeOneZoneShowSchema,
  edgeOneAccelerationDomainListSchema,
  edgeOneAccelerationDomainStoreSchema,
  edgeOneAccelerationDomainUpdateSchema,
  edgeOneAccelerationDomainStatusSchema,
  edgeOneAccelerationDomainCertificateSchema,
} from './schemas/request.js'
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

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: { querystring: edgeOneZoneListSchema } }, edgeOneZonesIndex)
  app.get('/zones/:zoneId', { schema: { querystring: edgeOneZoneShowSchema } }, edgeOneZoneShow)
  app.get('/zones/:zoneId/records', { schema: { querystring: edgeOneAccelerationDomainListSchema } }, edgeOneAccelerationDomainsIndex)
  app.post('/zones/:zoneId/records', { schema: { body: edgeOneAccelerationDomainStoreSchema } }, edgeOneAccelerationDomainStore)
  app.put('/zones/:zoneId/records/:domainName', { schema: { body: edgeOneAccelerationDomainUpdateSchema } }, edgeOneAccelerationDomainUpdate)
  app.delete('/zones/:zoneId/records/:domainName', edgeOneAccelerationDomainDelete)
  app.put('/zones/:zoneId/records/:domainName/status', { schema: { body: edgeOneAccelerationDomainStatusSchema } }, edgeOneAccelerationDomainStatusUpdate)
  app.put('/zones/:zoneId/records/:domainName/certificate', { schema: { body: edgeOneAccelerationDomainCertificateSchema } }, edgeOneAccelerationDomainCertificateUpdate)
  app.post('/zones/:zoneId/records/:domainName/cname-sync', edgeOneAccelerationDomainCnameSync)
}
