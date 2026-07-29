import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { JOINT_LIMITS, clampToLimit } from "../config/jointLimits";
import type { BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";
import type { SelectionController } from "./SelectionController";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const ZERO_EULER: EulerDeg = { x: 0, y: 0, z: 0 };

export interface EulerDeg {
  x: number;
  y: number;
  z: number;
}

type ChangeListener = (boneName: BoneName, euler: EulerDeg) => void;
type DragEndListener = () => void;

/**
 * TransformControls(回転モード)を選択中ボーンにアタッチし、可動域リミットを適用する。
 */
export class GizmoController {
  readonly transformControls: TransformControls;
  private character: Character;
  private limitsEnabled = true;
  private changeListeners: ChangeListener[] = [];
  private dragEndListeners: DragEndListener[] = [];
  private selection: SelectionController;
  private isDragging = false;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    character: Character,
    selection: SelectionController,
    orbitControls: OrbitControls,
  ) {
    this.character = character;
    this.selection = selection;

    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.setMode("rotate");
    this.transformControls.setSize(0.9);
    scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener("dragging-changed", (event) => {
      orbitControls.enabled = !event.value;
      this.isDragging = Boolean(event.value);
      if (!event.value) {
        this.selection.suppressNextRaycast();
        for (const cb of this.dragEndListeners) cb();
      }
    });

    this.transformControls.addEventListener("objectChange", () => {
      this.handleObjectChange();
    });

    selection.onSelect((boneName) => {
      const bone = boneName ? this.character.bones[boneName] : undefined;
      if (bone) {
        this.transformControls.attach(bone);
      } else {
        this.transformControls.detach();
      }
    });
  }

  /** 操作対象キャラクター(マネキン/VRM)を切り替える */
  setCharacter(character: Character): void {
    this.character = character;
    this.transformControls.detach();
  }

  onChange(cb: ChangeListener): void {
    this.changeListeners.push(cb);
  }

  onDragEnd(cb: DragEndListener): void {
    this.dragEndListeners.push(cb);
  }

  setLimitsEnabled(enabled: boolean): void {
    this.limitsEnabled = enabled;
  }

  getLimitsEnabled(): boolean {
    return this.limitsEnabled;
  }

  setGizmoSize(size: number): void {
    this.transformControls.setSize(size);
  }

  getEulerDeg(boneName: BoneName): EulerDeg {
    const bone = this.character.bones[boneName];
    if (!bone) return ZERO_EULER;
    return {
      x: bone.rotation.x * RAD2DEG,
      y: bone.rotation.y * RAD2DEG,
      z: bone.rotation.z * RAD2DEG,
    };
  }

  /** UIからの数値直接入力等、外部からの明示的な回転設定 */
  setEulerDeg(boneName: BoneName, euler: EulerDeg, notify = true): void {
    const bone = this.character.bones[boneName];
    if (!bone) return;
    const applied = this.limitsEnabled ? clampToLimit(euler, JOINT_LIMITS[boneName]) : euler;
    bone.rotation.set(applied.x * DEG2RAD, applied.y * DEG2RAD, applied.z * DEG2RAD, "XYZ");
    if (notify) {
      for (const cb of this.changeListeners) cb(boneName, applied);
    }
  }

  private handleObjectChange(): void {
    const boneName = this.selection.current;
    if (!boneName) return;
    const bone = this.character.bones[boneName];
    if (!bone) return;
    const currentDeg: EulerDeg = {
      x: bone.rotation.x * RAD2DEG,
      y: bone.rotation.y * RAD2DEG,
      z: bone.rotation.z * RAD2DEG,
    };
    if (this.limitsEnabled) {
      const clamped = clampToLimit(currentDeg, JOINT_LIMITS[boneName]);
      bone.rotation.set(clamped.x * DEG2RAD, clamped.y * DEG2RAD, clamped.z * DEG2RAD, "XYZ");
      for (const cb of this.changeListeners) cb(boneName, clamped);
    } else {
      for (const cb of this.changeListeners) cb(boneName, currentDeg);
    }
  }

  get dragging(): boolean {
    return this.isDragging;
  }
}
