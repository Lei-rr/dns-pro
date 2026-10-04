#!/usr/bin/env node
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { edgeoneDomainParamsSchema } from '../server/src/modules/edge-one/edge-one.schema.js'
import { trimmedParam } from '../server/src/shared/http/route-params.js'

const app = Fastify().withTypeProvider<TypeBoxTypeProvider>()
app.setValidatorCompiler(TypeBoxValidatorCompiler)
let edgeParam = ''
let saasParam = ''
app.get('/edge/:providerId/:zoneId/:domainName', { schema: edgeoneDomainParamsSchema }, async (request) => {
  edgeParam = request.params.domainName.trim()
  return { value: edgeParam }
})
app.get('/saas/:hostnameFqdn', async (request) => {
  saasParam = trimmedParam(request as never, 'hostnameFqdn')
  return { value: saasParam }
})

const edge = await app.inject({ method: 'GET', url: '/edge/p/z/www%2Eexample.com' })
assert.equal(edge.statusCode, 200)
assert.equal(edgeParam, 'www.example.com', 'Fastify path params must be decoded exactly once')
// 双重编码 / 路径穿越 / 非法字符在 schema 层直接拒绝
for (const url of [
  '/edge/p/z/abc%252Fdef',
  '/edge/p/z/..',
  '/edge/p/z/%2E%2E',
  '/edge/p/..%2Fz/a.com',
  '/edge/p%2F../z/a.com',
]) {
  const rejected = await app.inject({ method: 'GET', url })
  assert.ok([400, 404].includes(rejected.statusCode), `${url} must be rejected, got ${rejected.statusCode}`)
}
const saas = await app.inject({ method: 'GET', url: '/saas/abc%25def' })
assert.equal(saas.statusCode, 200, saas.body)
assert.equal(saasParam, 'abc%def', 'literal percent must not become URI malformed')
await app.close()
console.log('request-param-probe=ok')
