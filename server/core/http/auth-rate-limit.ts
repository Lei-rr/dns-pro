/**
 * 登录 / 改密限流共用的 429 锁定信封：三处生产者（rate-limit 插件的 errorResponseBuilder、
 * auth.service 的失败计数锁定、error-handler 的 429 透传）都必须给出相同的 code 与 details 形状。
 *
 * 契约：details.retry_after 的单位是秒，由 web/src/features/edge-one/model/status-poll-policy.ts
 * 按秒解析；改成毫秒会让前端把等待时长静默放大 1000 倍。
 */
export const AUTH_RATE_LIMITED_CODE = 'auth_rate_limited'

interface AuthRateLimitEnvelope {
  code: string
  message: string
  details: { retry_after: number }
}

/** 剩余毫秒 → 向上取整为秒 → 向上取整为分钟（避免展示 0 分钟或提前解锁） */
export function authRateLimited(remainingMs: number): AuthRateLimitEnvelope {
  const retryAfter = Math.ceil(remainingMs / 1000)
  return {
    code: AUTH_RATE_LIMITED_CODE,
    message: `尝试次数过多，已临时锁定，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`,
    details: { retry_after: retryAfter },
  }
}
