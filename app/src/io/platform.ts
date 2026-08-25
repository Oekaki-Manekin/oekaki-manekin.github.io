// ブラウザ固有APIへの依存を隔離する薄いラッパー層。
// 将来Tauri化(フェーズ7)する際は、このファイルの実装をネイティブAPI呼び出しに差し替えるだけで済むようにする。

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, content: string, mime = "application/json"): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export interface OpenedFile {
  name: string;
  text: string;
}

/** ファイル選択ダイアログを開き、選択されたテキストファイルの内容を返す */
export function openTextFile(accept: string): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}

export interface OpenedBinaryFile {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * openBinaryFileの結果。「キャンセル」と「読み込み失敗」を呼び出し側で区別できるようにする。
 * かつてはどちらもnullで返していたため、破損・ロック・ディスクエラーで読めなかった場合に
 * 何のメッセージも出ず無反応で終わっていた(パース失敗はトーストが出るのに読み込み失敗だけ
 * 無言、という非対称になっていた。2026-08-18検出)。
 */
export type OpenBinaryResult =
  | { ok: true; file: OpenedBinaryFile }
  | { ok: false; reason: "cancelled" | "readError" };

/** ファイル選択ダイアログを開き、選択されたファイルをバイナリ(ArrayBuffer)で返す(VRM等) */
export function openBinaryFile(accept: string): Promise<OpenBinaryResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ ok: false, reason: "cancelled" });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ ok: true, file: { name: file.name, buffer: reader.result as ArrayBuffer } });
      reader.onerror = () => resolve({ ok: false, reason: "readError" });
      reader.readAsArrayBuffer(file);
    });
    input.click();
  });
}

export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /**
   * 保存を試み、成否を返す。
   * かつては例外を握り潰してvoidを返していたため、オートセーブ(静かに失敗してよい)と
   * 明示的なユーザー操作による保存(失敗を伝えなければならない)が区別できず、
   * 「保存を押したのに一覧に出ない」だけが起きていた(2026-08-18検出)。
   * 呼び出し側が成否を見て扱いを決めること。
   */
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      // 容量超過・プライベートモード等。アプリ本体は継続動作させる。
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  },
};
