export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.1',
  buildNumber: 202611161609,
  builtAt: '2026-11-16T16:09:17+07:00',
  note: "Thêm vòng tròn vuốt chiến thuật khi nhấn giữ & Dẫn đường bám trail kiểu GTA V"
};
