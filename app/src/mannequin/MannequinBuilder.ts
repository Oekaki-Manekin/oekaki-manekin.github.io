import * as THREE from "three";
import { BONE_DEFS, BONE_DEF_MAP, type BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";

export const BASE_COLOR = 0xd9c9b0;
export const SELECT_COLOR = 0xff9a3c;

// カプセル(手足)のテッセレーション。BodyShapeApplier.ts(体型変更・Undo/Redoのたびにジオメトリを
// 作り直す側)と共有する定数(2026-07-28、片方だけ更新して食い違う不具合が起きたため一本化)。
export const CAPSULE_CAP_SEGMENTS = 6;
export const CAPSULE_RADIAL_SEGMENTS = 16;

// 各パーツの表面に薄い縦横グリッド線を入れ、回転・ねじれによる立体感を視認しやすくする。
// テクスチャ自体に3本×3本の線を仕込み(repeat=1のまま)、box形状は面ごとに、capsule形状は
// 円周方向・長さ方向にそれぞれ3本ずつ入る(three.jsのCapsuleGeometryはLatheGeometryベースで、
// UV V方向がカプセル全体の輪郭に沿って0〜1になるため)。全パーツで1枚のテクスチャを共有し、
// アプリケーション生存期間中は破棄しない(DisplayModeMaterials.tsのtoonGradientMap等と同じ方針)。
let gridTexture: THREE.CanvasTexture | null = null;
function getGridTexture(): THREE.CanvasTexture {
  if (gridTexture) return gridTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 2;
  const segments = 4; // 3本の線で4等分
  for (let i = 1; i < segments; i++) {
    const pos = (size / segments) * i;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }
  gridTexture = new THREE.CanvasTexture(canvas);
  gridTexture.wrapS = THREE.RepeatWrapping;
  gridTexture.wrapT = THREE.RepeatWrapping;
  gridTexture.colorSpace = THREE.SRGBColorSpace;
  return gridTexture;
}

/** グリッド線を入れる対象かどうか(頭は十字マーカーと重複して煩雑になるため、指は小さすぎるため除外)。 */
function usesGridTexture(name: BoneName): boolean {
  if (name === "head") return false;
  const group = BONE_DEF_MAP[name].group;
  return group !== "leftFingers" && group !== "rightFingers";
}

// 頭の正面(+Z)を示す十字を、独立したオブジェクトではなく球体表面のテクスチャとして焼き込む。
// three.jsのSphereGeometryはUV: u=phi/(2π), v=1-theta/π (頂点座標 x=-r・cosφ・sinθ, z=r・sinφ・sinθ)
// で定義されており、+Z(sinφが最大=φ=π/2)はu=0.25、赤道(θ=π/2)はv=0.5に位置する。
// 十字をUV全体(経線・緯線)ではなく正面付近の狭い範囲だけに描くことで、球を回しても
// 「正面にだけ十字がある」という見た目になる(全周に線が回る地球儀のような見た目を避ける)。
let headCrossTexture: THREE.CanvasTexture | null = null;
function getHeadCrossTexture(): THREE.CanvasTexture {
  if (headCrossTexture) return headCrossTexture;
  const width = 256;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const centerX = width * 0.25;
  const centerY = height * 0.5;
  const barHalfLen = height * 0.22;
  ctx.strokeStyle = "#2a2620";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - barHalfLen);
  ctx.lineTo(centerX, centerY + barHalfLen);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX - barHalfLen, centerY);
  ctx.lineTo(centerX + barHalfLen, centerY);
  ctx.stroke();
  headCrossTexture = new THREE.CanvasTexture(canvas);
  headCrossTexture.colorSpace = THREE.SRGBColorSpace;
  return headCrossTexture;
}

/**
 * three.jsのCapsuleGeometry(LatheGeometryベース)は、UV V座標がプロファイル点の
 * 「インデックス比率」で決まり、実際の弧長には比例しない。かつ半球キャップ部分
 * (absarcで作られる円弧、resolution=capSegments*2)に大半の点が割り当てられ、
 * 直線部分(自動生成される1本のLineCurve、resolution=1で常に1点のみ)には
 * 物理的な長さに関わらずごくわずかな点しか割り当てられない。
 * 結果、グリッドテクスチャの横線(V方向の等間隔線)は、直線部分(腕や脚の大部分を
 * 占める見た目上の胴体)に対応するUV範囲が極端に狭いため、そこだけ間延びして見える
 * (2026-07-27、ユーザー指摘により発覚)。
 * 頂点のローカルY座標から実際の弧長を計算し、UV.yを弧長比例に補正する。
 * BodyShapeApplier.ts(体型変更・Undo/Redoのたびにカプセルを作り直す側)からも呼ぶため export する
 * (2026-07-28、こちらの呼び出しが漏れていたため上記の間延び不具合がUndo操作で再発した経緯があり、
 * 「作り直す箇所は必ずこれを呼ぶ」ことを徹底するためexport化した)。
 */
