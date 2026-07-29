// VRM Humanoidボーン規格に準拠したボーン名・階層定義。
// マネキン生成・ポーズJSONシリアライズ・ミラー処理など全モジュールがここを参照する。

export type FingerName = "thumb" | "index" | "middle" | "ring" | "little";
export type Side = "left" | "right";

export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "leftShoulder"
  | "leftUpperArm"
  | "leftLowerArm"
  | "leftHand"
  | "rightShoulder"
  | "rightUpperArm"
  | "rightLowerArm"
  | "rightHand"
  | "leftUpperLeg"
  | "leftLowerLeg"
  | "leftFoot"
  | "rightUpperLeg"
  | "rightLowerLeg"
  | "rightFoot"
  | "leftThumbProximal"
  | "leftThumbDistal"
  | "leftIndexProximal"
  | "leftIndexIntermediate"
  | "leftIndexDistal"
  | "leftMiddleProximal"
  | "leftMiddleIntermediate"
  | "leftMiddleDistal"
  | "leftRingProximal"
  | "leftRingIntermediate"
  | "leftRingDistal"
  | "leftLittleProximal"
  | "leftLittleIntermediate"
  | "leftLittleDistal"
  | "rightThumbProximal"
  | "rightThumbDistal"
  | "rightIndexProximal"
  | "rightIndexIntermediate"
  | "rightIndexDistal"
  | "rightMiddleProximal"
  | "rightMiddleIntermediate"
  | "rightMiddleDistal"
  | "rightRingProximal"
  | "rightRingIntermediate"
  | "rightRingDistal"
  | "rightLittleProximal"
  | "rightLittleIntermediate"
  | "rightLittleDistal";

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** 親ボーンからのローカル位置オフセット (T字ポーズ) [m] */
  position: [number, number, number];
  /** 日本語表示名 */
  label: string;
  /** UI上でのグループ (体幹/腕/脚/指)。指グループは部位リストには出さず指専用パネルにのみ表示する。 */
  group: "torso" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg" | "leftFingers" | "rightFingers";
  /** このボーン自身の視覚メッシュの長さ[m](主に指: 自分の関節から子関節/指先までの長さ) */
  meshLength?: number;
}

const FINGER_LABEL: Record<FingerName, string> = {
  thumb: "親指",
  index: "人差し指",
  middle: "中指",
  ring: "薬指",
  little: "小指",
};

interface FingerSpec {
  finger: FingerName;
  /** 手のひら中心からの左手基準オフセット [m] (Z=指の並び, X=指の伸びる向きの初期オフセット) */
  baseOffset: [number, number, number];
  segmentLengths: number[];
  segmentLabels: string[];
  segmentSuffixes: string[];
}

