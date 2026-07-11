import { z } from 'zod'

const zoneNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, '域名格式不正确')

export const cloudflareZoneListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
  name: z.string().max(253).default(''),
  refresh: z.coerce.boolean().default(false),
})

export const cloudflareZoneStoreSchema = z.object({
  name: z.string().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/),
  type: z.enum(['full', 'partial']).default('full'),
})

export const cloudflareRecordListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(100),
  type: z.string().max(32).default(''),
  search: z.string().max(255).default(''),
  refresh: z.coerce.boolean().default(false),
})

export const cloudflareRecordStoreSchema = z.object({
  type: z.string().min(1).max(32),
  name: z.string().min(1).max(253),
  content: z.string().min(1).max(4096),
  ttl: z.number().int().min(1).default(1),
  proxied: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  comment: z.string().max(1024).optional(),
})

export const cloudflareRecordUpdateSchema = cloudflareRecordStoreSchema

export type CloudflareZoneListQuery = z.infer<typeof cloudflareZoneListQuerySchema>
export type CloudflareZoneStoreInput = z.infer<typeof cloudflareZoneStoreSchema>
export type CloudflareRecordListQuery = z.infer<typeof cloudflareRecordListQuerySchema>
export type CloudflareRecordStoreInput = z.infer<typeof cloudflareRecordStoreSchema>
export type CloudflareRecordUpdateInput = z.infer<typeof cloudflareRecordUpdateSchema>

export { zoneNameSchema }
