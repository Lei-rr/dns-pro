import { objectSchema, optionalText, paramsSchema, requestSchema, stringList } from '../../core/http/request-schema.js'
import {
  PROVIDER_FIELD_MAX_LENGTH_DEFAULT,
  PROVIDER_FIELD_MAX_LENGTHS,
  PROVIDER_ID_PATTERN,
} from '../../core/providers/provider-normalizer.js'
import { Type } from 'typebox'

const providerType = Type.Union([
  Type.Literal('dnspod'),
  Type.Literal('cloudflare'),
  Type.Literal('edgeone'),
  Type.Literal('saas'),
  Type.Literal('cloudflared'),
])
const providerId = Type.String({
  minLength: 1,
  // 与归一化共用同一份正则源：长度上限 64 由 {0,63} 表达，不再另写 maxLength 字面量
  pattern: PROVIDER_ID_PATTERN.source,
})

/** 字段长度上限取自归一化层同一张表，避免 schema 与归一化各写一份数字 */
const fieldLimit = (field: string): number => PROVIDER_FIELD_MAX_LENGTHS[field] ?? PROVIDER_FIELD_MAX_LENGTH_DEFAULT

const providerFields = {
  name: optionalText(fieldLimit('name')),
  type: providerType,
  secret_id: optionalText(fieldLimit('secret_id')),
  secret_key: optionalText(fieldLimit('secret_key')),
  api_token: optionalText(fieldLimit('api_token')),
  account_id: optionalText(fieldLimit('account_id')),
  dnspod_provider: optionalText(fieldLimit('dnspod_provider')),
  cloudflare_provider: optionalText(fieldLimit('cloudflare_provider')),
  cloudflare_dns_provider: optionalText(fieldLimit('cloudflare_dns_provider')),
}

export const providerIdParamsSchema = requestSchema({ params: paramsSchema('id') })
export const providerStoreSchema = requestSchema({
  body: objectSchema({ id: providerId, ...providerFields }, ['id', 'type']),
})
export const providerUpdateSchema = requestSchema({
  params: paramsSchema('id'),
  body: objectSchema(providerFields),
})
export const providerSortSchema = requestSchema({
  body: objectSchema({ order: stringList(0) }, ['order']),
})
