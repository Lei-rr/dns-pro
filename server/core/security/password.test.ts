import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

/**
 * 密码以 scrypt 自描述哈希（scrypt$N$r$p$salt$hash）存储、校验走异步派生；
 * 非哈希输入（历史明文、被截断的落盘值）必须校验失败，既不能抛错也不能误判通过。
 */

describe('密码哈希与校验', () => {
  it('哈希以 scrypt$ 前缀自描述，正确密码通过、错误密码拒绝', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
    expect(await verifyPassword('wrong password', stored)).toBe(false)
  })

  it('非哈希输入必须校验失败', async () => {
    expect(await verifyPassword('anything', 'plaintext-legacy')).toBe(false)
  })
})
