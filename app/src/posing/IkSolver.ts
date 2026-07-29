import * as THREE from "three";
import { CCDIKSolver } from "three/examples/jsm/animation/CCDIKSolver.js";
import { JOINT_LIMITS } from "../config/jointLimits";
import { BONE_NAMES, type BoneName } from "../config/boneDefs";
import type { Character } from "../character/Character";

const DEG2RAD = Math.PI / 180;
const EPS = 1e-4;

/** ピン留め対象(手先・足先のみ)。指示書の仕様通りピンはこの4肢に限定する。 */
export type LimbEffector = Extract<BoneName, "leftHand" | "rightHand" | "leftFoot" | "rightFoot">;
export const LIMB_EFFECTORS: LimbEffector[] = ["leftHand", "rightHand", "leftFoot", "rightFoot"];

/** IKドラッグハンドルの対象(手先・足先に加え、胸・肩・首の短いチェーンも含む) */
export type IkEffector = Extract<
  BoneName,
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot"
  | "leftShoulder"
  | "rightShoulder"
  | "chest"
  | "neck"
>;
export const IK_EFFECTORS: IkEffector[] = [
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
  "leftShoulder",
  "rightShoulder",
  "chest",
  "neck",
];

/** 胴体中心(脊椎)のIKエフェクタ。ハンドルを紫で表示して四肢と区別する。 */
export const SPINE_EFFECTORS: IkEffector[] = ["chest", "neck"];

/** 肘・膝の曲がる向きを制御するポールターゲット */
export type PoleJoint = "leftElbow" | "rightElbow" | "leftKnee" | "rightKnee";
export const POLE_JOINTS: PoleJoint[] = ["leftElbow", "rightElbow", "leftKnee", "rightKnee"];
const POLE_TO_EFFECTOR: Record<PoleJoint, LimbEffector> = {
  leftElbow: "leftHand",
  rightElbow: "rightHand",
  leftKnee: "leftFoot",
  rightKnee: "rightFoot",
};
const EFFECTOR_TO_POLE: Record<LimbEffector, PoleJoint> = {
  leftHand: "leftElbow",
  rightHand: "rightElbow",
  leftFoot: "leftKnee",
  rightFoot: "rightKnee",
};

export function getEffectorForPole(poleJoint: PoleJoint): LimbEffector {
  return POLE_TO_EFFECTOR[poleJoint];
}

function isLimbEffector(effector: IkEffector): effector is LimbEffector {
  return (LIMB_EFFECTORS as string[]).includes(effector);
}

interface ChainDef {
  effector: BoneName;
  /** エフェクタに近い順(links[0]=中間関節=肘/膝, links[1]=根元=上腕/太もも)。1リンクチェーン(肩/首)はlinks[0]のみ。 */
  links: BoneName[];
}

const CHAINS: Record<IkEffector, ChainDef> = {
  leftHand: { effector: "leftHand", links: ["leftLowerArm", "leftUpperArm"] },
  rightHand: { effector: "rightHand", links: ["rightLowerArm", "rightUpperArm"] },
  leftFoot: { effector: "leftFoot", links: ["leftLowerLeg", "leftUpperLeg"] },
  rightFoot: { effector: "rightFoot", links: ["rightLowerLeg", "rightUpperLeg"] },
  // 肩・首は1リンクの短いチェーン: ドラッグすると胸が反応してその部位を近づける(CCDで解く)
  leftShoulder: { effector: "leftShoulder", links: ["chest"] },
  rightShoulder: { effector: "rightShoulder", links: ["chest"] },
  neck: { effector: "neck", links: ["chest"] },
  // 胸は背骨(spine)を回して上半身を傾ける。hipsを含めると脚も動くため、spineのみの1リンクにする。
  chest: { effector: "chest", links: ["spine"] },
};

