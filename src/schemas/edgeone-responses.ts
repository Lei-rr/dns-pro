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

export const edgeoneResponseSchema = z.object({
  Response: z.record(z.string(), z.unknown()).and(
    z.object({
      RequestId: z.string().optional(),
      Error: z
        .object({
          Code: z.string(),
          Message: z.string(),
        })
        .optional(),
    })
  ),
})

export type EdgeoneResponse = z.infer<typeof edgeoneResponseSchema>

export function parseEdgeoneResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const parsed = edgeoneResponseSchema.parse(response)
  return { Response: parsed.Response, RequestId: parsed.Response.RequestId }
}

export const edgeoneZoneListResponseSchema = z
  .object({
    Zones: z.array(z.unknown()).optional(),
    TotalCount: z.number().optional(),
    RequestId: z.string().optional(),
  })
  .passthrough()

export const edgeoneAccelerationDomainListResponseSchema = z
  .object({
    AccelerationDomains: z.array(z.unknown()).optional(),
    TotalCount: z.number().optional(),
    RequestId: z.string().optional(),
  })
  .passthrough()

export const edgeoneAccelerationDomainCreateResponseSchema = z
  .object({
    RequestId: z.string().optional(),
    OwnershipVerification: z.unknown().optional(),
  })
  .passthrough()

export const edgeoneMutationResponseSchema = z
  .object({
    RequestId: z.string().optional(),
  })
  .passthrough()
