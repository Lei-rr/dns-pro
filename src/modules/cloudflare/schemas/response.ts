import { z } from 'zod'

export const cloudflareZoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().nullish(),
    type: z.string().nullish(),
    paused: z.boolean().nullish(),
    account: z.unknown().nullish(),
    name_servers: z.array(z.string()).nullish().transform((value) => value ?? []),
    original_name_servers: z.array(z.string()).nullish().transform((value) => value ?? []),
    created_on: z.string().nullish(),
    modified_on: z.string().nullish(),
    activated_on: z.string().nullish(),
  })
  .passthrough()

export type CloudflareZone = z.infer<typeof cloudflareZoneSchema>

export const cloudflareDnsRecordSchema = z
  .object({
    id: z.string(),
    zone_id: z.string().nullish(),
    zone_name: z.string().nullish(),
    name: z.string(),
    type: z.string(),
    content: z.string(),
    ttl: z.number(),
    proxied: z.boolean().nullish(),
    proxiable: z.boolean().nullish(),
    priority: z.number().nullish(),
    comment: z.string().nullish(),
    tags: z.array(z.string()).nullish().transform((value) => value ?? []),
    created_on: z.string().nullish(),
    modified_on: z.string().nullish(),
  })
  .passthrough()

export type CloudflareDnsRecord = z.infer<typeof cloudflareDnsRecordSchema>

export const cloudflareResultInfoSchema = z
  .object({
    page: z.number().nullish(),
    per_page: z.number().nullish(),
    count: z.number().nullish(),
    total_count: z.number().nullish(),
    total_pages: z.number().nullish(),
  })
  .passthrough()

export type CloudflareResultInfo = z.infer<typeof cloudflareResultInfoSchema>

export const cloudflareCustomHostnameSchema = z
  .object({
    id: z.string().nullish(),
    hostname: z.string().nullish(),
    status: z.string().nullish(),
    custom_origin_server: z.string().nullish(),
    ssl: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
    ownership_verification: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
    custom_metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough()

export type CloudflareCustomHostnameResponse = z.infer<typeof cloudflareCustomHostnameSchema>

export const cloudflareApiResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  messages: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  result: z.unknown().nullish(),
  result_info: z.record(z.string(), z.unknown()).nullish(),
})

export type CloudflareApiResponse = z.infer<typeof cloudflareApiResponseSchema>

export function parseCloudflareListResponse<T>(
  response: unknown,
  itemSchema: z.ZodType<T>
): { result: T[]; result_info: CloudflareResultInfo | undefined } {
  const parsed = cloudflareApiResponseSchema.parse(response)
  const resultInfo = parsed.result_info ? cloudflareResultInfoSchema.parse(parsed.result_info) : undefined
  const result = z.array(z.unknown()).parse(parsed.result ?? [])
  return { result: result.map((item) => itemSchema.parse(item)), result_info: resultInfo }
}

export function parseCloudflareItemResponse<T>(response: unknown, itemSchema: z.ZodType<T>): { result: T } {
  const parsed = cloudflareApiResponseSchema.parse(response)
  return { result: itemSchema.parse(parsed.result ?? {}) }
}

export const cloudflareIdResultSchema = z
  .object({
    id: z.string(),
  })
  .passthrough()

export const cloudflareDcvDelegationSchema = z
  .object({
    uuid: z.string(),
  })
  .passthrough()

export const cloudflareFallbackOriginSchema = z
  .object({
    origin: z.string().nullish(),
    status: z.string().nullish(),
  })
  .passthrough()

export type CloudflareFallbackOrigin = z.infer<typeof cloudflareFallbackOriginSchema>

export const cloudflareTunnelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().nullish(),
    config_src: z.string().nullish(),
    remote_config: z.boolean().nullish(),
    connections: z.array(z.record(z.string(), z.unknown())).nullish().transform((value) => value ?? []),
    conns_active_at: z.string().nullish(),
    conns_inactive_at: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough()

export type CloudflareTunnel = z.infer<typeof cloudflareTunnelSchema>

export const cloudflareRouteConfigSchema = z
  .object({
    config: z
      .object({
        ingress: z
          .array(
            z.record(z.string(), z.unknown()).and(
              z.object({ hostname: z.string().nullish(), service: z.string().nullish() })
            )
          )
          .nullish()
          .transform((value) => value ?? []),
      })
      .passthrough()
      .nullish(),
    version: z.number().nullish(),
  })
  .passthrough()

export type CloudflareRouteConfig = z.infer<typeof cloudflareRouteConfigSchema>
