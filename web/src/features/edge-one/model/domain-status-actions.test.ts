import { describe, expect, it } from 'vitest'
import { edgeOneDomainStatusActions } from './domain-status-actions'

/** 无操作矩阵：四个开关全 false（未知状态与"不可操作"共用同一形状） */
const none = { canStop: false, canEnable: false, canRemove: false, configuring: false }

describe('EdgeOne 加速域名状态动作矩阵（真机实测语义）', () => {
  it('online：只能停止加速 —— 此时直接删除会被上游拒绝，必须先停止', () => {
    expect(edgeOneDomainStatusActions('online')).toEqual({ ...none, canStop: true })
  })

  it('offline：可启用也可删除 —— 停用是稳定态而非终点，删除是两步走的第二步', () => {
    expect(edgeOneDomainStatusActions('offline')).toEqual({ ...none, canEnable: true, canRemove: true })
  })

  it('process：上游配置下发中，停止/启用与删除全部不可用', () => {
    expect(edgeOneDomainStatusActions('process')).toEqual({ ...none, configuring: true })
  })

  it('未知状态（forbidden / init / 空 / undefined）不给任何状态动作', () => {
    for (const status of ['forbidden', 'init', '', undefined]) {
      expect(edgeOneDomainStatusActions(status)).toEqual(none)
    }
  })

  it('状态大小写不敏感：上游返回大写或首字母大写同样识别', () => {
    expect(edgeOneDomainStatusActions('ONLINE').canStop).toBe(true)
    expect(edgeOneDomainStatusActions('Offline').canRemove).toBe(true)
    expect(edgeOneDomainStatusActions('Process').configuring).toBe(true)
  })

  it('返回值始终是完整四开关：调用方无需处理缺字段', () => {
    expect(Object.keys(edgeOneDomainStatusActions('online')).sort()).toEqual([
      'canEnable',
      'canRemove',
      'canStop',
      'configuring',
    ])
  })
})
