import * as THREE from "three";
import type { BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";
import { filterPickable } from "./pickFilter";

type SelectListener = (boneName: BoneName | null) => void;

/**
 * 3Dビュー上のクリック選択と、外部(リストUI)からの選択を統合管理する。
 */
export class SelectionController {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: BoneName | null = null;
  private listeners: SelectListener[] = [];
  private domElement: HTMLElement;
  private camera: THREE.Camera;
  private character: Character;
  private pointerDownPos = { x: 0, y: 0 };
  private suppressNextClick = false;

  constructor(domElement: HTMLElement, camera: THREE.Camera, character: Character) {
    this.domElement = domElement;
    this.camera = camera;
    this.character = character;
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  /** 選択変更時のコールバックを登録する。返り値の関数を呼ぶと解除できる。 */
  onSelect(cb: SelectListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  get current(): BoneName | null {
    return this.selected;
  }

  /** ギズモ操作終了直後の余分なクリック判定を1回だけ無視する */
  suppressNextRaycast(): void {
    this.suppressNextClick = true;
  }

  /** 操作対象キャラクター(マネキン/VRM)を切り替える */
  setCharacter(character: Character): void {
    this.character = character;
    this.select(null);
  }

  select(boneName: BoneName | null): void {
    if (this.selected === boneName) return;
    this.selected = boneName;
    this.character.setHighlighted(boneName);
    for (const cb of this.listeners) cb(boneName);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    // ドラッグ(カメラ操作/ギズモ操作)とクリックを区別する
    if (Math.hypot(dx, dy) > 4) return;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // モデル欄のチェックを外して非表示にしているキャラクターは「いない扱い」にする(2026-08-03、
    // ユーザー要望)。非表示中は全マーカーが除外されるので必ず空振りし、選択解除されるだけになる。
    const hits = this.raycaster.intersectObjects(filterPickable(this.character.pickableMeshes), false);
    if (hits.length > 0) {
      const boneName = hits[0].object.userData.boneName as BoneName;
      this.select(boneName);
    } else {
      this.select(null);
    }
  };

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
  }
}
