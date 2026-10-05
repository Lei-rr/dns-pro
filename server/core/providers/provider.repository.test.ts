import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../http/api-error.js'
import { createSecretBox } from '../crypto/secret-box.js'
import { createStore } from '../store/store-registry.js'
import { ProviderRepository, type ProvidersFile } from './provider.repository.js'
import type { Provider } from './provider.types.js'

/**
 * providers.json 语义损坏（`{}` 或 items 非数组）必须按损坏处理、显式报错。
 * 兜底成空表的话，任一写事务都会把空表整文件替换落盘：其余服务商连同 AES 密文凭据一起消失且不可恢复。
 */

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-providers-'))
})

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true })
})

const providersFile = () => path.join(dataRoot, 'providers.json')

function repository(): ProviderRepository {
  return new ProviderRepository(createStore('providers', dataRoot), createSecretBox(Buffer.alloc(32, 7)))
}

/** 断言拒绝原因是对应的 ApiError：实例类型 + 错误码 + 状态码 */
async function expectApiError(run: () => Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await run().then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ code, statusCode })
}

describe('providers.json 结构损坏不得被读成空表', () => {
  it('items 非数组：读与写都报错，写事务不覆盖原文件', async () => {
    const broken = `${JSON.stringify({ items: { 'p-1': { type: 'dnspod', id: 'p-1' } } })}\n`
    await fs.writeFile(providersFile(), broken)

    await expectApiError(() => repository().all(), 'server_error', 500)
    await expectApiError(() => repository().mutateAll((providers) => providers), 'server_error', 500)
    expect(await fs.readFile(providersFile(), 'utf8')).toBe(broken)
  })

  it('文件被写成空对象：同样拒绝写入，原文件保持原样', async () => {
    await fs.writeFile(providersFile(), '{}')
    await expectApiError(() => repository().mutateAll((providers) => providers), 'server_error', 500)
    expect(await fs.readFile(providersFile(), 'utf8')).toBe('{}')
  })

  it('items 为空数组仍是合法空表：写入照常，密文凭据以密文落盘', async () => {
    await fs.writeFile(providersFile(), JSON.stringify({ items: [] }))
    const added: Provider = {
      type: 'dnspod',
      id: 'p-1',
      name: 'DNSPod',
      secret_id: 'sid',
      secret_key: 'skey',
    }

    const saved = await repository().mutateAll((providers) => [...providers, added])
    expect(saved).toHaveLength(1)

    const onDisk = JSON.parse(await fs.readFile(providersFile(), 'utf8')) as ProvidersFile
    expect(onDisk.items).toHaveLength(1)
    expect(onDisk.items[0]?.secret_key).not.toBe('skey')
    expect(String(onDisk.items[0]?.secret_key)).toMatch(/^enc:v1:/)
  })
})
