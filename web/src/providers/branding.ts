const defaultBrand = { color: 'geekblue', avatarColor: '#2f54eb' }

const providerBrands: Record<string, { color: string; avatarColor: string }> = {
  dnspod: { color: 'blue', avatarColor: '#1677ff' },
  edgeone: { color: 'blue', avatarColor: '#1677ff' },
  cloudflare: { color: 'orange', avatarColor: '#fa8c16' },
  cloudflared: { color: 'orange', avatarColor: '#fa8c16' },
  saas: { color: 'orange', avatarColor: '#fa8c16' },
}

export function providerBrand(type: string) {
  return providerBrands[type] || defaultBrand
}

export function providerAvatarColor(type: string) {
  return providerBrand(type).avatarColor
}

export function providerTagColor(type: string) {
  return providerBrand(type).color
}

export { defaultBrand }
