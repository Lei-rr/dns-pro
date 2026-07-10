import type { FastifyInstance } from 'fastify'
import {
  cloudflareZoneListQuerySchema,
  cloudflareZoneStoreSchema,
  cloudflareRecordListQuerySchema,
  cloudflareRecordStoreSchema,
  cloudflareRecordUpdateSchema,
} from '../schemas/cloudflare.js'
import { zoneIndex, zoneStore, zoneDelete } from '../controllers/cloudflare/cloudflare-zone-controller.js'
import { recordIndex, recordStore, recordUpdate, recordDelete } from '../controllers/cloudflare/cloudflare-dns-record-controller.js'

export async function cloudflareRoutes(app: FastifyInstance) {
  app.get('/zones', { schema: { querystring: cloudflareZoneListQuerySchema } }, zoneIndex)
  app.post('/zones', { schema: { body: cloudflareZoneStoreSchema } }, zoneStore)
  app.delete('/zones/:zone', zoneDelete)

  app.get('/zones/:zone/records', { schema: { querystring: cloudflareRecordListQuerySchema } }, recordIndex)
  app.post('/zones/:zone/records', { schema: { body: cloudflareRecordStoreSchema } }, recordStore)
  app.put('/zones/:zone/records/:recordId', { schema: { body: cloudflareRecordUpdateSchema } }, recordUpdate)
  app.delete('/zones/:zone/records/:recordId', recordDelete)
}
