<template>
  <a-layout style="min-height: 100vh; background: #fff">
    <a-layout-content style="display: flex; align-items: center; justify-content: center; padding: 24px">
      <div style="width: min(360px, calc(100vw - 32px))">
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 30px">
          <a-avatar shape="square" size="large" style="background: #1677ff">D</a-avatar>
          <div>
            <a-typography-title :level="3" style="margin: 0; line-height: 1">DNS-PRO</a-typography-title>
          </div>
        </div>
        <a-form layout="vertical" @submit.prevent="submit">
          <a-form-item style="margin-bottom: 18px">
            <a-input v-model:value="username" size="large" placeholder="请输入用户名" autocomplete="username" @pressEnter="submit" />
          </a-form-item>
          <a-form-item style="margin-bottom: 18px">
            <a-input-password v-model:value="password" size="large" placeholder="请输入密码" autocomplete="current-password" @pressEnter="submit" />
          </a-form-item>
          <a-button type="primary" size="large" block :loading="loading" :disabled="!username.trim() || !password" @click="submit">登录</a-button>
        </a-form>
      </div>
    </a-layout-content>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authApi } from '@/modules/system/api/auth'
import { message } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'

const router = useRouter()

const username = ref('')
const password = ref('')
const loading = ref(false)

onMounted(async () => {
  try {
    const response = await authApi.me()
    if (response.data?.authenticated) {
      router.replace('/')
      return
    }
  } catch (error: unknown) {
    // unauthenticated is expected on the login page
  }
})

async function submit() {
  const user = username.value.trim()
  const pass = password.value
  if (!user || !pass || loading.value) return
  if (/\s/.test(pass)) {
    message.warning('密码不能包含空格')
    return
  }

  loading.value = true
  try {
    await authApi.login(user, pass)
    router.replace('/')
  } catch (error: unknown) {
    message.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}
</script>
