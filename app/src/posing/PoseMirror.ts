import * as THREE from "three";
import { BONE_NAMES, MIRROR_MAP, type BoneName } from "../config/boneDefs";

/**
 * 現在のポーズを左右反転する。
 * 左右ボーンはX軸位置が符号反転の関係にあり、バインド姿勢に回転オフセットがないため、
 * クォータニオンの(y, z)成分を反転しつつ左右のボーンを入れ替えることでミラーになる。
 * VRMなど一部ボーンが存在しないキャラクターにも対応し、欠損ボーンはスキップする。
 */
export function mirrorPose(bones: Partial<Record<BoneName, THREE.Object3D>>): void {
  const original = new Map<BoneName, THREE.Quaternion>();
  for (const name of BONE_NAMES) {
    const bone = bones[name];
    if (bone) original.set(name, bone.quaternion.clone());
  }
  for (const name of BONE_NAMES) {
    const bone = bones[name];
    if (!bone) continue;
    const src = original.get(MIRROR_MAP[name]);
    if (!src) continue;
    bone.quaternion.set(src.x, -src.y, -src.z, src.w);
  }
}
