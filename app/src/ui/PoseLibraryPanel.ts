// ポーズライブラリUI(フェーズ4)。右パネルの「ポーズライブラリ」セクション本体。
//   ・適用範囲(部位)の選択 … 部分合成 (B)
//   ・内蔵プリセット一覧(サムネ) … プリセット呼び出し (A)
//   ・マイライブラリ(保存/適用/書き出し/削除/インポート) … 自作ライブラリ (A)
//   ・ポーズ補間(2ポーズをスライダーで中間生成) … 補間 (C)
// 素のDOM/CSSで実装する。

import type { PoseData } from "../posing/PoseSerializer";
import {
  POSE_PARTS,
  PART_LABELS,
  UPPER_BODY_PARTS,
  LOWER_BODY_PARTS,
  blendPoses,
  type PosePart,
} from "../posing/PoseBlend";
import {
  POSE_PRESET_DEFS,
  buildPresetPose,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type PosePresetDef,
} from "../config/posePresets";
import {
  loadPoseLibrary,
  addSavedPose,
  removeSavedPose,
  POSE_LIBRARY_FORMAT_VERSION,
  type SavedPose,
  type PoseLibraryFile,
} from "../io/poseLibraryStorage";
import { showToast } from "./Toast";

/** 保存領域が一杯で保存できなかったときの案内。保存経路が複数あるため文言を1箇所にまとめる。 */
const SAVE_FAILED_MESSAGE =
  "保存領域が一杯のため保存できませんでした。マイライブラリから不要なポーズを削除してください。";

export interface PoseLibraryCallbacks {
  /** 現在のポーズを取得する(補間・保存の元) */
  getCurrentPose(): PoseData;
  /** ポーズのサムネイル(PNG dataURL)を生成する */
  renderThumbnail(pose: PoseData): string;
  /** ポーズを指定部位だけ現在の姿勢へ適用する(履歴に積む)。全部位指定なら全身適用。 */
  onApplyPose(pose: PoseData, parts: Set<PosePart>): void;
  /** 補間ドラッグ開始時(履歴に1回だけ積むため) */
  onInterpBegin(): void;
  /** 補間プレビュー適用(履歴には積まない・全身) */
  onInterpPreview(pose: PoseData): void;
  /** 単一ポーズをファイルへ書き出す */
  onExportPose(file: PoseLibraryFile, suggestedName: string): void;
  /** ファイルからポーズを読み込む(main がダイアログ表示・検証を行う)。null ならキャンセル。 */
  onImportPose(): Promise<PoseLibraryFile | null>;
}

function subTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "joint-list__group-title";
  el.textContent = text;
  return el;
}

export class PoseLibraryPanel {
  readonly element: HTMLElement;
  private callbacks: PoseLibraryCallbacks;
  private selectedParts = new Set<PosePart>(POSE_PARTS);
  private partChips = new Map<PosePart, HTMLButtonElement>();
  // 全身/上半身/下半身/クリアのクイックボタン。現在の選択範囲と完全一致するものだけ選択中表示にする。
  private quickButtons: Array<{ el: HTMLButtonElement; parts: PosePart[] }> = [];
  // 最後にクリックしたポーズカード(プリセット/マイライブラリ)を青くハイライトし続けるための状態。
  // キーは "preset:<id>" または "saved:<id>"。
  private selectedPoseKey: string | null = null;
  private poseCardButtons = new Map<string, HTMLElement>();
  private libraryGrid: HTMLElement;
  private libraryEmpty: HTMLElement;
  private interpSelectA: HTMLSelectElement;
  private interpSelectB: HTMLSelectElement;
  private interpSlider: HTMLInputElement;
  private interpValueLabel: HTMLElement;
  // 補間ドラッグ中に固定する2ポーズ(ドラッグ開始時にスナップショット)
  private interpA: PoseData | null = null;
  private interpB: PoseData | null = null;
  private interpActive = false;

