import path from 'node:path'
import { ApiError } from '../../shared/http/api-error.js'

let dataRoot = path.join(process.cwd(), 'data')
const listeners = new Set<() => void>()

export function setDataRoot(root: string): void {
  dataRoot = path.resolve(root)
  for (const listener of listeners) listener()
}

export function getDataRoot(): string {
  return dataRoot
}

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

export function onDataRootChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
