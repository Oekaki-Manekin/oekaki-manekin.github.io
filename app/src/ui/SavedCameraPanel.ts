import { loadSavedCameras, type SavedCameraView } from "../io/savedCameraStorage";

export interface SavedCameraCallbacks {
  onSaveCameraView(name: string): void;
  onApplyCameraView(view: SavedCameraView): void;
  onDeleteCameraView(id: string): void;
}

/** 保存済みカメラ構図(複数スロット・名前付き)の保存・一覧・呼び出しUI。 */
export class SavedCameraPanel {
  readonly element: HTMLElement;
  private listEl: HTMLElement;
  private nameInput: HTMLInputElement;

  constructor(private callbacks: SavedCameraCallbacks) {
    this.element = document.createElement("div");

    const saveRow = document.createElement("div");
    saveRow.className = "finger-panel__save";
    this.nameInput = document.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.placeholder = "構図の名前";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "現在の構図を保存";
    saveBtn.addEventListener("click", () => {
      const name = this.nameInput.value.trim() || "構図";
      callbacks.onSaveCameraView(name);
      this.nameInput.value = "";
      this.refreshList();
    });
    saveRow.appendChild(this.nameInput);
    saveRow.appendChild(saveBtn);
    this.element.appendChild(saveRow);

    this.listEl = document.createElement("div");
    this.listEl.className = "camera-view-list";
    this.element.appendChild(this.listEl);

    this.refreshList();
  }

  refreshList(): void {
    this.listEl.replaceChildren();
    const views = loadSavedCameras();
    if (views.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-status";
      empty.textContent = "保存した構図はありません。";
      this.listEl.appendChild(empty);
      return;
    }
    const applyButtons: HTMLButtonElement[] = [];
    for (const view of views) {
      const row = document.createElement("div");
      row.className = "finger-preset-chip";
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.textContent = view.name;
      applyBtn.title = "この構図を呼び出す";
      applyBtn.addEventListener("click", () => {
        for (const b of applyButtons) b.classList.remove("button--active");
        applyBtn.classList.add("button--active");
        this.callbacks.onApplyCameraView(view);
      });
      applyButtons.push(applyBtn);
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "finger-preset-chip__delete";
      delBtn.textContent = "×";
      delBtn.title = "削除";
      delBtn.addEventListener("click", () => {
        this.callbacks.onDeleteCameraView(view.id);
        this.refreshList();
      });
      row.appendChild(applyBtn);
      row.appendChild(delBtn);
      this.listEl.appendChild(row);
    }
  }
}
