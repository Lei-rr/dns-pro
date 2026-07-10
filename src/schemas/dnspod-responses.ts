import { z } from 'zod'

export const dnspodDomainSchema = z
  .object({
    DomainId: z.number().optional(),
    Name: z.string().optional(),
    Punycode: z.string().optional(),
    Status: z.string().optional(),
    DnsStatus: z.string().optional(),
    DNSStatus: z.string().optional(),
    Grade: z.string().optional(),
    GradeTitle: z.string().optional(),
    GroupId: z.number().optional(),
    RecordCount: z.number().optional(),
    TTL: z.number().optional(),
    Remark: z.string().optional(),
    EffectiveDNS: z.array(z.string()).optional(),
    CreatedOn: z.string().optional(),
    UpdatedOn: z.string().optional(),
  })
  .passthrough()

export type DnspodDomain = z.infer<typeof dnspodDomainSchema>

export const dnspodRecordSchema = z
  .object({
    RecordId: z.number().optional(),
    Name: z.string().optional(),
    Type: z.string().optional(),
    Line: z.string().optional(),
    LineId: z.string().optional(),
    Value: z.string().optional(),
    TTL: z.number().optional(),
    MX: z.number().optional(),
    Weight: z.number().optional(),
    Status: z.string().optional(),
    Remark: z.string().optional(),
    UpdatedOn: z.string().optional(),
  })
  .passthrough()

export type DnspodRecord = z.infer<typeof dnspodRecordSchema>

export const dnspodDomainInfoSchema = z
  .object({
    Id: z.number().optional(),
    Domain: z.string().optional(),
    GradeNsList: z.array(z.string()).optional(),
  })
  .passthrough()

export type DnspodDomainInfo = z.infer<typeof dnspodDomainInfoSchema>
