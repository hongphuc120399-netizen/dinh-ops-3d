export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.18',
  buildNumber: 202611201330,
  builtAt: '2026-11-20T13:30:08+07:00',
  note: "Tích hợp Sổ Tay Văn Hóa Chính Nam (22 trang Offline 100%) với bộ tìm kiếm lai BM25 từ khóa không dấu + Embedded Vector ngữ nghĩa (<1ms)"
};
