import { CAMERA_PRESETS } from "../scene/cameraPresets";
import type { EulerDeg } from "../posing/GizmoController";
import type { BoneName } from "../config/boneDefs";
import { LIMB_EFFECTORS, type IkEffector, type LimbEffector } from "../posing/IkSolver";
import { JointListPanel } from "./JointListPanel";
import { JointInspector } from "./JointInspector";
import { FingerPanel, type FingerPanelCallbacks } from "./FingerPanel";
import { PoseLibraryPanel, type PoseLibraryCallbacks } from "./PoseLibraryPanel";
import { SavedCameraPanel, type SavedCameraCallbacks } from "./SavedCameraPanel";
import { SHADING_MODE_LABELS, type ShadingMode } from "../scene/DisplayModeMaterials";
import { CANVAS_FRAME_PRESETS, type CanvasFramePresetId } from "./CanvasFrameOverlay";
import { PropPanel, type PropPanelCallbacks } from "./PropPanel";
import type { PropInstance, GizmoMode } from "../posing/PropController";
import { storage } from "../io/platform";
import {
  BUILD_LABELS,
  BASE_LABELS,
  BUILD_ORDER,
  BASE_ORDER,
  HEAD_COUNT_RANGE,
  type BodyShapeParams,
  type BodyBuild,
  type BodyBase,
} from "../config/bodyShapeDefs";

export type CharacterKind = "mannequin" | "vrm";

const LIMB_LABELS: Record<LimbEffector, string> = {
  leftHand: "左手首",
  rightHand: "右手首",
  leftFoot: "左足首",
  rightFoot: "右足首",
};

export interface PanelCallbacks extends FingerPanelCallbacks, PoseLibraryCallbacks, SavedCameraCallbacks, PropPanelCallbacks {
  onSelectBone(name: BoneName): void;
  onBeginEdit(): void;
  onEulerChange(name: BoneName, euler: EulerDeg): void;
  onMirror(): void;
  onResetAll(): void;
  onResetSelected(): void;
  onUndo(): void;
  onRedo(): void;
  onLimitsToggle(enabled: boolean): void;
  onGizmoSizeChange(size: number): void;
  onGridToggle(visible: boolean): void;
  onOutlineToggle(enabled: boolean): void;
  /** true=実線(深度ベース、くっきり)、false=フェード(既存のOutlinePass、ふんわり)。 */
  onOutlineModeToggle(solid: boolean): void;
  onOutlineStrengthChange(strength: number): void;
  /** "#rrggbb"形式のカラーピッカー値。 */
  onBackgroundColorChange(hexString: string): void;
  onEyeLevelToggle(enabled: boolean): void;
  onGroundContactToggle(enabled: boolean): void;
  onLightDirectionChange(azimuthDeg: number, elevationDeg: number): void;
  onLightMarkerToggle(enabled: boolean): void;
  onShadowToggle(enabled: boolean): void;
  onShadingModeChange(mode: ShadingMode): void;
  onCanvasFrameToggle(visible: boolean): void;
  onCanvasFramePresetChange(id: CanvasFramePresetId): void;
  onCanvasFrameSwapToggle(swapped: boolean): void;
  onCanvasFrameCustomRatioChange(width: number, height: number): void;
  onCameraPreset(id: string): void;
  onFocalLengthChange(mm: number): void;
  onSavePose(): void;
  onLoadPose(): void;
  onExportPNG(transparent: boolean, cropToFrame: boolean): void;
  onExportMultiAnglePNG(transparent: boolean, cropToFrame: boolean, includeTop: boolean): void;
  onShowHelp(): void;
  onOpenVrmFile(): void;
  // --- 複数体配置(フェーズ6・(B)) ---
  onSelectCharacterSlot(id: string): void;
  onAddMannequin(): void;
  onRemoveCharacterSlot(id: string): void;
  onToggleCharacterVisibility(id: string, visible: boolean): void;
  onCharacterRotationChange(deg: number): void;
  onHeadCountChange(value: number): void;
  onBodyBuildChange(build: BodyBuild): void;
  onBodyBaseChange(base: BodyBase): void;
  onToggleIkMode(enabled: boolean): void;
  onTogglePin(effector: LimbEffector, pinned: boolean): void;
  onToggleGaze(enabled: boolean): void;
}

// セクションの開閉状態(見出しテキストをキーにする)。将来UIを縦積み以外の配置(上部バー等)に
// 変えてもこの状態管理自体はそのまま使い回せるよう、レイアウトの向きには一切依存させない
// (「表示するかどうか」のクラス切り替えのみで、位置・並び方向はCSS側の責務とする)。
const PANEL_COLLAPSED_STORAGE_KEY = "3dposer.panelCollapsed.v1";

