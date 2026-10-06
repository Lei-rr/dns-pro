/** DNS 托管平台：具备 zones / records 语义、可作为 SaaS 同步源的 DNSPod 与 Cloudflare */
export function isDnsPlatform(type: string): type is 'dnspod' | 'cloudflare' {
  return type === 'dnspod' || type === 'cloudflare'
}
