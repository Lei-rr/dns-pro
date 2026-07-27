import type { FastifyInstance } from 'fastify'
import { zonesIndex, zoneStore, zoneDelete } from './controllers/zone-controller.js'
import { recordsIndex, recordStore, recordUpdate, recordDelete } from './controllers/dns-record-controller.js'
import {
  batchCreateStore,
  batchDeleteStore,
  batchUpdateStore,
  batchJobShow,
  batchJobActive,
  batchJobRetry,
} from '../dns-batch/controllers/batch-controller.js'
import { withDnsProviderType } from '../dns-batch/with-provider-type.js'

export async function routes(app: FastifyInstance) {
  await withDnsProviderType(app, 'cloudflare')

  app.get('/zones', zonesIndex)
  app.post('/zones', zoneStore)
  app.delete('/zones/:zone', zoneDelete)

  app.get('/zones/:zone/records', recordsIndex)
  app.post('/zones/:zone/records', recordStore)
  app.put('/zones/:zone/records/:recordId', recordUpdate)
  app.delete('/zones/:zone/records/:recordId', recordDelete)

  app.post('/zones/:zone/records/batch-create', batchCreateStore)
  app.post('/zones/:zone/records/batch-delete', batchDeleteStore)
  app.post('/zones/:zone/records/batch-update', batchUpdateStore)
  app.get('/zones/:zone/records/batch/active', batchJobActive)
  app.get('/records/batch/:jobId', batchJobShow)
  app.post('/records/batch/:jobId/retry', batchJobRetry)
}
