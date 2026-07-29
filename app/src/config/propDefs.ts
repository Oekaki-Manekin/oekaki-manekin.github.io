// 小物(プロップ)の形状・持たせ方の定義。
// 「後から人間が調整する値」はここに集約する(boneDefs.ts/jointLimits.ts等と同じ方針)。

export type PropTypeId = "sword" | "box" | "gun" | "staff" | "chair" | "phone" | "wall" | "stairs";

interface PropPartBase {
  /** パーツのグループ内ローカル位置オフセット */
  offset: [number, number, number];
  color: number;
}

export interface PropBoxPart extends PropPartBase {
  kind: "box";
  size: [number, number, number];
}

export interface PropCylinderPart extends PropPartBase {
  kind: "cylinder";
  radius: number;
  length: number;
}

export type PropPart = PropBoxPart | PropCylinderPart;

export interface PropGripOffset {
  /**
   * 左手ボーンからのローカル位置オフセット。
   * 右手に持たせる場合はPoseMirror.ts/FingerPoseApplier.tsと同じミラー規則
   * (位置X反転、回転はクォータニオンのy,z成分反転)で自動変換する。
   */
  position: [number, number, number];
  /** 左手基準のオイラー角(度、XYZ順)。グリップの向き。 */
  rotationDeg: [number, number, number];
}

export interface PropDef {
  id: PropTypeId;
  label: string;
  /** プリミティブの組み合わせ(グループ原点が基準)。原点=持たせた時の握り位置の目安。 */
  parts: PropPart[];
  defaultScale: [number, number, number];
  grip: PropGripOffset;
}

export const PROP_ORDER: PropTypeId[] = ["sword", "box", "gun", "staff", "chair", "phone", "wall", "stairs"];

