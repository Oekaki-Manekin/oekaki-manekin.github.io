import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import type { CameraPreset } from "./cameraPresets";

// 輪郭線「実線」モード(2026-07-27、ユーザー要望)用のシャープなエッジ検出シェーダー。
// OutlinePass(フェードモード)は内部で必ずガウシアンブラーを掛ける構造上、輪郭が常に
// ぼやける。深度バッファの隣接ピクセル差分(視点空間の線形深度)を直接閾値判定することで、
// ブラーの掛からないくっきりした1本線を引く。thicknessはサンプリング距離(px)そのもので、
// スライダーの意味がそのまま「線の太さ」になる。
const SolidOutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    thickness: { value: 1.5 },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 100 },
    outlineColor: { value: new THREE.Color(0x1a1a1a) },
    // 曲率(二次微分)の相対しきい値。低ポリ形状(球・小物等)の1面ごとの小さな折れ(ファセット)を
    // 誤検出しないよう、実機での計測を経て調整した値(2026-07-28、詳細は§5参照)。
    relThreshold: { value: 0.02 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float thickness;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec3 outlineColor;
    uniform float relThreshold;
    varying vec2 vUv;

    float linearDepth(vec2 uv) {
      float depth = texture2D(tDepth, uv).x;
      return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    }

    // 二次微分(曲率)による相対エッジ量。直線的な勾配(面を斜めから見ているだけ)は
    // 角度に関わらず打ち消され、実際に深度プロファイルが折れ曲がる箇所(輪郭・折れ目)だけが
    // 値を持つ(2026-07-28、ユーザー報告:実線モードで角度によって面が黒く塗りつぶされる、への対応)。
    float curvature(vec2 uv, vec2 texel) {
      float center = linearDepth(uv);
      float d0 = linearDepth(uv + vec2(texel.x, 0.0));
      float d1 = linearDepth(uv - vec2(texel.x, 0.0));
      float d2 = linearDepth(uv + vec2(0.0, texel.y));
      float d3 = linearDepth(uv - vec2(0.0, texel.y));
      float curvX = abs(d0 + d1 - 2.0 * center);
      float curvY = abs(d2 + d3 - 2.0 * center);
      // 遠くのオブジェクトほど同じ見た目の境界でも視点空間の深度差が大きくなる(パースの影響)ため、
      // 絶対値ではなく中心深度に対する相対値で返す。
      return (curvX + curvY) / abs(center);
    }

    void main() {
      vec2 texel = thickness / resolution;
      vec2 px = 1.0 / resolution;
      // 1ピクセルにつき2x2のサブピクセル位置で曲率判定し平均する(スーパーサンプリング)。
      // 真の輪郭・折れ目は1px未満の距離で急激に立ち上がるため、中心1点だけのsmoothstepでは
      // 実質ハード判定のままでジャギが残る(2026-07-28、ユーザー報告)。サブピクセル位置をずらして
      // 複数回判定・平均することで、輪郭をまたぐピクセルだけ中間値になりアンチエイリアスが掛かる。
      float edge = 0.0;
      edge += smoothstep(relThreshold * 0.6, relThreshold * 1.4, curvature(vUv + vec2(-0.25, -0.25) * px, texel));
      edge += smoothstep(relThreshold * 0.6, relThreshold * 1.4, curvature(vUv + vec2( 0.25, -0.25) * px, texel));
      edge += smoothstep(relThreshold * 0.6, relThreshold * 1.4, curvature(vUv + vec2(-0.25,  0.25) * px, texel));
      edge += smoothstep(relThreshold * 0.6, relThreshold * 1.4, curvature(vUv + vec2( 0.25,  0.25) * px, texel));
      edge *= 0.25;
      vec4 baseColor = texture2D(tDiffuse, vUv);
      gl_FragColor = mix(baseColor, vec4(outlineColor, 1.0), edge);
    }
  `,
};

/**
 * 輪郭線(OutlinePassベース)の内部処理は、選択対象以外の
 * 「シーン全体」を独自に再描画して深度・マスクを作る。ギズモ(TransformControlsの矢印、
 * IKハンドル)やグリッド・光源マーカーはそのシーンに含まれてしまい、これらの細いジオメトリの
 * 深度エッジが誤って輪郭線として検出される(2026-07-27、ユーザー指摘: 床メッシュの外枠・
 * ギズモの軸線に断裂したアウトライン漏れ)。
 * composerのパス列にこのPassを挟み、outlinePassの実行直前・直後だけ
 * 対象オブジェクトのvisibleを切り替える(RenderPass自体は先に完了しているため、通常の
 * 見た目には影響しない)。
 */
// hide用とrestore用は別々のPassインスタンス(コンストラクタ参照)になるため、visibility記録を
// 各インスタンスのprivateフィールドに持たせるとrestore側は常に空配列のままになってしまい、
// `?? true`のフォールバックで対象オブジェクトが常にvisible=trueへ固定されてしまう
// (2026-07-27、ユーザー指摘: 輪郭線ONでギズモ・光源マーカーが強制的に表示され続けるバグ)。
// hide/restoreの2インスタンスで同じ配列を共有して記録・参照する。
interface VisibilityState {
  prevVisibility: boolean[];
}

class VisibilityTogglePass extends Pass {
  constructor(
    private getObjects: () => THREE.Object3D[],
    private hide: boolean,
    private state: VisibilityState,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(): void {
    const objects = this.getObjects();
    if (this.hide) {
      this.state.prevVisibility = objects.map((o) => o.visible);
      for (const o of objects) o.visible = false;
    } else {
      objects.forEach((o, i) => {
        o.visible = this.state.prevVisibility[i] ?? true;
      });
    }
  }
}

// グレースケール表示(フェーズ5)用の輝度変換シェーダー。OutputPass(sRGB変換)より前段、
// つまりリニア色空間のバッファに対して変換する(輪郭線パスと同じ経路)。
const GrayscaleShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float gray = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(vec3(gray), texel.a);
    }
  `,
};

