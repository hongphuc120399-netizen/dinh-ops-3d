export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.3',
  buildNumber: 202611180802,
  builtAt: '2026-11-18T08:02:32+07:00',
  note: "Khắc phục vệt TRK 58km khi chuyển GPS Thật ở xa & Chống đè nhãn Đỉnh La Bàn"
};
