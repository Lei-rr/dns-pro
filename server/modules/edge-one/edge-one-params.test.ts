import Fastify from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { describe, expect, it } from 'vitest'
import { edgeoneDomainParamsSchema } from './edge-one.schema.js'

/**
 * 迁移自 scripts/isolated-request-param-probe.ts（路径参数边界）。
 * 路径参数由 schema（不含空白的字符白名单）保证无首尾空白，读取时不再重复 trim；
 * 双重编码 / 路径穿越 / 非法字符在 schema 层直接拒绝——这正是调用点不做 trim 的前提。
 */

const REJECTED_EDGE_URLS = [
  '/edge/p/z/abc%252Fdef',
  '/edge/p/z/..',
  '/edge/p/z/%2E%2E',
  '/edge/p/..%2Fz/a.com',
  '/edge/p%2F../z/a.com',
  '/edge/p/z/%20www.example.com',
  '/edge/p/z/www%20.example.com',
]

describe('路径参数解码与白名单', () => {
  it('Fastify 路径参数只解码一次；双重编码/穿越/空白一律被拒', async () => {
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>()
    app.setValidatorCompiler(TypeBoxValidatorCompiler)
    let edgeParam = ''
    app.get('/edge/:providerId/:zoneId/:domainName', { schema: edgeoneDomainParamsSchema }, async (request) => {
      edgeParam = (request.params as { domainName: string }).domainName
      return { value: edgeParam }
    })

    const edge = await app.inject({ method: 'GET', url: '/edge/p/z/www%2Eexample.com' })
    expect(edge.statusCode).toBe(200)
    expect(edgeParam).toBe('www.example.com')

    for (const url of REJECTED_EDGE_URLS) {
      const rejected = await app.inject({ method: 'GET', url })
      expect([400, 404], url).toContain(rejected.statusCode)
    }
    await app.close()
  })

  it('字面百分号经一次解码后原样保留，不得变成 URI malformed', async () => {
    const app = Fastify()
    let saasParam = ''
    app.get('/saas/:hostnameFqdn', async (request) => {
      saasParam = (request.params as { hostnameFqdn: string }).hostnameFqdn
      return { value: saasParam }
    })

    const saas = await app.inject({ method: 'GET', url: '/saas/abc%25def' })
    expect(saas.statusCode, saas.body).toBe(200)
    expect(saasParam).toBe('abc%def')
    await app.close()
  })
})
