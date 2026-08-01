import { Type } from 'typebox'
import {
  bool,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  text,
} from '../../shared/http/request-schema.js'

const uint = Type.Integer({ minimum: 0 })
const recordFields = {
  id: Type.Optional(optionalText()),
  name: Type.Optional(optionalText()),
  type: Type.Optional(optionalText()),
  value: Type.Optional(optionalText(65535)),
  ttl: Type.Optional(uint),
  line: Type.Optional(optionalText()),
  record_line_id: Type.Optional(optionalText()),
  priority: Type.Optional(uint),
  remark: Type.Optional(optionalText(65535)),
  proxied: Type.Optional(bool),
  status: Type.Optional(optionalText()),
  weight: Type.Optional(uint),
}
const createRecord = Type.Object(
  { ...recordFields, name: text(), type: text(), value: text(65535) },
  { additionalProperties: false }
)
const selectedRecord = Type.Object(
  { id: text(), name: Type.Optional(optionalText()), type: Type.Optional(optionalText()) },
  { additionalProperties: false }
)
const updateRecord = Type.Object(
  { ...recordFields, id: text(), name: text(), type: text(), value: text(65535) },
  { additionalProperties: false }
)
const patch = objectSchema({
  value: optionalText(65535),
  ttl: uint,
  line: optionalText(),
  record_line_id: optionalText(),
  remark: optionalText(65535),
  priority: uint,
  proxied: bool,
  status: optionalText(),
  weight: uint,
})
const zoneParams = paramsSchema('providerId', 'zone')

export const dnsProviderParamsSchema = requestSchema({ params: paramsSchema('providerId') })
export const dnsZoneParamsSchema = requestSchema({ params: zoneParams })
export const dnsRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
export const dnsJobParamsSchema = requestSchema({ params: paramsSchema('providerId', 'jobId') })
export const dnsBatchCreateSchema = requestSchema({
  params: zoneParams,
  body: Type.Object({ records: Type.Array(createRecord, { minItems: 1 }) }, { additionalProperties: false }),
})
export const dnsBatchDeleteSchema = requestSchema({
  params: zoneParams,
  body: Type.Object({ records: Type.Array(selectedRecord, { minItems: 1 }) }, { additionalProperties: false }),
})
export const dnsBatchUpdateSchema = requestSchema({
  params: zoneParams,
  body: Type.Object({ records: Type.Array(updateRecord, { minItems: 1 }), patch }, { additionalProperties: false }),
})
