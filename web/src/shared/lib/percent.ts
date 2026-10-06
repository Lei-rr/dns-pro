/**
 * 百分比归一的唯一来源：null / NaN → null，其余 clamp 到 0-100。
 *
 * 轮询层（进度值计算）与展示层（进度条渲染）对越界进度必须给出一致结果，
 * 因此 clamp 规则只写在这里。取整不属于归一：需要整数的调用方先 Math.round，
 * 展示层保留传入精度。
 */
export function normalizePercent(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}
