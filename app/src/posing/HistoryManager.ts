const MAX_HISTORY = 100;

/**
 * スナップショット方式によるUndo/Redo管理。
 * ボーン数が少なく状態が軽量なため、操作確定タイミングでの全体スナップショットを採用する。
 * Tにはポーズだけでなく「どのキャラクター種別のスナップショットか」等の付随情報も含められる。
 */
export class HistoryManager<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private getSnapshot: () => T;
  private applySnapshot: (snap: T) => void;

  constructor(getSnapshot: () => T, applySnapshot: (snap: T) => void) {
    this.getSnapshot = getSnapshot;
    this.applySnapshot = applySnapshot;
  }

  /** 変更を加える直前に呼び出し、変更前の状態を履歴に積む */
  beginChange(): void {
    this.undoStack.push(this.getSnapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.getSnapshot());
    this.applySnapshot(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.getSnapshot());
    this.applySnapshot(next);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
