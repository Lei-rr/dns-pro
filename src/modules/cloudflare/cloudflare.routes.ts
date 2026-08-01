import type { FastifyInstance } from 'fastify'
import {
  createCloudflareZoneHandler,
  deleteCloudflareZoneHandler,
  listCloudflareZonesHandler,
} from './cloudflare-zone.handlers.js'
import {
  createCloudflareRecordHandler,
  deleteCloudflareRecordHandler,
  listCloudflareRecordsHandler,
  updateCloudflareRecordHandler,
} from './cloudflare-dns-record.handlers.js'
import {
  cloudflareRecordParamsSchema,
  cloudflareRecordUpdateSchema,
  cloudflareRecordWriteSchema,
  cloudflareRecordsIndexSchema,
  cloudflareZoneParamsSchema,
  cloudflareZoneStoreSchema,
  cloudflareZonesIndexSchema,
} from './cloudflare.schema.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: cloudflareZonesIndexSchema }, listCloudflareZonesHandler)
  app.post('/zones', { schema: cloudflareZoneStoreSchema }, createCloudflareZoneHandler)
  app.delete('/zones/:zone', { schema: cloudflareZoneParamsSchema }, deleteCloudflareZoneHandler)

  app.get('/zones/:zone/records', { schema: cloudflareRecordsIndexSchema }, listCloudflareRecordsHandler)
  app.post('/zones/:zone/records', { schema: cloudflareRecordWriteSchema }, createCloudflareRecordHandler)
  app.put('/zones/:zone/records/:recordId', { schema: cloudflareRecordUpdateSchema }, updateCloudflareRecordHandler)
  app.delete('/zones/:zone/records/:recordId', { schema: cloudflareRecordParamsSchema }, deleteCloudflareRecordHandler)
}
