import * as THREE from "three";
import type { Character } from "../character/Character";

/** 「通常」以外は写実シェーディングを一時的に別マテリアルへ差し替えて表現する表示モード。 */
export type ShadingMode = "normal" | "toon" | "grayscale" | "silhouette";

export const SHADING_MODE_LABELS: Record<ShadingMode, string> = {
  normal: "通常",
  toon: "トゥーン調",
  grayscale: "グレースケール",
  silhouette: "シルエット",
};

// グレースケールはpost-processing(SceneManager側のShaderPass)で実現するため、
// このモジュールでのマテリアル差し替えは対象外(通常表示のまま)。
const MATERIAL_SWAP_MODES: ReadonlySet<ShadingMode> = new Set(["toon", "silhouette"]);

const SILHOUETTE_COLOR = 0x141414;
// 暗部と明部のコントラストを強めに取る(SceneManagerのトゥーン用ライティング調整とセットで
// 陰影の段差を見せるための値。均等な3分割[85,170,255]では段差がほぼ見えなかった)。
const TOON_GRADIENT_STEPS = new Uint8Array([45, 150, 255]);

let toonGradientMap: THREE.DataTexture | null = null;
function getToonGradientMap(): THREE.DataTexture {
  if (!toonGradientMap) {
    toonGradientMap = new THREE.DataTexture(TOON_GRADIENT_STEPS, TOON_GRADIENT_STEPS.length, 1, THREE.RedFormat);
    toonGradientMap.minFilter = THREE.NearestFilter;
    toonGradientMap.magFilter = THREE.NearestFilter;
    toonGradientMap.needsUpdate = true;
  }
  return toonGradientMap;
}

// シルエットは全メッシュ同一の単色でよいため、使い捨てず共有する
const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: SILHOUETTE_COLOR });

// 差し替え前の元マテリアルをメッシュごとに保持し、通常表示への復元に使う
const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

function extractColorAndMap(material: THREE.Material): { color: THREE.Color; map: THREE.Texture | null } {
  const m = material as { color?: THREE.Color; map?: THREE.Texture | null };
  return {
    color: m.color instanceof THREE.Color ? m.color.clone() : new THREE.Color(0xffffff),
    map: m.map instanceof THREE.Texture ? m.map : null,
  };
}

function buildToonMaterial(original: THREE.Material): THREE.MeshToonMaterial {
  const { color, map } = extractColorAndMap(original);
  return new THREE.MeshToonMaterial({ color, map, gradientMap: getToonGradientMap() });
}

function disposeSwappedMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (m !== silhouetteMaterial) m.dispose();
  }
}

/**
 * キャラクターの「体本体」メッシュを返す。
 * VRMはクリック選択用マーカー(rawボーンに付けたスフィア)がpickableMeshesとして
 * root配下に混在しているため、それらを除外する(マネキンはpickableMeshes自体が体本体なので除外不要)。
 * CrossCharacterSelector(モデル切替クリック判定、2026-07-28)からも再利用するためexport。
 */
export function getBodyMeshes(character: Character): THREE.Mesh[] {
  if (character.kind === "mannequin") return character.pickableMeshes as THREE.Mesh[];
  const markers = new Set<THREE.Object3D>(character.pickableMeshes);
  const meshes: THREE.Mesh[] = [];
  character.root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && !markers.has(obj)) meshes.push(obj as THREE.Mesh);
  });
  return meshes;
}

/**
 * メッシュの「本来の色」を更新する。表示モードでマテリアルが差し替えられている場合は退避してある
 * 元マテリアル側を更新し、通常表示へ戻したときに反映されるようにする。
 *
 * 【重要】シルエットは全メッシュで共有する単一マテリアル(silhouetteMaterial)のため、そこへ直接
 * 書き込むとシーン内の全オブジェクトが同じ色に染まり、色を戻す経路が無いためリロードするまで
 * 直らない(2026-08-18検出。小物のカラーピッカーがmesh.materialを型チェックなしに書き換えており、
 * MeshBasicMaterialにも.colorがあるためエラーも出さずに成功していた)。
 * 外部から小物・キャラクターの色を変える処理は必ずこの関数を通すこと。
 */
export function setBaseColor(meshes: readonly THREE.Mesh[], hex: number): void {
  for (const mesh of meshes) {
    const stored = originalMaterials.get(mesh);
    const target = stored ?? mesh.material;
    for (const m of Array.isArray(target) ? target : [target]) {
      if (m === silhouetteMaterial) continue; // 共有マテリアルには絶対に書かない
      (m as THREE.Material & { color?: THREE.Color }).color?.setHex(hex);
    }
    // 差し替え中(トゥーン)は現在表示されているマテリアルにも反映してプレビューを成立させる。
    if (stored) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m === silhouetteMaterial) continue;
        (m as THREE.Material & { color?: THREE.Color }).color?.setHex(hex);
      }
    }
  }
}

function applyShadingModeToMeshes(meshes: THREE.Mesh[], mode: ShadingMode): void {
  for (const mesh of meshes) {
    const previous = mesh.material;
    const original = originalMaterials.get(mesh) ?? previous;
    if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, previous);

    if (!MATERIAL_SWAP_MODES.has(mode)) {
      mesh.material = original;
      originalMaterials.delete(mesh);
    } else if (mode === "silhouette") {
      mesh.material = silhouetteMaterial;
    } else {
      mesh.material = Array.isArray(original) ? original.map(buildToonMaterial) : buildToonMaterial(original);
    }

    if (previous !== original) disposeSwappedMaterial(previous);
  }
}

/**
 * キャラクター本体のマテリアルを表示モードに応じて差し替える(トゥーン調・シルエット)。
 * グレースケールはSceneManager側のpost-processingで行うため、ここでは何もしない。
 * 呼び直しても安全(同モードへの再適用・モード間の切替のいずれも元マテリアルを保持したまま行える)。
 */
export function applyShadingMode(character: Character, mode: ShadingMode): void {
  applyShadingModeToMeshes(getBodyMeshes(character), mode);
}

/**
 * キャラクター以外の任意のオブジェクト群(小物/プロップ等)に表示モードを適用する。
 * applyShadingModeと同じ差し替え・復元ロジックを、Character interfaceに依らない対象へ適用するための入口。
 */
export function applyShadingModeToObjects(objects: THREE.Object3D[], mode: ShadingMode): void {
  const meshes: THREE.Mesh[] = [];
  for (const obj of objects) {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
  }
  applyShadingModeToMeshes(meshes, mode);
}
