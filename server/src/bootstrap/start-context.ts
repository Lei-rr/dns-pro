import type { AppContext } from './create-context.js'

export async function startAppContext(ctx: AppContext): Promise<void> {
  const [, providers] = await Promise.all([
    ctx.modules.auth.session.initialize(),
    ctx.modules.providers.repository.all(),
    ctx.modules.saas.preferredDomains.list(),
    ctx.modules.saas.preferences.listAll(),
    ctx.platform.jobs.resumeActiveJobs(),
  ])

  const cfIds = new Set(providers.filter((p) => p.type === 'cloudflare').map((p) => p.id))
  const allIds = new Set(providers.map((p) => p.id))
  await ctx.modules.saas.preferences.pruneOrphans(cfIds, allIds)

  if (await ctx.modules.auth.session.isDefaultCredential()) {
    console.warn(
      '\x1b[33m[SECURITY WARNING] 当前仍在运行默认账号密码 (admin/admin)，公网部署请及时修改 data/config.json\x1b[0m'
    )
  }
}
