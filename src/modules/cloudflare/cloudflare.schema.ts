import {
  bool,
  booleanQuerySchema,
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  text,
} from '../../shared/http/request-schema.js'
import { Type } from 'typebox'

const uint = Type.Integer({ minimum: 0 })
export const cloudflareZonesIndexSchema = requestSchema({
  params: paramsSchema('providerId'),
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflareZoneStoreSchema = requestSchema({
  params: paramsSchema('providerId'),
  body: Type.Object({ name: text(253) }, { additionalProperties: false }),
})
export const cloudflareZoneParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone') })
export const cloudflareRecordsIndexSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  querystring: booleanQuerySchema('refresh'),
})
export const cloudflareRecordWriteSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  body: objectSchema(
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
  ),
})
export const cloudflareRecordUpdateSchema = requestSchema({
  params: paramsSchema('providerId', 'zone', 'recordId'),
  body: objectSchema(
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
  ),
})
export const cloudflareRecordParamsSchema = requestSchema({ params: paramsSchema('providerId', 'zone', 'recordId') })
