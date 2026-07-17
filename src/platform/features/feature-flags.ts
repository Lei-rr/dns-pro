import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataRoot } from '../../lib/storage/json-store.js'
import { ApiError } from '../../lib/http/api-error.js'

export type FeatureFlags = {
  /** SaaS preferred-domain apply job */
  job_saas_preferred_apply: boolean
  /** SaaS hostname batch delete/update jobs */
  job_saas_batch: boolean
  /** DNS record batch delete job */
  job_dns_batch: boolean
  /** EdgeOne domain batch disable/delete jobs */
  job_edgeone_batch: boolean
  /** Write verbose mutation meta into audit stream */
  audit_verbose: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  job_saas_preferred_apply: true,
  job_saas_batch: true,
  job_dns_batch: true,
  job_edgeone_batch: true,
  audit_verbose: false,
}

const JOB_TYPE_FLAGS: Record<string, keyof FeatureFlags> = {
  'saas.preferred_apply': 'job_saas_preferred_apply',
  'saas.batch_delete': 'job_saas_batch',
  'saas.batch_update': 'job_saas_batch',
  'dns.batch_delete': 'job_dns_batch',
  'edgeone.batch_disable': 'job_edgeone_batch',
  'edgeone.batch_delete': 'job_edgeone_batch',
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const raw = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

function fromEnv(): Partial<FeatureFlags> {
  const raw = process.env.FEATURE_FLAGS || process.env.DNS_PRO_FEATURE_FLAGS || ''
  if (!raw.trim()) {
    // also allow individual env vars
    const out: Partial<FeatureFlags> = {}
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>) {
      const envKey = `FEATURE_${key.toUpperCase()}`
      if (process.env[envKey] !== undefined) out[key] = parseBool(process.env[envKey], DEFAULT_FEATURE_FLAGS[key])
    }
    return out
  }

  const out: Partial<FeatureFlags> = {}
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim())
    if (!k) continue
    const key = k.replace(/[.-]/g, '_') as keyof FeatureFlags
    if (key in DEFAULT_FEATURE_FLAGS) out[key] = parseBool(v, DEFAULT_FEATURE_FLAGS[key])
  }
  return out
}

async function fromFile(dataRoot: string): Promise<Partial<FeatureFlags>> {
  const file = path.join(dataRoot, 'feature-flags.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<FeatureFlags> = {}
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>) {
      if (key in parsed) out[key] = parseBool(parsed[key], DEFAULT_FEATURE_FLAGS[key])
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Feature flags loaded from defaults < file < env.
 * File path: data/feature-flags.json
 */
export class FeatureFlagService {
  private flags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS }
  private loaded = false

  async load(dataRoot = getDataRoot()): Promise<FeatureFlags> {
    const fileFlags = await fromFile(dataRoot)
    const envFlags = fromEnv()
    this.flags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...fileFlags,
      ...envFlags,
    }
    this.loaded = true
    return this.snapshot()
  }

  snapshot(): FeatureFlags {
    return { ...this.flags }
  }

  isEnabled(flag: keyof FeatureFlags): boolean {
    if (!this.loaded) return DEFAULT_FEATURE_FLAGS[flag]
    return Boolean(this.flags[flag])
  }

  require(flag: keyof FeatureFlags, message?: string): void {
    if (!this.isEnabled(flag)) {
      throw new ApiError(
        'feature_disabled',
        message || `Feature disabled: ${flag}`,
        403,
        { feature: flag },
      )
    }
  }

  requireJobType(jobType: string): void {
    const flag = JOB_TYPE_FLAGS[jobType]
    if (!flag) return
    this.require(flag, `Job type disabled by feature flag: ${jobType}`)
  }

  jobFlagFor(jobType: string): keyof FeatureFlags | null {
    return JOB_TYPE_FLAGS[jobType] ?? null
  }
}

export const featureFlags = new FeatureFlagService()
