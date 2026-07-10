import { z } from 'zod'

export const edgeOneZoneListSchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  refresh: z.coerce.boolean().optional(),
})

export const edgeOneZoneShowSchema = z.object({
  refresh: z.coerce.boolean().optional(),
})

export const edgeOneAccelerationDomainListSchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  refresh: z.coerce.boolean().optional(),
})

export const edgeOneAccelerationDomainStoreSchema = z.object({
  domain_name: z.string().min(1).max(253),
  origin_type: z.enum(['IP_DOMAIN', 'COS', 'AWS_S3', 'ORIGIN_GROUP', 'VOD']).optional(),
  origin: z.string().min(1).max(253),
  host_header: z.string().max(253).optional(),
  origin_protocol: z.enum(['FOLLOW', 'HTTP', 'HTTPS']).optional(),
  http_origin_port: z.coerce.number().int().min(1).max(65535).optional(),
  https_origin_port: z.coerce.number().int().min(1).max(65535).optional(),
  ipv6_status: z.enum(['follow', 'on', 'off']).optional(),
})

export const edgeOneAccelerationDomainUpdateSchema = z.object({
  origin_type: z.enum(['IP_DOMAIN', 'COS', 'AWS_S3', 'ORIGIN_GROUP', 'VOD']).optional(),
  origin: z.string().min(1).max(253),
  host_header: z.string().max(253).optional(),
  origin_protocol: z.enum(['FOLLOW', 'HTTP', 'HTTPS']).optional(),
  http_origin_port: z.coerce.number().int().min(1).max(65535).optional(),
  https_origin_port: z.coerce.number().int().min(1).max(65535).optional(),
  ipv6_status: z.enum(['follow', 'on', 'off']).optional(),
})

export const edgeOneAccelerationDomainStatusSchema = z.object({
  status: z.enum(['online', 'offline']),
})

export const edgeOneAccelerationDomainCertificateSchema = z.object({
  https_mode: z.enum(['disable', 'eofreecert', 'sslcert']),
  cert_id: z.string().max(128).optional(),
})

export type EdgeOneZoneListInput = z.infer<typeof edgeOneZoneListSchema>
export type EdgeOneZoneShowInput = z.infer<typeof edgeOneZoneShowSchema>
export type EdgeOneAccelerationDomainListInput = z.infer<typeof edgeOneAccelerationDomainListSchema>
export type EdgeOneAccelerationDomainStoreInput = z.infer<typeof edgeOneAccelerationDomainStoreSchema>
export type EdgeOneAccelerationDomainUpdateInput = z.infer<typeof edgeOneAccelerationDomainUpdateSchema>
export type EdgeOneAccelerationDomainStatusInput = z.infer<typeof edgeOneAccelerationDomainStatusSchema>
export type EdgeOneAccelerationDomainCertificateInput = z.infer<typeof edgeOneAccelerationDomainCertificateSchema>
