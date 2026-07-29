// キーボードショートカット定義。一覧はShortcutHelpで表示する。

export interface ShortcutDef {
  keys: string;
  description: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "Ctrl + Z", description: "元に戻す (Undo)" },
  { keys: "Ctrl + Shift + Z", description: "やり直す (Redo)" },
  { keys: "R", description: "回転ギズモに切り替え" },
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