export type RenderTick = (deltaSec: number) => void;

// 通常時の光量。環境光が強めなため、トゥーン調表示ではこのままだと画面全体が
// ほぼ最明部の1バンドに収まってしまい、陰影の段差(トゥーンらしい見た目)が出ない。
const BASE_AMBIENT_INTENSITY = 0.7;
const BASE_DIRECTIONAL_INTENSITY = 1.6;
// トゥーン調表示中だけ環境光を弱め・平行光を強めて明暗差を作る(陰影バンドを見せるための調整)
const TOON_AMBIENT_INTENSITY = 0.2;
const TOON_DIRECTIONAL_INTENSITY = 2.4;

// ライティング方向調整UI(方位・高さ)のデフォルト値。UI追加前の固定ライト位置(2,4,3)を
// 球面座標で正確に再現する値にしてあり、UI追加前後で既存の見た目(既にレビュー済みの陰影)が変わらないようにしている。
const LIGHT_DISTANCE = Math.sqrt(2 ** 2 + 4 ** 2 + 3 ** 2);
const DEFAULT_LIGHT_AZIMUTH_DEG = THREE.MathUtils.radToDeg(Math.atan2(2, 3));
const DEFAULT_LIGHT_ELEVATION_DEG = THREE.MathUtils.radToDeg(Math.asin(4 / LIGHT_DISTANCE));
// 光源位置マーカー・ドラッグハンドルの表示距離。平行光源(DirectionalLight)は向きだけが陰影・影に
// 影響し距離には依存しないため、実際の光源(directionalLight.position、LIGHT_DISTANCEのまま)とは
// 独立してマーカーだけモデルに近づけても見た目は変わらない。操作しやすさのため実距離の半分にする。
const LIGHT_MARKER_DISTANCE = LIGHT_DISTANCE * 0.5;
const _tmpLightDir = new THREE.Vector3();

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  focalLength: number;
}

