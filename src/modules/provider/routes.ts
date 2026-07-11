import type { FastifyInstance } from 'fastify'
import {
  providerStoreSchema,
  providerUpdateSchema,
  providerSortSchema,
} from './schemas.js'
import {
  definitionsIndex,
  providerIndex,
  providerShow,
  providerStore,
  providerUpdate,
  providerDelete,
  providerSort,
} from './controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/definitions', definitionsIndex)
  app.get('/', providerIndex)
  app.post('/', { schema: { body: providerStoreSchema } }, providerStore)
  app.get('/:id', providerShow)
  app.put('/:id', { schema: { body: providerUpdateSchema } }, providerUpdate)
  app.delete('/:id', providerDelete)
  app.put('/sort-order', { schema: { body: providerSortSchema } }, providerSort)
}
