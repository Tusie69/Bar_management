import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router"
import { ConflictDialog, OverrideDialog } from "@/components/dialogs"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { FloorPage } from "@/features/floor/floor-page"
import { AuthBoundary } from "@/features/auth/auth-boundary"
import { useRealtimeSync } from "@/hooks/use-data"
import { AppShell } from "./shell"

const OverviewPage = lazy(() => import("@/features/overview/overview-page"))
const ReservationsPage = lazy(() => import("@/features/reservations/reservations-page"))
const WaitlistPage = lazy(() => import("@/features/waitlist/waitlist-page"))
const GuestsPage = lazy(() => import("@/features/guests/guests-page"))
const ReportsPage = lazy(() => import("@/features/reports/reports-page"))
const SettingsPage = lazy(() => import("@/features/settings/settings-page"))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function PageFallback() {
  return (
    <div className="grid gap-3 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  )
}

const page = (el: React.ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/floor" replace /> },
      { path: "overview", element: page(<OverviewPage />) },
      { path: "floor", element: <FloorPage /> },
      { path: "reservations", element: page(<ReservationsPage />) },
      { path: "waitlist", element: page(<WaitlistPage />) },
      { path: "guests", element: page(<GuestsPage />) },
      { path: "reports", element: page(<ReportsPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "*", element: <Navigate to="/floor" replace /> },
    ],
  },
])

function GlobalLayer() {
  useRealtimeSync()
  return (
    <>
      <ConflictDialog />
      <OverrideDialog />
    </>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <AuthBoundary>
          <GlobalLayer />
          <RouterProvider router={router} />
        </AuthBoundary>
        <Toaster position="top-center" richColors={false} closeButton visibleToasts={3} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
