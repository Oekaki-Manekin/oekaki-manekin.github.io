import * as THREE from "three";

/**
 * TransformControls(矢印ギズモ)がオブジェクトにアタッチされている間、そのワールド座標を
 * ビューポート上に表示するオーバーレイ。IKハンドル(紫=腰・胸・首、赤=手首・足首・肩、
 * 黄=キャラクター全体、青=ポール)・小物(プロップ)のギズモなど、対象を問わず使い回せるよう
 * 対象ノードはupdate()の引数として渡す(呼び出し側がどのTransformControlsを見るか決める)。
 * 3Dシーンではなくビューポート上のHTML要素として実装している(GroundContactIndicatorと同じ考え方)。
 */
export class GizmoCoordinateLabel {
  readonly element: HTMLElement;
  private container: HTMLElement;
  private tmpVec = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement("div");
    this.element.className = "gizmo-coord-label";
    this.element.style.display = "none";
    container.appendChild(this.element);
  }

  /** 毎フレーム呼び出し、targetがあれば座標を更新表示、無ければ隠す。 */
  update(target: THREE.Object3D | null, camera: THREE.PerspectiveCamera): void {
    if (!target) {
      this.element.style.display = "none";
      return;
    }
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return;

    camera.updateMatrixWorld();
    target.getWorldPosition(this.tmpVec);
    const worldX = this.tmpVec.x;
    const worldY = this.tmpVec.y;
    const worldZ = this.tmpVec.z;

    this.tmpVec.project(camera);
    this.element.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * cw}px`;
    this.element.style.top = `${(1 - (this.tmpVec.y * 0.5 + 0.5)) * ch}px`;
    this.element.textContent = `X: ${worldX.toFixed(2)}  Y: ${worldY.toFixed(2)}  Z: ${worldZ.toFixed(2)}`;
    this.element.style.display = "block";
  }

  dispose(): void {
    this.element.remove();
  }
}
