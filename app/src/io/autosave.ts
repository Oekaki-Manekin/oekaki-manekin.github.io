import { storage } from "./platform";
import type { PoseData, PropInstanceData } from "../posing/PoseSerializer";
import type { BodyShapeParams } from "../config/bodyShapeDefs";

const AUTOSAVE_KEY = "3dposer.autosave.v1";

export interface AutosaveCamera {
  position: [number, number, number];
  target: [number, number, number];
  focalLength: number;
}

export interface AutosaveData {
  formatVersion: number;
  pose: PoseData;
  camera: AutosaveCamera;
  savedAt: string;
  /** v1保存分にはフィールド自体が無いため任意(読み込み側でundefined→空配列扱いにする)。 */
  props?: PropInstanceData[];
  /** 体型パラメータ(フェーズ6(C))。旧保存分には無いため任意(読み込み側でundefined→デフォルト値扱い)。 */
  bodyShape?: BodyShapeParams;
}

export function saveAutosave(data: AutosaveData): void {
  storage.set(AUTOSAVE_KEY, JSON.stringify(data));
}

export function loadAutosave(): AutosaveData | null {
  const raw = storage.get(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AutosaveData;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  storage.remove(AUTOSAVE_KEY);
}

/** 一定間隔でオートセーブを実行する。停止用の関数を返す。 */
export function startAutosaveLoop(getData: () => AutosaveData, intervalMs = 3000): () => void {
  const id = window.setInterval(() => {
    saveAutosave(getData());
  }, intervalMs);
  return () => window.clearInterval(id);
}
