import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../http/api-error.js'
import { createStore } from './store-registry.js'

/**
 * 顶层非对象的 JSON（数组 / 标量 / null）与语法损坏同级：按损坏处理、不自动覆盖。
 * 否则会被下游的 `?? {}` 兜底成空表，写事务再把整份文件覆盖掉，数据不可恢复。
 */

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-store-'))
})

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true })
})

describe('JsonStore 的结构损坏判定', () => {
  it('顶层是数组：读取报错，事务拒绝写入且文件未被覆盖', async () => {
    const file = path.join(dataRoot, 'providers.json')
    await fs.writeFile(file, '[]')
    const store = createStore('providers', dataRoot)

    await expect(store.read()).rejects.toBeInstanceOf(ApiError)
    await expect(store.transaction(() => ({ next: { items: [] } }))).rejects.toMatchObject({
      code: 'server_error',
    })
    expect(await fs.readFile(file, 'utf8')).toBe('[]')
  })

  it('顶层是标量：同样按损坏处理，不返回默认值', async () => {
    const file = path.join(dataRoot, 'providers.json')
    await fs.writeFile(file, '42')
    const store = createStore('providers', dataRoot)

    await expect(store.readFresh()).rejects.toMatchObject({ code: 'server_error' })
    expect(await fs.readFile(file, 'utf8')).toBe('42')
  })
})
