#!/usr/bin/env node
import fs from 'node:fs/promises'
import { registerApiRoutes } from '../src/bootstrap/register-routes.js'

type RouteEntry = { method: string; path: string }
type RoutePlugin = (app: RouteCollector) => unknown | Promise<unknown>

function joinPath(prefix: string, path: string): string {
  const value = `${prefix}/${path}`.replace(/\/+/g, '/')
  return value.length > 1 ? value.replace(/\/$/, '') : value
}

class RouteCollector {
  constructor(
    private readonly prefix: string,
    private readonly routes: RouteEntry[]
  ) {}

  addHook(): void {}

  async register(plugin: RoutePlugin, options: { prefix?: string } = {}): Promise<void> {
    await plugin(new RouteCollector(joinPath(this.prefix, options.prefix || ''), this.routes))
  }

  private add(method: string, path: string): void {
    this.routes.push({ method, path: joinPath(this.prefix, path) })
  }

  get(path: string): void {
    this.add('GET', path)
  }
  post(path: string): void {
    this.add('POST', path)
  }
  put(path: string): void {
    this.add('PUT', path)
  }
  patch(path: string): void {
    this.add('PATCH', path)
  }
  delete(path: string): void {
    this.add('DELETE', path)
  }
  head(path: string): void {
    this.add('HEAD', path)
  }
  options(path: string): void {
    this.add('OPTIONS', path)
  }
}

const routes: RouteEntry[] = []
await registerApiRoutes(new RouteCollector('/api', routes) as never)
routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method))
const output = `${JSON.stringify(routes, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = await fs.readFile('scripts/api-route-manifest.json', 'utf8')
  if (current !== output) throw new Error('API route manifest is stale; run npm run routes:manifest')
  console.log(`route-manifest=ok routes=${routes.length}`)
} else {
  await fs.writeFile('scripts/api-route-manifest.json', output)
  console.log(`route-manifest=updated routes=${routes.length}`)
}
