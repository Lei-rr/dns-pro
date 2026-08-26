<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from '@/shared/ui/sonner'
import { ConfirmHost } from '@/shared/ui/confirm'
import { TooltipProvider } from '@/shared/ui/tooltip'
</script>

<template>
  <TooltipProvider>
    <RouterView />
    <Toaster position="top-center" :close-button="true" />
    <ConfirmHost />
  </TooltipProvider>
</template>
