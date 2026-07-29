import { SceneManager } from "./scene/SceneManager";
import { CAMERA_PRESETS } from "./scene/cameraPresets";
import { applyShadingMode, applyShadingModeToObjects, type ShadingMode } from "./scene/DisplayModeMaterials";
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
import { exportViewportPNG, exportMultiAnglePNG } from "./io/pngExporter";
import { renderPoseThumbnail } from "./io/thumbnailRenderer";
import { POSE_LIBRARY_FORMAT_VERSION, type PoseLibraryFile } from "./io/poseLibraryStorage";
import { addSavedCamera, removeSavedCamera, type SavedCameraView } from "./io/savedCameraStorage";
import { loadAutosave, saveAutosave, startAutosaveLoop, type AutosaveCamera } from "./io/autosave";
import { PanelUI, type PanelCallbacks, type CharacterKind } from "./ui/PanelUI";
import { CanvasFrameOverlay } from "./ui/CanvasFrameOverlay";
import { EyeLevelLine } from "./ui/EyeLevelLine";
import { GroundContactIndicator } from "./ui/GroundContactIndicator";
import { GizmoCoordinateLabel } from "./ui/GizmoCoordinateLabel";
import { ShortcutHelp } from "./ui/ShortcutHelp";
import { showConfirmDialog } from "./ui/ConfirmDialog";
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
  // 何もない場所のダブルクリックでコントローラー・ギズモを一切隠す(作画資料用、2026-07-28ユーザー要望)。
  // 判定対象は全キャラクター(アクティブ/非アクティブ問わず)+全小物。
  const emptySpaceClickController = new EmptySpaceClickController(
    sceneManager.renderer.domElement,
    sceneManager.camera,
    {
      getCharacters: () => characterSlots.map((s) => s.character),
      getPropObjects: () => propController.list().map((i) => i.object),
    },
    () => controlsHidden,
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
  let shadingMode: ShadingMode = "normal";

  function rebuildIkAndPin(character: Character): void {
    if (ikController) sceneManager.removeOutlineExcludedObject(...ikController.outlineExcludedObjects);
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
    ikController.onDragEnd(() => panel.updateUndoRedoButtons(history.canUndo(), history.canRedo()));
    // IKハンドル(特に手首)は小物を持たせた手の近くに来ることが多く、ドラッグ終了直後の
    // クリック誤判定で小物選択が外れるのを防ぐ(propController側のクリック判定も参照)
    ikController.onDragEnd(() => propController.suppressNextRaycast());
    // 複数体が近接配置されている場合、ドラッグ終了直後に隣のキャラを誤ってクリック判定しないため
    ikController.onDragEnd(() => crossCharacterSelector.suppressNextRaycast());
    pinController = new PinController(ikController);
    sceneManager.addOutlineExcludedObject(...ikController.outlineExcludedObjects);
    panel.setAvailableIkChains(new Set(ikController.availableEffectors));
    // デフォルトでIKモードを有効にする(2026-07-24、ユーザー要望によりFKからIKへデフォルト変更)。
    ikController.setEnabled(true);
    panel.setIkModeEnabled(true);
    for (const effector of LIMB_EFFECTORS) panel.setPinned(effector, false);
  }

  // 作画資料用のクリーンなビュー: IKハンドル(ピン留め中も含め)を隠し、FKギズモ・ボーン選択・
  // ハイライトも選択解除(selection.select(null))と同じ経路でクリアする(GizmoControllerの
  // selection.onSelect購読により、FKギズモの非表示もここで連動する)。
  // VRMのボーン選択用マーカー(青い球、指を含む全関節)はIkController/GizmoControllerとは独立した
  // 常時表示のメッシュ(VrmLoader.ts)で、選択中/非選択・アクティブ/非アクティブを問わず全スロット分
  // 存在するため、ここで別途表示を切り替える(全キャラ分、2026-07-28ユーザー報告により追加)。
  // マネキンはpickableMeshes自体が体本体メッシュなので対象外(隠すとモデル自体が消えてしまう)。
  function setControlsHidden(hidden: boolean): void {
    controlsHidden = hidden;
    ikController.setHandlesHidden(hidden);
    if (hidden) selection.select(null);
    for (const slot of characterSlots) {
      if (slot.kind !== "vrm") continue;
      for (const mesh of slot.character.pickableMeshes) mesh.visible = !hidden;
    }
  }

  // カメラ目線: GazeControllerで頭ボーンをカメラへ向ける(マネキン・VRM共通、アクティブなスロットのみ)。
  // VRMは加えて目のボーンもvrm.lookAtで追従させ、頭+目でカメラを見る自然な挙動にする。
  // 複数体配置では非アクティブなVRMのlookAtは常にnullへ戻す(視線はポージング対象のみに適用する編集補助のため)。
  function applyGazeState(): void {
    gazeController.setEnabled(gazeEnabled);
    for (const slot of characterSlots) {
      if (slot.kind !== "vrm") continue;
      const vrmChar = slot.character as VrmCharacter;
      if (!vrmChar.vrm.lookAt) continue;
      vrmChar.vrm.lookAt.target = gazeEnabled && slot.id === activeSlotId ? sceneManager.camera : null;
    }
  }

  // VRMのSpringBone(揺れもの)・normalized→raw骨格反映はvrm.update()で毎フレーム行う(全VRMスロット分)
  sceneManager.addTick((dt) => {
    for (const vrmChar of vrmSlotCharacters()) vrmChar.vrm.update(dt);
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

  async function addVrmSlot(buffer: ArrayBuffer, filename: string): Promise<void> {
    if (characterSlots.length >= MAX_CHARACTER_SLOTS) {
      showToast(`キャラクターは最大${MAX_CHARACTER_SLOTS}体までです。`);
      return;
    }
    let loaded: VrmCharacter;
    try {
      loaded = await loadVrmCharacter(buffer);
    } catch (err) {
      showToast(`VRMの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    applySpawnPosition(loaded, characterSlots.length);
    sceneManager.scene.add(loaded.root);
    applyShadingMode(loaded, shadingMode);
    const id = `slot-${nextSlotSeq++}`;
    characterSlots.push({ id, character: loaded, kind: "vrm", removable: true, bodyShape: DEFAULT_BODY_SHAPE });
    const versionLabel = loaded.vrm.meta?.metaVersion === "0" ? "VRM 0.x" : loaded.vrm.meta?.metaVersion === "1" ? "VRM 1.0" : null;
    showToast(`VRMを追加しました: ${filename}${versionLabel ? ` (${versionLabel})` : ""}`);
    setActiveSlot(id);
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
      resetAll(activeCharacter.bones);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onResetSelected() {
      if (!selection.current) return;
      history.beginChange();
      resetSubtree(activeCharacter.bones, selection.current);
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
      if (preset) sceneManager.applyCameraPreset(preset);
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
      const cropRect = cropToFrame ? canvasFrame.getExportPixelRect(sceneManager.renderer.domElement) : null;
      exportViewportPNG(sceneManager, transparent, cropRect);
    },
    onExportMultiAnglePNG(transparent, cropToFrame, includeTop) {
      const cropRect = cropToFrame ? canvasFrame.getExportPixelRect(sceneManager.renderer.domElement) : null;
      exportMultiAnglePNG(sceneManager, transparent, cropRect, includeTop);
    },
    onSaveCameraView(name) {
      addSavedCamera({ name, ...sceneManager.getCameraState() });
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
      if (!opened) return;
      await addVrmSlot(opened.buffer, opened.name);
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
    onApplyPreset(side, preset) {
      history.beginChange();
      applyFingerPreset(gizmo, side, preset);
      refreshInspectorFromSelection();
      panel.updateUndoRedoButtons(history.canUndo(), history.canRedo());
    },
    onSaveCustomPreset(side, label) {
      const rotations = captureFingerPose(gizmo, side, ALL_FINGER_SUFFIXES);
      addCustomFingerPreset({ id: `custom_${Date.now()}`, label, rotations });
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
    },
  };

  const panel = new PanelUI(callbacks);
  app.appendChild(panel.element);
  rebuildIkAndPin(activeCharacter);
  sceneManager.setFocalLength(50);
  panel.setFocalLengthDisplay(50);
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

  // ギズモのドラッグ開始時点の状態を履歴に積む。終了直後は小物クリック判定への誤爆も防ぐ
  // (骨の回転ギズモと小物は手の周辺で近接することが多いため)。
  gizmo.transformControls.addEventListener("dragging-changed", (event) => {
    if (event.value) history.beginChange();
    else {
      propController.suppressNextRaycast();
      crossCharacterSelector.suppressNextRaycast();
    }
  });

  // 小物ギズモのドラッグ開始時点を履歴に積む(ボーンのgizmo.transformControlsと同じ扱い)。
  // ドラッグ終了直後は、クリックが素通りしてボーン選択のraycastに拾われるのを防ぐ
  // (GizmoControllerのdragging-changedハンドラでselection.suppressNextRaycast()している対処と同じ理由)。
  propController.transformControls.addEventListener("dragging-changed", (event) => {
    if (event.value) {
      history.beginChange();
    } else {
      selection.suppressNextRaycast();
      crossCharacterSelector.suppressNextRaycast();
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
    file.arrayBuffer().then((buffer) => addVrmSlot(buffer, file.name));
  });

  // --- キーボードショートカット ---
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") return;

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
