import type { FastifyInstance } from 'fastify'
import { zoneIndex, zoneStore, zoneDelete } from './controllers/zone-controller.js'
import { recordIndex, recordStore, recordUpdate, recordDelete } from './controllers/dns-record-controller.js'
import {
  recordBatchCreateStore,
  recordBatchDeleteStore,
  recordBatchUpdateStore,
  recordBatchJobShow,
  recordBatchJobActive,
  recordBatchJobRetry,
} from '../dns-batch/controllers/batch-controller.js'

export async function routes(app: FastifyInstance) {
  app.decorateRequest('dnsProviderType', '')
  app.addHook('onRequest', async (request) => {
    request.dnsProviderType = 'cloudflare'
  })

  app.get('/zones', zoneIndex)
  app.post('/zones', zoneStore)
  app.delete('/zones/:zone', zoneDelete)

  app.get('/zones/:zone/records', recordIndex)
  app.post('/zones/:zone/records', recordStore)
  app.put('/zones/:zone/records/:recordId', recordUpdate)
  app.delete('/zones/:zone/records/:recordId', recordDelete)

  app.post('/zones/:zone/records/batch-create', recordBatchCreateStore)
  app.post('/zones/:zone/records/batch-delete', recordBatchDeleteStore)
  app.post('/zones/:zone/records/batch-update', recordBatchUpdateStore)
  app.get('/zones/:zone/records/batch/active', recordBatchJobActive)
  app.get('/records/batch/:jobId', recordBatchJobShow)
  app.post('/records/batch/:jobId/retry', recordBatchJobRetry)
}
