/** 路径参数统一去首尾空白（前端可能对含空格的值做编码） */
export function trimmedParam<K extends string>(request: { params: Record<K, string> }, key: K): string {
  return request.params[key].trim()
}
