export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.0.0',
  buildNumber: 202611141006,
  builtAt: '2026-11-14T10:06:04+07:00',
  note: "Khởi tạo gói OTA v1.0.0 đầu tiên"
};
