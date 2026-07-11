import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import underPressure from '@fastify/under-pressure'
import { error } from '../lib/http/api-response.js'

const underPressurePluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 0,
    maxRssBytes: 0,
    maxEventLoopUtilization: 0.98,
    pressureHandler: (_request, reply, type, value) => {
      void reply.status(503).send(
        error('service_unavailable', 503, 'service_unavailable', {
          pressure: type,
          value,
        })
      )
    },
    exposeStatusRoute: false,
  })
}

export const underPressurePlugin = fp(underPressurePluginImpl, {
  name: 'under-pressure',
  fastify: '5.x',
})
