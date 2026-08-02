#!/usr/bin/env node
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { edgeoneDomainParamsSchema } from '../server/src/modules/edge-one/edge-one.schema.js'
import { hostnameFqdnParam } from '../server/src/modules/saas/saas-request-params.js'

const app = Fastify().withTypeProvider<TypeBoxTypeProvider>()
app.setValidatorCompiler(TypeBoxValidatorCompiler)
let edgeParam = ''
let saasParam = ''
app.get('/edge/:providerId/:zoneId/:domainName', { schema: edgeoneDomainParamsSchema }, async (request) => {
  edgeParam = request.params.domainName.trim()
  return { value: edgeParam }
})
app.get('/saas/:hostnameFqdn', async (request) => {
  saasParam = hostnameFqdnParam(request as never)
  return { value: saasParam }
})

const edge = await app.inject({ method: 'GET', url: '/edge/p/z/abc%252Fdef' })
assert.equal(edge.statusCode, 200)
assert.equal(edgeParam, 'abc%2Fdef', 'Fastify path params must be decoded exactly once')
const saas = await app.inject({ method: 'GET', url: '/saas/abc%25def' })
assert.equal(saas.statusCode, 200, saas.body)
assert.equal(saasParam, 'abc%def', 'literal percent must not become URI malformed')
await app.close()
console.log('request-param-probe=ok')
