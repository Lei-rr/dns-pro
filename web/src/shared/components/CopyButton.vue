<template>
  <a-button type="link" size="small" title="复制" class="copy-button" @click="copy">
    <template #icon><span aria-hidden="true">⧉</span></template>
  </a-button>
</template>

<script setup lang="ts">
import { message } from '@/shared/plugins/antDesignVue'

const props = defineProps<{
  value?: string | number
}>()

async function copy() {
  const text = String(props.value || '')

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制')
      return
    } catch {
      // fallback
    }
  }

  if (fallbackCopy(text)) {
    message.success('已复制')
  } else {
    message.warning('复制失败，请手动选择复制')
  }
}

function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
</script>
