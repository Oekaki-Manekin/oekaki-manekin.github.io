import * as THREE from "three";
import { BONE_NAMES, type BoneName, type Side } from "../config/boneDefs";
import type { PropTypeId } from "../config/propDefs";
import { DEFAULT_BODY_SHAPE, type BodyShapeParams } from "../config/bodyShapeDefs";

// v2: 小物(プロップ)の配置情報(props)を追加(フェーズ6・(A)小物・プロップ)。
// v3: 体型パラメータ(bodyShape)を追加(フェーズ6・(C)体型バリエーション)。
// v1/v2以前のファイルにはこれらが存在しないため、migratePoseFileで既定値を補って読み込む。
export const CURRENT_FORMAT_VERSION = 3;

export interface BonePoseEntry {
  rotation: [number, number, number, number];
  position?: [number, number, number];
}

export type PoseData = Partial<Record<BoneName, BonePoseEntry>>;

/** 小物(プロップ)1個分の配置情報。PropController.serialize()/restore()が読み書きする。 */
export interface PropInstanceData {
  instanceId: string;
  typeId: PropTypeId;
  attachedTo: Side | null;
  /** 持たせ先キャラクターのスロットID(フェーズ6(B)・複数体配置)。旧バージョンのファイルには存在しない。 */
  attachedCharacterId?: string | null;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
  /** カラーピッカーで指定した色(2026-07-27)。旧バージョンのファイルには存在しない。 */
  colorOverride?: number | null;
}

export interface PoseFile {
  formatVersion: number;
  pose: PoseData;
  props?: PropInstanceData[];
  bodyShape?: BodyShapeParams;
}

type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

/** 現在のボーン姿勢からポーズデータ(JSON化可能なプレーンオブジェクト)を作成する。存在しないボーンはスキップする。 */
export function capturePose(bones: BoneMap): PoseData {
  const pose: PoseData = {};
  for (const name of BONE_NAMES) {
    const bone = bones[name];
    if (!bone) continue;
    const q = bone.quaternion;
    const entry: BonePoseEntry = { rotation: [q.x, q.y, q.z, q.w] };
    if (name === "hips") {
      entry.position = [bone.position.x, bone.position.y, bone.position.z];
    }
    pose[name] = entry;
  }
  return pose;
}

export interface ApplyPoseOptions {
  /**
   * hipsのposition(絶対座標)を適用するか。
   * マネキンとVRMではモデルごとの寸法が異なるため、キャラクターをまたいでポーズを転写する際は
   * falseにして回転のみ引き継ぎ、位置は各モデル本来の値を保つ。
   */
  applyHipsPosition?: boolean;
}

/** ポーズデータをボーンへ適用する。欠損ボーンはスキップ(後方互換・モデル間差異吸収用)。 */
export function applyPose(bones: BoneMap, pose: PoseData, options: ApplyPoseOptions = {}): void {
  const applyHipsPosition = options.applyHipsPosition ?? true;
  for (const name of BONE_NAMES) {
    const entry = pose[name];
    if (!entry) continue;
    const bone = bones[name];
    if (!bone) continue;
    const [x, y, z, w] = entry.rotation;
    bone.quaternion.set(x, y, z, w);
    if (entry.position && name === "hips" && applyHipsPosition) {
      bone.position.set(...entry.position);
    }
  }
}

export function createPoseFile(
  bones: BoneMap,
  props: PropInstanceData[] = [],
  bodyShape: BodyShapeParams = DEFAULT_BODY_SHAPE,
): PoseFile {
  return { formatVersion: CURRENT_FORMAT_VERSION, pose: capturePose(bones), props, bodyShape };
}

/**
 * 読み込んだJSONを現在サポートしているformatVersionへ変換する。
 * 将来formatVersionが増えた場合はここに移行処理を追加する。
 * v1(propsフィールド無し)はprops: []、v1/v2(bodyShapeフィールド無し)はDEFAULT_BODY_SHAPEを
 * 補って読み込む(v1/v2作成時点ではマネキンの体型は常にデフォルト値だったため、これで正しい)。
 */
export function migratePoseFile(raw: unknown): PoseFile {
  if (typeof raw !== "object" || raw === null || !("pose" in raw)) {
    throw new Error("ポーズファイルの形式が正しくありません");
  }
  const obj = raw as { formatVersion?: unknown; pose?: unknown; props?: unknown; bodyShape?: unknown };
  const formatVersion = typeof obj.formatVersion === "number" ? obj.formatVersion : 1;
  if (formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(
      `このポーズファイルは新しい形式(v${formatVersion})です。アプリを更新してください。`,
    );
  }
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    pose: (obj.pose ?? {}) as PoseData,
    props: Array.isArray(obj.props) ? (obj.props as PropInstanceData[]) : [],
    bodyShape: (obj.bodyShape as BodyShapeParams | undefined) ?? DEFAULT_BODY_SHAPE,
  };
}
