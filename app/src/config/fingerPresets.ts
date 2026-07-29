// 指ポーズプリセット定義。左手基準の角度(度)で定義し、右手適用時はクォータニオンミラーで変換する。
// Z軸=曲げ(カール、負値で握る方向)、Y軸=開閉(外転/内転)、X軸=ねじり、という共通の軸割り当て
// (config/jointLimits.tsのbuildFingerLimitsと同じ考え方)。

export type FingerBoneSuffix =
  | "ThumbProximal"
  | "ThumbDistal"
  | "IndexProximal"
  | "IndexIntermediate"
  | "IndexDistal"
  | "MiddleProximal"
  | "MiddleIntermediate"
  | "MiddleDistal"
  | "RingProximal"
  | "RingIntermediate"
  | "RingDistal"
  | "LittleProximal"
  | "LittleIntermediate"
  | "LittleDistal";

export interface FingerEuler {
  x: number;
  y: number;
  z: number;
}

export interface FingerPreset {
  id: string;
  label: string;
  rotations: Partial<Record<FingerBoneSuffix, FingerEuler>>;
  /** 自作プリセットかどうか(内蔵プリセットと自作プリセットの一覧上での区別に使う) */
  custom?: boolean;
}

export const ALL_FINGER_SUFFIXES: FingerBoneSuffix[] = [
  "ThumbProximal",
  "ThumbDistal",
  "IndexProximal",
  "IndexIntermediate",
  "IndexDistal",
  "MiddleProximal",
  "MiddleIntermediate",
  "MiddleDistal",
  "RingProximal",
  "RingIntermediate",
  "RingDistal",
  "LittleProximal",
  "LittleIntermediate",
  "LittleDistal",
];

const rot = (x = 0, y = 0, z = 0): FingerEuler => ({ x, y, z });

// 4指(親指以外)を同じ曲げ角度で一括生成するヘルパー
function curlOtherFingers(proximal: number, intermediate: number, distal: number) {
  const fingers: Array<"Index" | "Middle" | "Ring" | "Little"> = ["Index", "Middle", "Ring", "Little"];
  const out: Partial<Record<FingerBoneSuffix, FingerEuler>> = {};
  for (const f of fingers) {
    out[`${f}Proximal`] = rot(0, 0, proximal);
    out[`${f}Intermediate`] = rot(0, 0, intermediate);
    out[`${f}Distal`] = rot(0, 0, distal);
  }
  return out;
}

export const BUILTIN_FINGER_PRESETS: FingerPreset[] = [
  {
    id: "open",
    label: "パー",
    rotations: {
      ThumbProximal: rot(0, 5, -5),
      ThumbDistal: rot(0, 0, -3),
      ...curlOtherFingers(-5, -3, -2),
    },
  },
  {
    id: "fist",
    label: "グー",
    rotations: {
      ThumbProximal: rot(15, 10, -45),
      ThumbDistal: rot(0, 0, -60),
      ...curlOtherFingers(-95, -105, -85),
    },
  },
  {
    id: "relax",
    label: "軽く開く",
    rotations: {
      ThumbProximal: rot(5, 5, -15),
      ThumbDistal: rot(0, 0, -15),
      ...curlOtherFingers(-25, -20, -15),
    },
  },
  {
    id: "point",
    label: "指差し",
    rotations: {
      ThumbProximal: rot(10, 5, -35),
      ThumbDistal: rot(0, 0, -45),
      IndexProximal: rot(0, 0, -5),
      IndexIntermediate: rot(0, 0, -3),
      IndexDistal: rot(0, 0, -2),
      MiddleProximal: rot(0, 0, -95),
      MiddleIntermediate: rot(0, 0, -105),
      MiddleDistal: rot(0, 0, -85),
      RingProximal: rot(0, 0, -95),
      RingIntermediate: rot(0, 0, -105),
      RingDistal: rot(0, 0, -85),
      LittleProximal: rot(0, 0, -95),
      LittleIntermediate: rot(0, 0, -105),
      LittleDistal: rot(0, 0, -85),
    },
  },
  {
    id: "peace",
    label: "ピース",
    rotations: {
      ThumbProximal: rot(15, 10, -45),
      ThumbDistal: rot(0, 0, -60),
      IndexProximal: rot(0, 10, -5),
      IndexIntermediate: rot(0, 0, -3),
      IndexDistal: rot(0, 0, -2),
      MiddleProximal: rot(0, -10, -5),
      MiddleIntermediate: rot(0, 0, -3),
      MiddleDistal: rot(0, 0, -2),
      RingProximal: rot(0, 0, -95),
      RingIntermediate: rot(0, 0, -105),
      RingDistal: rot(0, 0, -85),
      LittleProximal: rot(0, 0, -95),
      LittleIntermediate: rot(0, 0, -105),
      LittleDistal: rot(0, 0, -85),
    },
  },
  {
    id: "grip",
    label: "物を持つ",
    rotations: {
      ThumbProximal: rot(30, 20, -25),
      ThumbDistal: rot(0, 0, -30),
      ...curlOtherFingers(-55, -70, -45),
    },
  },
];
