import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type ChangeListener = (azimuthDeg: number, elevationDeg: number) => void;

/**
 * 光源のドラッグハンドル(紫球)を3Dビュー上で直接つかんでドラッグし、
 * ライト方向(方位・高さ)を操作するコントローラー。
 * ボーン回転(GizmoController)やIKハンドルのようにTransformControls(矢印付きギズモ)を
 * 経由せず、ハンドル自体をレイキャストで直接ドラッグする(three.jsのDragControls相当の方式)。
 * ドラッグ中はポインタ位置から原点中心・半径一定の球面上の最近接点を求め、方位角・高さへ変換する。
 */
export class LightDragController {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragging = false;
  private listeners: ChangeListener[] = [];

  constructor(
    private camera: THREE.Camera,
    private domElement: HTMLElement,
    private handle: THREE.Object3D,
    private orbitControls: OrbitControls,
  ) {
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  onChange(cb: ChangeListener): void {
    this.listeners.push(cb);
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.handle.visible) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.handle, false);
    if (hits.length === 0) return;
    this.dragging = true;
    this.orbitControls.enabled = false;
    this.domElement.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const dir = this.closestSphereDirection();
    const elevationDeg = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(dir.y)), 0, 90);
    let azimuthDeg = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
    if (azimuthDeg < 0) azimuthDeg += 360;
    for (const cb of this.listeners) cb(azimuthDeg, elevationDeg);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.orbitControls.enabled = true;
    this.domElement.releasePointerCapture(e.pointerId);
  };

  // 原点中心の単位球面上で、現在のレイに最も近い点の方向を返す。
  // 交差判定(レイが球面を実際に貫くか)ではなく最近接点を使うことで、
  // ハンドルの見た目のシルエットの外側までドラッグしても方向が連続的に追従する。
  private closestSphereDirection(): THREE.Vector3 {
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    const t = Math.max(0, -origin.dot(direction));
    const closest = origin.clone().addScaledVector(direction, t);
    if (closest.lengthSq() < 1e-8) closest.set(0, 1, 0);
    return closest.normalize();
  }

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
  }
}
