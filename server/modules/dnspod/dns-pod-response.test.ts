import { describe, expect, it } from 'vitest'
import { ApiError } from '../../core/http/api-error.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainListResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
} from './dns-pod-response.schema.js'

/**
 * DNSPod 各响应的必需字段缺失时必须抛 dnspod_invalid_response（502）：
 * 列表字段为 null、创建缺 DomainInfo、变更缺 RecordId 都说明上游契约变了，
 * 继续往下走会把「没拿到数据」误当成「记录不存在」。
 */

function capture(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('预期抛错但未抛出')
}

const cases: Array<{ label: string; parse: () => unknown }> = [
  { label: '域名列表缺 DomainList', parse: () => dnspodDomainListResponseSchema.parse({}) },
  { label: '记录列表的 RecordList 为 null', parse: () => dnspodRecordListResponseSchema.parse({ RecordList: null }) },
  { label: '域名创建缺 DomainInfo', parse: () => dnspodDomainCreateResponseSchema.parse({ RequestId: 'only' }) },
  { label: '记录变更缺 RecordId', parse: () => dnspodRecordMutationResponseSchema.parse({ RequestId: 'only' }) },
]

describe('DNSPod 响应解析：结构不符即 502', () => {
  it.each(cases)('$label', ({ parse }) => {
    const error = capture(parse)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'dnspod_invalid_response', statusCode: 502 })
  })

  it('域名列表的 DomainList 为 null 时同样是 dnspod_invalid_response（502）', () => {
    const error = capture(() => dnspodDomainListResponseSchema.parse({ DomainList: null }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'dnspod_invalid_response', statusCode: 502 })
  })
})
