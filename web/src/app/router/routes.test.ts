import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { routes } from './index'

/**
 * 路由表的结构契约。
 *
 * 替代原先的源码文本断言（在 router/index.ts 里找页面组件名字样）：那种做法改个导入名就误报、
 * 把页面从路由里删掉却因为组件仍被 import 而漏报。这里直接断言路由表本身。
 */

function layoutChildren(record: RouteRecordRaw | undefined): RouteRecordRaw[] {
  return record?.children ?? []
}

describe('路由表结构契约', () => {
  it('存在兜底路由并回首页，避免未匹配路径落到空白页', () => {
    const fallback = routes.find((record) => record.path === '/:pathMatch(.*)*')
    expect(fallback?.redirect).toBe('/')
  })

  it('登录页标记为 public，其余页面由守卫强制鉴权', () => {
    const login = routes.find((record) => record.path === '/login')
    expect(login?.meta?.public).toBe(true)
  })

  it('布局子路由包含控制台与服务商页（端点存在但入口缺失等于不可用）', () => {
    const children = layoutChildren(routes.find((record) => record.path === '/'))
    const paths = children.map((record) => record.path)
    expect(paths).toContain('')
    expect(paths).toContain('providers')
  })

  it('服务商页面统一在 /p 前缀下，旧链接以函数重定向兼容', () => {
    const children = layoutChildren(routes.find((record) => record.path === '/'))
    expect(children.some((record) => record.path === 'p/:provider')).toBe(true)
    expect(children.some((record) => record.path === 'p/:provider/:second')).toBe(true)

    const legacy = children.find((record) => record.path === ':provider')
    expect(typeof legacy?.redirect).toBe('function')
  })
})
