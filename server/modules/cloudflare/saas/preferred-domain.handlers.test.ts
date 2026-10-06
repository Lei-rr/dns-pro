import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp, cookieLineOf, makeTempDataDir } from '../../../app/test-helpers.js'

/**
 * 优选域名白名单接口的路由层：列表 / 新增 / 排序（sort-order）/ 改名 / 删除。
 *
 * 这组路由不依赖上游，断言落在 HTTP 状态码、`data` 形状（domain + sort）、写后读可见性与
 * 排序语义上；归一化规则本身由 service 侧覆盖，这里只验证「请求进得来、结果出得去」。
 */

const OWNER = { username: 'owner', password: 'preferred-domain-password' }
const BASE = '/api/saas/preferred-domains'

let app: FastifyInstance
let sessionCookie = ''

const authorized = (options: InjectOptions) => app.inject({ ...options, headers: { cookie: sessionCookie } })

const listItems = async (): Promise<Array<{ domain: string; sort: number }>> => {
  const response = await authorized({ method: 'GET', url: BASE })
  expect(response.statusCode, response.body).toBe(200)
  return response.json().data.items
}

const domainsOf = (items: Array<{ domain: string }>) => items.map((item) => item.domain)

beforeAll(async () => {
  const dataDir = await makeTempDataDir('dns-pro-preferred-domain-handlers-')
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({ auth: OWNER }, null, 2)}\n`)
  app = await buildTestApp(dataDir)
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: OWNER })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieLineOf(login)
})

afterAll(async () => {
  await app.close()
})

describe('优选域名接口的鉴权作用域', () => {
  it('五条端点都在鉴权作用域内：匿名请求一律 401', async () => {
    const requests: InjectOptions[] = [
      { method: 'GET', url: BASE },
      { method: 'POST', url: BASE, payload: { domain: 'anon.example.com' } },
      { method: 'PUT', url: `${BASE}/sort-order`, payload: { domains: [] } },
      { method: 'PUT', url: `${BASE}/anon.example.com`, payload: { domain: 'anon2.example.com' } },
      { method: 'DELETE', url: `${BASE}/anon.example.com` },
    ]
    for (const request of requests) {
      expect((await app.inject(request)).statusCode, `${request.method} ${request.url}`).toBe(401)
    }
  })
})

describe('GET / 列表', () => {
  it('服务层抛错时如实返回 500，不吞成空列表', async () => {
    const domainService = app.ctx.modules.saas.preferredDomains
    const original = domainService.list
    domainService.list = async () => {
      throw new Error('fake preferred domain store failure')
    }
    try {
      const response = await authorized({ method: 'GET', url: BASE })
      expect(response.statusCode).toBe(500)
      expect(response.json().code).toBe('internal_error')
      expect(response.json().data).toBeUndefined()
    } finally {
      domainService.list = original
    }

    // 还原后列表照常可读，确认上面的失败不是被测试夹具本身污染的
    expect(Array.isArray(await listItems())).toBe(true)
  })
})

describe('POST / 新增优选域名', () => {
  it('201 返回归一化后的域名与序号，列表随之可见', async () => {
    const response = await authorized({
      method: 'POST',
      url: BASE,
      payload: { domain: 'https://First.Example.com.' },
    })
    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toEqual({ domain: 'first.example.com', sort: 0 })

    const items = await listItems()
    expect(domainsOf(items)).toContain('first.example.com')
    expect(items.find((item) => item.domain === 'first.example.com')?.sort).toBe(0)
    expect(items.every((item, index) => item.sort === index)).toBe(true)
  })

  it('重复域名（含归一化等价写法）422 preferred_domain_duplicate', async () => {
    const created = await authorized({ method: 'POST', url: BASE, payload: { domain: 'dup.example.com' } })
    expect(created.statusCode, created.body).toBe(201)

    const duplicate = await authorized({
      method: 'POST',
      url: BASE,
      payload: { domain: 'https://DUP.Example.com' },
    })
    expect(duplicate.statusCode).toBe(422)
    expect(duplicate.json().code).toBe('preferred_domain_duplicate')
    expect(domainsOf(await listItems()).filter((domain) => domain === 'dup.example.com')).toHaveLength(1)
  })

  it('非法格式 422 preferred_domain_invalid，空串 400 参数校验失败', async () => {
    const invalid = await authorized({ method: 'POST', url: BASE, payload: { domain: 'not a domain' } })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json().code).toBe('preferred_domain_invalid')

    const empty = await authorized({ method: 'POST', url: BASE, payload: { domain: '' } })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().code).toBe('validation_error')
    expect(empty.json().details.errors).toHaveProperty('domain')
  })
})

describe('PUT /sort-order 排序', () => {
  it('按提交顺序重排：未提交项与重复项都不改变其余条目的相对顺序', async () => {
    for (const domain of ['order-c.example.com', 'order-a.example.com', 'order-b.example.com']) {
      const created = await authorized({ method: 'POST', url: BASE, payload: { domain } })
      expect(created.statusCode, created.body).toBe(201)
    }
    const before = domainsOf(await listItems())
    const last = before.at(-1) ?? ''
    const expected = [last, ...before.filter((domain) => domain !== last)]

    const response = await authorized({
      method: 'PUT',
      url: `${BASE}/sort-order`,
      payload: { domains: [last, last, 'order-missing.example.com'] },
    })
    expect(response.statusCode, response.body).toBe(200)

    const reordered = response.json().data.items as Array<{ domain: string; sort: number }>
    // 只有被提交的域名被提到最前，其余条目保持原有相对顺序；未知域名与重复项被忽略
    expect(domainsOf(reordered)).toEqual(expected)
    expect(reordered.every((item, index) => item.sort === index)).toBe(true)
    expect(domainsOf(reordered)).not.toContain('order-missing.example.com')
    expect(domainsOf(await listItems())).toEqual(expected)
  })

  it('domains 缺失或元素非字符串：400 参数校验失败', async () => {
    const missing = await authorized({ method: 'PUT', url: `${BASE}/sort-order`, payload: {} })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().code).toBe('validation_error')
    expect(missing.json().details.errors).toHaveProperty('domains')

    const notStrings = await authorized({ method: 'PUT', url: `${BASE}/sort-order`, payload: { domains: [1] } })
    expect(notStrings.statusCode).toBe(400)
    expect(notStrings.json().code).toBe('validation_error')
  })
})

describe('PUT /:domain 改名', () => {
  it('旧域名按归一化写法匹配，序号保持不变，列表里只剩新名', async () => {
    const created = await authorized({ method: 'POST', url: BASE, payload: { domain: 'twin-b.example.com' } })
    expect(created.statusCode, created.body).toBe(201)
    const sort = (created.json().data as { sort: number }).sort

    const renamed = await authorized({
      method: 'PUT',
      url: `${BASE}/Twin-B.Example.com.`,
      payload: { domain: 'Twin-Renamed.Example.com' },
    })
    expect(renamed.statusCode, renamed.body).toBe(200)
    expect(renamed.json().data).toEqual({ domain: 'twin-renamed.example.com', sort })

    const items = await listItems()
    expect(domainsOf(items)).toContain('twin-renamed.example.com')
    expect(domainsOf(items)).not.toContain('twin-b.example.com')
    expect(items.find((item) => item.domain === 'twin-renamed.example.com')?.sort).toBe(sort)
  })

  it('改到已存在的域名 422 duplicate；旧域名不存在 404 not_found', async () => {
    for (const domain of ['twin-a.example.com', 'twin-c.example.com']) {
      const created = await authorized({ method: 'POST', url: BASE, payload: { domain } })
      expect(created.statusCode, created.body).toBe(201)
    }

    const duplicate = await authorized({
      method: 'PUT',
      url: `${BASE}/twin-c.example.com`,
      payload: { domain: 'twin-a.example.com' },
    })
    expect(duplicate.statusCode).toBe(422)
    expect(duplicate.json().code).toBe('preferred_domain_duplicate')

    const missing = await authorized({
      method: 'PUT',
      url: `${BASE}/ghost.example.com`,
      payload: { domain: 'ghost-renamed.example.com' },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().code).toBe('preferred_domain_not_found')
    expect(domainsOf(await listItems())).not.toContain('ghost-renamed.example.com')
  })
})

describe('DELETE /:domain 删除', () => {
  it('204 空响应且列表不再包含；重复删除 404 not_found', async () => {
    const created = await authorized({ method: 'POST', url: BASE, payload: { domain: 'delete-me.example.com' } })
    expect(created.statusCode, created.body).toBe(201)

    const removed = await authorized({ method: 'DELETE', url: `${BASE}/Delete-Me.Example.com.` })
    expect(removed.statusCode, removed.body).toBe(204)
    expect(removed.body).toBe('')
    expect(domainsOf(await listItems())).not.toContain('delete-me.example.com')

    const again = await authorized({ method: 'DELETE', url: `${BASE}/delete-me.example.com` })
    expect(again.statusCode).toBe(404)
    expect(again.json().code).toBe('preferred_domain_not_found')
  })
})
