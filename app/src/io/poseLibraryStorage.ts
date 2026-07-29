// 自作ポーズライブラリの永続化(localStorage)。サムネイル(dataURL)を同梱する。
// ブラウザ固有APIは platform.ts の storage 経由(Tauri化の差し替え点)。

import { storage } from "./platform";
import type { PoseData } from "../posing/PoseSerializer";

export const POSE_LIBRARY_FORMAT_VERSION = 1;

export interface SavedPose {
  id: string;
  name: string;
  pose: PoseData;
  /** サムネイル画像(PNGのdataURL) */
  thumbnail: string;
  createdAt: string;
}

/** エクスポート/インポートで使うファイル形式(単一ポーズ)。既存のポーズJSONとも互換の pose を持つ。 */
export interface PoseLibraryFile {
  formatVersion: number;
  name?: string;
  thumbnail?: string;
  pose: PoseData;
}

const KEY = "3dposer.poseLibrary.v1";

export function loadPoseLibrary(): SavedPose[] {
  const raw = storage.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPose[]) : [];
  } catch {
    return [];
  }
}

function savePoseLibrary(poses: SavedPose[]): void {
  storage.set(KEY, JSON.stringify(poses));
}

export function addSavedPose(entry: Omit<SavedPose, "id" | "createdAt">): SavedPose {
  const saved: SavedPose = {
    ...entry,
    id: `pose_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const poses = loadPoseLibrary();
  poses.push(saved);
  savePoseLibrary(poses);
  return saved;
}

export function removeSavedPose(id: string): void {
  savePoseLibrary(loadPoseLibrary().filter((p) => p.id !== id));
}

export function renameSavedPose(id: string, name: string): void {
  const poses = loadPoseLibrary();
  const target = poses.find((p) => p.id === id);
  if (!target) return;
  target.name = name;
  savePoseLibrary(poses);
}
