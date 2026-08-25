import * as THREE from "three";
import type { BoneName } from "../config/boneDefs";

/**
 * マネキン・VRMなど「ポーズを付けられる対象」の共通インターフェース。
 * VRMは一部ボーン(chest/neck/shoulder等)を持たないモデルもあるためPartialとする。
 */
export interface Character {
  readonly kind: "mannequin" | "vrm";
  readonly root: THREE.Object3D;
  readonly bones: Partial<Record<BoneName, THREE.Object3D>>;
  readonly pickableMeshes: THREE.Object3D[];
  /**
   * `bones`の行列を最新化するために`updateMatrixWorld()`を呼ぶべきルート。
   * 通常は`root`と同じだが、VRMの正規化ボーンのようにシーンから独立した階層を
   * ポーズ操作対象にしている場合はそちらのルートを指定する。未指定時は`root`を使う。
   */
  readonly matrixRoot?: THREE.Object3D;
  /**
   * 生成・読み込み直後(=ポーズ操作前)のhipsのローカル位置。
   * hipsだけは紫のIKハンドルでユーザーが動かせる=ポーズの一部なので、全身リセット時に
   * ここへ戻す(PoseReset.resetAll)。マネキンはボーン定義の既定値と一致するが、VRMは
   * モデルごとに寸法が異なり定数を当てはめると腰が飛ぶため、読み込み時の実値を憶えておく。
   * hipsを持たないキャラクターは未設定。
   */
  readonly restHipsPosition?: THREE.Vector3;
  setHighlighted(boneName: BoneName | null): void;
  dispose(): void;
}
