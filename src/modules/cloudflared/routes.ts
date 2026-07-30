import type { FastifyInstance } from 'fastify'
import {
  tunnelsIndex, tunnelsStore, tunnelShow, tunnelDelete, tunnelToken, tunnelTokenRotate,
  tunnelConfigShow, tunnelRouteStore, tunnelRouteUpdate, tunnelRouteDelete,
} from './controllers/tunnel-controller.js'
import {
  cloudflaredRouteDeleteSchema, cloudflaredRouteStoreSchema, cloudflaredRouteUpdateSchema,
  cloudflaredRoutesShowSchema, cloudflaredTunnelParamsSchema, cloudflaredTunnelShowSchema,
  cloudflaredTunnelStoreSchema, cloudflaredTunnelsIndexSchema,
} from './schemas.js'

export async function routes(app: FastifyInstance) {
  app.get('/tunnels', { schema: cloudflaredTunnelsIndexSchema }, tunnelsIndex)
  app.post('/tunnels', { schema: cloudflaredTunnelStoreSchema }, tunnelsStore)
  app.get('/tunnels/:tunnelId', { schema: cloudflaredTunnelShowSchema }, tunnelShow)
  app.delete('/tunnels/:tunnelId', { schema: cloudflaredTunnelParamsSchema }, tunnelDelete)
  app.get('/tunnels/:tunnelId/token', { schema: cloudflaredTunnelParamsSchema }, tunnelToken)
  app.post('/tunnels/:tunnelId/token/rotate', { schema: cloudflaredTunnelParamsSchema }, tunnelTokenRotate)
  app.get('/tunnels/:tunnelId/routes', { schema: cloudflaredRoutesShowSchema }, tunnelConfigShow)
  app.post('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteStoreSchema }, tunnelRouteStore)
  app.put('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteUpdateSchema }, tunnelRouteUpdate)
  app.delete('/tunnels/:tunnelId/routes', { schema: cloudflaredRouteDeleteSchema }, tunnelRouteDelete)
}
