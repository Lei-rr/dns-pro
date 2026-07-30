import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../lib/http/request-schema.js'
import {
  definitionsIndex,
  providerIndex,
  providerShow,
  providerStore,
  providerUpdate,
  providerDelete,
  providerSort,
  providerTest,
} from './controllers/provider-controller.js'
import {
  providerIdParamsSchema,
  providerSortSchema,
  providerStoreSchema,
  providerUpdateSchema,
} from './schemas.js'

export async function routes(app: FastifyInstance) {
  app.get('/definitions', { schema: noRequestSchema }, definitionsIndex)
  app.get('/', { schema: noRequestSchema }, providerIndex)
  app.post('/', { schema: providerStoreSchema }, providerStore)
  app.get('/:id', { schema: providerIdParamsSchema }, providerShow)
  app.put('/:id', { schema: providerUpdateSchema }, providerUpdate)
  app.delete('/:id', { schema: providerIdParamsSchema }, providerDelete)
  app.post('/:id/test', { schema: providerIdParamsSchema }, providerTest)
  app.put('/sort-order', { schema: providerSortSchema }, providerSort)
}
