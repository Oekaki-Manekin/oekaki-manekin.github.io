import type * as THREE from "three";

/**
 * three.js(r169)の`Raycaster`は`object.visible`を一切見ない実装になっている
 * (`Raycaster`内部の`intersect()`が判定するのは`layers`のみ)。そのため非表示にしたオブジェクトも
 * クリック判定にヒットし続け、「透明なのに空中をクリックするとコントローラーが出る」状態になる
 * (2026-08-03、ユーザー報告)。「非表示のものは存在しない扱いにする」には、レイキャストを行う側で
 * 明示的に除外する必要がある。
 *
 * 自分自身だけでなく祖先の`visible`まで遡って判定するため、キャラクターの`root.visible = false`を
 * 立てるだけで、配下のボーン選択マーカー・体本体メッシュ・手に持たせている小物までまとめて
 * クリック対象外になる(持たせた小物は手ボーンの子=`character.root`配下、PropController参照)。
 */
export function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * レイキャストの対象一覧から、画面に出ていないオブジェクトを除外する。
 * クリック判定を持つクラス(SelectionController/CrossCharacterSelector/EmptySpaceClickController/
 * PropController/IkController)は、`intersectObjects()`へ渡す直前に必ずこれを通すこと。
 * 個別に「このキャラは非表示か」を持ち回るのではなく`visible`という1つの事実だけを見る形にして、
 * 隠す要因(モデルの表示チェック・クリーンビュー・ハンドルの強制非表示)が増えても
 * 各クリック判定側を直さずに済むようにしてある。
 */
export function filterPickable<T extends THREE.Object3D>(objects: readonly T[]): T[] {
  return objects.filter(isEffectivelyVisible);
}