function loadCollapsedSectionTitles(): Set<string> {
  try {
    const raw = storage.get(PANEL_COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

const collapsedSectionTitles = loadCollapsedSectionTitles();

function saveCollapsedSectionTitles(): void {
  storage.set(PANEL_COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsedSectionTitles]));
}

// パネルのハイライト色(CSS変数--accent)。ヘッダーのスウォッチ(オレンジ/青)で切替、選択は永続化する
// (2026-07-28、ユーザー要望)。色の実体はstyle.css側の--accentを参照する各ルールに一本化してあるため、
// ここではCSS変数の書き換えと永続化のみを担う。
const ACCENT_COLOR_STORAGE_KEY = "3dposer.accentColor.v1";
const ACCENT_COLORS: { color: string; label: string }[] = [
  { color: "#d97a2f", label: "オレンジ" },
  { color: "#3a7ac0", label: "青" },
];

function loadAccentColor(): string {
  return storage.get(ACCENT_COLOR_STORAGE_KEY) || ACCENT_COLORS[0].color;
}

function applyAccentColor(color: string): void {
  document.documentElement.style.setProperty("--accent", color);
  storage.set(ACCENT_COLOR_STORAGE_KEY, color);
}

function section(titleText: string): { section: HTMLElement; body: HTMLElement } {
  const sec = document.createElement("section");
  sec.className = "panel-section";

  const header = document.createElement("div");
  header.className = "panel-section__header";
  const h = document.createElement("h3");
  h.textContent = titleText;
  const chevron = document.createElement("span");
  chevron.className = "panel-section__chevron";
  chevron.textContent = "▾";
  header.appendChild(h);
  header.appendChild(chevron);
  sec.appendChild(header);

  const body = document.createElement("div");
  body.className = "panel-section__body";
  sec.appendChild(body);

  sec.classList.toggle("panel-section--collapsed", collapsedSectionTitles.has(titleText));
  header.addEventListener("click", () => {
    const collapsed = !sec.classList.contains("panel-section--collapsed");
    sec.classList.toggle("panel-section--collapsed", collapsed);
    if (collapsed) collapsedSectionTitles.add(titleText);
    else collapsedSectionTitles.delete(titleText);
    saveCollapsedSectionTitles();
  });

  return { section: sec, body };
}

export class PanelUI {
  readonly element: HTMLElement;
  private jointList: JointListPanel;
  private inspector: JointInspector;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private transparentCheckbox!: HTMLInputElement;
  private cropToFrameCheckbox!: HTMLInputElement;
  private limitsCheckbox!: HTMLInputElement;
  private gridCheckbox!: HTMLInputElement;
  private focalLengthInput!: HTMLInputElement;
  private focalLengthLabel!: HTMLElement;
  private outlineStrengthInput!: HTMLInputElement;
  private outlineStrengthLabel!: HTMLElement;
  private outlineStrengthLabelText!: HTMLElement;
  private backgroundColorInput!: HTMLInputElement;
  private characterListBody!: HTMLElement;
  private addMannequinBtn!: HTMLButtonElement;
  private openVrmBtn!: HTMLButtonElement;
  private characterRotationInput!: HTMLInputElement;
  private characterRotationLabel!: HTMLElement;
  private headCountInput!: HTMLInputElement;
  private headCountLabel!: HTMLElement;
  private bodyBuildButtons = new Map<BodyBuild, HTMLButtonElement>();
  private bodyBaseButtons = new Map<BodyBase, HTMLButtonElement>();
  private bodyShapeControls: (HTMLInputElement | HTMLButtonElement)[] = [];
  private ikModeBtn!: HTMLButtonElement;
  private gazeCheckbox!: HTMLInputElement;
  private lightAzimuthInput!: HTMLInputElement;
  private lightElevationInput!: HTMLInputElement;
  private lightAzimuthLabel!: HTMLElement;
  private lightElevationLabel!: HTMLElement;
  private pinCheckboxes = new Map<LimbEffector, HTMLInputElement>();
  private shadingModeButtons = new Map<ShadingMode, HTMLButtonElement>();
  private fingerPanel!: FingerPanel;
  private poseLibraryPanel!: PoseLibraryPanel;
  private savedCameraPanel!: SavedCameraPanel;
  private propPanel!: PropPanel;

  constructor(private readonly callbacks: PanelCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "panel";

    const header = document.createElement("div");
    header.className = "panel__header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "panel__title-group";
    const title = document.createElement("h1");
    title.textContent = "3Dポーザー";
    titleGroup.appendChild(title);

    const currentAccent = loadAccentColor();
    const accentSwatches: HTMLButtonElement[] = [];
    for (const { color, label } of ACCENT_COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "accent-swatch";
      swatch.style.backgroundColor = color;
      swatch.title = `ハイライト色: ${label}`;
      swatch.classList.toggle("accent-swatch--active", color === currentAccent);
      swatch.addEventListener("click", () => {
        applyAccentColor(color);
        for (const b of accentSwatches) b.classList.toggle("accent-swatch--active", b === swatch);
      });
      accentSwatches.push(swatch);
      titleGroup.appendChild(swatch);
    }
    applyAccentColor(currentAccent);
    header.appendChild(titleGroup);
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "icon-button";
    helpBtn.textContent = "?";
    helpBtn.title = "ショートカット一覧 (H)";
    helpBtn.addEventListener("click", () => callbacks.onShowHelp());
    header.appendChild(helpBtn);
    this.element.appendChild(header);

    // --- キャラクター(フェーズ6・(B)複数体配置) ---
    // 開発指示書上は「2体まで」だったが、事前相談の結果、内部実装はN体対応・UI上限のみ4体とした
    // (main.tsのMAX_CHARACTER_SLOTSと合わせる。上限自体はcanAddの形でmain.ts側から渡される)。
    const charSec = section("キャラクター");

    this.characterListBody = document.createElement("div");
    this.characterListBody.className = "character-chip-row";
    charSec.body.appendChild(this.characterListBody);

    const addCharRow = document.createElement("div");
    addCharRow.className = "button-row";
    this.addMannequinBtn = document.createElement("button");
    this.addMannequinBtn.type = "button";
    this.addMannequinBtn.textContent = "+ マネキン追加";
    this.addMannequinBtn.addEventListener("click", () => callbacks.onAddMannequin());
    this.openVrmBtn = document.createElement("button");
    this.openVrmBtn.type = "button";
    this.openVrmBtn.textContent = "+ VRMファイルを開く…";
    this.openVrmBtn.addEventListener("click", () => callbacks.onOpenVrmFile());
    addCharRow.appendChild(this.addMannequinBtn);
    addCharRow.appendChild(this.openVrmBtn);
    charSec.body.appendChild(addCharRow);

    const charHint = document.createElement("div");
    charHint.className = "model-status";
    charHint.textContent = "ビューにVRMをドラッグ&ドロップして追加することもできます";
    charSec.body.appendChild(charHint);

    // 体ごとの位置は3Dビュー上のIKハンドル(黄色・ルート移動用)で調整し、向きはここで数値調整する。
    const rotationRow = document.createElement("div");
    rotationRow.className = "slider-row";
    const rotationText = document.createElement("span");
    rotationText.textContent = "向き";
    this.characterRotationInput = document.createElement("input");
    this.characterRotationInput.type = "range";
    this.characterRotationInput.min = "-180";
    this.characterRotationInput.max = "180";
    this.characterRotationInput.step = "1";
    this.characterRotationLabel = document.createElement("span");
    this.characterRotationLabel.className = "slider-row__value";
    rotationRow.appendChild(rotationText);
    rotationRow.appendChild(this.characterRotationInput);
    rotationRow.appendChild(this.characterRotationLabel);
    charSec.body.appendChild(rotationRow);

    // ドラッグ中に何度もUndo履歴を積まないよう、他のスライダーと同じ
    // 「focus後、最初のinputでonBeginEditを一度だけ呼ぶ」パターンを踏襲する。
    let rotationEditing = false;
    this.characterRotationInput.addEventListener("focus", () => {
      rotationEditing = false;
    });
    this.characterRotationInput.addEventListener("input", () => {
      if (!rotationEditing) {
        rotationEditing = true;
        callbacks.onBeginEdit();
      }
      const value = Number(this.characterRotationInput.value);
      this.characterRotationLabel.textContent = `${value.toFixed(0)}°`;
      callbacks.onCharacterRotationChange(value);
    });
    this.characterRotationInput.addEventListener("blur", () => {
      rotationEditing = false;
    });

    this.element.appendChild(charSec.section);

    // --- 体型(フェーズ6(C)、マネキンのみ対象。VRM選択中はsetBodyShapeControlsEnabled(false)で無効化) ---
    const bodySec = section("体型");

    const baseRow = document.createElement("div");
    baseRow.className = "button-row";
    for (const base of BASE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = BASE_LABELS[base];
      btn.addEventListener("click", () => callbacks.onBodyBaseChange(base));
      this.bodyBaseButtons.set(base, btn);
      this.bodyShapeControls.push(btn);
      baseRow.appendChild(btn);
    }
    bodySec.body.appendChild(baseRow);

    const buildRow = document.createElement("div");
    buildRow.className = "button-row";
    for (const build of BUILD_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = BUILD_LABELS[build];
      btn.addEventListener("click", () => callbacks.onBodyBuildChange(build));
      this.bodyBuildButtons.set(build, btn);
      this.bodyShapeControls.push(btn);
      buildRow.appendChild(btn);
    }
    bodySec.body.appendChild(buildRow);

    const headCountRow = document.createElement("div");
    headCountRow.className = "slider-row";
    const headCountText = document.createElement("span");
    headCountText.textContent = "頭身";
    this.headCountInput = document.createElement("input");
    this.headCountInput.type = "range";
    this.headCountInput.min = String(HEAD_COUNT_RANGE.min);
    this.headCountInput.max = String(HEAD_COUNT_RANGE.max);
    this.headCountInput.step = String(HEAD_COUNT_RANGE.step);
    this.headCountLabel = document.createElement("span");
    this.headCountLabel.className = "slider-row__value";
    headCountRow.appendChild(headCountText);
    headCountRow.appendChild(this.headCountInput);
    headCountRow.appendChild(this.headCountLabel);
    bodySec.body.appendChild(headCountRow);
    this.bodyShapeControls.push(this.headCountInput);

    // ドラッグ中に何度もUndo履歴を積まないよう、JointInspector.tsと同じ
    // 「focus後、最初のinputでonBeginEditを一度だけ呼ぶ」パターンを踏襲する。
    let headCountEditing = false;
    this.headCountInput.addEventListener("focus", () => {
      headCountEditing = false;
    });
    this.headCountInput.addEventListener("input", () => {
      if (!headCountEditing) {
        headCountEditing = true;
        callbacks.onBeginEdit();
      }
      const value = Number(this.headCountInput.value);
      this.headCountLabel.textContent = `${value.toFixed(1)}頭身`;
      callbacks.onHeadCountChange(value);
    });
    this.headCountInput.addEventListener("blur", () => {
      headCountEditing = false;
    });

    this.element.appendChild(bodySec.section);

    // --- カメラ ---
    const cam = section("カメラ・表示");
    const presetRow = document.createElement("div");
    presetRow.className = "button-row";
    const cameraPresetButtons: HTMLButtonElement[] = [];
    for (const preset of CAMERA_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        // クリック後もカメラを自由に操作できるため「今どのプリセットか」の厳密な追跡はせず、
        // 最後に押したボタンをハイライトするだけの見た目上のフィードバックとする(2026-07-28、ユーザー要望)。
        for (const b of cameraPresetButtons) b.classList.remove("button--active");
        btn.classList.add("button--active");
        callbacks.onCameraPreset(preset.id);
      });
      cameraPresetButtons.push(btn);
      presetRow.appendChild(btn);
    }
    cam.body.appendChild(presetRow);

    const focalRow = document.createElement("div");
    focalRow.className = "slider-row";
    const focalLabelText = document.createElement("span");
    focalLabelText.textContent = "画角";
    this.focalLengthInput = document.createElement("input");
    this.focalLengthInput.type = "range";
    this.focalLengthInput.min = "18";
    this.focalLengthInput.max = "135";
    this.focalLengthInput.value = "50";
    this.focalLengthInput.addEventListener("input", () => {
      callbacks.onFocalLengthChange(Number(this.focalLengthInput.value));
    });
    this.focalLengthLabel = document.createElement("span");
    this.focalLengthLabel.className = "slider-row__value";
    this.focalLengthLabel.textContent = "50mm";
    focalRow.appendChild(focalLabelText);
    focalRow.appendChild(this.focalLengthInput);
    focalRow.appendChild(this.focalLengthLabel);
    cam.body.appendChild(focalRow);

    const gridLabel = document.createElement("label");
    gridLabel.className = "checkbox-row";
    this.gridCheckbox = document.createElement("input");
    this.gridCheckbox.type = "checkbox";
    this.gridCheckbox.checked = true;
    this.gridCheckbox.addEventListener("change", () => callbacks.onGridToggle(this.gridCheckbox.checked));
    gridLabel.appendChild(this.gridCheckbox);
    gridLabel.appendChild(document.createTextNode("床グリッドを表示"));
    cam.body.appendChild(gridLabel);

    const backgroundColorRow = document.createElement("div");
    backgroundColorRow.className = "slider-row";
    const backgroundColorLabelText = document.createElement("span");
    backgroundColorLabelText.textContent = "背景色";
    this.backgroundColorInput = document.createElement("input");
    this.backgroundColorInput.type = "color";
    this.backgroundColorInput.value = "#2b2b30";
    this.backgroundColorInput.addEventListener("input", () => {
      callbacks.onBackgroundColorChange(this.backgroundColorInput.value);
    });
    backgroundColorRow.appendChild(backgroundColorLabelText);
    backgroundColorRow.appendChild(this.backgroundColorInput);
    cam.body.appendChild(backgroundColorRow);

    const outlineLabel = document.createElement("label");
    outlineLabel.className = "checkbox-row";
    const outlineCheckbox = document.createElement("input");
    outlineCheckbox.type = "checkbox";
    outlineCheckbox.addEventListener("change", () => {
      callbacks.onOutlineToggle(outlineCheckbox.checked);
      // 「輪郭線を表示」がOFFの間は無関係な設定なので隠す(2026-07-28、ユーザー要望)。
      outlineModeLabel.style.display = outlineCheckbox.checked ? "flex" : "none";
    });
    outlineLabel.appendChild(outlineCheckbox);
    outlineLabel.appendChild(document.createTextNode("輪郭線を表示"));
    cam.body.appendChild(outlineLabel);

    // フェード(既存のOutlinePass、内部でガウシアンブラーが掛かりふんわりした線になる)と
    // 実線(深度バッファの隣接ピクセル差分によるくっきりした線)を切り替える(2026-07-27、ユーザー要望)。
    // 実線モードでは同じ強さスライダーが「太さ(px)」の意味に変わる。
    const outlineModeLabel = document.createElement("label");
    outlineModeLabel.className = "checkbox-row";
    // 初期状態は「輪郭線を表示」がOFF(既定)なので非表示(2026-07-28、ユーザー要望)。
    outlineModeLabel.style.display = "none";
    const outlineModeCheckbox = document.createElement("input");
    outlineModeCheckbox.type = "checkbox";
    // デフォルトはフェード(チェックなし、SceneManagerのoutlineMode初期値="fade"と対応)。
    // 実線をデフォルトにする変更を一度試したがユーザー環境で見えないとの報告があり撤回した(2026-07-27)。
    outlineModeCheckbox.addEventListener("change", () => {
      this.outlineStrengthLabelText.textContent = outlineModeCheckbox.checked ? "輪郭線の太さ(px)" : "輪郭線の強さ";
      callbacks.onOutlineModeToggle(outlineModeCheckbox.checked);
    });
    outlineModeLabel.appendChild(outlineModeCheckbox);
    outlineModeLabel.appendChild(document.createTextNode("実線にする(くっきり)"));
    cam.body.appendChild(outlineModeLabel);

    const outlineStrengthRow = document.createElement("div");
    outlineStrengthRow.className = "slider-row";
    this.outlineStrengthLabelText = document.createElement("span");
    this.outlineStrengthLabelText.textContent = "輪郭線の強さ";
    this.outlineStrengthInput = document.createElement("input");
    this.outlineStrengthInput.type = "range";
    this.outlineStrengthInput.min = "1";
    this.outlineStrengthInput.max = "10";
    this.outlineStrengthInput.step = "0.5";
    this.outlineStrengthInput.value = "5";
    this.outlineStrengthInput.addEventListener("input", () => {
      const value = Number(this.outlineStrengthInput.value);
      this.outlineStrengthLabel.textContent = value.toFixed(1);
      callbacks.onOutlineStrengthChange(value);
    });
    this.outlineStrengthLabel = document.createElement("span");
    this.outlineStrengthLabel.className = "slider-row__value";
    this.outlineStrengthLabel.textContent = "5.0";
    outlineStrengthRow.appendChild(this.outlineStrengthLabelText);
    outlineStrengthRow.appendChild(this.outlineStrengthInput);
    outlineStrengthRow.appendChild(this.outlineStrengthLabel);
    cam.body.appendChild(outlineStrengthRow);

    const eyeLevelLabel = document.createElement("label");
    eyeLevelLabel.className = "checkbox-row";
    const eyeLevelCheckbox = document.createElement("input");
    eyeLevelCheckbox.type = "checkbox";
    eyeLevelCheckbox.addEventListener("change", () => callbacks.onEyeLevelToggle(eyeLevelCheckbox.checked));
    eyeLevelLabel.appendChild(eyeLevelCheckbox);
    eyeLevelLabel.appendChild(document.createTextNode("アイレベル線を表示(パース確認用)"));
    cam.body.appendChild(eyeLevelLabel);

    const groundContactLabel = document.createElement("label");
    groundContactLabel.className = "checkbox-row";
    const groundContactCheckbox = document.createElement("input");
    groundContactCheckbox.type = "checkbox";
    groundContactCheckbox.addEventListener("change", () =>
      callbacks.onGroundContactToggle(groundContactCheckbox.checked),
    );
    groundContactLabel.appendChild(groundContactCheckbox);
    groundContactLabel.appendChild(document.createTextNode("接地の目安を表示(足の浮き・めり込み警告)"));
    cam.body.appendChild(groundContactLabel);

    const shadingTitle = document.createElement("div");
    shadingTitle.className = "joint-list__group-title";
    shadingTitle.textContent = "表示モード(輪郭線と併用可)";
    cam.body.appendChild(shadingTitle);
    const shadingRow = document.createElement("div");
    shadingRow.className = "button-row";
    for (const mode of Object.keys(SHADING_MODE_LABELS) as ShadingMode[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = SHADING_MODE_LABELS[mode];
      btn.classList.toggle("button--active", mode === "normal");
      btn.addEventListener("click", () => {
        for (const b of this.shadingModeButtons.values()) b.classList.remove("button--active");
        btn.classList.add("button--active");
        callbacks.onShadingModeChange(mode);
      });
      this.shadingModeButtons.set(mode, btn);
      shadingRow.appendChild(btn);
    }
    cam.body.appendChild(shadingRow);

    const frameLabel = document.createElement("label");
    frameLabel.className = "checkbox-row";
    const frameCheckbox = document.createElement("input");
    frameCheckbox.type = "checkbox";
    frameCheckbox.addEventListener("change", () => callbacks.onCanvasFrameToggle(frameCheckbox.checked));
    frameLabel.appendChild(frameCheckbox);
    frameLabel.appendChild(document.createTextNode("キャンバス枠を表示"));
    cam.body.appendChild(frameLabel);

    const frameRatioRow = document.createElement("div");
    frameRatioRow.className = "canvas-frame-ratio-row";
    const frameRatioSelect = document.createElement("select");
    for (const preset of CANVAS_FRAME_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.label;
      frameRatioSelect.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "カスタム";
    frameRatioSelect.appendChild(customOpt);
    frameRatioSelect.value = "b5";
    frameRatioRow.appendChild(frameRatioSelect);

    const frameSwapLabel = document.createElement("label");
    frameSwapLabel.className = "checkbox-row";
    frameSwapLabel.style.marginBottom = "0";
    const frameSwapCheckbox = document.createElement("input");
    frameSwapCheckbox.type = "checkbox";
    frameSwapCheckbox.addEventListener("change", () => callbacks.onCanvasFrameSwapToggle(frameSwapCheckbox.checked));
    frameSwapLabel.appendChild(frameSwapCheckbox);
    frameSwapLabel.appendChild(document.createTextNode("縦横入替"));
    frameRatioRow.appendChild(frameSwapLabel);
    cam.body.appendChild(frameRatioRow);

    const frameCustomRow = document.createElement("div");
    frameCustomRow.className = "canvas-frame-custom-row";
    frameCustomRow.style.display = "none";
    const customWInput = document.createElement("input");
    customWInput.type = "number";
    customWInput.min = "1";
    customWInput.value = "4";
    const customSep = document.createElement("span");
    customSep.textContent = ":";
    const customHInput = document.createElement("input");
    customHInput.type = "number";
    customHInput.min = "1";
    customHInput.value = "3";
    const emitCustomRatio = (): void => {
      const w = Number(customWInput.value);
      const h = Number(customHInput.value);
      if (w > 0 && h > 0) callbacks.onCanvasFrameCustomRatioChange(w, h);
    };
    customWInput.addEventListener("input", emitCustomRatio);
    customHInput.addEventListener("input", emitCustomRatio);
    frameCustomRow.appendChild(customWInput);
    frameCustomRow.appendChild(customSep);
    frameCustomRow.appendChild(customHInput);
    cam.body.appendChild(frameCustomRow);

    frameRatioSelect.addEventListener("change", () => {
      const id = frameRatioSelect.value as CanvasFramePresetId;
      frameCustomRow.style.display = id === "custom" ? "flex" : "none";
      callbacks.onCanvasFramePresetChange(id);
    });

    const camSavedTitle = document.createElement("div");
    camSavedTitle.className = "joint-list__group-title";
    camSavedTitle.textContent = "保存した構図";
    cam.body.appendChild(camSavedTitle);
    this.savedCameraPanel = new SavedCameraPanel(callbacks);
    cam.body.appendChild(this.savedCameraPanel.element);

    this.element.appendChild(cam.section);

    // --- ライティング ---
    const lightSec = section("ライティング");

    const azimuthRow = document.createElement("div");
    azimuthRow.className = "slider-row";
    const azimuthText = document.createElement("span");
    azimuthText.textContent = "方位";
    this.lightAzimuthInput = document.createElement("input");
    this.lightAzimuthInput.type = "range";
    this.lightAzimuthInput.min = "0";
    this.lightAzimuthInput.max = "360";
    this.lightAzimuthInput.value = "34";
    this.lightAzimuthLabel = document.createElement("span");
    this.lightAzimuthLabel.className = "slider-row__value";
    this.lightAzimuthLabel.textContent = "34°";
    azimuthRow.appendChild(azimuthText);
    azimuthRow.appendChild(this.lightAzimuthInput);
    azimuthRow.appendChild(this.lightAzimuthLabel);
    lightSec.body.appendChild(azimuthRow);

    const elevationRow = document.createElement("div");
    elevationRow.className = "slider-row";
    const elevationText = document.createElement("span");
    elevationText.textContent = "高さ";
    this.lightElevationInput = document.createElement("input");
    this.lightElevationInput.type = "range";
    this.lightElevationInput.min = "0";
    this.lightElevationInput.max = "90";
    this.lightElevationInput.value = "48";
    this.lightElevationLabel = document.createElement("span");
    this.lightElevationLabel.className = "slider-row__value";
    this.lightElevationLabel.textContent = "48°";
    elevationRow.appendChild(elevationText);
    elevationRow.appendChild(this.lightElevationInput);
    elevationRow.appendChild(this.lightElevationLabel);
    lightSec.body.appendChild(elevationRow);

    const emitLightDirection = (): void => {
      this.lightAzimuthLabel.textContent = `${this.lightAzimuthInput.value}°`;
      this.lightElevationLabel.textContent = `${this.lightElevationInput.value}°`;
      callbacks.onLightDirectionChange(Number(this.lightAzimuthInput.value), Number(this.lightElevationInput.value));
    };
    this.lightAzimuthInput.addEventListener("input", emitLightDirection);
    this.lightElevationInput.addEventListener("input", emitLightDirection);

    const lightMarkerLabel = document.createElement("label");
    lightMarkerLabel.className = "checkbox-row";
    const lightMarkerCheckbox = document.createElement("input");
    lightMarkerCheckbox.type = "checkbox";
    lightMarkerCheckbox.addEventListener("change", () => callbacks.onLightMarkerToggle(lightMarkerCheckbox.checked));
    lightMarkerLabel.appendChild(lightMarkerCheckbox);
    lightMarkerLabel.appendChild(document.createTextNode("光源位置を表示(オレンジ球。紫のハンドルをドラッグして調整も可)"));
    lightSec.body.appendChild(lightMarkerLabel);

    const shadowLabel = document.createElement("label");
    shadowLabel.className = "checkbox-row";
    const shadowCheckbox = document.createElement("input");
    shadowCheckbox.type = "checkbox";
    shadowCheckbox.addEventListener("change", () => callbacks.onShadowToggle(shadowCheckbox.checked));
    shadowLabel.appendChild(shadowCheckbox);
    shadowLabel.appendChild(document.createTextNode("影を表示"));
    lightSec.body.appendChild(shadowLabel);

    this.element.appendChild(lightSec.section);

    // --- 小物(フェーズ6・(A)) ---
    const propSec = section("小物");
    this.propPanel = new PropPanel(callbacks);
    propSec.body.appendChild(this.propPanel.element);
    this.element.appendChild(propSec.section);

    // --- 部位リスト ---
    const jointSec = section("部位");
    this.jointList = new JointListPanel((name) => callbacks.onSelectBone(name));
    jointSec.body.appendChild(this.jointList.element);
    this.element.appendChild(jointSec.section);

    // --- インスペクタ ---
    const inspectorSec = section("選択中の部位");
    this.inspector = new JointInspector(
      () => callbacks.onBeginEdit(),
      (name, euler) => callbacks.onEulerChange(name, euler),
    );
    inspectorSec.body.appendChild(this.inspector.element);
    this.element.appendChild(inspectorSec.section);

    // --- IK・ピン留め ---
    const ikSec = section("IK・ピン留め");
    this.ikModeBtn = document.createElement("button");
    this.ikModeBtn.type = "button";
    this.setIkModeButtonLabel(false);
    this.ikModeBtn.addEventListener("click", () => {
      callbacks.onToggleIkMode(!this.ikModeBtn.classList.contains("button--active"));
    });
    ikSec.body.appendChild(this.ikModeBtn);

    const ikHint = document.createElement("div");
    ikHint.className = "model-status";
    ikHint.textContent =
      "IKモード中はハンドルをドラッグすると連動して動きます。紫=腰・胸・首(胴体)、赤=手首・足首・肩、青い小さな印=肘・膝の曲がる向き調整、黄=キャラクター全体の位置(足元付近)。座り/寝そべりポーズでVRMが浮く場合は黄色のハンドルで高さを調整してください。";
    ikSec.body.appendChild(ikHint);

    const gazeLabel = document.createElement("label");
    gazeLabel.className = "checkbox-row";
    this.gazeCheckbox = document.createElement("input");
    this.gazeCheckbox.type = "checkbox";
    this.gazeCheckbox.addEventListener("change", () => callbacks.onToggleGaze(this.gazeCheckbox.checked));
    gazeLabel.appendChild(this.gazeCheckbox);
    gazeLabel.appendChild(document.createTextNode("カメラ目線(頭をカメラに向ける)"));
    ikSec.body.appendChild(gazeLabel);

    const pinTitle = document.createElement("div");
    pinTitle.className = "joint-list__group-title";
    pinTitle.textContent = "ピン留め(位置を固定)";
    ikSec.body.appendChild(pinTitle);

    for (const effector of LIMB_EFFECTORS) {
      const label = document.createElement("label");
      label.className = "checkbox-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => callbacks.onTogglePin(effector, checkbox.checked));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(LIMB_LABELS[effector]));
      ikSec.body.appendChild(label);
      this.pinCheckboxes.set(effector, checkbox);
    }
    this.element.appendChild(ikSec.section);

    // --- 指ポーズ ---
    const fingerSec = section("指ポーズ");
    this.fingerPanel = new FingerPanel(callbacks);
    fingerSec.body.appendChild(this.fingerPanel.element);
    this.element.appendChild(fingerSec.section);

    // --- ポーズライブラリ(プリセット・部分合成・補間) ---
    const libSec = section("ポーズライブラリ");
    this.poseLibraryPanel = new PoseLibraryPanel(callbacks);
    libSec.body.appendChild(this.poseLibraryPanel.element);
    this.element.appendChild(libSec.section);

    // --- ポーズ操作 ---
    const poseSec = section("ポーズ操作");
    const opRow1 = document.createElement("div");
    opRow1.className = "button-row";
    const mirrorBtn = document.createElement("button");
    mirrorBtn.type = "button";
    mirrorBtn.textContent = "左右反転";
    mirrorBtn.addEventListener("click", () => callbacks.onMirror());
    const resetAllBtn = document.createElement("button");
    resetAllBtn.type = "button";
    resetAllBtn.textContent = "全身リセット";
    resetAllBtn.addEventListener("click", () => callbacks.onResetAll());
    const resetSelBtn = document.createElement("button");
    resetSelBtn.type = "button";
    resetSelBtn.textContent = "選択部位リセット";
    resetSelBtn.addEventListener("click", () => callbacks.onResetSelected());
    opRow1.appendChild(mirrorBtn);
    opRow1.appendChild(resetAllBtn);
    opRow1.appendChild(resetSelBtn);
    poseSec.body.appendChild(opRow1);

    const opRow2 = document.createElement("div");
    opRow2.className = "button-row";
    this.undoBtn = document.createElement("button");
    this.undoBtn.type = "button";
    this.undoBtn.textContent = "元に戻す";
    this.undoBtn.addEventListener("click", () => callbacks.onUndo());
    this.redoBtn = document.createElement("button");
    this.redoBtn.type = "button";
    this.redoBtn.textContent = "やり直す";
    this.redoBtn.addEventListener("click", () => callbacks.onRedo());
    opRow2.appendChild(this.undoBtn);
    opRow2.appendChild(this.redoBtn);
    poseSec.body.appendChild(opRow2);

    const limitsLabel = document.createElement("label");
    limitsLabel.className = "checkbox-row";
    this.limitsCheckbox = document.createElement("input");
    this.limitsCheckbox.type = "checkbox";
    this.limitsCheckbox.checked = true;
    this.limitsCheckbox.addEventListener("change", () =>
      callbacks.onLimitsToggle(this.limitsCheckbox.checked),
    );
    limitsLabel.appendChild(this.limitsCheckbox);
    limitsLabel.appendChild(document.createTextNode("可動域制限を有効にする"));
    poseSec.body.appendChild(limitsLabel);

    const gizmoSizeRow = document.createElement("div");
    gizmoSizeRow.className = "slider-row";
    const gizmoSizeText = document.createElement("span");
    gizmoSizeText.textContent = "ギズモサイズ";
    const gizmoSizeInput = document.createElement("input");
    gizmoSizeInput.type = "range";
    gizmoSizeInput.min = "0.3";
    gizmoSizeInput.max = "2.5";
    gizmoSizeInput.step = "0.1";
    gizmoSizeInput.value = "0.9";
    gizmoSizeInput.addEventListener("input", () =>
      callbacks.onGizmoSizeChange(Number(gizmoSizeInput.value)),
    );
    gizmoSizeRow.appendChild(gizmoSizeText);
    gizmoSizeRow.appendChild(gizmoSizeInput);
    poseSec.body.appendChild(gizmoSizeRow);

    this.element.appendChild(poseSec.section);

    // --- 保存・読込・書き出し ---
    const ioSec = section("保存・書き出し");
    const ioRow = document.createElement("div");
    ioRow.className = "button-row";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "ポーズを保存(JSON)";
    saveBtn.addEventListener("click", () => callbacks.onSavePose());
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "ポーズを読込(JSON)";
    loadBtn.addEventListener("click", () => callbacks.onLoadPose());
    ioRow.appendChild(saveBtn);
    ioRow.appendChild(loadBtn);
    ioSec.body.appendChild(ioRow);

    const transparentLabel = document.createElement("label");
    transparentLabel.className = "checkbox-row";
    this.transparentCheckbox = document.createElement("input");
    this.transparentCheckbox.type = "checkbox";
    transparentLabel.appendChild(this.transparentCheckbox);
    transparentLabel.appendChild(document.createTextNode("背景を透過してPNG書き出し"));
    ioSec.body.appendChild(transparentLabel);

    const cropLabel = document.createElement("label");
    cropLabel.className = "checkbox-row";
    this.cropToFrameCheckbox = document.createElement("input");
    this.cropToFrameCheckbox.type = "checkbox";
    cropLabel.appendChild(this.cropToFrameCheckbox);
    cropLabel.appendChild(document.createTextNode("キャンバス枠内だけを書き出す"));
    ioSec.body.appendChild(cropLabel);

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "button--primary";
    exportBtn.textContent = "PNG書き出し";
    exportBtn.addEventListener("click", () =>
      callbacks.onExportPNG(this.transparentCheckbox.checked, this.cropToFrameCheckbox.checked),
    );
    ioSec.body.appendChild(exportBtn);

    const includeTopLabel = document.createElement("label");
    includeTopLabel.className = "checkbox-row";
    const includeTopCheckbox = document.createElement("input");
    includeTopCheckbox.type = "checkbox";
    includeTopLabel.appendChild(includeTopCheckbox);
    includeTopLabel.appendChild(document.createTextNode("多角度書き出しに俯瞰も含める"));
    ioSec.body.appendChild(includeTopLabel);

    const multiAngleBtn = document.createElement("button");
    multiAngleBtn.type = "button";
    multiAngleBtn.textContent = "多角度書き出し(正面/左右/背面)";
    multiAngleBtn.addEventListener("click", () =>
      callbacks.onExportMultiAnglePNG(
        this.transparentCheckbox.checked,
        this.cropToFrameCheckbox.checked,
        includeTopCheckbox.checked,
      ),
    );
    ioSec.body.appendChild(multiAngleBtn);

    this.element.appendChild(ioSec.section);
  }

  setSelectedBone(name: BoneName | null, euler: EulerDeg | null): void {
    this.jointList.setSelected(name);
    this.inspector.setSelected(name, euler);
    this.fingerPanel.setSelectedBone(name);
  }

  updateEulerDisplay(euler: EulerDeg): void {
    this.inspector.updateValues(euler);
  }

  updateUndoRedoButtons(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setFocalLengthDisplay(mm: number): void {
    this.focalLengthInput.value = String(mm);
    this.focalLengthLabel.textContent = `${Math.round(mm)}mm`;
  }

  setLimitsEnabled(enabled: boolean): void {
    this.limitsCheckbox.checked = enabled;
  }

  setGridVisible(visible: boolean): void {
    this.gridCheckbox.checked = visible;
  }

  setAvailableBones(available: ReadonlySet<BoneName> | null): void {
    this.jointList.setAvailableBones(available);
    this.fingerPanel.setAvailableBones(available);
  }

  /**
   * キャラクタースロット一覧をチップ表示に反映する(追加・削除・切替のたびにmain.tsから呼ばれる)。
   * canAddがfalseの場合は追加ボタン(マネキン追加・VRMファイルを開く)を無効化する
   * (MAX_CHARACTER_SLOTSの上限判定はmain.ts側が行い、結果だけをここで反映する)。
   */
  refreshCharacterList(
    slots: { id: string; kind: CharacterKind; removable: boolean; visible: boolean }[],
    activeId: string,
    canAdd: boolean,
  ): void {
    this.characterListBody.innerHTML = "";
    slots.forEach((slot, index) => {
      const chip = document.createElement("div");
      chip.className = "character-chip";
      chip.classList.toggle("character-chip--active", slot.id === activeId);

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "character-chip__select";
      selectBtn.textContent = `${index + 1}: ${slot.kind === "mannequin" ? "マネキン" : "VRM"}`;
      selectBtn.addEventListener("click", () => this.callbacks.onSelectCharacterSlot(slot.id));
      chip.appendChild(selectBtn);

      const visCheckbox = document.createElement("input");
      visCheckbox.type = "checkbox";
      visCheckbox.title = "表示/非表示";
      visCheckbox.checked = slot.visible;
      visCheckbox.addEventListener("change", () =>
        this.callbacks.onToggleCharacterVisibility(slot.id, visCheckbox.checked),
      );
      chip.appendChild(visCheckbox);

      if (slot.removable) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "character-chip__remove";
        delBtn.textContent = "×";
        delBtn.title = "このキャラクターを削除";
        delBtn.addEventListener("click", () => this.callbacks.onRemoveCharacterSlot(slot.id));
        chip.appendChild(delBtn);
      }

      this.characterListBody.appendChild(chip);
    });
    this.addMannequinBtn.disabled = !canAdd;
    this.openVrmBtn.disabled = !canAdd;
  }

  /** アクティブなキャラクターの向き(root.rotation.y、度)をスライダー表示に反映する。 */
  setCharacterRotationDisplay(deg: number): void {
    this.characterRotationInput.value = String(deg);
    this.characterRotationLabel.textContent = `${deg.toFixed(0)}°`;
  }

  /** 体型パラメータの現在値をUI(スライダー・ボタンのハイライト)に反映する。 */
  setBodyShapeDisplay(params: BodyShapeParams): void {
    this.headCountInput.value = String(params.headCount);
    this.headCountLabel.textContent = `${params.headCount.toFixed(1)}頭身`;
    for (const [build, btn] of this.bodyBuildButtons) btn.classList.toggle("button--active", build === params.build);
    for (const [base, btn] of this.bodyBaseButtons) btn.classList.toggle("button--active", base === params.base);
  }

  /** VRM選択中は体型パラメータの変更対象がないため、コントロールごと無効化する。 */
  setBodyShapeControlsEnabled(enabled: boolean): void {
    for (const el of this.bodyShapeControls) el.disabled = !enabled;
  }

  private setIkModeButtonLabel(enabled: boolean): void {
    this.ikModeBtn.textContent = enabled ? "IKモード: オン" : "IKモード: オフ";
    this.ikModeBtn.classList.toggle("button--active", enabled);
  }

  setIkModeEnabled(enabled: boolean): void {
    this.setIkModeButtonLabel(enabled);
  }

  setGazeEnabled(enabled: boolean): void {
    this.gazeCheckbox.checked = enabled;
  }

  /** 3Dビュー上でドラッグハンドルを操作した際、方位・高さスライダーの表示を同期する */
  setLightDirectionValues(azimuthDeg: number, elevationDeg: number): void {
    this.lightAzimuthInput.value = String(Math.round(azimuthDeg));
    this.lightElevationInput.value = String(Math.round(elevationDeg));
    this.lightAzimuthLabel.textContent = `${Math.round(azimuthDeg)}°`;
    this.lightElevationLabel.textContent = `${Math.round(elevationDeg)}°`;
  }

  /** 現在のキャラクターで利用できないIKチェーンのピンチェックボックスを無効化する */
  setAvailableIkChains(available: ReadonlySet<IkEffector>): void {
    for (const [effector, checkbox] of this.pinCheckboxes) {
      checkbox.disabled = !available.has(effector);
    }
  }

  setPinned(effector: LimbEffector, pinned: boolean): void {
    const checkbox = this.pinCheckboxes.get(effector);
    if (checkbox) checkbox.checked = pinned;
  }

  refreshFingerPresets(): void {
    this.fingerPanel.refreshPresets();
  }

  refreshPoseLibrary(): void {
    this.poseLibraryPanel.refreshLibrary();
  }

  refreshSavedCameras(): void {
    this.savedCameraPanel.refreshList();
  }

  refreshProps(instances: readonly PropInstance[], selectedId: string | null, gizmoMode: GizmoMode): void {
    this.propPanel.refresh(instances, selectedId, gizmoMode);
  }
}
