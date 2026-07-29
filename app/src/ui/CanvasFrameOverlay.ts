export interface CanvasFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// B5/A4はJIS(日本)寸法。B5・A4はISO216の√2系列でほぼ同じ縦横比になるが、
// 用紙名としての分かりやすさを優先し別項目として残す。
export const CANVAS_FRAME_PRESETS = [
  { id: "b5", label: "B5", ratio: 182 / 257 },
  { id: "a4", label: "A4", ratio: 210 / 297 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "1:1", label: "1:1", ratio: 1 },
] as const;
export type CanvasFramePresetId = (typeof CANVAS_FRAME_PRESETS)[number]["id"] | "custom";

const DEFAULT_CUSTOM_RATIO: [number, number] = [4, 3];

/**
 * ビューポートに重ねる構図確認用の枠オーバーレイ。
 * 3Dシーンではなくビューポート上のHTML/CSS要素として実装している(枠はカメラの一部ではなく
 * 常に画面に対して固定の比率で表示するため、この方が単純)。
 * PNG書き出し時の枠内切り出し範囲(pngExporter.ts)もここから取得する。
 */
export class CanvasFrameOverlay {
  readonly element: HTMLElement;
  private container: HTMLElement;
  private visible = false;
  private presetId: CanvasFramePresetId = "b5";
  private swapped = false;
  private customRatio: [number, number] = DEFAULT_CUSTOM_RATIO;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement("div");
    this.element.className = "canvas-frame-overlay";
    this.element.style.display = "none";
    container.appendChild(this.element);
    this.resizeObserver = new ResizeObserver(() => this.updateLayout());
    this.resizeObserver.observe(container);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
    this.updateLayout();
  }

  setPreset(id: CanvasFramePresetId): void {
    this.presetId = id;
    this.updateLayout();
  }

  /** 縦横を入れ替える(プリセットの向きをそのまま使うか、90度回転するか)。 */
  setSwapped(swapped: boolean): void {
    this.swapped = swapped;
    this.updateLayout();
  }

  setCustomRatio(width: number, height: number): void {
    if (width > 0 && height > 0) this.customRatio = [width, height];
    this.updateLayout();
  }

  private currentRatio(): number {
    const base =
      this.presetId === "custom"
        ? this.customRatio[0] / this.customRatio[1]
        : CANVAS_FRAME_PRESETS.find((p) => p.id === this.presetId)!.ratio;
    return this.swapped ? 1 / base : base;
  }

  /** 枠の矩形(コンテナ基準のCSS px)。非表示中やコンテナサイズ0の場合はnull。 */
  getRect(): CanvasFrameRect | null {
    if (!this.visible) return null;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return null;
    const ratio = this.currentRatio();
    let width: number;
    let height: number;
    if (cw / ch > ratio) {
      height = ch;
      width = ch * ratio;
    } else {
      width = cw;
      height = cw / ratio;
    }
    return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
  }

  /** 書き出しキャンバスのピクセル座標系での枠範囲(devicePixelRatio分を反映)。非表示中はnull。 */
  getExportPixelRect(canvas: HTMLCanvasElement): CanvasFrameRect | null {
    const rect = this.getRect();
    if (!rect) return null;
    const scaleX = canvas.width / this.container.clientWidth;
    const scaleY = canvas.height / this.container.clientHeight;
    return {
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    };
  }

  private updateLayout(): void {
    const rect = this.getRect();
    if (!rect) return;
    this.element.style.left = `${rect.x}px`;
    this.element.style.top = `${rect.y}px`;
    this.element.style.width = `${rect.width}px`;
    this.element.style.height = `${rect.height}px`;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.element.remove();
  }
}
