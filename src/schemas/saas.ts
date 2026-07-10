import { z } from 'zod'

export const saasListZonesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  name: z.string().max(253).optional(),
  refresh: z.coerce.boolean().optional(),
})

export const saasListHostnamesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  refresh: z.coerce.boolean().optional(),
})

export const saasShowQuerySchema = z.object({
  refresh: z.coerce.boolean().optional(),
})

export const saasStoreBodySchema = z.object({
  hostname: z.string().min(1).max(253),
  custom_origin_server: z.string().max(253).optional(),
  method: z.enum(['http', 'txt']).optional(),
  min_tls_version: z.enum(['1.0', '1.1', '1.2', '1.3']).optional(),
  preferred_domain: z.string().max(253).optional(),
  sync_target: z.enum(['dnspod', 'cloudflare_dns']).optional(),
  sync_provider_id: z.string().max(64).optional(),
  sync_zone: z.string().max(253).optional(),
  auto_preferred: z.coerce.boolean().optional(),
})

export const saasUpdateBodySchema = z.object({
  custom_origin_server: z.string().max(253).optional(),
  method: z.enum(['http', 'txt']).optional(),
  min_tls_version: z.enum(['1.0', '1.1', '1.2', '1.3']).optional(),
  preferred_domain: z.string().max(253).optional(),
  sync_target: z.enum(['dnspod', 'cloudflare_dns']).optional(),
  sync_provider_id: z.string().max(64).optional(),
  sync_zone: z.string().max(253).optional(),
  auto_preferred: z.coerce.boolean().optional(),
})

export const saasFallbackOriginBodySchema = z.object({
  origin: z.string().min(1).max(253),
})

export const preferredDomainStoreSchema = z.object({
  domain: z.string().min(1).max(253),
})

export const preferredDomainUpdateSchema = z.object({
  domain: z.string().min(1).max(253),
})

export const preferredDomainSortSchema = z.object({
  domains: z.array(z.string().min(1)),
})

export type SaasListZonesInput = z.infer<typeof saasListZonesQuerySchema>
export type SaasListHostnamesInput = z.infer<typeof saasListHostnamesQuerySchema>
export type SaasShowInput = z.infer<typeof saasShowQuerySchema>
export type SaasStoreInput = z.infer<typeof saasStoreBodySchema>
export type SaasUpdateInput = z.infer<typeof saasUpdateBodySchema>
export type SaasFallbackOriginInput = z.infer<typeof saasFallbackOriginBodySchema>
export type PreferredDomainStoreInput = z.infer<typeof preferredDomainStoreSchema>
export type PreferredDomainUpdateInput = z.infer<typeof preferredDomainUpdateSchema>
export type PreferredDomainSortInput = z.infer<typeof preferredDomainSortSchema>
