/**
 * FX-04: mã chống trùng gửi trong header Idempotency-Key — sinh 1 mã mỗi lần mở form tạo.
 * crypto.randomUUID() chỉ có trên https/localhost; khi chạy qua mạng LAN bằng http thì tự tạo từ
 * crypto.getRandomValues() (có trên mọi trình duyệt).
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}
