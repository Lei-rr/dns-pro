import type { EdgeOneDomainService } from '../../edgeone/services/domain-service.js'
import type { EdgeOneWorkflowService } from '../../edgeone/services/workflow-service.js'

/**
 * Thin application usecase for EdgeOne acceleration-domain mutations.
 */
export class EdgeOneDomainMutationUseCase {
  constructor(
    private readonly domains: EdgeOneDomainService,
    private readonly workflow: EdgeOneWorkflowService,
  ) {}

  create(providerId: string, zoneId: string, data: Record<string, unknown>, autoSync = false) {
    return this.workflow.createAccelerationDomain(providerId, zoneId, data, autoSync)
  }

  update(providerId: string, zoneId: string, domainName: string, data: Record<string, unknown>) {
    return this.domains.updateAccelerationDomain(providerId, zoneId, domainName, data)
  }

  delete(providerId: string, zoneId: string, domainName: string, autoCleanup = true) {
    return this.workflow.deleteAccelerationDomain(providerId, zoneId, domainName, autoCleanup)
  }

  updateStatus(providerId: string, zoneId: string, domainName: string, status: string) {
    return this.domains.updateAccelerationDomainStatus(providerId, zoneId, domainName, status)
  }

  updateCertificate(providerId: string, zoneId: string, domainName: string, data: Record<string, unknown>) {
    return this.domains.updateCertificate(providerId, zoneId, domainName, data)
  }

  syncCname(providerId: string, zoneId: string, domainName: string) {
    return this.workflow.syncCname(providerId, zoneId, domainName)
  }
}
