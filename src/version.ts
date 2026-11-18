export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.5',
  buildNumber: 202611180811,
  builtAt: '2026-11-18T08:11:48+07:00',
  note: "Sửa dứt điểm lỗi H-UP xoay lắc trái phải & Chống Gimbal Lock la bàn ngang"
};
