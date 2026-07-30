import { bool, booleanQuerySchema, objectSchema, optionalText, paramsSchema, requestSchema, stringList, text } from '../../lib/http/request-schema.js'

const providerParams = paramsSchema('providerId')
const zoneParams = paramsSchema('providerId', 'zoneId')
const domainParams = paramsSchema('providerId', 'zoneId', 'domainName')
const domainFields = {
  domain_name: text(253), origin_type: { type: 'string', enum: ['IP_DOMAIN', 'COS', 'AWS_S3', 'ORIGIN_GROUP', 'VOD'] },
  origin: text(2048), host_header: optionalText(253), origin_protocol: { type: 'string', enum: ['HTTP', 'HTTPS', 'FOLLOW'] },
  http_origin_port: { type: 'integer', minimum: 1, maximum: 65535 }, https_origin_port: { type: 'integer', minimum: 1, maximum: 65535 },
  ipv6_status: { type: 'string', enum: ['follow', 'on', 'off'] },
}
const domainStoreBody = objectSchema(domainFields, ['domain_name', 'origin'])
const domainUpdateBody = objectSchema(domainFields, ['origin'])
const domainItem = {
  type: 'object',
  properties: { domain: text(), name: text() },
  anyOf: [{ required: ['domain'] }, { required: ['name'] }],
  additionalProperties: false,
}
const domainItemList = { type: 'array', minItems: 1, items: { anyOf: [text(), domainItem] } }
const domainsBody = {
  type: 'object', properties: { domains: stringList(), items: domainItemList },
  anyOf: [{ required: ['domains'] }, { required: ['items'] }], additionalProperties: false,
}

export const edgeoneZonesIndexSchema = requestSchema({ params: providerParams, querystring: booleanQuerySchema('refresh') })
export const edgeoneZoneShowSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const edgeoneDomainsIndexSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const edgeoneDomainStoreSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('auto_sync'), body: domainStoreBody })
export const edgeoneDomainUpdateSchema = requestSchema({ params: domainParams, body: domainUpdateBody })
export const edgeoneDomainDeleteSchema = requestSchema({ params: domainParams, querystring: booleanQuerySchema('auto_cleanup') })
export const edgeoneDomainParamsSchema = requestSchema({ params: domainParams })
export const edgeoneStatusSchema = requestSchema({ params: domainParams, body: objectSchema({ status: { type: 'string', enum: ['online', 'offline'] } }, ['status']) })
export const edgeoneCertificateSchema = requestSchema({ params: domainParams, body: objectSchema({ https_mode: { type: 'string', enum: ['disable', 'eofreecert', 'sslcert'] }, cert_id: optionalText(255) }, ['https_mode']) })
export const edgeoneZoneParamsSchema = requestSchema({ params: zoneParams })
export const edgeoneBatchDisableSchema = requestSchema({ params: zoneParams, body: domainsBody })
export const edgeoneBatchDeleteSchema = requestSchema({ params: zoneParams, body: { type: 'object', properties: { ...domainsBody.properties, auto_cleanup: bool }, anyOf: domainsBody.anyOf, additionalProperties: false } })
export const edgeoneJobParamsSchema = requestSchema({ params: paramsSchema('providerId', 'jobId') })
