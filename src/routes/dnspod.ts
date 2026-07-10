import type { FastifyInstance } from 'fastify'
import {
  zoneListQuerySchema,
  zoneStoreSchema,
  recordListQuerySchema,
  recordStoreSchema,
  recordUpdateSchema,
} from '../schemas/dnspod.js'
import { zoneIndex, zoneStore, zoneDelete } from '../controllers/dnspod/dnspod-zone-controller.js'
import { recordIndex, recordStore, recordUpdate, recordDelete } from '../controllers/dnspod/dnspod-record-controller.js'

export async function dnspodRoutes(app: FastifyInstance) {
  app.get('/dnspod/providers/:providerId/zones', { schema: { querystring: zoneListQuerySchema } }, zoneIndex)
  app.post('/dnspod/providers/:providerId/zones', { schema: { body: zoneStoreSchema } }, zoneStore)
  app.delete('/dnspod/providers/:providerId/zones/:zone', zoneDelete)

  app.get(
    '/dnspod/providers/:providerId/zones/:zone/records',
    { schema: { querystring: recordListQuerySchema } },
    recordIndex
  )
  app.post('/dnspod/providers/:providerId/zones/:zone/records', { schema: { body: recordStoreSchema } }, recordStore)
  app.put(
    '/dnspod/providers/:providerId/zones/:zone/records/:recordId',
    { schema: { body: recordUpdateSchema } },
    recordUpdate
  )
  app.delete('/dnspod/providers/:providerId/zones/:zone/records/:recordId', recordDelete)
}
