import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  IkSolver,
  IK_EFFECTORS,
  SPINE_EFFECTORS,
  POLE_JOINTS,
  getEffectorForPole,
  type IkEffector,
  type LimbEffector,
  type PoleJoint,
} from "./IkSolver";
import type { Character } from "../character/Character";
import type { SelectionController } from "./SelectionController";
import { filterPickable } from "./pickFilter";

const _tmpVec = new THREE.Vector3();

const HANDLE_RADIUS = 0.063; // 手首・足首の赤ハンドル(基準0.035の約1.8倍。掴みやすさ優先)
const HANDLE_COLOR = 0xff5577;
const HANDLE_ACTIVE_COLOR = 0xffaa33;
const HANDLE_PINNED_COLOR = 0x44dd88;
const POLE_RADIUS = 0.025;
const POLE_COLOR = 0x66aaff;
const POLE_ACTIVE_COLOR = 0xffaa33;
// ポールハンドルの見た目マーカー位置(ターゲット中心からのローカルオフセット、ターゲットは無回転なので
// ワールド方向として扱える)。実際のIK既定曲げ方向(IkSolver.BEND_HINTS、肘=後方下・膝=前方)とは別物として
// 独立させ、「ぱっとみ何のハンドルか分かりにくい」というユーザー指摘(2026-07-28)を受けて見た目だけを
// 直感的な位置(膝=真横、肘=真後ろ)に変更する。BEND_HINTS側は解剖学的に自然な曲げ方向として
// IKソルバー内部(ポールがほぼ一直線上の縮退ケースの既定値)に使われ続けるため変更しない。
// 膝は当初「外側+後方」の斜め45度で試したが、モデルより後ろに来て見えると指摘があり真横(X方向のみ)に
// 変更、距離も0.12→0.15へ広げた(2026-07-28)。
const POLE_MARKER_OFFSET: Record<PoleJoint, THREE.Vector3> = {
  leftElbow: new THREE.Vector3(0, 0, -0.12),
  rightElbow: new THREE.Vector3(0, 0, -0.12),
  leftKnee: new THREE.Vector3(0.15, 0, 0),
  rightKnee: new THREE.Vector3(-0.15, 0, 0),
};
// 胴体中心(胸・首・腰)は紫で統一し、四肢(赤)と視覚的に区別する。
const SPINE_COLOR = 0xaa66ff;
// 胴体中心ハンドル(胸・首・腰)はモデル背面(ワールド-Z=背中側)へ突出させ、
// 体内に埋もれず掴めるようにする。前面(+Z)が正面のため、-Zが背面。
const SPINE_BACK_OFFSET = new THREE.Vector3(0, 0, -0.22);
// キャラクター全体(root)を平行移動するハンドル。胴体中心(紫の菱形)と紛らわしいとの指摘(2026-07-28)を受け、
// 黄色・立方体形状にして区別する。つま先のすぐ前・地面レベル・キャラクター中心線(X=0)に置き、
// 脚メッシュと重ならず、かつ「キャラクター全体を動かすハンドル」だと見た目で分かるようにする。
const ROOT_HANDLE_SIZE = 0.08;
const ROOT_COLOR = 0xffdd22;
// つま先前面から前方0.11m(2026-07-28、実機確認後にユーザー指示で0.09m→0.11mへ2cm追加)。
const ROOT_LOCAL_OFFSET = new THREE.Vector3(0, 0.04, 0.34);
// 【VRM専用】character.root(=vrm.scene)は、毎フレームのvrm.update()が正規化ボーン
// (character.matrixRoot配下)基準でhipsのワールド位置をリターゲティングし直すため、ドラッグしても
// 次フレームで体そのものの位置は打ち消されてしまう(揺れもの(髪・胸)だけが物理慣性で反応するため、
// 黄ハンドルを動かすと髪や胸だけが揺れて体は動かないように見える。2026-07-28ユーザー報告により発覚)。
// そのためVRMでは体を実際に動かすハンドルをmatrixRoot側に別途用意する(見た目・配置はマネキンの
// 黄ハンドルと揃えるためROOT_COLOR/ROOT_HANDLE_SIZE/ROOT_LOCAL_OFFSETをそのまま流用)。役目を譲った
// 旧character.rootハンドル(揺れものだけに作用する副次効果)をVRM向けに頭上の白い球として残す案は、
// character.root基準のオフセットが体の実位置(matrixRoot)からズレる不具合が出たため保留とした
// (詳細はコンストラクタ内のコメント・§3参照)。

