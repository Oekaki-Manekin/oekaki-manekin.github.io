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
  setHighlighted(boneName: BoneName | null): void;
  dispose(): void;
}
