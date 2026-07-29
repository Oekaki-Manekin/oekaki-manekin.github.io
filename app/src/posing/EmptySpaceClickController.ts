import * as THREE from "three";
import type { Character } from "../character/Character";
import { getBodyMeshes } from "../scene/DisplayModeMaterials";

export interface EmptySpaceTargetsProvider {
  getCharacters: () => readonly Character[];
  getPropObjects: () => THREE.Object3D[];
}

/**
 * 作画資料としてコントローラー・ギズモを一切表示しないクリーンなビューが頻繁に必要、との要望(2026-07-28)への対応。
 * 「何もない場所」をキャラクター(pickableMeshes+体本体メッシュ、アクティブ/非アクティブ問わず全体)・
 * 小物のどれにもヒットしない場所と定義し、そこでのダブルクリックを`onEmptyDoubleClick`で通知する
 * (実際に隠す処理はmain.ts側、IkController.setHandlesHidden()・selection.select(null)経由)。
 * 逆に、隠れている間に何かへヒットする通常クリックがあれば`onAnyHit`で再表示を促す。
 */
export class EmptySpaceClickController {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private emptyDoubleClickListeners: (() => void)[] = [];
  private anyHitListeners: (() => void)[] = [];

  constructor(
    private domElement: HTMLElement,
    private camera: THREE.Camera,
    private targets: EmptySpaceTargetsProvider,
    // 非表示状態でないときは再表示チェックのレイキャスト自体が無駄になるため、呼び出し側から現在の
    // 非表示状態を渡してもらい、通常のクリック操作(頻度が高い)では判定処理をスキップする。
    private isHidden: () => boolean,
  ) {
    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointerup", this.handlePointerUp);
    domElement.addEventListener("dblclick", this.handleDblClick);
  }

  /** 何もない場所がダブルクリックされたときに呼ばれる。 */
  onEmptyDoubleClick(cb: () => void): void {
    this.emptyDoubleClickListeners.push(cb);
  }

  /** (非表示状態のときのみ)キャラクターまたは小物への通常クリックがあったときに呼ばれる。 */
  onAnyHit(cb: () => void): void {
    this.anyHitListeners.push(cb);
  }

  private collectTargets(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const character of this.targets.getCharacters()) {
      objects.push(...character.pickableMeshes, ...getBodyMeshes(character));
    }
    objects.push(...this.targets.getPropObjects());
    return objects;
  }

  private hitsSomething(clientX: number, clientY: number): boolean {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.collectTargets(), true).length > 0;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.isHidden()) return;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 4) return;
    if (this.hitsSomething(e.clientX, e.clientY)) {
      for (const cb of this.anyHitListeners) cb();
    }
  };

  private handleDblClick = (e: MouseEvent): void => {
    if (!this.hitsSomething(e.clientX, e.clientY)) {
      for (const cb of this.emptyDoubleClickListeners) cb();
    }
  };

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("dblclick", this.handleDblClick);
  }
}
