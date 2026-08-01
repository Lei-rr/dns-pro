<script setup lang="ts">
import type { ComboboxInputEmits, ComboboxInputProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ComboboxInput, useForwardPropsEmits } from 'reka-ui'
import { Input } from '@/shared/ui/input'

defineOptions({ inheritAttrs: false })

const props = defineProps<ComboboxInputProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ComboboxInputEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ComboboxInput as-child data-slot="combobox-text-input" v-bind="{ ...$attrs, ...forwarded }">
    <Input :class="props.class">
      <slot />
    </Input>
  </ComboboxInput>
</template>
