import fs from 'node:fs/promises'
import path from 'node:path'

/** 创建运行时数据目录（仅属主可访问）；子目录由调用方按数据文件注册表提供 */
export async function ensureDataDirs(dataRoot: string, subdirectories: readonly string[]): Promise<void> {
  const directories = [dataRoot, ...subdirectories.map((directory) => path.join(dataRoot, directory))]
  for (const dir of directories) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    // 收紧已存在目录权限；只读挂载等情况忽略
    await fs.chmod(dir, 0o700).catch(() => undefined)
  }
}
