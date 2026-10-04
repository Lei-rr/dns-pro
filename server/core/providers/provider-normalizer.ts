import { ApiError } from '../http/api-error.js'
import type { ProviderDefinition, ProviderInput } from './provider.types.js'

const RESERVED_PROVIDER_IDS = ['home', 'login', 'providers', 'user']

const FIELD_MAX_LENGTHS: Record<string, number> = {
  secret_id: 128,
  secret_key: 256,
  api_token: 512,
  account_id: 128,
  dnspod_provider: 64,
  cloudflare_provider: 64,
  cloudflare_dns_provider: 64,
}

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
      throw new ApiError('validation_failed', '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）', 422, {
        errors: { id: '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）' },
      })
    }
    const value = id.trim()

    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) {
      throw new ApiError('validation_failed', '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）', 422, {
        errors: { id: '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）' },
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
    const maxLength = FIELD_MAX_LENGTHS[field] ?? 255

    if (value.length > maxLength) {
      throw new ApiError('validation_failed', `字段过长（最多 ${maxLength} 个字符）`, 422, {
        errors: { [field]: `字段过长（最多 ${maxLength} 个字符）` },
      })
    }

    if (
      ['dnspod_provider', 'cloudflare_provider', 'cloudflare_dns_provider'].includes(field) &&
      !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)
    ) {
      throw new ApiError('validation_failed', 'Invalid referenced provider id', 422, {
        errors: { [field]: '服务商 ID 不合法（字母或数字开头，可含 _ 和 -）' },
      })
    }
  }
}
