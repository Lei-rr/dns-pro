import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../shared/http/request-schema.js'
import {
  listProviderDefinitionsHandler,
  listProvidersHandler,
  getProviderHandler,
  createProviderHandler,
  updateProviderHandler,
  deleteProviderHandler,
  sortProvidersHandler,
  testProviderHandler,
} from './provider-management.handlers.js'
import {
  providerIdParamsSchema,
  providerSortSchema,
  providerStoreSchema,
  providerUpdateSchema,
} from './provider-management.schema.js'

export async function routes(app: FastifyInstance) {
  app.get('/definitions', { schema: noRequestSchema }, listProviderDefinitionsHandler)
  app.get('/', { schema: noRequestSchema }, listProvidersHandler)
  app.post('/', { schema: providerStoreSchema }, createProviderHandler)
  app.get('/:id', { schema: providerIdParamsSchema }, getProviderHandler)
  app.put('/:id', { schema: providerUpdateSchema }, updateProviderHandler)
  app.delete('/:id', { schema: providerIdParamsSchema }, deleteProviderHandler)
  app.post('/:id/test', { schema: providerIdParamsSchema }, testProviderHandler)
  app.put('/sort-order', { schema: providerSortSchema }, sortProvidersHandler)
}