// 肘/膝の「曲がる向き」の既定ヒント(ワールド空間)。ポールハンドルが未操作のときの初期の膨らむ方向。
// 膝は前方(+Z)、肘は後方かつ下(-Z,-Y)に膨らむのが自然。
export const BEND_HINTS: Record<LimbEffector, THREE.Vector3> = {
  leftHand: new THREE.Vector3(0, -0.4, -1).normalize(),
  rightHand: new THREE.Vector3(0, -0.4, -1).normalize(),
  leftFoot: new THREE.Vector3(0, 0, 1),
  rightFoot: new THREE.Vector3(0, 0, 1),
};

interface CcdLinkConfig {
  index: number;
  rotationMin?: THREE.Vector3;
  rotationMax?: THREE.Vector3;
}
interface CcdConfig {
  target: number;
  effector: number;
  links: CcdLinkConfig[];
  iteration: number;
}

// 使い回し用の一時オブジェクト
const _rootPos = new THREE.Vector3();
const _midPos = new THREE.Vector3();
const _endPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _dirTarget = new THREE.Vector3();
const _clampedTarget = new THREE.Vector3();
const _bendDir = new THREE.Vector3();
const _polePos = new THREE.Vector3();
const _desiredMid = new THREE.Vector3();
const _curDir = new THREE.Vector3();
const _desDir = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _parentWorldQ = new THREE.Quaternion();
const _curWorldQ = new THREE.Quaternion();
const _newWorldQ = new THREE.Quaternion();

/**
 * IKソルバー。2ボーン肢(腕・脚)は解析的2ボーンIK(法余弦+ポールベクトル)で解き、
 * 肩・首の1リンクチェーンはthree.js純正CCDIKSolverで解く。
 *
 * 解析的2ボーンIKは1回の計算でエフェクタを目標へ正確に到達させ、ポールベクトルで曲げ方向を
 * 決めるため、CCDのように「曲げ方向がリミットと逆になって関節が動けない」問題が起きない。
 *
 * 各エフェクタにつき1つの「ターゲットノード」、各肘/膝に1つの「ポールノード」を保持する。
 * これらの位置操作・可視化は呼び出し側(IkController/PinController)が行う。
 */
export class IkSolver {
  private character: Character;
  private targetNodes = new Map<IkEffector, THREE.Object3D>();
  private poleTargetNodes = new Map<PoleJoint, THREE.Object3D>();
  private limitsEnabled = true;

  // 肩・首(1リンク)用のCCDソルバー
  private boneArray: THREE.Object3D[] = [];
  private indexByName = new Map<BoneName, number>();
  private ccdConfigs = new Map<IkEffector, CcdConfig>();
  private ccdSolver: CCDIKSolver;

  constructor(character: Character) {
    this.character = character;
    for (const name of BONE_NAMES) {
      const bone = character.bones[name];
      if (!bone) continue;
      this.indexByName.set(name, this.boneArray.length);
      this.boneArray.push(bone);
    }
    this.ccdSolver = new CCDIKSolver({ skeleton: { bones: this.boneArray } } as unknown as THREE.SkinnedMesh, []);

    for (const effector of IK_EFFECTORS) {
      if (!this.hasChain(effector)) continue;
      const target = new THREE.Object3D();
      target.name = `ikTarget_${effector}`;
      this.targetNodes.set(effector, target);
      if (!isLimbEffector(effector)) this.createCcdConfig(effector, target);
    }
    for (const poleJoint of POLE_JOINTS) {
      if (!this.hasPole(poleJoint)) continue;
      const node = new THREE.Object3D();
      node.name = `ikPole_${poleJoint}`;
      this.poleTargetNodes.set(poleJoint, node);
    }
  }

  /** 指定したエフェクタのIKチェーンが現在のキャラクターに存在するか */
  hasChain(effector: IkEffector): boolean {
    const chain = CHAINS[effector];
    if (!this.indexByName.has(chain.effector)) return false;
    return chain.links.every((name) => this.indexByName.has(name));
  }

  hasPole(poleJoint: PoleJoint): boolean {
    return this.hasChain(POLE_TO_EFFECTOR[poleJoint]);
  }

  getTargetNode(effector: IkEffector): THREE.Object3D | undefined {
    return this.targetNodes.get(effector);
  }

