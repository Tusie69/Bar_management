# Bar Management

Hệ thống quản lý đặt bàn nội bộ cho quán bar. Dự án ưu tiên bản web dùng trên máy tính bảng; giao diện có thể được đóng gói thành ứng dụng Android bằng Capacitor ở giai đoạn sau.

## Công nghệ

- `web`: React + Vite + JavaScript
- `api`: Express + JavaScript
- `database`: MySQL 8
- `docs`: hợp đồng API và tài liệu kỹ thuật

## Yêu cầu

- Node.js 22 trở lên
- npm 10 trở lên
- MySQL 8

## Cài đặt

```powershell
npm install
Copy-Item api/.env.example api/.env
```

Tạo database rỗng tên `gam21_dev`, cập nhật thông tin kết nối trong `api/.env`, sau đó chạy:

```powershell
npm run db:migrate
npm run db:seed
```

Mở hai terminal:

```powershell
npm run dev:api
npm run dev:web -- --host 0.0.0.0
```

- Web: `http://localhost:5173`
- API health check: `http://localhost:3000/api/v1/health`

Tablet cùng Wi-Fi có thể truy cập `http://<IP-laptop>:5173`. Trong bản demo, laptop vẫn phải chạy cả web, API và MySQL.

## Kiểm tra

```powershell
npm test
npm run lint
npm run build
```

## Lưu ý nghiệp vụ

- Danh sách bàn trong `database/seeds` hiện chỉ là dữ liệu mẫu vì nhóm chưa cung cấp sơ đồ bàn thật.
- Trạng thái theo ngày được lưu riêng; trạng thái `RESERVED` sẽ được suy ra từ booking khi module booking hoàn thiện.
- Ngày kinh doanh qua 0 giờ và thời lượng giữ bàn vẫn cần PO xác nhận trước khi triển khai API booking.
