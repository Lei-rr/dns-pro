import type { SaasWorkflowService } from '../../saas/services/workflow-service.js'

/**
 * Thin application usecase for SaaS hostname mutations.
 */
export class SaasHostnameMutationUseCase {
  constructor(private readonly workflow: SaasWorkflowService) {}

  create(providerId: string, zoneName: string, data: Record<string, unknown>, autoSync = false) {
    return this.workflow.createHostname(providerId, zoneName, data, autoSync)
  }

  update(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    data: Record<string, unknown>,
    autoSync = false,
  ) {
    return this.workflow.updateHostname(providerId, zoneName, hostnameFqdn, data, autoSync)
  }

  delete(providerId: string, zoneName: string, hostnameFqdn: string, autoCleanup = true) {
    return this.workflow.deleteHostname(providerId, zoneName, hostnameFqdn, autoCleanup)
  }

  refresh(providerId: string, zoneName: string, hostnameFqdn: string) {
    return this.workflow.refreshHostname(providerId, zoneName, hostnameFqdn)
  }
}
