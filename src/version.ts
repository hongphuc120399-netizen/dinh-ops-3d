export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.14',
  buildNumber: 202611200910,
  builtAt: '2026-11-20T09:10:34+07:00',
  note: "Thêm phòng thí nghiệm Xếp Gạch 3D Vật Lý Thực (cannon-es 120Hz, 100% Offline): 0% xuyên thấu vật thể, tự động đổi thử 12 phương án khi sập đến khi đứng vững, thử gió & rung lắc thật"
};
