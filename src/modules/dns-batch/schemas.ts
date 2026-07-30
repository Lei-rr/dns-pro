import { bool, objectSchema, optionalText, paramsSchema, requestSchema, text } from '../../lib/http/request-schema.js'

const uint = { type: 'integer', minimum: 0 }
const recordFields = {
  id: optionalText(), record_id: optionalText(), name: optionalText(), subdomain: optionalText(),
  type: optionalText(), record_type: optionalText(), value: optionalText(65535), content: optionalText(65535),
  ttl: uint, line: optionalText(), record_line: optionalText(), record_line_id: optionalText(),
  mx: uint, priority: uint, remark: optionalText(65535), comment: optionalText(65535),
  proxied: bool, status: optionalText(), weight: uint,
}
const hasName = { anyOf: [{ required: ['name'] }, { required: ['subdomain'] }] }
const hasType = { anyOf: [{ required: ['type'] }, { required: ['record_type'] }] }
const hasValue = { anyOf: [{ required: ['value'] }, { required: ['content'] }] }
const createRecord = {
  type: 'object', properties: recordFields,
  allOf: [hasName, hasType, hasValue], additionalProperties: false,
}
const selectedRecord = {
  type: 'object', properties: recordFields, required: ['id'], additionalProperties: false,
}
const updateRecord = {
  type: 'object', properties: recordFields, required: ['id'],
  allOf: [hasName, hasType, hasValue], additionalProperties: false,
}
const recordIds = { type: 'array', minItems: 1, items: text() }
const patch = objectSchema({
  value: optionalText(65535), content: optionalText(65535), ttl: uint, line: optionalText(),
  record_line: optionalText(), record_line_id: optionalText(), remark: optionalText(65535),
  comment: optionalText(65535), mx: uint, priority: uint, proxied: bool, status: optionalText(), weight: uint,
})

export const dnsProviderParamsSchema = requestSchema({ params: paramsSchema('providerId') })
export const dnsZoneParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone') })
export const dnsRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
export const dnsJobParamsSchema = requestSchema({ params: paramsSchema('providerId', 'jobId') })
export const dnsBatchBodySchema = (kind: 'create' | 'delete' | 'update') => {
  const records = {
    type: 'array', minItems: 1,
    items: kind === 'create' ? createRecord : kind === 'update' ? updateRecord : selectedRecord,
  }
  const properties = { records, ...(kind === 'delete' ? { record_ids: recordIds } : {}), zone_name: optionalText(), ...(kind === 'update' ? { patch } : {}) }
  return requestSchema({
    params: paramsSchema('providerId', 'zone'),
    body: {
      type: 'object', properties,
      ...(kind === 'delete'
        ? { anyOf: [{ required: ['records'] }, { required: ['record_ids'] }] }
        : { required: kind === 'update' ? ['records', 'patch'] : ['records'] }),
      additionalProperties: false,
    },
  })
}
