import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { EdgeOneAccelerationDomain } from '@/features/edge-one/model/types'
import AccelerationDomainsTable from './AccelerationDomainsTable.vue'

/**
 * 组件级测试（引入 Vitest 的核心价值）：验证真实渲染与事件链路。
 * 行内操作菜单由 reka-ui 下拉菜单渲染到 body（Teleport），所以按真实交互（键盘 Enter 打开，
 * happy-dom 下 pointerdown 不触发 reka 的打开分支）展开后再断言菜单项。
 * 覆盖点：不同 status 渲染出的操作不同、禁用态、点击后 emit 的事件与载荷。
 */
function domain(status: string): EdgeOneAccelerationDomain {
  return { domain_name: 'www.example.com', status, cname: 'www.example.com.edgeone.site', origin_type: 'IP' }
}

const domainName = (record: EdgeOneAccelerationDomain) => String(record.domain_name ?? record.name ?? '')

const wrappers: VueWrapper[] = []

async function openMenu(wrapper: VueWrapper) {
  await wrapper.get('[data-slot="dropdown-menu-trigger"]').trigger('keydown', { key: 'Enter' })
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountTable(records: EdgeOneAccelerationDomain[], busy = false): Promise<VueWrapper> {
  const wrapper = mount(AccelerationDomainsTable, {
    attachTo: document.body,
    props: {
      domains: records,
      loading: false,
      refreshing: false,
      selected: [],
      domainName,
      busy: () => busy,
    },
  })
  wrappers.push(wrapper)
  await openMenu(wrapper)
  return wrapper
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function menuItemTexts(): string[] {
  return menuItems().map((item) => String(item.textContent ?? '').trim())
}

function menuItem(text: string): HTMLElement {
  const item = menuItems().find((element) => String(element.textContent ?? '').trim() === text)
  if (!item) throw new Error(`菜单项未渲染：${text}（已渲染：${menuItemTexts().join(' / ')}）`)
  return item
}

function clickItem(text: string) {
  menuItem(text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

describe('AccelerationDomainsTable 行内操作', () => {
  it('online 行只给「停止加速」：删除与启用都不出现（两步走的第一步）', async () => {
    await mountTable([domain('online')])
    const texts = menuItemTexts()
    expect(texts).toContain('停止加速')
    expect(texts).not.toContain('删除')
    expect(texts).not.toContain('启用')
  })

  it('offline 行给「启用」与「删除」，不再出现「停止加速」（停用是稳定态而非终点）', async () => {
    await mountTable([domain('offline')])
    const texts = menuItemTexts()
    expect(texts).toContain('启用')
    expect(texts).toContain('删除')
    expect(texts).not.toContain('停止加速')
  })

  it('process 行两个动作都渲染但都不可用，并给出「配置中」提示', async () => {
    await mountTable([domain('process')])
    expect(menuItem('停止加速').getAttribute('data-disabled')).not.toBeNull()
    expect(menuItem('删除').getAttribute('data-disabled')).not.toBeNull()
    expect(menuItemTexts()).not.toContain('启用')
    expect(document.body.textContent).toContain('配置中，暂不可操作')
  })

  it('未知状态行：不渲染任何状态动作（保守处理）', async () => {
    await mountTable([domain('forbidden')])
    const texts = menuItemTexts()
    expect(texts).toContain('编辑')
    expect(texts).not.toContain('停止加速')
    expect(texts).not.toContain('启用')
    expect(texts).not.toContain('删除')
  })

  it('点击「停止加速」→ emit stop，载荷是该行记录', async () => {
    const record = domain('online')
    const wrapper = await mountTable([record])
    clickItem('停止加速')
    await nextTick()
    expect(wrapper.emitted('stop')).toEqual([[record]])
  })

  it('点击「启用」与「删除」分别 emit enable / remove，载荷正确', async () => {
    const record = domain('offline')
    const wrapper = await mountTable([record])
    clickItem('启用')
    await nextTick()
    await openMenu(wrapper)
    clickItem('删除')
    await nextTick()
    expect(wrapper.emitted('enable')).toEqual([[record]])
    expect(wrapper.emitted('remove')).toEqual([[record]])
  })

  it('busy 行（本地下发中）操作入口整体禁用：触发按钮带 disabled，菜单打不开', async () => {
    const wrapper = await mountTable([domain('online')], true)
    expect(wrapper.get('[data-slot="dropdown-menu-trigger"]').attributes('disabled')).toBeDefined()
    expect(menuItems()).toEqual([])
  })
})
