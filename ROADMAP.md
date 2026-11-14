# ROADMAP — Triển khai lore "Vô Danh Vương"

> Kế hoạch hiện thực hóa [`LORE.md`](./LORE.md) vào gameplay. Lore khớp gần như từng chi tiết với các
> hệ thống đã có trong `src/`, nên đây là *lấp nội dung + vài stat mới* lên khung run đang chạy, không
> phải dựng lại kiến trúc. Căn cứ code đo trực tiếp ngày 2026-11-14.

---

## 0. Nguyên tắc bất biến (từ `AGENTS.md`)

- **2 lớp song song:** lore không được chặn gameplay — người chỉ thích combat vẫn chơi hết run được.
- Sim **không** đụng DOM/canvas/audio: mọi hội thoại/hiệu ứng đi qua `Dialogue`
  (`src/systems/dialogue.ts`) + `EventQueue` (`src/events.ts`).
- Văn bản **tiếng Việt**, render trên **HUD canvas** đã scale (chữ 5px trong canvas thế giới không đọc được).
- Mỗi phase = **1 lần bump `#version` trong `index.html`** + **1 luật (law) mới** trong
  `tests/laws.test.ts`, phải **fail nếu bỏ feature**.
- **Humanity là thước *graduated*, không phải thanh good/evil.**
- Mọi ngưỡng mới nằm trong `CONFIG` / `CONFIG.LAWS`, không rải hằng số.

---

## 1. Xương sống đã có — ánh xạ hồi ↔ run hiện tại

Run = 12 phòng (`TEMPLATES.length`); biome đổi theo `roomIndex` qua `biomeForRoom`
(`src/systems/biomes.ts:90`, reset ở `src/world/world.ts:216`), có sẵn biến cố `biomeChanged`
(`src/world/world.ts:247`).

| Biome (`src/systems/biomes.ts:28`) | Phòng | EnemyPool | → Hồi lore | Boss (archetype) |
| --- | --- | --- | --- | --- |
| `town` | -1 (hub) | — | Mở đầu | 3 NPC: `merchant/guard/character_master` |
| `dungeon` "Ngục Tối" | 0–2 | chaser, charger, splitter, small | **ACT I** — Bạo Chúa | `boss` |
| `caverns` "Hang Băng" | 3–5 | teleporter, ranged, shielder, jumper | **ACT II** — Ngục Trưởng | `boss` |
| `forge` "Lò Rèn" | 6–8 | exploder, charger, sniper, boss | **ACT III** — Golem | `golem` (đã có) |
| `void` "Hư Không" | 9–11 | teleporter, healer, splitter, warden | **ACT IV+V** — 3 phiên bản / Vương | `king` (đã có) |

Tên "Hang Băng" / "Lò Rèn" đã trùng lore. → Không đụng cấu trúc run; chỉ gắn thoại/mảnh ký ức vào
ranh giới biome.

---

## Phase L1 — Dẫn truyện bằng Dialogue · `v0.51` · Effort **S** (không thêm state)

**Mục tiêu:** người chơi *cảm nhận* câu chuyện mà chưa đụng hệ thống nào mới.

- **Beat mở đầu/kết mỗi hồi:** khi `biomeChanged`, mở một `Dialogue` ngắn
  - dungeon → tiền sử Khe Nứt · caverns → "màn trời nhân tạo" · forge → Thất Trấn che giấu sự thật · void → ký ức Vương.
- **3 NPC town** (`src/entities/npc.ts:1`): Thương Nhân / Lính Gác / Bậc Thầy → viết hội thoại lore thật, thay `NPC_PROMPTS` cụt.
- **Mảnh ký ức khi nhặt artifact** (nước/lửa/hút máu + vài cái): trong `grantArtifact` / `chooseArtifact`
  (`src/world/world.ts:546`, `:369`) mở 1 dòng thoại.

**Luật:** mỗi `BiomeId` có ≥1 dialogue intro; mỗi `NpcKind` có ≥1 dòng lore — coverage test lặp `BIOMES`
/ `NPC_PROMPTS`. Không mutation sim → fingerprint determinism **không đổi**.

---

## Phase L2 — Codex (hồ sơ 3 phần) · `v0.52` · Effort **M** (dữ liệu + UI)

- `src/data/codex.ts` (thuần dữ liệu, không phải sim): mỗi archetype ∈ `ENEMY_KINDS`
  (`src/config.ts:480`) → `{ sinhHoc, ghiChepThucDia, nguonGoc }`.
- **Mở khóa theo tiến độ:** phần sinh học + thực địa hiện sau N lần hạ loại đó (đếm per-kind trong
  `runStats`, `src/systems/runStats.ts`); **`nguonGoc` khóa** tới khi tìm được Lore Stone (L3).
- **UI panel** render trên HUD canvas (mở từ town / tạm dừng). Sim không vẽ — chỉ đọc cờ.

**Luật:** song ánh `ENEMY_KINDS` ↔ codex (thừa/thiếu là fail); ngưỡng mở khóa deterministic theo seed;
panel không phát sinh `Sim` write.

---

## Phase L3 — Lore Stones · `v0.53` · Effort **M**

