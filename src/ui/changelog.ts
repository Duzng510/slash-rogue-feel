/**
 * Single source of truth for the app version and the release history.
 * Newest entry first. When you finish a step, bump APP_VERSION and prepend a
 * CHANGELOG entry; the anti-drift law asserts CHANGELOG[0].version === APP_VERSION.
 * `items` are authored release notes (trusted) and may contain inline <b> markup.
 */

export const APP_VERSION = "v0.20.0";

export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v0.20.0",
    date: "2026-11-12",
    items: [
      "<b>Đuốc tường:</b> mỗi phòng rải đuốc trên mặt tường (~mỗi 8 tile), lửa 2 khung nhấp nháy và punch vùng sáng rung ±15%.",
      "<b>Sương biome:</b> Hang Băng sương xanh trắng, Lò Rèn sương cam, Hư Không sương tím — trôi chậm, nướng 160×90 phóng to giữ nét pixel.",
      "<b>Thời tiết:</b> tuyết rơi ngang ở hang, tro bay lên + than hồng ở lò rèn, tinh thể trôi + sao lấp lánh ở hư không.",
      "<b>Nền ngoài map dịu:</b> vùng ngoài tường không còn đen thui — theo tông biome, ambient vignette mờ đi để quái cả phòng luôn đọc được.",
    ],
  },
  {
    version: "v0.19.0",
    date: "2026-11-12",
    items: [
      "<b>Map sáng hơn:</b> sàn/tường các biome được nâng tông, lớp tối giám sát và ambient vignette giảm; thêm thanh trượt Brightness (0.5–2x).",
      "<b>Sprite động:</b> nhân vật có nhịp thở khi đứng yên (2 khung) và chu kỳ chân khi đi (4 khung); quái đi 3 khung.",
      "<b>Squash & stretch:</b> nhát chém phồng dọc rồi xẹp, dash kéo giãn thân theo trục.",
      "<b>Sprite theo hướng:</b> nhân vật và quái lật ngược khi nhìn sang phải, kết hợp dịch pixel theo 8 hướng có sẵn.",
    ],
  },
  {
    version: "v0.18.0",
    date: "2026-11-12",
    items: [
      "<b>Kill-cam impact:</b> hạ quái giờ zoom 1.04x 2 tick, flash đỏ 1 khung và giảm bão hòa 1 khung — cú đánh kết liễu đọc rõ hơn.",
      "<b>Vệt chém đa lớp:</b> cung chém thêm 2 lớp trailing mờ và viền lõi trắng 1px bên trong; khi nhát chém kết thúc để lại một vệt cắt dài tan dần.",
      "<b>Vết máu trên sàn:</b> mỗi cú đánh đọng vết máu, cú kết liễu bắn toả rộng hơn; tối đa 64 vết mỗi phòng, qua phòng mới sẽ sạch.",
    ],
  },
  {
    version: "v0.17.0",
    date: "2026-11-12",
    items: [
      "<b>Boss Forge Golem (mini-boss):</b> Golem đá đỏ ở phòng Lò Rèn, đập vòng tròn 360°; dưới 50% máu nổi điên — đọc đòn nhanh hơn và phun 3 quả dung nham.",
      "<b>Boss Forgotten King (cuối game):</b> Vua Lãng Quên 3 giai đoạn ở phòng nghi thức — bắt chước vũ khí người chơi, gọi 2 quái tinh anh kèm bất tử ngắn khi chuyển pha, rồi bắn ma hồn vòng quanh; mỗi lần xuống pha đóng băng điện ảnh 1 giây.",
      "<b>Thành tích mới:</b> Hạ Golem Lò Rèn, Hạ Vua Lãng Quên, và Vua không vết xước (thắng vua mà không dính đòn).",
    ],
  },
  {
    version: "v0.16.0",
    date: "2026-11-12",
    items: [
      "<b>Hệ thống Biome:</b> phòng chia 4 vùng sinh thái; quái thường dùng pool theo biome, boss kịch bản giữ nguyên.",
      "<b>Độ khó Ascension:</b> chọn bậc tăng dần, mỗi bậc cộng modifier (thêm quái, AI mạnh hơn); mở khóa dần qua từng run.",
      "<b>Lưu tiến trình:</b> bậc Ascension đã mở và modifier lưu vào save, tương thích ngược với save cũ.",
    ],
  },
  {
    version: "v0.15.0",
    date: "2026-11-12",
    items: [
      "<b>Hệ thống 5 Vũ khí (Weapons):</b> Kiếm nhật (Katana), Đại đao (Greatsword), Song đao (Dagger), Thương (Spear), Roi (Whip) với tầm đánh, góc quét và sát thương độc đáo.",
      "<b>Hệ thống Chặt chém Sắc nét:</b> Vệt chém Razor Crescent đa tầng phát sáng Neon, vết cắt Slice Mark trên thân quái khi chém trúng.",
      "<b>Giao diện Thẻ Cổ vật Cột dọc:</b> Xếp 3 cột thẻ bài chuẩn Roguelike, bổ sung hiệu ứng tia sét chạy viền (kiếm điện), lửa bốc (lửa), tinh thể tuyết (băng).",
      "<b>Nâng cấp Pixel Art:</b> Nhân vật có kính ngắm Visor phát sáng, tư thế nhào chém (attack lean), mắt quái vật phát sáng trong bóng tối.",
      "<b>Không gian Dungeon:</b> Gạch sàn vát cạnh nứt vỡ, tường 3 lớp chiều sâu và hiệu ứng ánh sáng cục bộ (ambient vignette).",
    ],
  },
  {
    version: "v0.14.1",
    date: "2026-11-12",
    items: [
      "<b>Tinh chỉnh Combat:</b> combo, hit-stop và knockback mượt, nảy hơn.",
      "<b>Flavor nhân vật:</b> thêm tư thế và câu giới thiệu (intro) riêng cho từng class.",
    ],
  },
  {
    version: "v0.14.0",
    date: "2026-11-12",
    items: [
      "<b>Hệ thống nhân vật:</b> 3 class (Kiếm sĩ / Pháp sư / Tank) với kỹ năng E và passive riêng.",
      "<b>Màn hình chọn nhân vật:</b> chọn build ở đầu mỗi run.",
    ],
  },
  {
    version: "v0.13.1",
    date: "2026-11-12",
    items: [
      "<b>Cân bằng Artifact:</b> rà soát và chỉnh sức mạnh cổ vật.",
      "<b>Số sát thương:</b> damage numbers bật/tắt qua slider.",
      "<b>Trải nghiệm:</b> intro đi bộ vào phòng và làm mới đồ họa tổng thể.",
    ],
  },
  {
    version: "v0.11.0",
    date: "2026-11-11",
    items: [
      "<b>Nội dung mới:</b> 5 loại quái thường cùng quái tinh anh (elites).",
      "<b>Shop vàng:</b> mua bán vật phẩm bằng vàng nhặt được.",
      "<b>Thành tựu:</b> 25 achievement mở khóa nội dung.",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-11-11",
    items: [
      "<b>Quái tầm xa & dịch chuyển:</b> thêm kẻ bắn xa và teleporter.",
      "<b>Đa dạng phòng:</b> nhiều bố cục phòng hơn.",
      "<b>Polish:</b> tinh chỉnh chung cho nhịp chơi.",
    ],
  },
  {
    version: "v0.1.0",
    date: "2026-11-10",
    items: [
      "<b>Combo nguyên tố:</b> trạng thái Lửa / Ướt / Giật (burn / wet / shock) tương tác với nhau.",
      "<b>Artifact nguyên tố:</b> thêm cổ vật nước và sét.",
    ],
  },
  {
    version: "v0.0.1",
    date: "2026-11-10",
    items: [
      "<b>Cổ vật (Artifacts):</b> phần thưởng chọn lại được mỗi run.",
      "<b>Màn hình START:</b> gate gameplay sau nút bắt đầu, hiện số version.",
    ],
  },
  {
    version: "v0.0.0",
    date: "2026-11-10",
    items: [
      "<b>Nền tảng:</b> vòng lặp fixed-timestep 60Hz, canvas pixel 320×180, combat chém + auto-aim.",
      "<b>Khung game:</b> archetype quái, boss arena, chế độ landscape cho mobile.",
    ],
  },
];
