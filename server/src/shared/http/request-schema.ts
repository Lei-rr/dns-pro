import type { FastifySchema } from 'fastify'
import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TOptional,
  type TProperties,
  type TSchema,
  type TString,
  type TUnion,
} from 'typebox'

export type JsonSchema = TSchema

type Optionalize<Properties extends TProperties, Required extends readonly PropertyKey[]> = {
  [Key in keyof Properties]: Key extends Required[number] ? Properties[Key] : TOptional<Properties[Key]>
}

type NamedStrings<Names extends readonly string[]> = {
  [Name in Names[number]]: TString
}

type NamedBooleanQueries<Names extends readonly string[]> = {
  [Name in Names[number]]: TOptional<TUnion<[TLiteral<'true'>, TLiteral<'false'>]>>
}

export type RequestParts = {
  params?: TSchema
  querystring?: TSchema
  body?: TSchema
}

export type RequestOf<Schema extends RequestParts> = (Schema extends { params: infer Params extends TSchema }
  ? { Params: Static<Params> }
  : object) &
  (Schema extends { querystring: infer Query extends TSchema } ? { Querystring: Static<Query> } : object) &
  (Schema extends { body: infer Body extends TSchema } ? { Body: Static<Body> } : object)

export const text = (maxLength = 1024): TString => Type.String({ minLength: 1, maxLength })
export const optionalText = (maxLength = 1024): TString => Type.String({ maxLength })
export const bool: TBoolean = Type.Boolean()
export const boolQuery: TUnion<[TLiteral<'true'>, TLiteral<'false'>]> = Type.Union([
  Type.Literal('true'),
  Type.Literal('false'),
])
export const stringList = (minItems = 1): TArray<TString> => Type.Array(text(), { minItems })

export function objectSchema<Properties extends TProperties, const Required extends readonly (keyof Properties)[] = []>(
  properties: Properties,
  required: Required = [] as unknown as Required,
  additionalProperties = false
): TObject<Optionalize<Properties, Required>> {
  const optionalProperties = Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => [name, required.includes(name) ? schema : Type.Optional(schema)])
  ) as Optionalize<Properties, Required>
  return Type.Object(optionalProperties, { additionalProperties })
}

export function paramsSchema<const Names extends readonly string[]>(...names: Names): TObject<NamedStrings<Names>> {
  const properties = Object.fromEntries(names.map((name) => [name, text(1024)])) as NamedStrings<Names>
  return Type.Object(properties, { additionalProperties: false })
}

export function booleanQuerySchema<const Names extends readonly string[]>(
  ...names: Names
): TObject<NamedBooleanQueries<Names>> {
  const properties = Object.fromEntries(
    names.map((name) => [name, Type.Optional(boolQuery)])
  ) as NamedBooleanQueries<Names>
  return Type.Object(properties, { additionalProperties: false })
}

export function requestSchema<const Parts extends RequestParts>(parts: Parts): Parts {
  return parts
}

export const noRequestSchema = {} satisfies FastifySchema

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2 ? true : false
type Expect<Value extends true> = Value
export const requestSchemaTypeContractSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  body: objectSchema({ username: text(255), nickname: text(255) }, ['username']),
})
type ContractRequest = RequestOf<typeof requestSchemaTypeContractSchema>
export type RequestSchemaTypeContract = Expect<Equal<ContractRequest['Params'], { providerId: string; zone: string }>> &
  Expect<Equal<ContractRequest['Body'], { username: string; nickname?: string }>>
