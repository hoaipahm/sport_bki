# Chạy Sport BKI trên máy hiện tại

Cập nhật ngày 25/11/2026. Repo ở `C:\Users\THE HOAI\Downloads\$$$\sport_bki`.

## Mở ứng dụng

| Cổng | Địa chỉ |
|---|---|
| Khách hàng | http://localhost:3000 |
| Lịch đặt cá nhân | http://localhost:3000/my-bookings |
| Hồ sơ | http://localhost:3000/profile |
| Nhân viên | http://localhost:3000/staff |
| Chủ sân | http://localhost:3000/admin |
| Quản trị nền tảng | http://localhost:3000/platform |
| API và Swagger | http://localhost:4000/health và http://localhost:4000/docs |

Đăng ký tài khoản khách hàng trực tiếp trên web. Môi trường này dùng `AUTH_EMAIL_MODE=local`: mã OTP được hiển thị rõ là mã thử nghiệm, không phải email đã gửi. Thanh toán sandbox được gắn nhãn thử nghiệm và không chuyển tiền thật. Các tài khoản quản trị mẫu nằm trong `.runtime/LOCAL_ACCESS.txt`, không được dùng trên hệ thống thật.

## Khởi động lại

Mở PowerShell tại thư mục repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

Launcher dùng PostgreSQL riêng tại `.runtime/postgres`, cổng `55432`, và Redis tại `.runtime/redis`, cổng `56379`. Nó chạy API và web trong nền, ghi log vào `.runtime`, rồi kiểm tra HTTP và health. Không sử dụng database PostgreSQL đang có sẵn trên cổng mặc định của máy. Cụm local dùng PostgreSQL 18 và Redis Windows 8.10.3; Docker Compose vẫn mô tả PostgreSQL 16. Chưa kiểm chứng runtime bằng Docker trong lần này.

Nếu đổi mã nguồn, build trước rồi khởi động lại đúng tiến trình của repo:

```powershell
npm --prefix backend run build
npm --prefix frontend run build
```

Launcher không tự thay thế tiến trình đang chạy. Tránh build lại `.next` trong khi dùng web production để nghiệm thu. Build frontend hiện cần tải Be Vietnam Pro từ Google Fonts.

## Cài mới từ Git

```powershell
npm --prefix backend ci
npm --prefix frontend ci
Copy-Item .env.example .env
```

Điền kết nối PostgreSQL, Redis và các khóa ngẫu nhiên trong `.env`. Dùng database mới dành riêng cho dự án. Nếu có Docker đang hoạt động, `docker compose up -d` tạo hạ tầng theo cấu hình gốc; cần đặt mật khẩu PostgreSQL trước.

```powershell
npm run db:migrate
npm run build
npm run start:api
# Terminal khác:
npm run start:web
```

Migration runner tạo role `court_app` có `NOBYPASSRLS` và role worker riêng có `BYPASSRLS`; worker credential chỉ được giữ phía server. Runner lưu checksum, không chạy lại seed khi đã có lịch sử. Runner từ chối database cũ chưa có lịch sử để tránh chèn lại seed. Với bản database cũ đã áp dụng 001–013, chỉ áp dụng migration bổ sung đã review:

```powershell
node qa/apply-sql.cjs migrations/014_platform_session_version.sql
```

Không chạy toàn bộ migration cũ lên database thật chỉ để thử khởi động.

## Kiểm tra

Các bộ HTTP cần API đang chạy, dùng database local riêng. Các bộ browser cần cả API và web. Chúng tạo fixture và dọn dữ liệu kiểm thử; không chạy trên production.

```powershell
node qa/pricing-check.cjs
node qa/core-regression.cjs
node qa/booking-flow-check.cjs
node qa/session-security-check.cjs
node qa/rls-regression.cjs
node qa/otp-boundary-check.cjs
node qa/comprehensive-full-suite.cjs
node qa/account-lifecycle-check.cjs
node qa/account-browser-check.cjs
node qa/portal-browser-check.cjs
node qa/ui-resilience-check.cjs
node qa/optimized-flow.cjs
node qa/audit-fonts-i18n-encoding.cjs
```

`frontend` có `typecheck`; script `lint` hiện cũng chỉ chạy TypeScript, chưa phải ESLint. Không diễn giải kiểm tra kiểu thành lint toàn bộ. Một số script QA cũ vẫn có ngày cố định hoặc giả định lịch sử, không phải toàn bộ đều đã chạy trong lần review này.

## Thay đổi nghiệp vụ cần biết

- Dời lịch giữ nguyên ID và mã đơn, cập nhật giờ trong transaction và ghi audit trước/sau. Ledger thanh toán tiếp tục liên kết đúng đơn. Đơn đang có hoàn tiền hoặc số dư lệch ledger phải đối soát trước khi dời.
- Đổi mật khẩu của nhân viên/chủ sân/quản trị nền tảng thu hồi token cũ; cần đăng nhập lại.
- TOTP đã bật không thể bị ghi đè bằng cách gọi setup lần nữa. Quản trị nền tảng có thể thiết lập TOTP trong hồ sơ và phải nhập mã khi đăng nhập sau đó.
- Bản đồ chỉ gắn vị trí khi có tọa độ hợp lệ. Nếu nhà cung cấp đường phố không tải được, giao diện báo lỗi và có nút thử lại.

## Dịch vụ thật

SMTP, tài khoản nhận tiền đã được chủ sân xác minh, adapter ngân hàng, Zalo và thiết bị IoT cần cấu hình/thông số thật. Không có kiểm chứng gửi email thật, nhận tiền thật hoặc bật đèn vật lý trong lần này. Backup/restore, triển khai production và các tính năng còn thiếu được ghi trong báo cáo review.
