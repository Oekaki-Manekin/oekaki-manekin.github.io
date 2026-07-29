import { SHORTCUTS } from "../config/shortcuts";

export class ShortcutHelp {
  readonly element: HTMLElement;
  private visible = false;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "modal-overlay modal-overlay--hidden";

    const box = document.createElement("div");
    box.className = "modal-box";

    const title = document.createElement("h2");
    title.textContent = "キーボードショートカット";
    box.appendChild(title);

    const list = document.createElement("dl");
    list.className = "shortcut-list";
    for (const s of SHORTCUTS) {
      const dt = document.createElement("dt");
      dt.textContent = s.keys;
      const dd = document.createElement("dd");
      dd.textContent = s.description;
      list.appendChild(dt);
      list.appendChild(dd);
    }
    box.appendChild(list);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "modal-box__close";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => this.hide());
    box.appendChild(closeBtn);

    this.element.appendChild(box);
    this.element.addEventListener("click", (e) => {
      if (e.target === this.element) this.hide();
    });
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.element.classList.remove("modal-overlay--hidden");
  }

  hide(): void {
    this.visible = false;
    this.element.classList.add("modal-overlay--hidden");
  }
}
