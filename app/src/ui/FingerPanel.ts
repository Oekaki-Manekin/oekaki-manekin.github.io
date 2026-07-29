import type { BoneName, Side } from "../config/boneDefs";
import { BUILTIN_FINGER_PRESETS, type FingerPreset } from "../config/fingerPresets";
import { loadCustomFingerPresets } from "../io/fingerPresetStorage";
import { JointListPanel } from "./JointListPanel";

export interface FingerPanelCallbacks {
  onSelectBone(name: BoneName): void;
  onApplyPreset(side: Side, preset: FingerPreset): void;
  onSaveCustomPreset(side: Side, label: string): void;
  onDeleteCustomPreset(id: string): void;
}

function presetRow(side: Side, label: string, callbacks: FingerPanelCallbacks, container: HTMLElement): void {
  const heading = document.createElement("div");
  heading.className = "joint-list__group-title";
  heading.textContent = label;
  container.appendChild(heading);

  const row = document.createElement("div");
  row.className = "button-row";
  const presets = [...BUILTIN_FINGER_PRESETS, ...loadCustomFingerPresets()];
  const presetButtons: HTMLButtonElement[] = [];
  for (const preset of presets) {
    const wrap = document.createElement("span");
    wrap.className = "finger-preset-chip";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      for (const b of presetButtons) b.classList.remove("button--active");
      btn.classList.add("button--active");
      callbacks.onApplyPreset(side, preset);
    });
    presetButtons.push(btn);
    wrap.appendChild(btn);
    if (preset.custom) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "finger-preset-chip__delete";
      del.textContent = "×";
      del.title = "このプリセットを削除";
      del.addEventListener("click", () => callbacks.onDeleteCustomPreset(preset.id));
      wrap.appendChild(del);
    }
    row.appendChild(wrap);
  }
  container.appendChild(row);
}

export class FingerPanel {
  readonly element: HTMLElement;
  private presetsContainer: HTMLElement;
  private fingerList: JointListPanel;
  private callbacks: FingerPanelCallbacks;

  constructor(callbacks: FingerPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement("div");

    this.presetsContainer = document.createElement("div");
    this.element.appendChild(this.presetsContainer);
    this.renderPresets();

    const saveRow = document.createElement("div");
    saveRow.className = "finger-panel__save";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "プリセット名";
    const saveLeftBtn = document.createElement("button");
    saveLeftBtn.type = "button";
    saveLeftBtn.textContent = "左手の形を保存";
    saveLeftBtn.addEventListener("click", () => {
      const label = nameInput.value.trim();
      if (!label) return;
      callbacks.onSaveCustomPreset("left", label);
      nameInput.value = "";
      this.renderPresets();
    });
    const saveRightBtn = document.createElement("button");
    saveRightBtn.type = "button";
    saveRightBtn.textContent = "右手の形を保存";
    saveRightBtn.addEventListener("click", () => {
      const label = nameInput.value.trim();
      if (!label) return;
      callbacks.onSaveCustomPreset("right", label);
      nameInput.value = "";
      this.renderPresets();
    });
    saveRow.appendChild(nameInput);
    saveRow.appendChild(saveLeftBtn);
    saveRow.appendChild(saveRightBtn);
    this.element.appendChild(saveRow);

    const details = document.createElement("details");
    details.className = "finger-panel__details";
    const summary = document.createElement("summary");
    summary.textContent = "指を1本ずつ選択(FK)";
    details.appendChild(summary);
    this.fingerList = new JointListPanel((name) => callbacks.onSelectBone(name), ["leftFingers", "rightFingers"]);
    details.appendChild(this.fingerList.element);
    this.element.appendChild(details);
  }

  private renderPresets(): void {
    this.presetsContainer.innerHTML = "";
    presetRow("left", "左手プリセット", this.callbacks, this.presetsContainer);
    presetRow("right", "右手プリセット", this.callbacks, this.presetsContainer);
  }

  refreshPresets(): void {
    this.renderPresets();
  }

  setSelectedBone(name: BoneName | null): void {
    this.fingerList.setSelected(name);
  }

  setAvailableBones(available: ReadonlySet<BoneName> | null): void {
    this.fingerList.setAvailableBones(available);
  }
}
