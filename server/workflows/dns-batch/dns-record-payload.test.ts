import { describe, expect, it } from 'vitest'
import { normalizeCreateRecords } from './dns-record-payload.js'

/**
 * 批量新增的去重键包含取值：同名同类型同线路、但取值不同的记录必须全部保留，
 * 否则用户提交的其中一条会静默消失；完全重复的条目才允许合并。
 */

describe('normalizeCreateRecords：槽位去重不得吞掉不同取值', () => {
  it('同槽位不同 value 的两条 TXT 都保留', () => {
    const records = normalizeCreateRecords([
      { name: '@', type: 'TXT', value: 'one', line: '默认' },
      { name: '@', type: 'TXT', value: 'two', line: '默认' },
    ])
    expect(records).toHaveLength(2)
    expect(records.map((record) => record.value)).toEqual(['one', 'two'])
  })

  it('完全重复的条目才被合并（去重键包含取值）', () => {
    const records = normalizeCreateRecords([
      { name: '@', type: 'TXT', value: 'one', line: '默认' },
      { name: '@', type: 'TXT', value: 'one', line: '默认' },
    ])
    expect(records).toHaveLength(1)
  })
})
