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
const zoneParams = paramsSchema('providerId', 'zoneId')
const domainParams = paramsSchema('providerId', 'zoneId', 'domainName')
const domainFields = {
  domain_name: text(253),
  origin_type: Type.Union([
    Type.Literal('IP_DOMAIN'),
    Type.Literal('COS'),
    Type.Literal('AWS_S3'),
    Type.Literal('ORIGIN_GROUP'),
    Type.Literal('VOD'),
  ]),
  origin: text(2048),
  host_header: optionalText(253),
  origin_protocol: Type.Union([Type.Literal('HTTP'), Type.Literal('HTTPS'), Type.Literal('FOLLOW')]),
  http_origin_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  https_origin_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  ipv6_status: Type.Union([Type.Literal('follow'), Type.Literal('on'), Type.Literal('off')]),
}
const domainStoreBody = objectSchema(domainFields, ['domain_name', 'origin'])
const domainUpdateBody = objectSchema(domainFields, ['origin'])
const domainsBody = objectSchema({ domains: stringList() }, ['domains'])

export const edgeoneZonesIndexSchema = requestSchema({
  params: providerParams,
  querystring: booleanQuerySchema('refresh'),
})
export const edgeoneZoneShowSchema = requestSchema({ params: zoneParams, querystring: booleanQuerySchema('refresh') })
export const edgeoneDomainsIndexSchema = requestSchema({
  params: zoneParams,
  querystring: booleanQuerySchema('refresh'),
})
export const edgeoneDomainStoreSchema = requestSchema({
  params: zoneParams,
  querystring: booleanQuerySchema('auto_sync'),
  body: domainStoreBody,
})
export const edgeoneDomainUpdateSchema = requestSchema({ params: domainParams, body: domainUpdateBody })
export const edgeoneDomainDeleteSchema = requestSchema({
  params: domainParams,
  querystring: booleanQuerySchema('auto_cleanup'),
})
export const edgeoneDomainParamsSchema = requestSchema({ params: domainParams })
export const edgeoneStatusSchema = requestSchema({
  params: domainParams,
  body: objectSchema({ status: Type.Union([Type.Literal('online'), Type.Literal('offline')]) }, ['status']),
})
export const edgeoneCertificateSchema = requestSchema({
  params: domainParams,
  body: objectSchema(
    {
      https_mode: Type.Union([Type.Literal('disable'), Type.Literal('eofreecert'), Type.Literal('sslcert')]),
      cert_id: optionalText(255),
    },
    ['https_mode']
  ),
})
export const edgeoneZoneParamsSchema = requestSchema({ params: zoneParams })
export const edgeoneBatchDisableSchema = requestSchema({ params: zoneParams, body: domainsBody })
export const edgeoneBatchDeleteSchema = requestSchema({
  params: zoneParams,
  body: objectSchema({ domains: stringList(), auto_cleanup: bool }, ['domains']),
})
export const edgeoneJobParamsSchema = requestSchema({ params: paramsSchema('providerId', 'jobId') })
