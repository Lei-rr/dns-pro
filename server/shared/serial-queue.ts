/**
 * 按键串行化异步任务：同一键上的读-改-写不会交错。
 * 用于隧道 Ingress 这类「先读全量、再整体写回」的操作。
 */
const queues = new Map<string, Promise<unknown>>()

export function runSerial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)
  const settled = current.catch(() => undefined)
  queues.set(key, settled)
  void settled.finally(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return current
}
