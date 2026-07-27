/** EdgeOne durable job type ids (zone-scoped mutual exclusion). */

export const EDGEONE_BATCH_DISABLE_JOB = 'edgeone.batch_disable'
export const EDGEONE_BATCH_DELETE_JOB = 'edgeone.batch_delete'

export const EDGEONE_ZONE_JOB_TYPES = [EDGEONE_BATCH_DISABLE_JOB, EDGEONE_BATCH_DELETE_JOB] as const
