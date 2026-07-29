// 体型バリエーション(フェーズ6(C))のパラメータ定義。
// 「後から人間が調整する値」はここに集約する(boneDefs.ts/jointLimits.ts/propDefs.tsと同じ方針)。
// マネキンのみが対象(VRMはモデル側の仕様のため対象外)。

export type BodyBuild = "slim" | "standard" | "sturdy";
export type BodyBase = "male" | "female" | "child";

export interface BodyShapeParams {
  /** 頭身。標準的な範囲は6〜8だが、子供らしさを優先し子供プリセットはそれ未満(4付近)まで許容する。 */
  headCount: number;
  build: BodyBuild;
  base: BodyBase;
}

export const BUILD_LABELS: Record<BodyBuild, string> = {
  slim: "細め",
  standard: "標準",
  sturdy: "がっしり",
};

export const BASE_LABELS: Record<BodyBase, string> = {
  male: "男性",
  female: "女性",
  child: "子供",
};

export const BUILD_ORDER: BodyBuild[] = ["slim", "standard", "sturdy"];
export const BASE_ORDER: BodyBase[] = ["male", "female", "child"];

// 頭身スライダーの可動範囲。子供プリセット(4.6)を素直に表示・微調整できるよう下限を4まで広げてある
// (開発指示書上は「6〜8頭身程度」だが、子供プリセットは実際の子供らしさを優先し範囲外まで許容する
// 方針をユーザーと合意済み。範囲外を許可する以上、スライダー自体の下限も広げるのが素直なため)。
export const HEAD_COUNT_RANGE = { min: 4, max: 8, step: 0.1 };

// マネキンの素の頭身(MannequinBuilder.ts/boneDefs.tsの元の値から算出。この値のときスケール1.0=無加工)。
// 全高 = hips.y(0.92) + spine.y(0.14) + chest.y(0.14) + neck.y(0.14) + head bone offset(0.1)
//        + head shape上端(offset0.12+size.y/2の0.12=0.24) - foot shape下端(offset-0.03-size.y/2の0.03=-0.06、
//        hips基準では-0.02-0.44-0.42-0.06=-0.94)
//      = (0.92+0.14+0.14+0.14+0.1+0.24) - (0.92-0.94) = 1.68 - (-0.02) = 1.70m
// 頭のサイズ(MannequinBuilder.ts SHAPES.head.size[1]) = 0.24m
// 頭身 = 1.70 / 0.24 ≈ 7.083(この値はBodyShapeApplier.tsのBASE_NON_HEAD_LENGTH算出にも使う)
export const BASELINE_HEAD_COUNT = 1.7 / 0.24;

// 体型(細め/標準/がっしり)ごとの太さ倍率(肩幅・腰幅・カプセル半径・胴体ボックス幅奥行きに適用)。
// 頭身(長さ)には一切影響しない、独立した軸。
export const BUILD_THICKNESS_SCALE: Record<BodyBuild, number> = {
  slim: 0.85,
  standard: 1.0,
  sturdy: 1.18,
};

export interface BaseBodyPreset {
  headCount: number;
  build: BodyBuild;
}

// 「男性・女性・子供」切り替えは、別のマネキンを持つのではなく、頭身・体型の初期値セットとして扱う
// (詳細はPHASE6-HANDOFF.md§5参照)。選択後も個別に頭身スライダー・体型ボタンで上書き調整できる。
export const BASE_PRESETS: Record<BodyBase, BaseBodyPreset> = {
  male: { headCount: BASELINE_HEAD_COUNT, build: "standard" },
  female: { headCount: 6.6, build: "slim" },
  child: { headCount: 4.6, build: "slim" },
};

export const DEFAULT_BODY_SHAPE: BodyShapeParams = {
  headCount: BASELINE_HEAD_COUNT,
  build: "standard",
  base: "male",
};
