/**
 * Single source of truth for the app version and the release history.
 * Newest entry first. When you finish a step, bump APP_VERSION and prepend a
 * CHANGELOG entry; the anti-drift law asserts CHANGELOG[0].version === APP_VERSION.
 * `items` are authored release notes (trusted) and may contain inline <b> markup.
 */

export const APP_VERSION = "v0.54.0";

export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v0.54.0",
    date: "2026-11-14",
    items: [
      "<b>Humanity:</b> lời nguyền làm xói mòn chỉ số; hạ boss và nhặt mảnh ký ức giúp hồi phục nhẹ, có giới hạn trong mỗi run.",
      "<b>Ảnh hưởng:</b> âm thanh đổi tông liên tục theo Humanity, hạt ký ức chuyển sắc/cường độ; Humanity thấp mở nhánh lựa chọn thoại khác cho NPC.",
    ],
  },
  {
    version: "v0.53.0",
    date: "2026-11-14",
    items: [
      "<b>Lore Stones:</b> thêm một đá ký ức ở mỗi ACT; tương tác sau khi dọn phòng để nghe hồi ức và thu thập mảnh.",
      "<b>Codex:</b> mảnh ký ức mở phần Nguồn gốc cho archetype tương ứng; tiến độ giới hạn một mảnh mỗi ACT và được làm mới khi bắt đầu run mới.",
    ],
  },
  {
    version: "v0.52.0",
    date: "2026-11-14",
    items: [
      "<b>Codex:</b> thêm hồ sơ ba phần cho toàn bộ 15 archetype; ghi chép sinh học/thực địa mở sau 3 lần hạ, nguồn gốc chờ Mảnh Ký Ức.",
      "<b>Tiến độ:</b> đếm hạ gục theo từng loại trong run; Codex mở bằng C hoặc nút ở thị trấn và không ghi vào Sim.",
    ],
  },
  {
    version: "v0.51.0",
    date: "2026-11-14",
    items: [
      "<b>Truyện:</b> thêm hồi ức ngắn khi bước vào mỗi biome, lời thoại lore cho ba NPC và một số cổ vật.",
      "<b>Gameplay:</b> hồi ức biome/cổ vật không chặn chiến đấu; người chơi vẫn có thể đóng bằng tương tác.",
    ],
  },
  {
    version: "v0.50.0",
    date: "2026-11-14",
    items: [
      "<b>Hoạt hình:</b> cả 15 loại quái có keyframe tư thế thật cho gió vào – ra đòn – hồi đòn, thay vì tịnh tiến cả sprite.",
      "<b>Kỹ thuật:</b> pose là dữ liệu thuần (danh sách op) nên luật kiểm tra khung và chống “chỉ dịch sprite” chạy được trên Node; bakePose từ chối box lệch với sprite gốc.",
      "<b>Tài nguyên:</b> tools/export-sprites.mjs xuất assets/sprites/*.png kèm atlas JSON và dải pose xem trước cho từng loại.",
    ],
  },
  {
    version: "v0.49.0",
    date: "2026-11-14",
    items: [
      "<b>Kiến trúc:</b> tách chọn wave, hit-test modal và các helper HUD; composition root dispatch pointer qua giao diện Clickable.",
      "<b>Combat:</b> damage carrier có kiểu riêng, combat system dùng hợp đồng Sim hẹp hơn, và transition sai được log rồi bỏ qua thay vì crash.",
      "<b>Settings & RNG:</b> timescale đi qua Settings; ghi rõ các luồng ngẫu nhiên gameplay, phần thưởng và hiệu ứng độc lập.",
    ],
  },
  {
    version: "v0.48.0",
    date: "2026-11-14",
    items: [
      "<b>Số sát thương thật:</b> số nổi giờ lấy damage sau crit/khiên/trạng thái/passive thay vì damage gốc của đòn chém.",
      "<b>Curse & Ascension:</b> gỡ curse hoàn lại Max HP cho Yếu ớt; restart/continue giữ độ Ascension người chơi đã chọn thay vì nhảy về mức cao nhất.",
      "<b>Combat:</b> beam bị tường/thùng chặn, i-frame đủ trọn khung, burn/poison tick sớm sau 0,2 giây, healer không hồi máu khi bị choáng, quái triệu hồi không tick ngay trong cùng nhịp và quái đã chết không cộng kill lần hai.",
    ],
  },
  {
    version: "v0.47.0",
    date: "2026-11-14",
    items: [
      "<b>WebGL world batch (giai đoạn 2):</b> batch GPU xử lý tiles, parallax, foreground, shadows, actors, NPC/props, projectiles, sprite particles, telegraphs và FX slash/beam trên mọi biome; distortion forge/caverns/void chuyển sang post shader.",
      "<b>Upload overlay:</b> bỏ upload sceneCanvas trong đường mặc định; chỉ upload overlay Canvas 2D khi có nội dung, và xóa texture bằng GPU khi overlay chuyển về rỗng. SpriteBatch tự tăng capacity khi cảnh vượt 1.024 instance.",
    ],
  },
  {
    version: "v0.46.0",
    date: "2026-11-13",
    items: [
      "<b>GL tiles-batch (giai đoạn 1):</b> sàn nhà dungeon/thành phố vẽ bằng SpriteBatch GPU vào sceneRT, phần còn lại (quái, FX, chữ) upload một lần làm overTex rồi composite; grade sinh học và kill-cam saturate chuyển vào POST_FS. Bỏ ~274 lệnh drawImage mỗi khung.",
      "<b>Lối thoát:</b> thêm <code>?glbatch=0</code> để quay về đường presentScene cũ cho mọi biome; <code>?renderer=2d</code> vẫn nguyên vẹn. Các biome méo hình (forge/caverns/void) tạm giữ presentScene tới giai đoạn 3.",
    ],
  },
  {
    version: "v0.44.0",
    date: "2026-11-13",
    items: [
      "<b>Độ phân giải:</b> nâng render nội bộ lên 480×270 với pixel scale 1.5×, giữ nguyên khung nhìn logic và TILE 16.",
      "<b>Camera, UI và sprite atlas:</b> đồng bộ tọa độ, hit-test và đóng gói sprite độ phân giải cao để giữ nguyên bố cục ở cả 2D lẫn WebGL.",
    ],
  },
  {
    version: "v0.43.0",
    date: "2026-11-13",
    items: [
      "<b>Slash recipe:</b> chém lại theo envelope 4 pha — windup gom sáng, snap bùng đúng khung chạm, follow-through tắt dần; màu chạy theo ramp keyframes khóa trong palette, residue để lại chấm đứt quãng thay vì vệt đặc.",
      "<b>Khung chạm:</b> snap neo vào contact = startup/(startup+active) nên vẫn đúng khung khi curse slow_hand kéo dài startup; reach/deg giữ nguyên tập đóng 8 cặp.",
      "<b>CONFIG.FX_SLASH + laws:</b> gom hằng số recipe về một mối, kèm law chống trôi (snap đúng contact, không gì sáng hơn snap, windup tăng/follow giảm đơn điệu, màu trong palette, residue chấm cách quãng).",
    ],
  },
  {
    version: "v0.42.1",
    date: "2026-11-13",
    items: [
      "<b>Camera:</b> sửa lỗi camera bị integrate hai lần mỗi frame — follow lerp và shake decay giờ chạy đúng một lần trên visual clock, hết hụt nhịp khi hit-stop.",
      "<b>Hội thoại:</b> typewriter chạy theo fixed step; phím tương tác đóng hội thoại đang mở thay vì mở lại; hộp chọn phòng tạm dừng đồng hồ run và vùng click khớp đúng thẻ bài được vẽ.",
      "<b>CONFIG:</b> gom các hằng số rải rác (alpha impact flash, tốc độ chữ, ngưỡng lửa trại/rèn/giếng/thử thách, bán kính NPC) về một mối, kèm law chống trôi.",
      "<b>Dọn đường chết:</b> xóa cờ glBatchEnabled và toàn bộ nhánh queue*GL — renderer chỉ còn một đường scene duy nhất (2D composite → GL post chain).",
      "<b>Regression:</b> khôi phục 3 test PR#3 (stun/HURT, VANISH miễn status, swing của enemy không cộng damageDealt) và siết law pool artifact theo worst-case run.",
    ],
  },
  {
    version: "v0.42.0",
    date: "2026-11-13",
    items: [
      "<b>Town NPCs:</b> thêm Character Master, Merchant và Guard; tương tác gần bằng [F], mở chọn nhân vật/cửa hàng và giữ nguyên đường vào dungeon.",
    ],
  },
  {
    version: "v0.41.0",
    date: "2026-11-13",
    items: [
      "<b>Room variety:</b> thêm lửa trại nâng cấp vũ khí, rương kho báu/nguyền rủa, phòng tinh anh, sự kiện, đền thờ và thử thách ba đợt.",
    ],
  },
  {
    version: "v0.40.0",
    date: "2026-11-13",
    items: [
      "<b>Damage type visualization:</b> damage number có type physical/burn/shock/freeze/poison/bleed; thêm màu riêng, jitter/flash, ember, frost, bubble và blood-drop micro FX; heal pulse và crit emphasis được giữ riêng.",
    ],
  },
  {
    version: "v0.39.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL FX batch:</b> slice và beam được render bằng rotated solid-rect với additive glow; các arc wedge phức tạp vẫn giữ Canvas 2D.",
    ],
  },
  {
    version: "v0.38.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL telegraph batch:</b> charger và sniper lane được render bằng rotated solid-rect batch, kèm target marker additive cho sniper.",
    ],
  },
  {
    version: "v0.37.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL shadow batch:</b> bóng enemy/player được render từ atlas với tint đen và alpha theo lớp, không còn upload/draw shadow canvas trong chế độ GL.",
    ],
  },
  {
    version: "v0.36.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL projectile batch:</b> thêm solid-rect primitive có tint/additive trong SpriteBatch; projectile và trail không còn vẽ lại bằng Canvas 2D ở chế độ GL.",
    ],
  },
  {
    version: "v0.35.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL world migration:</b> các particle dùng sprite được queue qua atlas batch; particle hình học vẫn giữ overlay Canvas 2D để bảo toàn hình dạng pixel.",
    ],
  },
  {
    version: "v0.34.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL world migration:</b> enemy và player rig được queue vào sprite batch, gồm animation frame, elite scale, iframe alpha, rotation và squash/stretch cơ bản.",
    ],
  },
  {
    version: "v0.33.0",
    date: "2026-11-13",
    items: [
      "<b>WebGL world migration:</b> nền tile được queue vào sprite batch và vẽ trực tiếp lên scene render target; pipeline có cầu nối hybrid cho các lớp Canvas 2D chưa migrate.",
    ],
  },
  {
    version: "v0.32.0",
    date: "2026-11-13",
    items: [
      "<b>Player sprite rig:</b> tách đầu, thân, tay, chân và cape thành các phần có keyframe animation; vũ khí đang trang bị hiện trên tay và xoay theo nhịp chém, cape có vật lý vải nhẹ.",
    ],
  },
  {
    version: "v0.31.0",
    date: "2026-11-13",
    items: [
      "<b>Tách renderer:</b> lớp hiệu ứng chiến đấu (cung chém, mảnh văng, tia, chữ bay) tách sang <i>FxLayer</i> riêng; <i>renderer.ts</i> nhẹ đi ~270 dòng, chỉ còn lo thế giới và ánh sáng.",
    ],
  },
  {
    version: "v0.30.0",
    date: "2026-11-13",
    items: [
      "<b>Dọn code thừa:</b> xoá các hằng số và hàm chết (cửa sổ chain-cancel, ghost dash, budget số damage, modifier Ascension chưa dùng, bảng biome không ai gọi).",
      "<b>Gom trùng lặp:</b> một helper <i>shuffle</i> dùng chung, <i>instantSwing</i> cho đòn tức thời, <i>dmgNumber</i> cho số damage, màu element đưa hết về <i>CONFIG.PALETTE</i>.",
      "<b>Hằng số về CONFIG + clock sim:</b> mọi bán kính sáng, số hạt, giới hạn text và nhịp đuốc nằm trong <i>CONFIG.RENDER</i>; hiệu ứng hình ảnh dùng <i>visualTime</i> của sim thay vì đồng hồ tường.",
      "<b>Tách file quá khổ:</b> <i>buildSprites</i> chia thành 9 hàm theo họ sprite; <i>main.ts</i> đẩy slider, changelog modal và test harness sang module riêng.",
    ],
  },
  {
    version: "v0.29.0",
    date: "2026-11-12",
    items: [
      "<b>Ánh sáng bám mặt đất:</b> bóng sprite khớp hình dáng nhân vật và quái, chân tường có bóng tiếp xúc mảnh.",
      "<b>Sắc thái và méo hình theo biome:</b> ánh màu riêng cho từng vùng, hơi nóng ở Lò Rèn, gợn viền Hang Băng và viền màu ở Hư Không.",
      "<b>Elite và boss dễ nhận diện:</b> elite có vòng báo đỏ khi xuất hiện, viền vàng, vương miện và tia lấp lánh; boss có màn giới thiệu, tên gọi, vết nứt mặt đất và camera tập trung.",
      "<b>HUD tinh chỉnh:</b> tim nhịp khi nguy cấp, vàng nhấp nhô, hồi kỹ năng dạng vòng và icon riêng cho cổ vật.",
    ],
  },
  {
    version: "v0.28.0",
    date: "2026-11-12",
    items: [
      "<b>Animation clip:</b> người chơi có 3 frame đòn (windup → active → recovery) và 2 frame trúng đòn; quái có clip telegraph/đòn, 3 frame hiện dần khi spawn và 4 frame vỡ vụn khi chết.",
      "<b>Tia lửa theo element:</b> đòn cháy bắn tàn lửa cam bay lên, sét toả tia vàng, đóng băng văng tinh thể xanh, độc nổi bong bóng tím — nhìn là biết element vừa dính.",
      "<b>Số damage có cá tính:</b> đòn kết liễu hiện số to 7px vàng rung nhẹ, đòn theo element tô màu riêng, hồi máu hiện dấu + xanh lá.",
      "<b>Telegraph riêng từng quái:</b> charger vẽ đường đâm dày có mũi tên, sniper kẻ vệt mảnh xuyên phòng với chấm ngắm nhấp nháy, exploder đĩa nổ phồng dần và lóe trắng trước khi nổ, laser Warden có lõi sáng, boss vòng tròn kèm số đếm ngược giây.",
      "<b>Chuyển phòng iris wipe:</b> màn đen khép vòng tròn quanh cửa rồi mở ra ở phòng mới.",
      "<b>Vignette nhịp tim:</b> dưới 30% HP viền màn hình đập đỏ theo nhịp, kèm tiếng tim trầm.",
      "<b>Aura trạng thái:</b> quái dính burn/freeze/poison/shock tỏa hạt riêng bay quanh người mỗi 3 tick.",
    ],
  },
  {
    version: "v0.27.0",
    date: "2026-11-12",
    items: [
      "<b>Lớp CRT:</b> scanline + tối dần rìa màn hình kiểu màn hình bóng đèn hình, canvas game nudge contrast/saturation — bật/tắt bằng class 'crt' trên body, không đụng code.",
    ],
  },
  {
    version: "v0.26.0",
    date: "2026-11-12",
    items: [
      "<b>Vệt chém theo hình vũ khí:</b> giáo & song dao đâm thành đường thẳng xuyên qua, đao & roi combo 2 quét thành vệt dày 4 lớp trailing, kiếm và roi combo 1 giữ cung chém gọn — đổi vũ khí là đổi 'chữ ký' trên màn hình.",
    ],
  },
  {
    version: "v0.25.0",
    date: "2026-11-12",
    items: [
      "<b>Đuôi đạn:</b> mỗi viên đạn kéo 4 lớp afterimage theo màu riêng — vệt cam cho cầu lửa, tím cho ma hồn/tinh linh, dung nham cho lava; boss bắn vòng giờ tỏa cả chùm vệt.",
    ],
  },
  {
    version: "v0.24.0",
    date: "2026-11-12",
    items: [
      "<b>Parallax nền xa:</b> mỗi biome có lớp background riêng cuộn 0.4× camera — vòm đá & cột arch ở ngục, măng đá hai tầng ở hang, lò nung phát sáng ở lò rèn, tinh vân & mảnh vỡ ở hư không.",
    ],
  },
  {
    version: "v0.23.0",
    date: "2026-11-12",
    items: [
      "<b>Chiều cao z:</b> teleporter/jumper nhấc thân lên 6px khi biến mất và hạ xuống khi hiện ra — bóng vẫn nằm trên đất nên đọc rõ là đang bay.",
      "Người chơi dash nhấc nhẹ 2px; cầu lửa của Golem bay theo vòng cung thật (sin arc 8px).",
    ],
  },
  {
    version: "v0.22.0",
    date: "2026-11-12",
    items: [
      "<b>Tường oblique:</b> tường có mặt trước 6px như đang cao — góc chữ L tự nhiên đúng, cửa khóa cũng cao, collision và dữ liệu phòng không đổi.",
    ],
  },
  {
    version: "v0.21.0",
    date: "2026-11-12",
    items: [
      "<b>Depth sort:</b> quái, người chơi, đạn và hạt hiệu ứng cùng xếp lớp theo toạ độ y — đứng trên/quanh quái giờ đúng chiều sâu, thay vì người chơi luôn vẽ trên cùng.",
      "Telegraph/vệt chém luôn nằm dưới sàn chỉ dẫn, số sát thương luôn nổi trên cùng.",
    ],
  },
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
      "<b>Nền tảng:</b> vòng lặp fixed-timestep 60Hz, viewport logic 320×180 render ở 480×270, combat chém + auto-aim.",
      "<b>Khung game:</b> archetype quái, boss arena, chế độ landscape cho mobile.",
    ],
  },
];
