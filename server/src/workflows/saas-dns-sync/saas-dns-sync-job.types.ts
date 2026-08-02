/** SaaS durable job type ids (shared by batch + preferred-apply mutual exclusion). */

export const SAAS_BATCH_DELETE_JOB = 'saas.batch_delete'
export const SAAS_BATCH_UPDATE_JOB = 'saas.batch_update'
export const PREFERRED_APPLY_JOB_TYPE = 'saas.preferred_apply'

export const SAAS_ZONE_JOB_TYPES = [SAAS_BATCH_DELETE_JOB, SAAS_BATCH_UPDATE_JOB, PREFERRED_APPLY_JOB_TYPE] as const
