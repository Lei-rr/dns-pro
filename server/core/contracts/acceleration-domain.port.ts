/**
 * 契约端口：加速域名生命周期。
 *
 * workflows 只依赖本端口，不依赖 modules 内的服务类；端口只声明编排实际消费的方法，
 * 面板端 CRUD 仍由 modules 的 handlers 直接调用模块服务。
 * 形状厂商无关：字段名为项目对外契约（HTTP 响应）里已有的归一化命名，不是 SDK 原始字段。
 * 读模型只在本文件的端口签名内命名（暂不导出）：当前只有编排消费它，实现按结构兼容返回超集。
 */

/** 加速域名读模型：编排用它做归属取证与 CNAME 快照 */
interface AccelerationDomainValue {
  zone_id?: string
  /** 已归一化的域名（小写、去尾点） */
  name: string
  /** 上游尚未分配 CNAME 时为空 */
  cname?: string
  status?: string
}

/** 写入结果：厂商侧标识 + 请求 ID（用 type 而非 interface：编排要把它展开进响应体 Record） */
type AccelerationDomainMutation = { name: string; request_id?: string }

/** 创建结果：写入结果 + 所有权验证信息（域名归属校验，直接进响应体） */
type AccelerationDomainCreateResult = {
  name: string
  request_id?: string
  ownership_verification: unknown
}

/** 状态切换结果 */
type AccelerationDomainStatusResult = { name: string; request_id?: string; status: string }

/** 加速域名端口：读取、创建、删除、状态切换，以及写前归一化与缓存失效 */
export interface AccelerationDomainPort {
  /** 站点内的加速域名清单（refresh 强制回源） */
  accelerationDomains(
    providerId: string,
    zoneId: string,
    refresh?: boolean
  ): Promise<{ items: AccelerationDomainValue[] }>
  /** 读取域名已分配的 CNAME；域名不存在时抛 404 */
  assignedCname(providerId: string, zoneId: string, domainName: string, refresh?: boolean): Promise<string>
  /** 创建加速域名；写入负载的域名先经 domainNameOf 归一化 */
  createAccelerationDomain(
    providerId: string,
    zoneId: string,
    data: Record<string, unknown>
  ): Promise<AccelerationDomainCreateResult>
  /** 删除加速域名；域名已不存在时抛 404，编排据此判定"远端已删" */
  deleteAccelerationDomain(providerId: string, zoneId: string, domainName: string): Promise<AccelerationDomainMutation>
  /** 切换加速域名状态（online / offline） */
  updateAccelerationDomainStatus(
    providerId: string,
    zoneId: string,
    domainName: string,
    status: string
  ): Promise<AccelerationDomainStatusResult>
  /** 从写入负载解析归一化域名；domain_name 缺失或空白时抛 422 */
  domainNameOf(data: Record<string, unknown>): string
  /** 丢弃站点加速域名缓存：远端已不存在时，编排用它清掉本地陈旧副本 */
  invalidateCache(providerId: string, zoneId: string): void
}
