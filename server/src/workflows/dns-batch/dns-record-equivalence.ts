function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function normalizeDnsName(value: unknown): string {
  return text(value).toLowerCase().replace(/\.+$/, '')
}

export function normalizeDnsValue(type: unknown, value: unknown): string {
  const recordType = text(type).toUpperCase()
  return ['CNAME', 'NS', 'PTR', 'MX'].includes(recordType) ? normalizeDnsName(value) : text(value)
}

function sameOptionalNumber(actual: unknown, expected: unknown): boolean {
  return expected === undefined || expected === '' || Number(actual) === Number(expected)
}

function sameOptionalText(actual: unknown, expected: unknown): boolean {
  return expected === undefined || text(actual) === text(expected)
}

export function cloudflareCreateMatches(record: Record<string, unknown>, input: Record<string, unknown>): boolean {
  const type = text(input.type).toUpperCase()
  return (
    normalizeDnsName(record.name) === normalizeDnsName(input.name) &&
    text(record.type).toUpperCase() === type &&
    normalizeDnsValue(type, record.content) === normalizeDnsValue(type, input.content) &&
    sameOptionalNumber(record.ttl, input.ttl) &&
    sameOptionalNumber(record.priority, input.priority) &&
    sameOptionalText(record.comment, input.comment) &&
    (input.proxied === undefined || Boolean(record.proxied) === Boolean(input.proxied))
  )
}

export function dnsPodCreateMatches(record: object, input: Record<string, unknown>): boolean {
  const row = record as Record<string, unknown>
  const type = text(input.record_type).toUpperCase()
  const expectedName = text(input.subdomain || '@').toLowerCase()
  const expectedLine = text(input.record_line || '默认')
  const expectedLineId = text(input.record_line_id)
  const lineMatches = expectedLineId ? text(row.line_id) === expectedLineId : text(row.line) === expectedLine
  return (
    text(row.name).toLowerCase() === expectedName &&
    text(row.type).toUpperCase() === type &&
    normalizeDnsValue(type, row.value) === normalizeDnsValue(type, input.value) &&
    lineMatches &&
    sameOptionalNumber(row.ttl, input.ttl) &&
    sameOptionalNumber(row.mx, input.mx) &&
    sameOptionalNumber(row.weight, input.weight) &&
    sameOptionalText(row.status, input.status) &&
    sameOptionalText(row.remark, input.remark)
  )
}
