import type { FastifyRequest } from 'fastify'

export function zoneNameParam(request: FastifyRequest<{ Params: { zoneName: string } }>): string {
  return request.params.zoneName.trim()
}

export function hostnameFqdnParam(request: FastifyRequest<{ Params: { hostnameFqdn: string } }>): string {
  return request.params.hostnameFqdn.trim()
}
