import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadAppConfig } from '../../app/config.js'
import { createModules, type AppModules } from '../../app/modules.js'
import { ApiError } from '../../core/http/api-error.js'
import { JsonStore } from '../../core/store/json-store.js'
import type { PreferredDomainsFile } from '../../core/store/store-shapes.js'
import { isHostnameActive } from '../../modules/cloudflare/saas/saas-hostname-rules.js'
import { PreferredDomainService } from '../../modules/cloudflare/saas/preferred-domain.service.js'
import { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'

/**
 * 迁移自 scripts/isolated-saas-preference-probe.ts（B5/B7），并合并
 * scripts/isolated-saas-config-branch-probe.ts 第 1 节的优选域名白名单断言。
 *
 * B5：偏好键从 `<cfId>:<hostnameId>` 改为身份 `<cfId>:<zone>:<fqdn>`——主机名重建后偏好仍命中；
 *     旧键行在启动 pruneOrphans 或下次写入时无损收编，无 hostname 的旧行无法归属只能清除。
 * B7：moved 主机名已迁出站点，既不算「在管」也不得进入所有权 TXT 清理流程（清理后无法再验证归属）。
 * 装配保留真实 createModules 链路（store / ProviderIntegrity / 服务实例），避免退化成纯函数测试。
 */

let dataDir = ''
let modules: AppModules

const saasDir = () => path.join(dataDir, 'saas')
const preferencesFile = () => path.join(saasDir(), 'preferences.json')
const preferredDomainsFile = () => path.join(saasDir(), 'preferred-domains.json')

async function readFileRows(file: string): Promise<Record<string, Record<string, unknown>>> {
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { items?: Record<string, Record<string, unknown>> }
  return raw.items ?? {}
}

async function seedPreferredDomains(items: unknown[]): Promise<void> {
  await fs.mkdir(saasDir(), { recursive: true })
  await fs.writeFile(preferredDomainsFile(), JSON.stringify({ items }))
}

/** 与探针 rejectsCode 同强度：错误必须是 ApiError，且 code / statusCode 精确匹配 */
async function rejectsApiError(run: () => Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await run().then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ code, statusCode })
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-saas-pref-'))
  await fs.mkdir(saasDir(), { recursive: true })
  // 旧版键模型：`<cloudflareProviderId>:<hostnameId>`；无 hostname 的旧行无法归属到 FQDN
  await fs.writeFile(
    preferencesFile(),
    JSON.stringify({
      items: {
        'cf-owner:h-legacy': { hostname: 'legacy.example.com', preferred_domain: 'p.example.com' },
        'cf-owner:h-unowned': { preferred_domain: 'orphan.example.com' },
      },
    })
  )
  await fs.writeFile(
    path.join(dataDir, 'providers.json'),
    JSON.stringify({
      items: [
        { id: 'cf-owner', name: 'CF owner', type: 'cloudflare', api_token: 'probe-token' },
        { id: 'dns-target', name: 'DNS target', type: 'dnspod', secret_id: 'probe-id', secret_key: 'probe-key' },
      ],
    })
  )
  modules = createModules(
    loadAppConfig({
      dataDir,
      logLevel: false,
      sessionSecret: 'probe-session-secret-that-is-longer-than-thirty-two-characters',
    }),
    { credentialKey: Buffer.alloc(32, 7) }
  )
})

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
})

