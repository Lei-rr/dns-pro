import type { FastifyInstance } from 'fastify'
import {
  listTunnelsHandler,
  createTunnelHandler,
  getTunnelHandler,
  deleteTunnelHandler,
  getTunnelTokenHandler,
  rotateTunnelTokenHandler,
  getTunnelConfigHandler,
  createTunnelRouteHandler,
  updateTunnelRouteHandler,
  deleteTunnelRouteHandler,
  repairTunnelRouteHandler,
} from './tunnel.handlers.js'
import {
  cloudflaredRouteDeleteSchema,
  cloudflaredRouteRepairSchema,
  cloudflaredRouteStoreSchema,
  cloudflaredRouteUpdateSchema,
  cloudflaredRoutesShowSchema,
  cloudflaredTunnelParamsSchema,
  cloudflaredTunnelShowSchema,
  cloudflaredTunnelStoreSchema,
  cloudflaredTunnelsIndexSchema,
} from './tunnel.schema.js'

export async function routes(app: FastifyInstance) {
  app.get('/tunnels', { schema: cloudflaredTunnelsIndexSchema }, listTunnelsHandler)
  app.post('/tunnels', { schema: cloudflaredTunnelStoreSchema }, createTunnelHandler)
  app.get('/tunnels/:tunnelId', { schema: cloudflaredTunnelShowSchema }, getTunnelHandler)
  app.delete('/tunnels/:tunnelId', { schema: cloudflaredTunnelParamsSchema }, deleteTunnelHandler)
  app.get('/tunnels/:tunnelId/token', { schema: cloudflaredTunnelParamsSchema }, getTunnelTokenHandler)
  app.post('/tunnels/:tunnelId/token/rotate', { schema: cloudflaredTunnelParamsSchema }, rotateTunnelTokenHandler)
  app.get('/tunnels/:tunnelId/routes', { schema: cloudflaredRoutesShowSchema }, getTunnelConfigHandler)
  app.post('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteStoreSchema }, createTunnelRouteHandler)
  app.post('/tunnels/:tunnelId/routes/repair', { schema: cloudflaredRouteRepairSchema }, repairTunnelRouteHandler)
  app.put('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteUpdateSchema }, updateTunnelRouteHandler)
  app.delete('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteDeleteSchema }, deleteTunnelRouteHandler)
}
