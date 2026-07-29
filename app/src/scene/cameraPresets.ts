// カメラ視点プリセット定義。ワンクリック視点切り替えボタンで使用する。

export interface CameraPreset {
  id: string;
  label: string;
  /** カメラ位置 (原点=腰付近を注視点とした相対オフセット) [m] */
  position: [number, number, number];
  target: [number, number, number];
}

const LOOK_TARGET: [number, number, number] = [0, 0.9, 0];
const DIST = 3.2;

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "front", label: "正面", position: [0, 1.0, DIST], target: LOOK_TARGET },
  { id: "left", label: "左側面", position: [-DIST, 1.0, 0], target: LOOK_TARGET },
  { id: "right", label: "右側面", position: [DIST, 1.0, 0], target: LOOK_TARGET },
  { id: "back", label: "背面", position: [0, 1.0, -DIST], target: LOOK_TARGET },
  { id: "top", label: "俯瞰", position: [0, DIST + 1.0, 0.01], target: LOOK_TARGET },
  { id: "low", label: "アオリ", position: [0, 0.2, DIST], target: [0, 1.1, 0] },
];
