import type { FastifyInstance } from 'fastify'
import { authRequired } from '../middleware/auth-required.js'
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
  app.addHook('preHandler', authRequired)

  app.get('/cloudflared/providers/:providerId/zones', cloudflaredZonesIndex)
  app.get('/cloudflared/providers/:providerId/tunnels', cloudflaredTunnelsIndex)
  app.post('/cloudflared/providers/:providerId/tunnels', { schema: { body: cloudflaredTunnelCreateSchema } }, cloudflaredTunnelsStore)
  app.get('/cloudflared/providers/:providerId/tunnels/:tunnelId', cloudflaredTunnelShow)
  app.delete('/cloudflared/providers/:providerId/tunnels/:tunnelId', cloudflaredTunnelDelete)
  app.get('/cloudflared/providers/:providerId/tunnels/:tunnelId/token', cloudflaredTunnelToken)
  app.post('/cloudflared/providers/:providerId/tunnels/:tunnelId/token/rotate', cloudflaredTunnelTokenRotate)
  app.get('/cloudflared/providers/:providerId/tunnels/:tunnelId/routes', cloudflaredTunnelConfigShow)
  app.post('/cloudflared/providers/:providerId/tunnels/:tunnelId/routes', { schema: { body: cloudflaredRouteSchema } }, cloudflaredTunnelRouteStore)
  app.put('/cloudflared/providers/:providerId/tunnels/:tunnelId/routes', { schema: { body: cloudflaredRouteSchema, querystring: cloudflaredRouteUpdateQuerySchema } }, cloudflaredTunnelRouteUpdate)
  app.delete('/cloudflared/providers/:providerId/tunnels/:tunnelId/routes', { schema: { querystring: cloudflaredRouteDeleteQuerySchema } }, cloudflaredTunnelRouteDelete)
}
