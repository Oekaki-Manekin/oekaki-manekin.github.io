let hideTimer: number | undefined;

/** 画面下部に一時的なエラーメッセージ等を表示する */
export function showToast(message: string, durationMs = 4000): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (el) el.style.display = "none";
  }, durationMs);
}
