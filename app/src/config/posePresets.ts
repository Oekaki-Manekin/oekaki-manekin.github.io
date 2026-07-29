// 内蔵ポーズプリセット定義。
//
// 「後から人間が調整する値」なのでここ(config/)に集約する。各ポーズは各ボーンの
// オイラー角(度, XYZ順)で人間が読み書きしやすい形で定義し、buildPresetPose() で
// 共通ポーズ形式(PoseData: クォータニオン)へ変換する。
//
// 軸の共通ルール(バインド姿勢=Tポーズ, モデル正面=ワールド+Z を前提):
//   ・体幹(spine/chest/neck/head): X+ 前傾 / X- 後傾, Z+ 右に傾ける, Y+ 顔を左へ
//   ・上腕(upperArm): Z で腕の上げ下げ。左は Z-90 で真下・0 で真横(T)・+90 で真上
//                     (右は符号反転。mirror:true で自動生成)
//   ・前腕(lowerArm): Y で肘を曲げる(左は Y- で前方へ)
//   ・太もも(upperLeg): X- で前へ振る(股関節屈曲) / X+ で後ろ, Z+ で外側へ開く(左)
//   ・すね(lowerLeg): X+ で膝を曲げる(ふくらはぎを後ろへ畳む)
//   ・腰(hips): hips.position でモデル全体の高さを調整(座り/寝そべりで下げる)。
//              hips のオイラー角で全身を倒す(寝そべり)。
//
// 左右対称ポーズは左側(leftXxx)＋中央ボーンのみ書き、mirror:true で右側を鏡像生成する。
// 非対称ポーズは両側を明示的に書き、mirror は付けない。

import * as THREE from "three";
import { BONE_NAMES, MIRROR_MAP, type BoneName } from "./boneDefs";
import type { PoseData, BonePoseEntry } from "../posing/PoseSerializer";

export type PoseCategory = "standing" | "sitting" | "lying" | "action" | "gesture";

export interface PosePresetDef {
  id: string;
  label: string;
  category: PoseCategory;
  /** 各ボーンのオイラー角[度, XYZ順]。省略したボーンは初期姿勢(回転なし)。 */
  euler: Partial<Record<BoneName, [number, number, number]>>;
  /** hips のローカル位置[m]。省略時は標準立位 (0, 0.92, 0)。座り/寝そべりで下げる。 */
  hips?: [number, number, number];
  /** true なら左側(leftXxx)の指定を右側へ鏡像コピーして左右対称ポーズを生成する。 */
  mirror?: boolean;
}

export const CATEGORY_LABELS: Record<PoseCategory, string> = {
  standing: "立ち",
  sitting: "座り",
  lying: "寝そべり",
  action: "アクション",
  gesture: "仕草",
};

export const CATEGORY_ORDER: PoseCategory[] = ["standing", "sitting", "lying", "action", "gesture"];

const DEFAULT_HIPS: readonly [number, number, number] = [0, 0.92, 0];

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

function toQuat(e: readonly [number, number, number]): [number, number, number, number] {
  _euler.set(
    THREE.MathUtils.degToRad(e[0]),
    THREE.MathUtils.degToRad(e[1]),
    THREE.MathUtils.degToRad(e[2]),
    "XYZ",
  );
  _quat.setFromEuler(_euler);
  return [_quat.x, _quat.y, _quat.z, _quat.w];
}

