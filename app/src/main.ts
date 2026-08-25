import type * as THREE from "three";
import { SceneManager } from "./scene/SceneManager";
import { CAMERA_PRESETS } from "./scene/cameraPresets";
import { applyShadingMode, applyShadingModeToObjects, getBodyMeshes, type ShadingMode } from "./scene/DisplayModeMaterials";
import { buildMannequin, type Mannequin } from "./mannequin/MannequinBuilder";
import { SelectionController } from "./posing/SelectionController";
import { GizmoController } from "./posing/GizmoController";
import { LightDragController } from "./scene/LightDragController";
import { PropController } from "./posing/PropController";
import { CrossCharacterSelector } from "./posing/CrossCharacterSelector";
import { EmptySpaceClickController } from "./posing/EmptySpaceClickController";
import { applyBodyShape } from "./mannequin/BodyShapeApplier";
import { DEFAULT_BODY_SHAPE, BASE_PRESETS, type BodyShapeParams } from "./config/bodyShapeDefs";
import { HistoryManager } from "./posing/HistoryManager";
import { mirrorPose } from "./posing/PoseMirror";
import { resetAll, resetSubtree } from "./posing/PoseReset";
import {
  capturePose,
  applyPose,
  createPoseFile,
  migratePoseFile,
  type PoseData,
  type PropInstanceData,
} from "./posing/PoseSerializer";
import { applyPosePartial, boneSetForParts, type PosePart } from "./posing/PoseBlend";
import { downloadTextFile, openTextFile, openBinaryFile } from "./io/platform";
import { exportViewportPNG, exportMultiAnglePNG, type ExportCropRect } from "./io/pngExporter";
import { renderPoseThumbnail } from "./io/thumbnailRenderer";
import { POSE_LIBRARY_FORMAT_VERSION, type PoseLibraryFile } from "./io/poseLibraryStorage";
import { addSavedCamera, removeSavedCamera, type SavedCameraView } from "./io/savedCameraStorage";
import {
  AUTOSAVE_KEY,
  autosaveIsFailing,
  loadAutosave,
  saveAutosave,
  startAutosaveLoop,
  type AutosaveCamera,
} from "./io/autosave";
import { PanelUI, type PanelCallbacks, type CharacterKind } from "./ui/PanelUI";
import { CanvasFrameOverlay } from "./ui/CanvasFrameOverlay";
import { EyeLevelLine } from "./ui/EyeLevelLine";
import { GroundContactIndicator } from "./ui/GroundContactIndicator";
import { GizmoCoordinateLabel } from "./ui/GizmoCoordinateLabel";
import { ShortcutHelp } from "./ui/ShortcutHelp";
import { showConfirmDialog } from "./ui/ConfirmDialog";
import { isModalOpen } from "./ui/modalState";
import { showToast } from "./ui/Toast";
import { BONE_NAMES, type BoneName } from "./config/boneDefs";
import type { Character } from "./character/Character";
import { loadVrmCharacter, type VrmCharacter } from "./vrm/VrmLoader";
import { IkController } from "./posing/IkController";
import { PinController } from "./posing/PinController";
import { GazeController } from "./posing/GazeController";
import { LIMB_EFFECTORS } from "./posing/IkSolver";
import { applyFingerPreset, captureFingerPose } from "./posing/FingerPoseApplier";
import { ALL_FINGER_SUFFIXES } from "./config/fingerPresets";
import { addCustomFingerPreset, removeCustomFingerPreset } from "./io/fingerPresetStorage";

/** localStorageの容量超過で保存できなかったときの案内(明示的なユーザー操作の保存で使う)。 */
const STORAGE_FULL_MESSAGE =
  "保存領域が一杯のため保存できませんでした。ポーズライブラリなどから不要なデータを削除してください。";