  getPoleTargetNode(poleJoint: PoleJoint): THREE.Object3D | undefined {
    return this.poleTargetNodes.get(poleJoint);
  }

  /** 中間関節(肘/膝)の現在のワールド位置を返す(ポールハンドルの追従に使う) */
  getPoleReferencePosition(poleJoint: PoleJoint, out: THREE.Vector3): THREE.Vector3 | undefined {
    const chain = CHAINS[POLE_TO_EFFECTOR[poleJoint]];
    const middleBone = this.character.bones[chain.links[0]];
    if (!middleBone) return undefined;
    (this.character.matrixRoot ?? this.character.root).updateMatrixWorld(true);
    return middleBone.getWorldPosition(out);
  }

  /** ポールハンドルの初期オフセット(ワールド空間)。中間関節からこの向きに離して配置する。 */
  getBendHint(poleJoint: PoleJoint): THREE.Vector3 {
    return BEND_HINTS[POLE_TO_EFFECTOR[poleJoint]];
  }

  private createCcdConfig(effector: IkEffector, target: THREE.Object3D): void {
    const chain = CHAINS[effector];
    const targetIndex = this.boneArray.length;
    this.boneArray.push(target);
    const links = chain.links.map((name) => ({ index: this.indexByName.get(name)! }));
    const config: CcdConfig = {
      target: targetIndex,
      effector: this.indexByName.get(chain.effector)!,
      links,
      iteration: 12,
    };
    this.ccdConfigs.set(effector, config);
    this.applyLimitsToCcdConfig(config, chain.links);
    this.ccdSolver.iks.push(config);
  }

  setLimitsEnabled(enabled: boolean): void {
    this.limitsEnabled = enabled;
    for (const [effector, config] of this.ccdConfigs) {
      this.applyLimitsToCcdConfig(config, CHAINS[effector].links);
    }
  }

  private applyLimitsToCcdConfig(config: CcdConfig, linkNames: BoneName[]): void {
    config.links.forEach((link, i) => {
      if (!this.limitsEnabled) {
        link.rotationMin = undefined;
        link.rotationMax = undefined;
        return;
      }
      const limit = JOINT_LIMITS[linkNames[i]];
      link.rotationMin = new THREE.Vector3(limit.x.min * DEG2RAD, limit.y.min * DEG2RAD, limit.z.min * DEG2RAD);
      link.rotationMax = new THREE.Vector3(limit.x.max * DEG2RAD, limit.y.max * DEG2RAD, limit.z.max * DEG2RAD);
    });
  }

  /** 指定したエフェクタのIKチェーンを解決する(ターゲットノードの現在位置を目標にする) */
  solve(effector: IkEffector): void {
    if (isLimbEffector(effector)) {
      this.solveTwoBone(effector);
    } else {
      this.solveCcd(effector);
    }
  }

  private solveCcd(effector: IkEffector): void {
    const config = this.ccdConfigs.get(effector);
    if (!config) return;
    (this.character.matrixRoot ?? this.character.root).updateMatrixWorld(true);
    this.targetNodes.get(effector)?.updateMatrixWorld(true);
    this.ccdSolver.updateOne(config);
  }