/** プリセット定義(オイラー角)を共通ポーズ形式(PoseData)へ変換する。 */
export function buildPresetPose(def: PosePresetDef): PoseData {
  const pose: PoseData = {};
  for (const key in def.euler) {
    const name = key as BoneName;
    pose[name] = { rotation: toQuat(def.euler[name]!) };
  }
  if (def.mirror) {
    for (const key in def.euler) {
      const name = key as BoneName;
      if (!name.startsWith("left")) continue;
      const right = MIRROR_MAP[name];
      if (pose[right]) continue; // 右側を明示指定済みなら尊重する
      // ミラーはクォータニオンの (y, z) 反転(PoseMirror と同じ規約)
      const [x, y, z, w] = pose[name]!.rotation;
      pose[right] = { rotation: [x, -y, -z, w] };
    }
  }
  // 明示指定の無いボーンも初期姿勢(回転なし)として明示的に埋める。
  // ここで埋めておかないと、そのボーンは PoseData に一切現れず、
  // applyPosePartial 側は「エントリが無い=触らない」と解釈してしまう。
  // その結果「全身」適用時に直前のポーズの回転(例:走るの脚)が残ってしまう
  // (このJSDocが謳う「省略したボーンは初期姿勢」という契約を満たすための処理)。
  for (const name of BONE_NAMES) {
    if (!pose[name]) pose[name] = { rotation: [0, 0, 0, 1] };
  }
  // hips の位置は常に付与する(適用時に applyHipsPosition が false ならスキップされる)
  const hips = def.hips ?? DEFAULT_HIPS;
  const hipsEntry: BonePoseEntry = pose.hips ?? { rotation: [0, 0, 0, 1] };
  hipsEntry.position = [hips[0], hips[1], hips[2]];
  pose.hips = hipsEntry;
  return pose;
}

// 標準的な「腕を体側に下ろす」角度(左手基準)。少し外に開いて自然に見せる。
const ARM_DOWN: [number, number, number] = [0, 0, -78];

