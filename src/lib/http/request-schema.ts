import type { FastifySchema } from 'fastify'

type JsonSchema = Record<string, unknown>

export const text = (maxLength = 1024): JsonSchema => ({ type: 'string', minLength: 1, maxLength })
export const optionalText = (maxLength = 1024): JsonSchema => ({ type: 'string', maxLength })
export const bool: JsonSchema = { type: 'boolean' }
export const boolQuery: JsonSchema = { type: 'string', enum: ['true', 'false'] }
export const stringList = (minItems = 1): JsonSchema => ({
  type: 'array',
  minItems,
  items: text(),
})

export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  additionalProperties = false,
): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties,
  }
}

export function paramsSchema(...names: string[]): JsonSchema {
  return objectSchema(Object.fromEntries(names.map((name) => [name, text(1024)])), names)
}

export function booleanQuerySchema(...names: string[]): JsonSchema {
  return objectSchema(Object.fromEntries(names.map((name) => [name, boolQuery])))
}

export function requestSchema(parts: {
  params?: JsonSchema
  querystring?: JsonSchema
  body?: JsonSchema
} = {}): FastifySchema {
  return parts
}

export const noRequestSchema: FastifySchema = {}
