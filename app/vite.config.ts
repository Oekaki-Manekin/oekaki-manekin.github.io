import { defineConfig } from "vite";

export default defineConfig({
  // 配信先が https://oekaki-manekin.github.io/app/ のため、Viteへ配信パスを伝える。
  // 01_publish-environment の第3節手順6が指定している値で、同手順7の最終確認項目にもある。
  // ※ 以前は base:'/app/' と base:"./" の2行が並んでおり、JSのオブジェクトは後勝ちのため
  //    実際に効いていたのは "./" の方だった（TypeScript的にもTS1117エラーの状態）。
  //    どちらでも配信自体は成立するが、正本の指定に合わせて '/app/' へ一本化している。
  base: "/app/",
  server: {
    port: 5173,
  },
});