export const POSE_PRESET_DEFS: PosePresetDef[] = [
  // ---------------- 立ち ----------------
  {
    id: "attention",
    label: "気をつけ",
    category: "standing",
    mirror: true,
    euler: { leftUpperArm: [0, 0, -84] },
  },
  {
    id: "relaxed_stand",
    label: "リラックス立ち",
    category: "standing",
    mirror: true,
    euler: {
      leftUpperArm: [0, 0, -76],
      leftLowerArm: [0, -14, 0],
    },
  },
  {
    id: "contrapposto",
    label: "重心を片脚に",
    category: "standing",
    mirror: true,
    euler: {
      spine: [0, 0, -4],
      chest: [0, 0, -3],
      hips: [0, 0, 5],
      leftUpperArm: [0, 0, -74],
      leftLowerArm: [0, -12, 0],
    },
  },
  {
    id: "arms_crossed",
    label: "腕組み",
    category: "standing",
    mirror: true,
    euler: {
      leftUpperArm: [0, -85, -10],
      leftLowerArm: [0, -45, 0],
      spine: [3, 0, 0],
    },
  },
  {
    id: "hands_on_hips",
    label: "腰に手",
    category: "standing",
    mirror: true,
    euler: {
      leftUpperArm: [0, 20, -42],
      leftLowerArm: [0, -118, 0],
    },
  },
  {
    id: "waving",
    label: "手を振る",
    category: "standing",
    euler: {
      // 右上腕Z: 右側は符号反転(右は負値で上げる)。+118のままだと腕が下がる方向に暴走するバグだった。
      rightUpperArm: [0, 0, -100],
      rightLowerArm: [0, 55, 0],
      leftUpperArm: ARM_DOWN,
      head: [0, -8, 0],
    },
  },
  {
    id: "thinking",
    label: "考える",
    category: "standing",
    euler: {
      rightUpperArm: [0, 0, -45],
      rightLowerArm: [0, 110, 0],
      leftUpperArm: [0, 0, -38],
      leftLowerArm: [0, -120, 0],
      head: [12, 6, 0],
      spine: [4, 0, 0],
    },
  },
  {
    id: "pointing_front",
    label: "前を指差す",
    category: "standing",
    euler: {
      rightUpperArm: [0, 88, 6],
      rightLowerArm: [0, 8, 0],
      leftUpperArm: ARM_DOWN,
      head: [0, 10, 0],
    },
  },
  // ---------------- 座り ----------------
  {
    id: "sit_chair",
    label: "椅子に座る",
    category: "sitting",
    mirror: true,
    hips: [0, 0.48, 0],
    euler: {
      spine: [6, 0, 0],
      leftUpperLeg: [-84, 0, 0],
      leftLowerLeg: [82, 0, 0],
      leftUpperArm: [0, 0, -72],
      leftLowerArm: [0, -30, 0],
    },
  },
  {
    id: "seiza",
    label: "正座",
    category: "sitting",
    mirror: true,
    hips: [0, 0.34, 0],
    euler: {
      leftUpperLeg: [-24, 0, 4],
      leftLowerLeg: [148, 0, 0],
      leftFoot: [-40, 0, 0],
      leftUpperArm: [0, 0, -70],
      leftLowerArm: [0, -34, 0],
    },
  },
  {
    id: "cross_legged",
    label: "あぐら",
    category: "sitting",
    mirror: true,
    hips: [0, 0.3, 0],
    euler: {
      leftUpperLeg: [-58, 0, 34],
      leftLowerLeg: [96, 0, 0],
      leftFoot: [0, -30, 0],
      leftUpperArm: [0, 0, -68],
      leftLowerArm: [0, -36, 0],
    },
  },
  {
    id: "hug_knees",
    label: "体育座り",
    category: "sitting",
    mirror: true,
    hips: [0, 0.36, 0],
    euler: {
      spine: [14, 0, 0],
      chest: [6, 0, 0],
      leftUpperLeg: [-112, 0, 6],
      leftLowerLeg: [128, 0, 0],
      leftUpperArm: [0, 0, -40],
      leftLowerArm: [0, -120, 0],
    },
  },
  {
    id: "kneel_one",
    label: "片膝立ち",
    category: "sitting",
    hips: [0, 0.5, 0],
    euler: {
      leftUpperLeg: [-14, 0, 4],
      leftLowerLeg: [144, 0, 0],
      leftFoot: [-38, 0, 0],
      rightUpperLeg: [-92, 0, 0],
      rightLowerLeg: [86, 0, 0],
      spine: [6, 0, 0],
      // 左腕は体側で軽く力を抜き、右腕は前方の膝の上へ乗せる(右腕のY=前方振り出し、Z=右側は正値で下げる)。
      leftUpperArm: [0, 0, -70],
      leftLowerArm: [0, -15, 0],
      rightUpperArm: [0, 50, 60],
      rightLowerArm: [0, 40, 0],
    },
  },
  {
    id: "sit_floor_lean",
    label: "床でくつろぐ",
    category: "sitting",
    mirror: true,
    hips: [0, 0.3, 0],
    euler: {
      spine: [-8, 0, 0],
      leftUpperLeg: [-64, 0, 6],
      leftLowerLeg: [28, 0, 0],
      leftUpperArm: [0, 0, -104],
      leftLowerArm: [0, -10, 0],
    },
  },
  // ---------------- 寝そべり ----------------
  {
    id: "lie_back",
    label: "仰向け",
    category: "lying",
    mirror: true,
    hips: [0, 0.18, 0],
    euler: {
      hips: [-90, 0, 0],
      leftUpperArm: [0, 0, -62],
      leftLowerArm: [0, -8, 0],
    },
  },
  {
    id: "lie_prone",
    label: "うつ伏せ",
    category: "lying",
    mirror: true,
    hips: [0, 0.2, 0],
    euler: {
      hips: [90, 0, 0],
      // Z角度の絶対値が約113度を超えると腕が体の反対側まで振り切れてしまうため-100に抑える。
      leftUpperArm: [0, 0, -100],
      leftLowerArm: [0, -30, 0],
    },
  },
  {
    id: "lie_side",
    label: "横向き",
    category: "lying",
    hips: [0, 0.2, 0],
    euler: {
      hips: [0, 0, 90],
      leftUpperLeg: [-30, 0, 0],
      leftLowerLeg: [46, 0, 0],
      rightUpperLeg: [-18, 0, 0],
      rightLowerLeg: [30, 0, 0],
      leftUpperArm: [0, 0, -50],
      leftLowerArm: [0, -40, 0],
      rightUpperArm: [0, 0, 84],
    },
  },
  {
    id: "lie_relaxed",
    label: "寝そべりくつろぎ",
    category: "lying",
    mirror: true,
    hips: [0, 0.18, 0],
    euler: {
      hips: [-90, 0, 0],
      // Z角度の絶対値が約113度を超えると腕が体の反対側まで振り切れてしまうため-100に抑える。
      leftUpperArm: [0, 0, -100],
      leftLowerArm: [0, -30, 0],
      leftUpperLeg: [-6, 0, 8],
      leftLowerLeg: [24, 0, 0],
    },
  },
  // ---------------- アクション ----------------
  {
    id: "walk",
    label: "歩く",
    category: "action",
    euler: {
      leftUpperLeg: [-26, 0, 0],
      leftLowerLeg: [12, 0, 0],
      rightUpperLeg: [20, 0, 0],
      rightLowerLeg: [34, 0, 0],
      leftUpperArm: [-18, 0, -74],
      leftLowerArm: [0, -26, 0],
      rightUpperArm: [22, 0, 74],
      rightLowerArm: [0, 26, 0],
      spine: [4, 0, 0],
    },
  },
  {
    id: "run",
    label: "走る",
    category: "action",
    euler: {
      spine: [16, 4, 0],
      chest: [6, 0, 0],
      leftUpperLeg: [-54, 0, 0],
      leftLowerLeg: [64, 0, 0],
      rightUpperLeg: [40, 0, 0],
      rightLowerLeg: [96, 0, 0],
      rightFoot: [-30, 0, 0],
      leftUpperArm: [-46, 0, -70],
      leftLowerArm: [0, -95, 0],
      rightUpperArm: [50, 0, 70],
      rightLowerArm: [0, 95, 0],
      head: [-6, 0, 0],
    },
  },
  {
    id: "fighting_stance",
    label: "構え",
    category: "action",
    mirror: true,
    hips: [0, 0.82, 0],
    euler: {
      spine: [8, 14, 0],
      leftUpperLeg: [-24, 0, 16],
      leftLowerLeg: [40, 0, 0],
      leftUpperArm: [0, 0, -44],
      leftLowerArm: [0, -118, 0],
    },
  },
  {
    id: "jump",
    label: "ジャンプ",
    category: "action",
    mirror: true,
    euler: {
      spine: [-6, 0, 0],
      // Z角度の絶対値が約113度を超えると腕が体の反対側まで振り切れてしまうため100に抑える。
      leftUpperArm: [0, 0, 100],
      leftLowerArm: [0, 20, 0],
      leftUpperLeg: [-30, 0, 6],
      leftLowerLeg: [46, 0, 0],
      leftFoot: [-24, 0, 0],
    },
  },
  // ---------------- 仕草 ----------------
  {
    id: "bow",
    label: "お辞儀",
    category: "gesture",
    mirror: true,
    euler: {
      spine: [34, 0, 0],
      chest: [14, 0, 0],
      neck: [-16, 0, 0],
      leftUpperArm: [0, 0, -80],
    },
  },
  {
    id: "banzai",
    label: "万歳",
    category: "gesture",
    mirror: true,
    euler: {
      spine: [-6, 0, 0],
      leftUpperArm: [0, 0, 80],
      leftLowerArm: [0, 6, 0],
    },
  },
  {
    id: "shy",
    label: "照れ・恥じらい",
    category: "gesture",
    euler: {
      head: [14, -18, 6],
      spine: [8, 0, 0],
      // 右上腕Z: 右側は符号反転(右は負値で上げる)。+40のままだと顔に届かず腕が下がる方向だった。
      rightUpperArm: [0, 0, -45],
      rightLowerArm: [0, 128, 0],
      leftUpperArm: [0, 0, -34],
      leftLowerArm: [0, -70, 0],
    },
  },
];
