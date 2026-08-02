import type { AppContext } from './create-context.js'

export async function startAppContext(ctx: AppContext): Promise<void> {
  await Promise.all([
    ctx.modules.auth.session.initialize(),
    ctx.modules.providers.repository.all(),
    ctx.modules.saas.preferredDomains.list(),
    ctx.modules.saas.preferences.listAll(),
    ctx.platform.jobs.resumeActiveJobs(),
  ])
}
