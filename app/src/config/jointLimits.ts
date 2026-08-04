// 関節可動域リミット設定。
// 「後から人間が調整する値」のためこの1ファイルに集約する。単位は度(degree)。
// X=屈曲/伸展, Y=外転・内転/回旋(ボーン種により意味が異なる), Z=ひねり。
// 値は一般的な人体可動域の目安であり、フェーズ1レビューで調整される前提の仮値。

import { getFingerBoneNames, type BoneName } from "./boneDefs";

export interface AxisLimit {
  min: number;
  max: number;
}

export interface JointLimit {
  x: AxisLimit;
  y: AxisLimit;
  z: AxisLimit;
}

const deg = (min: number, max: number): AxisLimit => ({ min, max });

// 左右で同じ数値レンジを使う（ローカル軸をミラー生成しているため符号込みで共通化できる）
// フェーズ1レビューにより全体的に拡張。特に手首・腰(hips/upperLeg)は硬さの指摘を受けて大きく広げた。
export const JOINT_LIMITS: Record<BoneName, JointLimit> = {
  // hipsは「関節」ではなくモデル全体の向きを決めるルートボーン。寝そべり系プリセットは
  // ここを±90回して全身を倒しているため、関節と同じ狭い制限を掛けると成立しない
  // (旧値 x±60 のままだと、仰向けポーズ適用後に腰のギズモへ触れた瞬間に
  //  可動域クランプが走って上体が起き上がってしまった)。全方向を開放する。
  // 前後の傾き自体は spine/chest 側の制限で担保されている。
  hips: { x: deg(-180, 180), y: deg(-180, 180), z: deg(-180, 180) },
  spine: { x: deg(-50, 70), y: deg(-45, 45), z: deg(-35, 35) },
  chest: { x: deg(-40, 60), y: deg(-40, 40), z: deg(-30, 30) },
  neck: { x: deg(-50, 50), y: deg(-80, 80), z: deg(-40, 40) },
  head: { x: deg(-40, 40), y: deg(-80, 80), z: deg(-40, 40) },

  leftShoulder: { x: deg(-15, 30), y: deg(-20, 40), z: deg(-15, 15) },
  leftUpperArm: { x: deg(-90, 210), y: deg(-110, 110), z: deg(-100, 100) },
  // 肘の屈曲はこのリグではY軸(posePresets.tsの軸ルール参照。Xは前腕のねじり)。
  // 実際の肘は150度前後まで曲がるため±150まで開ける。
  //
  // 【既知の制限・2026-08-03に数値で確認】オイラー角の順序がXYZのため、中央軸である
  // Yは読み戻し時に必ず-90〜90へ畳まれる。肘を90度より深く曲げたクォータニオンは
  // bone.rotation経由で読むと (±180, 180-|Y|, ±180) という等価な別表現に化ける
  // (例: 「腰に手」の左前腕 (0,-118,0) → (180,-62,180))。
  // このため、90度を超える肘の曲げに対してはここのY上限は実質的に効かず、逆に
  // X/Zの制限(±10)がその±180に対して働いてしまい、可動域制限ONのまま肘のギズモを
  // 掴むと腕が別の向きへ飛ぶ。恒久対処は前腕だけ回転順序を変える等のリグ側の変更が
  // 必要なため、ここでは扱わない(プリセットの見た目自体は正しく適用される)。
  leftLowerArm: { x: deg(-10, 160), y: deg(-150, 150), z: deg(-10, 10) },
  leftHand: { x: deg(-90, 90), y: deg(-30, 30), z: deg(-50, 50) },

  rightShoulder: { x: deg(-15, 30), y: deg(-40, 20), z: deg(-15, 15) },
  rightUpperArm: { x: deg(-90, 210), y: deg(-110, 110), z: deg(-100, 100) },
  rightLowerArm: { x: deg(-10, 160), y: deg(-150, 150), z: deg(-10, 10) },
  rightHand: { x: deg(-90, 90), y: deg(-30, 30), z: deg(-50, 50) },

  leftUpperLeg: { x: deg(-140, 80), y: deg(-60, 60), z: deg(-50, 50) },
  leftLowerLeg: { x: deg(0, 160), y: deg(-15, 15), z: deg(-10, 10) },
  leftFoot: { x: deg(-60, 50), y: deg(-30, 30), z: deg(-40, 40) },

  rightUpperLeg: { x: deg(-140, 80), y: deg(-60, 60), z: deg(-50, 50) },
  rightLowerLeg: { x: deg(0, 160), y: deg(-15, 15), z: deg(-10, 10) },
  rightFoot: { x: deg(-60, 50), y: deg(-30, 30), z: deg(-40, 40) },

  ...buildFingerLimits(),
} as Record<BoneName, JointLimit>;

// 指プリセット・PoseMirrorは左手基準角度をクォータニオンの(y,z)成分反転で右手へミラーする
// (FingerPoseApplier.ts参照)。これは回転角としては y,z の符号反転に相当するため、
// 左右非対称なY/Z可動域(特にZ=曲げ方向は -100〜+15 のように非対称)は右手では
// symmetricでない限りそのまま使い回せない。左手側の定義を基準に、右手側は
// このmirrorJointLimit()でY/Zを符号反転(min/max入替)して生成する(X=ねじりは反転不要)。
function mirrorJointLimit(limit: JointLimit): JointLimit {
  return {
    x: limit.x,
    y: deg(-limit.y.max, -limit.y.min),
    z: deg(-limit.z.max, -limit.z.min),
  };
}

// 指ボーンの可動域(左手基準)。曲げ(カール)はZ軸、開閉(外転/内転)はY軸、ねじりはX軸という
// 共通の軸割り当てで、関節の種類(根元/中間/先)ごとに範囲を使い回す。
function buildFingerLimits(): Partial<Record<BoneName, JointLimit>> {
  const limits: Partial<Record<BoneName, JointLimit>> = {};

  const nonThumbCurl: Record<"Proximal" | "Intermediate" | "Distal", JointLimit> = {
    Proximal: { x: deg(-10, 10), y: deg(-20, 20), z: deg(-100, 15) },
    Intermediate: { x: deg(-5, 5), y: deg(-5, 5), z: deg(-110, 5) },
    Distal: { x: deg(-5, 5), y: deg(-5, 5), z: deg(-90, 5) },
  };
  const thumbCurl: Record<"Proximal" | "Distal", JointLimit> = {
    Proximal: { x: deg(-30, 60), y: deg(-40, 40), z: deg(-60, 20) },
    Distal: { x: deg(-10, 10), y: deg(-10, 10), z: deg(-80, 10) },
  };

  for (const side of ["left", "right"] as const) {
    for (const name of getFingerBoneNames(side)) {
      let base: JointLimit;
      if (name.includes("Thumb")) {
        const joint = name.endsWith("Proximal") ? "Proximal" : "Distal";
        base = thumbCurl[joint];
      } else {
        const joint = name.endsWith("Proximal")
          ? "Proximal"
          : name.endsWith("Intermediate")
            ? "Intermediate"
            : "Distal";
        base = nonThumbCurl[joint];
      }
      limits[name] = side === "right" ? mirrorJointLimit(base) : base;
    }
  }

  return limits;
}

export function clampToLimit(
  eulerDeg: { x: number; y: number; z: number },
  limit: JointLimit,
): { x: number; y: number; z: number } {
  return {
    x: Math.min(Math.max(eulerDeg.x, limit.x.min), limit.x.max),
    y: Math.min(Math.max(eulerDeg.y, limit.y.min), limit.y.max),
    z: Math.min(Math.max(eulerDeg.z, limit.z.min), limit.z.max),
  };
}
