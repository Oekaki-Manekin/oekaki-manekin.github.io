// 保存済みカメラ構図(位置・注視点・焦点距離)の永続化(localStorage、複数スロット・名前付き)。
// ブラウザ固有APIは platform.ts の storage 経由(Tauri化の差し替え点)。

import { storage } from "./platform";

export interface SavedCameraView {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  focalLength: number;
  createdAt: string;
}

const KEY = "3dposer.savedCameras.v1";

export function loadSavedCameras(): SavedCameraView[] {
  const raw = storage.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedCameraView[]) : [];
  } catch {
    return [];
  }
}

function saveSavedCameras(views: SavedCameraView[]): boolean {
  return storage.set(KEY, JSON.stringify(views));
}

/**
 * 構図を保存する。保存に成功したかどうかを返す。
 * 明示的なユーザー操作なので、falseが返ったらUI側で必ず理由を伝えること
 * (poseLibraryStorage.addSavedPoseと同じ理由)。
 */
export function addSavedCamera(entry: Omit<SavedCameraView, "id" | "createdAt">): boolean {
  const saved: SavedCameraView = {
    ...entry,
    id: `camera_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const views = loadSavedCameras();
  views.push(saved);
  return saveSavedCameras(views);
}

export function removeSavedCamera(id: string): void {
  saveSavedCameras(loadSavedCameras().filter((v) => v.id !== id));
}
