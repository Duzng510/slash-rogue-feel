import type { EnemyKind } from "../config.ts";

export type CodexEntry = {
  name: string;
  sinhHoc: string;
  ghiChepThucDia: string;
  nguonGoc: string;
};

export type CodexVisibility = {
  sinhHoc: boolean;
  ghiChepThucDia: boolean;
  nguonGoc: boolean;
};

export const CODEX_ENTRIES: Record<EnemyKind, CodexEntry> = {
  chaser: {
    name: "Kẻ truy đuổi",
    sinhHoc: "Cơ thể nhẹ, phản xạ nhanh; luôn hướng về con mồi gần nhất.",
    ghiChepThucDia: "Đừng lùi mãi. Né sang bên khi nó áp sát rồi phản công.",
    nguonGoc: "Dấu chân của chúng xuất hiện quanh những khu định cư bị bỏ hoang.",
  },
  charger: {
    name: "Kẻ xung phong",
    sinhHoc: "Cơ bắp dồn về phía trước, thích nghi cho những cú lao thẳng.",
    ghiChepThucDia: "Nó khóa hướng trước khi lao. Rời khỏi đường thẳng ấy để sống sót.",
    nguonGoc: "Các vết cào của nó trùng với đường viền trên bản đồ cũ của Khe Nứt.",
  },
  splitter: {
    name: "Kẻ phân thể",
    sinhHoc: "Lớp vỏ chứa nhiều lõi nhỏ; khi vỡ, mỗi lõi tiếp tục cử động.",
    ghiChepThucDia: "Một lần hạ gục chưa kết thúc cuộc chạm trán. Chuẩn bị cho đàn con.",
    nguonGoc: "Mẫu mô của chúng không khớp với bất kỳ hồ sơ sinh vật nào ở Thất Trấn.",
  },
  small: {
    name: "Sinh vật nhỏ",
    sinhHoc: "Thân thể yếu và nhỏ, nhưng thường xuất hiện thành từng nhóm.",
    ghiChepThucDia: "Đừng để chúng bao vây; một nhát chém rộng có thể dọn đường.",
    nguonGoc: "Chúng thường bám theo các loài lớn hơn như một hệ sinh thái hoàn chỉnh.",
  },
  boss: {
    name: "Bạo Chúa",
    sinhHoc: "Một cá thể khổng lồ với sức bền và lực đánh vượt xa đồng loại.",
    ghiChepThucDia: "Quan sát nhịp vung đòn; khoảng nghỉ sau mỗi đợt tấn công là cơ hội duy nhất.",
    nguonGoc: "Không tài liệu nào xác nhận nó là thủ lĩnh hay chỉ là sinh vật mạnh nhất.",
  },
  ranged: {
    name: "Xạ kích",
    sinhHoc: "Chi trước biến dạng thành cơ quan phóng vật thể từ xa.",
    ghiChepThucDia: "Đổi hướng liên tục khi thấy nó ngắm bắn; đừng đứng yên để đáp trả.",
    nguonGoc: "Những viên đạn của chúng mang khoáng chất chỉ tìm thấy ở vùng sâu.",
  },
  teleporter: {
    name: "Kẻ dịch chuyển",
    sinhHoc: "Cơ thể chớp tắt khỏi tầm nhìn rồi tái hiện ở một vị trí khác.",
    ghiChepThucDia: "Đừng vung kiếm vào khoảng trống. Chờ nó hiện hình rồi mới áp sát.",
    nguonGoc: "Hiện tượng quanh nó giống các vết nứt không gian trong ghi chép của cha mẹ.",
  },
  healer: {
    name: "Kẻ chữa lành",
    sinhHoc: "Phát ra xung năng lượng giúp những sinh vật lân cận hồi phục.",
    ghiChepThucDia: "Ưu tiên hạ nó trước; để lâu sẽ khiến mọi đòn đánh thành vô ích.",
    nguonGoc: "Năng lượng của nó phản ứng với sự sống, không phân biệt đồng loại hay con mồi.",
  },
  exploder: {
    name: "Kẻ phát nổ",
    sinhHoc: "Một khối cơ thể bất ổn, tự kích nổ khi áp sát mục tiêu.",
    ghiChepThucDia: "Giữ khoảng cách khi nó lao tới. Vụ nổ có thể gây thương tích cho cả hai phía.",
    nguonGoc: "Phần lõi còn lại vẫn nóng sau nhiều giờ, như thể phản ứng chưa từng dừng.",
  },
  shielder: {
    name: "Kẻ hộ vệ",
    sinhHoc: "Tấm giáp trước hấp thụ phần lớn lực đánh trực diện.",
    ghiChepThucDia: "Vòng ra sau lưng hoặc đợi nó hở sườn sau khi ra đòn.",
    nguonGoc: "Hình dạng lớp giáp gợi nhớ trang bị của đội canh gác thời Thất Trấn sơ khai.",
  },
  sniper: {
    name: "Xạ thủ",
    sinhHoc: "Cơ quan thị giác tập trung ánh sáng để phóng một tia xuyên xa.",
    ghiChepThucDia: "Rời khỏi đường ngắm trước khi tia sáng chạm đất; đừng chạy dọc theo nó.",
    nguonGoc: "Các điểm ngắm của chúng luôn hướng về những tháp quan sát đã sụp đổ.",
  },
  jumper: {
    name: "Kẻ nhảy vồ",
    sinhHoc: "Hai chân sau phát triển mạnh, cho phép nó bật qua khoảng cách lớn.",
    ghiChepThucDia: "Nó cần lấy đà trước khi đáp xuống. Né khỏi điểm rơi đã định.",
    nguonGoc: "Dấu hằn trên trần hang cho thấy loài này từng sống ở tầng cao hơn.",
  },
  warden: {
    name: "Ngục trưởng",
    sinhHoc: "Cá thể canh giữ lãnh địa, kết hợp tấn công tầm xa và gọi thêm đồng loại.",
    ghiChepThucDia: "Nó đổi kiểu tấn công theo chu kỳ. Đừng để tia ngắm khóa trúng mình.",
    nguonGoc: "Huy hiệu trên giáp trùng với biểu tượng của một trấn đã bị xóa khỏi bản đồ.",
  },
  golem: {
    name: "Golem lò rèn",
    sinhHoc: "Đá và kim loại nóng chảy kết dính thành một cơ thể nặng nề.",
    ghiChepThucDia: "Tránh vùng quét của cú nện. Khi nó nổi giận, cả khoảng cách xa cũng không an toàn.",
    nguonGoc: "Một phần cấu trúc của nó giống máy móc dùng để xây các bức tường Thất Trấn.",
  },
  king: {
    name: "Vô Danh Vương",
    sinhHoc: "Một con người vẫn tồn tại qua nhiều thế kỷ, nhưng ký ức đang dần tan rã.",
    ghiChepThucDia: "Ông bắt chước lối đánh của đối thủ rồi thay đổi chiến thuật khi bị dồn ép.",
    nguonGoc: "Tên thật của ông đã bị xóa. Sáu mảnh ký ức giữ cho lời hứa cũ còn hiệu lực.",
  },
};

export function codexVisibility(kills: number, killsRequired: number, loreStoneFound: boolean): CodexVisibility {
  const fieldNotesUnlocked = Number.isInteger(kills) && kills >= killsRequired;
  return {
    sinhHoc: fieldNotesUnlocked,
    ghiChepThucDia: fieldNotesUnlocked,
    nguonGoc: loreStoneFound,
  };
}
