import * as THREE from "three";
import { BONE_DEFS, BONE_NAMES, type BoneName } from "../config/boneDefs";

const CHILDREN_MAP: Partial<Record<BoneName, BoneName[]>> = {};
for (const def of BONE_DEFS) {
  if (def.parent) {
    (CHILDREN_MAP[def.parent] ??= []).push(def.name);
  }
}

function collectSubtree(boneName: BoneName, out: BoneName[]): void {
  out.push(boneName);
  for (const child of CHILDREN_MAP[boneName] ?? []) {
    collectSubtree(child, out);
  }
}

type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

// 腰だけは紫のIKハンドルでユーザーが動かせる=ポーズの一部なので、リセットで初期位置へ戻す
// (2026-08-18修正。それまでは回転だけ戻り、ドラッグした腰の位置が残って元の立ち位置に戻らなかった)。
// 戻す先は呼び出し側から渡すこと。VRMは寸法がモデルごとに違い、マネキン基準の定数(0,0.92,0)を
// 当てはめると腰が飛ぶため、Character.restHipsPosition(読み込み時の実値)を使う。
// 他のボーンのpositionは骨格の長さ(体型)であってポーズではないため、ここでは触らない。
function resetHipsPosition(bones: BoneMap, restHipsPosition: THREE.Vector3 | undefined): void {
  if (!restHipsPosition) return;
  bones.hips?.position.copy(restHipsPosition);
}

/** 全身をT字ポーズにリセットする(腰の位置も初期位置へ戻す) */
export function resetAll(bones: BoneMap, restHipsPosition?: THREE.Vector3): void {
  for (const name of BONE_NAMES) {
    bones[name]?.quaternion.identity();
  }
  resetHipsPosition(bones, restHipsPosition);
}

/** 指定ボーン以下(自分自身含む)のサブツリーのみリセットする */
export function resetSubtree(bones: BoneMap, boneName: BoneName, restHipsPosition?: THREE.Vector3): void {
  const targets: BoneName[] = [];
  collectSubtree(boneName, targets);
  for (const name of targets) {
    bones[name]?.quaternion.identity();
  }
  // hips指定時のみ位置も戻す(サブツリーの起点がhips=全身相当のため)。
  if (boneName === "hips") resetHipsPosition(bones, restHipsPosition);
}
