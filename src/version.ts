export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.1.12',
  buildNumber: 202611191038,
  builtAt: '2026-11-19T10:38:20+07:00',
  note: "Gộp batch 430 draw-call 3D xuống ~24 draw-call cho 120Hz siêu mượt (tắt MSAA nặng di động, InstancedMesh mũi tên GTA) & bật xoay toàn bộ bản đồ H-UP theo la bàn điện thoại 120Hz cả trong chế độ TEST"
};