export function remapCapsuleUvToArcLength(geo: THREE.BufferGeometry, radius: number, straightLength: number): void {
  const position = geo.attributes.position;
  const uv = geo.attributes.uv;
  const halfStraight = straightLength / 2;
  const capArcLength = (Math.PI / 2) * radius;
  const totalLength = straightLength + 2 * capArcLength;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    let arcFromBottom: number;
    if (y >= halfStraight) {
      const theta = Math.asin(THREE.MathUtils.clamp((y - halfStraight) / radius, -1, 1));
      arcFromBottom = capArcLength + straightLength + radius * theta;
    } else if (y <= -halfStraight) {
      const theta = Math.asin(THREE.MathUtils.clamp((y + halfStraight) / radius, -1, 1));
      arcFromBottom = radius * (theta + Math.PI / 2);
    } else {
      arcFromBottom = capArcLength + (y + halfStraight);
    }
    uv.setY(i, arcFromBottom / totalLength);
  }
  uv.needsUpdate = true;
}

export interface LimbShape {
  kind: "capsule";
  axis: "x" | "y";
  length: number;
  radius: number;
}
export interface BoxShape {
  kind: "box";
  size: [number, number, number];
  offset: [number, number, number];
}
export interface SphereShape {
  kind: "sphere";
  radius: number;
  offset: [number, number, number];
}
export type Shape = LimbShape | BoxShape | SphereShape;

// 各ボーンの視覚形状定義（プリミティブのみで構成）
// 【フェーズ6(C)体型バリエーションで参照】BodyShapeApplier.tsがここを「素の基準値」として
// 読み取り、頭身・体型パラメータに応じたスケール後の値を都度算出する。この定数自体は不変。
export const SHAPES: Partial<Record<BoneName, Shape>> = {
  hips: { kind: "box", size: [0.26, 0.16, 0.16], offset: [0, -0.02, 0] },
  spine: { kind: "capsule", axis: "y", length: 0.14, radius: 0.095 },
  chest: { kind: "box", size: [0.34, 0.16, 0.18], offset: [0, 0.07, 0] },
  neck: { kind: "capsule", axis: "y", length: 0.14, radius: 0.045 },
  // 球体(頭身の基準単位である高さ0.24mを直径として維持する半径0.12)。
  head: { kind: "sphere", radius: 0.12, offset: [0, 0.12, 0] },

  leftShoulder: { kind: "capsule", axis: "x", length: 0.11, radius: 0.04 },
  leftUpperArm: { kind: "capsule", axis: "x", length: 0.27, radius: 0.045 },
  leftLowerArm: { kind: "capsule", axis: "x", length: 0.25, radius: 0.04 },
  leftHand: { kind: "box", size: [0.05, 0.03, 0.075], offset: [0.02, 0, 0] },

  rightShoulder: { kind: "capsule", axis: "x", length: 0.11, radius: 0.04 },
  rightUpperArm: { kind: "capsule", axis: "x", length: 0.27, radius: 0.045 },
  rightLowerArm: { kind: "capsule", axis: "x", length: 0.25, radius: 0.04 },
  rightHand: { kind: "box", size: [0.05, 0.03, 0.075], offset: [-0.02, 0, 0] },

  leftUpperLeg: { kind: "capsule", axis: "y", length: 0.44, radius: 0.078 },
  leftLowerLeg: { kind: "capsule", axis: "y", length: 0.42, radius: 0.06 },
  leftFoot: { kind: "box", size: [0.09, 0.06, 0.24], offset: [0, -0.03, 0.09] },

  rightUpperLeg: { kind: "capsule", axis: "y", length: 0.44, radius: 0.078 },
  rightLowerLeg: { kind: "capsule", axis: "y", length: 0.42, radius: 0.06 },
  rightFoot: { kind: "box", size: [0.09, 0.06, 0.24], offset: [0, -0.03, 0.09] },

  ...buildFingerShapes(),
};

// 指の関節種別ごとの太さ(親指はやや太め)
function fingerRadius(name: BoneName): number {
  if (name.includes("Thumb")) return name.endsWith("Distal") ? 0.008 : 0.011;
  if (name.endsWith("Proximal")) return 0.009;
  if (name.endsWith("Intermediate")) return 0.0075;
  return 0.0065; // Distal
}

function buildFingerShapes(): Partial<Record<BoneName, Shape>> {
  const shapes: Partial<Record<BoneName, Shape>> = {};
  for (const def of BONE_DEFS) {
    if (def.group !== "leftFingers" && def.group !== "rightFingers") continue;
    if (def.meshLength === undefined) continue;
    shapes[def.name] = { kind: "capsule", axis: "x", length: def.meshLength, radius: fingerRadius(def.name) };
  }
  return shapes;
}

