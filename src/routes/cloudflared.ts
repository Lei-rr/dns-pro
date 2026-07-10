import type { FastifyInstance } from 'fastify'
import {
  cloudflaredTunnelCreateSchema,
  cloudflaredRouteSchema,
  cloudflaredRouteUpdateQuerySchema,
  cloudflaredRouteDeleteQuerySchema,
} from '../schemas/cloudflared.js'
import {
  cloudflaredTunnelsIndex,
  cloudflaredTunnelsStore,
  cloudflaredTunnelShow,
  cloudflaredTunnelDelete,
  cloudflaredTunnelToken,
  cloudflaredTunnelTokenRotate,
  cloudflaredTunnelConfigShow,
  cloudflaredTunnelRouteStore,
  cloudflaredTunnelRouteUpdate,
  cloudflaredTunnelRouteDelete,
  cloudflaredZonesIndex,
} from '../controllers/cloudflared/cloudflared-tunnel-controller.js'

export async function cloudflaredRoutes(app: FastifyInstance) {
  app.get('/zones', cloudflaredZonesIndex)
  app.get('/tunnels', cloudflaredTunnelsIndex)
  app.post('/tunnels', { schema: { body: cloudflaredTunnelCreateSchema } }, cloudflaredTunnelsStore)
  app.get('/tunnels/:tunnelId', cloudflaredTunnelShow)
  app.delete('/tunnels/:tunnelId', cloudflaredTunnelDelete)
  app.get('/tunnels/:tunnelId/token', cloudflaredTunnelToken)
  app.post('/tunnels/:tunnelId/token/rotate', cloudflaredTunnelTokenRotate)
  app.get('/tunnels/:tunnelId/routes', cloudflaredTunnelConfigShow)
  app.post('/tunnels/:tunnelId/routes', { schema: { body: cloudflaredRouteSchema } }, cloudflaredTunnelRouteStore)
  app.put('/tunnels/:tunnelId/routes', { schema: { body: cloudflaredRouteSchema, querystring: cloudflaredRouteUpdateQuerySchema } }, cloudflaredTunnelRouteUpdate)
  app.delete('/tunnels/:tunnelId/routes', { schema: { querystring: cloudflaredRouteDeleteQuerySchema } }, cloudflaredTunnelRouteDelete)
}
