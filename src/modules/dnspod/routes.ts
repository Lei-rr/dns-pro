import type { FastifyInstance } from 'fastify'
import { zonesIndex, zoneStore, zoneDelete } from './controllers/zone-controller.js'
import { recordsIndex, recordStore, recordUpdate, recordDelete } from './controllers/record-controller.js'
import {
  batchCreateStore,
  batchDeleteStore,
  batchUpdateStore,
  batchJobShow,
  batchJobActive,
  batchJobRetry,
} from '../dns-batch/controllers/batch-controller.js'
import { withDnsProviderType } from '../dns-batch/with-provider-type.js'
import { dnsBatchBodySchema, dnsJobParamsSchema, dnsZoneParamsSchema } from '../dns-batch/schemas.js'
import {
  dnspodRecordParamsSchema,
  dnspodRecordStoreSchema,
  dnspodRecordUpdateSchema,
  dnspodRecordsIndexSchema,
  dnspodZoneParamsSchema,
  dnspodZoneStoreSchema,
  dnspodZonesIndexSchema,
} from './schemas.js'

export async function routes(app: FastifyInstance) {
  await withDnsProviderType(app, 'dnspod')

  app.get('/zones', { schema: dnspodZonesIndexSchema }, zonesIndex)
  app.post('/zones', { schema: dnspodZoneStoreSchema }, zoneStore)
  app.delete('/zones/:zone', { schema: dnspodZoneParamsSchema }, zoneDelete)

  app.get('/zones/:zone/records', { schema: dnspodRecordsIndexSchema }, recordsIndex)
  app.post('/zones/:zone/records', { schema: dnspodRecordStoreSchema }, recordStore)
  app.put('/zones/:zone/records/:recordId', { schema: dnspodRecordUpdateSchema }, recordUpdate)
  app.delete('/zones/:zone/records/:recordId', { schema: dnspodRecordParamsSchema }, recordDelete)

  app.post('/zones/:zone/records/batch-create', { schema: dnsBatchBodySchema('create') }, batchCreateStore)
  app.post('/zones/:zone/records/batch-delete', { schema: dnsBatchBodySchema('delete') }, batchDeleteStore)
  app.post('/zones/:zone/records/batch-update', { schema: dnsBatchBodySchema('update') }, batchUpdateStore)
  app.get('/zones/:zone/records/batch/active', { schema: dnsZoneParamsSchema }, batchJobActive)
  app.get('/records/batch/:jobId', { schema: dnsJobParamsSchema }, batchJobShow)
  app.post('/records/batch/:jobId/retry', { schema: dnsJobParamsSchema }, batchJobRetry)
}
