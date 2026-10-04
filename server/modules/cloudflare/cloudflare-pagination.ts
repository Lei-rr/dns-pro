/**
 * Cloudflare 分页上限：错误码按调用域区分（站点 / 记录 / SaaS 主机名 / 隧道），文案统一。
 * 上限语义由 core 的 MAX_PROVIDER_PAGES 决定，这里只负责把超限映射成错误码。
 */
export function cloudflarePageLimit(limitCode: string): { limitCode: string; limitMessage: string } {
  return { limitCode, limitMessage: 'Cloudflare pagination limit reached' }
}

/** 站点、DNS 记录与 SaaS 主机名列表共用的上限 */
export const CLOUDFLARE_PAGE_LIMIT = cloudflarePageLimit('cloudflare_pagination_limit')
