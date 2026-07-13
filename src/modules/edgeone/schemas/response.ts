import { z } from 'zod'

export const edgeOneZoneSchema = z
  .object({
    ZoneId: z.string().nullish(),
    ZoneName: z.string().nullish(),
    Area: z.string().nullish(),
    Type: z.string().nullish(),
    Status: z.string().nullish(),
    ActiveStatus: z.string().nullish(),
    LockStatus: z.string().nullish(),
    Paused: z.boolean().nullish(),
    Cname: z.string().nullish(),
    CreatedOn: z.string().nullish(),
    ModifiedOn: z.string().nullish(),
  })
  .passthrough()

export type EdgeOneZone = z.infer<typeof edgeOneZoneSchema>

export const edgeOneAccelerationDomainSchema = z
  .object({
    ZoneId: z.string().nullish(),
    DomainId: z.string().nullish(),
    DomainName: z.string().nullish(),
    DomainStatus: z.string().nullish(),
    Cname: z.string().nullish(),
    IPv6Status: z.string().nullish(),
    IdentificationStatus: z.string().nullish(),
    OriginProtocol: z.string().nullish(),
    HttpOriginPort: z.number().nullish(),
    HttpsOriginPort: z.number().nullish(),
    OriginDetail: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
    Certificate: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
    CreatedOn: z.string().nullish(),
    ModifiedOn: z.string().nullish(),
  })
  .passthrough()

export type EdgeOneAccelerationDomain = z.infer<typeof edgeOneAccelerationDomainSchema>

export const edgeoneResponseSchema = z.object({
  Response: z.record(z.string(), z.unknown()).and(
    z.object({
      RequestId: z.string().nullish(),
      Error: z
        .object({
          Code: z.string(),
          Message: z.string(),
        })
        .nullish(),
    })
  ),
})

export type EdgeoneResponse = z.infer<typeof edgeoneResponseSchema>

export function parseEdgeoneResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const parsed = edgeoneResponseSchema.parse(response)
  return { Response: parsed.Response, RequestId: parsed.Response.RequestId ?? undefined }
}

export const edgeoneZoneListResponseSchema = z
  .object({
    Zones: z.array(z.unknown()).nullish().transform((value) => value ?? []),
    TotalCount: z.number().nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()

export const edgeoneAccelerationDomainListResponseSchema = z
  .object({
    AccelerationDomains: z.array(z.unknown()).nullish().transform((value) => value ?? []),
    TotalCount: z.number().nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()

export const edgeoneAccelerationDomainCreateResponseSchema = z
  .object({
    RequestId: z.string().nullish(),
    OwnershipVerification: z.unknown().nullish(),
  })
  .passthrough()

export const edgeoneMutationResponseSchema = z
  .object({
    RequestId: z.string().nullish(),
  })
  .passthrough()
