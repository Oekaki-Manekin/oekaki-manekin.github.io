import * as THREE from "three";

/**
 * カメラの目線の高さ(アイレベル)を示す水平線のオーバーレイ。
 * 3Dシーンではなくビューポート上のHTML要素として実装している(CanvasFrameOverlayと同じ考え方)。
 *
 * 原理: カメラの正面方向(水平成分)にカメラ位置から進んだ点を取り、その点のYをカメラの高さに
 * 揃えてスクリーン座標へ投影する。OrbitControls駆動のカメラはロール(前後軸まわりの傾き)が
 * 発生しないため、この点のスクリーンY座標が画面全幅にわたる水平線(=アイレベル)の高さになる。
 * 【重要】点はカメラの視線方向に対して奥行き(depth)を持たせる必要がある
 * (=カメラ位置そのものを基準にカメラの左右方向だけへ点をずらす実装だと、その点の視線方向の
 * 奥行きがちょうど0になり、透視投影のw成分が0になってInfinity/NaNが出る不具合になった)。
 * 真上/真下を見ている場合はカメラの正面方向の水平成分が0になり、アイレベル自体が数学的に
 * 定義できない(無限遠)ため、その間は線を隠す。
 */
export class EyeLevelLine {
  readonly element: HTMLElement;
  private container: HTMLElement;
  private visible = false;
  private tmpForward = new THREE.Vector3();
  private tmpPoint = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement("div");
    this.element.className = "eye-level-line";
    this.element.style.display = "none";
    container.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * 毎フレーム呼び出し、現在のカメラに合わせて線のスクリーンY座標を更新する。
   * updateMatrixWorld()を明示的に呼ぶのは、呼び出し元のtickループではOrbitControls.update()直後・
   * SceneManager.renderNow()(matrixWorld更新を伴う)より前にこのメソッドが実行されるため、
   * 呼ばなければ1フレーム古いカメラ変換で投影してしまう(カメラプリセット等で瞬時にジャンプした際に
   * 古い位置のまま一瞬ズレて表示される不具合になる)ため。
   */
  update(camera: THREE.PerspectiveCamera): void {
    if (!this.visible) return;
    const ch = this.container.clientHeight;
    if (ch === 0) return;

    camera.updateMatrixWorld();
    camera.getWorldDirection(this.tmpForward);

    const horizLenSq = this.tmpForward.x * this.tmpForward.x + this.tmpForward.z * this.tmpForward.z;
    if (horizLenSq < 1e-6) {
      // 真上/真下視点ではアイレベルが定義できないため隠す(表示チェックボックスの状態は変えない)
      this.element.style.visibility = "hidden";
      return;
    }
    this.element.style.visibility = "visible";

    this.tmpPoint.copy(camera.position).addScaledVector(this.tmpForward, 1);
    this.tmpPoint.y = camera.position.y;
    this.tmpPoint.project(camera);

    const screenY = ((1 - this.tmpPoint.y) / 2) * ch;
    this.element.style.top = `${screenY}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
