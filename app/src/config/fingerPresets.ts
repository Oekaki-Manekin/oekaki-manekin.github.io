// 指ポーズプリセット定義。左手基準の角度(度)で定義し、右手適用時はクォータニオンミラーで変換する。
// Z軸=曲げ(カール、負値で握る方向)、Y軸=開閉(外転/内転)、X軸=ねじり、という共通の軸割り当て
// (config/jointLimits.tsのbuildFingerLimitsと同じ考え方)。
//
// 【Y軸(開閉)の符号(2026-08-03に数値検証して確定)】
// 指はローカル+X方向へ伸び、指の並びはローカルZ方向(+Z側から親指・人差し指・中指・薬指・小指)。
// Y軸回転は +X を -Z へ動かす(Ry(θ)・(1,0,0) = (cosθ, 0, -sinθ))ため、
//   Y+ = 小指側へ寄せる(内転) / Y- = 親指側へ開く(外転)
// となる。「ピース」で人差し指Y+10・中指Y-10としていたのはこの符号が逆で、
// 2本が開くどころか交差し、指先の左右の並びまで入れ替わっていた(指同士の貫通1.4cm)。

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
      // 「パー」は指を開く形なので、親指は人差し指側へ寄せる(Y+)のではなく外へ開く(Y-)。
      ThumbProximal: rot(0, -18, -5),
      ThumbDistal: rot(0, 0, -3),
      ...curlOtherFingers(-5, -3, -2),
    },
  },
  {
    id: "fist",
    label: "グー",
    // 親指は「曲げる(Z)」ではなく「掌を横切って寄せる(Y+)」が主。旧値(Z合計-105)は
    // 曲げが強すぎて親指が握り拳の下から2.4cm飛び出し、さらに人差し指を1.7cm貫通していた。
    rotations: {
      ThumbProximal: rot(0, 40, -20),
      ThumbDistal: rot(0, 0, -30),
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
      // グーと同じ理由で、親指は畳んだ指の側面に沿わせる(Y+で寄せる)。
      ThumbProximal: rot(0, 36, -18),
      ThumbDistal: rot(0, 0, -28),
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
      ThumbProximal: rot(0, 40, -20),
      ThumbDistal: rot(0, 0, -30),
      IndexProximal: rot(0, -12, -5),
      IndexIntermediate: rot(0, 0, -3),
      IndexDistal: rot(0, 0, -2),
      MiddleProximal: rot(0, 12, -5),
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