// grip.position/rotationDegの軸の意味はboneDefs.tsのFingerSpec.baseOffsetコメント
// (「Z=指の並び、X=指の伸びる向き」)を手ボーン自体にも援用し、消去法でY=手のひらの厚み方向
// (掌⇔甲)とみなしている。Y=-側が掌であることはfingerPresets.tsの「グー」プリセット
// (curlOtherFingers(-95,-105,-85) = ローカルZ軸の負回転で指を曲げる)から裏付けが取れている:
// 指は曲げると必ず掌側へ向かうため、指の伸びる向き(+X)をこの負のZ回転で曲げた先が
// 掌側になる。Rz(負角)を+X方向のベクトルに適用するとY成分が負に振れるため、
// 掌はローカル-Y側で確定(単なる推測ではない)。
//
// 【人間レビューで指摘・修正済み(3巡目)】
// - 剣: 切っ先が横(指の伸びる+X方向)を向いていたが、正面(モデル前方=ローカルZ)を
//   向くよう指示を受けた。グリップ位置(掌側オフセット)はそのままで、向きだけを
//   Z軸回転からX軸回転(+90°)に変更(group-localの+Y=切っ先方向を、Z軸回転では+Xへ、
//   X軸回転+90°では+Zへ写す)。
// - 箱: 「指先ではなく手のひらに底面中心がつくように」との指示。旧実装は手と重ならない
//   ことを優先して指方向へ丸ごと逃がしていたが、これは要件を読み違えていた。
//   正しくは「底面中心」= parts offsetを再び[0,-0.15,0](原点=底面、掌が向く-Y側へ
//   箱の体積を伸ばす)に戻し、grip.positionを手のひら中心付近([0.02, -0.015, 0]、
//   Y=-0.015は掌面ちょうど)に置く。この配置だと箱の底面(Y=-0.015)と手のY範囲の
//   上端(+0.015)の間には重なりが生じず、底面が掌面に接するだけになる
//   (X/Z方向は箱の一辺0.3が手の全幅を覆うため、指先ではなく掌全体に乗る見た目になる)。
export const PROP_DEFS: Record<PropTypeId, PropDef> = {
  sword: {
    id: "sword",
    label: "剣",
    parts: [
      // 柄(グリップ)。グループ原点を握り位置の中心とする。
      { kind: "cylinder", radius: 0.015, length: 0.12, offset: [0, 0, 0], color: 0x4a3222 },
      // 鍔(ガード)
      { kind: "box", size: [0.09, 0.016, 0.016], offset: [0, 0.065, 0], color: 0x8a7a4a },
      // 刀身
      { kind: "box", size: [0.032, 0.5, 0.012], offset: [0, 0.32, 0], color: 0xc7cdd6 },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, -0.025, 0],
      rotationDeg: [90, 0, 0],
    },
  },
  box: {
    id: "box",
    label: "箱",
    // 原点=箱の底面中心。掌が向く-Y側へ箱の体積を伸ばす(掌に底面が乗っている見た目にする)。
    parts: [{ kind: "box", size: [0.3, 0.3, 0.3], offset: [0, -0.15, 0], color: 0x8a6a45 }],
    defaultScale: [1, 1, 1],
    grip: {
      // 手のひら中心付近([0.02,*,0]は手メッシュ自体のオフセットに合わせた値)。
      // Y=-0.015は手の厚み半分=掌面ちょうどの高さ(底面中心がここに接する)。
      position: [0.02, -0.015, 0],
      rotationDeg: [0, 0, 0],
    },
  },
  // 【初期実装・目視調整前】銃・杖・椅子・スマホは開発指示書フェーズ6の残りタイプとして追加。
  // 剣・箱と同様、グリップ位置・向きは初期値であり、Browserプレビューでの目視確認・調整を
  // 前提とする(剣・箱も3巡ほど調整が入った実績あり、詳細はPHASE6-HANDOFF.md§3参照)。
  gun: {
    id: "gun",
    label: "銃",
    // 原点=グリップ(握り)の中心。剣と同じく、握りは原点付近、銃身は原点から
    // ローカル+Y方向(グリップ回転後に正面/+Zへ写る)へ伸ばす。
    parts: [
      // グリップ(握り)
      { kind: "box", size: [0.026, 0.1, 0.03], offset: [0, -0.03, -0.008], color: 0x2b2b2b },
      // フレーム・スライド(銃身側)
      { kind: "box", size: [0.03, 0.16, 0.036], offset: [0, 0.05, 0.006], color: 0x3a3a3a },
      // 銃口
      { kind: "cylinder", radius: 0.011, length: 0.03, offset: [0, 0.14, 0.006], color: 0x151515 },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, -0.02, 0],
      rotationDeg: [90, 0, 0],
    },
  },
  staff: {
    id: "staff",
    label: "杖",
    // 原点=握り位置。軸(シャフト)は原点から見て下寄り2/3・上寄り1/3程度になるよう
    // オフセットし、上端に飾りの太い筒を置く(剣のガード相当の装飾)。
    parts: [
      { kind: "cylinder", radius: 0.016, length: 1.2, offset: [0, 0.25, 0], color: 0x6b4a2f },
      { kind: "cylinder", radius: 0.03, length: 0.07, offset: [0, 0.85, 0], color: 0x8a7a4a },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, -0.02, 0],
      rotationDeg: [90, 0, 0],
    },
  },
  chair: {
    id: "chair",
    label: "椅子",
    // 原点=座面中心。手に持たせる用途は想定していないが(自由配置での設置・座り位置の
    // 目安が主用途)、PropDefの構造上グリップ定義は必須のため座面中心付近を暫定値とする。
    parts: [
      { kind: "box", size: [0.4, 0.05, 0.4], offset: [0, 0, 0], color: 0x7a5c3e },
      { kind: "box", size: [0.4, 0.4, 0.05], offset: [0, 0.225, -0.175], color: 0x7a5c3e },
      { kind: "cylinder", radius: 0.02, length: 0.4, offset: [0.17, -0.2, 0.17], color: 0x4a3222 },
      { kind: "cylinder", radius: 0.02, length: 0.4, offset: [-0.17, -0.2, 0.17], color: 0x4a3222 },
      { kind: "cylinder", radius: 0.02, length: 0.4, offset: [0.17, -0.2, -0.17], color: 0x4a3222 },
      { kind: "cylinder", radius: 0.02, length: 0.4, offset: [-0.17, -0.2, -0.17], color: 0x4a3222 },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, 0.03, 0],
      rotationDeg: [0, 0, 0],
    },
  },
  phone: {
    id: "phone",
    label: "スマホ",
    // 原点=本体中心。箱と同じく手のひら側にオフセットして乗せる。
    parts: [
      { kind: "box", size: [0.07, 0.145, 0.008], offset: [0, 0, 0], color: 0x1c1c1c },
      { kind: "box", size: [0.062, 0.132, 0.002], offset: [0, 0, 0.005], color: 0x2b3a4a },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0.02, -0.012, 0.02],
      rotationDeg: [0, 0, 0],
    },
  },
  // 【小物というよりシーンの背景・建材寄りの大型オブジェクト】椅子と同様、手に持たせる用途は
  // 想定していない(自由配置での設置が主用途)。grip値はPropDefの構造上必須のため暫定値を置く。
  wall: {
    id: "wall",
    label: "壁",
    // 原点=底面中心(床に置いたときの接地基準点)。
    parts: [{ kind: "box", size: [2.0, 2.2, 0.12], offset: [0, 1.1, 0], color: 0xcfc9bd }],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    },
  },
  stairs: {
    id: "stairs",
    label: "階段",
    // 原点=最下段踏み面の前端中央。1段=高さ0.18・奥行き0.28(実際の建築寸法に近い値)を5段分、
    // 奥へ進みながら積み上げる。
    parts: [
      { kind: "box", size: [1.0, 0.18, 0.28], offset: [0, 0.09, 0.14], color: 0x9a9186 },
      { kind: "box", size: [1.0, 0.18, 0.28], offset: [0, 0.27, 0.42], color: 0x9a9186 },
      { kind: "box", size: [1.0, 0.18, 0.28], offset: [0, 0.45, 0.7], color: 0x9a9186 },
      { kind: "box", size: [1.0, 0.18, 0.28], offset: [0, 0.63, 0.98], color: 0x9a9186 },
      { kind: "box", size: [1.0, 0.18, 0.28], offset: [0, 0.81, 1.26], color: 0x9a9186 },
    ],
    defaultScale: [1, 1, 1],
    grip: {
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    },
  },
};
