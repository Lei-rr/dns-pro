import { JobService } from '../platform/jobs/job.service.js'
import { JsonStore } from '../platform/storage/json-store.js'

export function createPlatform() {
  return {
    jobs: new JobService(new JsonStore('jobs/jobs.json', { items: [] })),
  }
}

export type AppPlatform = ReturnType<typeof createPlatform>
