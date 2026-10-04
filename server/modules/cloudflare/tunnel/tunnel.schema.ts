import {
  booleanQuerySchema,
  domainName,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  text,
} from '../../../core/http/request-schema.js'

const providerParams = paramsSchema('providerId')
const tunnelParams = paramsSchema('providerId', 'tunnelId')
const routeBody = objectSchema({ hostname: domainName(), service: text(2048), path: optionalText(2048) }, [
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
  querystring: objectSchema({ original_hostname: domainName(), original_path: optionalText(2048) }),
  body: routeBody,
})
export const cloudflaredRouteDeleteSchema = requestSchema({
  params: tunnelParams,
  querystring: objectSchema({ hostname: domainName(), path: optionalText(2048) }, ['hostname']),
})
export const cloudflaredRouteRepairSchema = requestSchema({ params: tunnelParams })