  /**
   * 解析的2ボーンIK。root(上腕/太もも)→mid(肘/膝)→end(手首/足首)の2リンクを、
   * 法余弦で目標へ正確に到達させ、ポールターゲットの向きで曲げ平面を決める。
   */
  private solveTwoBone(effector: LimbEffector): void {
    const chain = CHAINS[effector];
    const root = this.character.bones[chain.links[1]];
    const mid = this.character.bones[chain.links[0]];
    const end = this.character.bones[chain.effector];
    const targetNode = this.targetNodes.get(effector);
    const poleNode = this.poleTargetNodes.get(EFFECTOR_TO_POLE[effector]);
    if (!root || !mid || !end || !targetNode || !root.parent || !mid.parent) return;

    const matrixRoot = this.character.matrixRoot ?? this.character.root;
    matrixRoot.updateMatrixWorld(true);
    targetNode.updateMatrixWorld(true);

    root.getWorldPosition(_rootPos);
    mid.getWorldPosition(_midPos);
    end.getWorldPosition(_endPos);
    targetNode.getWorldPosition(_targetPos);

    const l1 = _rootPos.distanceTo(_midPos);
    const l2 = _midPos.distanceTo(_endPos);
    if (l1 < EPS || l2 < EPS) return;

    // 到達可能距離にクランプ
    _toTarget.copy(_targetPos).sub(_rootPos);
    let dist = _toTarget.length();
    if (dist < EPS) return;
    dist = THREE.MathUtils.clamp(dist, Math.abs(l1 - l2) + EPS, l1 + l2 - EPS);
    _dirTarget.copy(_toTarget).normalize();
    _clampedTarget.copy(_rootPos).addScaledVector(_dirTarget, dist);

    // 曲げ平面の向き(目標軸に垂直な、ポール方向の成分)
    _bendDir.set(0, 0, 0);
    if (poleNode) {
      poleNode.getWorldPosition(_polePos);
      _bendDir.copy(_polePos).sub(_rootPos);
      _bendDir.addScaledVector(_dirTarget, -_bendDir.dot(_dirTarget));
    }
    if (_bendDir.lengthSq() < 1e-8) {
      // ポールが目標軸とほぼ一直線 → 既定ヒントで曲げ方向を決める
      _hint.copy(BEND_HINTS[effector]);
      _bendDir.copy(_hint).addScaledVector(_dirTarget, -_hint.dot(_dirTarget));
      if (_bendDir.lengthSq() < 1e-8) {
        _bendDir.set(0, 0, 1).addScaledVector(_dirTarget, -_dirTarget.z);
        if (_bendDir.lengthSq() < 1e-8) _bendDir.set(0, 1, 0).addScaledVector(_dirTarget, -_dirTarget.y);
      }
    }
    _bendDir.normalize();

    // 法余弦: root(股/肩)での角度。中間関節を目標軸上に射影した位置 + 曲げ方向へのオフセット。
    const cosRoot = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinRoot = Math.sqrt(1 - cosRoot * cosRoot);
    _desiredMid
      .copy(_rootPos)
      .addScaledVector(_dirTarget, l1 * cosRoot)
      .addScaledVector(_bendDir, l1 * sinRoot);

    // ステップ1: rootを回して root→mid を root→desiredMid に向ける
    _curDir.copy(_midPos).sub(_rootPos).normalize();
    _desDir.copy(_desiredMid).sub(_rootPos).normalize();
    this.applyWorldDelta(root, _q1.setFromUnitVectors(_curDir, _desDir));

    // ステップ2: midを回して mid→end を mid→target に向ける(再計算後の位置で)
    matrixRoot.updateMatrixWorld(true);
    mid.getWorldPosition(_midPos);
    end.getWorldPosition(_endPos);
    _curDir.copy(_endPos).sub(_midPos).normalize();
    _desDir.copy(_clampedTarget).sub(_midPos).normalize();
    this.applyWorldDelta(mid, _q1.setFromUnitVectors(_curDir, _desDir));

    // 注: 2ボーンIKではオイラー軸別の可動域クランプは行わない。
    // 曲げ方向はポールベクトルが決め、リーチ距離のクランプが過伸展を防ぐため既定で自然な姿勢になる。
    // 軸別クランプは自由回転の解を壊し、エフェクタが目標へ届かなくなるため適用しない
    // (可動域制限トグルはFKと肩・首の1リンクCCDには従来どおり効く)。
  }

  /** ボーンのワールド回転にデルタ回転を左から掛け、ローカル回転へ変換して適用する */
  private applyWorldDelta(bone: THREE.Object3D, deltaWorldQuat: THREE.Quaternion): void {
    bone.parent!.getWorldQuaternion(_parentWorldQ);
    bone.getWorldQuaternion(_curWorldQ);
    _newWorldQ.copy(deltaWorldQuat).multiply(_curWorldQ);
    bone.quaternion.copy(_parentWorldQ.invert().multiply(_newWorldQ));
    bone.updateMatrixWorld(true);
  }
}
