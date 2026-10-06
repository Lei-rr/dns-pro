const defaultBrand = { avatarColor: '#2f54eb' }

const providerBrands: Record<string, { avatarColor: string }> = {
  dnspod: { avatarColor: '#1677ff' },
  edgeone: { avatarColor: '#1677ff' },
  cloudflare: { avatarColor: '#fa8c16' },
  cloudflared: { avatarColor: '#fa8c16' },
  saas: { avatarColor: '#fa8c16' },
}

function providerBrand(type: string) {
  return providerBrands[type] || defaultBrand
}

export function providerAvatarColor(type: string) {
  return providerBrand(type).avatarColor
}
