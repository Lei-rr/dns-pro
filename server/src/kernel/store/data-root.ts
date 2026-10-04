import path from 'node:path'
import { ApiError } from '../http/api-error.js'

/**
 * 校验并解析存储路径：必须位于数据根内。
 * 数据根由装配层构造传入（config.dataDir），不存在模块级可变全局（D7）。
 */
export function resolveDataPath(root: string, relativePath: string): string {
  const base = path.resolve(root)
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new ApiError('server_error', 'Storage path must be relative to data root', 500)
  }
  const target = path.resolve(base, relativePath)
  const relation = path.relative(base, target)
  if (relation === '' || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new ApiError('server_error', 'Storage path escapes data root', 500)
  }
  return target
}