function isSpineEffector(effector: IkEffector): boolean {
  return (SPINE_EFFECTORS as string[]).includes(effector);
}

type HandleKind =
  | { type: "main"; effector: IkEffector }
  | { type: "pole"; poleJoint: PoleJoint }
  | { type: "rootPosition" }
  | { type: "matrixRootPosition" }
  | { type: "hipsPosition" };

interface HandleEntry {
  kind: HandleKind;
  targetNode: THREE.Object3D;
  mesh: THREE.Mesh;
  baseColor: number;
}

type DragListener = () => void;

/**
 * 手首・足首・肩・首のIKドラッグハンドルと、肘・膝のポール(曲がる向き)ハンドルを管理する。
 * ハンドル(見た目のメッシュ)はIkSolverが保持する共有ターゲットノードの子として配置する。
 * これによりPinController(ピン留め)と同じノードを動かすことになり、両者が競合しない。
 */
export class IkController {
  readonly ikSolver: IkSolver;
  private scene: THREE.Scene;
  private domElement: HTMLElement;
  private handles: HandleEntry[] = [];
  private meshToHandle = new Map<THREE.Mesh, HandleEntry>();
  private transformControls: TransformControls;
  private selection: SelectionController;
  private enabled = false;
  private attached: HandleEntry | null = null;
  private isDragging = false;
  private pinnedEffectors = new Set<LimbEffector>();
  private dragStartListeners: DragListener[] = [];
  private dragEndListeners: DragListener[] = [];
  private pointerDownPos = { x: 0, y: 0 };
  private suppressNextClick = false;
  private unsubscribeSelection: () => void;
  // ピン留め中も含め全ハンドルを強制的に隠す(作画資料用のクリーンなビュー要望、2026-07-28)。
  // IKモードのenabled(機能そのものの有効/無効)とは独立した、見た目のみのフラグ。
  private forceHidden = false;
  // ポールハンドルの中間関節(肘/膝)からのワールド空間オフセット。ドラッグで更新される。
  private poleOffsets = new Map<PoleJoint, THREE.Vector3>();

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    character: Character,
    selection: SelectionController,
    orbitControls: OrbitControls,
  ) {
    this.scene = scene;
    this.domElement = domElement;
    this.selection = selection;
    this.ikSolver = new IkSolver(character);

    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.setMode("translate");
    this.transformControls.setSize(0.7);
    scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener("dragging-changed", (event) => {
      orbitControls.enabled = !event.value;
      this.isDragging = Boolean(event.value);
      if (event.value) {
        for (const cb of this.dragStartListeners) cb();
      } else {
        for (const cb of this.dragEndListeners) cb();
      }
    });

    this.transformControls.addEventListener("objectChange", () => {
      if (!this.attached) return;
      const kind = this.attached.kind;
      if (kind.type === "main") {
        this.ikSolver.solve(kind.effector);
      } else if (kind.type === "pole") {
        // ポールを動かしたら対応する肢を解き直す(曲げ方向がポール位置から再計算される)
        this.ikSolver.solve(getEffectorForPole(kind.poleJoint));
      } else if (kind.type === "hipsPosition") {
        this.applyHipsFromTarget(character, this.attached.targetNode);
      } else if (kind.type === "matrixRootPosition") {
        // matrixRootは親を持たない独立ノードなのでworldToLocal変換は不要、そのまま代入できる。
        character.matrixRoot?.position.copy(this.attached.targetNode.position);
      }
      // ピン留め中の脚はPinControllerの毎フレーム更新で追従する
    });

    for (const effector of IK_EFFECTORS) {
      const target = this.ikSolver.getTargetNode(effector);
      if (!target) continue;
      // 胴体中心(胸・首)は紫、四肢は赤
      const baseColor = isSpineEffector(effector) ? SPINE_COLOR : HANDLE_COLOR;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(HANDLE_RADIUS),
        new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.85 }),
      );
      // 胸・首(紫)はボーン位置に埋もれるため背面(ワールド-Z)へ突出させて掴めるようにする。
      // targetNodeは回転を同期せず(位置のみ追従)常にワールド軸なので、この固定オフセット=ワールド背面。
      if (isSpineEffector(effector)) mesh.position.copy(SPINE_BACK_OFFSET);
      mesh.visible = false;
      target.add(mesh);
      scene.add(target);
      const entry: HandleEntry = { kind: { type: "main", effector }, targetNode: target, mesh, baseColor };
      this.handles.push(entry);
      this.meshToHandle.set(mesh, entry);
    }

    for (const poleJoint of POLE_JOINTS) {
      const target = this.ikSolver.getPoleTargetNode(poleJoint);
      if (!target) continue;
      // 既定オフセット = 曲げヒント方向へ0.25m。中間関節(肘/膝)を基準に配置する。
      const offset = this.ikSolver.getBendHint(poleJoint).clone().multiplyScalar(0.25);
      this.poleOffsets.set(poleJoint, offset);
      const refPos = this.ikSolver.getPoleReferencePosition(poleJoint, new THREE.Vector3());
      if (refPos) target.position.copy(refPos).add(offset);
      const mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(POLE_RADIUS),
        new THREE.MeshBasicMaterial({ color: POLE_COLOR, transparent: true, opacity: 0.85 }),
      );
      // マーカーの見た目位置は「中間関節から見てPOLE_MARKER_OFFSET方向」にしたいが、
      // 親のtarget自体が既にBEND_HINTS由来のoffset分だけ関節からずれているため、
      // ここでoffsetを打ち消してから望みの向きを足す(target基準のローカル位置なので減算で相殺できる)。
      mesh.position.copy(POLE_MARKER_OFFSET[poleJoint]).sub(offset);
      mesh.visible = false;
      target.add(mesh);
      scene.add(target);
      const entry: HandleEntry = { kind: { type: "pole", poleJoint }, targetNode: target, mesh, baseColor: POLE_COLOR };
      this.handles.push(entry);
      this.meshToHandle.set(mesh, entry);
    }

    // 腰(hips)を直接ドラッグするハンドル(紫、胸・首と同じ見た目)。IKチェーンを持たないため、
    // chest/neckのようにCCDで解くのではなく、ドラッグ位置をそのままbones.hipsのローカル位置へ
    // 書き戻す(旧実装のapplyHipsFromTarget相当)。一時「ルートハンドル(黄)と重複」として削除したが、
    // 足を床につけたまま腰だけを落とすしゃがみ操作等で単体ハンドルが必要というユーザー要望により復活(2026-07-28)。
    // VRMのhipsは正規化ボーン(シーン非接続)のため、chest/neck等と同じくシーン直下のプロキシ経由にする。
    {
      const bone = character.bones.hips;
      if (bone) {
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(HANDLE_RADIUS),
          new THREE.MeshBasicMaterial({ color: SPINE_COLOR, transparent: true, opacity: 0.85 }),
        );
        // 胸・首と同じく体内に埋もれないよう背面へ突出させる。
        mesh.position.copy(SPINE_BACK_OFFSET);
        mesh.visible = false;
        const target = new THREE.Object3D();
        target.add(mesh);
        scene.add(target);
        const entry: HandleEntry = { kind: { type: "hipsPosition" }, targetNode: target, mesh, baseColor: SPINE_COLOR };
        this.handles.push(entry);
        this.meshToHandle.set(mesh, entry);
      }
    }

    // キャラクター全体(root)を平行移動するハンドル(マネキン専用)。
    // マネキンはbones(hips以下)がroot配下の実ボーンなので、rootを動かせばそのまま体全体が動く。
    // 【VRMは非表示・保留】VRMはこれが成立せず(下記matrixRootハンドルのコメント参照)、体を動かす役目は
    // そちらへ譲っている。一時期このハンドルをVRM向けに「頭上の白い球」として残していたが、
    // character.root基準の固定オフセットを構築時に一度計算するだけで、以後は追従しない実装だったため、
    // matrixRootハンドルで体を動かすと基準点(character.root)と体の実位置(matrixRoot)がズレて
    // 置き去りになり、位置もズレるし揺れもの(髪・胸)への効果も分かりにくくなる不具合が発覚した
    // (2026-07-28)。作り直すには頭ボーンを毎フレーム追従するプロキシ方式(hipsハンドルと同様)が必要だが、
    // 揺れものへの効果自体「本来はバグだった一瞬のズレを物理演算が拾う」という副次的な挙動で
    // 修正の確実性が低く、スカート等の物理演算をポーズへ反映する話が出た際にまとめて再検討する方針で
    // ユーザーとも合意し、一旦生成自体を見送っている(保留タスク、§3参照)。
    if (character.matrixRoot === undefined) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(ROOT_HANDLE_SIZE, ROOT_HANDLE_SIZE, ROOT_HANDLE_SIZE),
        new THREE.MeshBasicMaterial({ color: ROOT_COLOR, transparent: true, opacity: 0.9 }),
      );
      mesh.position.copy(ROOT_LOCAL_OFFSET);
      mesh.visible = false;
      character.root.add(mesh);
      const entry: HandleEntry = {
        kind: { type: "rootPosition" },
        targetNode: character.root,
        mesh,
        baseColor: ROOT_COLOR,
      };
      this.handles.push(entry);
      this.meshToHandle.set(mesh, entry);
    }

    // 【VRM専用】キャラクター全体を実際に動かすハンドル(黄色、マネキンの黄ハンドルと同じ見た目・
    // 同じローカルオフセット=マネキンと同じ位置に配置)。character.matrixRoot
    // (vrm.humanoid.normalizedHumanBonesRoot)はシーン非接続の独立ノードのため、hipsハンドルと
    // 同じくシーン直下のプロキシ経由にする。
    if (character.matrixRoot) {
      const matrixRoot = character.matrixRoot;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(ROOT_HANDLE_SIZE, ROOT_HANDLE_SIZE, ROOT_HANDLE_SIZE),
        new THREE.MeshBasicMaterial({ color: ROOT_COLOR, transparent: true, opacity: 0.9 }),
      );
      mesh.position.copy(ROOT_LOCAL_OFFSET);
      mesh.visible = false;
      const target = new THREE.Object3D();
      target.position.copy(matrixRoot.position);
      target.add(mesh);
      scene.add(target);
      const entry: HandleEntry = { kind: { type: "matrixRootPosition" }, targetNode: target, mesh, baseColor: ROOT_COLOR };
      this.handles.push(entry);
      this.meshToHandle.set(mesh, entry);
    }

    // FK側でボーンが選択されたら、IKハンドルのアタッチを解除する(ギズモの二重表示を防ぐ)
    this.unsubscribeSelection = selection.onSelect((boneName) => {
      if (boneName && this.attached) {
        this.setHandleColor(this.attached, this.attached.baseColor);
        this.attached = null;
        this.transformControls.detach();
      }
    });

    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  onDragStart(cb: DragListener): void {
    this.dragStartListeners.push(cb);
  }

  onDragEnd(cb: DragListener): void {
    this.dragEndListeners.push(cb);
  }

  /**
   * ギズモ・ハンドルのドラッグに伴う余分なクリック判定を1回だけ無視する(他の選択系と同じ理由)。
   * ハンドルのアタッチはselection.select(null)を伴うため、抑制が漏れるとボーン選択が外れる。
   * 呼ぶのはドラッグ「開始」時であること(main.tsのsuppressNextRaycastAll参照)。
   */
  suppressNextRaycast(): void {
    this.suppressNextClick = true;
  }

  setLimitsEnabled(enabled: boolean): void {
    this.ikSolver.setLimitsEnabled(enabled);
  }

  get availableEffectors(): IkEffector[] {
    return this.handles.filter((h): h is HandleEntry & { kind: { type: "main"; effector: IkEffector } } => h.kind.type === "main").map((h) => h.kind.effector);
  }

  /** 現在TransformControlsがアタッチされているハンドルのターゲットノード(無ければnull)。座標表示UI用。 */
  get attachedTargetNode(): THREE.Object3D | null {
    return this.attached?.targetNode ?? null;
  }

  /** 輪郭線・選択インジケーターの検出対象から除外すべきオブジェクト一覧(ギズモ本体+各ハンドルメッシュ)。 */
  get outlineExcludedObjects(): THREE.Object3D[] {
    return [this.transformControls.getHelper(), ...this.handles.map((h) => h.mesh)];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateVisibility();
    if (!enabled) {
      this.detachCurrent();
    }
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * ピン留め状態を反映する(PinControllerから呼ばれる)。
   * ピン中はドラッグハンドルとして操作できないようにし、専用の色で常時表示する。
   */
  markPinned(effector: LimbEffector, pinned: boolean): void {
    const entry = this.findMainHandle(effector);
    if (!entry) return;
    if (pinned) {
      this.pinnedEffectors.add(effector);
      if (this.attached === entry) this.detachCurrent();
    } else {
      this.pinnedEffectors.delete(effector);
    }
    entry.baseColor = pinned ? HANDLE_PINNED_COLOR : HANDLE_COLOR;
    this.setHandleColor(entry, entry.baseColor);
    this.updateVisibility();
  }

  private findMainHandle(effector: IkEffector): HandleEntry | undefined {
    return this.handles.find((h) => h.kind.type === "main" && h.kind.effector === effector);
  }

  private detachCurrent(): void {
    if (this.attached) this.setHandleColor(this.attached, this.attached.baseColor);
    this.attached = null;
    this.transformControls.detach();
  }

  private updateVisibility(): void {
    for (const entry of this.handles) {
      const pinned = entry.kind.type === "main" && this.pinnedEffectors.has(entry.kind.effector as LimbEffector);
      entry.mesh.visible = !this.forceHidden && (this.enabled || pinned);
    }
  }

  /**
   * ピン留め中のハンドルも含め、全ハンドルを強制的に隠す/戻す。
   * 何もない場所のダブルクリックで作画資料用のクリーンなビューにする機能(main.ts)から呼ばれる。
   * enabled/pinnedEffectorsの状態そのものは変更しないため、解除すれば元の表示状態に戻る。
   */
  setHandlesHidden(hidden: boolean): void {
    this.forceHidden = hidden;
    if (hidden) this.detachCurrent();
    this.updateVisibility();
  }

  private attachHandle(entry: HandleEntry): void {
    if (entry.kind.type === "main" && this.pinnedEffectors.has(entry.kind.effector as LimbEffector)) return;
    this.selection.select(null);
    if (this.attached) this.setHandleColor(this.attached, this.attached.baseColor);
    this.attached = entry;
    const activeColor = entry.kind.type === "pole" ? POLE_ACTIVE_COLOR : HANDLE_ACTIVE_COLOR;
    this.setHandleColor(entry, activeColor);
    this.transformControls.attach(entry.targetNode);
  }

  private setHandleColor(entry: HandleEntry, color: number): void {
    (entry.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /**
   * hipsハンドル(シーン直下のプロキシ)のワールド位置を、character.bones.hipsのローカル位置へ書き戻す。
   * hipsはIKチェーンを持たないため、main(CCD)のsolve()に相当する処理をここで行う。
   * マネキンはhips.parent=root(黄ハンドルでオフセットされうる)、VRMはhips.parent=正規化階層のルート
   * (常に単位行列)とparentの変換が異なるため、worldToLocalで都度正しく変換する。
   */
  private applyHipsFromTarget(character: Character, targetNode: THREE.Object3D): void {
    const bone = character.bones.hips;
    if (!bone?.parent) return;
    (character.matrixRoot ?? character.root).updateMatrixWorld(true);
    _tmpVec.copy(targetNode.position);
    bone.parent.worldToLocal(_tmpVec);
    bone.position.copy(_tmpVec);
  }

  /** ハンドルの位置を対応する関節へ毎フレーム同期する(main.tsのtickから呼ぶ) */
  syncHandlePositions(character: Character): void {
    for (const entry of this.handles) {
      if (entry.kind.type === "main") {
        // 手首・足首・肩・首ハンドル: 対応ボーンの現在位置へ追従
        const effector = entry.kind.effector;
        if (this.pinnedEffectors.has(effector as LimbEffector)) continue; // ピン中はPinControllerが管理
        if (this.isDragging && this.attached === entry) continue;
        const bone = character.bones[effector];
        if (bone) bone.getWorldPosition(entry.targetNode.position);
      } else if (entry.kind.type === "pole") {
        // ポールハンドル: 中間関節(肘/膝)+保存オフセットに追従。ドラッグ中はオフセットを更新する。
        const poleJoint = entry.kind.poleJoint;
        const midPos = this.ikSolver.getPoleReferencePosition(poleJoint, _tmpVec);
        const offset = this.poleOffsets.get(poleJoint);
        if (!midPos || !offset) continue;
        if (this.isDragging && this.attached === entry) {
          offset.copy(entry.targetNode.position).sub(midPos);
        } else {
          entry.targetNode.position.copy(midPos).add(offset);
        }
      } else if (entry.kind.type === "hipsPosition") {
        // 腰ハンドル: bones.hipsの現在位置へ追従(ドラッグ中は書き戻し方向が逆になるためスキップ)
        if (this.isDragging && this.attached === entry) continue;
        const bone = character.bones.hips;
        if (bone) bone.getWorldPosition(entry.targetNode.position);
      } else if (entry.kind.type === "matrixRootPosition") {
        // matrixRootハンドル: character.matrixRootの現在位置へ追従(ドラッグ中は逆方向になるためスキップ)
        if (this.isDragging && this.attached === entry) continue;
        if (character.matrixRoot) entry.targetNode.position.copy(character.matrixRoot.position);
      }
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    // 抑制フラグの消費は他のどの判定よりも先に行う。enabled判定や距離判定を先に置くと、
    // 早期returnでフラグが立ったまま残り、その次の正当なクリックまで飲み込んでしまう。
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (!this.enabled) return;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 4) return;

    const rect = this.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.transformControls.camera);
    // 隠れているハンドルは掴めないようにする。three.jsのRaycasterはvisibleを見ないため、除外しないと
    // 「見えていないハンドルをクリックしてギズモだけが出る」状態になる(2026-08-03、ユーザー要望への対応。
    // 非表示モデル・クリーンビューのどちらでハンドルが隠れている場合も同じ扱いになる)。
    const meshes = filterPickable(this.handles.map((h) => h.mesh));
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const entry = this.meshToHandle.get(hits[0].object as THREE.Mesh);
      if (entry) this.attachHandle(entry);
    }
  };

  dispose(): void {
    this.unsubscribeSelection();
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    // 注: three.js r169のTransformControls.dispose()は内部でthis.traverse()を呼ぶが、
    // TransformControlsはObject3Dではなく(Controlsを継承)traverseを持たないため例外になる。
    // そのためdispose()は呼ばず、リスナー解除(disconnect)とヘルパーのGPUリソース解放を手動で行う。
    this.transformControls.detach();
    this.transformControls.disconnect();
    const helper = this.transformControls.getHelper();
    this.scene.remove(helper);
    helper.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    for (const entry of this.handles) {
      if (entry.kind.type === "rootPosition") {
        // rootPositionのtargetNodeはcharacter.root自体(キャラクターが所有するシーンオブジェクト)なので、
        // シーンからは取り除かない。マーカーメッシュのみ親から外してGPUリソースを解放する。
        entry.mesh.removeFromParent();
      } else {
        // それ以外のハンドルのターゲットノードはIkController自身がシーン直下に追加したものなので取り除く
        this.scene.remove(entry.targetNode);
      }
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
  }
}
