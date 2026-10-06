import { describe, expect, it } from 'vitest'
import { fieldError, serverFieldErrors } from './field-errors'

/** 构造 shared/api/http 的 RequestError 形状：只读取 details.errors */
function requestError(details: unknown) {
  return Object.assign(new Error('校验失败'), { code: 'VALIDATION_FAILED', status: 422, details })
}

describe('fieldError', () => {
  it('命中的字段返回单元素数组（表单组件约定的校验反馈形状）', () => {
    expect(fieldError({ hostname: '请填写 Hostname' }, 'hostname')).toEqual(['请填写 Hostname'])
  })

  it('未命中字段返回空数组', () => {
    expect(fieldError({ hostname: '请填写 Hostname' }, 'service')).toEqual([])
    expect(fieldError({}, 'hostname')).toEqual([])
  })

  it('空串视为没有错误', () => {
    expect(fieldError({ hostname: '' }, 'hostname')).toEqual([])
  })
})

describe('serverFieldErrors', () => {
  it('取 details.errors 的字符串值并 trim', () => {
    expect(serverFieldErrors(requestError({ errors: { hostname: '  域名已存在  ' } }))).toEqual({
      hostname: '域名已存在',
    })
  })

  it('数组值合并为顿号串联，空元素被丢弃', () => {
    expect(serverFieldErrors(requestError({ errors: { hostname: ['已被占用', '', '长度超限'] } }))).toEqual({
      hostname: '已被占用，长度超限',
    })
  })

  it('对象值递归取 message，数组内对象同样展开', () => {
    expect(serverFieldErrors(requestError({ errors: { hostname: { message: '格式不正确' } } }))).toEqual({
      hostname: '格式不正确',
    })
    expect(serverFieldErrors(requestError({ errors: { hostname: [{ message: 'A' }, { message: 'B' }, {}] } }))).toEqual(
      { hostname: 'A，B' }
    )
  })

  it('数字与布尔按 String 归一', () => {
    expect(serverFieldErrors(requestError({ errors: { ttl: 600, proxied: false } }))).toEqual({
      ttl: '600',
      proxied: 'false',
    })
  })

  it('空值（null/undefined/空串/空数组/纯空白）不写入结果', () => {
    expect(serverFieldErrors(requestError({ errors: { a: null, b: undefined, c: '', d: [], e: '   ' } }))).toEqual({})
  })

  it('别名把后端字段名映射到表单字段名', () => {
    expect(serverFieldErrors(requestError({ errors: { hostname: '重复' } }), { hostname: 'name' })).toEqual({
      name: '重复',
    })
  })

  it('别名撞车时先到先得，后到的值不覆盖', () => {
    expect(serverFieldErrors(requestError({ errors: { hostname: 'A', name: 'B' } }), { hostname: 'name' })).toEqual({
      name: 'A',
    })
  })

  it('多字段与多语言键名一并保留', () => {
    expect(
      serverFieldErrors(requestError({ errors: { hostname: 'A', service: ['B'], path: { message: 'C' } } }))
    ).toEqual({ hostname: 'A', service: 'B', path: 'C' })
  })

  it('details 缺失/非对象、errors 缺失/非对象/数组都返回空对象', () => {
    expect(serverFieldErrors(undefined)).toEqual({})
    expect(serverFieldErrors(null)).toEqual({})
    expect(serverFieldErrors('boom')).toEqual({})
    expect(serverFieldErrors(new Error('普通错误'))).toEqual({})
    expect(serverFieldErrors(requestError(undefined))).toEqual({})
    expect(serverFieldErrors(requestError('details'))).toEqual({})
    expect(serverFieldErrors(requestError([1, 2]))).toEqual({})
    expect(serverFieldErrors(requestError({}))).toEqual({})
    expect(serverFieldErrors(requestError({ errors: null }))).toEqual({})
    expect(serverFieldErrors(requestError({ errors: 'x' }))).toEqual({})
    expect(serverFieldErrors(requestError({ errors: ['a'] }))).toEqual({})
  })

  it('无 message 的对象取不出文案，回空串交给调用方兜底', () => {
    // fieldMessage 只识别 string / array / 带 message 的对象；其余对象没有可读文案，
    // 回空串而非 String(value) 的 '[object Object]'，避免它作为校验错误落到界面上
    expect(serverFieldErrors(requestError({ errors: { hostname: { code: 'x' } } }))).toEqual({})
  })
})
