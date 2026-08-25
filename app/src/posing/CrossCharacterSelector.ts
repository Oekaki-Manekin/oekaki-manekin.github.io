import * as THREE from "three";
import type { BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";
import { getBodyMeshes } from "../scene/DisplayModeMaterials";
import { filterPickable } from "./pickFilter";

export interface CharacterSlotLike {
  readonly id: string;
  readonly character: Character;
}

type HitListener = (slotId: string, boneName: BoneName | null) => void;

/**
 * 複数体配置(フェーズ6(B))で、非アクティブなキャラクターの体をビュー上で直接クリックしたときに
 * 「そのキャラへの切替+クリックしたボーンの選択」を1クリックで行うためのクリック判定
 * (2026-07-24、ユーザー要望)。
 * 対象を「非アクティブなキャラのpickableMeshes+体本体メッシュ(getBodyMeshes)」にすることで、
 * アクティブなキャラのボーン選択を担うSelectionController、小物選択を担うPropControllerとは
 * 対象集合が重ならず競合しない(同じ理由でこの3システムが同じdomElementを共有できる設計は
 * PHASE6-HANDOFF.md§6参照)。ボーンマーカー以外(素肌など)がヒットした場合はboneNameがnullになり、
 * 呼び出し側はキャラの切替のみ行う(2026-07-28、ユーザー要望: 関節に関係なくモデルのどこをクリックしても
 * 選択状態にしたい)。
 */
export class CrossCharacterSelector {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private suppressNextClick = false;
  private listeners: HitListener[] = [];

  constructor(
    private domElement: HTMLElement,
    private camera: THREE.Camera,
    private getSlots: () => readonly CharacterSlotLike[],
    private getActiveSlotId: () => string,
  ) {
    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  /**
   * 非アクティブなキャラの体がクリックされたときに呼ばれる(切替+ボーン選択は呼び出し側で行う)。
   * ボーンマーカー以外(素肌など)がヒットした場合はboneNameがnullになる。
   */
  onHit(cb: HitListener): void {
    this.listeners.push(cb);
  }

  /**
   * ギズモ・ハンドルのドラッグに伴う余分なクリック判定を1回だけ無視する(他の選択系と同じ理由)。
   * 呼ぶのはドラッグ「開始」時であること(main.tsのsuppressNextRaycastAll参照)。
   */
  suppressNextRaycast(): void {
    this.suppressNextClick = true;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    // 抑制フラグの消費は他のどの判定よりも先に行う(SelectionControllerと同じ理由)。
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 4) return;

    const slots = this.getSlots();
    if (slots.length < 2) return;
    const activeId = this.getActiveSlotId();

    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 【重要】アクティブなキャラも含めて一度にレイキャストし、最前面のヒットがどのスロットに
    // 属するかで判断する。非アクティブなスロットだけを対象にしてスロット順に見ていくと、
    // アクティブなキャラの背後に別のキャラが重なっている場合に、手前をクリックしたのに奥のキャラへ
    // 切り替わってしまう(キャラクターはX軸上に一列に並ぶため、左右の側面ビューでは必ず重なる。
    // 2026-08-18検出)。
    const objectToSlotId = new Map<THREE.Object3D, string>();
    const allTargets: THREE.Object3D[] = [];
    for (const slot of slots) {
      // マネキンはpickableMeshes自体が体本体のためgetBodyMeshesと重複するが、Setで統合するので
      // 二重ヒット(同一メッシュへの重複レイキャスト)にはならない。
      const targets = new Set<THREE.Object3D>(slot.character.pickableMeshes);
      for (const mesh of getBodyMeshes(slot.character)) targets.add(mesh);
      for (const obj of targets) {
        objectToSlotId.set(obj, slot.id);
        allTargets.push(obj);
      }
    }

    // 非表示にしているキャラクターは「いない扱い」にし、その位置をクリックしても切り替えない
    // (2026-08-03、ユーザー要望: 透明なのに空中クリックでコントローラーが出るのは不可解)。
    // intersectObjectsは距離の昇順で返す(sort引数の既定がtrue)ため、hits[0]が最前面。
    const hits = this.raycaster.intersectObjects(filterPickable(allTargets), false);
    if (hits.length === 0) return;

    const hitSlotId = objectToSlotId.get(hits[0].object);
    // 最前面がアクティブなキャラなら切替は起こさない(ボーン選択はSelectionControllerに任せる)。
    if (!hitSlotId || hitSlotId === activeId) return;

    const boneName = (hits[0].object.userData.boneName as BoneName | undefined) ?? null;
    for (const cb of this.listeners) cb(hitSlotId, boneName);
  };

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
  }
}
