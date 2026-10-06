/**
 * 词表查值：只认词表自有键，不沿原型链取值。
 *
 * 裸查表（`table[key]`）在 key 为 `constructor` / `__proto__` 这类**本来就全小写**的原型键时，
 * 会取到 `Object` 构造器或 `Object.prototype`，再被当成文案渲染出来（函数源码 / `[object Object]`）。
 * 注意 `toString` 这类驼峰原型键不会被命中——调用方多半先做过 `toLowerCase()`，
 * 归一后是 `tostring`，原型链上不存在。所以能踩中的只有全小写的少数键，但值来自上游接口，
 * 不能假定它一定落在词表内。
 *
 * web 的 lib 配置停在 ES2020，`Object.hasOwn` 没有类型定义；`hasOwnProperty.call` 语义等价且同样不查原型链。
 *
 * 第一个参数放宽为 `object` 而非 `Record<string, T>`：词表多为 `Record<联合类型, T>`（封闭映射），
 * 无法赋给要求「任意 string 键」的索引签名，调用方按需显式给出值的类型。
 */
export function ownValue<T>(table: object, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? (table as Record<string, T>)[key] : undefined
}
