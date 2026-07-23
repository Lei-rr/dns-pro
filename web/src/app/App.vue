<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from '@/shared/ui/sonner'
import { ConfirmHost } from '@/shared/ui/confirm'
</script>

<template>
  <RouterView />
  <!-- top-center 产品偏好；关闭钮右上角 + 宽度随文案（见 styles sonner 覆盖） -->
  <Toaster position="top-center" :close-button="true" close-button-position="top-right" />
  <ConfirmHost />
</template>