const LEFT_FINGER_SPECS: FingerSpec[] = [
  {
    finger: "thumb",
    baseOffset: [0.02, 0, 0.035],
    segmentLengths: [0.028, 0.022],
    segmentLabels: ["付け根", "先"],
    segmentSuffixes: ["Proximal", "Distal"],
  },
  {
    finger: "index",
    baseOffset: [0.06, 0.01, 0.025],
    segmentLengths: [0.035, 0.022, 0.018],
    segmentLabels: ["根元", "中間", "先"],
    segmentSuffixes: ["Proximal", "Intermediate", "Distal"],
  },
  {
    finger: "middle",
    baseOffset: [0.065, 0.01, 0.008],
    segmentLengths: [0.038, 0.024, 0.02],
    segmentLabels: ["根元", "中間", "先"],
    segmentSuffixes: ["Proximal", "Intermediate", "Distal"],
  },
  {
    finger: "ring",
    baseOffset: [0.06, 0.01, -0.009],
    segmentLengths: [0.034, 0.021, 0.017],
    segmentLabels: ["根元", "中間", "先"],
    segmentSuffixes: ["Proximal", "Intermediate", "Distal"],
  },
  {
    finger: "little",
    baseOffset: [0.05, 0.01, -0.025],
    segmentLengths: [0.026, 0.017, 0.014],
    segmentLabels: ["根元", "中間", "先"],
    segmentSuffixes: ["Proximal", "Intermediate", "Distal"],
  },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildFingerDefs(side: Side): BoneDef[] {
  const sideSign = side === "left" ? 1 : -1;
  const handBone: BoneName = side === "left" ? "leftHand" : "rightHand";
  const group = side === "left" ? "leftFingers" : "rightFingers";
  const defs: BoneDef[] = [];

  for (const spec of LEFT_FINGER_SPECS) {
    let parent: BoneName = handBone;
    // 手のひらから最初の関節までのオフセット(親指はMetacarpalが最初の関節)
    const baseName = `${side}${capitalize(spec.finger)}${spec.segmentSuffixes[0]}` as BoneName;
    defs.push({
      name: baseName,
      parent,
      position: [spec.baseOffset[0] * sideSign, spec.baseOffset[1], spec.baseOffset[2]],
      label: `${side === "left" ? "左" : "右"}${FINGER_LABEL[spec.finger]}(${spec.segmentLabels[0]})`,
      group,
      meshLength: spec.segmentLengths[0],
    });
    parent = baseName;

    for (let i = 1; i < spec.segmentSuffixes.length; i++) {
      const name = `${side}${capitalize(spec.finger)}${spec.segmentSuffixes[i]}` as BoneName;
      defs.push({
        name,
        parent,
        position: [spec.segmentLengths[i - 1] * sideSign, 0, 0],
        label: `${side === "left" ? "左" : "右"}${FINGER_LABEL[spec.finger]}(${spec.segmentLabels[i]})`,
        group,
        meshLength: spec.segmentLengths[i],
      });
      parent = name;
    }
    // 最終セグメントの先端までの長さは見た目上メッシュ側で表現するため、ボーン自体は末節関節位置まで。
  }

  return defs;
}

// 約7頭身の標準体型。頭部の高さ(直径) 0.24m を基準単位とする。
export const BONE_DEFS: BoneDef[] = [
  { name: "hips", parent: null, position: [0, 0.92, 0], label: "腰", group: "torso" },
  { name: "spine", parent: "hips", position: [0, 0.14, 0], label: "背骨(下)", group: "torso" },
  { name: "chest", parent: "spine", position: [0, 0.14, 0], label: "胸", group: "torso" },
  { name: "neck", parent: "chest", position: [0, 0.14, 0], label: "首", group: "torso" },
  { name: "head", parent: "neck", position: [0, 0.1, 0], label: "頭", group: "torso" },

  { name: "leftShoulder", parent: "chest", position: [0.09, 0.1, 0], label: "左肩", group: "leftArm" },
  { name: "leftUpperArm", parent: "leftShoulder", position: [0.11, 0, 0], label: "左上腕", group: "leftArm" },
  { name: "leftLowerArm", parent: "leftUpperArm", position: [0.27, 0, 0], label: "左前腕", group: "leftArm" },
  { name: "leftHand", parent: "leftLowerArm", position: [0.25, 0, 0], label: "左手", group: "leftArm" },

  { name: "rightShoulder", parent: "chest", position: [-0.09, 0.1, 0], label: "右肩", group: "rightArm" },
  { name: "rightUpperArm", parent: "rightShoulder", position: [-0.11, 0, 0], label: "右上腕", group: "rightArm" },
  { name: "rightLowerArm", parent: "rightUpperArm", position: [-0.27, 0, 0], label: "右前腕", group: "rightArm" },
  { name: "rightHand", parent: "rightLowerArm", position: [-0.25, 0, 0], label: "右手", group: "rightArm" },

  { name: "leftUpperLeg", parent: "hips", position: [0.09, -0.02, 0], label: "左太もも", group: "leftLeg" },
  { name: "leftLowerLeg", parent: "leftUpperLeg", position: [0, -0.44, 0], label: "左すね", group: "leftLeg" },
  { name: "leftFoot", parent: "leftLowerLeg", position: [0, -0.42, 0.02], label: "左足", group: "leftLeg" },

  { name: "rightUpperLeg", parent: "hips", position: [-0.09, -0.02, 0], label: "右太もも", group: "rightLeg" },
  { name: "rightLowerLeg", parent: "rightUpperLeg", position: [0, -0.44, 0], label: "右すね", group: "rightLeg" },
  { name: "rightFoot", parent: "rightLowerLeg", position: [0, -0.42, 0.02], label: "右足", group: "rightLeg" },

  ...buildFingerDefs("left"),
  ...buildFingerDefs("right"),
];

export const BONE_NAMES: BoneName[] = BONE_DEFS.map((b) => b.name);

export const BONE_DEF_MAP: Record<BoneName, BoneDef> = Object.fromEntries(
  BONE_DEFS.map((b) => [b.name, b]),
) as Record<BoneName, BoneDef>;

/** 左右対応表。ミラー処理で使用する。体幹ボーンは自分自身にマップされる。 */
export const MIRROR_MAP: Record<BoneName, BoneName> = Object.fromEntries(
  BONE_DEFS.map((b) => {
    if (b.name.startsWith("left")) {
      return [b.name, ("right" + b.name.slice(4)) as BoneName];
    }
    if (b.name.startsWith("right")) {
      return [b.name, ("left" + b.name.slice(5)) as BoneName];
    }
    return [b.name, b.name];
  }),
) as Record<BoneName, BoneName>;

export const FINGER_NAMES: FingerName[] = ["thumb", "index", "middle", "ring", "little"];

/** 指定した手(side)の指ボーン名一覧を返す */
export function getFingerBoneNames(side: Side): BoneName[] {
  const group = side === "left" ? "leftFingers" : "rightFingers";
  return BONE_DEFS.filter((b) => b.group === group).map((b) => b.name);
}
