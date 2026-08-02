import type { AppContext } from './create-context.js'

export async function startAppContext(ctx: AppContext): Promise<void> {
  await ctx.platform.jobs.resumeActiveJobs()
}
