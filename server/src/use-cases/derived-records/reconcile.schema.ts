import { Type } from 'typebox'
import { identifier, requestSchema } from '../../kernel/http/request-schema.js'

/** 派生来源类型（§4.2 SourceKind）：按域扫描时用于收敛到单一产品线 */
const sourceKind = Type.Union([
  Type.Literal('saas-hostname'),
  Type.Literal('tunnel-route'),
  Type.Literal('edgeone-domain'),
])

/** 对账范围：provider_id 命中声明派生关系的服务商或其 DNS 目标服务商；缺省即全量 */
const scopeFields = {
  provider_id: Type.Optional(identifier()),
  kind: Type.Optional(sourceKind),
}

/** F1 健康视图 / F2 检测：只读 */
export const reconcileDetectSchema = requestSchema({
  querystring: Type.Object(scopeFields, { additionalProperties: false }),
})

/** F2 手动对账 / F1 一键修复：检测后经 DnsWriter 执行漂移项 */
export const reconcileApplySchema = requestSchema({
  body: Type.Object(scopeFields, { additionalProperties: false }),
})
