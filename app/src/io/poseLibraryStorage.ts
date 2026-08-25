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

function savePoseLibrary(poses: SavedPose[]): boolean {
  return storage.set(KEY, JSON.stringify(poses));
}

/**
 * ポーズをライブラリへ追加する。保存に成功したかどうかを返す。
 * サムネイル(dataURL)を同梱するため容量を食いやすく、localStorageの上限に達すると保存できない。
 * 明示的なユーザー操作なので、falseが返ったらUI側で必ず理由を伝えること
 * (かつては成否に関わらずオブジェクトを返しており、「保存を押したのに一覧に出ない」だけが
 *  起きていた。2026-08-18検出)。
 */
export function addSavedPose(entry: Omit<SavedPose, "id" | "createdAt">): boolean {
  const saved: SavedPose = {
    ...entry,
    id: `pose_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const poses = loadPoseLibrary();
  poses.push(saved);
  return savePoseLibrary(poses);
}

export function removeSavedPose(id: string): void {
  savePoseLibrary(loadPoseLibrary().filter((p) => p.id !== id));
}

export function renameSavedPose(id: string, name: string): boolean {
  const poses = loadPoseLibrary();
  const target = poses.find((p) => p.id === id);
  if (!target) return true;
  target.name = name;
  return savePoseLibrary(poses);
}
