import type { ProviderDefinition, ProviderType } from './provider.types.js'

const providerDefinitions: Record<ProviderType, ProviderDefinition> = {
  dnspod: {
    type: 'dnspod',
    name: 'DNSPod',
    fields: ['secret_id', 'secret_key'],
    required: ['secret_id', 'secret_key'],
    secret_fields: ['secret_key'],
    labels: {
      secret_id: 'SecretId',
      secret_key: 'SecretKey',
    },
  },
  cloudflare: {
    type: 'cloudflare',
    name: 'Cloudflare',
    fields: ['api_token', 'account_id'],
    required: ['api_token'],
    secret_fields: ['api_token'],
    labels: {
      api_token: 'API Token',
      account_id: 'Account ID',
    },
  },
  edgeone: {
    type: 'edgeone',
    name: 'EdgeOne',
    fields: ['dnspod_provider'],
    required: ['dnspod_provider'],
    secret_fields: [],
    labels: {
      dnspod_provider: '关联 DNSPod API',
    },
  },
  saas: {
    type: 'saas',
    name: 'Cloudflare SaaS',
    fields: ['cloudflare_provider', 'dnspod_provider', 'cloudflare_dns_provider'],
    required: ['cloudflare_provider'],
    secret_fields: [],
    labels: {
      cloudflare_provider: '关联 Cloudflare API',
      dnspod_provider: 'DNSPod 同步 API',
      cloudflare_dns_provider: 'Cloudflare DNS 同步 API',
    },
  },
  cloudflared: {
    type: 'cloudflared',
    name: 'Cloudflare Tunnel',
    fields: ['cloudflare_provider'],
    required: ['cloudflare_provider'],
    secret_fields: [],
    labels: {
      cloudflare_provider: '关联 Cloudflare API',
    },
  },
}

export function getProviderDefinition(type: string): ProviderDefinition | undefined {
  return providerDefinitions[type as ProviderType]
}

export function getProviderDefinitionsList(): ProviderDefinition[] {
  return Object.values(providerDefinitions)
}
