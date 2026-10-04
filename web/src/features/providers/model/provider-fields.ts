import type { ProviderDefinition } from './types'

/**
 * 是否密钥字段：以服务商定义（后端 secret_fields）为准。
 * 正则猜测会把 `secret_id` 这类非密钥字段误判，导致无法回显与核对。
 */
export function isProviderSecretField(field: string, definition?: ProviderDefinition | null): boolean {
  if (definition?.secret_fields?.length) return definition.secret_fields.includes(field)
  return /token|password/i.test(field)
}
