import { describe, expect, it } from 'vitest'
import { ApiError } from '../http/api-error.js'
import { isExplicitNotFound } from './provider-error.js'

/**
 * 「上游明确说找不到」必须是结构化证据：details.upstream_status === 404、本地码白名单，
 * 或调用方给定的厂商错误码正则。错误文本里出现 not found / 404 不算数——
 * 把鉴权或限流失败的模糊文案当 404，会让幂等路径误删或误跳过目标资源。
 */

describe('isExplicitNotFound：只认结构化证据', () => {
  it('非 ApiError 的文本线索一律不算', () => {
    expect(isExplicitNotFound(new Error('token service not found'))).toBe(false)
    expect(isExplicitNotFound(new Error('provider returned 404'))).toBe(false)
  })

  it('默认判据不看本地错误码：provider_not_found(404) 返回 false', () => {
    expect(isExplicitNotFound(new ApiError('provider_not_found', 'Provider not found', 404))).toBe(false)
  })

  it('details.upstream_status === 404 是显式的未找到信号', () => {
    expect(isExplicitNotFound(new ApiError('provider_failed', 'upstream missing', 502, { upstream_status: 404 }))).toBe(
      true
    )
    expect(
      isExplicitNotFound(new ApiError('cloudflare_request_failed', 'missing', 502, { upstream_status: 500 }))
    ).toBe(false)
  })

  it('localCodes 白名单命中本地错误码', () => {
    expect(
      isExplicitNotFound(new ApiError('saas_hostname_not_found', 'missing', 404), {
        localCodes: ['saas_hostname_not_found'],
      })
    ).toBe(true)
  })

  it('providerCode 正则锚定厂商错误码，不误伤兄弟错误码', () => {
    expect(
      isExplicitNotFound(
        new ApiError('dnspod_request_failed', 'missing', 502, { code: 'ResourceNotFound.NoDataOfRecord' }),
        { providerCode: /^ResourceNotFound\.NoDataOfRecord$/i }
      )
    ).toBe(true)
    expect(
      isExplicitNotFound(
        new ApiError('dnspod_request_failed', 'domain missing', 502, { code: 'ResourceNotFound.NoDataOfDomain' }),
        { providerCode: /^ResourceNotFound\.NoDataOfRecord$/i }
      )
    ).toBe(false)
  })
})
