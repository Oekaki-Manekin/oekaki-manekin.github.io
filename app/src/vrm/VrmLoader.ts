import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, VRMHumanoid, type VRM } from "@pixiv/three-vrm";
import { BONE_NAMES, BONE_DEF_MAP, type BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";

const MARKER_RADIUS = 0.025;
// 指ボーンは小さく密集しているため、通常マーカー(0.025)だと指モデルが完全に埋もれて見えなくなる。
// 指専用に小さいマーカーを使い、視認性とクリック選択の両立を図る。
const FINGER_MARKER_RADIUS = 0.007;
const MARKER_COLOR = 0x4a9eff;
const MARKER_SELECT_COLOR = 0xff9a3c;

function isFingerBone(name: BoneName): boolean {
  const group = BONE_DEF_MAP[name].group;
  return group === "leftFingers" || group === "rightFingers";
}

export interface VrmCharacter extends Character {
  readonly kind: "vrm";
  readonly vrm: VRM;
}

/**
 * VRMファイル(ArrayBuffer)を読み込み、共通Character形式でラップする。
 * ポーズ操作はvrm.humanoidの正規化ボーン(normalized bone)に対して行う。
 * これによりモデルごとの元の骨格差異を吸収し、共通ポーズJSONを一貫して適用できる。
 */
export async function loadVrmCharacter(buffer: ArrayBuffer): Promise<VrmCharacter> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, "");
  } catch {
    throw new Error(
      "VRMファイルの解析に失敗しました。ファイルが破損しているか、対応していない形式の可能性があります。",
    );
  }

  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error("このファイルはVRM形式として認識できませんでした。");
  }

  // VRM0.x(旧仕様、-Z向き)を1.0相当の+Z向きに揃える。
  // normalized bone(vrm.humanoid)はロード時点のvrm.sceneのワールド回転を基準座標として
  // キャッシュしてしまうため、後からvrm.sceneだけ回転させると、そのキャッシュとの食い違いにより
  // ポーズの回転軸が意図と逆(例: すねの曲がる向きが逆)になる。
  // そのためvrm.sceneを回転させた"後"に、その新しいワールド行列を基準としてhumanoidを再構築する。
  if (vrm.meta?.metaVersion === "0") {
    vrm.scene.rotation.y = Math.PI;
    const rebuiltHumanoid = new VRMHumanoid(vrm.humanoid.humanBones, {
      autoUpdateHumanBones: vrm.humanoid.autoUpdateHumanBones,
    });
    (vrm as unknown as { humanoid: VRMHumanoid }).humanoid = rebuiltHumanoid;
  }

  // この時点ではまだクリック選択用マーカー(このあとrawボーンに追加)は存在しないため、
  // ここでcastShadow/receiveShadowを付けても体本体メッシュだけが対象になる。
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  const meshByBone = new Map<BoneName, THREE.Mesh>();
  const pickableMeshes: THREE.Mesh[] = [];
  const markerGeometry = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8);
  const fingerMarkerGeometry = new THREE.SphereGeometry(FINGER_MARKER_RADIUS, 8, 6);

  for (const name of BONE_NAMES) {
    // ポーズ操作(回転の取得・設定)は正規化ボーンに対して行う(モデル間の骨格差異を吸収するため)
    const normalizedNode = vrm.humanoid.getNormalizedBoneNode(name);
    if (!normalizedNode) continue;
    bones[name] = normalizedNode;

    // クリック選択用マーカーは正規化ボーンではなくraw(実際の)ボーンに付ける。
    // 正規化ボーンはシーンに接続されていない独立階層のため、そこに付けるとレンダリングもレイキャストもされない。
    const rawNode = vrm.humanoid.getRawBoneNode(name);
    if (!rawNode) continue;

    const material = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR,
      transparent: true,
      opacity: 0.85,
    });
    const marker = new THREE.Mesh(isFingerBone(name) ? fingerMarkerGeometry : markerGeometry, material);
    marker.userData.boneName = name;
    rawNode.add(marker);
    meshByBone.set(name, marker);
    pickableMeshes.push(marker);
  }

  let highlighted: BoneName | null = null;
  const setHighlighted = (boneName: BoneName | null): void => {
    if (highlighted) {
      const prevMesh = meshByBone.get(highlighted);
      (prevMesh?.material as THREE.MeshBasicMaterial | undefined)?.color.setHex(MARKER_COLOR);
    }
    highlighted = boneName;
    if (boneName) {
      const mesh = meshByBone.get(boneName);
      (mesh?.material as THREE.MeshBasicMaterial | undefined)?.color.setHex(MARKER_SELECT_COLOR);
    }
  };

  const dispose = (): void => {
    markerGeometry.dispose();
    fingerMarkerGeometry.dispose();
    for (const mesh of pickableMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    VRMUtils.deepDispose(vrm.scene);
  };

  return {
    kind: "vrm",
    root: vrm.scene,
    bones,
    pickableMeshes,
    // 全身リセットで腰の位置を戻すための基準(Character.restHipsPosition参照)。
    // VRMは寸法がモデルごとに違うため、マネキン基準の定数ではなく読み込み時の実値を憶えておく。
    restHipsPosition: bones.hips?.position.clone(),
    setHighlighted,
    dispose,
    vrm,
    // 正規化ボーンはシーンから独立した階層のため、行列更新はそちらのルートに対して行う必要がある
    matrixRoot: vrm.humanoid.normalizedHumanBonesRoot,
  };
}
