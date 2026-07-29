import type { LimbEffector } from "./IkSolver";
import type { IkController } from "./IkController";
import type { Character } from "../character/Character";

/**
 * 手首・足首のピン留めを管理する。
 * ONにした瞬間の位置をIkController(共有ターゲットノード)に固定し、
 * 毎フレームその位置へ向けてIKを再解決することで、他の部位を動かしても位置を保つ。
 */
export class PinController {
  private pinned = new Set<LimbEffector>();
  private ikController: IkController;

  constructor(ikController: IkController) {
    this.ikController = ikController;
  }

  isPinned(effector: LimbEffector): boolean {
    return this.pinned.has(effector);
  }

  hasAnyPinned(): boolean {
    return this.pinned.size > 0;
  }

  /** ピンのON/OFFを切り替える。ONにした瞬間の現在位置を固定目標として記録する。 */
  setPinned(effector: LimbEffector, pinned: boolean, character: Character): void {
    if (pinned) {
      if (!this.ikController.ikSolver.hasChain(effector)) return;
      const target = this.ikController.ikSolver.getTargetNode(effector);
      const bone = character.bones[effector];
      if (!target || !bone) return;
      bone.getWorldPosition(target.position);
      this.pinned.add(effector);
    } else {
      this.pinned.delete(effector);
    }
    this.ikController.markPinned(effector, pinned);
  }

  /** 毎フレーム呼び出す。ピン中の全チェーンについて、記録した位置を維持するようIKを解決する。 */
  update(): void {
    for (const effector of this.pinned) {
      this.ikController.ikSolver.solve(effector);
    }
  }
}
