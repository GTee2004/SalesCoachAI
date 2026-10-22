import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cva } from 'class-variance-authority'
import { XIcon } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

function ResponsiveModal({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="responsive-modal" {...props} />
}

function ResponsiveModalTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return (
    <DialogPrimitive.Trigger data-slot="responsive-modal-trigger" {...props} />
  )
}

function ResponsiveModalPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return (
    <DialogPrimitive.Portal data-slot="responsive-modal-portal" {...props} />
  )
}

function ResponsiveModalClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="responsive-modal-close" {...props} />
}

function ResponsiveModalOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="responsive-modal-overlay"
      className={cn(
        'fixed inset-0 z-100 bg-background/80 backdrop-blur-sm data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

const responsiveModalVariants = cva(
  cn(
    'fixed z-100 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[open]:animate-in data-[closed]:animate-out data-[closed]:animation-duration-[300ms] data-[open]:animation-duration-[500ms] overflow-y-auto',
    'lg:left-[50%] lg:top-[50%] lg:translate-x-[-50%] lg:translate-y-[-50%] lg:border lg:duration-200 lg:data-[open]:animate-in lg:data-[closed]:animate-out lg:data-[closed]:fade-out-0 lg:data-[open]:fade-in-0 lg:data-[closed]:zoom-out-95 lg:data-[open]:zoom-in-95 lg:data-[closed]:slide-out-to-left-1/2 lg:data-[closed]:slide-out-to-top-[48%] lg:data-[open]:slide-in-from-left-1/2 lg:data-[open]:slide-in-from-top-[48%] lg:rounded-xl',
  ),
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b rounded-b-xl max-h-[80dvh] lg:h-fit data-[closed]:slide-out-to-top data-[open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 border-t lg:h-fit max-h-[80dvh] rounded-t-xl data-[closed]:slide-out-to-bottom data-[open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full lg:h-fit w-3/4 border-r rounded-r-xl data-[closed]:slide-out-to-left data-[open]:slide-in-from-left sm:max-w-sm',
        right:
          'inset-y-0 right-0 h-full lg:h-fit w-3/4 border-l rounded-l-xl data-[closed]:slide-out-to-right data-[open]:slide-in-from-right sm:max-w-sm',
      },
    },
    defaultVariants: {
      side: 'bottom',
    },
  },
)

interface ResponsiveModalContentProps
  extends
    DialogPrimitive.Popup.Props,
    VariantProps<typeof responsiveModalVariants> {
  showCloseButton?: boolean
}

function ResponsiveModalContent({
  side = 'bottom',
  className,
  children,
  showCloseButton = true,
  ...props
}: ResponsiveModalContentProps) {
  return (
    <ResponsiveModalPortal>
      <ResponsiveModalOverlay />
      <DialogPrimitive.Popup
        data-slot="responsive-modal-content"
        className={cn(responsiveModalVariants({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="responsive-modal-close"
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[open]:bg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </ResponsiveModalPortal>
  )
}

function ResponsiveModalHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="responsive-modal-header"
      className={cn(
        'flex flex-col space-y-2 text-center sm:text-left',
        className,
      )}
      {...props}
    />
  )
}

function ResponsiveModalFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="responsive-modal-footer"
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        className,
      )}
      {...props}
    />
  )
}

function ResponsiveModalTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="responsive-modal-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function ResponsiveModalDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="responsive-modal-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  ResponsiveModal,
  ResponsiveModalPortal,
  ResponsiveModalOverlay,
  ResponsiveModalTrigger,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalFooter,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
}
