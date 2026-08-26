<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { AppTooltip } from '@/shared/ui/tooltip'
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

const steps = computed(() => {
  const token = props.token
  if (!token) return [] as Array<{ text: string; command?: string }>

  if (os.value === 'windows') {
    return [
      {
        text: '方式 A：PowerShell 一键安装并注册系统服务（需管理员权限）：',
        command: `winget install --id Cloudflare.cloudflared -e; cloudflared.exe service install ${token}`,
      },
      {
        text: '方式 B：手动下载 MSI 安装后注册服务：',
        command: `cloudflared.exe service install ${token}`,
      },
      {
        text: '方式 C：临时前台调试运行：',
        command: `cloudflared.exe tunnel run --token ${token}`,
      },
    ]
  }

  if (os.value === 'macos') {
    return [
      { text: '第 1 步：通过 Homebrew 安装 cloudflared', command: 'brew install cloudflared' },
      { text: '第 2 步：安装为 macOS 系统守护服务', command: `sudo cloudflared service install ${token}` },
      { text: '或临时前台调试运行：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  if (os.value === 'debian') {
    const install =
      '# 添加 Cloudflare 源并安装\n' +
      'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null\n' +
      "echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list\n" +
      'sudo apt-get update && sudo apt-get install -y cloudflared'
    return [
      { text: '第 1 步：安装 cloudflared', command: install },
      { text: '第 2 步：注册并启动 systemd 系统服务', command: `sudo cloudflared service install ${token}` },
      { text: '或临时前台调试运行：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  if (os.value === 'redhat') {
    const install =
      '# 添加 cloudflared.repo 并安装\n' +
      'curl -fsSL https://pkg.cloudflare.com/cloudflared-ascii.repo | sudo tee /etc/yum.repos.d/cloudflared.repo\n' +
      'sudo yum update -y && sudo yum install -y cloudflared'
    return [
      { text: '第 1 步：安装 cloudflared', command: install },
      { text: '第 2 步：注册并启动系统服务', command: `sudo cloudflared service install ${token}` },
      { text: '或临时前台调试运行：', command: `cloudflared tunnel run --token ${token}` },
    ]
  }

  return [
    {
      text: '方式 A：Docker CLI 容器运行（后台守护重启模式）：',
      command: `docker run -d --name cloudflared --restart unless-stopped cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${token}`,
    },
    {
      text: '方式 B：Docker Compose 配置（compose.yaml 片段）：',
      command: `services:\n  tunnel:\n    image: cloudflare/cloudflared:latest\n    restart: unless-stopped\n    command: tunnel --no-autoupdate run --token ${token}`,
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
          <AppTooltip content="复制安装命令">
            <Button
              variant="ghost"
              size="icon"
              class="absolute top-1 right-1 size-8 text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer"
              @click="copyCommand(step.command)"
            >
              <Copy class="size-4" />
            </Button>
          </AppTooltip>
          {{ step.command }}
        </div>
      </li>
    </ol>

    <p class="text-muted-foreground text-xs">
      命令中已内嵌隧道凭据，请勿在公开场合分享。客户端启动后状态会自动更新为「已连接」。
    </p>
  </div>
</template>
