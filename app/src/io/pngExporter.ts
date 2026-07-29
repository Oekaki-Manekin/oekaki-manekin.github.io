import type { SceneManager } from "../scene/SceneManager";
import { CAMERA_PRESETS } from "../scene/cameraPresets";
import { downloadBlob } from "./platform";

/** キャンバス枠(CanvasFrameOverlay)の書き出しクロップ範囲。座標系はレンダラーの内部ピクセル。 */
export interface ExportCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function renderToBlob(sceneManager: SceneManager, cropRect?: ExportCropRect | null): Promise<Blob | null> {
  sceneManager.renderNow();
  const canvas = sceneManager.renderer.domElement;
  if (!cropRect) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }
  // 枠内切り出し: 書き出しキャンバスから該当領域だけを別canvasにdrawImageでコピーしてから書き出す
  const { x, y, width, height } = cropRect;
  const cropped = document.createElement("canvas");
  cropped.width = Math.max(1, Math.round(width));
  cropped.height = Math.max(1, Math.round(height));
  const ctx = cropped.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(canvas, x, y, width, height, 0, 0, cropped.width, cropped.height);
  return new Promise((resolve) => cropped.toBlob((blob) => resolve(blob), "image/png"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 表示中のビューをPNGとしてダウンロードする */
export function exportViewportPNG(
  sceneManager: SceneManager,
  transparent: boolean,
  cropRect?: ExportCropRect | null,
): void {
  sceneManager.setBackgroundTransparent(transparent);
  renderToBlob(sceneManager, cropRect).then((blob) => {
    sceneManager.setBackgroundTransparent(false);
    sceneManager.renderNow();
    if (blob) downloadBlob(`pose_${timestamp()}.png`, blob);
  });
}

const MULTI_ANGLE_PRESET_IDS = ["front", "left", "right", "back"] as const;

/**
 * 現在のポーズを正面・左側面・右側面・背面の4方向(+任意で俯瞰)からPNGで書き出す。
 * ブラウザの連続ダウンロードブロックを避けるため各書き出しの間に短い間隔を空ける。
 * 書き出し後はカメラを元の構図に戻す。
 */
export async function exportMultiAnglePNG(
  sceneManager: SceneManager,
  transparent: boolean,
  cropRect?: ExportCropRect | null,
  includeTop = false,
): Promise<void> {
  const original = sceneManager.getCameraState();
  const ts = timestamp();
  const presetIds: readonly string[] = includeTop ? [...MULTI_ANGLE_PRESET_IDS, "top"] : MULTI_ANGLE_PRESET_IDS;
  sceneManager.setBackgroundTransparent(transparent);
  try {
    for (const id of presetIds) {
      const preset = CAMERA_PRESETS.find((p) => p.id === id);
      if (!preset) continue;
      sceneManager.applyCameraPreset(preset);
      const blob = await renderToBlob(sceneManager, cropRect);
      if (blob) downloadBlob(`pose_${ts}_${preset.label}.png`, blob);
      await delay(250);
    }
  } finally {
    sceneManager.setBackgroundTransparent(false);
    sceneManager.applyCameraState(original);
    sceneManager.renderNow();
  }
}
