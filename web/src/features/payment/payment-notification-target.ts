import type { PaymentNotification } from "@/services/payment"

export function resolveNotificationBillCode(n: PaymentNotification): string | undefined {
  const direct = (n as PaymentNotification & { billCode?: unknown }).billCode
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  const paidMatch = /^paid-(B\d+(?:-\d+)?)-\d+-\d+$/.exec(n.id)
  if (paidMatch) return paidMatch[1]
  const pendMatch = /^pend-(B\d+(?:-\d+)?)$/.exec(n.id)
  if (pendMatch) return pendMatch[1]
  const textMatch = /\((B\d+(?:-\d+)?)\)/.exec(n.text)
  if (textMatch) return textMatch[1]
  return undefined
}

export function buildNotificationTargetPath(visitId: string, notification?: PaymentNotification): string {
  const billCode = notification ? resolveNotificationBillCode(notification) : undefined
  if (!billCode) return `/payment/${visitId}`
  const params = new URLSearchParams({ bill: billCode })
  return `/payment/${visitId}?${params.toString()}`
}
