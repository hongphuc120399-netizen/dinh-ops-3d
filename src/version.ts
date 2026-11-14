export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.0.2',
  buildNumber: 202611142103,
  builtAt: '2026-11-14T21:03:50+07:00',
  note: "Mặc định xoay ngang trực tiếp qua OTA (không cần cài lại APK) + Thu gọn HUD & Cập nhật 1 chạm"
};
