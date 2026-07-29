import * as THREE from "three";
import type { Character } from "../character/Character";

type FootEffector = "leftFoot" | "rightFoot";
const FEET: FootEffector[] = ["leftFoot", "rightFoot"];
const FOOT_LABELS: Record<FootEffector, string> = { leftFoot: "左足", rightFoot: "右足" };

// 足首ボーンから足裏(接地面)までの高さの簡易目安値。マネキンの足メッシュは足首ボーンから
// 約0.06下にあるが、VRMは体型によって実際の足の厚みが異なるため、あくまで概算値として扱う
// (モデルによっては閾値の意味合いがずれる可能性がある。詳細はPHASE5-HANDOFF.md参照)。
const SOLE_OFFSET_ESTIMATE = 0.05;
const FLOAT_THRESHOLD = 0.04;
const SINK_THRESHOLD = 0.04;

/**
 * 各足が床(y=0)から浮いている/めり込んでいる場合に警告バッジを表示する接地確認用オーバーレイ。
 * 3Dシーンではなくビューポート上のHTML要素として実装している(CanvasFrameOverlayと同じ考え方)。
 */
export class GroundContactIndicator {
  readonly element: HTMLElement;
  private container: HTMLElement;
  private visible = false;
  private badges: Record<FootEffector, HTMLElement>;
  private tmpVec = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement("div");
    this.element.className = "ground-contact-layer";
    this.element.style.display = "none";
    this.badges = { leftFoot: this.createBadge(), rightFoot: this.createBadge() };
    this.element.appendChild(this.badges.leftFoot);
    this.element.appendChild(this.badges.rightFoot);
    container.appendChild(this.element);
  }

  private createBadge(): HTMLElement {
    const el = document.createElement("div");
    el.className = "ground-contact-badge";
    el.style.display = "none";
    return el;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 毎フレーム呼び出し、アクティブなキャラクターの各足の接地状態を判定してバッジ位置・表示を更新する。 */
  update(character: Character, camera: THREE.PerspectiveCamera): void {
    if (!this.visible) return;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return;

    // 正規化ボーン(VRM)はシーンから独立した階層のため、そちらのルートを明示的に最新化する
    (character.matrixRoot ?? character.root).updateMatrixWorld(true);
    camera.updateMatrixWorld();

    for (const effector of FEET) {
      const badge = this.badges[effector];
      const bone = character.bones[effector];
      if (!bone) {
        badge.style.display = "none";
        continue;
      }

      bone.getWorldPosition(this.tmpVec);
      const groundGap = this.tmpVec.y - SOLE_OFFSET_ESTIMATE;
      const state: "float" | "sink" | null =
        groundGap > FLOAT_THRESHOLD ? "float" : groundGap < -SINK_THRESHOLD ? "sink" : null;

      if (!state) {
        badge.style.display = "none";
        continue;
      }

      this.tmpVec.project(camera);
      badge.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * cw}px`;
      badge.style.top = `${(1 - (this.tmpVec.y * 0.5 + 0.5)) * ch}px`;
      badge.classList.toggle("ground-contact-badge--float", state === "float");
      badge.classList.toggle("ground-contact-badge--sink", state === "sink");
      badge.textContent = `${FOOT_LABELS[effector]} ${state === "float" ? "浮き" : "めり込み"}`;
      badge.style.display = "block";
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
