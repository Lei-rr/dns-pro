import {
  bool,
  booleanQuerySchema,
  domainName,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  text,
} from '../../core/http/request-schema.js'
import { Type } from 'typebox'

const uint = Type.Integer({ minimum: 0 })
export const cloudflareZonesIndexSchema = requestSchema({
  params: paramsSchema('providerId'),
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflareZoneStoreSchema = requestSchema({
  params: paramsSchema('providerId'),
  body: Type.Object({ name: domainName() }, { additionalProperties: false }),
})
export const cloudflareZoneParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone') })
export const cloudflareRecordsIndexSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  querystring: booleanQuerySchema('refresh'),
})
/** 记录写入/更新共用的请求体：字段与必填项只在一处维护 */
const recordBody = objectSchema(
  {
    type: text(32),
    name: text(253),
    content: text(65535),
    ttl: uint,
    proxied: bool,
    priority: uint,
    comment: optionalText(65535),
  },
  ['type', 'name', 'content']
)
export const cloudflareRecordWriteSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  body: recordBody,
})
export const cloudflareRecordUpdateSchema = requestSchema({
  params: paramsSchema('providerId', 'zone', 'recordId'),
  body: recordBody,
})
export const cloudflareRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
