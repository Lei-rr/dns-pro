import type { Provider } from './types'

export function isProviderConfigured(provider: Provider) {
  return !!provider.configured
}

export function providerFieldValues(provider: Provider) {
  return provider.fields || {}
}

export function presentProvider(provider: Provider): Provider {
  return {
    ...provider,
    configured: isProviderConfigured(provider),
    editable_fields: provider.editable_fields || [],
    fields: providerFieldValues(provider),
  }
}
