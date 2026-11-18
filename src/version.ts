export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.7',
  buildNumber: 202611181126,
  builtAt: '2026-11-18T11:26:36+07:00',
  note: "Gia cố 100% tính năng Offline: chống treo mạng yếu 1 vạch, dự phòng chéo bản đồ 2D/3D, lưu lộ trình GTA & chế độ GPS Thật khi mở lại giữa rừng"
};
