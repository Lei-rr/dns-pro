#!/usr/bin/env node
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { edgeoneDomainParamsSchema } from '../server/modules/edge-one/edge-one.schema.js'

const app = Fastify().withTypeProvider<TypeBoxTypeProvider>()
app.setValidatorCompiler(TypeBoxValidatorCompiler)
let edgeParam = ''
let saasParam = ''
app.get('/edge/:providerId/:zoneId/:domainName', { schema: edgeoneDomainParamsSchema }, async (request) => {
  // 路径参数由 schema（不含空白的字符白名单）保证无首尾空白，读取时不再重复 trim
  edgeParam = request.params.domainName
  return { value: edgeParam }
})
app.get('/saas/:hostnameFqdn', async (request) => {
  const params = request.params as { hostnameFqdn: string }
  saasParam = params.hostnameFqdn
  return { value: saasParam }
})

const edge = await app.inject({ method: 'GET', url: '/edge/p/z/www%2Eexample.com' })
assert.equal(edge.statusCode, 200)
assert.equal(edgeParam, 'www.example.com', 'Fastify path params must be decoded exactly once')
// 双重编码 / 路径穿越 / 非法字符在 schema 层直接拒绝；
// 白名单不含空白，带空格的参数同样被拒 —— 这正是调用点不再做 trim 的前提
for (const url of [
  '/edge/p/z/abc%252Fdef',
  '/edge/p/z/..',
  '/edge/p/z/%2E%2E',
  '/edge/p/..%2Fz/a.com',
  '/edge/p%2F../z/a.com',
  '/edge/p/z/%20www.example.com',
  '/edge/p/z/www%20.example.com',
]) {
  const rejected = await app.inject({ method: 'GET', url })
  assert.ok([400, 404].includes(rejected.statusCode), `${url} must be rejected, got ${rejected.statusCode}`)
}
const saas = await app.inject({ method: 'GET', url: '/saas/abc%25def' })
assert.equal(saas.statusCode, 200, saas.body)
assert.equal(saasParam, 'abc%def', 'literal percent must not become URI malformed')
await app.close()
console.log('request-param-probe=ok decode=once trim=unreachable')
