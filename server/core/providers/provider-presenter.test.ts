import { describe, expect, it } from 'vitest'
import { ProviderPresenter } from './provider-presenter.js'
import type { Provider } from './provider.types.js'

/**
 * 呈现层不得泄漏密钥：未知类型只输出最小安全字段，绝不展开原始对象（可能含密钥）。
 * 关联型服务商的 configured 取决于被关联服务商是否真的具备所需字段——
 * 只看关联 ID 在场会把「关联账号还缺 account_id」判成已配置。
 */

const presenter = new ProviderPresenter()

describe('ProviderPresenter：未知类型只输出安全字段', () => {
  it('未知类型 configured=false，且不展开 api_token', () => {
    const legacy = { id: 'legacy', type: 'legacy', name: 'Legacy', api_token: 'secret' } as unknown as Provider
    const view = presenter.present(legacy) as unknown as Record<string, unknown>
    expect(view.configured).toBe(false)
    expect('api_token' in view).toBe(false)
  })
})

describe('ProviderPresenter：关联服务商必须真的可配置', () => {
  it('cloudflared 关联的 Cloudflare account_id 为空时 configured=false', () => {
    const cf = { id: 'cf', type: 'cloudflare', name: 'CF', api_token: 'token', account_id: '' } as Provider
    const tunnel = { id: 't', type: 'cloudflared', name: 'Tunnel', cloudflare_provider: 'cf' } as Provider
    expect(presenter.present(tunnel, [cf, tunnel]).configured).toBe(false)
  })
})
