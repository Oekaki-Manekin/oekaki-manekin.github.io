import * as THREE from "three";
import { BONE_DEF_MAP, type BoneName } from "../config/boneDefs";
import {
  SHAPES,
  type LimbShape,
  type Mannequin,
  CAPSULE_CAP_SEGMENTS,
  CAPSULE_RADIAL_SEGMENTS,
  remapCapsuleUvToArcLength,
} from "./MannequinBuilder";
import { BASELINE_HEAD_COUNT, BUILD_THICKNESS_SCALE, type BodyShapeParams } from "../config/bodyShapeDefs";

// 頭のサイズ(MannequinBuilder.ts SHAPES.head.size[1]と同じ値)。頭身計算の基準単位であり、
// 体型パラメータでは一切変更しない(頭のサイズが動くと頭身の定義自体が狂うため)。
const HEAD_SIZE_Y = 0.24;
const BASE_NON_HEAD_LENGTH = HEAD_SIZE_Y * (BASELINE_HEAD_COUNT - 1);

function computeLengthScale(headCount: number): number {
  const targetNonHeadLength = HEAD_SIZE_Y * (headCount - 1);
  return targetNonHeadLength / BASE_NON_HEAD_LENGTH;
}

type ScaleAxis = "length" | "thickness" | "none";

// 各ボーンのposition[x,y,z]それぞれをどの軸のスケールで動かすか。
// - "length"(頭身スライダー由来): 胴体・脚の縦方向、腕の伸びる方向。
// - "thickness"(体型ボタン由来): 肩幅・腰幅など横方向の張り出し。
// - hipsは意図的にこのテーブルに含めない: IK黄ハンドルでユーザーがドラッグした現在位置を
//   体型変更のたびに書き潰さないための判断(足が浮く/沈む場合は既存の黄ハンドルで調整する運用。
//   PHASE6-HANDOFF.md§5参照)。
const BONE_POSITION_SCALE: Partial<Record<BoneName, [ScaleAxis, ScaleAxis, ScaleAxis]>> = {
  spine: ["none", "length", "none"],
  chest: ["none", "length", "none"],
  neck: ["none", "length", "none"],
  head: ["none", "length", "none"],

  leftShoulder: ["thickness", "length", "none"],
  rightShoulder: ["thickness", "length", "none"],
  leftUpperArm: ["length", "none", "none"],
  rightUpperArm: ["length", "none", "none"],
  leftLowerArm: ["length", "none", "none"],
  rightLowerArm: ["length", "none", "none"],
  leftHand: ["length", "none", "none"],
  rightHand: ["length", "none", "none"],

  leftUpperLeg: ["thickness", "length", "none"],
  rightUpperLeg: ["thickness", "length", "none"],
  leftLowerLeg: ["none", "length", "none"],
  rightLowerLeg: ["none", "length", "none"],
  leftFoot: ["none", "length", "none"],
  rightFoot: ["none", "length", "none"],
};

// mesh.scale(非一様scale)で幅・奥行きだけ変える対象(ボックス形状のみ。カプセルは別処理)。
// 頭・手・足は対象外(頭身計算の基準を保つため、また小物のグリップは手のサイズが変わらない
// 前提で調整済みのため、手のサイズは体型に関わらず一定にしておきたい)。
const THICKNESS_SCALED_BOX_BONES: BoneName[] = ["hips", "chest"];

function resolveScale(axis: ScaleAxis, lengthScale: number, thicknessScale: number): number {
  if (axis === "length") return lengthScale;
  if (axis === "thickness") return thicknessScale;
  return 1;
}

function meshByBoneName(mannequin: Mannequin): Map<BoneName, THREE.Mesh> {
  const map = new Map<BoneName, THREE.Mesh>();
  for (const mesh of mannequin.pickableMeshes) {
    const name = mesh.userData.boneName as BoneName | undefined;
    if (name) map.set(name, mesh);
  }
  return map;
}

