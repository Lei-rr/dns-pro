import { booleanQuerySchema, objectSchema, optionalText, paramsSchema, requestSchema, text } from '../../lib/http/request-schema.js'

const uint = { type: 'integer', minimum: 0 }
const recordBody = objectSchema({
  record_type: text(32), record_line: optionalText(255), value: text(65535), subdomain: optionalText(253),
  ttl: uint, mx: uint, weight: uint, record_line_id: optionalText(128),
  status: { type: 'string', enum: ['ENABLE', 'DISABLE'] }, remark: optionalText(65535),
}, ['record_type', 'value'])

export const dnspodZonesIndexSchema = requestSchema({ params: paramsSchema('providerId'), querystring: booleanQuerySchema('refresh') })
export const dnspodZoneStoreSchema = requestSchema({
  params: paramsSchema('providerId'),
  body: { type: 'object', properties: { domain: text(253), name: text(253) }, anyOf: [{ required: ['domain'] }, { required: ['name'] }], additionalProperties: false },
})
export const dnspodZoneParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone') })
export const dnspodRecordsIndexSchema = requestSchema({ params: paramsSchema('providerId', 'zone'), querystring: booleanQuerySchema('refresh') })
export const dnspodRecordStoreSchema = requestSchema({ params: paramsSchema('providerId', 'zone'), body: recordBody })
export const dnspodRecordUpdateSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId'), body: recordBody })
export const dnspodRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
