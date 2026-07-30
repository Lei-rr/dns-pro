import { bool, booleanQuerySchema, objectSchema, optionalText, paramsSchema, requestSchema, text } from '../../lib/http/request-schema.js'

const uint = { type: 'integer', minimum: 0 }
export const cloudflareZonesIndexSchema = requestSchema({ params: paramsSchema('providerId'), querystring: booleanQuerySchema('refresh') })
export const cloudflareZoneStoreSchema = requestSchema({
  params: paramsSchema('providerId'),
  body: {
    type: 'object',
    properties: { name: text(253), domain: text(253), type: { type: 'string', enum: ['full', 'partial', 'secondary'] } },
    anyOf: [{ required: ['name'] }, { required: ['domain'] }],
    additionalProperties: false,
  },
})
export const cloudflareZoneParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone') })
export const cloudflareRecordsIndexSchema = requestSchema({ params: paramsSchema('providerId', 'zone'), querystring: booleanQuerySchema('refresh') })
export const cloudflareRecordWriteSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  body: objectSchema({ type: text(32), name: text(253), content: text(65535), ttl: uint, proxied: bool, priority: uint, comment: optionalText(65535) }, ['type', 'name', 'content']),
})
export const cloudflareRecordUpdateSchema = requestSchema({
  params: paramsSchema('providerId', 'zone', 'recordId'),
  body: objectSchema({ type: text(32), name: text(253), content: text(65535), ttl: uint, proxied: bool, priority: uint, comment: optionalText(65535) }, ['type', 'name', 'content']),
})
export const cloudflareRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
