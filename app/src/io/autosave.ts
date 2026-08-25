import { storage } from "./platform";
import type { PoseData, PropInstanceData } from "../posing/PoseSerializer";
import type { BodyShapeParams } from "../config/bodyShapeDefs";

// 【変更禁止】旧アプリ名(3Dポーザー)由来のキーだが、変えると既存ユーザーの作業中ポーズが
// すべて失われるため意図的にこのまま残す(他のstorageキーも同様。BUGFIX-HANDOFF.md B-1)。
// 他タブの書き込み検知(storageイベント)から参照するためexportしている。
export const AUTOSAVE_KEY = "3dposer.autosave.v1";

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

// オートセーブの連続失敗回数。1回きりの失敗は無視してよいが、容量超過のように継続して
// 失敗している状態はユーザーが最後まで気づけないまま作業が失われるため、検知できるようにする。
let consecutiveFailures = 0;
// 3回=約9秒連続で失敗していれば一時的な失敗ではないと判断する。
const FAILING_THRESHOLD = 3;

/** オートセーブを保存する。成功したかどうかを返す(呼び出し側は無視してよい)。 */
export function saveAutosave(data: AutosaveData): boolean {
  const ok = storage.set(AUTOSAVE_KEY, JSON.stringify(data));
  consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
  return ok;
}

/**
 * オートセーブが継続的に失敗しているか。main.tsが監視し、一度だけ警告を出すために使う
 * (毎回出すと邪魔になるため、通知の回数制御は呼び出し側の責務)。
 */
export function autosaveIsFailing(): boolean {
  return consecutiveFailures >= FAILING_THRESHOLD;
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
