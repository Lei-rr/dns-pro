import { Type } from 'typebox'
import {
  bool,
  booleanQuerySchema,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  stringList,
  text,
} from '../../shared/http/request-schema.js'

const providerParams = paramsSchema('providerId')
const zoneParams = paramsSchema('providerId', 'zoneName')
const hostnameParams = paramsSchema('providerId', 'zoneName', 'hostnameFqdn')
const jobParams = paramsSchema('jobId')
const method = Type.Union([Type.Literal('txt'), Type.Literal('http')])
const tlsVersion = Type.Union([Type.Literal('1.0'), Type.Literal('1.1'), Type.Literal('1.2'), Type.Literal('1.3')])
const ssl = objectSchema({ method, settings: objectSchema({ min_tls_version: tlsVersion }) })
const hostnameFields = {
  hostname: text(253),
  hostname_prefix: optionalText(253),
  sync_target: Type.Union([Type.Literal('dnspod'), Type.Literal('cloudflare_dns')]),
  sync_provider_id: optionalText(64),
  sync_zone: optionalText(253),
  custom_origin_server: optionalText(253),
  preferred_domain: optionalText(253),
  auto_preferred: bool,
  method,
  min_tls: tlsVersion,
  min_tls_version: tlsVersion,
  ssl,
}
const batchPatch = objectSchema({
  preferred_domain: optionalText(253),
  auto_preferred: bool,
  custom_origin_server: optionalText(253),
  method,
  min_tls_version: tlsVersion,
})

export const saasPreferredDomainParamsSchema = requestSchema({ params: paramsSchema('domain') })
export const saasPreferredDomainWriteSchema = requestSchema({ body: objectSchema({ domain: text(253) }, ['domain']) })
export const saasPreferredDomainUpdateSchema = requestSchema({
  params: paramsSchema('domain'),
  body: objectSchema({ domain: text(253) }, ['domain']),
})
export const saasPreferredDomainSortSchema = requestSchema({
  body: objectSchema({ domains: stringList(0) }, ['domains']),
})
export const saasZonesIndexSchema = requestSchema({
  params: providerParams,
  querystring: booleanQuerySchema('refresh'),
})
export const saasHostnamesIndexSchema = requestSchema({
  params: zoneParams,
  querystring: booleanQuerySchema('refresh'),
})
export const saasHostnameStoreSchema = requestSchema({
  params: zoneParams,
  querystring: booleanQuerySchema('auto_sync'),
  body: objectSchema(hostnameFields, ['hostname']),
})
export const saasHostnameShowSchema = requestSchema({
  params: hostnameParams,
  querystring: booleanQuerySchema('refresh'),
})
export const saasHostnameUpdateSchema = requestSchema({
  params: hostnameParams,
  querystring: booleanQuerySchema('auto_sync'),
  body: objectSchema(hostnameFields),
})
export const saasHostnameDeleteSchema = requestSchema({
  params: hostnameParams,
  querystring: booleanQuerySchema('auto_cleanup'),
})
export const saasHostnameParamsSchema = requestSchema({ params: hostnameParams })
export const saasFallbackShowSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const saasFallbackWriteSchema = requestSchema({
  params: zoneParams,
  body: objectSchema({ origin: text(253) }, ['origin']),
})
export const saasZoneParamsSchema = requestSchema({ params: zoneParams })
export const saasPreferredApplySchema = requestSchema({
  params: zoneParams,
  body: objectSchema(
    { preferred_domain: text(253), hostnames: stringList(), only_auto_preferred: bool, dry_run: bool },
    ['preferred_domain']
  ),
})
export const saasBatchDeleteSchema = requestSchema({
  params: zoneParams,
  body: objectSchema({ hostnames: stringList(), auto_cleanup: bool }, ['hostnames']),
})
export const saasBatchUpdateSchema = requestSchema({
  params: zoneParams,
  body: objectSchema({ hostnames: stringList(), patch: batchPatch, auto_sync: bool }, ['hostnames', 'patch']),
})
export const saasJobParamsSchema = requestSchema({ params: jobParams })
