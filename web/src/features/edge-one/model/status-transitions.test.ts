import { describe, expect, it } from 'vitest'
import {
  displayDomainStatus,
  transitioningKeys,
  type PendingStatusTransitions,
} from '@/features/edge-one/model/status-transitions'

/**
 * 过渡态的派生规则：行数据保持服务端真相，过渡只看待落定集合。
 */

describe('edge-one 过渡态派生', () => {
  it('transitioningKeys 列出全部待落定行，落定后为空', () => {
    const pending: PendingStatusTransitions = new Map([
      ['a.example.com', { target: 'offline' as const, enteredTransition: false }],
      ['b.example.com', { target: 'online' as const, enteredTransition: true }],
    ])
    expect(transitioningKeys(pending)).toEqual(['a.example.com', 'b.example.com'])
    expect(transitioningKeys(new Map())).toEqual([])
  })

  it('displayDomainStatus：过渡中的行按 process 展示，否则用服务端状态（统一小写）', () => {
    expect(displayDomainStatus('online', true)).toBe('process')
    expect(displayDomainStatus('ONLINE', false)).toBe('online')
    expect(displayDomainStatus(undefined, false)).toBe('')
  })
})
