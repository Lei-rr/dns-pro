import { z } from 'zod'

export const edgeOneZoneSchema = z
  .object({
    ZoneId: z.string().optional(),
    ZoneName: z.string().optional(),
    Area: z.string().optional(),
    Type: z.string().optional(),
    Status: z.string().optional(),
    ActiveStatus: z.string().optional(),
    LockStatus: z.string().optional(),
    Paused: z.boolean().optional(),
    Cname: z.string().optional(),
    CreatedOn: z.string().optional(),
    ModifiedOn: z.string().optional(),
  })
  .passthrough()

export type EdgeOneZone = z.infer<typeof edgeOneZoneSchema>

export const edgeOneAccelerationDomainSchema = z
  .object({
    ZoneId: z.string().optional(),
    DomainId: z.string().optional(),
    DomainName: z.string().optional(),
    DomainStatus: z.string().optional(),
    Cname: z.string().optional(),
    IPv6Status: z.string().optional(),
    IdentificationStatus: z.string().optional(),
    OriginProtocol: z.string().optional(),
    HttpOriginPort: z.number().optional(),
    HttpsOriginPort: z.number().optional(),
    OriginDetail: z.record(z.string(), z.unknown()).optional(),
    Certificate: z.record(z.string(), z.unknown()).optional(),
    CreatedOn: z.string().optional(),
    ModifiedOn: z.string().optional(),
  })
  .passthrough()

export type EdgeOneAccelerationDomain = z.infer<typeof edgeOneAccelerationDomainSchema>
