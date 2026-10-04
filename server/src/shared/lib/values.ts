/** 通用值处理（无业务含义） */

/** 规范化主机名：去空白、小写、去掉末尾一个点 */
export function normalizeFqdn(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/** 宽松布尔解析：true / 'true'（忽略大小写） */
export function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return typeof value === 'string' && value.toLowerCase() === 'true'
}

/**
 * 域名转 ASCII（punycode）。上游（Cloudflare 等）以 punycode 存储/返回域名，
 * 含非 ASCII 时才转换，避免无谓开销。
 */
export function toAsciiFqdn(value: unknown): string {
  const fqdn = normalizeFqdn(value)
  if (fqdn === '' || /^[\x20-\x7e]*$/.test(fqdn)) return fqdn
  try {
    return normalizeFqdn(new URL(`http://${fqdn}`).hostname)
  } catch {
    return fqdn
  }
}

/** 提取异常的可读消息 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
