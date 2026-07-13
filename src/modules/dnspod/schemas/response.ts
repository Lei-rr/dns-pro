import { z } from 'zod'

export const dnspodDomainSchema = z
  .object({
    DomainId: z.number().nullish(),
    Name: z.string().nullish(),
    Punycode: z.string().nullish(),
    Status: z.string().nullish(),
    DnsStatus: z.string().nullish(),
    DNSStatus: z.string().nullish(),
    Grade: z.string().nullish(),
    GradeTitle: z.string().nullish(),
    GroupId: z.number().nullish(),
    RecordCount: z.number().nullish(),
    TTL: z.number().nullish(),
    Remark: z.string().nullish(),
    EffectiveDNS: z.array(z.string()).nullish().transform((value) => value ?? []),
    CreatedOn: z.string().nullish(),
    UpdatedOn: z.string().nullish(),
  })
  .passthrough()

export type DnspodDomain = z.infer<typeof dnspodDomainSchema>

export const dnspodRecordSchema = z
  .object({
    RecordId: z.number().nullish(),
    Name: z.string().nullish(),
    Type: z.string().nullish(),
    Line: z.string().nullish(),
    LineId: z.string().nullish(),
    Value: z.string().nullish(),
    TTL: z.number().nullish(),
    MX: z.number().nullish(),
    Weight: z.number().nullish(),
    Status: z.string().nullish(),
    Remark: z.string().nullish(),
    UpdatedOn: z.string().nullish(),
    MonitorStatus: z.string().nullish(),
    DefaultNS: z.boolean().nullish(),
  })
  .passthrough()

export type DnspodRecord = z.infer<typeof dnspodRecordSchema>

export const dnspodDomainInfoSchema = z
  .object({
    Id: z.number().nullish(),
    Domain: z.string().nullish(),
    GradeNsList: z.array(z.string()).nullish().transform((value) => value ?? []),
  })
  .passthrough()

export type DnspodDomainInfo = z.infer<typeof dnspodDomainInfoSchema>

export const dnspodResponseSchema = z.object({
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

export type DnspodResponse = z.infer<typeof dnspodResponseSchema>

export function parseDnspodResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const parsed = dnspodResponseSchema.parse(response)
  return { Response: parsed.Response, RequestId: parsed.Response.RequestId ?? undefined }
}

export const dnspodDomainListResponseSchema = z
  .object({
    DomainList: z.array(z.unknown()).nullish().transform((value) => value ?? []),
    DomainCountInfo: z.record(z.string(), z.unknown()).nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()

export const dnspodDomainCreateResponseSchema = z
  .object({
    DomainInfo: z.unknown().nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()

export const dnspodRecordListResponseSchema = z
  .object({
    RecordList: z.array(z.unknown()).nullish().transform((value) => value ?? []),
    RecordCountInfo: z.record(z.string(), z.unknown()).nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()

export const dnspodRecordMutationResponseSchema = z
  .object({
    RecordId: z.number().nullish(),
    RequestId: z.string().nullish(),
  })
  .passthrough()
