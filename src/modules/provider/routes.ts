import type { FastifyInstance } from 'fastify'
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

export async function routes(app: FastifyInstance) {
  app.get('/definitions', definitionsIndex)
  app.get('/', providerIndex)
  app.post('/', providerStore)
  app.get('/:id', providerShow)
  app.put('/:id', providerUpdate)
  app.delete('/:id', providerDelete)
  app.post('/:id/test', providerTest)
  app.put('/sort-order', providerSort)
}
