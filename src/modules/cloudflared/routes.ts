import type { FastifyInstance } from 'fastify'
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
} from './controllers/tunnel-controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/zones', cloudflaredZonesIndex)
  app.get('/tunnels', cloudflaredTunnelsIndex)
  app.post('/tunnels', cloudflaredTunnelsStore)
  app.get('/tunnels/:tunnelId', cloudflaredTunnelShow)
  app.delete('/tunnels/:tunnelId', cloudflaredTunnelDelete)
  app.get('/tunnels/:tunnelId/token', cloudflaredTunnelToken)
  app.post('/tunnels/:tunnelId/token/rotate', cloudflaredTunnelTokenRotate)
  app.get('/tunnels/:tunnelId/routes', cloudflaredTunnelConfigShow)
  app.post('/tunnels/:tunnelId/routes', cloudflaredTunnelRouteStore)
  app.put('/tunnels/:tunnelId/routes', cloudflaredTunnelRouteUpdate)
  app.delete('/tunnels/:tunnelId/routes', cloudflaredTunnelRouteDelete)
}