describe('偏好键身份 (zone, FQDN)：启动收编、写入即收编与按 FQDN 清理', () => {
  it('旧 hostnameId 键无损收编，新旧身份互不污染，删除主机名清干净所有站点行', async () => {
    const preferences = modules.saas.preferences

    // 1. 启动收编：可归属的旧键行迁移为 `<cfId>:<fqdn>`（站点未知），无法归属的旧行清除
    const providers = await modules.providers.repository.all()
    const pruned = await preferences.pruneOrphans(
      new Set(providers.filter((provider) => provider.type === 'cloudflare').map((provider) => provider.id)),
      new Set(providers.map((provider) => provider.id))
    )
    expect(pruned.removedCount).toBe(1)
    expect(pruned.repairedCount).toBe(1)
    let rows = await readFileRows(preferencesFile())
    expect(Object.keys(rows)).toEqual(['cf-owner::legacy.example.com'])
    expect(rows['cf-owner::legacy.example.com']?.hostname_id).toBe('h-legacy')
    expect(
      (await preferences.get('cf-owner', { zone: 'example.com', fqdn: 'legacy.example.com' }))?.preferred_domain
    ).toBe('p.example.com')

    // 2. 身份键：带站点写入后落在 `<cfId>:<zone>:<fqdn>`，不再出现旧键形状
    await preferences.setPreferredDomain(
      'cf-owner',
      { zone: 'example.com', fqdn: 'www.example.com' },
      'pref.example.com',
      'h-1'
    )
    rows = await readFileRows(preferencesFile())
    expect(rows['cf-owner:example.com:www.example.com']).toBeTruthy()
    expect(rows['cf-owner:h-1']).toBeUndefined()
    expect(rows['cf-owner:example.com:www.example.com']?.hostname_id).toBe('h-1')

    // 3. 同一 FQDN 跨站点不互相命中（旧键模型下会被同一个 hostnameId 覆盖）
    await preferences.setNormalizedSyncConfig(
      'cf-owner',
      { zone: 'other.com', fqdn: 'www.example.com' },
      { sync_target: 'dnspod', sync_provider_id: 'dns-target', sync_zone: 'example.com', auto_preferred: false },
      'h-1'
    )
    const sameFqdn = await preferences.get('cf-owner', { zone: 'example.com', fqdn: 'www.example.com' })
    expect(sameFqdn?.preferred_domain).toBe('pref.example.com')
    expect(sameFqdn?.sync_target).toBe('')
    expect((await preferences.get('cf-owner', { zone: 'other.com', fqdn: 'www.example.com' }))?.sync_target).toBe(
      'dnspod'
    )

    // 4. 写入即收编：带站点写入把站点未知行并入身份键
    await preferences.setPreferredDomain(
      'cf-owner',
      { zone: 'example.com', fqdn: 'legacy.example.com' },
      'p2.example.com'
    )
    rows = await readFileRows(preferencesFile())
    expect(rows['cf-owner::legacy.example.com']).toBeUndefined()
    expect(rows['cf-owner:example.com:legacy.example.com']?.preferred_domain).toBe('p2.example.com')

    // 5. 所有权 TXT 标记仍按 hostnameId 寻址，但不得把身份键降级成站点未知键
    await preferences.markOwnershipTxtCleaned('cf-owner', 'h-1', true, 'www.example.com')
    expect(await preferences.ownershipTxtCleaned('cf-owner', 'h-1')).toBe(true)
    rows = await readFileRows(preferencesFile())
    expect(rows['cf-owner::www.example.com']).toBeUndefined()
    expect(rows['cf-owner:example.com:www.example.com']?.ownership_txt_cleaned).toBe(true)

    // 6. 删除主机名按 FQDN 清干净所有站点行，且不误伤其他主机名
    const cleared = await preferences.clearForFqdn('cf-owner', 'www.example.com')
    expect(cleared).toBe(2)
    rows = await readFileRows(preferencesFile())
    expect(Object.keys(rows).sort()).toEqual(['cf-owner:example.com:legacy.example.com'])
  })
})

describe('在管判定与所有权 TXT 清理门槛（B7）', () => {
  it('状态判定只认真正在管的主机名', () => {
    expect(isHostnameActive({ status: 'active' })).toBe(true)
    expect(isHostnameActive({ status: 'active_renewing' })).toBe(true)
    expect(isHostnameActive({ status: 'moved' })).toBe(false)
    expect(isHostnameActive({ status: 'pending' })).toBe(false)
    expect(isHostnameActive({})).toBe(false)
  })

  it('moved 时连偏好查询都不该发生，active 才进入清理流程', async () => {
    const lookups: string[] = []
    const gate = new SaaSDnsSyncWorkflow(
      // 规则端口用真实判定实现：门槛必须与主机名状态判定同口径，桩只固定服务商解析
      { cloudflareProviderId: async () => 'cf-owner', isHostnameActive } as never,
      {
        ownershipTxtCleaned: async (_cfId: string, hostnameId: string) => {
          lookups.push(hostnameId)
          return false
        },
      } as never,
      {} as never
    )
    const shouldCleanup = (
      gate as unknown as {
        shouldCleanupOwnershipTxt(providerId: string, hostname: { id?: string; status?: string }): Promise<boolean>
      }
    ).shouldCleanupOwnershipTxt
    expect(await shouldCleanup.call(gate, 'saas-owner', { id: 'h-1', status: 'moved' })).toBe(false)
    expect(lookups).toEqual([])
    expect(await shouldCleanup.call(gate, 'saas-owner', { id: 'h-1', status: 'active' })).toBe(true)
    expect(lookups).toEqual(['h-1'])
  })
})

