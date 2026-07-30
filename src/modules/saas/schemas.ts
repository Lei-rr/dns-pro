import { bool, booleanQuerySchema, objectSchema, optionalText, paramsSchema, requestSchema, stringList, text } from '../../lib/http/request-schema.js'

const providerParams = paramsSchema('providerId')
const zoneParams = paramsSchema('providerId', 'zoneName')
const hostnameParams = paramsSchema('providerId', 'zoneName', 'hostnameFqdn')
const jobParams = paramsSchema('jobId')
const ssl = objectSchema({
  method: { type: 'string', enum: ['txt', 'http'] },
  settings: objectSchema({ min_tls_version: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] } }),
})
const hostnameFields = {
  hostname: text(253), hostname_prefix: optionalText(253), sync_target: { type: 'string', enum: ['dnspod', 'cloudflare_dns'] },
  sync_provider_id: optionalText(64), sync_zone: optionalText(253), custom_origin_server: optionalText(253),
  preferred_domain: optionalText(253), auto_preferred: bool,
  method: { type: 'string', enum: ['txt', 'http'] },
  min_tls: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] },
  min_tls_version: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] }, ssl,
}
const itemList = { type: 'array', minItems: 1, items: { anyOf: [text(), objectSchema({ hostname: text() }, ['hostname'])] } }
const hostnamesBody = {
  type: 'object', properties: { hostnames: stringList(), items: itemList },
  anyOf: [{ required: ['hostnames'] }, { required: ['items'] }], additionalProperties: false,
}
const batchPatch = objectSchema({
  preferred_domain: optionalText(253), auto_preferred: bool, custom_origin_server: optionalText(253),
  method: { type: 'string', enum: ['txt', 'http'] }, min_tls_version: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] },
})

export const saasPreferredDomainParamsSchema = requestSchema({ params: paramsSchema('domain') })
export const saasPreferredDomainWriteSchema = requestSchema({ body: objectSchema({ domain: text(253) }, ['domain']) })
export const saasPreferredDomainUpdateSchema = requestSchema({ params: paramsSchema('domain'), body: objectSchema({ domain: text(253) }, ['domain']) })
export const saasPreferredDomainSortSchema = requestSchema({ body: objectSchema({ domains: stringList(0) }, ['domains']) })
export const saasZonesIndexSchema = requestSchema({ params: providerParams, querystring: booleanQuerySchema('refresh') })
export const saasHostnamesIndexSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const saasHostnameStoreSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('auto_sync'), body: objectSchema(hostnameFields, ['hostname']) })
export const saasHostnameShowSchema = requestSchema({ params: hostnameParams, querystring: booleanQuerySchema('refresh') })
export const saasHostnameUpdateSchema = requestSchema({ params: hostnameParams, querystring: booleanQuerySchema('auto_sync'), body: objectSchema(hostnameFields) })
export const saasHostnameDeleteSchema = requestSchema({ params: hostnameParams, querystring: booleanQuerySchema('auto_cleanup') })
export const saasHostnameParamsSchema = requestSchema({ params: hostnameParams })
export const saasFallbackShowSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const saasFallbackWriteSchema = requestSchema({ params: zoneParams, body: objectSchema({ origin: text(253) }, ['origin']) })
export const saasZoneParamsSchema = requestSchema({ params: zoneParams })
export const saasPreferredApplySchema = requestSchema({ params: zoneParams, body: objectSchema({ preferred_domain: text(253), hostnames: stringList(), only_auto_preferred: bool, dry_run: bool }, ['preferred_domain']) })
export const saasBatchDeleteSchema = requestSchema({ params: zoneParams, body: { ...hostnamesBody, properties: { ...hostnamesBody.properties, auto_cleanup: bool }, additionalProperties: false } })
export const saasBatchUpdateSchema = requestSchema({ params: zoneParams, body: { ...hostnamesBody, properties: { ...hostnamesBody.properties, patch: batchPatch, auto_sync: bool }, required: ['patch'], additionalProperties: false } })
export const saasJobParamsSchema = requestSchema({ params: jobParams })
