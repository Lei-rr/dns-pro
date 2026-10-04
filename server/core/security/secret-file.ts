import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** 读取前收紧权限（0600）；不存在或内容不合规（parse 返回 null）时返回 null */
async function readSecretFile<T>(filePath: string, parse: (raw: string) => T | null): Promise<T | null> {
  try {
    await fs.chmod(filePath, 0o600)
    const raw = (await fs.readFile(filePath, 'utf8')).trim()
    return parse(raw)
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null
    throw error
  }
}

/**
 * 加载或原子创建私有文件（0600）：凭据密钥、会话密钥等「首次运行自动生成」的文件。
 * - 已有文件交给 parse 判定：合法则直接复用；不合法不会被重建 —— link 的 EEXIST 会让流程落到
 *   「竞争落败」分支并抛出 invalidMessage，既有文件原样保留（损坏文件需人工处理）
 * - 创建走「临时文件 + link」：link 的 EEXIST 语义保证多进程并发启动时只有一个赢家落盘，
 *   落败方读取赢家的结果，避免两个进程各自攥着一份不同密钥
 */
export async function loadOrCreateSecretFile<T>(options: {
  filePath: string
  parse: (raw: string) => T | null
  /** 生成落盘文本与对应的返回值 */
  generate: () => { content: string; value: T }
  /** 竞争落败且既有文件内容不合法时的错误文案 */
  invalidMessage: string
}): Promise<T> {
  const existing = await readSecretFile(options.filePath, options.parse)
  if (existing !== null) return existing

  const directory = path.dirname(options.filePath)
  await fs.mkdir(directory, { recursive: true })
  const { content, value } = options.generate()
  const temporary = path.join(directory, `${path.basename(options.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temporary, content, { mode: 0o600 })
  try {
    await fs.link(temporary, options.filePath)
    await fs.chmod(options.filePath, 0o600)
    return value
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error
    const winner = await readSecretFile(options.filePath, options.parse)
    if (winner !== null) return winner
    throw Object.assign(new Error(options.invalidMessage), { cause: error })
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
