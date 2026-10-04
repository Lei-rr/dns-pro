/**
 * Cloudflare 分页上限：站点 / 记录 / SaaS 主机名共用一个错误码，隧道单列（cloudflared_pagination_limit）。
 * 上限语义由 core 的 MAX_PROVIDER_PAGES 决定，这里只负责把超限映射成错误码。
 */
export function cloudflarePageLimit(limitCode: string): { limitCode: string; limitMessage: string } {
  return { limitCode, limitMessage: 'Cloudflare pagination limit reached' }
}

/** 站点、DNS 记录与 SaaS 主机名列表共用的上限 */
export const CLOUDFLARE_PAGE_LIMIT = cloudflarePageLimit('cloudflare_pagination_limit')
