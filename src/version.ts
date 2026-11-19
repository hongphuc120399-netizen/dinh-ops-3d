export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.11',
  buildNumber: 202611191028,
  builtAt: '2026-11-19T10:28:38+07:00',
  note: "Tối ưu siêu mượt cho màn hình 120Hz: khử re-render cảm biến, bám nhãn 3D trực tiếp DOM 120fps, giảm tải shader WebGL + DRS, tắt blur nặng đè WebGL & mở khóa 120Hz Android"
};
