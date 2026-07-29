import type { FastifyInstance } from 'fastify'
import {
  tunnelsIndex,
  tunnelsStore,
  tunnelShow,
  tunnelDelete,
  tunnelToken,
  tunnelTokenRotate,
  tunnelConfigShow,
  tunnelRouteStore,
  tunnelRouteUpdate,
  tunnelRouteDelete,
} from './controllers/tunnel-controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/tunnels', tunnelsIndex)
  app.post('/tunnels', tunnelsStore)
  app.get('/tunnels/:tunnelId', tunnelShow)
  app.delete('/tunnels/:tunnelId', tunnelDelete)
  app.get('/tunnels/:tunnelId/token', tunnelToken)
  app.post('/tunnels/:tunnelId/token/rotate', tunnelTokenRotate)
  app.get('/tunnels/:tunnelId/routes', tunnelConfigShow)
  app.post('/tunnels/:tunnelId/routes', tunnelRouteStore)
  app.put('/tunnels/:tunnelId/routes', tunnelRouteUpdate)
  app.delete('/tunnels/:tunnelId/routes', tunnelRouteDelete)
}
