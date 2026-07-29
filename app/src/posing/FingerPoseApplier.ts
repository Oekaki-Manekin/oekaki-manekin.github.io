import * as THREE from "three";
import type { GizmoController } from "./GizmoController";
import type { BoneName, Side } from "../config/boneDefs";
import type { FingerPreset, FingerBoneSuffix, FingerEuler } from "../config/fingerPresets";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/**
 * プリセットは左手基準の角度で定義されているため、右手に適用する際は
 * クォータニオンの(y, z)成分反転によるミラー変換を行う(PoseMirror.tsと同じ考え方)。
 * 実際の回転設定はGizmoController経由で行い、可動域リミットや変更通知を通常操作と統一する。
 */
export function applyFingerPreset(gizmo: GizmoController, side: Side, preset: FingerPreset): void {
  for (const [suffix, value] of Object.entries(preset.rotations) as [FingerBoneSuffix, FingerEuler][]) {
    _euler.set(value.x * DEG2RAD, value.y * DEG2RAD, value.z * DEG2RAD, "XYZ");
    _quat.setFromEuler(_euler);
    if (side === "right") {
      _quat.set(_quat.x, -_quat.y, -_quat.z, _quat.w);
    }
    _euler.setFromQuaternion(_quat, "XYZ");
    const boneName = `${side}${suffix}` as BoneName;
    gizmo.setEulerDeg(boneName, {
      x: _euler.x * RAD2DEG,
      y: _euler.y * RAD2DEG,
      z: _euler.z * RAD2DEG,
    });
  }
}

/** 現在の指の形(片手分)を左手基準の角度としてキャプチャする(自作プリセット保存用) */
export function captureFingerPose(gizmo: GizmoController, side: Side, suffixes: FingerBoneSuffix[]): Partial<Record<FingerBoneSuffix, FingerEuler>> {
  const rotations: Partial<Record<FingerBoneSuffix, FingerEuler>> = {};
  for (const suffix of suffixes) {
    const boneName = `${side}${suffix}` as BoneName;
    const euler = gizmo.getEulerDeg(boneName);
    if (side === "right") {
      _euler.set(euler.x * DEG2RAD, euler.y * DEG2RAD, euler.z * DEG2RAD, "XYZ");
      _quat.setFromEuler(_euler);
      _quat.set(_quat.x, -_quat.y, -_quat.z, _quat.w);
      _euler.setFromQuaternion(_quat, "XYZ");
      rotations[suffix] = { x: _euler.x * RAD2DEG, y: _euler.y * RAD2DEG, z: _euler.z * RAD2DEG };
    } else {
      rotations[suffix] = euler;
    }
  }
  return rotations;
}
