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

function saveCustomFingerPresets(presets: FingerPreset[]): void {
  storage.set(CUSTOM_FINGER_PRESETS_KEY, JSON.stringify(presets));
}

export function addCustomFingerPreset(preset: FingerPreset): void {
  const presets = loadCustomFingerPresets();
  presets.push({ ...preset, custom: true });
  saveCustomFingerPresets(presets);
}

export function removeCustomFingerPreset(id: string): void {
  const presets = loadCustomFingerPresets().filter((p) => p.id !== id);
  saveCustomFingerPresets(presets);
}