  constructor(callbacks: PoseLibraryCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement("div");
    this.element.className = "pose-lib";

    // ---- 適用範囲(部位) ----
    this.element.appendChild(subTitle("適用範囲(部位を選んで部分合成)"));
    const quickRow = document.createElement("div");
    quickRow.className = "button-row";
    const quickDefs: Array<[string, PosePart[], () => void]> = [
      ["全身", [...POSE_PARTS], () => this.setParts(POSE_PARTS)],
      ["上半身", [...UPPER_BODY_PARTS], () => this.setParts(UPPER_BODY_PARTS)],
      ["下半身", [...LOWER_BODY_PARTS], () => this.setParts(LOWER_BODY_PARTS)],
      ["クリア", [], () => this.setParts([])],
    ];
    for (const [label, parts, fn] of quickDefs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", fn);
      quickRow.appendChild(btn);
      this.quickButtons.push({ el: btn, parts });
    }
    this.element.appendChild(quickRow);

    const chipRow = document.createElement("div");
    chipRow.className = "pose-parts";
    for (const part of POSE_PARTS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pose-part-chip pose-part-chip--on";
      chip.textContent = PART_LABELS[part];
      chip.addEventListener("click", () => this.togglePart(part));
      chipRow.appendChild(chip);
      this.partChips.set(part, chip);
    }
    this.element.appendChild(chipRow);
    this.updatePartChips();

    const partHint = document.createElement("div");
    partHint.className = "model-status";
    partHint.textContent =
      "選択した部位のみプリセット/ライブラリのポーズを反映します(補間は全身)。";
    this.element.appendChild(partHint);

    // ---- 内蔵プリセット ----
    this.element.appendChild(subTitle("内蔵プリセット"));
    this.element.appendChild(this.buildPresetGallery());

    // ---- マイライブラリ ----
    this.element.appendChild(subTitle("マイライブラリ"));
    const saveRow = document.createElement("div");
    saveRow.className = "finger-panel__save";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "ポーズ名";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "現在のポーズを保存";
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim() || this.defaultPoseName();
      const pose = this.callbacks.getCurrentPose();
      const thumbnail = this.callbacks.renderThumbnail(pose);
      // 保存はサムネイル(dataURL)を含むため容量超過で失敗しうる。失敗を伝えずに
      // refreshLibrary()すると「保存を押したのに一覧に出ない」だけになる(2026-08-18修正)。
      if (!addSavedPose({ name, pose, thumbnail })) {
        showToast(SAVE_FAILED_MESSAGE);
        return;
      }
      nameInput.value = "";
      this.refreshLibrary();
    });
    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.textContent = "ファイルから読込";
    importBtn.addEventListener("click", () => this.importPose());
    saveRow.appendChild(nameInput);
    saveRow.appendChild(saveBtn);
    saveRow.appendChild(importBtn);
    this.element.appendChild(saveRow);

    this.libraryGrid = document.createElement("div");
    this.libraryGrid.className = "pose-grid";
    this.element.appendChild(this.libraryGrid);
    this.libraryEmpty = document.createElement("div");
    this.libraryEmpty.className = "model-status";
    this.libraryEmpty.textContent = "保存したポーズはまだありません。";
    this.element.appendChild(this.libraryEmpty);

    // ---- 補間 ----
    this.element.appendChild(subTitle("ポーズ補間(2つの中間を作る)"));
    const interpRow = document.createElement("div");
    interpRow.className = "pose-interp__selects";
    this.interpSelectA = document.createElement("select");
    this.interpSelectB = document.createElement("select");
    const arrow = document.createElement("span");
    arrow.className = "pose-interp__arrow";
    arrow.textContent = "→";
    interpRow.appendChild(this.interpSelectA);
    interpRow.appendChild(arrow);
    interpRow.appendChild(this.interpSelectB);
    this.element.appendChild(interpRow);

    const sliderRow = document.createElement("div");
    sliderRow.className = "slider-row";
    const sliderLabel = document.createElement("span");
    sliderLabel.textContent = "中間";
    this.interpSlider = document.createElement("input");
    this.interpSlider.type = "range";
    this.interpSlider.min = "0";
    this.interpSlider.max = "100";
    this.interpSlider.value = "50";
    this.interpValueLabel = document.createElement("span");
    this.interpValueLabel.className = "slider-row__value";
    this.interpValueLabel.textContent = "50%";
    // ドラッグ開始でA/Bを固定し履歴を1回積む
    const startInterp = (): void => {
      if (this.interpActive) return;
      this.interpActive = true;
      this.interpA = this.resolvePose(this.interpSelectA.value);
      this.interpB = this.resolvePose(this.interpSelectB.value);
      this.callbacks.onInterpBegin();
    };
    this.interpSlider.addEventListener("input", () => {
      startInterp();
      const t = Number(this.interpSlider.value) / 100;
      this.interpValueLabel.textContent = `${this.interpSlider.value}%`;
      if (this.interpA && this.interpB) {
        this.callbacks.onInterpPreview(blendPoses(this.interpA, this.interpB, t));
      }
    });
    // ドラッグ確定でセッション終了(次のドラッグで再スナップショット)
    this.interpSlider.addEventListener("change", () => {
      this.interpActive = false;
    });
    this.interpSelectA.addEventListener("change", () => (this.interpActive = false));
    this.interpSelectB.addEventListener("change", () => (this.interpActive = false));
    sliderRow.appendChild(sliderLabel);
    sliderRow.appendChild(this.interpSlider);
    sliderRow.appendChild(this.interpValueLabel);
    this.element.appendChild(sliderRow);

    const interpHint = document.createElement("div");
    interpHint.className = "model-status";
    interpHint.textContent =
      "始点(左)と終点(右)を選び、スライダーで中間ポーズを現在の姿勢に反映します。気に入った結果は「現在のポーズを保存」で保存できます。";
    this.element.appendChild(interpHint);

    this.refreshLibrary();
  }

  // ---- 適用範囲 ----
  private togglePart(part: PosePart): void {
    if (this.selectedParts.has(part)) this.selectedParts.delete(part);
    else this.selectedParts.add(part);
    this.updatePartChips();
  }

  private setParts(parts: Iterable<PosePart>): void {
    this.selectedParts = new Set(parts);
    this.updatePartChips();
  }

  private updatePartChips(): void {
    for (const [part, chip] of this.partChips) {
      chip.classList.toggle("pose-part-chip--on", this.selectedParts.has(part));
    }
    for (const { el, parts } of this.quickButtons) {
      const matches =
        parts.length === this.selectedParts.size && parts.every((p) => this.selectedParts.has(p));
      el.classList.toggle("button--active", matches);
    }
  }

  // ---- 内蔵プリセット ----
  private buildPresetGallery(): HTMLElement {
    const wrap = document.createElement("div");
    for (const category of CATEGORY_ORDER) {
      const defs = POSE_PRESET_DEFS.filter((d) => d.category === category);
      if (defs.length === 0) continue;
      wrap.appendChild(subTitle(CATEGORY_LABELS[category]));
      const grid = document.createElement("div");
      grid.className = "pose-grid";
      for (const def of defs) {
        grid.appendChild(this.buildPresetCard(def));
      }
      wrap.appendChild(grid);
    }
    return wrap;
  }

  private buildPresetCard(def: PosePresetDef): HTMLElement {
    const pose = buildPresetPose(def);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pose-card";
    card.title = `${def.label}(選択中の部位に適用)`;
    const img = document.createElement("img");
    img.src = this.callbacks.renderThumbnail(pose);
    img.alt = def.label;
    const label = document.createElement("span");
    label.className = "pose-card__label";
    label.textContent = def.label;
    card.appendChild(img);
    card.appendChild(label);
    const key = `preset:${def.id}`;
    card.addEventListener("click", () => {
      this.selectPoseCard(key);
      this.callbacks.onApplyPose(pose, new Set(this.selectedParts));
    });
    this.poseCardButtons.set(key, card);
    return card;
  }

  // ---- マイライブラリ ----
  private defaultPoseName(): string {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `ポーズ ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private async importPose(): Promise<void> {
    const file = await this.callbacks.onImportPose();
    if (!file) return;
    const name = file.name?.trim() || this.defaultPoseName();
    const thumbnail = file.thumbnail || this.callbacks.renderThumbnail(file.pose);
    if (!addSavedPose({ name, pose: file.pose, thumbnail })) {
      showToast(SAVE_FAILED_MESSAGE);
      return;
    }
    this.refreshLibrary();
  }

  refreshLibrary(): void {
    const poses = loadPoseLibrary();
    this.libraryGrid.innerHTML = "";
    // マイライブラリ側のボタン参照は再構築されるので古いものを捨てる(プリセット側は不変なので残す)
    for (const key of this.poseCardButtons.keys()) {
      if (key.startsWith("saved:")) this.poseCardButtons.delete(key);
    }
    this.libraryEmpty.style.display = poses.length === 0 ? "" : "none";
    for (const saved of poses) {
      this.libraryGrid.appendChild(this.buildSavedCard(saved));
    }
    this.applySelectedPoseVisual();
    this.refreshInterpOptions();
  }

  // ---- 選択中カードのハイライト ----
  private selectPoseCard(key: string): void {
    this.selectedPoseKey = key;
    this.applySelectedPoseVisual();
  }

  private applySelectedPoseVisual(): void {
    for (const [key, el] of this.poseCardButtons) {
      el.classList.toggle("pose-card--selected", key === this.selectedPoseKey);
    }
  }

  private buildSavedCard(saved: SavedPose): HTMLElement {
    const card = document.createElement("div");
    card.className = "pose-card pose-card--saved";

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "pose-card__apply";
    applyBtn.title = `${saved.name}(選択中の部位に適用)`;
    const img = document.createElement("img");
    img.src = saved.thumbnail;
    img.alt = saved.name;
    const label = document.createElement("span");
    label.className = "pose-card__label";
    label.textContent = saved.name;
    applyBtn.appendChild(img);
    applyBtn.appendChild(label);
    const key = `saved:${saved.id}`;
    applyBtn.addEventListener("click", () => {
      this.selectPoseCard(key);
      this.callbacks.onApplyPose(saved.pose, new Set(this.selectedParts));
    });
    card.appendChild(applyBtn);
    this.poseCardButtons.set(key, card);

    const actions = document.createElement("div");
    actions.className = "pose-card__actions";
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.textContent = "書出";
    exportBtn.title = "このポーズをファイルに書き出す";
    exportBtn.addEventListener("click", () => {
      const file: PoseLibraryFile = {
        formatVersion: POSE_LIBRARY_FORMAT_VERSION,
        name: saved.name,
        thumbnail: saved.thumbnail,
        pose: saved.pose,
      };
      this.callbacks.onExportPose(file, saved.name);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "削除";
    delBtn.className = "pose-card__delete";
    delBtn.title = "このポーズを削除";
    delBtn.addEventListener("click", () => {
      removeSavedPose(saved.id);
      this.refreshLibrary();
    });
    actions.appendChild(exportBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);
    return card;
  }

  // ---- 補間セレクト ----
  private refreshInterpOptions(): void {
    const prevA = this.interpSelectA.value;
    const prevB = this.interpSelectB.value;
    for (const sel of [this.interpSelectA, this.interpSelectB]) {
      sel.innerHTML = "";
      const current = document.createElement("option");
      current.value = "current";
      current.textContent = "現在のポーズ";
      sel.appendChild(current);

      for (const category of CATEGORY_ORDER) {
        const defs = POSE_PRESET_DEFS.filter((d) => d.category === category);
        if (defs.length === 0) continue;
        const group = document.createElement("optgroup");
        group.label = CATEGORY_LABELS[category];
        for (const def of defs) {
          const opt = document.createElement("option");
          opt.value = `preset:${def.id}`;
          opt.textContent = def.label;
          group.appendChild(opt);
        }
        sel.appendChild(group);
      }

      const saved = loadPoseLibrary();
      if (saved.length > 0) {
        const group = document.createElement("optgroup");
        group.label = "マイライブラリ";
        for (const s of saved) {
          const opt = document.createElement("option");
          opt.value = `saved:${s.id}`;
          opt.textContent = s.name;
          group.appendChild(opt);
        }
        sel.appendChild(group);
      }
    }
    // 既存選択を可能な限り維持し、無ければ既定値
    this.interpSelectA.value = prevA || "current";
    if (!this.interpSelectA.value) this.interpSelectA.value = "current";
    this.interpSelectB.value = prevB || (POSE_PRESET_DEFS[0] ? `preset:${POSE_PRESET_DEFS[0].id}` : "current");
    if (!this.interpSelectB.value) this.interpSelectB.value = "current";
  }

  private resolvePose(value: string): PoseData {
    if (value === "current") return this.callbacks.getCurrentPose();
    if (value.startsWith("preset:")) {
      const id = value.slice("preset:".length);
      const def = POSE_PRESET_DEFS.find((d) => d.id === id);
      if (def) return buildPresetPose(def);
    }
    if (value.startsWith("saved:")) {
      const id = value.slice("saved:".length);
      const saved = loadPoseLibrary().find((s) => s.id === id);
      if (saved) return saved.pose;
    }
    return this.callbacks.getCurrentPose();
  }
}
