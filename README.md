# Slash Rogue Feel

Slash Rogue Feel là game hành động roguelike góc nhìn từ trên xuống, với đồ họa pixel, chiến đấu nhịp độ nhanh và các hiện vật có hiệu ứng nguyên tố. Game chạy trực tiếp trên trình duyệt, hỗ trợ máy tính và thiết bị di động.

## Tính năng

- Chiến đấu cận chiến, né đòn bằng dash và sử dụng kỹ năng.
- Nhiều loại kẻ địch với hành vi và kiểu tấn công khác nhau, bao gồm cả boss.
- Hiện vật và hiệu ứng nguyên tố làm thay đổi diễn biến trận đấu.
- Điều khiển bằng bàn phím, chuột hoặc màn hình cảm ứng.
- Tùy chỉnh cảm giác chơi như độ rung màn hình, âm lượng, hạt hiệu ứng, tốc độ game, hit-stop và độ sáng.
- Hình ảnh pixel được vẽ trên canvas với hiệu ứng âm thanh Web Audio.

## Cách chơi

| Thao tác | Máy tính |
| --- | --- |
| Di chuyển | `W`, `A`, `S`, `D` |
| Chém | Chuột trái hoặc `J` |
| Dash | `Space` hoặc `Shift` |
| Kỹ năng | `E` hoặc `Q` |
| Tương tác | `F` |

Trên thiết bị di động, sử dụng cần điều khiển ảo và các nút chém, dash, kỹ năng, tương tác trên màn hình.

## Chạy dự án

Cần cài đặt Node.js và npm. Tại thư mục dự án, chạy:

```bash
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal (mặc định `http://localhost:5199`).

## Lệnh hữu ích

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Chạy máy chủ phát triển Vite |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm test` | Chạy các bài kiểm thử combat, invariants và laws |
| `npm run test:combat` | Chạy kiểm thử hồi quy combat |
| `npm run test:inv` | Chạy kiểm thử invariants và tính xác định |
| `npm run test:laws` | Chạy kiểm thử các ngưỡng và luật gameplay |
| `npm run build` | Kiểm tra kiểu và tạo bản build bằng Vite |
| `npm run preview` | Chạy thử bản build đã tạo |

## Cấu trúc mã nguồn

- `src/config.ts` — cấu hình gameplay, kích thước, hiệu ứng và các tham số có thể tinh chỉnh.
- `src/loop.ts` — vòng lặp game với mô phỏng cố định 60 tick/giây và cập nhật hình ảnh theo frame.
- `src/sim/`, `src/entities/`, `src/systems/` — trạng thái mô phỏng, thực thể và logic gameplay.
- `src/world/` — phòng chơi, lưới bản đồ và va chạm.
- `src/input/` — chuyển đầu vào bàn phím, chuột và cảm ứng thành ý định điều khiển.
- `src/events.ts` — hàng đợi sự kiện nối mô phỏng với hiệu ứng hình ảnh và âm thanh.
- `src/render/`, `src/audio/` — kết xuất canvas và phát âm thanh.
- `src/ui/` — HUD, menu, tùy chỉnh hiệu ứng và giao diện hỗ trợ.
- `tests/` — kiểm thử hồi quy combat, invariants và luật gameplay.

## Nguyên tắc phát triển

- Mô phỏng chạy theo bước thời gian cố định; hình ảnh không nội suy vị trí giữa các tick.
- Hệ thống mô phỏng chỉ cập nhật trạng thái game. Hiệu ứng được gửi qua `VisualEvent` để renderer và âm thanh xử lý.
- Các tham số cân bằng và cảm giác chơi tập trung trong `CONFIG` tại `src/config.ts`.
- Tính xác định được kiểm chứng bằng seed; không nới lỏng các kiểm thử dựa trên seed để che lỗi.
