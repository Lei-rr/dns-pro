<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/shared/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="alert-dialog-footer"
    :class="
      cn(
        'flex flex-col-reverse gap-2 [&>*]:w-full sm:flex-row sm:justify-end sm:[&>*]:w-auto',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
