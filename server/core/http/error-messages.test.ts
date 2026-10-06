import { describe, expect, it } from 'vitest'
import { error } from './api-response.js'
import { translateError } from './error-messages.js'

/**
 * 原型链键不是错误码：裸查表（map[code]）会取出 Object.prototype 上的函数，
 * 被下游当 message 输出后 JSON 序列化会让整个字段消失。
 */

describe('translateError：原型链键不得被当成错误码', () => {
  it.each(['constructor', 'toString'])('translateError(%s) 返回 null 而不是原型链函数', (code) => {
    expect(translateError(code)).toBeNull()
  })

  it('已登记的错误码返回中文文案', () => {
    expect(translateError('server_error')).toBe('服务内部错误')
  })
})

describe('error 响应：未知错误码时消息原样返回', () => {
  it("error('boom', 400, 'constructor') 的 message 仍是 'boom'", () => {
    const response = error('boom', 400, 'constructor')
    expect(response.message).toBe('boom')
    expect(response.code).toBe('constructor')
    expect(response.status).toBe(400)
  })
})
