"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** Sonner's toaster with Margin's icons and tokens. The screen passes its own light or dark theme. */
const Toaster = ({ theme = "system", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast gap-3! px-4! py-3! text-sm! shadow-md!",
          actionButton: "h-7! rounded-md! bg-primary! px-2.5! text-[13px]! text-primary-foreground! hover:bg-primary/85!",
          cancelButton: "h-7! rounded-md! bg-transparent! px-2.5! text-[13px]! text-foreground! hover:bg-muted!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
