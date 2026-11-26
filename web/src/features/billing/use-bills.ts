/**
 * TU-45 — query và mutation của bill.
 *
 * Ba quyết định về cache, và cả ba đều về tiền:
 *
 * 1. `billPreview` có `staleTime: 0`. Con số tạm tính đổi mỗi lần khách gọi
 *    thêm, và một con số cũ trên màn hình thu tiền là con số nhân viên sẽ đọc
 *    to cho khách.
 * 2. `bill` có `staleTime: Infinity`. Bill ĐÃ CHỐT là bất biến ở phía máy chủ,
 *    nên refetch nó chỉ tốn mạng mà không bao giờ ra số khác. Nó được làm mới
 *    bằng `invalidateQueries` sau khi trạng thái đổi, không bằng thời gian.
 * 3. KHÔNG có optimistic update ở bất kỳ bước nào. Màn hình chỉ nói "đã chốt"
 *    khi máy chủ đã trả bill. Một màn hình đoán trước rồi lùi lại là một màn
 *    hình đã có lần nói "đã thanh toán" cho một lần thanh toán thất bại.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  capturePayment,
  closeBill,
  confirmPayment,
  fetchBill,
  fetchBillPreview,
  fetchOpenBills,
  fetchPayment,
  type Bill,
  type CapturePaymentPayload,
  type CloseBillPayload,
  type ConfirmPaymentPayload,
  type PaymentResult,
} from "./billing-api"

export const billKeys = {
  preview: (visitId: number) => ["bill-preview", visitId] as const,
  bill: (billId: number) => ["bill", billId] as const,
  list: (businessDate: string) => ["bills", businessDate] as const,
}

export function useBillPreview(visitId: number | null) {
  return useQuery({
    queryKey: billKeys.preview(visitId ?? 0),
    queryFn: () => fetchBillPreview(visitId as number),
    enabled: visitId !== null,
    staleTime: 0,
    retry: false,
  })
}

export function useBill(billId: number | null) {
  return useQuery({
    queryKey: billKeys.bill(billId ?? 0),
    queryFn: () => fetchBill(billId as number),
    enabled: billId !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useOpenBills(businessDate: string) {
  return useQuery({
    queryKey: billKeys.list(businessDate),
    queryFn: () => fetchOpenBills(businessDate),
    // Khớp nhịp polling sơ đồ (15 giây). SSE `floor-changed` là đường nhanh;
    // nhịp này là lưới khi SSE rụng.
    staleTime: 15_000,
    retry: false,
  })
}

/**
 * Chốt bill.
 *
 * Sau khi thành công: bill mới được ĐẶT thẳng vào cache (`setQueryData`) thay vì
 * invalidate — máy chủ vừa trả về chính nó, nên một lần fetch nữa chỉ làm màn
 * hình nhấp nháy. Mọi thứ phản ánh trạng thái BÀN thì invalidate, vì bàn vừa
 * chuyển sang Chờ thanh toán và các màn hình khác đang hiện trạng thái cũ.
 */
export function useCloseBill() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: CloseBillPayload) => closeBill(payload),
    onSuccess: async (bill: Bill) => {
      client.setQueryData(billKeys.bill(bill.id), bill)
      await Promise.all([
        client.invalidateQueries({ queryKey: billKeys.preview(bill.visitId) }),
        client.invalidateQueries({ queryKey: ["bills"] }),
        client.invalidateQueries({ queryKey: ["floor"] }),
        client.invalidateQueries({ queryKey: ["visits"] }),
        client.invalidateQueries({ queryKey: ["waiter-floor"] }),
      ])
    },
  })
}

/* --------------------------- TU-46: thanh toán --------------------------- */

/**
 * Sau khi thu tiền: bàn vừa về Trống và lượt khách vừa +1, nên mọi thứ phản
 * ánh mặt bằng và báo cáo đều cũ. Bill thì được đặt thẳng vào cache — máy chủ
 * vừa trả về chính nó.
 */
async function invalidateAfterSettlement(client: QueryClient, result: PaymentResult): Promise<void> {
  client.setQueryData(billKeys.bill(result.bill.id), result.bill)
  await Promise.all([
    client.invalidateQueries({ queryKey: billKeys.preview(result.bill.visitId) }),
    client.invalidateQueries({ queryKey: ["bills"] }),
    client.invalidateQueries({ queryKey: ["floor"] }),
    client.invalidateQueries({ queryKey: ["visits"] }),
    client.invalidateQueries({ queryKey: ["waiter-floor"] }),
    client.invalidateQueries({ queryKey: ["table-turns"] }),
    client.invalidateQueries({ queryKey: ["table-turn-summary"] }),
    client.invalidateQueries({ queryKey: ["overview"] }),
  ])
}

export function useCapturePayment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: CapturePaymentPayload) => capturePayment(payload),
    onSuccess: async (result: PaymentResult) => {
      // Chuyển khoản dừng ở PENDING: chưa có đồng nào được ghi nhận, nên bàn
      // vẫn bận và không có gì để làm mới ngoài chính cái bill.
      if (result.settlement === null) {
        client.setQueryData(billKeys.bill(result.bill.id), result.bill)
        return
      }
      await invalidateAfterSettlement(client, result)
    },
  })
}

export function useConfirmPayment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: ConfirmPaymentPayload) => confirmPayment(payload),
    onSuccess: (result: PaymentResult) => invalidateAfterSettlement(client, result),
  })
}

/**
 * Nút "Kiểm tra" của Màn 6.
 *
 * KHÔNG phải một query tự chạy: mockup nói rõ khối "Chờ nhận tiền" không tự
 * chuyển trạng thái, và một query poll ngầm sẽ làm đúng cái điều đó. Đây là
 * một mutation vì nó chỉ chạy khi có người bấm.
 */
export function useCheckPayment() {
  return useMutation({
    mutationFn: ({ billId, paymentId }: { billId: number; paymentId: number }) => fetchPayment(billId, paymentId),
  })
}
