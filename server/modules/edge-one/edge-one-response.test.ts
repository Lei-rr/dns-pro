import { describe, expect, it } from 'vitest'
import { ApiError } from '../../core/http/api-error.js'
import {
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
  edgeoneZoneListResponseSchema,
} from './edge-one-response.schema.js'

/**
 * EdgeOne 各响应的必需字段缺失时必须抛 edgeone_invalid_response（502）：
 * Zones / AccelerationDomains 为 null 或变更响应没有 RequestId 都属于契约不符，
 * 静默放行会让后续流程按空数据推进。
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
  { label: '站点列表缺 Zones', parse: () => edgeoneZoneListResponseSchema.parse({}) },
  {
    label: '加速域名列表的 AccelerationDomains 为 null',
    parse: () => edgeoneAccelerationDomainListResponseSchema.parse({ AccelerationDomains: null }),
  },
  {
    label: '加速域名创建缺 RequestId',
    parse: () => edgeoneAccelerationDomainCreateResponseSchema.parse({}),
  },
  { label: '变更响应缺 RequestId', parse: () => edgeoneMutationResponseSchema.parse({}) },
]

describe('EdgeOne 响应解析：结构不符即 502', () => {
  it.each(cases)('$label', ({ parse }) => {
    const error = capture(parse)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'edgeone_invalid_response', statusCode: 502 })
  })

  it('站点列表的 Zones 为 null 时同样是 edgeone_invalid_response（502）', () => {
    const error = capture(() => edgeoneZoneListResponseSchema.parse({ Zones: null }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'edgeone_invalid_response', statusCode: 502 })
  })
})
