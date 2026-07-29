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

function saveSavedCameras(views: SavedCameraView[]): void {
  storage.set(KEY, JSON.stringify(views));
}

export function addSavedCamera(entry: Omit<SavedCameraView, "id" | "createdAt">): SavedCameraView {
  const saved: SavedCameraView = {
    ...entry,
    id: `camera_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const views = loadSavedCameras();
  views.push(saved);
  saveSavedCameras(views);
  return saved;
}

export function removeSavedCamera(id: string): void {
  saveSavedCameras(loadSavedCameras().filter((v) => v.id !== id));
}
