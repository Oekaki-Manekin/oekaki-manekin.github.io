import { storage } from "./platform";
import type { FingerPreset } from "../config/fingerPresets";

const CUSTOM_FINGER_PRESETS_KEY = "3dposer.customFingerPresets.v1";

export function loadCustomFingerPresets(): FingerPreset[] {
  const raw = storage.get(CUSTOM_FINGER_PRESETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FingerPreset[]) : [];
  } catch {
    return [];
  }
}

function saveCustomFingerPresets(presets: FingerPreset[]): boolean {
  return storage.set(CUSTOM_FINGER_PRESETS_KEY, JSON.stringify(presets));
}

/**
 * 自作の指プリセットを追加する。保存に成功したかどうかを返す。
 * 明示的なユーザー操作なので、falseが返ったらUI側で必ず理由を伝えること
 * (poseLibraryStorage.addSavedPoseと同じ理由)。
 */
export function addCustomFingerPreset(preset: FingerPreset): boolean {
  const presets = loadCustomFingerPresets();
  presets.push({ ...preset, custom: true });
  return saveCustomFingerPresets(presets);
}

export function removeCustomFingerPreset(id: string): void {
  const presets = loadCustomFingerPresets().filter((p) => p.id !== id);
  saveCustomFingerPresets(presets);
}
