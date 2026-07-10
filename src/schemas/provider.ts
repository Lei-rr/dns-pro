import { z } from 'zod'
import { PROVIDER_TYPES } from '../types/provider.js'

export const providerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, '服务商标识格式不正确')

export const providerStoreSchema = z
  .object({
    id: providerIdSchema,
    name: z.string().max(64).default(''),
    type: z.enum(PROVIDER_TYPES),
  })
  .passthrough()

export const providerUpdateSchema = z
  .object({
    name: z.string().max(64).optional(),
    type: z.enum(PROVIDER_TYPES).optional(),
  })
  .passthrough()

export const providerSortSchema = z.object({
  order: z.array(z.string()).min(1),
})

export type ProviderStoreInput = z.infer<typeof providerStoreSchema>
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>
export type ProviderSortInput = z.infer<typeof providerSortSchema>
