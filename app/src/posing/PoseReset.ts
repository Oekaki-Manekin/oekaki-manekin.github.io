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

/** 全身をT字ポーズにリセットする */
export function resetAll(bones: BoneMap): void {
  for (const name of BONE_NAMES) {
    bones[name]?.quaternion.identity();
  }
}

/** 指定ボーン以下(自分自身含む)のサブツリーのみリセットする */
export function resetSubtree(bones: BoneMap, boneName: BoneName): void {
  const targets: BoneName[] = [];
  collectSubtree(boneName, targets);
  for (const name of targets) {
    bones[name]?.quaternion.identity();
  }
}
