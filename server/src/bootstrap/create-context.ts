import type { AppConfig } from './app-config.js'
import { createModules } from './create-modules.js'
import { createPlatform } from './create-platform.js'
import { createWorkflows } from './create-workflows.js'
import { ensureDefaultAppConfig } from '../modules/auth/auth-config.repository.js'

export async function createAppContext(config: AppConfig) {
  await ensureDefaultAppConfig(config.dataDir)
  const platform = createPlatform()
  const modules = createModules()
  const workflows = createWorkflows(platform, modules)
  return { config, platform, modules, workflows }
}

export type AppContext = Awaited<ReturnType<typeof createAppContext>>
