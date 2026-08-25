import { isModalOpen, popModal, pushModal } from "./modalState";

/**
 * 汎用の確認モーダル。OK/キャンセルの選択結果をPromiseで返す。
 *
 * 既に別のモーダルが開いている場合は新しく開かず、即座にfalse(キャンセル相当)で解決する。
 * ボタンの二度押しでダイアログが2枚重なると、1枚目にOKしても背後にもう1枚見えているため
 * 「クリックが効かなかった」と誤解してもう一度OKを押してしまい、書き出しが2本同時に走る動線が
 * あった(2026-08-18検出)。安全側=キャンセルに倒すのは、書き出しやポーズ復元のような
 * 「実行してしまうと戻せない/戻しにくい」操作の確認に使われるため。
 */
export function showConfirmDialog(message: string, okLabel = "OK", cancelLabel = "キャンセル"): Promise<boolean> {
  if (isModalOpen()) return Promise.resolve(false);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box modal-box--confirm";

    const text = document.createElement("p");
    text.textContent = message;
    box.appendChild(text);

    const buttonRow = document.createElement("div");
    buttonRow.className = "modal-box__buttons";

    let finished = false;
    const finish = (result: boolean): void => {
      // Escキーとボタンクリックが同時に走っても二重にpopModal()しないようにする。
      if (finished) return;
      finished = true;
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.removeChild(overlay);
      popModal();
      resolve(result);
    };

    // Escでキャンセルできるようにする(モーダル表示中はmain.ts側のショートカットが止まるため、
    // ここで拾わないとキーボードだけでは閉じられない)。captureで拾い、背後へ伝播させない。
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener("click", () => finish(false));

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "button--primary";
    okBtn.textContent = okLabel;
    okBtn.addEventListener("click", () => finish(true));

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);
    box.appendChild(buttonRow);
    overlay.appendChild(box);
    pushModal();
    document.body.appendChild(overlay);
  });
}
