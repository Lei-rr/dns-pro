import type { FastifyInstance } from 'fastify'
import {
  zoneListQuerySchema,
  zoneStoreSchema,
  recordListQuerySchema,
  recordStoreSchema,
  recordUpdateSchema,
} from './schemas/request.js'
import { zoneIndex, zoneStore, zoneDelete } from './controllers/zone-controller.js'
import { recordIndex, recordStore, recordUpdate, recordDelete } from './controllers/record-controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: { querystring: zoneListQuerySchema } }, zoneIndex)
  app.post('/zones', { schema: { body: zoneStoreSchema } }, zoneStore)
  app.delete('/zones/:zone', zoneDelete)

  app.get('/zones/:zone/records', { schema: { querystring: recordListQuerySchema } }, recordIndex)
  app.post('/zones/:zone/records', { schema: { body: recordStoreSchema } }, recordStore)
  app.put('/zones/:zone/records/:recordId', { schema: { body: recordUpdateSchema } }, recordUpdate)
  app.delete('/zones/:zone/records/:recordId', recordDelete)
}
