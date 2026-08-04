import * as THREE from "three";

// 全身が画面に収まる距離を求める共通ロジック(2026-08-03、ユーザー要望)。
// 起動時の初期カメラ・視点プリセットボタン・多角度PNG書き出しの3経路から共有する。
// 同じ「収める」計算を経路ごとに書くと片方だけ直して食い違うため、必ずここへ集約すること
// (PHASE6-HANDOFF-5.md §5「同じジオメトリを2箇所で独立に生成すると片方だけ直して食い違う」と同じ理由)。

/** フィット時に上下左右へ確保する余白の割合(1.0=ぴったり、1.08=対象サイズの8%ぶん余白)。 */
const DEFAULT_MARGIN = 1.08;
/** 対象が極端に小さい場合などに寄りすぎてニアクリップするのを防ぐ最小距離[m]。 */
const MIN_DISTANCE = 0.2;

export interface FitOptions {
  /**
   * ビューのうち実際に画像として残る割合(0〜1)。「キャンバス枠内だけを書き出す」がONのとき、
   * 枠の外は画像に残らないため、判定範囲もその割合まで縮めないと枠で見切れる。
   * 枠は常に中央揃え(CanvasFrameOverlay.getRect)なので単純な縮小で正しく扱える。
   */
  viewportFraction?: { x: number; y: number };
  /** 余白の割合。既定はDEFAULT_MARGIN。 */
  margin?: number;
}

const _box = new THREE.Box3();
const _basis = new THREE.Matrix4();
const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * 注視点(target)と視線の向き(direction: targetからカメラへ向かう単位ベクトル)を保ったまま、
 * objectsが画面内に収まるカメラ距離を求める。対象が空・カメラのfov/aspectが不正な場合はnullを返す。
 *
 * 「バウンディング球の半径から距離を出す」定番の方法は注視点を球の中心へ移す前提のため、
 * アオリ(注視点1.1m・カメラ0.2m)や俯瞰のように注視点をあえてずらしてある構図(cameraPresets.ts)では
 * その構図の意図が消えてしまう。ここではtargetとdirectionを固定したまま、バウンディングボックスの
 * 8頂点それぞれについて「その頂点が視錐台に入るのに必要な距離」を解き、その最大値を採る。
 * カメラ空間で頂点の視線方向成分をa・横成分をx・縦成分をyとすると、距離distでの奥行きは(dist - a)
 * なので、収まる条件は |y| <= (dist - a) * tan(fov/2)、すなわち dist >= a + |y| / tan(fov/2)
 * (横方向は tan(fov/2) * aspect で同様)になる。
 */
export function computeFitDistance(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  objects: readonly THREE.Object3D[],
  options: FitOptions = {},
): number | null {
  // レイアウト確定前にSceneManagerが構築されるとaspect、ひいてはsetFocalLength()が逆算するfovが
  // NaNのまま固定されうる(PHASE6-HANDOFF-5.md §6)。その値で距離を出すと壊れた位置へ飛ぶため弾く。
  if (!Number.isFinite(camera.fov) || !Number.isFinite(camera.aspect) || camera.aspect <= 0) return null;

  _box.makeEmpty();
  for (const object of objects) {
    // Box3.expandByObject()は対象自身と子のワールド行列しか更新しないため、祖先の行列が古いままだと
    // 誤った位置で囲ってしまう。先に祖先まで含めて更新しておく
    // (rAFが止まる検証環境では特に、直前の位置変更が行列へ反映されていないことがある)。
    object.updateWorldMatrix(true, false);
    // 第2引数precise=trueが必須(2026-08-03、ユーザー報告: 動的なポーズだと3面図が見切れる)。
    // VRMの体メッシュはSkinnedMeshで、既定(precise=false)のBox3.expandByObject()は
    // geometry.boundingBox(バインドポーズ=Tポーズの静的な値)をメッシュ自身の行列で変換するだけで、
    // 実際のボーン変形(スキニング)を一切見ない。そのためポーズを変えても常にTポーズ時と同じ
    // 箱になり、腕や脚を大きく動かすほど実際のシルエットとの誤差が広がって見切れていた。
    // precise=trueは頂点ごとにボーン変形後の実位置を計算するため正しい。
    _box.expandByObject(object, true);
  }
  if (_box.isEmpty()) return null;

  const margin = options.margin ?? DEFAULT_MARGIN;
  const fractionX = options.viewportFraction?.x ?? 1;
  const fractionY = options.viewportFraction?.y ?? 1;
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const halfV = tanHalfFov * fractionY;
  const halfH = tanHalfFov * camera.aspect * fractionX;
  if (!(halfV > 0) || !(halfH > 0)) return null;

  // camera.lookAt()と同じ基底を作る(俯瞰のように視線が真上に近い縮退ケースの扱いも揃えるため、
  // 自前でcrossを取らずMatrix4.lookAtへ委ねる)。距離は基底に影響しないので仮の位置でよい。
  _eye.copy(target).add(direction);
  _basis.lookAt(_eye, target, camera.up);
  _right.setFromMatrixColumn(_basis, 0);
  _up.setFromMatrixColumn(_basis, 1);
  _back.setFromMatrixColumn(_basis, 2);

  let distance = MIN_DISTANCE;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      i & 1 ? _box.max.x : _box.min.x,
      i & 2 ? _box.max.y : _box.min.y,
      i & 4 ? _box.max.z : _box.min.z,
    );
    _corner.sub(target);
    const along = _corner.dot(_back);
    const lateral = Math.abs(_corner.dot(_right)) * margin;
    const vertical = Math.abs(_corner.dot(_up)) * margin;
    distance = Math.max(distance, along + vertical / halfV, along + lateral / halfH);
  }
  return distance;
}

/**
 * objectsのワールド空間バウンディングボックスの中心を返す。対象が空ならnull。
 * 多角度PNG書き出しで「選択されているモデルを中心に」構図を組むための注視点として使う
 * (2026-08-03、ユーザー報告: モデルを原点から大きく動かして書き出すと見切れる)。
 * 視点プリセット(cameraPresets.ts)の注視点は原点付近の固定値のため、モデルがそこから
 * 離れるほど画面の端・外へ追いやられていた。
 */
export function computeBoundsCenter(objects: readonly THREE.Object3D[]): THREE.Vector3 | null {
  _box.makeEmpty();
  for (const object of objects) {
    object.updateWorldMatrix(true, false);
    // precise=trueが必須の理由はcomputeFitDistance()のコメント参照(VRMのSkinnedMeshはバインド
    // ポーズの静的boundingBoxのままだとポーズの変化を反映しない)。
    _box.expandByObject(object, true);
  }
  if (_box.isEmpty()) return null;
  _box.getCenter(_center);
  return _center.clone();
}
