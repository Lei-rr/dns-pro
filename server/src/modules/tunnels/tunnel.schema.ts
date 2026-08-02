import { Type } from 'typebox'
import {
  booleanQuerySchema,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  text,
} from '../../shared/http/request-schema.js'

const providerParams = paramsSchema('providerId')
const tunnelParams = Type.Object(
  {
    providerId: text(1024),
    tunnelId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9_-]+$' }),
  },
  { additionalProperties: false }
)
const routeBody = objectSchema({ hostname: text(253), service: text(2048), path: optionalText(2048) }, [
  'hostname',
  'service',
])

export const cloudflaredTunnelsIndexSchema = requestSchema({
  params: providerParams,
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflaredTunnelStoreSchema = requestSchema({
  params: providerParams,
  body: objectSchema({ name: text(255) }, ['name']),
})
export const cloudflaredTunnelShowSchema = requestSchema({
  params: tunnelParams,
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflaredTunnelParamsSchema = requestSchema({ params: tunnelParams })
export const cloudflaredRoutesShowSchema = requestSchema({
  params: tunnelParams,
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflaredRouteStoreSchema = requestSchema({ params: tunnelParams, body: routeBody })
export const cloudflaredRouteUpdateSchema = requestSchema({
  params: tunnelParams,
  querystring: objectSchema({ original_hostname: optionalText(253), original_path: optionalText(2048) }),
  body: routeBody,
})
export const cloudflaredRouteDeleteSchema = requestSchema({
  params: tunnelParams,
  querystring: objectSchema({ hostname: text(253), path: optionalText(2048) }, ['hostname']),
})
