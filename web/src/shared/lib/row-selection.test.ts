import { describe, expect, it } from 'vitest'
import { selectableRowKeys, selectedAvailableRows } from './row-selection'

/**
 * 行选择与忙行：正在执行批量操作的行不可选中；已选中的行变忙后不再算「可用」。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役）。
 */

const rows = [{ id: 'ready-a' }, { id: 'busy' }, { id: 'ready-b' }]
const busyRows = new Set(['busy'])
const getKey = (row: { id: string }) => row.id
const isBusy = (row: { id: string }) => busyRows.has(row.id)

describe('行选择与忙行', () => {
  it('selectableRowKeys 过滤掉忙行', () => {
    expect(selectableRowKeys(rows, getKey, isBusy)).toEqual(['ready-a', 'ready-b'])
  })

  it('selectedAvailableRows 不把已选中的忙行当作可用', () => {
    expect(selectedAvailableRows(rows, ['ready-a', 'busy'], getKey, isBusy)).toEqual([{ id: 'ready-a' }])
  })
})
