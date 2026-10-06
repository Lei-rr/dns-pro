import { objectSchema, optionalText, paramsSchema, requestSchema, stringList } from '../../core/http/request-schema.js'
import {
  PROVIDER_FIELD_MAX_LENGTH_DEFAULT,
  PROVIDER_FIELD_MAX_LENGTHS,
  PROVIDER_ID_PATTERN,
} from '../../core/providers/provider-normalizer.js'
import { PROVIDER_TYPES, type ProviderType } from '../../core/providers/provider.types.js'
import { Type, type TLiteral } from 'typebox'

// 白名单取自 core 的类型常量。TypeBox 的 Union 要求非空 tuple 而 map 只给出数组，
// 因此断言保持 tuple 形状：退化成普通数组时 Static 推导会变成 never，请求体 type 字段随之失效。
const providerType = Type.Union(
  PROVIDER_TYPES.map((value) => Type.Literal(value)) as [TLiteral<ProviderType>, ...TLiteral<ProviderType>[]]
)
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
