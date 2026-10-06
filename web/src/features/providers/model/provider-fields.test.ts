import { describe, expect, it } from 'vitest'
import type { ProviderDefinition } from './types'
import { isProviderSecretField } from './provider-fields'

function definition(secretFields: string[]): ProviderDefinition {
  return { type: 'dnspod', name: 'DNSPod', fields: [], required: [], secret_fields: secretFields }
}

describe('isProviderSecretField', () => {
  it('有定义时以定义为准：名单内是密钥', () => {
    expect(isProviderSecretField('secret_key', definition(['secret_id', 'secret_key']))).toBe(true)
    expect(isProviderSecretField('api_token', definition(['api_token']))).toBe(true)
  })

  it('有定义时名单外不是密钥：secret_id 不因名字像密钥被误判', () => {
    expect(isProviderSecretField('secret_id', definition(['api_token']))).toBe(false)
  })

  it('定义为空名单时回退正则：token / password 命中', () => {
    expect(isProviderSecretField('api_token', definition([]))).toBe(true)
    expect(isProviderSecretField('secret_id', definition([]))).toBe(false)
  })

  it('无定义（undefined/null）时回退正则', () => {
    expect(isProviderSecretField('api_token')).toBe(true)
    expect(isProviderSecretField('api_token', null)).toBe(true)
    expect(isProviderSecretField('user_password', undefined)).toBe(true)
    expect(isProviderSecretField('Token')).toBe(true)
    expect(isProviderSecretField('secret_id', null)).toBe(false)
  })

  it('定义对象缺 secret_fields 字段时同样走正则', () => {
    const bare = { type: 'x', name: 'X', fields: [], required: [] } as unknown as ProviderDefinition
    expect(isProviderSecretField('api_token', bare)).toBe(true)
    expect(isProviderSecretField('secret_id', bare)).toBe(false)
  })

  it('定义名单是精确匹配：大小写不同不命中', () => {
    expect(isProviderSecretField('API_TOKEN', definition(['api_token']))).toBe(false)
    expect(isProviderSecretField('Secret_Key', definition(['secret_key']))).toBe(false)
  })
})
