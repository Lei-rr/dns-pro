/**
 * FOUNDATION re-export surface — keep small.
 * Feature modules may import JobService / eventBus / registry from here.
 * Do not grow this into a framework.
 */

export {
  defineModule,
  ServiceTokens,
  type ProviderType,
  type Capability,
  type PageQuery,
  type PageResult,
  type SyncRecord,
  type ZonePort,
  type RecordPort,
  type SyncPort,
  type JobStatus,
  type JobRecord,
  type JobPort,
  type PluginContext,
  type AppPlugin,
  type ModuleDefinition,
  type ServiceToken,
} from './contracts.js'

export { ServiceRegistry } from './registry.js'
export { JobService } from '../platform/job/job-service.js'
export { eventBus, type DomainEvent, type DomainEventType } from '../platform/events/event-bus.js'
export { registerEventSubscribers } from '../platform/events/subscribers.js'
export { runMigrations } from '../platform/migration.js'
export { resolveZonePort, resolveRecordPort } from '../platform/port-resolve.js'
