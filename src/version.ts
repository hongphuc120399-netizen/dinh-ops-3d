export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.16',
  buildNumber: 202611201017,
  builtAt: '2026-11-20T10:17:46+07:00',
  note: "Tối ưu mượt 120Hz mô phỏng Xếp Gạch 3D & thêm phân tích Chịu Lực kết cấu (quả cân thử tải đỉnh 3D, bản đồ nhiệt ứng suất, áp suất lún nền)"
};
