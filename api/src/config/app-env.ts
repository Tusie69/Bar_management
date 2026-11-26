/**
 * TU-41: tên môi trường triển khai, tách khỏi NODE_ENV.
 *
 * NODE_ENV nói "chạy theo chế độ nào" (production siết secret, cookie Secure…).
 * APP_ENV nói "đây là bản nào của quán": Production thật hay bản Dev chạy song
 * song trên cùng VPS. Bản Dev vẫn chạy NODE_ENV=production để giữ nguyên mọi
 * lớp bảo vệ, nên không thể dựa vào NODE_ENV để biết mình đang ở Dev.
 *
 *   production — bản quán đang dùng thật.
 *   dev        — bản demo/thử nghiệm, dữ liệu giả, có dải băng đỏ.
 *   local      — máy lập trình viên và môi trường test.
 *
 * Các tính năng chỉ dành cho Dev (đồng hồ giả lập TU-42, nút tạo dữ liệu mẫu
 * TU-43) phải kiểm tra `env.appEnv === 'dev'`, không kiểm tra NODE_ENV.
 */
export type AppEnv = 'production' | 'dev' | 'local'

const APP_ENVS: readonly AppEnv[] = ['production', 'dev', 'local']

export function resolveAppEnv(raw: string | undefined, nodeEnv: string, databaseName: string): AppEnv {
  const value = raw?.trim() || (nodeEnv === 'production' ? 'production' : 'local')
  if (!APP_ENVS.includes(value as AppEnv)) {
    throw new Error(`APP_ENV phải là một trong: ${APP_ENVS.join(', ')}`)
  }
  const appEnv = value as AppEnv

  // Hai chốt chặn hai chiều theo tên database. Một file .env chép nhầm giữa hai
  // thư mục là lỗi dễ xảy ra nhất khi chạy hai bản trên cùng máy; chặn ngay lúc
  // khởi động tốt hơn là để bản Dev bật tính năng thử nghiệm trên dữ liệu quán.
  if (appEnv === 'dev' && !/_dev$/.test(databaseName)) {
    throw new Error('APP_ENV=dev chỉ được phép khi DB_NAME kết thúc bằng _dev')
  }
  if (appEnv === 'production' && /_(dev|test)$/.test(databaseName)) {
    throw new Error('APP_ENV=production không được trỏ vào database _dev hoặc _test')
  }
  return appEnv
}
