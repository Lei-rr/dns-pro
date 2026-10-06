import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * 迁移自 scripts/isolated-reconcile-probe.ts 第 7 节（前端静态断言）。
 *
 * 同步健康视图必须三处接入：页面用共享查询层、路由注册、布局暴露入口。
 * 少任何一处，端点存在但用户看不到入口（或页面拿不到数据），对账功能等于不可用。
 */

const root = new URL('../', import.meta.url)

describe('同步健康视图接入', () => {
  it('页面使用共享查询层、路由已注册、布局暴露入口', async () => {
    const [page, router, layout] = await Promise.all(
      ['web/src/pages/sync/SyncPage.vue', 'web/src/app/router/index.ts', 'web/src/app/layouts/AppLayout.vue'].map(
        async (file) => await readFile(new URL(file, root), 'utf8')
      )
    )

    expect(page).toMatch(/useSyncHealthQuery/)
    expect(router).toMatch(/SyncPage/)
    expect(layout).toMatch(/sync/)
  })
})
