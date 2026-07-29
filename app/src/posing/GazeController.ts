import * as THREE from "three";
import { JOINT_LIMITS, clampToLimit } from "../config/jointLimits";
import type { Character } from "../character/Character";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
// マネキンの頭ボーン、およびVRMの正規化ヘッドボーンはいずれもローカル+Zが正面を向くため、
// 「正面」を表す基準ベクトルとして+Zを使う(VRM0.xは読み込み時に向きを+Zへ揃えている)。
const HEAD_FORWARD = new THREE.Vector3(0, 0, 1);

const _headWorldPos = new THREE.Vector3();
const _targetWorldPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _parentWorldQuat = new THREE.Quaternion();
const _lookQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * 頭を常にカメラの方へ向ける「カメラ目線」機能。マネキン・VRM双方の頭ボーンを回転させる。
 * VRMの目のボーンはvrm.lookAtが別途追従させるため、頭(このコントローラ)+目で自然にカメラを見る。
 */
export class GazeController {
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  /** 毎フレーム呼び出す。有効時、キャラクターの頭ボーンをカメラの方へ向ける。 */
  update(character: Character, target: THREE.Object3D, limitsEnabled: boolean): void {
    if (!this.enabled) return;
    const head = character.bones.head;
    if (!head || !head.parent) return;

    head.getWorldPosition(_headWorldPos);
    target.getWorldPosition(_targetWorldPos);
    _dir.copy(_targetWorldPos).sub(_headWorldPos);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();

    head.parent.getWorldQuaternion(_parentWorldQuat);
    _dir.applyQuaternion(_parentWorldQuat.invert()); // ワールド方向 → 親ローカル空間
    _lookQuat.setFromUnitVectors(HEAD_FORWARD, _dir);

    if (limitsEnabled) {
      _euler.setFromQuaternion(_lookQuat, "XYZ");
      const clamped = clampToLimit(
        { x: _euler.x * RAD2DEG, y: _euler.y * RAD2DEG, z: _euler.z * RAD2DEG },
        JOINT_LIMITS.head,
      );
      head.rotation.set(clamped.x * DEG2RAD, clamped.y * DEG2RAD, clamped.z * DEG2RAD, "XYZ");
    } else {
      head.quaternion.copy(_lookQuat);
    }
  }
}
