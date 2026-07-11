import { ApiError } from '../../lib/http/api-error.js'
import type { ProviderDefinition, ProviderInput } from './types.js'

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
        throw new ApiError('validation_failed', `Provider field is required: ${field}`, 422, {
          errors: { [field]: 'Provider field is required' },
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
    const value = String(id).trim()

    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) {
      throw new ApiError('validation_failed', 'Invalid provider id', 422, {
        errors: { id: 'Invalid provider id' },
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
      throw new ApiError('validation_failed', `Provider field is too long (max: ${maxLength})`, 422, {
        errors: { [field]: `Provider field is too long (max: ${maxLength})` },
      })
    }

    if (
      ['dnspod_provider', 'cloudflare_provider', 'cloudflare_dns_provider'].includes(field) &&
      !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)
    ) {
      throw new ApiError('validation_failed', 'Invalid referenced provider id', 422, {
        errors: { [field]: 'Invalid provider id' },
      })
    }
  }
}