function buildMesh(name: BoneName, shape: Shape, material: THREE.MeshStandardMaterial): THREE.Mesh {
  if (shape.kind === "box") {
    const geo = new THREE.BoxGeometry(...shape.size);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(...shape.offset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.boneName = name;
    return mesh;
  }
  if (shape.kind === "sphere") {
    // segments 16,12だと実線モードの輪郭線(曲率ベースのエッジ検出)がファセット(面同士の
    // 小さな折れ)まで拾ってしまい、球面が黒くファセット状に見える不具合が出たため増やした
    // (2026-07-28、詳細はSceneManager.ts §5参照)。
    const geo = new THREE.SphereGeometry(shape.radius, 32, 24);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(...shape.offset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.boneName = name;
    return mesh;
  }
  // capsule: three.jsのCapsuleGeometryはデフォルトでY軸方向に伸びる
  // セグメント数・UV補正はBodyShapeApplier.ts(体型変更時にジオメトリを作り直す側)と必ず
  // 揃えること(2026-07-28、片方だけ更新して食い違い、体型変更・Undo/Redoのたびに低ポリ+UV未補正の
  // 見た目に戻ってしまう不具合が発覚したため定数化・共有した。詳細は本ファイル末尾の定数定義と
  // SceneManager.ts §5参照)。
  const straightLength = Math.max(shape.length - shape.radius, 0.01);
  const geo = new THREE.CapsuleGeometry(shape.radius, straightLength, CAPSULE_CAP_SEGMENTS, CAPSULE_RADIAL_SEGMENTS);
  remapCapsuleUvToArcLength(geo, shape.radius, straightLength);
  const signX = BONE_DEF_MAP[name].position[0] >= 0 ? 1 : -1;
  if (shape.axis === "x") {
    geo.rotateZ(signX > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  const mesh = new THREE.Mesh(geo, material);
  if (shape.axis === "x") {
    mesh.position.set((shape.length / 2) * signX, 0, 0);
  } else {
    mesh.position.set(0, -shape.length / 2, 0);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.boneName = name;
  return mesh;
}

export interface Mannequin extends Character {
  readonly kind: "mannequin";
  root: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  pickableMeshes: THREE.Mesh[];
  setHighlighted(boneName: BoneName | null): void;
}

export function buildMannequin(): Mannequin {
  const root = new THREE.Group();
  root.name = "mannequin";

  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const def of BONE_DEFS) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.set(...def.position);
    bone.rotation.order = "XYZ";
    bones[def.name] = bone;
  }
  for (const def of BONE_DEFS) {
    if (def.parent) {
      bones[def.parent].add(bones[def.name]);
    } else {
      root.add(bones[def.name]);
    }
  }

  const meshByBone = new Map<BoneName, THREE.Mesh>();
  const pickableMeshes: THREE.Mesh[] = [];

  for (const def of BONE_DEFS) {
    const shape = SHAPES[def.name];
    if (!shape) continue;
    const material = new THREE.MeshStandardMaterial({
      color: BASE_COLOR,
      roughness: 0.7,
      metalness: 0.05,
      map: def.name === "head" ? getHeadCrossTexture() : usesGridTexture(def.name) ? getGridTexture() : null,
    });
    const mesh = buildMesh(def.name, shape, material);
    bones[def.name].add(mesh);
    meshByBone.set(def.name, mesh);
    pickableMeshes.push(mesh);
  }

  // ハイライトは元のMeshStandardMaterialが前提(色+発光)。表示モード(トゥーン調/シルエット)で
  // マテリアルが差し替えられている間は型が変わる(MeshToonMaterialはemissiveを持たない、
  // シルエットは全メッシュ共有の単色マテリアルで個別に色を変えると全体が変わってしまう)ため、
  // instanceof で安全にスキップする(ハイライトが見えなくなるだけで、選択自体は部位リスト等で分かる)。
  let highlighted: BoneName | null = null;
  const setHighlighted = (boneName: BoneName | null): void => {
    if (highlighted) {
      const prevMat = meshByBone.get(highlighted)?.material;
      if (prevMat instanceof THREE.MeshStandardMaterial) {
        prevMat.color.setHex(BASE_COLOR);
        prevMat.emissive.setHex(0x000000);
      }
    }
    highlighted = boneName;
    if (boneName) {
      const mat = meshByBone.get(boneName)?.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.color.setHex(SELECT_COLOR);
        mat.emissive.setHex(0x552200);
      }
    }
  };

  const dispose = (): void => {
    for (const mesh of pickableMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  };

  // 全身リセットで腰の位置を戻すための基準(Character.restHipsPosition参照)。
  // 体型変更(BodyShapeApplier)はhipsを意図的にスケール対象外にしているため、生成直後の値のままでよい。
  const restHipsPosition = bones.hips?.position.clone();
  return { kind: "mannequin", root, bones, pickableMeshes, restHipsPosition, setHighlighted, dispose };
}
