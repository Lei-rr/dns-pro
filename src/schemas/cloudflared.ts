import { z } from 'zod'

export const cloudflaredTunnelCreateSchema = z.object({
  name: z.string().min(1).max(128),
})

export const cloudflaredRouteSchema = z.object({
  hostname: z.string().min(1).max(253),
  protocol: z.enum(['http', 'https', 'tcp', 'ssh', 'rdp', 'smb']).optional(),
  address: z.string().min(1).max(253),
  zone_id: z.string().min(1).max(64),
  path: z.string().max(253).optional(),
})

export const cloudflaredRouteUpdateQuerySchema = z.object({
  original_hostname: z.string().max(253).optional(),
  original_path: z.string().max(253).optional(),
})

export const cloudflaredRouteDeleteQuerySchema = z.object({
  hostname: z.string().min(1).max(253),
  path: z.string().max(253).optional(),
  zone_id: z.string().min(1).max(64),
})

export type CloudflaredTunnelCreateInput = z.infer<typeof cloudflaredTunnelCreateSchema>
export type CloudflaredRouteInput = z.infer<typeof cloudflaredRouteSchema>
export type CloudflaredRouteUpdateQuery = z.infer<typeof cloudflaredRouteUpdateQuerySchema>
export type CloudflaredRouteDeleteQuery = z.infer<typeof cloudflaredRouteDeleteQuerySchema>
