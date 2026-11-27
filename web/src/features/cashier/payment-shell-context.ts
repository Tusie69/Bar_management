import { createContext, useContext } from "react"

export interface PaymentShellContextValue {
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  scrollToTop: () => void
  pendingPayment: boolean
  setPendingPayment: (pending: boolean) => void
}

export const PaymentShellContext = createContext<PaymentShellContextValue | null>(null)

export function usePaymentShell() {
  return useContext(PaymentShellContext)
}