/**
 * レンダラー/カメラ/OrbitControls/ライト/床グリッドの初期化とレンダリングループを担当する。
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly orbitControls: OrbitControls;
  readonly directionalLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.AmbientLight;
  /** 光源のドラッグハンドル(紫球)。LightDragControllerがこれをレイキャストで直接掴んでドラッグする。 */
  readonly lightHandle: THREE.Mesh;
  private lightMarker: THREE.Mesh;
  private gridHelper: THREE.GridHelper;
  private container: HTMLElement;
  private clock: THREE.Clock;
  private tickCallbacks: RenderTick[] = [];
  private rafId = 0;
  private resizeObserver: ResizeObserver;
  private sizeCheckBuf = new THREE.Vector2();
  // 輪郭線表示(フェーズ5)用のpost-processingパイプライン。
  // 通常時はrenderer.render()を直接呼ぶ既存経路のまま維持し、輪郭線ON時のみcomposer経由に切り替える
  // (無効時の描画コスト・挙動を変えないため)。
  private composer: EffectComposer;
  private depthTexture: THREE.DepthTexture;
  private depthOnlyRenderTarget: THREE.WebGLRenderTarget;
  private outlinePass: OutlinePass;
  private solidOutlinePass: ShaderPass;
  /** 輪郭線・選択インジケーターの検出対象から除外するオブジェクト(ギズモ・IKハンドル等)。 */
  private outlineExcludedObjects: THREE.Object3D[] = [];
  private outlineEnabled = false;
  // 実線モードをデフォルトにする変更を一度試したが、ユーザー環境で輪郭線が見えない(かつ
  // ギズモ・光源マーカーが誤って表示されつづける別バグも重なった)との報告を受け、
  // デフォルトはフェード(既存のOutlinePass)に戻した(2026-07-27)。実線モードの実装自体は維持。
  private outlineMode: "fade" | "solid" = "fade";
  private grayscalePass: ShaderPass;
  private grayscaleEnabled = false;
  private backgroundColor = new THREE.Color(0x2b2b30);
  private backgroundTransparent = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = this.backgroundColor;

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    );
    this.camera.position.set(0, 1.0, 3.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.target.set(0, 0.9, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.update();

    this.ambientLight = new THREE.AmbientLight(0xffffff, BASE_AMBIENT_INTENSITY);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, BASE_DIRECTIONAL_INTENSITY);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.set(1024, 1024);
    this.directionalLight.shadow.camera.near = 0.1;
    this.directionalLight.shadow.camera.far = 15;
    this.directionalLight.shadow.camera.left = -2.5;
    this.directionalLight.shadow.camera.right = 2.5;
    this.directionalLight.shadow.camera.top = 2.5;
    this.directionalLight.shadow.camera.bottom = -2.5;
    // シャドウカメラ(OrthographicCamera)はnear/far/left/right/top/bottomを直接書き換えても
    // projectionMatrixが自動更新されない(three.jsのシャドウ描画パスはupdateProjectionMatrix()を
    // 呼ばずprojectionMatrixをそのまま使うため)。呼び忘れるとデフォルトの範囲(-5〜5等)のまま
    // 描画され、影が出ない/範囲が意図と異なるといった不具合になる。
    this.directionalLight.shadow.camera.updateProjectionMatrix();
    // シャドウマップの自己陰影による縞模様(シャドウアクネ)を避けるための軽いバイアス
    this.directionalLight.shadow.bias = -0.002;
    this.scene.add(this.directionalLight);

    // 光源位置マーカー(オレンジ球)とドラッグハンドル(紫球、掴みやすいようマーカーより一回り大きい)。
    // 平行光源自体は無限遠方向光のため位置に物理的な意味は無いが、方位・高さを直感的に把握・
    // 操作するための起点としてLIGHT_DISTANCE分離れた位置に表示する。既定では非表示。
    this.lightMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a }),
    );
    this.lightMarker.visible = false;
    this.scene.add(this.lightMarker);

    this.lightHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x9b30ff, transparent: true, opacity: 0.4 }),
    );
    this.lightHandle.visible = false;
    this.scene.add(this.lightHandle);

    this.setLightDirection(DEFAULT_LIGHT_AZIMUTH_DEG, DEFAULT_LIGHT_ELEVATION_DEG);

    this.gridHelper = new THREE.GridHelper(4, 20, 0x888888, 0x4a4a4f);
    this.scene.add(this.gridHelper);

    // 影を落とす床(グリッドと同サイズ)。ShadowMaterialは影が落ちる部分以外は完全に透明なので、
    // 影表示OFF(renderer.shadowMap.enabled=false)の間は何も描画されず既存の見た目に影響しない。
    const shadowFloorGeometry = new THREE.PlaneGeometry(4, 4);
    const shadowFloorMaterial = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowFloor = new THREE.Mesh(shadowFloorGeometry, shadowFloorMaterial);
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.receiveShadow = true;
    this.scene.add(shadowFloor);

    // 輪郭線・選択インジケーターの検出対象から除外する自前のオブジェクト。
    // ギズモ・IKハンドル(main.ts側の各コントローラーが持つ)はaddOutlineExcludedObject()で追加登録する。
    this.outlineExcludedObjects.push(this.gridHelper, this.lightMarker, this.lightHandle, shadowFloor);

    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 輪郭線「実線」モード(SolidOutlineShader)は深度バッファの隣接ピクセル差分を直接読む。
    // composerの共有レンダーターゲット(writeBuffer/readBufferが毎パスで入れ替わる)に
    // DepthTextureを取り付けると、「今まさに書き込み中のバッファの深度を同時に読む」
    // フィードバックループになりGL_INVALID_OPERATIONを起こす場合があるため、
    // composerの入れ替えとは無関係な専用レンダーターゲットへ都度シーンの深度だけを描く。
    const pixelRatio = this.renderer.getPixelRatio();
    this.depthTexture = new THREE.DepthTexture(
      container.clientWidth * pixelRatio,
      container.clientHeight * pixelRatio,
    );
    this.depthOnlyRenderTarget = new THREE.WebGLRenderTarget(
      container.clientWidth * pixelRatio,
      container.clientHeight * pixelRatio,
      { depthTexture: this.depthTexture },
    );
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // outlinePassは内部で「非選択オブジェクト全体」を独自に再描画して
    // 深度・マスクを作るため、その処理中だけギズモ等を隠す(RenderPassは既に完了しているので
    // 通常の見た目には影響しない)。
    const outlineVisibilityState: VisibilityState = { prevVisibility: [] };
    this.composer.addPass(new VisibilityTogglePass(() => this.outlineExcludedObjects, true, outlineVisibilityState));
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      this.scene,
      this.camera,
    );
    this.outlinePass.edgeStrength = 5.0;
    this.outlinePass.edgeThickness = 1.2;
    this.outlinePass.edgeGlow = 0.0;
    this.outlinePass.visibleEdgeColor.set(0x1a1a1a);
    this.outlinePass.hiddenEdgeColor.set(0x1a1a1a);
    this.outlinePass.enabled = false;
    this.composer.addPass(this.outlinePass);
    this.solidOutlinePass = new ShaderPass(SolidOutlineShader);
    this.solidOutlinePass.uniforms.tDepth.value = this.depthTexture;
    this.solidOutlinePass.uniforms.resolution.value.set(
      container.clientWidth * pixelRatio,
      container.clientHeight * pixelRatio,
    );
    this.solidOutlinePass.uniforms.cameraNear.value = this.camera.near;
    this.solidOutlinePass.uniforms.cameraFar.value = this.camera.far;
    this.solidOutlinePass.enabled = false;
    this.composer.addPass(this.solidOutlinePass);
    this.composer.addPass(new VisibilityTogglePass(() => this.outlineExcludedObjects, false, outlineVisibilityState));
    this.grayscalePass = new ShaderPass(GrayscaleShader);
    this.grayscalePass.enabled = false;
    this.composer.addPass(this.grayscalePass);
    // OutputPass: composer経由の描画はレンダーターゲットがリニア色空間のため、
    // 直接描画(renderer.render)時と違いsRGB変換が自動で掛からない。最終パスとして必須。
    this.composer.addPass(new OutputPass());

    this.clock = new THREE.Clock();

    // window.resizeだけでは、パネル幅の変更などレイアウトのみの変化やコンテナサイズが
    // 初期化時点でまだ0の場合に追従できないため、ResizeObserverでコンテナ自体を監視する
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.animate = this.animate.bind(this);
    this.animate();
  }

  addTick(cb: RenderTick): void {
    this.tickCallbacks.push(cb);
  }

  setGridVisible(visible: boolean): void {
    this.gridHelper.visible = visible;
  }

  isGridVisible(): boolean {
    return this.gridHelper.visible;
  }

  /** 焦点距離(mm相当)を設定する。35mm判換算。 */
  setFocalLength(mm: number): void {
    this.camera.setFocalLength(mm);
  }

  getFocalLength(): number {
    return this.camera.getFocalLength();
  }

  applyCameraPreset(preset: CameraPreset): void {
    this.camera.position.set(...preset.position);
    this.orbitControls.target.set(...preset.target);
    this.camera.lookAt(this.orbitControls.target);
    this.orbitControls.update();
  }

  /** 現在のカメラ位置・注視点・焦点距離を取得する(構図の保存・多角度書き出しでの復元用)。 */
  getCameraState(): CameraState {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.orbitControls.target.x, this.orbitControls.target.y, this.orbitControls.target.z],
      focalLength: this.getFocalLength(),
    };
  }

  /** 保存済みの構図(位置・注視点・焦点距離)を復元する。cameraPresetsの視点プリセットと違い焦点距離も含む。 */
  applyCameraState(state: CameraState): void {
    this.camera.position.set(...state.position);
    this.orbitControls.target.set(...state.target);
    this.camera.lookAt(this.orbitControls.target);
    this.orbitControls.update();
    this.setFocalLength(state.focalLength);
  }

  setBackgroundTransparent(transparent: boolean): void {
    this.backgroundTransparent = transparent;
    this.scene.background = transparent ? null : this.backgroundColor;
    this.renderer.setClearAlpha(transparent ? 0 : 1);
  }

  /** 背景色を変更する(カラーピッカー用)。透過表示中は色だけ保持し、透過解除時に反映する。 */
  setBackgroundColor(hex: number): void {
    this.backgroundColor.setHex(hex);
    if (!this.backgroundTransparent) {
      this.scene.background = this.backgroundColor;
    }
  }

  getBackgroundColor(): THREE.Color {
    return this.backgroundColor;
  }

  setOutlineEnabled(enabled: boolean): void {
    this.outlineEnabled = enabled;
    this.applyOutlinePassEnabled();
  }

  isOutlineEnabled(): boolean {
    return this.outlineEnabled;
  }

  /**
   * 輪郭線の描き方を切り替える。"fade"=既存のOutlinePass(内部でガウシアンブラーが掛かり、ふんわりした線になる)、
   * "solid"=深度バッファの隣接ピクセル差分によるくっきりした実線(2026-07-27、ユーザー要望)。
   */
  setOutlineMode(mode: "fade" | "solid"): void {
    this.outlineMode = mode;
    this.applyOutlinePassEnabled();
  }

  getOutlineMode(): "fade" | "solid" {
    return this.outlineMode;
  }

  private applyOutlinePassEnabled(): void {
    this.outlinePass.enabled = this.outlineEnabled && this.outlineMode === "fade";
    this.solidOutlinePass.enabled = this.outlineEnabled && this.outlineMode === "solid";
  }

  /** 輪郭線の強さ(fadeモード)・太さ(solidモード、px単位のサンプリング距離)をスライダーで調整する。 */
  setOutlineStrength(strength: number): void {
    this.outlinePass.edgeStrength = strength;
    this.solidOutlinePass.uniforms.thickness.value = strength;
  }

  getOutlineStrength(): number {
    return this.outlineMode === "solid"
      ? (this.solidOutlinePass.uniforms.thickness.value as number)
      : this.outlinePass.edgeStrength;
  }

  setGrayscaleEnabled(enabled: boolean): void {
    this.grayscaleEnabled = enabled;
    this.grayscalePass.enabled = enabled;
  }

  isGrayscaleEnabled(): boolean {
    return this.grayscaleEnabled;
  }

  /** トゥーン調表示のON/OFFに合わせて陰影が付きやすいライティングへ一時的に切り替える。 */
  setToonLightingEnabled(enabled: boolean): void {
    this.ambientLight.intensity = enabled ? TOON_AMBIENT_INTENSITY : BASE_AMBIENT_INTENSITY;
    this.directionalLight.intensity = enabled ? TOON_DIRECTIONAL_INTENSITY : BASE_DIRECTIONAL_INTENSITY;
  }

  /** 平行光源(主光源)の向きを方位角(0=Z+方向、右回り)・高さ(水平=0°、真上=90°)の球面座標で設定する。 */
  setLightDirection(azimuthDeg: number, elevationDeg: number): void {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const el = THREE.MathUtils.degToRad(elevationDeg);
    _tmpLightDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.directionalLight.position.copy(_tmpLightDir).multiplyScalar(LIGHT_DISTANCE);
    this.lightMarker.position.copy(_tmpLightDir).multiplyScalar(LIGHT_MARKER_DISTANCE);
    this.lightHandle.position.copy(this.lightMarker.position);
  }

  /** 光源位置マーカー(オレンジ球)とドラッグハンドル(紫球)の表示切替 */
  setLightMarkerVisible(visible: boolean): void {
    this.lightMarker.visible = visible;
    this.lightHandle.visible = visible;
  }

  isLightMarkerVisible(): boolean {
    return this.lightMarker.visible;
  }

  setShadowEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    // renderer.shadowMap.enabledはレンダラー側のグローバル設定であり、切り替えただけでは
    // 既にコンパイル済みのマテリアルのシェーダープログラムが再利用され続けて影の有無が
    // 反映されない(ON→OFFで消えない、OFF→ONで出ない)。全メッシュのマテリアルに
    // needsUpdateを立てて強制的に再コンパイルさせる(実機・このClaude環境の両方で確認した不具合)。
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.needsUpdate = true;
      }
    });
  }

  isShadowEnabled(): boolean {
    return this.renderer.shadowMap.enabled;
  }

  /** 輪郭線を描く対象を指定する(通常はアクティブなキャラクターのroot)。 */
  setOutlineTarget(objects: THREE.Object3D[]): void {
    this.outlinePass.selectedObjects = objects;
  }

  /**
   * 輪郭線・選択インジケーターの検出対象からオブジェクトを除外する(ギズモ・IKハンドル等)。
   * 各コントローラー(GizmoController/IkController/PropController等)が、自身のTransformControls
   * ヘルパーやハンドル用メッシュを初期化直後に登録する想定(2026-07-27追加)。
   */
  addOutlineExcludedObject(...objects: THREE.Object3D[]): void {
    this.outlineExcludedObjects.push(...objects);
  }

  /** キャラクター切替でIkControllerを作り直す際等、登録済みの除外オブジェクトを取り除く。 */
  removeOutlineExcludedObject(...objects: THREE.Object3D[]): void {
    this.outlineExcludedObjects = this.outlineExcludedObjects.filter((o) => !objects.includes(o));
  }

  /** 現在の表示モードに応じた1フレーム分の描画を行う(通常は直接render、輪郭線ON時はcomposer経由)。 */
  renderNow(): void {
    if (this.outlineEnabled || this.grayscaleEnabled) {
      if (this.solidOutlinePass.enabled) {
        // composerの共有バッファ(writeBuffer/readBufferが毎パスで入れ替わる)とは別に、
        // 実線モード専用の深度だけを都度描いておく(applyOutlinePassEnabled参照)。
        // ギズモ・IKハンドル等の細いジオメトリの深度エッジが誤検出されないよう、この深度専用パスの
        // 描画中だけ除外オブジェクトを隠す(通常のRenderPassには影響しない、上のVisibilityTogglePassと同じ理由)。
        const prevVisibility = this.outlineExcludedObjects.map((o) => o.visible);
        for (const o of this.outlineExcludedObjects) o.visible = false;
        const prevTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.depthOnlyRenderTarget);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(prevTarget);
        this.outlineExcludedObjects.forEach((o, i) => {
          o.visible = prevVisibility[i];
        });
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const pixelRatio = this.renderer.getPixelRatio();
    this.depthOnlyRenderTarget.setSize(w * pixelRatio, h * pixelRatio);
    this.solidOutlinePass.uniforms.resolution.value.set(w * pixelRatio, h * pixelRatio);
  };

  private animate(): void {
    this.rafId = requestAnimationFrame(this.animate);
    // ResizeObserver/resizeイベントの取りこぼしに備え、毎フレーム軽量にサイズ不一致を検知して補正する
    this.renderer.getSize(this.sizeCheckBuf);
    if (this.sizeCheckBuf.x !== this.container.clientWidth || this.sizeCheckBuf.y !== this.container.clientHeight) {
      this.handleResize();
    }
    const dt = this.clock.getDelta();
    this.orbitControls.update();
    for (const cb of this.tickCallbacks) cb(dt);
    this.renderNow();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
