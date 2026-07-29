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

/** ファイル選択ダイアログを開き、選択されたファイルをバイナリ(ArrayBuffer)で返す(VRM等) */
export function openBinaryFile(accept: string): Promise<OpenedBinaryFile | null> {
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
      reader.onload = () => resolve({ name: file.name, buffer: reader.result as ArrayBuffer });
      reader.onerror = () => resolve(null);
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
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 容量超過等は無視する(オートセーブが失敗してもアプリ本体は継続動作させる)
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
