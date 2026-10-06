import { describe, expect, it } from 'vitest'
import type { TunnelRoute } from '../model/types'
import { routeKey } from './route-key'

function route(over: Partial<TunnelRoute> = {}): TunnelRoute {
  return { hostname: 'api.example.com', service: 'http://localhost:8080', path: '/api', ...over }
}

describe('routeKey', () => {
  it('hostname 与 path 用竖线拼接', () => {
    expect(routeKey(route())).toBe('api.example.com|/api')
  })

  it('根路径（空串 path）键以竖线结尾，与 / 不同', () => {
    expect(routeKey(route({ path: '' }))).toBe('api.example.com|')
    expect(routeKey(route({ path: '' }))).not.toBe(routeKey(route({ path: '/' })))
  })

  it('service 不参与 key：同 host+path 改 service 仍是同一行身份', () => {
    expect(routeKey(route({ service: 'http://a:1' }))).toBe(routeKey(route({ service: 'http://b:2' })))
  })

  it('hostname 或 path 不同即不同 key', () => {
    expect(routeKey(route({ hostname: 'other.example.com' }))).not.toBe(routeKey(route()))
    expect(routeKey(route({ path: '/other' }))).not.toBe(routeKey(route()))
  })

  it('key 原样保留大小写与空格，不做归一化', () => {
    expect(routeKey(route({ hostname: 'API.example.com', path: ' /a ' }))).toBe('API.example.com| /a ')
    expect(routeKey(route({ hostname: 'api.example.com' }))).not.toBe(routeKey(route({ hostname: 'API.example.com' })))
  })
})
