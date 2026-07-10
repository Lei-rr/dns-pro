import { z } from 'zod'

export const cloudflareZoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    type: z.string().optional(),
    paused: z.boolean().optional(),
    account: z.unknown().optional(),
    name_servers: z.array(z.string()).optional(),
    original_name_servers: z.array(z.string()).optional(),
    created_on: z.string().optional(),
    modified_on: z.string().optional(),
    activated_on: z.string().optional(),
  })
  .passthrough()

export type CloudflareZone = z.infer<typeof cloudflareZoneSchema>

export const cloudflareDnsRecordSchema = z
  .object({
    id: z.string(),
    zone_id: z.string(),
    zone_name: z.string(),
    name: z.string(),
    type: z.string(),
    content: z.string(),
    ttl: z.number(),
    proxied: z.boolean().optional(),
    proxiable: z.boolean().optional(),
    priority: z.number().optional(),
    comment: z.string().optional(),
    tags: z.array(z.string()).optional(),
    created_on: z.string().optional(),
    modified_on: z.string().optional(),
  })
  .passthrough()

export type CloudflareDnsRecord = z.infer<typeof cloudflareDnsRecordSchema>

export const cloudflareResultInfoSchema = z
  .object({
    page: z.number().optional(),
    per_page: z.number().optional(),
    count: z.number().optional(),
    total_count: z.number().optional(),
    total_pages: z.number().optional(),
  })
  .passthrough()

export type CloudflareResultInfo = z.infer<typeof cloudflareResultInfoSchema>

export const cloudflareCustomHostnameSchema = z
  .object({
    id: z.string().optional(),
    hostname: z.string().optional(),
    status: z.string().optional(),
    custom_origin_server: z.string().nullable().optional(),
    ssl: z.record(z.string(), z.unknown()).optional(),
    ownership_verification: z.record(z.string(), z.unknown()).optional(),
    custom_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()

export type CloudflareCustomHostnameResponse = z.infer<typeof cloudflareCustomHostnameSchema>

export const cloudflareApiResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.unknown()),
  messages: z.array(z.unknown()),
  result: z.unknown(),
  result_info: z.record(z.string(), z.unknown()).optional(),
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
    origin: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough()

export type CloudflareFallbackOrigin = z.infer<typeof cloudflareFallbackOriginSchema>

export const cloudflareTunnelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    config_src: z.string().optional(),
    remote_config: z.boolean().optional(),
    connections: z.array(z.record(z.string(), z.unknown())).optional(),
    conns_active_at: z.string().optional(),
    conns_inactive_at: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough()

export type CloudflareTunnel = z.infer<typeof cloudflareTunnelSchema>

export const cloudflareRouteConfigSchema = z
  .object({
    config: z
      .object({
        ingress: z.array(z.record(z.string(), z.unknown()).and(z.object({ hostname: z.string().optional(), service: z.string().optional() }))).optional(),
      })
      .passthrough()
      .optional(),
    version: z.number().optional(),
  })
  .passthrough()

export type CloudflareRouteConfig = z.infer<typeof cloudflareRouteConfigSchema>
