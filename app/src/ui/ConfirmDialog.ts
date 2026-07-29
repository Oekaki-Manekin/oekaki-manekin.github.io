/** 汎用の確認モーダル。OK/キャンセルの選択結果をPromiseで返す。 */
export function showConfirmDialog(message: string, okLabel = "OK", cancelLabel = "キャンセル"): Promise<boolean> {
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

    const finish = (result: boolean): void => {
      document.body.removeChild(overlay);
      resolve(result);
    };

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
    document.body.appendChild(overlay);
  });
}
