import type { FastifyInstance } from 'fastify'
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
  app.post('/', providerStore)
  app.get('/:id', providerShow)
  app.put('/:id', providerUpdate)
  app.delete('/:id', providerDelete)
  app.put('/sort-order', providerSort)
}
