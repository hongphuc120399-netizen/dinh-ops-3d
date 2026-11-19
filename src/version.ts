export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.10',
  buildNumber: 202611190844,
  builtAt: '2026-11-19T08:44:03+07:00',
  note: "Thiết kế lại Camera AR đo khoảng cách toàn màn hình nằm ngang: sửa lỗi góc nghiêng Landscape, thêm đo Chân Vật + Tia DEM 3D + Khung Vật + Kiểm chuẩn 3m/5m"
};
