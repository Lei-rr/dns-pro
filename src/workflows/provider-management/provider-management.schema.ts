import {
  objectSchema,
  optionalText,
  paramsSchema,
  requestSchema,
  stringList,
} from '../../shared/http/request-schema.js'
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
  maxLength: 64,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$',
})
const providerFields = {
  name: optionalText(255),
  type: providerType,
  secret_id: optionalText(128),
  secret_key: optionalText(256),
  api_token: optionalText(512),
  account_id: optionalText(128),
  dnspod_provider: optionalText(64),
  cloudflare_provider: optionalText(64),
  cloudflare_dns_provider: optionalText(64),
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
