import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export const fieldVariants = cva('group/field flex w-full gap-3 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: ['flex-col [&>*]:w-full [&>.sr-only]:w-auto'],
      horizontal: ['flex-row items-center', '[&>[data-slot=field-label]]:flex-auto'],
      responsive: [
        'flex-col [&>*]:w-full [&>.sr-only]:w-auto @md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto',
        '@md/field-group:[&>[data-slot=field-label]]:flex-auto',
      ],
    },
  },
  defaultVariants: { orientation: 'vertical' },
})

export type FieldVariants = VariantProps<typeof fieldVariants>
