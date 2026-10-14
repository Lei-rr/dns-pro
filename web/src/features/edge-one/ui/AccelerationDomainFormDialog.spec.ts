import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AccelerationDomainFormDialog from './AccelerationDomainFormDialog.vue'

/**
 * 「自动同步 DNSPod」默认值契约（产品口径）：
 *  - 新建默认开启：CNAME 落 DNS 是这条流程的主要目的，不该让用户为「忘记勾选」补一次修复解析；
 *  - 编辑不默认勾选：打开对话框本身不得顺手改写用户既有解析；
 *  - 未关联 DNSPod 时开关不渲染，且提交必须回落 false——后端 resolveDnsTarget 的
 *    requireLinkedProviderId 会直接拒绝创建，而界面上没有可关闭的入口。
 *
 * 打法：reka-ui 的 DialogContent 经 Teleport 渲染到 body（happy-dom 下同样如此），
 * 断言走 document.body 查询而不是 wrapper.find；打开对话框后需等 Presence 把内容挂上来。
 */

const ORIGIN_PLACEHOLDER = '1.2.3.4 或 origin.example.com'
const SAVE_LABEL = '保存'

let host: HTMLDivElement | undefined
let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  host = undefined
})

function mountDialog(overrides: Record<string, unknown> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  wrapper = mount(AccelerationDomainFormDialog, {
    attachTo: host,
    props: { open: false, zoneName: 'example.com', dnspodLinked: true, ...overrides },
  })
  return wrapper
}

/** 打开对话框：表单只在 open 变化时初始化，Teleport 内容还要等 Presence 落地 */
async function openDialog(target: VueWrapper) {
  await target.setProps({ open: true })
  await flushPromises()
  await nextTick()
  await waitFor('[data-slot="dialog-content"]')
}

async function waitFor(selector: string, timeoutMs = 1000): Promise<Element> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const node = document.body.querySelector(selector)
    if (node) return node
    if (Date.now() > deadline) throw new Error(`等待 ${selector} 渲染超时`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

function query(selector: string): DOMWrapper<Element> {
  const node = document.body.querySelector(selector)
  expect(node, `${selector} 应渲染到 body`).toBeTruthy()
  return new DOMWrapper(node as Element)
}

function savePayload(target: VueWrapper): { autoSync: boolean } {
  const events = target.emitted('save')
  const payload = events?.[events.length - 1]?.[0]
  expect(payload, '校验通过后应 emit save').toBeTruthy()
  return payload as { autoSync: boolean }
}

/** 填好必填源站后点保存，返回 emit 出的载荷 */
async function fillOriginAndSave(target: VueWrapper) {
  await query(`input[placeholder="${ORIGIN_PLACEHOLDER}"]`).setValue('192.0.2.10')
  const buttons = Array.from(document.body.querySelectorAll('button'))
  const button = buttons.find((item) => item.textContent?.includes(SAVE_LABEL))
  expect(button, '保存按钮应渲染').toBeTruthy()
  await new DOMWrapper(button as Element).trigger('click')
  await flushPromises()
  return savePayload(target)
}

describe('AccelerationDomainFormDialog 自动同步 DNSPod 默认值', () => {
  it('新建（已关联 DNSPod）：开关默认开启，提交携带 autoSync: true', async () => {
    const dialog = mountDialog()
    await openDialog(dialog)

    const toggle = query('[role="switch"]')
    expect(toggle.attributes('data-state')).toBe('checked')

    expect((await fillOriginAndSave(dialog)).autoSync).toBe(true)
  })

  it('新建（未关联 DNSPod）：开关不渲染，提交回落 autoSync: false', async () => {
    const dialog = mountDialog({ dnspodLinked: false })
    await openDialog(dialog)

    expect(document.body.querySelector('[role="switch"]')).toBeNull()

    expect((await fillOriginAndSave(dialog)).autoSync).toBe(false)
  })

  it('编辑既有域名：不默认勾选，提交 autoSync: false', async () => {
    const dialog = mountDialog({
      editing: true,
      domain: { domain_name: 'www.example.com', origin: { type: 'IP_DOMAIN', value: '192.0.2.10' } },
    })
    await openDialog(dialog)

    expect(document.body.querySelector('[role="switch"]'), '编辑态不渲染开关').toBeNull()

    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes(SAVE_LABEL)
    )
    expect(button, '保存按钮应渲染').toBeTruthy()
    await new DOMWrapper(button as Element).trigger('click')
    await flushPromises()

    expect(savePayload(dialog).autoSync).toBe(false)
  })

  it('已关联但用户手动关掉开关：尊重用户选择，提交 autoSync: false', async () => {
    const dialog = mountDialog()
    await openDialog(dialog)

    await query('[role="switch"]').trigger('click')
    await flushPromises()
    expect(query('[role="switch"]').attributes('data-state')).toBe('unchecked')

    expect((await fillOriginAndSave(dialog)).autoSync).toBe(false)
  })
})

/**
 * 「前缀」框只收前缀：粘贴完整域名在失焦时收敛，落在别的站点上就地报错。
 * 收敛后完整域名预览与提交值都必须不变——剥离只是为了不让整串落到 domain_name。
 */
describe('AccelerationDomainFormDialog 前缀只收前缀', () => {
  it('粘贴本站点完整域名（含协议/路径）：失焦剥成前缀，提交的完整域名不变', async () => {
    const dialog = mountDialog()
    await openDialog(dialog)

    const prefix = query('input[placeholder="www / * / @"]')
    await prefix.setValue('https://www.example.com/path')
    await prefix.trigger('blur')
    await flushPromises()
    await nextTick()

    expect((prefix.element as HTMLInputElement).value).toBe('www')
    expect(document.body.querySelector('[data-slot="field-error"]'), '可收敛时不应报错').toBeNull()

    const payload = await fillOriginAndSave(dialog)
    expect((payload as { fullDomain?: string }).fullDomain).toBe('www.example.com')
  })

  it('粘贴不属于本站点的域名：就地报错并拦住提交', async () => {
    const dialog = mountDialog()
    await openDialog(dialog)

    const prefix = query('input[placeholder="www / * / @"]')
    await prefix.setValue('other.example.net')
    await prefix.trigger('blur')
    await flushPromises()

    expect(document.body.querySelector('[data-slot="field-error"]')?.textContent).toContain('不属于该站点')

    await query(`input[placeholder="${ORIGIN_PLACEHOLDER}"]`).setValue('192.0.2.10')
    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes(SAVE_LABEL)
    )
    expect(button, '保存按钮应渲染').toBeTruthy()
    await new DOMWrapper(button as Element).trigger('click')
    await flushPromises()

    expect(dialog.emitted('save'), '前缀非法时不得提交').toBeUndefined()
  })

  it('编辑既有域名：前缀框只读，提交既有域名本身，不受收敛影响', async () => {
    const dialog = mountDialog({
      editing: true,
      // 既有域名不在 zone 下（历史数据）：编辑态不得被收敛逻辑拦成无法保存
      domain: { domain_name: 'other.example.net', origin: { type: 'IP_DOMAIN', value: '192.0.2.10' } },
    })
    await openDialog(dialog)

    expect(query('input[placeholder="www / * / @"]').attributes('disabled')).toBeDefined()

    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes(SAVE_LABEL)
    )
    await new DOMWrapper(button as Element).trigger('click')
    await flushPromises()

    expect((savePayload(dialog) as { fullDomain?: string }).fullDomain).toBe('other.example.net')
  })
})
