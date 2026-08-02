import type { FastifyInstance } from 'fastify'
import { listDnsPodZonesHandler, createDnsPodZoneHandler, deleteDnsPodZoneHandler } from './dns-pod-zone.handlers.js'
import {
  listDnsPodRecordsHandler,
  createDnsPodRecordHandler,
  updateDnsPodRecordHandler,
  deleteDnsPodRecordHandler,
} from './dns-pod-record.handlers.js'

import {
  dnspodRecordParamsSchema,
  dnspodRecordStoreSchema,
  dnspodRecordUpdateSchema,
  dnspodRecordsIndexSchema,
  dnspodZoneParamsSchema,
  dnspodZoneStoreSchema,
  dnspodZonesIndexSchema,
} from './dns-pod.schema.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', { schema: dnspodZonesIndexSchema }, listDnsPodZonesHandler)
  app.post('/zones', { schema: dnspodZoneStoreSchema }, createDnsPodZoneHandler)
  app.delete('/zones/:zone', { schema: dnspodZoneParamsSchema }, deleteDnsPodZoneHandler)

  app.get('/zones/:zone/records', { schema: dnspodRecordsIndexSchema }, listDnsPodRecordsHandler)
  app.post('/zones/:zone/records', { schema: dnspodRecordStoreSchema }, createDnsPodRecordHandler)
  app.put('/zones/:zone/records/:recordId', { schema: dnspodRecordUpdateSchema }, updateDnsPodRecordHandler)
  app.delete('/zones/:zone/records/:recordId', { schema: dnspodRecordParamsSchema }, deleteDnsPodRecordHandler)
}
