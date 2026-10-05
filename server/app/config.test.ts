import { describe, expect, it } from 'vitest'
import { loadAppConfig } from './config.js'

/**
 * TRUST_PROXY=true 会被 Fastify 原样当作「信任任意转发头」：
 * 直连客户端带一个 X-Forwarded-For 就能冒充来源 IP，
 * 按 IP 的失败计数、账号锁定与登录限流键全部失效，因此环境变量侧直接拒绝。
 */

describe('TRUST_PROXY 解析', () => {
  it('拒绝 true（含大小写变体）', () => {
    expect(() => loadAppConfig({}, { TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
    expect(() => loadAppConfig({}, { TRUST_PROXY: 'TRUE' })).toThrow(/TRUST_PROXY/)
  })

  it('仍拒绝数字跳数', () => {
    expect(() => loadAppConfig({}, { TRUST_PROXY: '2' })).toThrow(/TRUST_PROXY/)
  })

  it('false 与可信网段列表照常可用', () => {
    expect(loadAppConfig({}, { TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(loadAppConfig({}, { TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8'])
    expect(loadAppConfig({}, {}).trustProxy).toBe(false)
  })

  it('程序内 overrides 仍可显式传 boolean（探针与嵌入式装配用）', () => {
    expect(loadAppConfig({ trustProxy: true }, {}).trustProxy).toBe(true)
  })
})
