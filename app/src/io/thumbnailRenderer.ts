// ポーズのサムネイル画像(dataURL)をオフスクリーンで生成する。
// 内蔵プリセット一覧・自作ライブラリ保存時のサムネに使う。
//
// メインのビューとは独立した専用レンダラー/シーン/マネキンを1つだけ保持し、
// 毎回そこへポーズを適用して1枚だけ明示的に render() する。requestAnimationFrame に
// 依存しないため、描画ループが止まる環境でもサムネ生成は動作する。

import * as THREE from "three";
import { buildMannequin, type Mannequin } from "../mannequin/MannequinBuilder";
import { applyPose, type PoseData } from "../posing/PoseSerializer";

const WIDTH = 150;
const HEIGHT = 190;

interface ThumbContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mannequin: Mannequin;
}

let ctx: ThumbContext | null = null;

function ensureContext(): ThumbContext {
  if (ctx) return ctx;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b2b30);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(1.5, 3, 2.5);
  scene.add(dir);

  // やや斜め前からの3/4視点。前後方向(歩く・寝そべり等)も分かりやすい。
  const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(1.7, 1.15, 3.1);
  camera.lookAt(0, 0.6, 0);

  const mannequin = buildMannequin();
  scene.add(mannequin.root);

  ctx = { renderer, scene, camera, mannequin };
  return ctx;
}

/** 指定ポーズをマネキンに適用してサムネイルを描画し、PNGのdataURLを返す。 */
export function renderPoseThumbnail(pose: PoseData): string {
  const { renderer, scene, camera, mannequin } = ensureContext();
  // 前のポーズが残らないよう一旦初期化してから適用する
  for (const bone of Object.values(mannequin.bones)) {
    bone.quaternion.set(0, 0, 0, 1);
  }
  applyPose(mannequin.bones, pose, { applyHipsPosition: true });
  mannequin.root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}
