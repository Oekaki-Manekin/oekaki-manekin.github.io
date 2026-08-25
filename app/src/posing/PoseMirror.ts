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
  // 腰の左右位置もミラーする。腰だけは紫のIKハンドルでユーザーが動かせる=ポーズの一部であり、
  // ここを据え置くと「腕と脚は入れ替わるのに腰の横位置だけ元のまま」で鏡像にならない
  // (2026-08-18修正)。他のボーンのpositionは骨格の長さ(体型)であってポーズではないため触らない。
  // 反転の基準面は回転のミラー(MIRROR_MAP+y,z成分の反転)と同じキャラクターローカルのX=0平面。
  const hips = bones.hips;
  if (hips) hips.position.x = -hips.position.x;
}
