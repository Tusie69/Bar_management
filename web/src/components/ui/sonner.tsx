import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useSession } from "@/state/session"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSession((s) => s.theme)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-[var(--st-seated)]" />,
        info: <InfoIcon className="size-4 text-[var(--primary-ink)]" />,
        warning: <TriangleAlertIcon className="size-4 text-[var(--st-upcoming)]" />,
        error: <OctagonXIcon className="size-4 text-[var(--destructive)]" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "shadow-[var(--shadow-float)] border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] rounded-[var(--radius-lg)] font-sans text-sm",
          description: "text-xs text-[var(--muted-foreground)]",
          actionButton: "rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] font-medium",
          cancelButton: "rounded-[var(--radius-sm)] bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