- **Vật thể tương tác mới** đặt trong vài phòng: tái dùng hook phòng `event`/`shrine`
  (`src/world/rooms.ts:291`, `:309`) + cùng khuôn với NPC (lại gần → `openDialogue`, `src/world/world.ts:450`).
- Mỗi stone = 1 mảnh ký ức: mở dialogue + **mở `nguonGoc` tương ứng trong Codex** + tăng
  `fragmentsCollected` (biến đếm mới trên Sim).

**Luật:** mỗi hồi ≥1 stone; nhặt stone ⇒ codex origin flip (assert); `fragmentsCollected ≤ số hồi`.

---

## Phase L4 — Humanity (sự xói mòn) · `v0.54` · Effort **M** · **⚠ đụng determinism**

- Thêm `Sim.humanity: number` (int, chặn `[0..CONFIG.LAWS.HUMANITY_MAX]`). Giảm khi nhận **curse**
  (`chooseCurse`, `src/world/world.ts:594`), hồi nhẹ khi hạ boss / nhặt fragment.
- **Hiệu ứng graduated** (không good/evil): humanity thấp → sim đẩy event làm
  - (a) đổi tông audio/hạt (tái dùng `shake`/`sfx`/particle-scale qua `EventQueue`, `src/events.ts`),
  - (b) **đổi lựa chọn thoại** mà boss/NPC đưa ra (chọn node theo `humanity`).
  - Sim đọc humanity; visuals tiêu thụ event.

**Luật:** humanity luôn trong `[0,MAX]` (property/fuzz trong `tests/invariants.test.ts`); quan hệ
curse↔humanity đơn điệu. **Phải re-baseline `GOLDEN_HASH` một lần** vì hình dạng `Sim` đổi
(`RECORD_GOLDEN=1`) — ghi rõ trong PR của phase này.

---

## Phase L5 — Boss có diễn biến & aftermath · `v0.55–56` · Effort **L**

- Boss mỗi hồi: **thoại trước chết** + **dấu vết sau khi hạ** (prop trong phòng tối đi / banner / mở
  khóa Codex) — đúng mục IX.5 của `LORE.md`.
  - Bạo Chúa → `boss` · Ngục Trưởng → `warden` · Golem → `golem` · Vương → `king`.
- **Vương (ACT V)** ở ngai (void) **không phải trận đấu thường**: vào phòng `king` → state gate bởi
  `Dialogue` (3 lựa chọn), dùng lại khuôn `blocked` / `modalActive` (`src/main.ts:126`, `:159`).

**Luật:** mỗi phòng boss kịch bản có dialogue id gắn với archetype; phòng `king` chặn combat tới khi
chọn xong (assert sim không tick damage khi đang gate).

---

## Phase L6 — Ba kết thúc · `v0.57+` · Effort **L**

- Mở rộng `EndMode` (`src/systems/runStats.ts:8`) thành **3 nhánh thắng**:
  - `unbound` (giết Vương) · `lastPromise` (kế vị) · `unwritten` (giao ước mới — **ẩn**).
- **Điều kiện kết thúc ẩn:** Codex origin đủ + `fragmentsCollected ≥ ngưỡng` + humanity ở vùng cổng.
  Chọn bằng option cuối ở ngai.
- Mỗi kết thúc: **đoạn vĩ thanh** trên HUD + reset full-run (khuôn `resetFrom` / `nextRun`,
  `src/world/world.ts:296`). New Game+ tùy chọn.

**Luật:** mỗi nhánh **reachable** trong một run seeded (harness); **kết thúc ẩn không mở được** khi chưa
đủ điều kiện (assert âm); chỉ lựa chọn ở ngai mới được set `EndMode` thắng.

---

## Thứ tự & rủi ro

```
L1 → L2 → L3 → L4 → L5 → L6
(truyện)(codex)(mảnh)(humanity)(boss)(endings)
```

| Phase | Version | Effort | Đổi determinism? | Phụ thuộc |
| --- | --- | --- | --- | --- |
| L1 | v0.51 | S | Không | — |
| L2 | v0.52 | M | Không | — |
| L3 | v0.53 | M | Không | L2 (origin) |
| L4 | v0.54 | M | **Có — re-baseline 1 lần** | L1 (thoại) |
| L5 | v0.55–56 | L | Không | L2, L4 |
| L6 | v0.57+ | L | Không | L2, L3, L4 |

- **Giá trị trước, rủi ro sau:** L1–L3 chỉ thêm dữ liệu + wiring, không đổi fingerprint determinism →
  an toàn, thấy kết quả ngay. L4 là điểm duy nhất đụng sim → làm riêng, re-baseline oracle.
- **Phụ thuộc cứng:** L6 cần L2+L3+L4 (cổng kết thúc ẩn). L5 cần `king`/`warden`/`golem` (đã có).
- **Luôn bật/tắt qua `CONFIG`**, thêm entry `CONFIG.LAWS` cho mỗi ngưỡng mới.

**Tổng effort:** ≈ 6 phiên làm việc, mỗi phiên gắn 1 version tag → dễ dừng/đi tiếp, dễ review độc lập.
Bắt đầu từ **L1** (payoff nhanh, rủi ro 0).
