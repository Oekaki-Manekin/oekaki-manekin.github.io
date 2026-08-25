/**
 * 現在開いているモーダルの数を1箇所で持つ。ConfirmDialog / ShortcutHelp が開閉時に更新する。
 *
 * 参照元は2つあり、どちらも「モーダルを1つの状態として管理していない」ことが根であるため同じ数を見る。
 *   (a) キーボードショートカットの抑制(main.ts)
 *       確認ダイアログの裏でミラーや視点プリセットが動くと、OKを押した時点で
 *       ユーザーが見ていた状態とは違うシーンが書き出されてしまう。
 *   (b) 確認ダイアログの多重表示防止(ConfirmDialog)
 *       ボタンの二度押しでダイアログが2枚重なり、1枚目にOKしても
 *       「クリックが効かなかった」と誤解してもう一度OKを押す動線になっていた。
 *
 * 数えるだけの単純な仕組みにしてあるのは、モーダルを増やしたときに
 * push/pop の対を書くだけで両方の抑制が同時に効くようにするため。
 * モーダルUIを追加した場合は必ずここへ push/pop を通すこと。
 */
let openCount = 0;

export function pushModal(): void {
  openCount++;
}

export function popModal(): void {
  // 二重に閉じられても負にならないようにする(閉じる経路が複数あるモーダルへの備え)。
  openCount = Math.max(0, openCount - 1);
}

export function isModalOpen(): boolean {
  return openCount > 0;
}
