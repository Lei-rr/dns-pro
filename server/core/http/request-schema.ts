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

type Optionalize<Properties extends TProperties, Required extends readonly PropertyKey[]> = {
  [Key in keyof Properties]: Key extends Required[number] ? Properties[Key] : TOptional<Properties[Key]>
}

type NamedStrings<Names extends readonly string[]> = { [Name in Names[number]]: TString }

type NamedBooleanQueries<Names extends readonly string[]> = {
  [Name in Names[number]]: TOptional<TUnion<[TLiteral<'true'>, TLiteral<'false'>]>>
}

type RequestParts = { params?: TSchema; querystring?: TSchema; body?: TSchema }

export type RequestOf<Schema extends RequestParts> = (Schema extends { params: infer Params extends TSchema }
  ? { Params: Static<Params> }
  : object) &
  (Schema extends { querystring: infer Query extends TSchema } ? { Querystring: Static<Query> } : object) &
  (Schema extends { body: infer Body extends TSchema } ? { Body: Static<Body> } : object)

/**
 * 安全字符白名单（值会拼进上游 URL 路径或作为存储键）：
 * - 标识符：首字符为字母数字，禁止 `.`/`..` 等路径段
 * - 域名：字母数字、`-`、`.`、`*`、`_`，必须以字母数字/`*`/`_` 开头
 */
const identifierPattern = (maxLength: number): string =>
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,${Math.max(0, Math.floor(maxLength) - 1)}}$`
const DOMAIN_PATTERN = '^[A-Za-z0-9_*][A-Za-z0-9_.*-]{0,252}$'

// pattern 的长度上限跟随 maxLength：否则传入的 maxLength 会被固定的 {0,127} 卡死
export const identifier = (maxLength = 128): TString =>
  Type.String({ minLength: 1, maxLength, pattern: identifierPattern(maxLength) })
export const domainName = (): TString => Type.String({ minLength: 1, maxLength: 253, pattern: DOMAIN_PATTERN })

// 路径参数按名称自动选择格式，新路由无需逐个声明
const PARAM_FORMATS: Record<string, () => TString> = {
  zone: domainName,
  zoneName: domainName,
  hostnameFqdn: domainName,
  domainName,
  domain: domainName,
}

export const text = (maxLength = 1024): TString => Type.String({ minLength: 1, maxLength })
export const optionalText = (maxLength = 1024): TString => Type.String({ maxLength })
export const bool: TBoolean = Type.Boolean()
export const boolQuery: TUnion<[TLiteral<'true'>, TLiteral<'false'>]> = Type.Union([
  Type.Literal('true'),
  Type.Literal('false'),
])
export const stringList = (minItems = 1, maxItems = 1000): TArray<TString> => Type.Array(text(), { minItems, maxItems })

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

/** 路径参数：域名类参数用域名白名单，其余一律按标识符白名单 */
export function paramsSchema<const Names extends readonly string[]>(...names: Names): TObject<NamedStrings<Names>> {
  const properties = Object.fromEntries(
    names.map((name) => [name, (PARAM_FORMATS[name] ?? identifier)()])
  ) as NamedStrings<Names>
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
