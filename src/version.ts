export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '1.0.8',
  buildNumber: 202611161127,
  builtAt: '2026-11-16T11:27:30+07:00',
  note: "Thêm Mật Thư Decoder (Caesar 25, Morse, A1Z26, Base64, QR/OCR) & Engineering Toolkit"
};
