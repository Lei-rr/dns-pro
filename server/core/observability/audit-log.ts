import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'

/** 审计动作（§4.3 F6）：批量 / 凭据变更 / 会话吊销 */
type AuditAction = 'batch' | 'credential_change' | 'session_revoked'

export interface AuditEvent {
  id: string
  at: string
  action: AuditAction
  /** 操作者：登录用户名；解析失败退回来源 IP */
  actor: string
  /** 操作对象：服务商 / 主机名 / 站点 / 任务等可读标识 */
  target: string
  detail: Record<string, unknown>
}

type AuditInput = { action: AuditAction; actor?: string; target: string; detail?: Record<string, unknown> }

const DEFAULT_CAPACITY = 200

/**
 * §5 可观测性：关键操作审计（批量 / 凭据变更 / 会话吊销）。
 *
 * 权威留痕是日志（sink 写入 pino）；内存环形缓冲只为 UI 提供"可查入口"，
 * 不做持久化（不引入审计落盘表——蓝图边界内）。
 */
export class AuditLog {
  private readonly events: AuditEvent[] = []

  constructor(
    private readonly sink: (event: AuditEvent) => void = () => {},
    private readonly capacity = DEFAULT_CAPACITY
  ) {}

  record(input: AuditInput): AuditEvent {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: input.action,
      actor: input.actor ?? '',
      target: input.target,
      detail: input.detail ?? {},
    }
    this.events.unshift(event)
    if (this.events.length > this.capacity) this.events.length = this.capacity
    this.sink(event)
    return event
  }

  /** 最近事件（最新在前）；仅进程内存，重启即空 */
  list(): AuditEvent[] {
    return [...this.events]
  }
}

/**
 * 操作者：鉴权钩子写入的用户名；未鉴权路径（登录/健康检查）退回来源 IP。
 * 只读 request，不回查 modules —— core 层不得依赖运行时装配。
 */
export function auditActor(request: FastifyRequest): string {
  return request.authActor || request.ip
}
