import { describe, expect, it } from 'vitest'
import { createSecretBox, SEALED_VALUE_PREFIX } from './secret-box.js'

/**
 * 密文判定必须是「完整形态」而不是前缀匹配：
 * 曾经只判前缀，用户提交的 `enc:v1:` 截断串会被当成密文跳过加密原样落盘，
 * 之后所有读路径解密失败（500），且写操作前都要先读，界面与接口都无法改回。
 */

const box = createSecretBox(Buffer.alloc(32, 7))

describe('secret-box：完整形态判定', () => {
  it('seal 产物可识别且能原样解回', () => {
    const sealed = box.seal('sk-live-1234567890')
    expect(box.isSealed(sealed)).toBe(true)
    expect(box.open(sealed)).toBe('sk-live-1234567890')
  })

  it('仅前缀相同而格式不完整的值不算密文', () => {
    const valid = box.seal('x')
    const broken = [
      SEALED_VALUE_PREFIX,
      `${SEALED_VALUE_PREFIX}only-prefix`,
      `${SEALED_VALUE_PREFIX}vOUYru8TzBg0U0yw:YWJj`, // 缺 tag
      `${SEALED_VALUE_PREFIX}:YWJj:1LLyFUD1HECvR6ZV_YAEYw`, // 缺 iv
      `${SEALED_VALUE_PREFIX}vOUYru8TzBg0U0yw::1LLyFUD1HECvR6ZV_YAEYw`, // 缺 ciphertext
      `${SEALED_VALUE_PREFIX}short:YWJj:1LLyFUD1HECvR6ZV_YAEYw`, // iv 长度不符
      valid.slice(0, -4), // 合法密文被截断
      `${valid}:extra`, // 多出一段
    ]
    for (const value of broken) {
      expect(box.isSealed(value), value).toBe(false)
    }
  })

  it('畸形前缀值重新加密后可正常读回（不再永久损坏）', () => {
    const broken = `${SEALED_VALUE_PREFIX}truncated`
    expect(box.isSealed(broken)).toBe(false)
    const resealed = box.seal(broken)
    expect(box.isSealed(resealed)).toBe(true)
    expect(box.open(resealed)).toBe(broken)
  })

  it('无前缀明文原样透传，兼容尚未迁移的旧数据', () => {
    expect(box.isSealed('plain-secret')).toBe(false)
    expect(box.open('plain-secret')).toBe('plain-secret')
  })
})
