export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.13',
  buildNumber: 202611191440,
  builtAt: '2026-11-19T14:40:20+07:00',
  note: "Thêm nút BẮT ĐẦU leo thật: ẩn toàn bộ chế độ Test, khóa GPS/La bàn thật, tự tính lịch tiếp nước + nghỉ phục hồi và đồng hồ đếm ngược nghỉ đủ độ bền"
};