describe('优选域名白名单：写入/校验/改名/删除/排序共用同一份归一化', () => {
  // 单个 it：前半段走装配实例，后半段重置文件改用直接构造的实例（装配实例的读缓存不再参与），
  // 两段顺序不可互换，因此不拆成互相依赖的多个 it。
  it('等价写法在写入/查键/改名/删除/排序五处命中同一身份，非法值按 not_found 而不是 500', async () => {
    const preferredDomains = modules.saas.preferredDomains

    await preferredDomains.create('https://Pref.Example.com/some/path')
    expect(await preferredDomains.list()).toEqual([{ domain: 'pref.example.com', sort: 0 }])
    expect(await preferredDomains.isAllowed(' PREF.EXAMPLE.COM. ')).toBe(true)

    // 改名的旧值用等价写法必须命中；新值同样归一化；改完后新旧域名的判定必须翻转
    expect(await preferredDomains.rename('PREF.EXAMPLE.COM.', 'Second.Example.com.')).toEqual({
      domain: 'second.example.com',
      sort: 0,
    })
    expect(await preferredDomains.isAllowed('https://second.example.com/x')).toBe(true)
    expect(await preferredDomains.isAllowed('pref.example.com.')).toBe(false)

    await preferredDomains.create('third.example.com')
    expect(
      (
        await preferredDomains.reorder([
          ' https://THIRD.example.com/some/path ',
          'second.example.com.',
          'SECOND.example.com',
          'https://',
          ' ',
          'unknown.example.com',
        ])
      ).map((item) => item.domain)
    ).toEqual(['third.example.com', 'second.example.com'])

    await preferredDomains.delete(' second.example.com. ')
    expect(await preferredDomains.isAllowed('second.example.com')).toBe(false)
    expect((await preferredDomains.list()).map((item) => item.domain)).toEqual(['third.example.com'])
    await rejectsApiError(
      () => preferredDomains.rename('https://', 'fourth.example.com'),
      'preferred_domain_not_found',
      404
    )
    await rejectsApiError(() => preferredDomains.delete(''), 'preferred_domain_not_found', 404)

    // 以下断言重置文件内容：装配实例的读缓存不再参与，改用直接构造的新实例
    await seedPreferredDomains([])
    const domains = new PreferredDomainService(
      new JsonStore<PreferredDomainsFile>('saas/preferred-domains.json', { items: [] }, dataDir)
    )

    await expect(domains.create('https://Pref.Example.com/some/path')).resolves.toEqual({
      domain: 'pref.example.com',
      sort: 0,
    })
    expect(await domains.isAllowed('pref.example.com.')).toBe(true)
    expect(await domains.isAllowed('  PREF.EXAMPLE.COM  ')).toBe(true)
    expect(await domains.isAllowed('http://pref.example.com/x')).toBe(true)
    expect(await domains.isAllowed('other.example.com')).toBe(false)
    expect(await domains.isAllowed('')).toBe(false)
    expect(await domains.isAllowed('not a domain')).toBe(false)

    await rejectsApiError(() => domains.create('pref.example.com.'), 'preferred_domain_duplicate', 422)
    await rejectsApiError(() => domains.create('http://'), 'preferred_domain_invalid', 422)

    await domains.create('second.example.com')
    // 改名为自身的等价写法：不得被当成重复
    await expect(domains.rename('pref.example.com', 'PREF.example.com.')).resolves.toEqual({
      domain: 'pref.example.com',
      sort: 0,
    })
    await rejectsApiError(
      () => domains.rename('pref.example.com', 'second.example.com'),
      'preferred_domain_duplicate',
      422
    )
    await rejectsApiError(
      () => domains.rename('missing.example.com', 'third.example.com'),
      'preferred_domain_not_found',
      404
    )

    await domains.create('third.example.com')
    await expect(
      domains.reorder(['second.example.com', 'SECOND.example.com', ' ', 'unknown.example.com', 'pref.example.com'])
    ).resolves.toEqual([
      { domain: 'second.example.com', sort: 0 },
      { domain: 'pref.example.com', sort: 1 },
      { domain: 'third.example.com', sort: 2 },
    ])
    await rejectsApiError(() => domains.delete('missing.example.com'), 'preferred_domain_not_found', 404)
    await domains.delete('  SECOND.example.com  ')
    expect((await domains.list()).map((item) => item.domain)).toEqual(['pref.example.com', 'third.example.com'])

    // 改名/删除的查键与写入键同源：尾点、协议前缀、路径都是等价写法，不得落到 404
    await expect(domains.rename('THIRD.example.com.', 'https://Renamed.Example.com/path')).resolves.toEqual({
      domain: 'renamed.example.com',
      sort: 1,
    })
    await domains.delete('RENAMED.example.com.  ')
    expect((await domains.list()).map((item) => item.domain)).toEqual(['pref.example.com'])
    // 归一化失败/空值的查键按 not_found 处理（不是 422、更不是 500）
    await rejectsApiError(() => domains.rename('not a domain', 'fourth.example.com'), 'preferred_domain_not_found', 404)
    await rejectsApiError(() => domains.delete('http://'), 'preferred_domain_not_found', 404)
    await rejectsApiError(() => domains.delete(''), 'preferred_domain_not_found', 404)
    await rejectsApiError(() => domains.rename('pref.example.com', 'not a domain'), 'preferred_domain_invalid', 422)

    // 存量数据（旧版写入或手工编辑）未归一化：读取侧必须与写入侧同源，不能只在写入侧判真、在读取侧判假
    await seedPreferredDomains(['https://Legacy.Example.com/path', 'legacy2.example.com.', 'not a domain', 42])
    const legacy = new PreferredDomainService(
      new JsonStore<PreferredDomainsFile>('saas/preferred-domains.json', { items: [] }, dataDir)
    )
    expect(await legacy.isAllowed('legacy.example.com')).toBe(true)
    expect(await legacy.isAllowed('legacy2.example.com')).toBe(true)
    expect((await legacy.list()).map((item) => item.domain)).toEqual(['legacy.example.com', 'legacy2.example.com'])
  })
})
