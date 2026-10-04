<script setup lang="ts">
import { ref, watch } from 'vue'
import { AppDialog } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { authApi } from '@/features/auth/api/auth-api'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

const props = defineProps<{
  open: boolean
  /** 仍在使用默认密码：不允许关闭，必须完成修改 */
  required?: boolean
}>()
const emit = defineEmits<{ 'update:open': [boolean]; changed: [] }>()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const saving = ref(false)

function reset() {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  error.value = ''
  saving.value = false
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  }
)

async function submit() {
  if (saving.value) return
  error.value = ''
  if (!currentPassword.value) {
    error.value = '请输入当前密码'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = '新密码至少 8 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }

  saving.value = true
  try {
    await authApi.changePassword(currentPassword.value, newPassword.value)
    toast.success('密码已更新，其它设备的登录已失效')
    emit('changed')
    emit('update:open', false)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="required ? '请先修改初始密码' : '修改密码'"
    content-class="sm:max-w-md"
    :prevent-close="required"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="space-y-3">
      <p v-if="required" class="text-xs text-muted-foreground leading-relaxed">
        当前仍在使用默认初始密码，出于安全考虑已暂停其它操作。请设置新密码后继续使用。
      </p>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">当前密码</label>
        <Input v-model="currentPassword" type="password" autocomplete="current-password" placeholder="当前密码" />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">新密码</label>
        <Input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位" />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">确认新密码</label>
        <Input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
      </div>
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    </div>
    <template #footer>
      <Button v-if="!required" variant="outline" :disabled="saving" @click="emit('update:open', false)">取消</Button>
      <Button :disabled="saving" @click="submit">{{ saving ? '提交中…' : '确认修改' }}</Button>
    </template>
  </AppDialog>
</template>
