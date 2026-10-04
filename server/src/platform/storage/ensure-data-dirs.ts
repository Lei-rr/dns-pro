import fs from 'node:fs/promises'
import path from 'node:path'

/** 创建运行时数据目录（仅属主可访问） */
export async function ensureDataDirs(dataRoot: string): Promise<void> {
  for (const dir of [dataRoot, path.join(dataRoot, 'saas'), path.join(dataRoot, 'jobs')]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    // 收紧已存在目录权限；只读挂载等情况忽略
    await fs.chmod(dir, 0o700).catch(() => undefined)
  }
}
