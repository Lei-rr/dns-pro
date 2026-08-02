#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const source = async (file: string) => readFile(new URL(file, root), 'utf8')

const detail = await source('web/src/features/tunnels/ui/TunnelDetailPanel.vue')
const install = await source('web/src/features/tunnels/ui/TunnelInstallPanel.vue')

assert.match(
  detail,
  /<div v-if="token" class="[^"]*min-w-0[^"]*">[\s\S]*<TunnelInstallPanel :token="token"\s*\/>/,
  'tunnel install card must be shrinkable on narrow screens'
)
assert.match(
  detail,
  /<div class="[^"]*min-w-0[^"]*flex-1[^"]*">[\s\S]*安装 Token[\s\S]*<div class="[^"]*min-w-0[^"]*truncate/,
  'token row must allow the token text to shrink instead of widening the page'
)
assert.match(
  install,
  /<div class="[^"]*min-w-0[^"]*max-w-full[^"]*">[\s\S]*<div class="[^"]*overflow-x-auto[^"]*">[\s\S]*<TabsList/,
  'install tabs must scroll inside the viewport on mobile'
)
assert.match(
  install,
  /<li v-for="\(step, index\) in steps"[^>]*class="[^"]*min-w-0[^"]*"/,
  'install steps must be shrinkable on narrow screens'
)
assert.match(
  install,
  /class="[^"]*min-w-0[^"]*max-w-full[^"]*break-all[^"]*whitespace-pre-wrap/,
  'install commands must wrap without creating horizontal overflow'
)

console.log('tunnel-mobile-width-probe=ok')
