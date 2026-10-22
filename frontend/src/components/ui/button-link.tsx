import * as React from 'react'
import { createLink } from '@tanstack/react-router'
import type { VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { buttonVariants } from '@/components/ui/button'

type ButtonLinkAnchorProps = React.ComponentProps<'a'> &
  VariantProps<typeof buttonVariants>

const ButtonLinkAnchor = React.forwardRef<
  HTMLAnchorElement,
  ButtonLinkAnchorProps
>(function ButtonLinkAnchor({ className, variant, size, ...props }, ref) {
  return (
    <a
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})

export const ButtonLink = createLink(ButtonLinkAnchor)
