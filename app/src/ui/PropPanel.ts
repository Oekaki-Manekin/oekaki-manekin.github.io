import { PROP_DEFS, PROP_ORDER, type PropTypeId } from "../config/propDefs";
import type { Side } from "../config/boneDefs";
import type { PropInstance, GizmoMode } from "../posing/PropController";

export interface PropPanelCallbacks {
  onAddProp(typeId: PropTypeId): void;
  onSelectProp(id: string | null): void;
  onDeleteProp(id: string): void;
  onAttachProp(id: string, side: Side): void;
  onDetachProp(id: string): void;
  onSetGizmoMode(mode: GizmoMode): void;
  /** "#rrggbb"形式のカラーピッカー値。小物の全パーツへ一括適用する。ドラッグ中も逐次呼ばれる。 */
  onSetPropColor(id: string, hexString: string): void;
}

const GIZMO_MODES: { mode: GizmoMode; label: string }[] = [
  { mode: "translate", label: "移動" },
  { mode: "rotate", label: "回転" },
  { mode: "scale", label: "拡大縮小" },
];

/** 小物(プロップ)の追加・一覧・持たせる/外す・自由配置ギズモモード切替UI。 */
export class PropPanel {
  readonly element: HTMLElement;
  private typeSelect: HTMLSelectElement;
  private listEl: HTMLElement;
  private actionsEl: HTMLElement;

  constructor(private callbacks: PropPanelCallbacks) {
    this.element = document.createElement("div");

    const addRow = document.createElement("div");
    addRow.className = "finger-panel__save";
    this.typeSelect = document.createElement("select");
    for (const typeId of PROP_ORDER) {
      const opt = document.createElement("option");
      opt.value = typeId;
      opt.textContent = PROP_DEFS[typeId].label;
      this.typeSelect.appendChild(opt);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "追加";
    addBtn.addEventListener("click", () => {
      callbacks.onAddProp(this.typeSelect.value as PropTypeId);
    });
    addRow.appendChild(this.typeSelect);
    addRow.appendChild(addBtn);
    this.element.appendChild(addRow);

    this.listEl = document.createElement("div");
    this.listEl.className = "prop-list";
    this.element.appendChild(this.listEl);

    this.actionsEl = document.createElement("div");
    this.element.appendChild(this.actionsEl);
  }

  refresh(instances: readonly PropInstance[], selectedId: string | null, gizmoMode: GizmoMode): void {
    this.listEl.replaceChildren();
    if (instances.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-status";
      empty.textContent = "配置した小物はありません。";
      this.listEl.appendChild(empty);
    } else {
      const typeSeq = new Map<PropTypeId, number>();
      for (const instance of instances) {
        const seq = (typeSeq.get(instance.typeId) ?? 0) + 1;
        typeSeq.set(instance.typeId, seq);

        const row = document.createElement("div");
        row.className = "prop-list__row";

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "joint-list__item" + (instance.id === selectedId ? " prop-list__item--active" : "");
        const stateLabel = instance.attachedTo === "left" ? "(左手)" : instance.attachedTo === "right" ? "(右手)" : "";
        selectBtn.textContent = `${PROP_DEFS[instance.typeId].label} ${seq} ${stateLabel}`.trim();
        selectBtn.addEventListener("click", () => this.callbacks.onSelectProp(instance.id));
        row.appendChild(selectBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "finger-preset-chip__delete";
        delBtn.textContent = "×";
        delBtn.title = "削除";
        delBtn.addEventListener("click", () => this.callbacks.onDeleteProp(instance.id));
        row.appendChild(delBtn);

        this.listEl.appendChild(row);
      }
    }

    this.renderActions(instances.find((i) => i.id === selectedId) ?? null, gizmoMode);
  }

  private renderActions(selected: PropInstance | null, gizmoMode: GizmoMode): void {
    this.actionsEl.replaceChildren();
    if (!selected) return;

    // 色は持たせ中・自由配置中どちらでも変更できるようにする(2026-07-27、ユーザー要望)。
    // 複数パーツで色が異なる小物(剣の柄・鍔・刀身等)では、既定表示は先頭パーツの色を代表値とする。
    const colorRow = document.createElement("div");
    colorRow.className = "slider-row";
    const colorLabelText = document.createElement("span");
    colorLabelText.textContent = "色";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    const currentColor = selected.colorOverride ?? PROP_DEFS[selected.typeId].parts[0].color;
    colorInput.value = `#${currentColor.toString(16).padStart(6, "0")}`;
    colorInput.addEventListener("input", () => {
      this.callbacks.onSetPropColor(selected.id, colorInput.value);
    });
    colorRow.appendChild(colorLabelText);
    colorRow.appendChild(colorInput);
    this.actionsEl.appendChild(colorRow);

    if (selected.attachedTo) {
      const row = document.createElement("div");
      row.className = "button-row";
      const detachBtn = document.createElement("button");
      detachBtn.type = "button";
      detachBtn.textContent = "外す";
      detachBtn.addEventListener("click", () => this.callbacks.onDetachProp(selected.id));
      row.appendChild(detachBtn);
      this.actionsEl.appendChild(row);
      return;
    }

    const holdRow = document.createElement("div");
    holdRow.className = "button-row";
    const leftBtn = document.createElement("button");
    leftBtn.type = "button";
    leftBtn.textContent = "左手に持たせる";
    leftBtn.addEventListener("click", () => this.callbacks.onAttachProp(selected.id, "left"));
    const rightBtn = document.createElement("button");
    rightBtn.type = "button";
    rightBtn.textContent = "右手に持たせる";
    rightBtn.addEventListener("click", () => this.callbacks.onAttachProp(selected.id, "right"));
    holdRow.appendChild(leftBtn);
    holdRow.appendChild(rightBtn);
    this.actionsEl.appendChild(holdRow);

    const gizmoTitle = document.createElement("div");
    gizmoTitle.className = "joint-list__group-title";
    gizmoTitle.textContent = "自由配置の操作";
    this.actionsEl.appendChild(gizmoTitle);

    const gizmoRow = document.createElement("div");
    gizmoRow.className = "button-row";
    for (const { mode, label } of GIZMO_MODES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (mode === gizmoMode) btn.classList.add("button--active");
      btn.addEventListener("click", () => this.callbacks.onSetGizmoMode(mode));
      gizmoRow.appendChild(btn);
    }
    this.actionsEl.appendChild(gizmoRow);
  }
}
