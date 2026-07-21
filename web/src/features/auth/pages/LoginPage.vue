<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/lib/utils'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/features/auth/stores/session'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

const router = useRouter()
const session = useSessionStore()
const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  const user = username.value.trim()
  const pass = password.value
  if (!user || !pass || loading.value) return
  if (/\s/.test(pass)) {
    toast.warning('密码不能包含空格')
    return
  }
  loading.value = true
  try {
    await session.login(user, pass)
    toast.success('登录成功')
    router.replace('/')
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <!-- Official login-01 block layout -->
  <div class="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
    <div class="w-full max-w-sm">
      <div :class="cn('flex flex-col gap-6')">
        <Card>
          <CardHeader>
            <CardTitle>登录 DNS-PRO</CardTitle>
            <CardDescription>输入账号密码后管理 DNS / EdgeOne / Tunnel</CardDescription>
          </CardHeader>
          <CardContent>
            <form @submit.prevent="submit">
              <FieldGroup>
                <Field>
                  <FieldLabel for="username">用户名</FieldLabel>
                  <Input
                    id="username"
                    v-model="username"
                    placeholder="请输入用户名"
                    autocomplete="username"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel for="password">密码</FieldLabel>
                  <Input
                    id="password"
                    v-model="password"
                    type="password"
                    placeholder="请输入密码"
                    autocomplete="current-password"
                    required
                  />
                </Field>
                <Field>
                  <Button
                    type="submit"
                    class="w-full"
                    :loading="loading"
                    :disabled="!username.trim() || !password"
                  >
                    登录
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
