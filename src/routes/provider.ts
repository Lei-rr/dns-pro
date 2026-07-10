import type { FastifyInstance } from 'fastify'
import { providerStoreSchema, providerUpdateSchema, providerSortSchema } from '../schemas/provider.js'
import {
  definitionsIndex,
  providerIndex,
  providerShow,
  providerStore,
  providerUpdate,
  providerDelete,
  providerSort,
} from '../controllers/provider/provider-controller.js'

export async function providerRoutes(app: FastifyInstance) {
  app.get('/providers/definitions', definitionsIndex)
  app.get('/providers', providerIndex)
  app.post('/providers', { schema: { body: providerStoreSchema } }, providerStore)
  app.get('/providers/:id', providerShow)
  app.put('/providers/:id', { schema: { body: providerUpdateSchema } }, providerUpdate)
  app.delete('/providers/:id', providerDelete)
  app.put('/providers/sort-order', { schema: { body: providerSortSchema } }, providerSort)
}
