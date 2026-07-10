import { z } from 'zod'

export const zoneParamSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9.-]+$/, '域名格式不正确')

export const recordIdParamSchema = z.string().min(1).regex(/^\d+$/, '记录 ID 必须是数字')

export const zoneListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().max(255).default(''),
  refresh: z.coerce.boolean().default(false),
})

export const zoneStoreSchema = z.object({
  domain: z.string().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/, '域名格式不正确'),
})

export const recordListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  subdomain: z.string().max(255).default(''),
  record_type: z.string().max(32).default(''),
  keyword: z.string().max(255).default(''),
  refresh: z.coerce.boolean().default(false),
})

export const recordStoreSchema = z.object({
  record_type: z.string().min(1).max(32),
  record_line: z.string().min(1).max(64),
  value: z.string().min(1).max(4096),
  subdomain: z.string().max(255).optional(),
  record_line_id: z.string().max(64).optional(),
  mx: z.number().int().min(0).max(65535).optional(),
  ttl: z.number().int().min(1).max(604800).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  status: z.enum(['ENABLE', 'DISABLE']).optional(),
  remark: z.string().max(255).optional(),
})

export const recordUpdateSchema = recordStoreSchema

export type ZoneListQuery = z.infer<typeof zoneListQuerySchema>
export type ZoneStoreInput = z.infer<typeof zoneStoreSchema>
export type RecordListQuery = z.infer<typeof recordListQuerySchema>
export type RecordStoreInput = z.infer<typeof recordStoreSchema>
export type RecordUpdateInput = z.infer<typeof recordUpdateSchema>
