export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.0',
  buildNumber: 202611161538,
  builtAt: '2026-11-16T15:38:12+07:00',
  note: "Hiệu chuẩn độ chính xác 3D Three.js (0mm lệch mặt lưới, 0% lún trail, đồng bộ WGS84)"
};
