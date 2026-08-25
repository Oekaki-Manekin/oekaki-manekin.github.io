import * as THREE from "three";
import type { SceneManager } from "../scene/SceneManager";
import { CAMERA_PRESETS, type CameraPreset } from "../scene/cameraPresets";
import { computeBoundsCenter, computeFitDistance, type FitOptions } from "../scene/cameraFraming";
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

/**
 * 表示中のビューをPNGとしてダウンロードする。
 * 完了(コントローラーの復元まで)を待てるようPromiseを返す。呼び出し側はこれをawaitして
 * 書き出しの排他制御を行うこと(main.tsのrunExclusiveExport参照)。
 */
export async function exportViewportPNG(
  sceneManager: SceneManager,
  transparent: boolean,
  cropRect?: ExportCropRect | null,
): Promise<void> {
  sceneManager.setBackgroundTransparent(transparent);
  // ギズモ・IKハンドル・光源マーカー等のコントローラー類は作画資料として不要なため、書き出し中だけ隠す
  // (2026-08-03、ユーザー要望)。
  sceneManager.hideControllersForExport();
  try {
    const blob = await renderToBlob(sceneManager, cropRect);
    if (blob) downloadBlob(`pose_${timestamp()}.png`, blob);
  } finally {
    // toBlob()が失敗・例外になってもコントローラーが隠れたまま残らないようfinallyで戻す
    // (多角度書き出し側と揃える)。
    sceneManager.restoreControllersVisibility();
    sceneManager.setBackgroundTransparent(false);
    sceneManager.renderNow();
  }
}

const MULTI_ANGLE_PRESET_IDS = ["front", "left", "right", "back"] as const;

const _direction = new THREE.Vector3();
const _presetTarget = new THREE.Vector3();

/**
 * 現在のポーズを正面・左側面・右側面・背面の4方向(+任意で俯瞰)からPNGで書き出す。
 * ブラウザの連続ダウンロードブロックを避けるため各書き出しの間に短い間隔を空ける。
 * 書き出し後はカメラを元の構図に戻す。
 *
 * objectsには「選択されているモデル」の本体+装着中の小物を渡す(2026-08-03、ユーザー報告:
 * モデルを原点から大きく動かしていると3面図が見切れる)。各プリセットの注視点は原点付近の固定値
 * だったため、モデルがそこから離れるほど画面の端・外へ追いやられていた。ここではobjectsの
 * バウンディングボックス中心を注視点(pivot)として使い、SceneManager.applyCameraPreset側で
 * プリセットの向き・角度を保ったまま注視点だけそこへ平行移動する。
 *
 * カメラ距離は方向ごとに個別最適化せず、全方向(正面・側面・背面等)のうちもっとも距離を要する
 * 向きに合わせた1つの値へ揃える(2026-08-03、ユーザー報告: 前後と左右で書き出し画像の中の
 * モデルの大きさが微妙に異なり、3面図の資料としてそのまま並べるとサイズが揃わない)。人体は
 * 正面から見た幅と側面から見た奥行きが異なるのが普通で、方向ごとに距離を最適化するとその差が
 * そのまま画像ごとの縮尺差になってしまうため、あえて「その中でいちばん引きが必要な向き」に
 * 全方向を合わせている。
 */
export async function exportMultiAnglePNG(
  sceneManager: SceneManager,
  transparent: boolean,
  cropRect: ExportCropRect | null | undefined,
  includeTop: boolean,
  objects: readonly THREE.Object3D[],
  fitOptions?: FitOptions,
): Promise<void> {
  const original = sceneManager.getCameraState();
  const ts = timestamp();
  const presetIds: readonly string[] = includeTop ? [...MULTI_ANGLE_PRESET_IDS, "top"] : MULTI_ANGLE_PRESET_IDS;
  const presets = presetIds
    .map((id) => CAMERA_PRESETS.find((p) => p.id === id))
    .filter((p): p is CameraPreset => p != null);
  const pivot = computeBoundsCenter(objects) ?? undefined;

  let fitDistance: number | null = null;
  if (pivot) {
    for (const preset of presets) {
      _direction.set(...preset.position).sub(_presetTarget.set(...preset.target));
      if (_direction.lengthSq() < 1e-12) continue;
      _direction.normalize();
      const d = computeFitDistance(sceneManager.camera, pivot, _direction, objects, fitOptions);
      if (d !== null) fitDistance = fitDistance === null ? d : Math.max(fitDistance, d);
    }
  }

  sceneManager.setBackgroundTransparent(transparent);
  // ギズモ・IKハンドル・光源マーカー等のコントローラー類は作画資料として不要なため、書き出し中だけ隠す
  // (2026-08-03、ユーザー要望)。方向を切り替えても対象は変わらないためループの外で1回だけ切り替える。
  sceneManager.hideControllersForExport();
  try {
    for (const preset of presets) {
      sceneManager.applyCameraPreset(preset, pivot);
      if (fitDistance !== null) sceneManager.setCameraDistance(fitDistance);
      const blob = await renderToBlob(sceneManager, cropRect);
      if (blob) downloadBlob(`pose_${ts}_${preset.label}.png`, blob);
      await delay(250);
    }
  } finally {
    sceneManager.restoreControllersVisibility();
    sceneManager.setBackgroundTransparent(false);
    sceneManager.applyCameraState(original);
    sceneManager.renderNow();
  }
}
