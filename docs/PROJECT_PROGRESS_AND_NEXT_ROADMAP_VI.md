# Tổng Kết Tiến Độ & Lộ Trình Phát Triển Tiếp Theo
**Cập nhật lần cuối:** 18/11/2026  
**Dự án:** Hệ Thống Đặt Sân Thể Thao Đa Chủ Sân (Multi-Tenant Sports Court Booking Platform)

---

## 1. Cách Khởi Động Lại Hệ Thống Vào Buổi Làm Việc Tới

Hệ thống gồm Database (`PostgreSQL` + `Redis` qua Docker), Backend API (`:4000`) và Frontend Next.js (`:3000`):

```powershell
# 1. Đảm bảo PostgreSQL (5432) và Redis (6379) đang chạy
docker compose up -d

# 2. Chạy Backend API (Cổng 4000)
cd backend
npm run build
node dist/backend/src/main.js

# 3. Chạy Frontend Web & Mobile (Cổng 3000)
cd frontend
npm run build
npm run start
```

---

## 2. Danh Sách Đường Dẫn 4 Cổng Web & Mobile Đã Hoàn Thiện

| Cổng / Trang | Đường dẫn | Trạng thái & Chức năng chính |
|---|---|---|
| **Web & Mobile Khách Hàng** | `http://localhost:3000` | Tìm sân không dấu, lọc 9+ môn thể thao động, xem nhiều ảnh sân chạy lặp (`‹` / `›`), chọn bật/tắt tự do nhiều khung giờ 30 phút (liền kề hoặc rời nhau), giữ chỗ 10 phút, VietQR, Ưu đãi, Giải đấu, Đánh giá 1–5 sao |
| **Trang Bản Đồ Độc Lập** | `http://localhost:3000/map` | Trang riêng trên cả Web & thanh đáy Mobile; bản đồ đường phố Hà Nội thực tế (cache qua Backend không lỗi mạng), định vị khoảng cách `km`, lọc môn, chỉ đường Google Maps |
| **Lịch Đã Đặt Của Khách** | `http://localhost:3000/my-bookings` | Xem mã QR check-in, thanh toán tiếp đơn chờ, hủy lịch tính hoàn cọc tự động theo chính sách, dời lịch sang khung giờ mới, tải file lịch `.ics` |
| **Hồ Sơ Cá Nhân Khách** | `http://localhost:3000/profile` | Tải ảnh đại diện WebP, đổi tên/SĐT/ngôn ngữ, đổi email xác thực OTP 2 bước, đổi mật khẩu, quản lý thiết bị đăng nhập, xuất JSON dữ liệu cá nhân, xóa tài khoản (`C-06`) |
| **Trang SEO Từng Cơ Sở** | `http://localhost:3000/vi/san/ha-noi/football/co-so-1-cau-giay` | Chuẩn SEO song ngữ `VI | EN`, `Schema.org SportsActivityLocation`, ảnh trình chiếu lặp, đánh giá người chơi & `/sitemap.xml` |
| **Quầy Thu Ngân Nhân Viên** | `http://localhost:3000/staff` | Mở ca / Đóng ca đối soát tiền mặt thực đếm & ghi chú bàn giao, đặt sân khách vãng lai, check-in / `NO_SHOW`, thu tiền còn lại, khóa màn hình PIN 4 số, bật/tắt đèn sân IoT |
| **Quản Trị Chủ Sân & Quản Lý** | `http://localhost:3000/admin` | Dashboard doanh thu ròng & Heatmap lấp đầy `%`, quản lý Cơ sở / Sân đơn & Sân ghép / Bảng giá, khóa sân bảo trì, nhân sự, **Thư viện nhiều ảnh WebP**, **Kiểm duyệt & trả lời Đánh giá 1–5 sao**, Wizard 7 bước, Nhập CSV, Deal giảm giá, Giải đấu, Đóng sân mưa bão |
| **Super Admin Toàn Nền Tảng** | `http://localhost:3000/platform` | Tài khoản Super Admin chính thức (cấu hình riêng trên môi trường thực tế), quản lý Chủ sân & giá gói cước, Danh mục môn thể thao động, cấu hình & test **SMTP gửi thư thật**, **Thư viện ảnh toàn hệ thống & cơ sở**, phiên hỗ trợ 30 phút, dọn dữ liệu mẫu 1 chạm |
| **Tài Liệu API Swagger** | `http://localhost:4000/docs` | Tài liệu OpenAPI tương tác cho toàn bộ các nhóm route `/api/*/v1` |

*(Lưu ý bảo mật: Khóa ứng dụng Gmail SMTP thật đã được cấu hình trong biến môi trường cục bộ `.env` / `backend/.env` đã đưa vào `.gitignore`, tuyệt đối không lưu khóa nhạy cảm vào tài liệu Git).*

---

## 3. Các Hạng Mục Đã Giải Quyết Dứt Điểm Hôm Nay (18/11/2026)

1. **Gmail SMTP gửi thư thật 100% & Tài khoản Super Admin thật:**
   - Gửi OTP đăng ký, quên mật khẩu, đổi email và vé lịch `.ics` trực tiếp vào hộp thư Gmail thật (`smtp.gmail.com:587`).
