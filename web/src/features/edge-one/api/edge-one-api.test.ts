import { afterEach, describe, expect, it, vi } from 'vitest'
import http from '@/shared/api/http'
import { edgeOneApi } from './edge-one-api'

/**
 * 删除接口的 auto_cleanup 映射：界面勾选「跳过 DNS 清理」时，必须真的把 auto_cleanup=false 发到后端，
 * 否则勾选只是一个没有效果的开关。
 */

const DELETE_URL = '/edgeone/providers/provider-1/zones/zone-1/records/www.example.com'

function mockDelete() {
  return vi.spyOn(http, 'delete').mockResolvedValue({ code: 0, message: 'success', data: null })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('edgeOneApi.deleteAccelerationDomain 的 auto_cleanup 映射', () => {
  it('skipCleanup=true → 带 params.auto_cleanup=false', async () => {
    const spy = mockDelete()

    await edgeOneApi.deleteAccelerationDomain('provider-1', 'zone-1', 'www.example.com', { skipCleanup: true })

    expect(spy).toHaveBeenCalledWith(DELETE_URL, { params: { auto_cleanup: false } })
  })

  it('未勾选（或旧调用不带选项）→ 不带该参数，保持既有的连带清理行为', async () => {
    const spy = mockDelete()

    await edgeOneApi.deleteAccelerationDomain('provider-1', 'zone-1', 'www.example.com')

    expect(spy).toHaveBeenCalledWith(DELETE_URL, {})
  })
})
