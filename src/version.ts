export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.0.3',
  buildNumber: 202611160806,
  builtAt: '2026-11-16T08:06:11+07:00',
  note: "Sửa lỗi bắt buộc SHA-256 Checksum khi tải OTA trên Android + Mặc định nằm ngang"
};