2. **Thư viện nhiều ảnh sân chạy lặp (`‹` / `›`) & Ảnh sinh động toàn hệ thống (`Migration 011`):**
   - Tích hợp `LoopingPhotoCarousel` tự động chuyển mượt, có mũi tên trái/phải, chấm chuyển trang và vuốt tay trên điện thoại.
   - Bổ sung bộ ảnh sân bóng tối, cầu lông, pickleball, khu vực đăng nhập tách đôi (Split Showcase) trên cả 4 cổng, và công cụ tải nhiều ảnh WebP cùng lúc tại `/admin` & `/platform`.
3. **Bản đồ đường phố thực tế & Tách trang `/map` độc lập trên Mobile/Web:**
   - Xây dựng bộ proxy & lưu đệm bản đồ đường phố thực tế tại `backend/src/common/map-tiles.ts` (`/map-tiles/osm/...`), hiển thị rõ đường phố Hà Nội với `0` lỗi mạng Console; tách hẳn route `/map` riêng cho thanh điều hướng Mobile.
4. **Cơ chế chọn/bỏ chọn độc lập từng ô giờ & Loại bỏ vòng tròn giật khi click (`Migration 012`):**
   - Bấm vào ô trống bất kỳ để bật xanh, bấm lại chính ô đó để tắt mà không bao giờ tự xóa các ô đã chọn trước hay tự tô tràn hàng loạt; hỗ trợ đặt gộp nhiều khung giờ liền nhau hoặc rời nhau trong cùng 1 lần bấm.
   - Gỡ bỏ hoàn toàn hiệu ứng vòng tròn ripple to gây giật khung hình, chuyển sang hiệu ứng đổi trạng thái tức thì `110ms`.
5. **Đánh giá & Chấm 1–5 sao cơ sở sân kèm Kiểm duyệt Admin (`C-18` — `Migration 013`):**
   - Khách hàng chấm `1–5 ★`, chọn nhanh gợi ý nhận xét, sửa/xóa đánh giá trực tiếp trên thẻ sân; tự gắn nhãn `✓ Khách đã đặt sân` khi có lịch đặt thực tế.
   - Chủ sân vào `/admin` → tab **`Đánh Giá & Chấm Sao`** để duyệt hiển thị / tạm ẩn, viết phản hồi trực tiếp của Chủ sân hoặc xóa đánh giá rác.

---

## 4. Lộ Trình 7 Tính Năng Mở Rộng (Phase 2 / Phase 3) Cho Buổi Tiếp Theo

Khi quay lại làm tiếp, có thể chọn triển khai lần lượt bất kỳ mục nào dưới đây:

1. **Mã giảm giá Voucher khi thanh toán (`C-15`, `A-16`):**
   - Chủ sân tạo mã khuyến mãi (`%` hoặc số tiền `VND`, đơn tối thiểu, số lượt tối đa, hạn dùng) trong `/admin`; khách nhập mã lúc đặt sân để trừ tiền trực tiếp.
2. **Bán nước uống / Cho thuê vợt, giày, bóng tại quầy & In hóa đơn nhiệt 80mm (`S-07`, `S-12`, `A-17`):**
   - Quản lý danh mục & tồn kho phụ kiện/đồ uống trong `/admin`; nhân viên tại `/staff` cộng thêm vào đơn khách lúc check-in và in phiếu thu khổ 80mm.
3. **Đặt lịch cố định hàng tuần cho đội quen (`C-12`):**
   - Đặt 1 lần giữ lịch cố định 4–8 tuần liên tiếp (ví dụ tối Thứ 5 hàng tuần), tự kiểm tra báo trước các buổi trùng lịch bảo trì/nghỉ lễ.
4. **Lưu sân yêu thích & Đặt lại nhanh 1 chạm (`C-11`, `C-14`):**
   - Thả tim lưu cơ sở quen thuộc và nút *"Đặt lại đúng khung giờ lần trước"* trong `/my-bookings`.
5. **Danh sách chờ khi kín giờ & Bảng tin Tìm đối / Ghép kèo (`C-13`, `C-17`):**
   - Tự động gửi Gmail báo ngay khi khung giờ kín có người hủy; đăng tin tìm đối đá giao hữu hoặc tuyển người chơi ghép sân.
6. **CRM Khách hàng & Sổ thu chi Lãi/Lỗ (`A-15`, `A-19`):**
   - Ghi chú khách VIP / cảnh báo khách hay bùng sân (`no-show`), kèm sổ ghi chi phí vận hành (điện, nước, lương ca) để tính lợi nhuận ròng.
7. **Chuẩn PWA cài Web thành App lên màn hình điện thoại (`manifest.json` & App Icons):**
   - Cài đặt trực tiếp ra màn hình chính iPhone / Android chạy full màn hình như ứng dụng riêng.

### Các kết nối bên thứ 3 (Triển khai khi đăng ký tài khoản nhà cung cấp thật)
- **Webhook ngân hàng tự động (`SePay` / `Casso` / `payOS`):** Điền khóa ký số vào cấu hình để tự động xác nhận chuyển khoản VietQR thời gian thực.
- **Zalo Official Account / ZNS (`C-09`, `C-22`):** Nhắc lịch chơi và đặt sân qua Zalo khi có tài khoản OA doanh nghiệp.
