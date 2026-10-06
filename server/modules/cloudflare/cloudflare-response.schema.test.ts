import { describe, expect, it } from 'vitest'
import { ApiError } from '../../core/http/api-error.js'
import { parseCloudflareItemResponse, parseCloudflareListResponse } from './cloudflare-response.schema.js'

/**
 * 上游响应结构不符时必须抛 cloudflare_invalid_response（502）：
 * 空对象或非数组不是「空列表」，把契约变更当成功返回会掩盖上游行为变化。
 */

const present = (item: Record<string, unknown>) => item

function capture(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('预期抛错但未抛出')
}

const cases: Array<{ label: string; parse: () => unknown }> = [
  { label: '列表响应缺 result', parse: () => parseCloudflareListResponse({}, present) },
  { label: '列表响应的 result 不是数组', parse: () => parseCloudflareListResponse({ result: {} }, present) },
  { label: '单条响应的 result 是空对象', parse: () => parseCloudflareItemResponse({ result: {} }) },
]

describe('Cloudflare 响应解析：结构不符即 502', () => {
  it.each(cases)('$label', ({ parse }) => {
    const error = capture(parse)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'cloudflare_invalid_response', statusCode: 502 })
  })
})
