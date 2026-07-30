import { objectSchema, optionalText, paramsSchema, requestSchema, stringList } from '../../lib/http/request-schema.js'

const providerType = { type: 'string', enum: ['dnspod', 'cloudflare', 'edgeone', 'saas', 'cloudflared'] }
const providerId = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' }
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
