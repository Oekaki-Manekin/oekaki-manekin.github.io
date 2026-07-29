import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PROP_DEFS, type PropDef, type PropGripOffset, type PropTypeId } from "../config/propDefs";
import type { BoneName, Side } from "../config/boneDefs";
import type { Character } from "../character/Character";
import type { PropInstanceData } from "./PoseSerializer";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DEFAULT_SPAWN_POSITION: [number, number, number] = [0.45, 0.9, 0];

export type GizmoMode = "translate" | "rotate" | "scale";

export interface PropInstance {
  readonly id: string;
  readonly typeId: PropTypeId;
  readonly object: THREE.Group;
  attachedTo: Side | null;
  /** 持たせている場合、対象キャラクターのスロットID(フェーズ6(B)・複数体配置用)。未接続時はnull。 */
  attachedCharacterId: string | null;
  /** カラーピッカーで指定した色(全パーツ一括、2026-07-27)。未指定ならnull=propDefsのパーツごとの既定色のまま。 */
  colorOverride: number | null;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _gripPos = new THREE.Vector3();
const _rawWorldQuat = new THREE.Quaternion();
const _normWorldQuat = new THREE.Quaternion();

function buildPropGroup(def: PropDef, colorOverride: number | null = null): THREE.Group {
  const group = new THREE.Group();
  group.name = `prop_${def.id}`;
  for (const part of def.parts) {
    // radialSegments(円周方向の分割数)が12だと、実線モードの輪郭線(曲率ベースのエッジ検出)が
    // 面同士の小さな折れまで拾ってしまい、特に銃等の細いパーツが密集する小物で黒くファセット状に
    // 見える不具合が出たため増やした(2026-07-28、マネキンの球体・カプセルと同種の問題、
    // 詳細はSceneManager.ts §5参照)。
    const geometry =
      part.kind === "box"
        ? new THREE.BoxGeometry(...part.size)
        : new THREE.CylinderGeometry(part.radius, part.radius, part.length, 20);
    const material = new THREE.MeshStandardMaterial({
      color: colorOverride ?? part.color,
      roughness: 0.6,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...part.offset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.scale.set(...def.defaultScale);
  return group;
}

/**
 * グリップ設定(左手基準)を手ボーンへのローカル変換として適用する。
 * 右手はPoseMirror.ts/FingerPoseApplier.tsと同じミラー規則(位置X反転、
 * クォータニオンのy,z成分反転)で左手基準の値から変換する。
 * correctionはfindAttachmentBone先(rawボーン)のローカル座標系が、grip値の前提となっている
 * 正規化ボーンの座標系とズレている場合の補正(computeBoneCorrection参照)。マネキンでは常に単位
 * クォータニオンになるため、位置・回転とも従来通りの値になる。
 */
function applyGrip(group: THREE.Group, side: Side, grip: PropGripOffset, correction: THREE.Quaternion): void {
  _euler.set(grip.rotationDeg[0] * DEG2RAD, grip.rotationDeg[1] * DEG2RAD, grip.rotationDeg[2] * DEG2RAD, "XYZ");
  _quat.setFromEuler(_euler);
  if (side === "left") {
    _gripPos.set(grip.position[0], grip.position[1], grip.position[2]);
  } else {
    _quat.set(_quat.x, -_quat.y, -_quat.z, _quat.w);
    _gripPos.set(-grip.position[0], grip.position[1], grip.position[2]);
  }
  group.position.copy(_gripPos).applyQuaternion(correction);
  group.quaternion.copy(correction).multiply(_quat);
}

/**
 * 指定ボーンに対応する「実際にシーンへ接続されているノード」を取得する。
 * マネキンはcharacter.bones自体が実ボーンだが、VRMの正規化ボーンはシーンから
 * 独立しているため(PHASE4-HANDOFF§5)、クリック用マーカーの親(=rawボーン)を経由する。
 * マネキン・VRMどちらもpickableMeshesの各要素にuserData.boneNameが設定されている
 * (MannequinBuilder/VrmLoader)ため、Character interfaceを拡張せずに取得できる。
 */
function findAttachmentBone(character: Character, boneName: BoneName): THREE.Object3D | undefined {
  const marker = character.pickableMeshes.find((m) => m.userData.boneName === boneName);
  return marker?.parent ?? undefined;
}

/**
 * 【2026-07-24】VRMの手に持たせた小物の前後が逆になる不具合の修正。
 * propDefs.tsのgrip値は「正規化ボーン(character.bones)基準のローカル座標系」を前提に
 * 実機調整されているが、実際に小物をaddするfindAttachmentBone()の戻り値(rawボーン、モデル
 * 作者がリギングした元のボーン)のローカル座標系は、正規化ボーンとは向きが一致するとは限らない
 * (マネキンはbones自体がrawボーンなので常に一致=補正なしになる)。
 * この差分はモデルのレストポーズに由来し、ポーズ操作に関わらず一定になる
 * (three-vrmのVRMHumanoidRig.update()は、正規化ボーンのローカル回転の変化分だけを
 * レストポーズ時点のrawボーン回転に上乗せする実装のため、両者のワールド回転の比はポーズで変化しない)。
 * そのため呼び出しのたびに現在のワールド回転から計算しても、結果はモデル固有の固定値になる。
 */
function computeBoneCorrection(character: Character, boneName: BoneName, rawBone: THREE.Object3D): THREE.Quaternion {
  const normalizedBone = character.bones[boneName];
  if (!normalizedBone || normalizedBone === rawBone) return new THREE.Quaternion();
  rawBone.updateWorldMatrix(true, false);
  normalizedBone.updateWorldMatrix(true, false);
  rawBone.getWorldQuaternion(_rawWorldQuat);
  normalizedBone.getWorldQuaternion(_normWorldQuat);
  return _rawWorldQuat.invert().multiply(_normWorldQuat).clone();
}

function isDescendantOf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

/**
 * 小物(プロップ)の配置・選択・削除・手への着脱・自由配置ギズモを管理する。
 * GizmoController/LightDragControllerと同様、TransformControlsは常設(r169では
 * dispose()が例外を投げるため、生成し直さず使い回す)。
 *
 * 3Dビュー上のクリック選択も本クラスで完結させる(SelectionControllerと同じ
 * pointerdown/pointerup距離判定パターン)。ボーンのpickableMeshesと小物のメッシュは
 * 完全に別集合なので、双方が同じdomElementへ独立にクリック判定を行っても competing にはならず、
 * 「小物をクリック→ボーン側は空振りで選択解除、小物側は命中で選択」が自然に成立する。
 */
export class PropController {
  readonly transformControls: TransformControls;
  private instances: PropInstance[] = [];
  private selectedId: string | null = null;
  private nextSeq = 1;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private suppressNextClick = false;
  private changeListeners: (() => void)[] = [];

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    private scene: THREE.Scene,
    orbitControls: OrbitControls,
  ) {
    this.camera = camera;
    this.domElement = domElement;

    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.setMode("translate");
    this.transformControls.setSize(0.9);
    scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener("dragging-changed", (event) => {
      orbitControls.enabled = !event.value;
      // 自身のギズモ操作終了直後、そのままクリックとして再解釈され選択が暴れるのを防ぐ
      if (!event.value) this.suppressNextClick = true;
    });

    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  /** 選択状態が変化した(3Dクリック経由も含む)ときに呼ばれる。UI側のパネル再描画などに使う。 */
  onChange(cb: () => void): void {
    this.changeListeners.push(cb);
  }

  /** 他のTransformControls操作直後の余分なクリック判定を1回だけ無視する(SelectionControllerと同じ理由)。 */
  suppressNextRaycast(): void {
    this.suppressNextClick = true;
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
    const hits = this.raycaster.intersectObjects(
      this.instances.map((i) => i.object),
      true,
    );
    const hitInstance = hits.length > 0 ? this.findInstanceForHit(hits[0].object) : undefined;
    this.select(hitInstance?.id ?? null);
    for (const cb of this.changeListeners) cb();
  };

  private findInstanceForHit(hitObject: THREE.Object3D): PropInstance | undefined {
    return this.instances.find((i) => i.object === hitObject || isDescendantOf(hitObject, i.object));
  }

  list(): readonly PropInstance[] {
    return this.instances;
  }

  get selected(): PropInstance | null {
    return this.instances.find((i) => i.id === this.selectedId) ?? null;
  }

  /** 現在TransformControlsがアタッチされているプロップのオブジェクト(無ければnull)。座標表示UI用。 */
  get attachedObject(): THREE.Object3D | null {
    return this.transformControls.object ?? null;
  }

  setGizmoMode(mode: GizmoMode): void {
    this.transformControls.setMode(mode);
  }

  getGizmoMode(): GizmoMode {
    return this.transformControls.getMode();
  }

  add(typeId: PropTypeId): PropInstance {
    const def = PROP_DEFS[typeId];
    const object = buildPropGroup(def);
    object.position.set(...DEFAULT_SPAWN_POSITION);
    this.scene.add(object);
    const instance: PropInstance = {
      id: `prop_${Date.now()}_${this.nextSeq++}`,
      typeId,
      object,
      attachedTo: null,
      attachedCharacterId: null,
      colorOverride: null,
    };
    this.instances.push(instance);
    this.select(instance.id);
    return instance;
  }

  /** 選択中の小物の全パーツの色を一括変更する(標準カラーピッカー用、2026-07-27ユーザー要望)。 */
  setColor(id: string, hex: number): void {
    const instance = this.instances.find((i) => i.id === id);
    if (!instance) return;
    instance.colorOverride = hex;
    instance.object.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(hex);
    });
  }

  remove(id: string): void {
    const idx = this.instances.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const instance = this.instances[idx];
    if (this.selectedId === id) this.select(null);
    instance.object.parent?.remove(instance.object);
    instance.object.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
    this.instances.splice(idx, 1);
  }

  select(id: string | null): void {
    this.selectedId = id;
    const instance = id ? this.instances.find((i) => i.id === id) : undefined;
    if (instance && !instance.attachedTo) {
      this.transformControls.attach(instance.object);
    } else {
      this.transformControls.detach();
    }
  }

  /**
   * 選択中インスタンスを指定キャラクターの指定の手に持たせる(既に接続されているノードへ実際に親子付けする)。
   * characterIdは呼び出し側(main.ts)が管理するキャラクタースロットIDで、serialize/restoreが
   * 「どのキャラクターに持たせていたか」を複数体配置環境でも正しく区別するために保持する。
   */
  attach(id: string, side: Side, character: Character, characterId: string): void {
    const instance = this.instances.find((i) => i.id === id);
    if (!instance) return;
    const boneName: BoneName = side === "left" ? "leftHand" : "rightHand";
    const handBone = findAttachmentBone(character, boneName);
    if (!handBone) return;
    if (this.selectedId === id) this.transformControls.detach();
    const correction = computeBoneCorrection(character, boneName, handBone);
    handBone.add(instance.object);
    applyGrip(instance.object, side, PROP_DEFS[instance.typeId].grip, correction);
    instance.attachedTo = side;
    instance.attachedCharacterId = characterId;
  }

  /** 手から外し、ワールド変換を保ったままシーン直下の自由配置へ戻す。 */
  detach(id: string): void {
    const instance = this.instances.find((i) => i.id === id);
    if (!instance || !instance.attachedTo) return;
    this.scene.attach(instance.object);
    instance.attachedTo = null;
    instance.attachedCharacterId = null;
    if (this.selectedId === id) this.transformControls.attach(instance.object);
  }

  /** 指定キャラクターに現在持たせている全プロップを外す(VRM差し替えでdisposeする前の安全策)。 */
  detachAllFrom(character: Character): void {
    for (const instance of this.instances) {
      if (instance.attachedTo && isDescendantOf(instance.object, character.root)) {
        this.detach(instance.id);
      }
    }
  }

  serialize(): PropInstanceData[] {
    return this.instances.map((instance) => {
      const euler = new THREE.Euler().setFromQuaternion(instance.object.quaternion, "XYZ");
      return {
        instanceId: instance.id,
        typeId: instance.typeId,
        attachedTo: instance.attachedTo,
        attachedCharacterId: instance.attachedCharacterId,
        position: [instance.object.position.x, instance.object.position.y, instance.object.position.z],
        rotationDeg: [euler.x * RAD2DEG, euler.y * RAD2DEG, euler.z * RAD2DEG],
        scale: [instance.object.scale.x, instance.object.scale.y, instance.object.scale.z],
        colorOverride: instance.colorOverride,
      };
    });
  }

  /**
   * 保存データから復元する。既存のインスタンスはすべて破棄してから復元する。
   * characterSlotsは現在シーンに存在するキャラクター(id, character)の一覧。各propの
   * attachedCharacterIdが指すスロットが現存すればそこへ、無ければfallbackSlotIdのキャラクターへ持たせる
   * (Undo/Redoでスロットが削除された後に巻き戻された場合等のフォールバック)。
   */
  restore(
    data: PropInstanceData[],
    characterSlots: readonly { id: string; character: Character }[],
    fallbackSlotId: string,
  ): void {
    // remove()は選択中インスタンスの巻き戻し時にselectedIdをnullへ戻してしまうため、
    // 巻き戻し前の選択IDを退避しておき、再構築後の再同期(末尾のselect呼び出し)に使う。
    const previousSelectedId = this.selectedId;
    for (const instance of [...this.instances]) this.remove(instance.id);
    for (const d of data) {
      const def = PROP_DEFS[d.typeId];
      if (!def) continue;
      const colorOverride = d.colorOverride ?? null;
      const object = buildPropGroup(def, colorOverride);
      object.scale.set(...d.scale);
      const instance: PropInstance = {
        id: d.instanceId,
        typeId: d.typeId,
        object,
        attachedTo: null,
        attachedCharacterId: null,
        colorOverride,
      };
      this.instances.push(instance);
      if (d.attachedTo) {
        const targetSlotId =
          d.attachedCharacterId && characterSlots.some((s) => s.id === d.attachedCharacterId)
            ? d.attachedCharacterId
            : fallbackSlotId;
        const target = characterSlots.find((s) => s.id === targetSlotId);
        if (target) this.attach(d.instanceId, d.attachedTo, target.character, target.id);
      }
      if (!instance.attachedTo) {
        // 持たせる指定だったが対象の手ボーンが見つからなかった場合のフォールバックも含め、
        // 自由配置として保存時の位置に置く(objectが未接続=シーンから消えたままになるのを防ぐ)。
        object.position.set(...d.position);
        object.rotation.set(d.rotationDeg[0] * DEG2RAD, d.rotationDeg[1] * DEG2RAD, d.rotationDeg[2] * DEG2RAD, "XYZ");
        this.scene.add(object);
      }
    }
    this.nextSeq = this.instances.length + 1;
    // removeによる巻き戻しでtransformControlsがdetachされたままなので、選択中IDが
    // 復元データにも残っていれば(id体系は保存時のまま引き継ぐため)ギズモの装着状態を再同期する。
    this.select(previousSelectedId);
  }

  /**
   * 保存されたポーズファイル(1キャラクター分)の小物データで、指定キャラクターが持っている
   * 小物だけを差し替える。他キャラクターに持たせている小物・自由配置の小物には触れない
   * (restore()は全キャラ分を丸ごと置き換えるUndo/Redo専用、こちらは単一キャラのポーズ読込専用)。
   */
  restoreForCharacter(data: PropInstanceData[], character: Character, characterId: string): void {
    const previousSelectedId = this.selectedId;
    const toRemove = this.instances.filter((i) => i.attachedCharacterId === characterId);
    for (const instance of toRemove) this.remove(instance.id);
    for (const d of data) {
      const def = PROP_DEFS[d.typeId];
      if (!def) continue;
      const colorOverride = d.colorOverride ?? null;
      const object = buildPropGroup(def, colorOverride);
      object.scale.set(...d.scale);
      const instance: PropInstance = {
        id: d.instanceId,
        typeId: d.typeId,
        object,
        attachedTo: null,
        attachedCharacterId: null,
        colorOverride,
      };
      this.instances.push(instance);
      if (d.attachedTo) {
        this.attach(d.instanceId, d.attachedTo, character, characterId);
      } else {
        object.position.set(...d.position);
        object.rotation.set(d.rotationDeg[0] * DEG2RAD, d.rotationDeg[1] * DEG2RAD, d.rotationDeg[2] * DEG2RAD, "XYZ");
        this.scene.add(object);
      }
    }
    this.nextSeq = this.instances.length + 1;
    this.select(previousSelectedId);
  }
}
