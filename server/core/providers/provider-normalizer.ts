import { ApiError } from '../http/api-error.js'
import type { ProviderDefinition, ProviderInput } from './provider.types.js'

const RESERVED_PROVIDER_IDS = ['home', 'login', 'providers', 'user']

/**
 * 服务商 ID 规则（自定义 id 与关联字段引用共用同一份正则）。
 * 显式写出大小写范围而不带 i 标志：JSON Schema 的 pattern 不支持 flags，
 * workflows 侧要直接引用同一份 source，带标志会让两端校验口径漂移。
 */
export const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const PROVIDER_ID_MESSAGE = '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）'

/**
 * 字段长度上限：schema 层与归一化必须引用同一份表，避免校验口径漂移。
 * 未登记的字段回落 PROVIDER_FIELD_MAX_LENGTH_DEFAULT。
 */
export const PROVIDER_FIELD_MAX_LENGTHS: Record<string, number> = {
  secret_id: 128,
  secret_key: 256,
  api_token: 512,
  account_id: 128,
  dnspod_provider: 64,
  cloudflare_provider: 64,
  cloudflare_dns_provider: 64,
}

export const PROVIDER_FIELD_MAX_LENGTH_DEFAULT = 255

/** 指向其它服务商的关联字段：取值必须是合法的服务商 ID */
const PROVIDER_REFERENCE_FIELDS = ['dnspod_provider', 'cloudflare_provider', 'cloudflare_dns_provider'] as const

export class ProviderNormalizer {
  normalize(data: Record<string, unknown>, definition: ProviderDefinition): ProviderInput {
    const id = this.validateId(data.id)
    const type = definition.type

    const provider: Record<string, unknown> = {
      id,
      name: this.validateName(data.name),
      type,
    }

    for (const field of definition.fields) {
      const value = String(data[field] ?? '').trim()

      if (definition.required.includes(field) && value === '') {
        throw new ApiError('validation_failed', `服务商字段不能为空：${field}`, 422, {
          errors: { [field]: '该字段不能为空' },
        })
      }

      if (value !== '') {
        this.validateField(field, value)
      }

      provider[field] = value
    }

    return provider as ProviderInput
  }

  validateId(id: unknown): string {
    // 直接 String(undefined) 会得到 'undefined' 并通过下面的正则，先挡掉非字符串与空值
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ApiError('validation_failed', PROVIDER_ID_MESSAGE, 422, {
        errors: { id: PROVIDER_ID_MESSAGE },
      })
    }
    const value = id.trim()

    if (!PROVIDER_ID_PATTERN.test(value)) {
      throw new ApiError('validation_failed', PROVIDER_ID_MESSAGE, 422, {
        errors: { id: PROVIDER_ID_MESSAGE },
      })
    }

    if (RESERVED_PROVIDER_IDS.includes(value.toLowerCase())) {
      throw new ApiError('validation_failed', 'Provider id is reserved', 422, {
        errors: { id: 'Provider id is reserved' },
      })
    }

    return value
  }

  validateName(name: unknown): string {
    return String(name ?? '').trim()
  }

  validateField(field: string, value: string): void {
    const maxLength = PROVIDER_FIELD_MAX_LENGTHS[field] ?? PROVIDER_FIELD_MAX_LENGTH_DEFAULT

    if (value.length > maxLength) {
      throw new ApiError('validation_failed', `字段过长（最多 ${maxLength} 个字符）`, 422, {
        errors: { [field]: `字段过长（最多 ${maxLength} 个字符）` },
      })
    }

    if ((PROVIDER_REFERENCE_FIELDS as readonly string[]).includes(field) && !PROVIDER_ID_PATTERN.test(value)) {
      throw new ApiError('validation_failed', 'Invalid referenced provider id', 422, {
        errors: { [field]: PROVIDER_ID_MESSAGE },
      })
    }
  }
}
