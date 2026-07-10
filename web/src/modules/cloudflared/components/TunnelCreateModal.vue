<template>
  <a-modal :open="open" @update:open="v => $emit('update:open', v)" title="创建隧道" :confirm-loading="confirmLoading" :ok-button-props="{ disabled: !canSubmit }" ok-text="创建" cancel-text="取消" @ok="submit">
    <a-form layout="vertical">
      <a-form-item label="隧道名称" required>
        <a-input v-model:value="name" placeholder="如 home-server / ctyun" @keyup.enter="submit" />
      </a-form-item>
      <a-typography-text type="secondary" style="font-size: 12px">
        创建后将获得隧道凭据（token），在服务器上运行客户端即可激活。
      </a-typography-text>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  open?: boolean
  confirmLoading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', name: string): void
}>()

const name = ref('')

watch(() => props.open, (value) => {
  if (value) name.value = ''
})

const canSubmit = computed(() => String(name.value || '').trim().length > 0)

function submit() {
  if (!canSubmit.value) return
  emit('submit', String(name.value).trim())
}
</script>
