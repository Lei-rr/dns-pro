import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname } from '@/features/saas/model/types'
import type { ApiResponse } from '@/shared/api/types'
import { useSaasHostEditor } from './use-saas-host-editor'

/**
 * 保存与下拉数据（优选域名）的所有权回归：
 * 弹窗里「优选域名加载失败 → 重试」曾在保存进行中 claim 同一个 ownership，
 * 作废保存请求的 owner，让 save 的 finally 跳过 saving=false——保存按钮永久转圈、
 * 再点被静默吞掉。此处钉住：重试不会影响保存，saving 在请求返回后必然复位。
 */

vi.mock('@/features/saas/api/saas-api', () => ({
  saasApi: {
    updateHostname: vi.fn(),
    createHostname: vi.fn(),
  },
  preferredDomainApi: {
    list: vi.fn(),
  },
}))

vi.mock('@/shared/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}))

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const HOST: SaaSHostname = { id: 'h1', hostname: 'api.example.com', status: 'active' }

let scope: ReturnType<typeof effectScope>
let editor: ReturnType<typeof useSaasHostEditor>
let updateRequest: ReturnType<typeof deferred<ApiResponse<SaaSHostname>>>

beforeEach(() => {
  vi.mocked(preferredDomainApi.list).mockResolvedValue(ok([{ domain: 'bf.example.com' }]))
  updateRequest = deferred<ApiResponse<SaaSHostname>>()
  vi.mocked(saasApi.updateHostname).mockReturnValue(updateRequest.promise)

  scope = effectScope()
  scope.run(() => {
    editor = useSaasHostEditor({
      providerId: () => 'provider-1',
      zoneName: () => 'example.com',
      loadDnsZones: async () => [],
      reload: async () => {},
      patchHostname: () => {},
      closeDetail: () => {},
      rowBusy: () => false,
      syncProviders: () => [],
    })
  })
})

afterEach(() => {
  scope.stop()
  vi.clearAllMocks()
})

describe('useSaasHostEditor 保存与优选域名加载的所有权分离', () => {
  it('保存中点击优选域名「重试」后，请求返回时 saving 正常复位', async () => {
    editor.openEdit(HOST)
    // 关闭自动优选，避免「开启自动优选必须选优选域名」的校验挡住提交
    editor.form.auto_preferred = false

    const saving = editor.save()
    expect(editor.saving.value).toBe(true)

    // 模拟弹窗内「优选域名加载失败 → 重试」：不得作废正在保存的请求
    await editor.loadPreferredOptions()

    updateRequest.resolve(ok({ ...HOST, status: 'active' }))
    await saving

    expect(editor.saving.value).toBe(false)
  })

  it('保存未收尾时打开新的表单会话，旧请求不再拖住新表单的保存态', async () => {
    editor.openEdit(HOST)
    editor.form.auto_preferred = false

    const saving = editor.save()
    expect(editor.saving.value).toBe(true)

    editor.openEdit({ ...HOST, id: 'h2', hostname: 'www.example.com' })
    expect(editor.saving.value).toBe(false)

    updateRequest.resolve(ok({ ...HOST, status: 'active' }))
    await saving

    expect(editor.saving.value).toBe(false)
  })
})
