import { Cloud, Globe2, Radar, Server, Shield } from '@lucide/vue'
import type { Component } from 'vue'

/** 服务商类型 → 图标组件：导航命令面板（AppLayout）与控制台卡片（DashboardPage）共用，未识别类型回退到 Globe2 */
const providerIcons: Record<string, Component> = {
  dnspod: Globe2,
  cloudflare: Cloud,
  saas: Shield,
  edgeone: Radar,
  cloudflared: Server,
}

export function providerIcon(type: string): Component {
  return providerIcons[type] || Globe2
}
