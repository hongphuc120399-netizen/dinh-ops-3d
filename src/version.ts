export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.8',
  buildNumber: 202611190805,
  builtAt: '2026-11-19T08:05:06+07:00',
  note: "Nâng cấp chuẩn xác Model 3D: DEM Copernicus GLO-30 256x256, bịt kín vách khối núi, thêm 11 hồ 3D, ôm địa hình 100% dải GTA & vòng ngắm la bàn, tỷ lệ thực 1:1"
};