async function main(): Promise<void> {
  const app = document.getElementById("app")!;

  const viewport = document.createElement("div");
  viewport.className = "viewport";
  app.appendChild(viewport);

  const sceneManager = new SceneManager(viewport);
  const canvasFrame = new CanvasFrameOverlay(viewport);
  const eyeLevelLine = new EyeLevelLine(viewport);
  const groundContactIndicator = new GroundContactIndicator(viewport);
  const ikCoordLabel = new GizmoCoordinateLabel(viewport);
  // --- 複数体配置(フェーズ6・(B)) ---
  // 内部はN体対応の配列(characterSlots)として実装し、UI側だけMAX_CHARACTER_SLOTSで上限を設ける
  // (開発指示書では「2体まで」だったが、事前相談の結果、内部実装はN体対応・UI上限のみ4体とした)。
  // slot-1(起動時に生成される最初のマネキン)はオートセーブの対象であり続けるため削除不可とする。
  const MAX_CHARACTER_SLOTS = 4;
  const CHARACTER_SLOT_SPACING = 1.2;
  const INITIAL_SLOT_ID = "slot-1";

  interface CharacterSlot {
    readonly id: string;
    readonly character: Character;
    readonly kind: CharacterKind;
    readonly removable: boolean;
    bodyShape: BodyShapeParams;
  }

  const initialMannequin = buildMannequin();
  sceneManager.scene.add(initialMannequin.root);

  const characterSlots: CharacterSlot[] = [
    { id: INITIAL_SLOT_ID, character: initialMannequin, kind: "mannequin", removable: false, bodyShape: DEFAULT_BODY_SHAPE },
  ];
  let activeSlotId: string = INITIAL_SLOT_ID;
  let nextSlotSeq = 2;

  function getSlot(id: string): CharacterSlot {
    const slot = characterSlots.find((s) => s.id === id);
    if (!slot) throw new Error(`未知のキャラクタースロットID: ${id}`);
    return slot;
  }
  function getActiveSlot(): CharacterSlot {
    return getSlot(activeSlotId);
  }
  function vrmSlotCharacters(): VrmCharacter[] {
    return characterSlots.filter((s) => s.kind === "vrm").map((s) => s.character as VrmCharacter);
  }

  // 新規追加スロットのルートを、既存キャラと重ならないようX軸上に振り分けて配置する
  // (0: 原点のまま, 1: +1.2, 2: -1.2, 3: +2.4 ...)。最初のスロット(index 0)は原点のまま動かさない。
  function applySpawnPosition(character: Character, slotIndex: number): void {
    if (slotIndex === 0) return;
    const magnitude = Math.ceil(slotIndex / 2) * CHARACTER_SLOT_SPACING;
    character.root.position.x = slotIndex % 2 === 1 ? magnitude : -magnitude;
  }

  let activeCharacter: Character = initialMannequin;
  // 作画資料用のクリーンなビュー機能(2026-07-28)で、コントローラー・ギズモを強制的に隠しているか。
  let controlsHidden = false;

  // 何もない場所のダブルクリックでコントローラー・ギズモを一切隠す(作画資料用、2026-07-28ユーザー要望)。
  // 判定対象は全キャラクター(アクティブ/非アクティブ問わず)+全小物。
  //
  // 【重要・生成位置】他のクリック判定(SelectionController / PropController /
  // CrossCharacterSelector / IkController)より必ず"先に"生成すること。同一要素のpointerupリスナーは
  // 登録順に走るため、ここが後ろだとクリーンビューの解除がそのクリックの選択判定より遅れる。
  // VRMのボーン選択マーカーはクリーンビュー中 visible=false で、pickFilter()によりクリック対象から
  // 外れている。解除が遅れると、VRMの関節をクリックしても解除だけ起きて選択は空振りし、
  // 「マネキンを一度クリックして解除してからでないとVRMを操作できない」状態になっていた
  // (2026-08-18、ユーザー報告)。マネキンはpickableMeshes自体が体本体メッシュで隠されないため
  // 同じ問題が起きず、VRMだけで症状が出ていた。
  const emptySpaceClickController = new EmptySpaceClickController(
    sceneManager.renderer.domElement,
    sceneManager.camera,
    {
      // propControllerはこの下で生成されるが、これらのgetterは実際のクリック時にしか呼ばれない。
      getCharacters: () => characterSlots.map((s) => s.character),
      getPropObjects: () => propController.list().map((i) => i.object),
    },
    () => controlsHidden,
  );

  const selection = new SelectionController(sceneManager.renderer.domElement, sceneManager.camera, activeCharacter);
  const gizmo = new GizmoController(
    sceneManager.camera,
    sceneManager.renderer.domElement,
    sceneManager.scene,
    activeCharacter,
    selection,
    sceneManager.orbitControls,
  );
  const lightDrag = new LightDragController(
    sceneManager.camera,
    sceneManager.renderer.domElement,
    sceneManager.lightHandle,
    sceneManager.orbitControls,
  );
  const propController = new PropController(
    sceneManager.camera,
    sceneManager.renderer.domElement,
    sceneManager.scene,
    sceneManager.orbitControls,
  );
  // ギズモ(TransformControlsの矢印)の細いジオメトリが輪郭線・選択インジケーターの深度エッジ検出に
  // 誤って引っかからないよう除外登録する(2026-07-27、ユーザー指摘)。IkControllerはキャラ切替の
  // たびに作り直すため、rebuildIkAndPin()内で個別に登録・解除する。
  sceneManager.addOutlineExcludedObject(gizmo.transformControls.getHelper(), propController.transformControls.getHelper());
  // 同じくPNG書き出し時に一時的に隠す対象としても登録する(2026-08-03、ユーザー要望:
  // 書き出したPNGにギズモ・コントローラーがそのまま写り込み作画資料として扱いづらい)。
  sceneManager.addControllerObject(gizmo.transformControls.getHelper(), propController.transformControls.getHelper());
  // 複数体配置時、非アクティブなキャラの体をビュー上でクリックしたら「切替(+ボーンクリックなら選択も)」を行う
  // (2026-07-24、ユーザー要望。2026-07-28、体本体メッシュもクリック対象に拡張)。対象は非アクティブな
  // キャラのpickableMeshes+体本体メッシュのみなので、アクティブキャラのボーン選択(selection)・
  // 小物選択(propController)とは競合しない。
  const crossCharacterSelector = new CrossCharacterSelector(
    sceneManager.renderer.domElement,
    sceneManager.camera,
    () => characterSlots,
    () => activeSlotId,
  );
  const propCoordLabel = new GizmoCoordinateLabel(viewport);
  // 小物パネルの再描画に加え、表示モード(トゥーン調等)・輪郭線対象への追従もここでまとめて行う。
  // add/select/delete/attach/detach/restore等、小物の状態が変わる箇所は必ずこれを呼ぶ運用にする。
  const syncProps = (): void => {
    panel.refreshProps(propController.list(), propController.selected?.id ?? null, propController.getGizmoMode());
    applyShadingModeToObjects(
      propController.list().map((i) => i.object),
      shadingMode,
    );
    // 複数体配置では全キャラクターが同時に見えているため、輪郭線対象もアクティブ機体だけでなく全機体を含める
    sceneManager.setOutlineTarget([
      ...characterSlots.map((s) => s.character.root),
      ...propController.list().map((i) => i.object),
    ]);
  };
  // 持たせ状態の小物が選択された際、自由配置できない理由をトーストで案内する(パネル内テキストは小さく分かりづらいため)。
  const notifyIfAttachedPropSelected = (id: string | null): void => {
    if (!id) return;
    const instance = propController.list().find((i) => i.id === id);
    if (instance?.attachedTo) {
      showToast("手に持たせているため自由配置ができません。「外す」を選択後に自由配置できます。");
    }
  };

  interface CharacterPoseSnapshot {
    slotId: string;
    kind: CharacterKind;
    pose: PoseData;
    bodyShape: BodyShapeParams;
  }
  interface PoseSnapshot {
    characters: CharacterPoseSnapshot[];
    props: PropInstanceData[];
  }
  // 体型パラメータの反映+状態変数+パネル表示をまとめて同期する(コールバック・Undo/Redo・
  // 自動保存復元・ポーズ読込のどこから呼んでも同じ経路を通るようにするため)。体型はキャラクター
  // スロットごとに独立して保持する(複数マネキンがそれぞれ別の体型を持てるようにするため)。
  const applyBodyShapeParams = (slot: CharacterSlot, params: BodyShapeParams): void => {
    slot.bodyShape = params;
    if (slot.kind === "mannequin") applyBodyShape(slot.character as Mannequin, params);
    if (slot.id === activeSlotId) panel.setBodyShapeDisplay(params);
  };
  // Undo/Redoは複数体配置に伴い「シーン全体」を対象にする(全スロットのポーズ・体型+グローバルな
  // 小物配置)。キャラクターの追加・削除自体はVRM読込と同様Undo対象外とし、記録時に存在したスロットが
  // 巻き戻し時に既に削除されていた場合はそのスロット分だけスキップする。
  const history = new HistoryManager<PoseSnapshot>(
    () => ({
      characters: characterSlots.map((s) => ({
        slotId: s.id,
        kind: s.kind,
        pose: capturePose(s.character.bones),
        bodyShape: s.bodyShape,
      })),
      props: propController.serialize(),
    }),
    (snap) => {
      for (const cs of snap.characters) {
        const slot = characterSlots.find((s) => s.id === cs.slotId);
        if (!slot) continue;
        // 記録時と現在のキャラクター種別が異なる場合(切り替え跨ぎのUndo)はhips位置を転写しない
        applyPose(slot.character.bones, cs.pose, { applyHipsPosition: cs.kind === slot.kind });
        slot.bodyShape = cs.bodyShape;
        if (slot.kind === "mannequin") applyBodyShape(slot.character as Mannequin, cs.bodyShape);
      }
      propController.restore(
        snap.props,
        characterSlots.map((s) => ({ id: s.id, character: s.character })),
        activeSlotId,
      );
      if (getActiveSlot().kind === "mannequin") panel.setBodyShapeDisplay(getActiveSlot().bodyShape);
      syncProps();
      refreshInspectorFromSelection();
    },
  );

  let ikController!: IkController;
  let pinController!: PinController;
  const gazeController = new GazeController();
  let gazeEnabled = false;
  // 瞳のみカメラに追従させる(首・頭は動かさない)独立トグル。2026-08-17、ユーザー要望により
  // 既存のgazeEnabled(頭+瞳)から分離して追加。詳細はapplyGazeState()参照。
  let eyeGazeEnabled = false;
  // 追従OFFにした瞬間の瞳の角度(yaw/pitch)をVRMキャラクターごとに記憶しておく。
  // vrm.update()は毎フレーム「humanoid.update()(正規化→生ボーンの反映、瞳を含む全ボーンが
  // 正規化側の値=無回転へ書き戻される)→lookAt.update()(targetがあれば瞳へ回転を上書き)」の順で
  // 走るため、targetをnullにしただけだとlookAt側が何もしなくなり、次フレームからhumanoidの書き戻しが
  // そのまま残って瞳が正面へ戻って見えてしまう(2026-08-17、ユーザー報告)。追従OFFの間は毎フレーム
  // ここに記憶した角度をlookAt.applier.applyYawPitch()で再適用し、humanoidの書き戻しを上書きし続けることで
  // 角度を保持する。WeakMapなのでVRMキャラクターが破棄されれば自動的に参照も消える。
  const frozenGazeAngles = new WeakMap<VrmCharacter, { yaw: number; pitch: number }>();
  let shadingMode: ShadingMode = "normal";
  // シルエット表示中の小物色変更で「効かない」と誤解されないための案内。1度だけ出す。
  let silhouetteColorNoticeShown = false;

  /**
   * ギズモ・ハンドルのドラッグに伴うpointerupがクリックとして再解釈され、選択が暴れるのを防ぐ。
   * 抑制対象を1箇所にまとめ、ドラッグ元ごとの書き忘れを防ぐ
   * (pickFilter.tsが「visibleという1つの事実だけを見る」形にしてあるのと同じ理由)。
   * クリック判定系を追加した場合は必ずここへも足すこと。
   *
   * 【呼ぶタイミング】必ずドラッグ「開始」時(TransformControlsのdragging-changedがtrueのとき)に呼ぶ。
   * dragging-changedはpointerdown/pointerupの最中に発火するが、同じイベントに登録された
   * リスナーの実行順は登録順で決まるため、終了時に立てても既に処理を終えたクリック判定には
   * 間に合わない。開始時=pointerdownに立てておけば、続くpointerupでは全系統が確実に抑制される。
   * また各クリック判定側はフラグの消費を距離判定より先に行うこと(大きくドラッグしたときに
   * 早期returnでフラグが残り、次の正当なクリックを飲み込むのを防ぐため)。
   */
  function suppressNextRaycastAll(): void {
    selection.suppressNextRaycast();
    propController.suppressNextRaycast();
    crossCharacterSelector.suppressNextRaycast();
    ikController?.suppressNextRaycast();
  }

  function rebuildIkAndPin(character: Character): void {
    if (ikController) {
      sceneManager.removeOutlineExcludedObject(...ikController.outlineExcludedObjects);
      sceneManager.removeControllerObject(...ikController.outlineExcludedObjects);
    }
    ikController?.dispose();
    ikController = new IkController(
      sceneManager.camera,
      sceneManager.renderer.domElement,
      sceneManager.scene,
      character,
      selection,
      sceneManager.orbitControls,
    );
    ikController.setLimitsEnabled(gizmo.getLimitsEnabled());
    ikController.onDragStart(() => history.beginChange());
    // IKハンドル(特に手首)は小物を持たせた手・隣のキャラの近くに来ることが多く、ドラッグに伴う
    // クリック誤判定で小物選択やボーン選択が外れたり、キャラが切り替わったりするのを防ぐ。
    // 抑制はドラッグ開始時に全系統へまとめて立てる(suppressNextRaycastAllのコメント参照)。
    ikController.onDragStart(() => suppressNextRaycastAll());
    ikController.onDragEnd(() => panel.updateUndoRedoButtons(history.canUndo(), history.canRedo()));
    pinController = new PinController(ikController);
    sceneManager.addOutlineExcludedObject(...ikController.outlineExcludedObjects);
    sceneManager.addControllerObject(...ikController.outlineExcludedObjects);
    panel.setAvailableIkChains(new Set(ikController.availableEffectors));
    // デフォルトでIKモードを有効にする(2026-07-24、ユーザー要望によりFKからIKへデフォルト変更)。
    ikController.setEnabled(true);
    panel.setIkModeEnabled(true);
    for (const effector of LIMB_EFFECTORS) panel.setPinned(effector, false);
  }

  // コントローラー・ギズモ類を隠す要因は2つあり、どちらか一方でも「隠す」なら隠す。
  //   (a) 作画資料用のクリーンなビュー(controlsHidden、何もない場所のダブルクリック、2026-07-28)
  //   (b) 操作対象モデル自身の非表示(モデル欄のチェックボックス、2026-08-03)
  // 要因ごとに個別へ書き込むと片方だけ更新して食い違うため、状態は必ずこの関数で毎回再計算する
  // (PHASE6-HANDOFF-5.md §5「状態リセットは専用関数を経由させ、追跡変数への直接代入を避ける」)。
  //
  // 隠す対象はIKハンドル(ピン留め中も含む)と、FKギズモ・ボーン選択・ハイライト
  // (selection.select(null)と同じ経路。GizmoControllerのselection.onSelect購読により連動する)。
  // VRMのボーン選択用マーカー(青い球、指を含む全関節)はIkController/GizmoControllerとは独立した
  // 常時表示のメッシュ(VrmLoader.ts)で、選択中/非選択・アクティブ/非アクティブを問わず全スロット分
  // 存在するため別途切り替える。非表示スロットのマーカーはroot.visible=falseで既に見えていないので、
  // ここで見るのはクリーンビューだけでよい。
  // マネキンはpickableMeshes自体が体本体メッシュなので対象外(隠すとモデル自体が消えてしまう)。
  function refreshControlsVisibility(): void {
    const hideActiveControls = controlsHidden || !activeCharacter.root.visible;
    ikController.setHandlesHidden(hideActiveControls);
    if (hideActiveControls) selection.select(null);
    for (const slot of characterSlots) {
      if (slot.kind !== "vrm") continue;
      for (const mesh of slot.character.pickableMeshes) mesh.visible = !controlsHidden;
    }
  }

  function setControlsHidden(hidden: boolean): void {
    controlsHidden = hidden;
    refreshControlsVisibility();
  }

  // カメラ目線: GazeControllerで頭ボーンをカメラへ向ける(マネキン・VRM共通、アクティブなスロットのみ、
  // gazeEnabled)。VRMの目のボーンはvrm.lookAtで別途追従させる(頭とは独立した仕組み)。
  // 「頭は固定したまま瞳だけカメラを追わせたい」という要望(2026-08-17)に対応するため、
  // 目の追従はgazeEnabledとeyeGazeEnabledのどちらか一方でも有効なら追従する形にしてある
  // (両方OFFなら目も固定、gazeEnabledのみなら従来通り頭+目、eyeGazeEnabledのみなら瞳だけ)。
  // 複数体配置では非アクティブなVRMのlookAtは常にnullへ戻す(視線はポージング対象のみに適用する編集補助のため)。
  function applyGazeState(): void {
    gazeController.setEnabled(gazeEnabled);
    for (const slot of characterSlots) {
      if (slot.kind !== "vrm") continue;
      const vrmChar = slot.character as VrmCharacter;
      if (!vrmChar.vrm.lookAt) continue;
      const eyesFollow = (gazeEnabled || eyeGazeEnabled) && slot.id === activeSlotId;
      vrmChar.vrm.lookAt.target = eyesFollow ? sceneManager.camera : null;
    }
  }

  // VRMのSpringBone(揺れもの)・normalized→raw骨格反映はvrm.update()で毎フレーム行う(全VRMスロット分)
  sceneManager.addTick((dt) => {
    for (const vrmChar of vrmSlotCharacters()) {
      vrmChar.vrm.update(dt);
      const lookAt = vrmChar.vrm.lookAt;
      if (!lookAt) continue;
      if (lookAt.target) {
        // 追従中: 現在の角度を随時記憶しておく(追従OFFになった瞬間の角度が保持対象になる)
        frozenGazeAngles.set(vrmChar, { yaw: lookAt.yaw, pitch: lookAt.pitch });
      } else {
        // 追従OFF: 記憶した角度を毎フレーム再適用し、vrm.update()内のhumanoid.update()による
        // 正面への書き戻しを上書きし続ける(frozenGazeAnglesの宣言部のコメント参照)
        const frozen = frozenGazeAngles.get(vrmChar);
        if (frozen) lookAt.applier.applyYawPitch(frozen.yaw, frozen.pitch);
      }
    }
    ikController.syncHandlePositions(activeCharacter);
    pinController.update();
    gazeController.update(activeCharacter, sceneManager.camera, gizmo.getLimitsEnabled());
    eyeLevelLine.update(sceneManager.camera);
    groundContactIndicator.update(activeCharacter, sceneManager.camera);
    ikCoordLabel.update(ikController.attachedTargetNode, sceneManager.camera);
    propCoordLabel.update(propController.attachedObject, sceneManager.camera);
  });

  const shortcutHelp = new ShortcutHelp();
  document.body.appendChild(shortcutHelp.element);

  function refreshInspectorFromSelection(): void {
    const name = selection.current;
    panel.setSelectedBone(name, name ? gizmo.getEulerDeg(name) : null);
  }

  function getAvailableBoneSet(character: Character): Set<BoneName> {
    return new Set(BONE_NAMES.filter((n) => character.bones[n] !== undefined));
  }

  function getCharacterYRotationDeg(character: Character): number {
    return (character.root.rotation.y * 180) / Math.PI;
  }

  // ポーズファイル保存・オートセーブは単一キャラクター分の形式のため、指定スロットに持たせている
  // 小物と自由配置の小物だけに絞る(他キャラクターに持たせている小物は含めない)。
  function propsForSlot(slotId: string): PropInstanceData[] {
    return propController.serialize().filter((p) => p.attachedCharacterId === slotId || p.attachedCharacterId == null);
  }

  // --- 全身フィット(2026-08-03、ユーザー要望: 起動直後・3面図書き出しで頭と足が切れる) ---
  // 収める対象は「表示中のキャラクター本体+そのキャラに持たせている小物」(ユーザー判断)。
  // 自由配置の小物は対象外: 壁(2.0×2.2m)・階段(1.0×1.0×1.4m)のような大型オブジェクトや、
  // 遠くへ動かした小物に引きずられて人体が極端に小さく写ってしまうため。
  // 非表示のキャラクターは「いない扱い」の方針どおり構図の判断材料からも外す。
  function framingTargets(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    const visibleSlotIds = new Set<string>();
    for (const slot of characterSlots) {
      if (!slot.character.root.visible) continue;
      visibleSlotIds.add(slot.id);
      objects.push(...getBodyMeshes(slot.character));
    }
    for (const instance of propController.list()) {
      if (instance.attachedCharacterId && visibleSlotIds.has(instance.attachedCharacterId)) {
        objects.push(instance.object);
      }
    }
    return objects;
  }

  // 多角度書き出し専用: 表示中の全キャラクターではなく「選択されているモデル」だけを対象にする
  // (2026-08-03、ユーザー報告: モデルを原点から大きく動かした状態で3面図を書き出すと見切れる)。
  // 原因は視点プリセット(cameraPresets.ts)の注視点が常に原点付近の固定値だったこと。モデルが
  // そこから離れるほど、frameObjects()で距離を引いても構図の中心からモデルがずれていき、
  // 最終的に見切れる。このターゲット集合のバウンディングボックス中心を新しい注視点として使う
  // ことで、モデルの実際の位置にカメラを追従させる(SceneManager.applyCameraPresetのpivot引数)。
  function activeCharacterFramingTargets(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [...getBodyMeshes(activeCharacter)];
    for (const instance of propController.list()) {
      if (instance.attachedCharacterId === activeSlotId) objects.push(instance.object);
    }
    return objects;
  }

  // 「キャンバス枠内だけを書き出す」がONのとき、画像に残るのは枠の内側だけなので、フィットの判定
  // 範囲も同じ割合まで縮めないと枠で見切れる(枠は常に中央揃え、CanvasFrameOverlay.getRect参照)。
  function framingViewportFraction(cropRect: ExportCropRect | null): { x: number; y: number } | undefined {
    if (!cropRect) return undefined;
    const canvas = sceneManager.renderer.domElement;
    if (canvas.width === 0 || canvas.height === 0) return undefined;
    return { x: cropRect.width / canvas.width, y: cropRect.height / canvas.height };
  }

  // --- 書き出しの排他制御 ---
  // 書き出し処理は「コントローラーを隠す→描画→戻す」「カメラを動かす→戻す」のように
  // 一時的に状態を変えて元へ戻す。2本同時に走ると2本目が「すでに変更後の状態」を本来の状態として
  // 退避してしまい、コントローラーがリロードするまで表示されない・作業中の構図が失われる、という
  // 壊れ方をする(2026-08-18検出)。多角度書き出しは4〜5方向×250msで1.2〜1.5秒かかるうえ、
  // 確認ダイアログの二度押しから自然に2本走る動線があった。
  // SceneManager側にもネスト対応の防御を入れてあるが、本命はここでの排他化。
  let isExporting = false;
  async function runExclusiveExport(task: () => Promise<void>): Promise<void> {
    if (isExporting) return; // 2本目は黙って捨てる
    isExporting = true;
    panel.setExportButtonsEnabled(false);
    try {
      await task();
    } catch (err) {
      showToast(`書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isExporting = false;
      panel.setExportButtonsEnabled(true);
    }
  }

  function refreshCharacterListUI(): void {
    panel.refreshCharacterList(
      characterSlots.map((s) => ({ id: s.id, kind: s.kind, removable: s.removable, visible: s.character.root.visible })),
      activeSlotId,
      characterSlots.length < MAX_CHARACTER_SLOTS,
    );
  }

  // 操作対象スロットの切り替え本体。ポーズはスロットごとに独立させるため(マネキン⇔VRMの表現切替と
  // 違い、複数体配置では各体が別々のポーズを保持する)、旧アクティブキャラのポーズをコピーしない。
  // 全スロットは常にvisible(手動の表示切替のみ)なので、visible切り替えもここでは行わない。
  function activateSlot(slot: CharacterSlot): void {
    activeSlotId = slot.id;
    activeCharacter = slot.character;
    selection.setCharacter(activeCharacter);
    gizmo.setCharacter(activeCharacter);
    rebuildIkAndPin(activeCharacter);
    // rebuildIkAndPinで作られる新しいIkControllerは常に「隠していない」状態(forceHidden=false)
    // から始まるが、他の(非アクティブな)VRMスロットのボーン選択マーカーは前回のクリーンビュー状態を
    // 保持したままなので、setControlsHidden(false)経由でそちらもまとめて復元する。
    setControlsHidden(false);
    applyGazeState();
    syncProps();
    panel.setAvailableBones(slot.kind === "vrm" ? getAvailableBoneSet(activeCharacter) : null);
    // 体型パラメータはマネキン専用(VRMはモデル側の仕様のため対象外、開発指示書フェーズ6(C)参照)
    panel.setBodyShapeControlsEnabled(slot.kind === "mannequin");
    if (slot.kind === "mannequin") panel.setBodyShapeDisplay(slot.bodyShape);
    panel.setCharacterRotationDisplay(getCharacterYRotationDeg(activeCharacter));
    refreshCharacterListUI();
    refreshInspectorFromSelection();
  }

  function setActiveSlot(id: string): void {
    if (id === activeSlotId) return;
    activateSlot(getSlot(id));
  }

  function addMannequinSlot(): void {
    if (characterSlots.length >= MAX_CHARACTER_SLOTS) {
      showToast(`キャラクターは最大${MAX_CHARACTER_SLOTS}体までです。`);
      return;
    }
    const character = buildMannequin();
    applySpawnPosition(character, characterSlots.length);
    sceneManager.scene.add(character.root);
    applyShadingMode(character, shadingMode);
    const id = `slot-${nextSlotSeq++}`;
    characterSlots.push({ id, character, kind: "mannequin", removable: true, bodyShape: DEFAULT_BODY_SHAPE });
    setActiveSlot(id);
  }

  // 読み込み中(パース完了前)のVRMの数。上限判定で「これから増える分」として数に含める。
  // 判定とcharacterSlots.pushの間にawaitがあるため、これが無いと大きいVRMを続けて読み込んだときに
  // 2つ目が同じ判定を通過してMAX_CHARACTER_SLOTSを超え、しかも同じ位置に重なって出現する
  // (2026-08-18検出。パースが長いほど窓が広がるため、巨大VRMほど踏みやすい)。
  let pendingVrmLoads = 0;

  async function addVrmSlot(buffer: ArrayBuffer, filename: string): Promise<void> {
    if (characterSlots.length + pendingVrmLoads >= MAX_CHARACTER_SLOTS) {
      showToast(`キャラクターは最大${MAX_CHARACTER_SLOTS}体までです。`);
      return;
    }
    pendingVrmLoads++;
    // 巨大なVRM(60MB程度は珍しくない)はパースの間タブが無反応になるため、読み込み中であることを
    // 表示し、追加操作自体も受け付けないようにする(無反応の間の再操作が上記の重複追加を誘発する)。
    panel.setCharacterAddBusy(true);
    showToast(`VRMを読み込み中です…: ${filename}`);
    try {
      let loaded: VrmCharacter;
      try {
        loaded = await loadVrmCharacter(buffer);
      } catch (err) {
        showToast(`VRMの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      // 位置の決定はpushの直前に行う(await後にcharacterSlots.lengthを読むため、予約カウンタと
      // 併せて逐次的に正しいindexになる)。
      applySpawnPosition(loaded, characterSlots.length);
      sceneManager.scene.add(loaded.root);
      applyShadingMode(loaded, shadingMode);
      const id = `slot-${nextSlotSeq++}`;
      characterSlots.push({ id, character: loaded, kind: "vrm", removable: true, bodyShape: DEFAULT_BODY_SHAPE });
      const versionLabel = loaded.vrm.meta?.metaVersion === "0" ? "VRM 0.x" : loaded.vrm.meta?.metaVersion === "1" ? "VRM 1.0" : null;
      showToast(`VRMを追加しました: ${filename}${versionLabel ? ` (${versionLabel})` : ""}`);
      setActiveSlot(id);
    } finally {
      pendingVrmLoads--;
      if (pendingVrmLoads === 0) panel.setCharacterAddBusy(false);
    }
  }

  function removeCharacterSlot(id: string): void {
    const slot = characterSlots.find((s) => s.id === id);
    if (!slot || !slot.removable) return;
    // 持たせたままdisposeすると小物のメッシュごとVRMUtils.deepDisposeに巻き込まれて破棄されるため、
    // 先にシーン直下へ外しておく(表示モードを戻してからdisposeするのと同じ考え方)。
    propController.detachAllFrom(slot.character);
    sceneManager.scene.remove(slot.character.root);
    slot.character.dispose();
    characterSlots.splice(characterSlots.indexOf(slot), 1);
    if (activeSlotId === id) {
      activateSlot(characterSlots[0]);
    } else {
      syncProps();
      refreshCharacterListUI();
    }
  }

  function setCharacterVisibility(id: string, visible: boolean): void {
    const slot = getSlot(id);
    slot.character.root.visible = visible;
    // 非表示にしたモデルは「いない扱い」に統一する(2026-08-03、ユーザー要望)。クリック判定側は
    // pickFilter.tsのfilterPickable()がroot.visibleを見て自動的に除外するが、IKハンドル等は
    // scene直下にあり(IkController)root.visibleの影響を受けないため、ここで明示的に隠す。
    refreshControlsVisibility();
    refreshCharacterListUI();
  }

  function setCharacterYRotationDeg(deg: number): void {
    activeCharacter.root.rotation.y = (deg * Math.PI) / 180;
  }

  const callbacks: PanelCallbacks = {
    onSelectBone(name: BoneName) {
      selection.select(name);
    },
    onBeginEdit() {
      history.beginChange();
    },
    onEulerChange(name, euler) {
      gizmo.setEulerDeg(name, euler);
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onMirror() {
      history.beginChange();
      mirrorPose(activeCharacter.bones);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onResetAll() {
      history.beginChange();
      // 腰の位置もポーズの一部として初期位置へ戻す(restHipsPositionの意味はCharacter.ts参照)。
      resetAll(activeCharacter.bones, activeCharacter.restHipsPosition);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onResetSelected() {
      if (!selection.current) return;
      history.beginChange();
      resetSubtree(activeCharacter.bones, selection.current, activeCharacter.restHipsPosition);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onUndo() {
      history.undo();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onRedo() {
      history.redo();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onLimitsToggle(enabled) {
      gizmo.setLimitsEnabled(enabled);
      ikController.setLimitsEnabled(enabled);
    },
    onGizmoSizeChange(size) {
      gizmo.setGizmoSize(size);
    },
    onGridToggle(visible) {
      sceneManager.setGridVisible(visible);
    },
    onOutlineToggle(enabled) {
      sceneManager.setOutlineEnabled(enabled);
    },
    onOutlineModeToggle(solid) {
      sceneManager.setOutlineMode(solid ? "solid" : "fade");
    },
    onOutlineStrengthChange(strength) {
      sceneManager.setOutlineStrength(strength);
    },
    onBackgroundColorChange(hexString) {
      sceneManager.setBackgroundColor(parseInt(hexString.slice(1), 16));
    },
    onEyeLevelToggle(enabled) {
      eyeLevelLine.setVisible(enabled);
    },
    onGroundContactToggle(enabled) {
      groundContactIndicator.setVisible(enabled);
    },
    onLightDirectionChange(azimuthDeg, elevationDeg) {
      sceneManager.setLightDirection(azimuthDeg, elevationDeg);
    },
    onLightMarkerToggle(enabled) {
      sceneManager.setLightMarkerVisible(enabled);
    },
    onShadowToggle(enabled) {
      sceneManager.setShadowEnabled(enabled);
    },
    onShadingModeChange(mode) {
      shadingMode = mode;
      // 複数体配置では全キャラクターが同時に見えているため、表示モードは全スロットへ適用する
      for (const slot of characterSlots) applyShadingMode(slot.character, mode);
      syncProps();
      sceneManager.setGrayscaleEnabled(mode === "grayscale");
      sceneManager.setToonLightingEnabled(mode === "toon");
    },
    onCanvasFrameToggle(visible) {
      canvasFrame.setVisible(visible);
    },
    onCanvasFramePresetChange(id) {
      canvasFrame.setPreset(id);
    },
    onCanvasFrameSwapToggle(swapped) {
      canvasFrame.setSwapped(swapped);
    },
    onCanvasFrameCustomRatioChange(width, height) {
      canvasFrame.setCustomRatio(width, height);
    },
    onCameraPreset(id) {
      const preset = CAMERA_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      sceneManager.applyCameraPreset(preset);
      // 全身が収まる距離まで自動で引く(2026-08-03、ユーザー要望)。プリセットの注視点・向きは
      // 保たれるため、アオリ・俯瞰の構図の意図は変わらない。画面で見ている構図と多角度書き出しの
      // 結果を一致させる意味もある(書き出し側も同じframeObjects()を通す)。
      sceneManager.frameObjects(framingTargets());
    },
    onFocalLengthChange(mm) {
      sceneManager.setFocalLength(mm);
      panel.setFocalLengthDisplay(mm);
    },
    onSavePose() {
      const file = createPoseFile(activeCharacter.bones, propsForSlot(activeSlotId), getActiveSlot().bodyShape);
      downloadTextFile(`pose_${Date.now()}.json`, JSON.stringify(file, null, 2));
    },
    async onLoadPose() {
      const opened = await openTextFile(".json,application/json");
      if (!opened) return;
      try {
        const parsed = migratePoseFile(JSON.parse(opened.text));
        history.beginChange();
        applyPose(activeCharacter.bones, parsed.pose, {
          applyHipsPosition: activeCharacter.kind === "mannequin",
        });
        // restoreForCharacter: 他キャラクターに持たせている小物・自由配置の小物には触れず、
        // アクティブなキャラクターが持っている小物だけを読込データで差し替える。
        propController.restoreForCharacter(parsed.props ?? [], activeCharacter, activeSlotId);
        applyBodyShapeParams(getActiveSlot(), parsed.bodyShape ?? DEFAULT_BODY_SHAPE);
        syncProps();
        refreshInspectorFromSelection();
        panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
      } catch (err) {
        showToast(`ポーズファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onExportPNG(transparent, cropToFrame) {
      void runExclusiveExport(() => {
        const cropRect = cropToFrame ? canvasFrame.getExportPixelRect(sceneManager.renderer.domElement) : null;
        return exportViewportPNG(sceneManager, transparent, cropRect);
      });
    },
    onExportMultiAnglePNG(transparent, cropToFrame, includeTop) {
      void runExclusiveExport(async () => {
        // 非表示のモデルは「いない扱い」の方針どおり、構図の判断材料にも書き出し対象にもしない。
        // ここで止めないと、見えていないモデルにカメラをフィットさせて白紙のPNGを4〜5枚
        // ダウンロードすることになる(2026-08-18修正)。
        if (!activeCharacter.root.visible) {
          showToast("選択中のモデルが非表示です。表示してから書き出してください。");
          return;
        }
        // 各方向で全身が収まる位置までカメラを動かしてから書き出す(2026-08-03、ユーザー要望)。
        // 書き出し中にカメラが動くことを明示し、了承を得てから実行する(キャンセルなら書き出さない)。
        // 書き出し後は従来通り元の構図へ戻すため、作業中の構図は失われない。
        const proceed = await showConfirmDialog("カメラを全身が映る位置へ移動します。よろしいですか？");
        if (!proceed) return;
        const cropRect = cropToFrame ? canvasFrame.getExportPixelRect(sceneManager.renderer.domElement) : null;
        const viewportFraction = framingViewportFraction(cropRect);
        // 「選択されているモデルを中心に」書き出す(2026-08-03、ユーザー要望)。対象は表示中の
        // 全キャラクターではなく選択中のモデルのみに絞る(activeCharacterFramingTargets参照)。
        // 注視点(バウンディングボックス中心)・全方向で揃えるカメラ距離はexportMultiAnglePNG側で
        // 算出する(2026-08-03、ユーザー報告: 前後と左右で書き出し画像のモデルの大きさが揃わない)。
        const targets = activeCharacterFramingTargets();
        await exportMultiAnglePNG(sceneManager, transparent, cropRect, includeTop, targets, { viewportFraction });
      });
    },
    onSaveCameraView(name) {
      // 明示的なユーザー操作の保存は、失敗したら必ず理由を伝える(黙って一覧に出ないのを防ぐ)。
      if (!addSavedCamera({ name, ...sceneManager.getCameraState() })) {
        showToast(STORAGE_FULL_MESSAGE);
        return;
      }
      panel.refreshSavedCameras();
    },
    onApplyCameraView(view: SavedCameraView) {
      sceneManager.applyCameraState(view);
      panel.setFocalLengthDisplay(view.focalLength);
    },
    onDeleteCameraView(id) {
      removeSavedCamera(id);
      panel.refreshSavedCameras();
    },
    onShowHelp() {
      shortcutHelp.toggle();
    },
    async onOpenVrmFile() {
      const opened = await openBinaryFile(".vrm");
      if (!opened.ok) {
        // キャンセルは無言でよいが、読み込み失敗(破損・ロック・ディスクエラー等)は理由を伝える。
        // パース失敗はaddVrmSlot側でトーストが出るのに、読み込み失敗だけ無言だった。
        if (opened.reason === "readError") showToast("ファイルを読み込めませんでした。破損しているか、他のアプリで開かれている可能性があります。");
        return;
      }
      await addVrmSlot(opened.file.buffer, opened.file.name);
    },
    // --- 複数体配置(フェーズ6・(B)) ---
    onSelectCharacterSlot(id) {
      setActiveSlot(id);
    },
    onAddMannequin() {
      addMannequinSlot();
    },
    onRemoveCharacterSlot(id) {
      removeCharacterSlot(id);
    },
    onToggleCharacterVisibility(id, visible) {
      setCharacterVisibility(id, visible);
    },
    onCharacterRotationChange(deg) {
      // 向きスライダーはヘッドカウントスライダーと同じ「focus後最初のinputでonBeginEditを
      // 一度だけ呼ぶ」パターンをPanelUI側で行っているため、ここではhistory.beginChange()を呼ばない。
      setCharacterYRotationDeg(deg);
    },
    // --- 体型(フェーズ6・(C)、マネキンのみ対象) ---
    onHeadCountChange(value) {
      // スライダーのドラッグ開始はJointInspector.tsと同じ「focus後最初のinputでonBeginEditを
      // 一度だけ呼ぶ」パターンをPanelUI側で行っているため、ここではhistory.beginChange()を呼ばない。
      const slot = getActiveSlot();
      applyBodyShapeParams(slot, { ...slot.bodyShape, headCount: value });
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onBodyBuildChange(build) {
      history.beginChange();
      const slot = getActiveSlot();
      applyBodyShapeParams(slot, { ...slot.bodyShape, build });
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onBodyBaseChange(base) {
      history.beginChange();
      const slot = getActiveSlot();
      const preset = BASE_PRESETS[base];
      applyBodyShapeParams(slot, { headCount: preset.headCount, build: preset.build, base });
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onToggleIkMode(enabled) {
      ikController.setEnabled(enabled);
      panel.setIkModeEnabled(enabled);
    },
    onTogglePin(effector, pinned) {
      pinController.setPinned(effector, pinned, activeCharacter);
    },
    onToggleGaze(enabled) {
      gazeEnabled = enabled;
      applyGazeState();
    },
    onToggleEyeGaze(enabled) {
      eyeGazeEnabled = enabled;
      applyGazeState();
    },
    onApplyPreset(side, preset) {
      history.beginChange();
      applyFingerPreset(gizmo, side, preset);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onSaveCustomPreset(side, label) {
      const rotations = captureFingerPose(gizmo, side, ALL_FINGER_SUFFIXES);
      if (!addCustomFingerPreset({ id: `custom_${Date.now()}`, label, rotations })) {
        showToast(STORAGE_FULL_MESSAGE);
        return;
      }
      panel.refreshFingerPresets();
    },
    onDeleteCustomPreset(id) {
      removeCustomFingerPreset(id);
      panel.refreshFingerPresets();
    },
    // --- ポーズライブラリ(フェーズ4) ---
    getCurrentPose() {
      return capturePose(activeCharacter.bones);
    },
    renderThumbnail(pose) {
      return renderPoseThumbnail(pose);
    },
    onApplyPose(pose: PoseData, parts: Set<PosePart>) {
      // 選択部位にこのポーズによる実際の変化があるか事前確認する。
      // 多くのプリセットは上半身のみ等、一部の部位しか定義していないため、
      // 「選択中の部位にはデータが無く見た目が変わらない」だけなのに「反応しない」と
      // 誤解されないよう、変化が無い場合はトーストで理由を伝えて履歴も汚さない。
      const applyHipsPosition = activeCharacter.kind === "mannequin";
      const EPS = 1e-4;
      let changed = false;
      for (const name of boneSetForParts(parts)) {
        const entry = pose[name];
        const bone = activeCharacter.bones[name];
        if (!entry || !bone) continue;
        const [x, y, z, w] = entry.rotation;
        if (
          Math.abs(bone.quaternion.x - x) > EPS ||
          Math.abs(bone.quaternion.y - y) > EPS ||
          Math.abs(bone.quaternion.z - z) > EPS ||
          Math.abs(bone.quaternion.w - w) > EPS
        ) {
          changed = true;
          break;
        }
        if (name === "hips" && entry.position && applyHipsPosition) {
          const [px, py, pz] = entry.position;
          if (
            Math.abs(bone.position.x - px) > EPS ||
            Math.abs(bone.position.y - py) > EPS ||
            Math.abs(bone.position.z - pz) > EPS
          ) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        showToast("選択中の部位には、このポーズによる変化がありません(このポーズは別の部位のデータのみ含んでいる可能性があります)。");
        return;
      }
      history.beginChange();
      applyPosePartial(activeCharacter.bones, pose, parts, { applyHipsPosition });
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onInterpBegin() {
      history.beginChange();
    },
    onInterpPreview(pose: PoseData) {
      // 補間中のプレビュー適用。履歴は onInterpBegin で1回だけ積んでいるのでここでは積まない。
      applyPose(activeCharacter.bones, pose, {
        applyHipsPosition: activeCharacter.kind === "mannequin",
      });
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onExportPose(file: PoseLibraryFile, suggestedName: string) {
      const safe = suggestedName.replace(/[\\/:*?"<>|]/g, "_").trim() || "pose";
      downloadTextFile(`pose_${safe}.json`, JSON.stringify(file, null, 2));
    },
    async onImportPose(): Promise<PoseLibraryFile | null> {
      const opened = await openTextFile(".json,application/json");
      if (!opened) return null;
      try {
        const parsed = migratePoseFile(JSON.parse(opened.text));
        const raw = JSON.parse(opened.text) as { name?: unknown; thumbnail?: unknown };
        return {
          formatVersion: POSE_LIBRARY_FORMAT_VERSION,
          name: typeof raw.name === "string" ? raw.name : opened.name.replace(/\.json$/i, ""),
          thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
          pose: parsed.pose,
        };
      } catch (err) {
        showToast(`ポーズファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    // --- 小物(フェーズ6・(A)) ---
    onAddProp(typeId) {
      history.beginChange();
      propController.add(typeId);
      syncProps();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onSelectProp(id) {
      propController.select(id);
      syncProps();
      notifyIfAttachedPropSelected(id);
    },
    onDeleteProp(id) {
      history.beginChange();
      propController.remove(id);
      syncProps();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onAttachProp(id, side) {
      history.beginChange();
      propController.attach(id, side, activeCharacter, activeSlotId);
      syncProps();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onDetachProp(id) {
      history.beginChange();
      propController.detach(id);
      syncProps();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onSetGizmoMode(mode) {
      propController.setGizmoMode(mode);
      syncProps();
    },
    onSetPropColor(id, hexString) {
      // ここでsyncProps()(=PropPanelの再描画)を呼ばない。カラーピッカーのinput要素がDOM再構築で
      // 破棄されると、開いているネイティブのカラーピッカーUIが強制的に閉じてしまうため
      // (2026-07-27、ユーザー指摘)。見た目への反映(プレビュー)自体はsetColor()で即座に行われる。
      propController.setColor(id, parseInt(hexString.slice(1), 16));
      // シルエット表示中は全メッシュが同じ単色で描かれるため、色を変えても画面上は何も変わらない。
      // 変更自体は保持され通常表示へ戻したときに反映されるので、その旨を一度だけ伝える
      // (毎回出すとスライダー操作のたびに鳴って邪魔になるため1回きり)。
      if (shadingMode === "silhouette" && !silhouetteColorNoticeShown) {
        silhouetteColorNoticeShown = true;
        showToast("シルエット表示中は色の変化が見えません。通常表示に戻すと反映されます。");
      }
    },
  };

  const panel = new PanelUI(callbacks);
  app.appendChild(panel.element);
  rebuildIkAndPin(activeCharacter);
  sceneManager.setFocalLength(50);
  panel.setFocalLengthDisplay(50);
  // 起動時のカメラが近すぎて全身が入らない(2026-08-03、ユーザー要望)。焦点距離を確定させた後に
  // 全身が収まる距離まで引く(fovが決まっていないと必要距離を計算できないため、この順序であること)。
  // 前回の自動保存を復元する場合は、後段(オートセーブ復元)で保存済みの構図が上書きする。
  sceneManager.frameObjects(framingTargets());
  sceneManager.setLightDirection(34, 48);
  panel.setBodyShapeDisplay(getActiveSlot().bodyShape);
  panel.setCharacterRotationDisplay(getCharacterYRotationDeg(activeCharacter));
  refreshCharacterListUI();
  syncProps();

  selection.onSelect((name) => {
    panel.setSelectedBone(name, name ? gizmo.getEulerDeg(name) : null);
  });

  // 非アクティブなキャラの体をクリック→まずそのキャラへ切り替え、続けて同じクリックで
  // 命中したボーンを選択する(setActiveSlotがselection内部の選択をnullへ戻すため、
  // その後に明示的にselectする順序が重要)。boneNameがnull(素肌など、ボーン以外をクリック)の
  // 場合はselection.select(null)が実質no-opになり、切替のみ・関節選択なしの状態になる。
  crossCharacterSelector.onHit((slotId, boneName) => {
    setActiveSlot(slotId);
    selection.select(boneName);
  });

  emptySpaceClickController.onEmptyDoubleClick(() => setControlsHidden(true));
  // モデル切替(activateSlot)を伴わない、アクティブなキャラ自身への通常クリックからの再表示。
  // モデル切替を伴う場合はactivateSlot側で既にcontrolsHidden=falseへリセット済みだが、
  // 同じクリックでここも呼ばれるため二重にfalseを立てるだけで無害(冪等)。
  emptySpaceClickController.onAnyHit(() => setControlsHidden(false));

  gizmo.onDragEnd(() => {
    panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
  });

  gizmo.onChange((_name, euler) => {
    panel.updateEulerDisplay(euler);
  });

  // ギズモのドラッグ開始時点の状態を履歴に積む。同時に、このドラッグに伴うクリック判定への
  // 誤爆も防ぐ(骨の回転ギズモと小物・隣のキャラは画面上で近接することが多いため)。
  gizmo.transformControls.addEventListener("dragging-changed", (event) => {
    if (event.value) {
      history.beginChange();
      suppressNextRaycastAll();
    }
  });

  // 小物ギズモのドラッグ開始時点を履歴に積む(ボーンのgizmo.transformControlsと同じ扱い)。
  // 抑制も同様に開始時へ寄せる(suppressNextRaycastAllのコメント参照)。
  propController.transformControls.addEventListener("dragging-changed", (event) => {
    if (event.value) {
      history.beginChange();
      suppressNextRaycastAll();
    } else {
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    }
  });

  // 3Dビュー上で小物をクリック選択した際、パネル表示・表示モード・輪郭線対象を追従させる
  propController.onChange(() => {
    syncProps();
    notifyIfAttachedPropSelected(propController.selected?.id ?? null);
  });

  panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());

  // 3Dビュー上で光源ハンドル(紫球)をドラッグした際、シーンとスライダー表示の両方を更新する
  lightDrag.onChange((azimuthDeg, elevationDeg) => {
    sceneManager.setLightDirection(azimuthDeg, elevationDeg);
    panel.setLightDirectionValues(azimuthDeg, elevationDeg);
  });

  // --- VRMのドラッグ&ドロップ読み込み ---
  viewport.addEventListener("dragover", (e) => {
    e.preventDefault();
    viewport.classList.add("viewport--drag-over");
  });
  viewport.addEventListener("dragleave", () => {
    viewport.classList.remove("viewport--drag-over");
  });
  viewport.addEventListener("drop", (e) => {
    e.preventDefault();
    viewport.classList.remove("viewport--drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".vrm")) {
      showToast("VRMファイル(.vrm)をドロップしてください。");
      return;
    }
    file.arrayBuffer().then(
      (buffer) => addVrmSlot(buffer, file.name),
      // ドロップされたファイルが読めない場合(破損・ロック等)も理由を伝える。
      // ファイル選択ダイアログ経由(onOpenVrmFile)と挙動を揃えるため。
      () => showToast("ファイルを読み込めませんでした。破損しているか、他のアプリで開かれている可能性があります。"),
    );
  });

  // --- キーボードショートカット ---
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") return;

    // モーダル表示中は、モーダル自身を閉じる操作以外を通さない。確認ダイアログの裏でミラーや
    // 視点プリセットが効いてしまうと、OKを押した時点でユーザーが見ていた状態とは違うシーンが
    // 書き出される(2026-08-18修正)。起動時の自動保存復元ダイアログ表示中も同様。
    // ショートカット一覧はHでもEscでも閉じられる必要があるためここで処理する
    // (確認ダイアログはEscを自前で拾ってキャンセルする。ConfirmDialog.ts参照)。
    if (isModalOpen()) {
      if (shortcutHelp.isVisible && (e.key === "Escape" || e.key === "h" || e.key === "H")) {
        shortcutHelp.hide();
      }
      return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === "z" && e.shiftKey) {
      e.preventDefault();
      callbacks.onRedo();
    } else if (e.ctrlKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      callbacks.onUndo();
    } else if (e.key === "m" || e.key === "M") {
      callbacks.onMirror();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      callbacks.onResetSelected();
    } else if (e.key === "1") {
      callbacks.onCameraPreset("front");
    } else if (e.key === "3") {
      callbacks.onCameraPreset("right");
    } else if (e.key === "5") {
      callbacks.onCameraPreset("back");
    } else if (e.key === "7") {
      callbacks.onCameraPreset("top");
    } else if (e.key === "Escape") {
      selection.select(null);
    } else if (e.key === "h" || e.key === "H") {
      shortcutHelp.toggle();
    } else if (e.key === "i" || e.key === "I") {
      callbacks.onToggleIkMode(!ikController.getEnabled());
    }
  });

  // --- オートセーブ・復元 ---
  const AUTOSAVE_FORMAT_VERSION = 1;
  const getAutosaveCamera = (): AutosaveCamera => ({
    position: [sceneManager.camera.position.x, sceneManager.camera.position.y, sceneManager.camera.position.z],
    target: [
      sceneManager.orbitControls.target.x,
      sceneManager.orbitControls.target.y,
      sceneManager.orbitControls.target.z,
    ],
    focalLength: sceneManager.getFocalLength(),
  });

  const existing = loadAutosave();
  if (existing) {
    const restore = await showConfirmDialog(
      "前回作業していたポーズが見つかりました。復元しますか？",
      "復元する",
      "復元しない",
    );
    if (restore) {
      // オートセーブは初期スロット(slot-1)専用(追加したキャラクターはセッション限りで永続化しない、
      // VRMファイル自体を保存していないため復元しようがないのと同じ理由)。
      const initialSlot = getSlot(INITIAL_SLOT_ID);
      applyPose(initialSlot.character.bones, existing.pose);
      propController.restore(
        existing.props ?? [],
        characterSlots.map((s) => ({ id: s.id, character: s.character })),
        INITIAL_SLOT_ID,
      );
      applyBodyShapeParams(initialSlot, existing.bodyShape ?? DEFAULT_BODY_SHAPE);
      syncProps();
      sceneManager.camera.position.set(...existing.camera.position);
      sceneManager.orbitControls.target.set(...existing.camera.target);
      sceneManager.orbitControls.update();
      sceneManager.setFocalLength(existing.camera.focalLength);
      panel.setFocalLengthDisplay(existing.camera.focalLength);
    }
  }

  startAutosaveLoop(() => ({
    formatVersion: AUTOSAVE_FORMAT_VERSION,
    pose: capturePose(getSlot(INITIAL_SLOT_ID).character.bones),
    props: propsForSlot(INITIAL_SLOT_ID),
    bodyShape: getSlot(INITIAL_SLOT_ID).bodyShape,
    camera: getAutosaveCamera(),
    savedAt: new Date().toISOString(),
  }));

  // オートセーブが継続的に失敗している(容量超過等)場合、そのままではタブを閉じた時点で
  // 作業が失われることにユーザーが最後まで気づけない。1度だけ警告する
  // (オートセーブ自体は従来どおり静かに失敗させ、アプリの動作は止めない)。
  let autosaveFailureWarned = false;
  const autosaveWatchId = window.setInterval(() => {
    if (autosaveFailureWarned || !autosaveIsFailing()) return;
    autosaveFailureWarned = true;
    window.clearInterval(autosaveWatchId);
    showToast("作業の自動保存に失敗しています。保存領域が一杯の可能性があります(ポーズライブラリの整理をおすすめします)。");
  }, 3000);

  // 同じツールを2つのタブで開くと、双方のオートセーブが3秒ごとに同じキーを上書きし合い、
  // 片方の作業が失われる。完全な排他制御はこのツールの性質に対して過剰なので、
  // 「気づける」状態にすることを優先する(storageイベントは自分以外のタブでのみ発火する)。
  let multiTabWarned = false;
  window.addEventListener("storage", (e) => {
    if (e.key !== AUTOSAVE_KEY || multiTabWarned) return;
    multiTabWarned = true;
    showToast("このツールが別のタブでも開かれています。作業内容が上書きされる場合があります。");
  });

  window.addEventListener("beforeunload", () => {
    saveAutosave({
      formatVersion: AUTOSAVE_FORMAT_VERSION,
      pose: capturePose(getSlot(INITIAL_SLOT_ID).character.bones),
      props: propsForSlot(INITIAL_SLOT_ID),
      bodyShape: getSlot(INITIAL_SLOT_ID).bodyShape,
      camera: getAutosaveCamera(),
      savedAt: new Date().toISOString(),
    });
  });
}

main();
