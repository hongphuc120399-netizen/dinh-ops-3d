export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.0.10',
  buildNumber: 202611161530,
  builtAt: '2026-11-16T15:30:10+07:00',
  note: "Hiệu chuẩn độ chính xác hình học 3D Three.js (0mm lệch mặt lưới, 0% lún trail, đồng bộ WGS84)"
};