// MannequinBuilder.buildMesh()のカプセル生成ロジックと同じ計算(長さ・太さだけ差し替え可能にしたもの)。
// 非一様scaleではなくジオメトリを作り直す方式にしているのは、カプセル両端の半球が
// 非一様scaleだと楕円状に歪んでしまうため(ボックス形状はscaleで問題ないので使い分けている)。
// セグメント数・UV補正(remapCapsuleUvToArcLength)はbuildMesh()と必ず揃えること。以前ここだけ
// セグメント数が古い値のまま・UV補正の呼び出しも漏れており、体型変更やUndo/Redoのたびに
// 「グリッド線の間延び」「輪郭線のファセット化」の両方がぶり返す不具合になっていた
// (2026-07-28、ユーザー報告。詳細はMannequinBuilder.ts・SceneManager.ts §5参照)。
function updateCapsuleMesh(
  mesh: THREE.Mesh,
  boneName: BoneName,
  shape: LimbShape,
  lengthScale: number,
  thicknessScale: number,
): void {
  const newLength = shape.length * lengthScale;
  const newRadius = shape.radius * thicknessScale;
  const straightLength = Math.max(newLength - newRadius, 0.01);
  const geo = new THREE.CapsuleGeometry(newRadius, straightLength, CAPSULE_CAP_SEGMENTS, CAPSULE_RADIAL_SEGMENTS);
  remapCapsuleUvToArcLength(geo, newRadius, straightLength);
  const signX = BONE_DEF_MAP[boneName].position[0] >= 0 ? 1 : -1;
  if (shape.axis === "x") {
    geo.rotateZ(signX > 0 ? -Math.PI / 2 : Math.PI / 2);
    mesh.position.set((newLength / 2) * signX, 0, 0);
  } else {
    mesh.position.set(0, -newLength / 2, 0);
  }
  mesh.geometry.dispose();
  mesh.geometry = geo;
}

/**
 * マネキンのボーン位置・メッシュ形状を体型パラメータに応じて書き換える。
 * ボーン・メッシュのオブジェクト自体は一切作り直さない(IK・選択・小物の持たせ・
 * Undo/Redo履歴が参照しているオブジェクトをそのまま使い続けられるようにするため。
 * IkSolverはボーン間のワールド座標をその都度distanceTo()で計算しており長さを
 * キャッシュしていないため、ここでボーン位置を書き換えるだけでIK側の変更は不要。
 * 詳細はPHASE6-HANDOFF.md§5参照)。
 */
export function applyBodyShape(mannequin: Mannequin, params: BodyShapeParams): void {
  const lengthScale = computeLengthScale(params.headCount);
  const thicknessScale = BUILD_THICKNESS_SCALE[params.build];
  const bones = mannequin.bones;

  for (const [name, axes] of Object.entries(BONE_POSITION_SCALE) as [BoneName, [ScaleAxis, ScaleAxis, ScaleAxis]][]) {
    const base = BONE_DEF_MAP[name].position;
    const [ax, ay, az] = axes;
    bones[name].position.set(
      base[0] * resolveScale(ax, lengthScale, thicknessScale),
      base[1] * resolveScale(ay, lengthScale, thicknessScale),
      base[2] * resolveScale(az, lengthScale, thicknessScale),
    );
  }

  const meshes = meshByBoneName(mannequin);
  for (const name of Object.keys(BONE_POSITION_SCALE) as BoneName[]) {
    const shape = SHAPES[name];
    if (shape?.kind !== "capsule") continue;
    const mesh = meshes.get(name);
    if (mesh) updateCapsuleMesh(mesh, name, shape, lengthScale, thicknessScale);
  }
  for (const name of THICKNESS_SCALED_BOX_BONES) {
    const mesh = meshes.get(name);
    if (mesh) mesh.scale.set(thicknessScale, 1, thicknessScale);
  }
}
