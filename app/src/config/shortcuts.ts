// キーボードショートカット定義。一覧はShortcutHelpで表示する。

export interface ShortcutDef {
  keys: string;
  description: string;
}

// 【ルール】ここへ行を足すのは main.ts の keydown ハンドラに実装を入れた後にすること。
// かつて「R → 回転ギズモに切り替え」が一覧にだけ存在し、押しても何も起きない状態だった
// (そもそもFKギズモは回転モード固定で切り替え先が無い)。2026-08-18に該当行を削除。
export const SHORTCUTS: ShortcutDef[] = [
  { keys: "Ctrl + Z", description: "元に戻す (Undo)" },
  { keys: "Ctrl + Shift + Z", description: "やり直す (Redo)" },
  { keys: "Delete / Backspace", description: "選択中の部位をリセット" },
  { keys: "M", description: "ポーズを左右反転" },
  { keys: "1", description: "正面ビュー" },
  { keys: "3", description: "側面ビュー" },
  { keys: "7", description: "俯瞰ビュー" },
  { keys: "5", description: "背面ビュー" },
  { keys: "Esc", description: "選択解除" },
  { keys: "H", description: "ショートカット一覧の表示切り替え" },
  { keys: "I", description: "IKモードの切り替え" },
];
