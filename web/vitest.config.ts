import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    /**
     * Bộ test chạy ở chế độ MOCK, cố định, không đọc `.env` của máy đang chạy.
     *
     * `api.mode` quyết định `isPaymentAvailable`, và màn thanh toán NA-45 render
     * rỗng khi nó là `http`. `.env` và `.env.local` đều bị .gitignore bỏ qua,
     * nên trước dòng này kết quả test phụ thuộc vào máy: xanh trên máy có
     * `VITE_API_MODE=mock`, đỏ 11 test trên máy đặt `http` — kể cả máy chủ
     * deploy, nơi `http` là bắt buộc để build production.
     *
     * Một bộ test đổi kết quả theo máy là một bộ test không ai tin, và ở đây nó
     * còn chặn cổng deploy vì một lý do không liên quan gì tới code.
     */
    env: { VITE_API_MODE: "mock" },
  },
})
