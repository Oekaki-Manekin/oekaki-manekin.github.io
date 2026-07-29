import { BONE_DEFS, type BoneName } from "../config/boneDefs";

const GROUP_LABELS: Record<string, string> = {
  torso: "体幹",
  leftArm: "左腕",
  rightArm: "右腕",
  leftLeg: "左脚",
  rightLeg: "右脚",
  leftFingers: "左手指",
  rightFingers: "右手指",
};

const BODY_GROUP_ORDER = ["torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

export class JointListPanel {
  readonly element: HTMLElement;
  private itemByBone = new Map<BoneName, HTMLButtonElement>();
  private onSelect: (name: BoneName) => void;

  /** groupOrderを指定すると、その部位グループのみを表示する(指パネルでの再利用用) */
  constructor(onSelect: (name: BoneName) => void, groupOrder: string[] = BODY_GROUP_ORDER) {
    this.onSelect = onSelect;
    this.element = document.createElement("div");
    this.element.className = "joint-list";

    for (const group of groupOrder) {
      const defs = BONE_DEFS.filter((d) => d.group === group);
      if (defs.length === 0) continue;
      const heading = document.createElement("div");
      heading.className = "joint-list__group-title";
      heading.textContent = GROUP_LABELS[group];
      this.element.appendChild(heading);

      for (const def of defs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "joint-list__item";
        btn.textContent = def.label;
        btn.addEventListener("click", () => this.onSelect(def.name));
        this.element.appendChild(btn);
        this.itemByBone.set(def.name, btn);
      }
    }
  }

  setSelected(name: BoneName | null): void {
    for (const [bone, btn] of this.itemByBone) {
      btn.classList.toggle("joint-list__item--active", bone === name);
    }
  }

  /** 現在のキャラクターに存在しないボーンをリストで選択不可にする(VRMは一部ボーンを持たない場合がある) */
  setAvailableBones(available: ReadonlySet<BoneName> | null): void {
    for (const [bone, btn] of this.itemByBone) {
      const isAvailable = available === null || available.has(bone);
      btn.disabled = !isAvailable;
      btn.title = isAvailable ? "" : "このモデルにはこの部位がありません";
    }
  }
}
