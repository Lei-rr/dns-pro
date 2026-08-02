import type { FastifyInstance } from 'fastify'
import { listEdgeOneZonesHandler, getEdgeOneZoneHandler } from './edge-one-zone.handlers.js'
import {
  listEdgeOneDomainsHandler,
  updateEdgeOneDomainHandler,
  updateEdgeOneDomainStatusHandler,
  updateEdgeOneCertificateHandler,
} from './edge-one-domain.handlers.js'
import {
  edgeoneCertificateSchema,
  edgeoneDomainUpdateSchema,
  edgeoneDomainsIndexSchema,
  edgeoneStatusSchema,
  edgeoneZonesIndexSchema,
  edgeoneZoneShowSchema,
} from './edge-one.schema.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: edgeoneZonesIndexSchema }, listEdgeOneZonesHandler)
  app.get('/zones/:zoneId', { schema: edgeoneZoneShowSchema }, getEdgeOneZoneHandler)
  app.get('/zones/:zoneId/records', { schema: edgeoneDomainsIndexSchema }, listEdgeOneDomainsHandler)
  app.put('/zones/:zoneId/records/:domainName', { schema: edgeoneDomainUpdateSchema }, updateEdgeOneDomainHandler)
  app.put(
    '/zones/:zoneId/records/:domainName/status',
    { schema: edgeoneStatusSchema },
    updateEdgeOneDomainStatusHandler
  )
  app.put(
    '/zones/:zoneId/records/:domainName/certificate',
    { schema: edgeoneCertificateSchema },
    updateEdgeOneCertificateHandler
  )
}
