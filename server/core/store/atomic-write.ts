import fs from 'node:fs/promises'

/**
 * 临时文件 + fsync + rename 的原子 JSON 写入；JsonStore 与数据迁移共用同一份落盘实现。
 * 不依赖任何 store 实例：迁移发生在 store 创建之前，也必须能直接落盘。
 * 失败时清理临时文件并原样抛出——是否包装成 ApiError 由调用方决定（两边错误契约不同）。
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  // 临时名必须含 pid + 时间 + 随机数：多进程可能同时写同一目标，同名临时文件会互相覆盖
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    // wx 独占创建 + 0600：临时文件不覆盖他人，权限与最终文件一致
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, filePath)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
