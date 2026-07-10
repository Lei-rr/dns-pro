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
