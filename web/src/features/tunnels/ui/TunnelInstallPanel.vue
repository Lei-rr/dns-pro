<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { toast } from '@/shared/lib/toast'

const props = defineProps<{
  token?: string
}>()

const os = ref('debian')
const arch = ref('amd64')

const osTabs = [
  { key: 'windows', label: 'Windows' },
  { key: 'macos', label: 'macOS' },
  { key: 'debian', label: 'Debian / Ubuntu' },
  { key: 'redhat', label: 'CentOS / RHEL' },
  { key: 'docker', label: 'Docker' },
]

const archTabs = computed(() => {
  if (os.value === 'windows') {
    return [
      { key: 'amd64', label: '64 位' },
      { key: '386', label: '32 位' },
    ]
  }
  return []
})

const RELEASE_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download'

const steps = computed(() => {
  const token = props.token
  if (!token) return [] as Array<{ text: string; command?: string }>

  if (os.value === 'windows') {
    const file = `cloudflared-windows-${arch.value}.msi`
    return [
      { text: `下载安装包 ${file}`, command: `${RELEASE_BASE}/${file}` },
      { text: '运行安装程序完成安装' },
      { text: '以管理员身份打开命令提示符（CMD）' },
      { text: '运行以下命令安装并启动服务：', command: `cloudflared.exe service install ${token}` },
    ]
  }

  if (os.value === 'macos') {
    return [
      { text: '安装 cloudflared：', command: 'brew install cloudflared' },
      { text: '安装为系统服务：', command: `sudo cloudflared service install ${token}` },
      { text: '或手动运行隧道：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  if (os.value === 'debian') {
    const install =
      '# 添加 Cloudflare GPG key\n' +
      'sudo mkdir -p --mode=0755 /usr/share/keyrings\n' +
      'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null\n' +
      '# 添加 apt 源\n' +
      "echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list\n" +
      '# 安装 cloudflared\n' +
      'sudo apt-get update && sudo apt-get install cloudflared'
    return [
      { text: '安装 cloudflared：', command: install },
      { text: '安装为系统服务：', command: `sudo cloudflared service install ${token}` },
      { text: '或手动运行隧道：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  if (os.value === 'redhat') {
    const install =
      '# 添加 cloudflared.repo\n' +
      'curl -fsSl https://pkg.cloudflare.com/cloudflared-ascii.repo | sudo tee /etc/yum.repos.d/cloudflared.repo\n' +
      '# 更新源并安装\n' +
      'sudo yum update && sudo yum install cloudflared'
    return [
      { text: '安装 cloudflared：', command: install },
      { text: '安装为系统服务：', command: `sudo cloudflared service install ${token}` },
      { text: '或手动运行隧道：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  return [
    {
      text: '通过 Docker 运行隧道：',
      command: `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${token}`,
    },
  ]
})

watch(os, () => {
  arch.value = archTabs.value[0]?.key || 'amd64'
})

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command)
    toast.success('命令已复制')
  } catch {
    toast.warning('复制失败，请手动选择')
  }
}
</script>

<template>
  <div class="min-w-0 max-w-full space-y-4">
    <div class="min-w-0 max-w-full overflow-x-auto">
      <Tabs v-model="os">
        <TabsList class="w-max">
          <TabsTrigger v-for="item in osTabs" :key="item.key" :value="item.key">{{ item.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <div v-if="archTabs.length" class="min-w-0 max-w-full overflow-x-auto">
      <Tabs v-model="arch">
        <TabsList class="w-max">
          <TabsTrigger v-for="item in archTabs" :key="item.key" :value="item.key">{{ item.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <ol class="min-w-0 max-w-full space-y-3 pl-5 text-sm">
      <li v-for="(step, index) in steps" :key="index" class="min-w-0 list-decimal">
        <div class="mb-2">{{ step.text }}</div>
        <div
          v-if="step.command"
          class="relative min-w-0 max-w-full rounded-md bg-zinc-900 p-3 pr-12 font-mono text-xs leading-6 break-all whitespace-pre-wrap text-zinc-100"
        >
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1 right-1 size-8 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            @click="copyCommand(step.command)"
          >
            <Copy class="size-4" />
          </Button>
          {{ step.command }}
        </div>
      </li>
    </ol>

    <p class="text-muted-foreground text-xs">
      命令中已内嵌隧道凭据，请勿在公开场合分享。客户端启动后状态会自动更新为「已连接」。
    </p>
  </div>
</template>
