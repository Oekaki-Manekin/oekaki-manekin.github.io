// 機能の段階公開フラグ(2026-08-03追加)。
//
// 【運用】機能を1つ公開する = このファイルのSECTION_FLAGSの該当行を1行書き換えるだけ。
//   指ポーズ: "locked",  →  指ポーズ: "public",
// それ以外のファイルには一切手を入れなくてよい。逆に、公開を取り下げたいときは "locked" に戻す。
//
// 【方針】ここでのゲートは「見た目の段階公開」であり、機能そのものを技術的に封じるものではない
// (2026-08-03、事前相談で決定)。DevToolsを開けば非公開セクションのDOMには到達できるが、無償ツールの
// 段階公開が目的であり実害が薄いため、UI要素の生成そのものはpublic時と全く同じに保つ実装を選んでいる。
// ※UI要素の生成をスキップする実装にすると、PanelUIの各フィールド(gridCheckbox等)がundefinedになり、
//   main.tsから呼ばれるsetGridVisible()等が軒並み落ちる。「1行で切り替えられる」状態を保つには、
//   「作るが、繋がない/触らせない」に留めるのが必須条件。

/**
 * 機能の公開状態。
 * - "public": 通常どおり公開する。
 * - "locked": 見出し・シェブロンをグレーアウトし「準備中」バッジを出す。クリックしても開かない。
 *             「次はこれが来る」という予告になるため、段階公開の待機状態は基本これを使う。
 * - "hidden": 右パネルにそもそも出さない(存在も伏せたい機能向け)。
 */
export type FeatureState = "public" | "locked" | "hidden";

/**
 * 右パネルのセクション見出し。PanelUIのsection()の引数型を兼ねているため、見出し文言を変えると
 * ここも直す必要がある = 直し忘れはコンパイルエラーになる。同様に、新しいセクションを足したのに
 * SECTION_FLAGSへ登録し忘れた場合もコンパイルエラーになり、「未完成の機能がうっかり公開されている」
 * という事故を型で防げる。
 */
export type SectionKey =
  | "キャラクター"
  | "体型"
  | "カメラ・表示"
  | "ライティング"
  | "小物"
  | "部位"
  | "選択中の部位"
  | "IK・ピン留め"
  | "指ポーズ"
  | "ポーズライブラリ"
  | "ポーズ操作"
  | "保存・書き出し";

/**
 * 各セクションの公開状態。導入時点では既存の見た目を変えないよう全て "public" にしてある。
 * 段階公開の開始時に、まだ出したくないセクションを "locked" へ書き換えて運用を始めること。
 */
export const SECTION_FLAGS: Record<SectionKey, FeatureState> = {
  キャラクター: "public",
  体型: "public",
  "カメラ・表示": "public",
  ライティング: "public",
  小物: "public",
  部位: "public",
  選択中の部位: "public",
  "IK・ピン留め": "public",
  指ポーズ: "public",
  ポーズライブラリ: "public",
  ポーズ操作: "public",
  "保存・書き出し": "public",
};

/**
 * "locked" のセクションに添える予告文(任意)。指定した見出しだけ、グレーアウトした見出しの下に
 * 一行だけ表示する。「何が来るのか」を伝えたいときに使い、不要なら書かなくてよい。
 */
export const SECTION_NOTES: Partial<Record<SectionKey, string>> = {};

/** "locked"・"hidden" のセクションの見出しに出すツールチップ。 */
export const LOCKED_TOOLTIP = "この機能は今後のアップデートで公開予定です";

export function sectionState(key: SectionKey): FeatureState {
  return SECTION_FLAGS[key];
}
