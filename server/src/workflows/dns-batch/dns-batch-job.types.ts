/** DNS durable job type ids (zone-scoped mutual exclusion). */

export const DNS_BATCH_CREATE_JOB = 'dns.batch_create'
export const DNS_BATCH_DELETE_JOB = 'dns.batch_delete'
export const DNS_BATCH_UPDATE_JOB = 'dns.batch_update'

export const DNS_ZONE_JOB_TYPES = [DNS_BATCH_CREATE_JOB, DNS_BATCH_DELETE_JOB, DNS_BATCH_UPDATE_JOB] as const
