import type { FastifyInstance } from 'fastify'
import {
  edgeOneZoneListSchema,
  edgeOneZoneShowSchema,
  edgeOneAccelerationDomainListSchema,
  edgeOneAccelerationDomainStoreSchema,
  edgeOneAccelerationDomainUpdateSchema,
  edgeOneAccelerationDomainStatusSchema,
  edgeOneAccelerationDomainCertificateSchema,
} from '../schemas/edgeone.js'
import { edgeOneZonesIndex, edgeOneZoneShow } from '../controllers/edgeone/edgeone-zone-controller.js'
import {
  edgeOneAccelerationDomainsIndex,
  edgeOneAccelerationDomainStore,
  edgeOneAccelerationDomainUpdate,
  edgeOneAccelerationDomainDelete,
  edgeOneAccelerationDomainStatusUpdate,
  edgeOneAccelerationDomainCertificateUpdate,
  edgeOneAccelerationDomainCnameSync,
} from '../controllers/edgeone/edgeone-acceleration-domain-controller.js'

export async function edgeOneRoutes(app: FastifyInstance) {
  app.get('/edgeone/providers/:providerId/zones', { schema: { querystring: edgeOneZoneListSchema } }, edgeOneZonesIndex)
  app.get(
    '/edgeone/providers/:providerId/zones/:zoneId',
    { schema: { querystring: edgeOneZoneShowSchema } },
    edgeOneZoneShow
  )
  app.get(
    '/edgeone/providers/:providerId/zones/:zoneId/records',
    { schema: { querystring: edgeOneAccelerationDomainListSchema } },
    edgeOneAccelerationDomainsIndex
  )
  app.post(
    '/edgeone/providers/:providerId/zones/:zoneId/records',
    { schema: { body: edgeOneAccelerationDomainStoreSchema } },
    edgeOneAccelerationDomainStore
  )
  app.put(
    '/edgeone/providers/:providerId/zones/:zoneId/records/:domainName',
    { schema: { body: edgeOneAccelerationDomainUpdateSchema } },
    edgeOneAccelerationDomainUpdate
  )
  app.delete('/edgeone/providers/:providerId/zones/:zoneId/records/:domainName', edgeOneAccelerationDomainDelete)
  app.put(
    '/edgeone/providers/:providerId/zones/:zoneId/records/:domainName/status',
    { schema: { body: edgeOneAccelerationDomainStatusSchema } },
    edgeOneAccelerationDomainStatusUpdate
  )
  app.put(
    '/edgeone/providers/:providerId/zones/:zoneId/records/:domainName/certificate',
    { schema: { body: edgeOneAccelerationDomainCertificateSchema } },
    edgeOneAccelerationDomainCertificateUpdate
  )
  app.post(
    '/edgeone/providers/:providerId/zones/:zoneId/records/:domainName/cname-sync',
    edgeOneAccelerationDomainCnameSync
  )
}
