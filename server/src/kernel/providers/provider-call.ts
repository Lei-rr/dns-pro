import { ApiError } from '../http/api-error.js'

/** 供应商分页上限：上游 total 异常时防止无限翻页 */
const MAX_PROVIDER_PAGES = 1000

/** 腾讯云系接口单页上限（官方 Limit 最大 3000） */
export const TENCENT_PAGE_SIZE = 3000

/** 把未知异常包装为 502 ApiError；已是 ApiError 时原样返回，避免二次包装 */
export function wrapProviderError(
  code: string,
  message: string,
  providerId: string,
  error: unknown,
  details: Record<string, unknown> = {}
): ApiError {
  if (error instanceof ApiError) return error
  const err = error instanceof Error ? error : new Error(String(error))
  return new ApiError(code, message, 502, { ...details, provider_id: providerId, error: err.message })
}

type CallContext = {
  code: string
  message: string
  providerId: string
  details?: Record<string, unknown>
}

/** 执行一次供应商调用，失败统一包装为业务错误码 */
export async function callProvider<T>(context: CallContext, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw wrapProviderError(context.code, context.message, context.providerId, error, context.details)
  }
}

/**
 * 解析上游 total 字段：非法值返回 null。
 * 注意：total 只用于日志与提前结束判断，不作为唯一终止条件（DNSPod 官方说明计数有延迟）。
 */
export function parseUpstreamTotal(value: unknown): number | null {
  if (value == null || value === '') return null
  const total = Number(value)
  return Number.isFinite(total) && total >= 0 ? total : null
}

type OffsetPage<T> = { items: T[]; sourceCount: number; total: number | null; requestId?: string }

/** Offset 分页全量采集（腾讯云系接口） */
export async function collectOffsetPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<OffsetPage<T>>,
  options: { pageSize?: number; limitCode: string; limitMessage: string }
): Promise<{ items: T[]; requestId?: string }> {
  const pageSize = options.pageSize ?? 100
  const items: T[] = []
  let offset = 0
  let requestId: string | undefined
  for (let page = 1; ; page++) {
    const result = await fetchPage(offset, pageSize)
    items.push(...result.items)
    requestId = result.requestId ?? requestId
    offset += result.sourceCount
    // 只有「本页不满」才说明到底；上游 total 可能滞后，不作为终止条件
    if (result.sourceCount < pageSize) break
    if (page >= MAX_PROVIDER_PAGES) throw new ApiError(options.limitCode, options.limitMessage, 502)
  }
  return { items, requestId }
}

type NumberedPage<T> = { items: T[]; sourceCount: number; totalPages: number | null }

/** 页码分页全量采集（Cloudflare 接口）；onPage 返回 true 时提前结束 */
export async function collectNumberedPages<T>(
  fetchPage: (page: number, perPage: number) => Promise<NumberedPage<T>>,
  options: { perPage?: number; limitCode: string; limitMessage: string; stop?: (items: T[]) => boolean }
): Promise<T[]> {
  const perPage = options.perPage ?? 100
  const items: T[] = []
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, perPage)
    items.push(...result.items)
    if (options.stop?.(result.items)) break
    const totalPages = result.totalPages ?? 0
    if (totalPages > 0 ? page >= totalPages : result.sourceCount < perPage) break
    if (page >= MAX_PROVIDER_PAGES) throw new ApiError(options.limitCode, options.limitMessage, 502)
  }
  return items
}

/** 全量列表的分页元数据类型 */
export type FullListPagination = ReturnType<typeof fullListPagination>

/** 全量列表结果：items + 统一分页元数据（一页装下全部） */
export function toFullListResult<T>(items: T[], requestId?: string) {
  const pagination = fullListPagination(items.length)
  return { items, pagination, meta: pagination, request_id: requestId }
}

/** 全量列表的统一分页元数据（一页装下全部） */
function fullListPagination(total: number) {
  return { page: 1, per_page: total, offset: 0, limit: total, count: total, total, total_count: total, total_pages: 1 }
}
