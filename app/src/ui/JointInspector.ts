import { BONE_DEF_MAP, type BoneName } from "../config/boneDefs";
import type { EulerDeg } from "../posing/GizmoController";

export class JointInspector {
  readonly element: HTMLElement;
  private titleEl: HTMLElement;
  private inputs: { x: HTMLInputElement; y: HTMLInputElement; z: HTMLInputElement };
  private currentBone: BoneName | null = null;
  private onBeginEdit: () => void;
  private onChange: (name: BoneName, euler: EulerDeg) => void;

  constructor(onBeginEdit: () => void, onChange: (name: BoneName, euler: EulerDeg) => void) {
    this.onBeginEdit = onBeginEdit;
    this.onChange = onChange;

    this.element = document.createElement("div");
    this.element.className = "inspector";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "inspector__title";
    this.titleEl.textContent = "部位を選択してください";
    this.element.appendChild(this.titleEl);

    const row = document.createElement("div");
    row.className = "inspector__row";

    const makeField = (labelText: string): HTMLInputElement => {
      const wrap = document.createElement("label");
      wrap.className = "inspector__field";
      const span = document.createElement("span");
      span.textContent = labelText;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.disabled = true;
      wrap.appendChild(span);
      wrap.appendChild(input);
      row.appendChild(wrap);
      return input;
    };

    const x = makeField("X°");
    const y = makeField("Y°");
    const z = makeField("Z°");
    this.inputs = { x, y, z };
    this.element.appendChild(row);

    let editing = false;
    for (const [axis, input] of Object.entries(this.inputs) as [keyof EulerDeg, HTMLInputElement][]) {
      input.addEventListener("focus", () => {
        editing = false;
      });
      input.addEventListener("input", () => {
        if (!editing) {
          editing = true;
          this.onBeginEdit();
        }
        this.emitChange(axis);
      });
      input.addEventListener("blur", () => {
        editing = false;
      });
    }
  }

  private emitChange(_touchedAxis: keyof EulerDeg): void {
    if (!this.currentBone) return;
    const euler: EulerDeg = {
      x: Number(this.inputs.x.value) || 0,
      y: Number(this.inputs.y.value) || 0,
      z: Number(this.inputs.z.value) || 0,
    };
    this.onChange(this.currentBone, euler);
  }

  setSelected(name: BoneName | null, euler: EulerDeg | null): void {
    this.currentBone = name;
    const enabled = name !== null;
    this.inputs.x.disabled = !enabled;
    this.inputs.y.disabled = !enabled;
    this.inputs.z.disabled = !enabled;
    this.titleEl.textContent = name ? BONE_DEF_MAP[name].label : "部位を選択してください";
    if (euler) this.updateValues(euler);
    if (!euler) {
      this.inputs.x.value = "";
      this.inputs.y.value = "";
      this.inputs.z.value = "";
    }
  }

  /** ドラッグ中など外部からの角度更新をフォーム表示に反映する(フォーカス中は上書きしない) */
  updateValues(euler: EulerDeg): void {
    if (document.activeElement !== this.inputs.x) this.inputs.x.value = euler.x.toFixed(1);
    if (document.activeElement !== this.inputs.y) this.inputs.y.value = euler.y.toFixed(1);
    if (document.activeElement !== this.inputs.z) this.inputs.z.value = euler.z.toFixed(1);
  }
}
