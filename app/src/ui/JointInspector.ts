import { BONE_DEF_MAP, type BoneName } from "../config/boneDefs";
import type { EulerDeg } from "../posing/GizmoController";

export class JointInspector {
  readonly element: HTMLElement;
  private titleEl: HTMLElement;
  private inputs: { x: HTMLInputElement; y: HTMLInputElement; z: HTMLInputElement };
  private currentBone: BoneName | null = null;
  // 入力欄が空・不正なときに「その軸の現在値」として使う直近の確定値。
  // 選択の切替(setSelected)とギズモ操作の反映(updateValues)でも更新すること。
  private lastKnownEuler: EulerDeg = { x: 0, y: 0, z: 0 };
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
    // 打ち直しの途中(欄を全消しした瞬間、"-"だけ入力した瞬間)に0を適用してしまうと、
    // その軸のボーンが一瞬0度へ跳ねる(Number("")もNumber("-")も || 0 で0になっていた)。
    // 不正な入力の間はその軸の現在値を維持する(2026-08-18修正)。
    const pick = (input: HTMLInputElement, current: number): number => {
      const raw = input.value.trim();
      if (raw === "" || raw === "-") return current;
      const v = Number(raw);
      return Number.isFinite(v) ? v : current;
    };
    const euler: EulerDeg = {
      x: pick(this.inputs.x, this.lastKnownEuler.x),
      y: pick(this.inputs.y, this.lastKnownEuler.y),
      z: pick(this.inputs.z, this.lastKnownEuler.z),
    };
    this.lastKnownEuler = euler;
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
      this.lastKnownEuler = { x: 0, y: 0, z: 0 };
    }
  }

  /** ドラッグ中など外部からの角度更新をフォーム表示に反映する(フォーカス中は上書きしない) */
  updateValues(euler: EulerDeg): void {
    // 表示の上書きはフォーカス中だけ避けるが、「現在値」の記憶は常に最新へ揃える
    // (打ち直し途中の欄が空でも、他の軸の値は正しく維持されるようにするため)。
    this.lastKnownEuler = euler;
    if (document.activeElement !== this.inputs.x) this.inputs.x.value = euler.x.toFixed(1);
    if (document.activeElement !== this.inputs.y) this.inputs.y.value = euler.y.toFixed(1);
    if (document.activeElement !== this.inputs.z) this.inputs.z.value = euler.z.toFixed(1);
  }
}
