// ポーズの部分合成(部位指定適用)と補間(2ポーズ間の中間生成)を担当する。
// フェーズ4の (B) ポーズの部分合成 / (C) ポーズ補間 の中核ロジック。

import * as THREE from "three";
import { BONE_DEFS, BONE_DEF_MAP, BONE_NAMES, type BoneName } from "../config/boneDefs";
import type { PoseData, BonePoseEntry } from "./PoseSerializer";

/**
 * 部分合成で指定できる「部位」。boneDefs の group を土台に、体幹を
 * 頭首 / 上体(背骨・胸) / 腰 に細分した細かめの粒度。
 */
export type PosePart =
  | "headNeck"
  | "spineChest"
  | "hips"
  | "leftArm"
  | "rightArm"
  | "leftHand"
  | "rightHand"
  | "leftLeg"
  | "rightLeg";

export const POSE_PARTS: PosePart[] = [
  "headNeck",
  "spineChest",
  "hips",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
  "leftLeg",
  "rightLeg",
];

export const PART_LABELS: Record<PosePart, string> = {
  headNeck: "頭・首",
  spineChest: "上体(背・胸)",
  hips: "腰",
  leftArm: "左腕",
  rightArm: "右腕",
  leftHand: "左手指",
  rightHand: "右手指",
  leftLeg: "左脚",
  rightLeg: "右脚",
};

// group から部位へのマッピング(体幹は個別ボーンで振り分ける)
function partOfBone(name: BoneName): PosePart {
  if (name === "hips") return "hips";
  if (name === "spine" || name === "chest") return "spineChest";
  if (name === "neck" || name === "head") return "headNeck";
  const group = BONE_DEFS.find((d) => d.name === name)!.group;
  switch (group) {
    case "leftArm":
      return "leftArm";
    case "rightArm":
      return "rightArm";
    case "leftFingers":
      return "leftHand";
    case "rightFingers":
      return "rightHand";
    case "leftLeg":
      return "leftLeg";
    case "rightLeg":
      return "rightLeg";
    default:
      // torso(hips/spine/chest/neck/head)は上で処理済みだが型網羅のため
      return "spineChest";
  }
}

export const PART_BONES: Record<PosePart, BoneName[]> = (() => {
  const map = Object.fromEntries(POSE_PARTS.map((p) => [p, [] as BoneName[]])) as Record<
    PosePart,
    BoneName[]
  >;
  for (const name of BONE_NAMES) map[partOfBone(name)].push(name);
  return map;
})();

/** 便宜上のまとめ選択: 上半身(頭首・上体・両腕・両手指)。 */
export const UPPER_BODY_PARTS: PosePart[] = [
  "headNeck",
  "spineChest",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
];

/** 便宜上のまとめ選択: 下半身(腰・両脚)。 */
export const LOWER_BODY_PARTS: PosePart[] = ["hips", "leftLeg", "rightLeg"];

/** 指定部位に属するボーン名集合を返す。 */
export function boneSetForParts(parts: Iterable<PosePart>): Set<BoneName> {
  const set = new Set<BoneName>();
  for (const p of parts) for (const b of PART_BONES[p]) set.add(b);
  return set;
}

type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

export interface ApplyPartialOptions {
  /** hips の位置(絶対座標)を適用するか(キャラクター跨ぎでは false 推奨。既存 applyPose と同方針)。 */
  applyHipsPosition?: boolean;
}

/**
 * ポーズを「指定した部位のボーンだけ」現在の姿勢へ適用する(部分合成)。
 * parts に全部位を渡せば applyPose 相当の全身適用になる。
 * 対象ポーズに存在しないボーン・現在キャラクターに無いボーンはスキップする。
 */
export function applyPosePartial(
  bones: BoneMap,
  pose: PoseData,
  parts: Set<PosePart>,
  options: ApplyPartialOptions = {},
): void {
  const allowed = boneSetForParts(parts);
  const applyHips = (options.applyHipsPosition ?? true) && parts.has("hips");
  for (const name of BONE_NAMES) {
    if (!allowed.has(name)) continue;
    const entry = pose[name];
    if (!entry) continue;
    const bone = bones[name];
    if (!bone) continue;
    const [x, y, z, w] = entry.rotation;
    bone.quaternion.set(x, y, z, w);
    if (name === "hips" && entry.position && applyHips) {
      bone.position.set(entry.position[0], entry.position[1], entry.position[2]);
    }
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
// 片方のポーズにhips位置が無い場合の既定値。ボーン定義を参照して一本化しておく
// (同じ値を独立に持つと片方だけ更新して食い違う。2026-08-18に定数の二重管理を解消)。
const DEFAULT_HIPS: readonly [number, number, number] = BONE_DEF_MAP.hips.position;

/**
 * 2つのポーズ a, b を係数 t(0〜1)で補間した新しいポーズを生成する。
 * 回転はクォータニオン slerp、hips 位置は線形補間。
 * どちらのポーズにも無いボーンは出力しない(= 適用時に触れず、現状を保つ。指などが不用意にリセットされない)。
 */
export function blendPoses(a: PoseData, b: PoseData, t: number): PoseData {
  const out: PoseData = {};
  for (const name of BONE_NAMES) {
    const ea = a[name];
    const eb = b[name];
    if (!ea && !eb) continue;
    const ra = ea?.rotation ?? IDENTITY;
    const rb = eb?.rotation ?? IDENTITY;
    _qa.set(ra[0], ra[1], ra[2], ra[3]);
    _qb.set(rb[0], rb[1], rb[2], rb[3]);
    _qr.slerpQuaternions(_qa, _qb, t);
    const entry: BonePoseEntry = { rotation: [_qr.x, _qr.y, _qr.z, _qr.w] };
    if (name === "hips") {
      const pa = ea?.position ?? DEFAULT_HIPS;
      const pb = eb?.position ?? DEFAULT_HIPS;
      entry.position = [
        pa[0] + (pb[0] - pa[0]) * t,
        pa[1] + (pb[1] - pa[1]) * t,
        pa[2] + (pb[2] - pa[2]) * t,
      ];
    }
    out[name] = entry;
  }
  return out;
}
