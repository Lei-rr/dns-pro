import type { SecretBox } from '../../platform/security/secret-box.js'
import { getProviderDefinition } from './provider-definitions.js'
import type { Provider, ProviderInput } from './provider.types.js'

/** 按定义加密 provider 的秘密字段；空值与已加密值跳过（幂等，可重复执行） */
export function sealProviderSecrets<T extends ProviderInput>(provider: T, box: SecretBox): T {
  const definition = getProviderDefinition(provider.type)
  if (!definition || definition.secret_fields.length === 0) return provider
  const copy = { ...provider } as Record<string, unknown>
  for (const field of definition.secret_fields) {
    const value = String(copy[field] ?? '')
    if (value === '' || box.isSealed(value)) continue
    copy[field] = box.seal(value)
  }
  return copy as T
}

/** 解密 provider 的秘密字段；非密文原样保留（兼容尚未迁移的旧数据） */
export function openProviderSecrets<T extends Provider>(provider: T, box: SecretBox): T {
  const definition = getProviderDefinition(provider.type)
  if (!definition || definition.secret_fields.length === 0) return provider
  const copy = { ...provider } as Record<string, unknown>
  for (const field of definition.secret_fields) {
    const value = String(copy[field] ?? '')
    if (value === '') continue
    copy[field] = box.open(value)
  }
  return copy as T
}
