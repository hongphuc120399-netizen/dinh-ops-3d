import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BEAUFORT_TABLE,
  estimateItemMassKg,
  evaluateTowerUnderLoad,
  PRESET_PROP_TEMPLATES,
  solveRankedBrickTowers,
  type EnvironmentLoadConfig,
  type PlacedPart3D,
  type PropShapeKind,
  type TowerBuildMode,
  type TowerInventoryItem,
  type TowerSolution
} from '../utils/brickTowerEngine';
import { BrickTowerPhysicsSim } from '../utils/brickPhysicsWorld';

const TOWER_INV_STORAGE_KEY = 'dinh_brick_tower_inv_v1';

const DEFAULT_INVENTORY: TowerInventoryItem[] = [
  {
    id: 'brick-default',
    count: 20,
    ...PRESET_PROP_TEMPLATES[0]
  },
  {
    id: 'bottle-full-default',
    count: 2,
    ...PRESET_PROP_TEMPLATES[2]
  },
  {
    id: 'plate-default',
    count: 1,
    ...PRESET_PROP_TEMPLATES[7]
  }
];

function loadSavedInventory(): TowerInventoryItem[] {
  try {
    const raw = localStorage.getItem(TOWER_INV_STORAGE_KEY);
    if (!raw) return DEFAULT_INVENTORY;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as TowerInventoryItem[];
  } catch {
    // ignore storage errors
  }
  return DEFAULT_INVENTORY;
}

function saveInventory(items: TowerInventoryItem[]): void {
  try {
    localStorage.setItem(TOWER_INV_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/**
 * Blends a part's natural color into Vivid Engineering RED based on Load-Bearing Zone Intensity (0..100).
 * Lightly loaded upper parts keep their natural color; primary load-bearing / bottleneck courses glow RED!
 */
const _tmpBaseCol = new THREE.Color();
const _tmpWarnCol = new THREE.Color(0xf97316);
const _tmpRedCol = new THREE.Color(0xdc2626);
function computeLoadBearingDisplayHex(baseColor: string, redIntensity: number): number {
  _tmpBaseCol.set(baseColor);
  if (redIntensity < 36) {
    return _tmpBaseCol.getHex();
  }
  if (redIntensity < 70) {
    const t = ((redIntensity - 36) / 34) * 0.65;
    _tmpBaseCol.lerp(_tmpWarnCol, t);
    return _tmpBaseCol.getHex();
  }
  const tRed = Math.min(0.92, 0.62 + ((redIntensity - 70) / 30) * 0.3);
  _tmpBaseCol.lerp(_tmpRedCol, tRed);
  return _tmpBaseCol.getHex();
}

export interface BrickTower3DModalProps {
  pitchDeg?: number;
  rollDeg?: number;
  useRealSensor?: boolean;
  onToggleRealSensor?: (enable: boolean) => void;
  onClose: () => void;
}

type RightPanelTab = 'stress' | 'load' | 'steps';

const BrickTower3DModalInner: React.FC<BrickTower3DModalProps> = ({
  pitchDeg = 0,
  rollDeg = 0,
  useRealSensor = false,
  onToggleRealSensor,
  onClose
}) => {
  const [inventory, setInventory] = useState<TowerInventoryItem[]>(() => loadSavedInventory());
  const [buildMode, setBuildMode] = useState<TowerBuildMode>('max_solid');

  // Design target load (used when Auto-Optimizing the blueprint)
  const [designEnv, setDesignEnv] = useState<EnvironmentLoadConfig>({
    beaufortLevel: 3,
    windSpeedMps: BEAUFORT_TABLE[3].windMps,
    tiltDeg: 2.0,
    shakeG: 0.035,
    topPayloadKg: 0
  });

  // Live interactive test load (starts in Calm Idle = 0 wind / 0 slope / 0 shake so leaving it untouched never self-topples!)
  const [testBeaufort, setTestBeaufort] = useState<number>(0);
  const [testTiltDeg, setTestTiltDeg] = useState<number>(0.0);
  const [testShakePct, setTestShakePct] = useState<number>(0); // 0..100% -> 0..0.28g
  const [testTopPayloadKg, setTestTopPayloadKg] = useState<number>(0); // 0..25kg real weight on crown!
  const [usePhoneTiltTest, setUsePhoneTiltTest] = useState<boolean>(false);
  const [autoAdaptLive, setAutoAdaptLive] = useState<boolean>(false);
  const [physicsPaused, setPhysicsPaused] = useState<boolean>(false);
  // Highlight Red Load-Bearing Zones ON by default!
  const [showStressHeatmap, setShowStressHeatmap] = useState<boolean>(true);

  // Real-time rigid-body collapse status (updated ONLY on edge transitions, zero polling re-renders!)
  const [physCollapsed, setPhysCollapsed] = useState<boolean>(false);
  const [dislodgedParts, setDislodgedParts] = useState<number>(0);

  // Self-evolving candidate ladder: if #1 collapses in real 3D physics, automatically try #2, #3... until standing!
  const [candidateIdx, setCandidateIdx] = useState<number>(0);
  const [rejectedCount, setRejectedCount] = useState<number>(0);
  const [autoSwitchOnCollapse, setAutoSwitchOnCollapse] = useState<boolean>(true);

  const [visibleUpToCourse, setVisibleUpToCourse] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<RightPanelTab>('stress');

  // Custom Mystery Item Adder State
  const [showCustomForm, setShowCustomForm] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('Vật dụng trạm phát thêm');
  const [customKind, setCustomKind] = useState<PropShapeKind>('block');
  const [customMaterial, setCustomMaterial] = useState<
    'brick' | 'wood' | 'water' | 'hollow_plastic' | 'stone' | 'metal'
  >('wood');
  const [customCount, setCustomCount] = useState<number>(2);
  const [customL, setCustomL] = useState<number>(22);
  const [customW, setCustomW] = useState<number>(10);
  const [customH, setCustomH] = useState<number>(6);
  const [customMass, setCustomMass] = useState<number>(() =>
    estimateItemMassKg('block', 22, 10, 6, 'wood')
  );
  const [replaySeq, setReplaySeq] = useState<number>(0);

  // Ignore 60Hz phone sensor updates completely when `usePhoneTiltTest` is OFF!
  const phoneTiltDeg = usePhoneTiltTest && useRealSensor
    ? Math.min(18, Number(Math.hypot(pitchDeg, rollDeg).toFixed(1)))
    : null;
  const effectiveTiltDeg = phoneTiltDeg ?? testTiltDeg;

  const liveEnv = useMemo<EnvironmentLoadConfig>(
    () => ({
      beaufortLevel: testBeaufort,
      windSpeedMps: BEAUFORT_TABLE[testBeaufort]?.windMps ?? 0,
      tiltDeg: effectiveTiltDeg,
      shakeG: Number(((testShakePct / 100) * 0.28).toFixed(3)),
      topPayloadKg: testTopPayloadKg
    }),
    [testBeaufort, effectiveTiltDeg, testShakePct, testTopPayloadKg]
  );

  // Even when live sliders are at 0 (Calm Idle), design the tower to withstand at least Cấp 3 wind + 2° slope + 12% shake!
  const activeDesignEnv = useMemo<EnvironmentLoadConfig>(() => {
    const src = autoAdaptLive ? liveEnv : designEnv;
    return {
      beaufortLevel: Math.max(3, src.beaufortLevel),
      windSpeedMps: Math.max(BEAUFORT_TABLE[3].windMps, src.windSpeedMps),
      tiltDeg: Math.max(2.0, src.tiltDeg),
      shakeG: Math.max(0.032, src.shakeG),
      topPayloadKg: src.topPayloadKg ?? 0
    };
  }, [autoAdaptLive, liveEnv, designEnv]);
  const candidateLadder = useMemo<TowerSolution[]>(
    () => solveRankedBrickTowers(inventory, activeDesignEnv, buildMode, 12),
    [inventory, activeDesignEnv, buildMode]
  );

  useEffect(() => {
    setCandidateIdx(0);
    setRejectedCount(0);
  }, [candidateLadder]);

  const safeCandIdx = Math.min(candidateIdx, Math.max(0, candidateLadder.length - 1));
  const baseSolution = candidateLadder[safeCandIdx];

  const liveSolution = useMemo<TowerSolution>(
    () => evaluateTowerUnderLoad(baseSolution, liveEnv),
    [baseSolution, liveEnv]
  );

  const canAdvanceCandidate = safeCandIdx + 1 < candidateLadder.length;
  const isAutoAdvancing =
    physCollapsed &&
    autoSwitchOnCollapse &&
    buildMode !== 'naive' &&
    visibleUpToCourse === null &&
    !physicsPaused &&
    canAdvanceCandidate;

  useEffect(() => {
    if (!isAutoAdvancing) return;
    const timer = window.setTimeout(() => {
      setRejectedCount((c) => c + 1);
      setCandidateIdx((idx) => Math.min(idx + 1, candidateLadder.length - 1));
    }, 850);
    return () => window.clearTimeout(timer);
  }, [isAutoAdvancing, candidateLadder.length]);

  useEffect(() => {
    setVisibleUpToCourse(null);
  }, [baseSolution.courseCount, buildMode]);

  const updateInvList = useCallback((updater: (prev: TowerInventoryItem[]) => TowerInventoryItem[]) => {
    setInventory((prev) => {
      const next = updater(prev);
      saveInventory(next);
      return next;
    });
  }, []);

  const handleChangeCount = (id: string, delta: number) => {
    updateInvList((prev) =>
      prev
        .map((it) => (it.id === id ? { ...it, count: Math.max(0, it.count + delta) } : it))
        .filter((it) => it.count > 0 || it.id === 'brick-default')
    );
  };

  const handleQuickAddPreset = (tplIdx: number) => {
    const tpl = PRESET_PROP_TEMPLATES[tplIdx];
    updateInvList((prev) => {
      const existing = prev.find((x) => x.name === tpl.name);
      if (existing) {
        return prev.map((x) => (x.id === existing.id ? { ...x, count: x.count + 1 } : x));
      }
      return [
        ...prev,
        {
          id: `preset-${tplIdx}-${Date.now()}`,
          count: tpl.kind === 'block' ? 6 : 1,
          ...tpl
        }
      ];
    });
  };

  const handleAddCustomMysteryItem = () => {
    const cleanName = customName.trim() || 'Món đồ phát thêm';
    const newItem: TowerInventoryItem = {
      id: `custom-${Date.now()}`,
      name: cleanName,
      kind: customKind,
      count: Math.max(1, Math.round(customCount)),
      lengthCm: Math.max(0.5, Number(customL) || 10),
      widthCm: Math.max(0.5, Number(customW) || 10),
      heightCm: Math.max(0.5, Number(customH) || 10),
      massKg: Math.max(0.01, Number(customMass) || 0.2),
      color:
        customKind === 'rod'
          ? '#a3be5c'
          : customKind === 'plate'
            ? '#d4a373'
            : customKind === 'stool'
              ? '#2563eb'
              : customKind === 'basket'
                ? '#14b8a6'
                : customKind === 'ballast'
                  ? '#64748b'
                  : customKind === 'binder'
                    ? '#fde047'
                    : customKind === 'cylinder'
                      ? '#38bdf8'
                      : '#d97742',
      isCustom: true
    };
    updateInvList((prev) => [...prev, newItem]);
    setShowCustomForm(false);
  };

  const handleOptimizeForCurrentLoad = (targetMode?: TowerBuildMode) => {
    const nextMode: TowerBuildMode =
      targetMode ?? (buildMode === 'naive' ? 'max_solid' : buildMode);
    const sameEnv =
      designEnv.beaufortLevel === liveEnv.beaufortLevel &&
      Math.abs(designEnv.tiltDeg - liveEnv.tiltDeg) < 0.05 &&
      Math.abs(designEnv.shakeG - liveEnv.shakeG) < 0.002 &&
      Math.abs((designEnv.topPayloadKg ?? 0) - (liveEnv.topPayloadKg ?? 0)) < 0.05;
    const sameMode = buildMode === nextMode;

    setPhysicsPaused(false);
    setVisibleUpToCourse(null);
    setAutoSwitchOnCollapse(true);

    if (!sameMode) {
      setBuildMode(nextMode);
      setDesignEnv(liveEnv);
    } else if (!sameEnv) {
      setDesignEnv(liveEnv);
    } else if (physCollapsed && safeCandIdx + 1 < candidateLadder.length) {
      setRejectedCount((c) => c + 1);
      setCandidateIdx(safeCandIdx + 1);
    } else {
      setCandidateIdx(0);
      setRejectedCount(0);
    }
    setReplaySeq((s) => s + 1);
    if (navigator.vibrate) navigator.vibrate(22);
  };

  // =========================================================================
  // THREE.JS + CANNON-ES 120Hz ZERO-GC SHARED-GEOMETRY STUDIO
  // =========================================================================
  const stageRef = useRef<HTMLDivElement | null>(null);
  const liveHeightDomRef = useRef<HTMLElement | null>(null);
  const physicsSimRef = useRef<BrickTowerPhysicsSim | null>(null);

  const liveAnimRef = useRef({
    sol: liveSolution,
    baseSol: baseSolution,
    env: liveEnv,
    visibleUpToCourse,
    physicsPaused
  });
  liveAnimRef.current = {
    sol: liveSolution,
    baseSol: baseSolution,
    env: liveEnv,
    visibleUpToCourse,
    physicsPaused
  };

  const threeCtxRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    tableGroup: THREE.Group;
    partsGroup: THREE.Group;
    rulerGroup: THREE.Group;
    payloadGroup: THREE.Group;
    liveLaserLine: THREE.Line;
    comMarker: THREE.Mesh;
    plumbLine: THREE.Line;
    supportRing: THREE.Mesh;
    criticalStressRing: THREE.Mesh;
    windLines: THREE.LineSegments;
    windPositions: Float32Array;
    // Shared unit geometries & materials -> ZERO per-brick geometry/shader allocations!
    unitBoxGeo: THREE.BoxGeometry;
    unitBoxEdges: THREE.EdgesGeometry;
    unitCylGeo: THREE.CylinderGeometry;
    unitBandGeo: THREE.CylinderGeometry;
    sharedEdgeMat: THREE.LineBasicMaterial;
    sharedRedEdgeMat: THREE.LineBasicMaterial;
    sharedBandMat: THREE.MeshBasicMaterial;
    materialPool: Map<string, THREE.MeshLambertMaterial>;
    partMeshes: Map<string, THREE.Object3D>;
    partPrimaryMeshes: Map<
      string,
      { meshes: THREE.Mesh[]; edges: THREE.LineSegments[]; baseColor: string; courseIndex: number }
    >;
    guyWireLines: Map<string, THREE.Line>;
  } | null>(null);

  const handlePokeCrown = useCallback(() => {
    const sim = physicsSimRef.current;
    if (!sim || sim.handles.length === 0) return;
    let topHandle = sim.handles[0];
    let maxY = -Infinity;
    for (const h of sim.handles) {
      if (h.body.position.y > maxY) {
        maxY = h.body.position.y;
        topHandle = h;
      }
    }
    setVisibleUpToCourse(null);
    setPhysicsPaused(false);
    sim.pokePart(topHandle.part.id, 1, 0.2, 1.35);
    if (navigator.vibrate) navigator.vibrate(18);
  }, []);

  // 1. Initialize Three.js Scene + Shared Unit Buffers + 120Hz Render Loop Once
  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;

    const isMobileCoarse =
      window.matchMedia?.('(pointer: coarse)').matches || window.devicePixelRatio >= 2.2;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060b13');

    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.02,
      40
    );
    camera.position.set(1.32, 1.08, 1.78);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobileCoarse,
      stencil: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileCoarse ? 1.35 : 1.85));
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 360);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera);
    controls.domElement = renderer.domElement;

    const mapClientCoords = (clientX: number, clientY: number): { x: number; y: number } => {
      if (!document.querySelector('.app-shell.synthetic-landscape')) {
        return { x: clientX, y: clientY };
      }
      return { x: clientY, y: window.innerWidth - clientX };
    };

    const rawCtrl = controls as unknown as {
      _onPointerDown: (ev: PointerEvent) => void;
      _onPointerMove: (ev: PointerEvent) => void;
      _onPointerUp: (ev: PointerEvent) => void;
      _onMouseWheel: (ev: WheelEvent) => void;
      connect: () => void;
    };
    const wrapEv = <E extends Event>(ev: E): E => {
      if (!document.querySelector('.app-shell.synthetic-landscape')) return ev;
      const me = ev as unknown as { clientX?: number; clientY?: number };
      const mapped = mapClientCoords(me.clientX ?? 0, me.clientY ?? 0);
      return new Proxy(ev, {
        get(target, prop) {
          if (prop === 'clientX' || prop === 'pageX') return mapped.x;
          if (prop === 'clientY' || prop === 'pageY') return mapped.y;
          const val = Reflect.get(target, prop, target);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
    };
    const oDown = rawCtrl._onPointerDown;
    const oMove = rawCtrl._onPointerMove;
    const oUp = rawCtrl._onPointerUp;
    const oWheel = rawCtrl._onMouseWheel;
    rawCtrl._onPointerDown = (ev: PointerEvent) => oDown(wrapEv(ev));
    rawCtrl._onPointerMove = (ev: PointerEvent) => oMove(wrapEv(ev));
    rawCtrl._onPointerUp = (ev: PointerEvent) => oUp(wrapEv(ev));
    rawCtrl._onMouseWheel = (ev: WheelEvent) => oWheel(wrapEv(ev));
    rawCtrl.connect();

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 0.45;
    controls.maxDistance = 8.5;
    controls.target.set(0, 0.5, 0);

    scene.add(new THREE.AmbientLight(0xdbeafe, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff3db, 1.45);
    keyLight.position.set(2.5, 4.2, 2.8);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
    rimLight.position.set(-2.5, 2.0, -2.2);
    scene.add(rimLight);

    const catchFloorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x09111e, transparent: true, opacity: 0.68 })
    );
    catchFloorMesh.rotation.x = -Math.PI / 2;
    catchFloorMesh.position.y = -0.32;
    scene.add(catchFloorMesh);

    const tableGroup = new THREE.Group();
    scene.add(tableGroup);

    const padGeo = new THREE.BoxGeometry(1.24, 0.08, 1.24);
    padGeo.translate(0, -0.04, 0);
    tableGroup.add(new THREE.Mesh(padGeo, new THREE.MeshLambertMaterial({ color: 0x162030 })));
    tableGroup.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(padGeo),
        new THREE.LineBasicMaterial({ color: 0x334155 })
      )
    );

    const grid = new THREE.GridHelper(1.2, 12, 0x334155, 0x1e293b);
    grid.position.y = 0.001;
    tableGroup.add(grid);

    const ringGeo = new THREE.RingGeometry(0.085, 0.1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const supportRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      })
    );
    supportRing.position.y = 0.003;
    tableGroup.add(supportRing);

    // 3D Red Critical Load-Bearing Zone Ring (highlights the most heavily stressed joint plane!)
    const critRingGeo = new THREE.RingGeometry(0.11, 0.142, 32);
    critRingGeo.rotateX(-Math.PI / 2);
    const criticalStressRing = new THREE.Mesh(
      critRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78
      })
    );
    criticalStressRing.position.y = 0.006;
    tableGroup.add(criticalStressRing);

    const partsGroup = new THREE.Group();
    const rulerGroup = new THREE.Group();
    tableGroup.add(partsGroup, rulerGroup);

    // Reusable Shared Unit Geometries & Materials
    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitBoxEdges = new THREE.EdgesGeometry(unitBoxGeo);
    const unitCylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    const unitBandGeo = new THREE.CylinderGeometry(0.54, 0.54, 1, 12);
    const sharedEdgeMat = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.68
    });
    const sharedRedEdgeMat = new THREE.LineBasicMaterial({
      color: 0xff5252,
      transparent: true,
      opacity: 0.92
    });
    const sharedBandMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    // 3D Calibration Weight Mesh (`Quả cân thử tải X kg`!)
    const payloadGroup = new THREE.Group();
    payloadGroup.visible = false;
    const weightBodyMesh = new THREE.Mesh(
      unitBoxGeo,
      new THREE.MeshLambertMaterial({ color: 0xf59e0b })
    );
    const weightEdges = new THREE.LineSegments(
      unitBoxEdges,
      new THREE.LineBasicMaterial({ color: 0xfef08a })
    );
    payloadGroup.add(weightBodyMesh, weightEdges);
    tableGroup.add(payloadGroup);

    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.42, 0.5, -0.24),
      new THREE.Vector3(0.22, 0.5, 0)
    ]);
    const liveLaserLine = new THREE.Line(
      laserGeo,
      new THREE.LineBasicMaterial({ color: 0xfde047 })
    );
    tableGroup.add(liveLaserLine);

    const comMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfde047 })
    );
    tableGroup.add(comMarker);

    const plumbGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.5, 0)
    ]);
    const plumbLine = new THREE.Line(
      plumbGeo,
      new THREE.LineBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.72 })
    );
    tableGroup.add(plumbLine);

    const STREAM_COUNT = 22;
    const windPositions = new Float32Array(STREAM_COUNT * 6);
    for (let i = 0; i < STREAM_COUNT; i++) {
      const x = -1.2 + Math.random() * 2.4;
      const y = 0.08 + Math.random() * 2.3;
      const z = -0.65 + Math.random() * 1.3;
      windPositions[i * 6] = x;
      windPositions[i * 6 + 1] = y;
      windPositions[i * 6 + 2] = z;
      windPositions[i * 6 + 3] = x + 0.22;
      windPositions[i * 6 + 4] = y;
      windPositions[i * 6 + 5] = z;
    }
    const windGeo = new THREE.BufferGeometry();
    windGeo.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
    const windLines = new THREE.LineSegments(
      windGeo,
      new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.35 })
    );
    scene.add(windLines);

    const materialPool = new Map<string, THREE.MeshLambertMaterial>();

    threeCtxRef.current = {
      scene,
      camera,
      renderer,
      controls,
      tableGroup,
      partsGroup,
      rulerGroup,
      payloadGroup,
      liveLaserLine,
      comMarker,
      plumbLine,
      supportRing,
      criticalStressRing,
      windLines,
      windPositions,
      unitBoxGeo,
      unitBoxEdges,
      unitCylGeo,
      unitBandGeo,
      sharedEdgeMat,
      sharedRedEdgeMat,
      sharedBandMat,
      materialPool,
      partMeshes: new Map(),
      partPrimaryMeshes: new Map(),
      guyWireLines: new Map()
    };

    // Raycast Tap-to-Poke
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downTime = 0;

    const onDomDown = (ev: PointerEvent) => {
      const m = mapClientCoords(ev.clientX, ev.clientY);
      downX = m.x;
      downY = m.y;
      downTime = performance.now();
    };
    const onDomUp = (ev: PointerEvent) => {
      const m = mapClientCoords(ev.clientX, ev.clientY);
      if (Math.hypot(m.x - downX, m.y - downY) > 7 || performance.now() - downTime > 300) return;
      const sim = physicsSimRef.current;
      if (!sim || liveAnimRef.current.visibleUpToCourse !== null) return;

      const rect = container.getBoundingClientRect();
      let localX = ev.clientX - rect.left;
      let localY = ev.clientY - rect.top;
      let width = rect.width;
      let height = rect.height;
      if (document.querySelector('.app-shell.synthetic-landscape')) {
        localX = ev.clientY - rect.top;
        localY = rect.right - ev.clientX;
        width = rect.height;
        height = rect.width;
      }
      if (width <= 0 || height <= 0) return;
      ndc.set((localX / width) * 2 - 1, -(localY / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      const hits = raycaster.intersectObjects(partsGroup.children, true);
      for (const hit of hits) {
        let cur: THREE.Object3D | null = hit.object;
        while (cur && cur.parent !== partsGroup) cur = cur.parent;
        const partId = cur?.userData?.partId as string | undefined;
        if (partId) {
          sim.pokePart(partId, raycaster.ray.direction.x, raycaster.ray.direction.z, 1.45);
          if (navigator.vibrate) navigator.vibrate(14);
          break;
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDomDown);
    renderer.domElement.addEventListener('pointerup', onDomUp);

    const onResize = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // 120Hz Render Loop (ZERO periodic React setState!)
    let rafId = 0;
    let lastMs = performance.now();
    let prevCollapsedFlag = false;
    let lastHeightTxt = '';

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const nowMs = performance.now();
      const dt = Math.min(0.034, Math.max(0.001, (nowMs - lastMs) * 0.001));
      lastMs = nowMs;

      const { sol, baseSol, env, visibleUpToCourse: visCourse, physicsPaused: isPaused } =
        liveAnimRef.current;
      const ctx = threeCtxRef.current;
      const sim = physicsSimRef.current;
      if (!ctx) return;

      // 1. Wind streamlines
      const wMat = windLines.material as THREE.LineBasicMaterial;
      if (env.windSpeedMps < 0.5 || visCourse !== null) {
        windLines.visible = false;
      } else {
        windLines.visible = true;
        wMat.opacity = Math.min(0.82, 0.14 + env.windSpeedMps * 0.032);
        const streakLen = 0.14 + env.windSpeedMps * 0.018;
        const stepX = (0.6 + env.windSpeedMps * 0.28) * dt;
        const posAttr = windLines.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < STREAM_COUNT; i++) {
          let x = windPositions[i * 6] + stepX;
          if (x > 1.25) x = -1.25;
          const y = windPositions[i * 6 + 1];
          const z = windPositions[i * 6 + 2];
          windPositions[i * 6] = x;
          windPositions[i * 6 + 3] = x + streakLen;
          windPositions[i * 6 + 4] = y;
          windPositions[i * 6 + 5] = z;
        }
        posAttr.needsUpdate = true;
      }

      // 2. Step Interpolated 120Hz Physics OR Static Layer Scrubber
      if (visCourse !== null) {
        tableGroup.position.set(0, 0, 0);
        tableGroup.quaternion.identity();
        payloadGroup.visible = false;
        for (const p of baseSol.parts) {
          const obj = ctx.partMeshes.get(p.id);
          if (!obj) continue;
          obj.visible = p.courseIndex <= visCourse;
          if (p.kind !== 'binder') {
            obj.position.set(p.x, p.y, p.z);
            obj.rotation.set(0, p.rotY, 0);
          }
        }
        liveLaserLine.visible = false;
      } else if (sim) {
        const crushIdx = sol.loadReport?.crushFailedCourseIndex ?? null;
        const tel = sim.step(dt, env, isPaused, crushIdx);

        tableGroup.position.set(tel.tablePosM.x, tel.tablePosM.y, tel.tablePosM.z);
        tableGroup.quaternion.set(
          tel.tableQuat.x,
          tel.tableQuat.y,
          tel.tableQuat.z,
          tel.tableQuat.w
        );

        for (let i = 0; i < sim.handles.length; i++) {
          const h = sim.handles[i];
          const obj = ctx.partMeshes.get(h.part.id);
          if (!obj) continue;
          obj.visible = true;
          obj.position.set(h.renderPosM.x, h.renderPosM.y, h.renderPosM.z);
          obj.quaternion.set(
            h.renderQuat.x,
            h.renderQuat.y,
            h.renderQuat.z,
            h.renderQuat.w
          );
        }

        // Sync 3D Calibration Weight on Top!
        if (tel.payloadVisual.visible) {
          const pv = tel.payloadVisual;
          payloadGroup.visible = true;
          payloadGroup.position.set(pv.x, pv.y, pv.z);
          payloadGroup.quaternion.set(pv.qx, pv.qy, pv.qz, pv.qw);
          payloadGroup.scale.set(pv.sizeM, pv.sizeM * 0.82, pv.sizeM);
        } else {
          payloadGroup.visible = false;
        }

        for (let g = 0; g < tel.guyWires.length; g++) {
          const gw = tel.guyWires[g];
          const line = ctx.guyWireLines.get(gw.id);
          if (!line) continue;
          line.visible = true;
          const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
          posAttr.setXYZ(0, gw.fromX, gw.fromY, gw.fromZ);
          posAttr.setXYZ(1, gw.toX, gw.toY, gw.toZ);
          posAttr.needsUpdate = true;
          (line.material as THREE.LineBasicMaterial).color.setHex(
            gw.tensionRatio > 0.35 ? 0xfbbf24 : 0xfde047
          );
        }

        comMarker.position.set(tel.comX, Math.max(0.02, tel.comY), tel.comZ);
        const plumbAttr = plumbLine.geometry.attributes.position as THREE.BufferAttribute;
        plumbAttr.setXYZ(0, tel.comX, 0.004, tel.comZ);
        plumbAttr.setXYZ(1, tel.comX, Math.max(0.02, tel.comY), tel.comZ);
        plumbAttr.needsUpdate = true;

        if (baseSol.totalHeightCm > 0) {
          liveLaserLine.visible = true;
          const topY = tel.liveTopHeightCm / 100;
          const laserAttr = liveLaserLine.geometry.attributes.position as THREE.BufferAttribute;
          laserAttr.setXYZ(0, -0.42, topY, -0.24);
          laserAttr.setXYZ(1, 0.22, topY, 0);
          laserAttr.needsUpdate = true;
        } else {
          liveLaserLine.visible = false;
        }

        if (liveHeightDomRef.current) {
          const nextTxt = `${tel.liveTopHeightCm.toFixed(1)} cm`;
          if (nextTxt !== lastHeightTxt) {
            lastHeightTxt = nextTxt;
            liveHeightDomRef.current.textContent = nextTxt;
          }
        }

        // ONLY update React state on actual edge transition (false <-> true) => ZERO lag!
        if (tel.collapsed !== prevCollapsedFlag) {
          prevCollapsedFlag = tel.collapsed;
          if (tel.collapsed && navigator.vibrate) {
            navigator.vibrate([40, 25, 85]);
          }
          setPhysCollapsed(tel.collapsed);
          setDislodgedParts(tel.dislodgedCount);
        }
      }

      controls.dampingFactor = Math.min(0.2, Math.max(0.03, 1 - Math.exp(-5.0 * dt)));
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      renderer.domElement.removeEventListener('pointerdown', onDomDown);
      renderer.domElement.removeEventListener('pointerup', onDomUp);
      ro.disconnect();
      controls.dispose();
      unitBoxGeo.dispose();
      unitBoxEdges.dispose();
      unitCylGeo.dispose();
      unitBandGeo.dispose();
      sharedEdgeMat.dispose();
      sharedRedEdgeMat.dispose();
      sharedBandMat.dispose();
      criticalStressRing.geometry.dispose();
      (criticalStressRing.material as THREE.Material).dispose();
      materialPool.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      threeCtxRef.current = null;
    };
  }, []);

  // 2. Spawn Fresh Cannon-ES World + Fast Shared-Geometry Scene Graph
  useEffect(() => {
    const ctx = threeCtxRef.current;
    if (!ctx) return;

    while (ctx.partsGroup.children.length > 0) {
      ctx.partsGroup.remove(ctx.partsGroup.children[ctx.partsGroup.children.length - 1]);
    }
    while (ctx.rulerGroup.children.length > 0) {
      const ch = ctx.rulerGroup.children.pop()!;
      ctx.rulerGroup.remove(ch);
      if ((ch as THREE.Line).geometry) (ch as THREE.Line).geometry.dispose();
      if ((ch as THREE.Line).material) ((ch as THREE.Line).material as THREE.Material).dispose();
    }
    ctx.guyWireLines.forEach((l) => {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    });
    ctx.partMeshes.clear();
    ctx.partPrimaryMeshes.clear();
    ctx.guyWireLines.clear();

    physicsSimRef.current = new BrickTowerPhysicsSim(baseSolution);
    setPhysCollapsed(false);
    setDislodgedParts(0);
    if (liveHeightDomRef.current) {
      liveHeightDomRef.current.textContent = `${baseSolution.totalHeightCm.toFixed(1)} cm`;
    }

    const getPooledMat = (key: string, color: string, transparent = false, opacity = 1) => {
      let mat = ctx.materialPool.get(key);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color, transparent, opacity });
        ctx.materialPool.set(key, mat);
      }
      return mat;
    };

    const createPartObject = (p: PlacedPart3D): THREE.Object3D => {
      if (p.kind === 'binder' && p.wireToX !== undefined && p.wireToZ !== undefined) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p.x, p.y, p.z),
          new THREE.Vector3(p.wireToX, 0, p.wireToZ)
        ]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: p.color }));
        line.userData = { partId: p.id, courseIndex: p.courseIndex };
        ctx.guyWireLines.set(p.id, line);
        return line;
      }

      const holder = new THREE.Group();
      holder.position.set(p.x, p.y, p.z);
      holder.rotation.y = p.rotY;
      holder.userData = { partId: p.id, courseIndex: p.courseIndex };

      const isTransparentBottle = p.kind === 'cylinder' && p.massKg < 0.1;
      const mat = getPooledMat(
        `col-${p.color}-${isTransparentBottle ? 't' : 'o'}`,
        p.color,
        isTransparentBottle,
        isTransparentBottle ? 0.62 : 0.96
      );

      if (p.kind === 'cylinder' || p.kind === 'rod') {
        const d = Math.max(0.014, p.sx * 0.98);
        const mesh = new THREE.Mesh(ctx.unitCylGeo, mat);
        mesh.scale.set(d, p.sy * 0.994, d);
        mesh.userData = { isTransparentBottle };
        holder.add(mesh);
        ctx.partPrimaryMeshes.set(p.id, {
          meshes: [mesh],
          edges: [],
          baseColor: p.color,
          courseIndex: p.courseIndex
        });

        if (p.tapedToBelow || p.lashedToCourseMin !== undefined) {
          const band = new THREE.Mesh(ctx.unitBandGeo, ctx.sharedBandMat);
          band.scale.set(d, 0.024, d);
          band.position.y = -p.sy * 0.36;
          holder.add(band);
        }
        return holder;
      }

      // Authentic 3D Backless Plastic Stool (`Ghế nhựa không dựa`: flat molded seat + 4 corner legs + cross braces!)
      if (p.kind === 'stool') {
        const sx = p.sx * 0.992;
        const sy = p.sy * 0.992;
        const sz = p.sz * 0.992;
        const meshes: THREE.Mesh[] = [];
        const edgeList: THREE.LineSegments[] = [];

        const addBoxSub = (
          bx: number,
          by: number,
          bz: number,
          px: number,
          py: number,
          pz: number
        ) => {
          const m = new THREE.Mesh(ctx.unitBoxGeo, mat);
          m.scale.set(bx, by, bz);
          m.position.set(px, py, pz);
          m.userData = { isTransparentBottle: false };
          holder.add(m);
          meshes.push(m);
          const e = new THREE.LineSegments(ctx.unitBoxEdges, ctx.sharedEdgeMat);
          e.scale.set(bx, by, bz);
          e.position.set(px, py, pz);
          holder.add(e);
          edgeList.push(e);
        };

        const seatH = sy * 0.1;
        addBoxSub(sx * 0.94, seatH, sz * 0.94, 0, sy * 0.5 - seatH * 0.5, 0);

        const legW = Math.max(0.022, Math.min(sx, sz) * 0.12);
        const legH = sy - seatH;
        const lx = sx * 0.5 - legW * 0.5;
        const lz = sz * 0.5 - legW * 0.5;
        const legY = -sy * 0.5 + legH * 0.5;
        addBoxSub(legW, legH, legW, -lx, legY, -lz);
        addBoxSub(legW, legH, legW, lx, legY, -lz);
        addBoxSub(legW, legH, legW, -lx, legY, lz);
        addBoxSub(legW, legH, legW, lx, legY, lz);

        // 4 horizontal leg braces at mid-height
        const rungH = Math.max(0.014, sy * 0.055);
        const rungY = -sy * 0.08;
        addBoxSub(sx - legW * 2, rungH, legW * 0.7, 0, rungY, -lz);
        addBoxSub(sx - legW * 2, rungH, legW * 0.7, 0, rungY, lz);
        addBoxSub(legW * 0.7, rungH, sz - legW * 2, -lx, rungY, 0);
        addBoxSub(legW * 0.7, rungH, sz - legW * 2, lx, rungY, 0);

        ctx.partPrimaryMeshes.set(p.id, {
          meshes,
          edges: edgeList,
          baseColor: p.color,
          courseIndex: p.courseIndex
        });
        return holder;
      }

      // Authentic 3D Inverted Plastic Basket (`Rổ nhựa úp ngược`: wide bottom rim + stepped perforated walls + flat top deck!)
      if (p.kind === 'basket') {
        const sx = p.sx * 0.992;
        const sy = p.sy * 0.992;
        const sz = p.sz * 0.992;
        const meshes: THREE.Mesh[] = [];
        const edgeList: THREE.LineSegments[] = [];

        const addTier = (bx: number, by: number, bz: number, py: number) => {
          const m = new THREE.Mesh(ctx.unitBoxGeo, mat);
          m.scale.set(bx, by, bz);
          m.position.set(0, py, 0);
          m.userData = { isTransparentBottle: false };
          holder.add(m);
          meshes.push(m);
          const e = new THREE.LineSegments(ctx.unitBoxEdges, ctx.sharedEdgeMat);
          e.scale.set(bx, by, bz);
          e.position.set(0, py, 0);
          holder.add(e);
          edgeList.push(e);
        };

        const rimH = sy * 0.16;
        const midH = sy * 0.68;
        const topH = sy * 0.16;
        addTier(sx, rimH, sz, -sy * 0.5 + rimH * 0.5);
        addTier(sx * 0.9, midH, sz * 0.9, -sy * 0.5 + rimH + midH * 0.5);
        addTier(sx * 0.82, topH, sz * 0.82, sy * 0.5 - topH * 0.5);

        ctx.partPrimaryMeshes.set(p.id, {
          meshes,
          edges: edgeList,
          baseColor: p.color,
          courseIndex: p.courseIndex
        });
        return holder;
      }

      const sx = p.sx * 0.992;
      const sy = p.sy * 0.992;
      const sz = p.sz * 0.992;
      const mesh = new THREE.Mesh(ctx.unitBoxGeo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.userData = { isTransparentBottle: false };
      holder.add(mesh);

      const edges = new THREE.LineSegments(ctx.unitBoxEdges, ctx.sharedEdgeMat);
      edges.scale.set(sx, sy, sz);
      holder.add(edges);

      ctx.partPrimaryMeshes.set(p.id, {
        meshes: [mesh],
        edges: [edges],
        baseColor: p.color,
        courseIndex: p.courseIndex
      });
      return holder;
    };

    for (const p of baseSolution.parts) {
      const obj = createPartObject(p);
      ctx.partsGroup.add(obj);
      ctx.partMeshes.set(p.id, obj);
    }

    const baseR = Math.max(0.04, baseSolution.baseSupportRadiusCm / 100);
    ctx.supportRing.geometry.dispose();
    const newRingGeo = new THREE.RingGeometry(baseR * 0.88, baseR * 1.04, 32);
    newRingGeo.rotateX(-Math.PI / 2);
    ctx.supportRing.geometry = newRingGeo;

    const totalM = Math.max(0.5, baseSolution.totalHeightCm / 100);
    const rulerTopM = Math.ceil((totalM + 0.25) * 2) / 2;
    const polePts = [new THREE.Vector3(-0.42, 0, -0.24), new THREE.Vector3(-0.42, rulerTopM, -0.24)];
    for (let h = 0.25; h <= rulerTopM + 0.001; h += 0.25) {
      const isHalfM = Math.abs((h * 100) % 50) < 1;
      polePts.push(
        new THREE.Vector3(-0.42, h, -0.24),
        new THREE.Vector3(-0.42 + (isHalfM ? 0.06 : 0.03), h, -0.24)
      );
    }
    const rulerGeo = new THREE.BufferGeometry().setFromPoints(polePts);
    ctx.rulerGroup.add(
      new THREE.LineSegments(rulerGeo, new THREE.LineBasicMaterial({ color: 0x64748b }))
    );

    const targetCenterY = Math.max(0.32, totalM * 0.46);
    ctx.controls.target.set(0, targetCenterY, 0);
  }, [baseSolution, replaySeq]);

  // 3. Update 3D Stress Heatmap Colors & Support Ring Reactively (Without Resetting Physics!)
  useEffect(() => {
    const ctx = threeCtxRef.current;
    if (!ctx) return;

    (ctx.supportRing.material as THREE.MeshBasicMaterial).color.setHex(
      physCollapsed || !liveSolution.standing
        ? 0xef4444
        : liveSolution.minSafetyFactor < 1.3
          ? 0xfbbf24
          : 0x34d399
    );

    const ensurePoolMat = (key: string, color: string, transparent: boolean) => {
      let m = ctx.materialPool.get(key);
      if (!m) {
        m = new THREE.MeshLambertMaterial({
          color,
          transparent,
          opacity: transparent ? 0.62 : 0.96
        });
        ctx.materialPool.set(key, m);
      }
      return m;
    };

    // Position & scale 3D Red Critical Load-Bearing Zone Ring at the highest-stress joint plane!
    const critIdx = liveSolution.loadReport.criticalCourseIndex;
    const critJc = liveSolution.jointChecks[critIdx];
    if (showStressHeatmap && critJc && baseSolution.courseCount > 0) {
      ctx.criticalStressRing.visible = true;
      ctx.criticalStressRing.position.y = Math.max(0.006, critJc.elevationM + 0.004);
      const rCrit = Math.max(0.06, critJc.effectiveRadiusM * 1.32);
      ctx.criticalStressRing.scale.setScalar(rCrit / 0.125);
    } else {
      ctx.criticalStressRing.visible = false;
    }

    if (showStressHeatmap) {
      const redArr = liveSolution.loadReport.courseRedIntensity ?? [];
      ctx.partPrimaryMeshes.forEach(({ meshes, edges, baseColor, courseIndex }) => {
        const redIntensity = redArr[courseIndex] ?? 0;
        const isTrans = Boolean(meshes[0]?.userData?.isTransparentBottle);
        const hmMat = ensurePoolMat(
          `red-c${courseIndex}-${baseColor}-${isTrans ? 't' : 'o'}`,
          baseColor,
          isTrans
        );
        hmMat.color.setHex(computeLoadBearingDisplayHex(baseColor, redIntensity));
        for (const m of meshes) m.material = hmMat;
        const edgeMat = redIntensity >= 68 ? ctx.sharedRedEdgeMat : ctx.sharedEdgeMat;
        for (const e of edges) e.material = edgeMat;
      });
    } else {
      ctx.partPrimaryMeshes.forEach(({ meshes, edges, baseColor }) => {
        const isTrans = Boolean(meshes[0]?.userData?.isTransparentBottle);
        const origMat = ensurePoolMat(`col-${baseColor}-${isTrans ? 't' : 'o'}`, baseColor, isTrans);
        for (const m of meshes) m.material = origMat;
        for (const e of edges) e.material = ctx.sharedEdgeMat;
      });
    }
  }, [
    showStressHeatmap,
    physCollapsed,
    liveSolution.standing,
    liveSolution.minSafetyFactor,
    liveSolution.loadReport,
    baseSolution
  ]);

  const isActuallyStanding = !physCollapsed && liveSolution.standing;
  const sfBadgeClass = physCollapsed
    ? 'is-bad'
    : !liveSolution.standing || liveSolution.minSafetyFactor < 1.35
      ? 'is-warn'
      : 'is-ok';

  const lr = liveSolution.loadReport;

  return (
    <div
      className="ar-fullscreen-overlay brick-lab-overlay"
      role="dialog"
      aria-label="Phòng Thí Nghiệm Xếp Tháp Gạch & Tính Toán Chịu Lực 3D"
    >
      {/* TOP TELEMETRY & STRATEGY BAR */}
      <header className="ar-fs-topbar brick-topbar">
        <div className="ar-fs-metrics">
          <span>
            CAO{' '}
            <strong ref={liveHeightDomRef} className="brick-gold-txt">
              {baseSolution.totalHeightCm.toFixed(1)} cm
            </strong>
          </span>
          <span>
            CHỊU TẢI ĐỈNH{' '}
            <strong style={{ color: '#34d399' }}>+{lr.maxSafeTopPayloadKg} kg</strong>
          </span>
          <span className="ar-hide-sm">
            CHỊU GIÓ <strong>Cấp {liveSolution.maxSurvivedBeaufort} • {liveSolution.maxSurvivedTiltDeg}°</strong>
          </span>
        </div>

        <div className={`brick-sf-pill ${sfBadgeClass}`}>
          {isAutoAdvancing
            ? `🔄 KIỂU #${safeCandIdx + 1} SẬP → ĐANG TỰ ĐỔI KIỂU #${safeCandIdx + 2}/${candidateLadder.length}...`
            : physCollapsed
              ? `🔴 KIỂU #${safeCandIdx + 1} ĐÃ SẬP (${dislodgedParts} vật rơi)`
              : rejectedCount > 0
                ? `🟢 ĐỨNG VỮNG • Kiểu #${safeCandIdx + 1}/${candidateLadder.length} (Loại ${rejectedCount} kiểu sập)`
                : isActuallyStanding
                  ? `🟢 ĐỨNG VỮNG • SF ${liveSolution.minSafetyFactor}× • Tải ${lr.peakUtilizationPct}%`
                  : `🟡 QUÁ TẢI (${lr.peakUtilizationPct}%) • SF ${liveSolution.minSafetyFactor}×`}
        </div>

        <div className="ar-fs-top-actions">
          <div className="brick-mode-pills">
            <button
              type="button"
              className={buildMode === 'optimal' ? 'active' : ''}
              onClick={() => setBuildMode('optimal')}
              title="Ưu tiên từng cm chiều cao tuyệt đối"
            >
              🏆 Cao Nhất
            </button>
            <button
              type="button"
              className={buildMode === 'max_solid' ? 'active-max-solid' : ''}
              onClick={() => setBuildMode('max_solid')}
              title="Đạt trần chiều cao tối đa đứng được + đắp toàn bộ gạch dư khóa cứng 4 mặt chân móng!"
            >
              💎 Cao &amp; Chắc Nhất
            </button>
              <button
                type="button"
                className={buildMode === 'fortress' ? 'active' : ''}
                onClick={() => setBuildMode('fortress')}
                title="Hạ thấp trọng tâm dạng lô cốt chịu tải & chống bão cực đại"
              >
                🛡️ Siêu Vững
              </button>
          </div>
          <button type="button" className="ar-close-btn" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>
      </header>

      {/* 3-COLUMN LANDSCAPE STUDIO */}
      <div className="brick-studio-body">
        {/* LEFT PANEL: INVENTORY */}
        <aside className="brick-left-panel">
          <div className="brick-sec-head">
            <strong>🎒 Vật Liệu Đang Có</strong>
            <button
              type="button"
              className="ota-mini-link"
              onClick={() => setShowCustomForm((v) => !v)}
            >
              {showCustomForm ? 'Đóng' : '➕ Món Lạ'}
            </button>
          </div>

          {showCustomForm && (
            <div className="brick-custom-box">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Tên vật dụng BTC phát..."
              />
              <div className="brick-custom-grid2">
                <select
                  value={customKind}
                  onChange={(e) => {
                    const nextKind = e.target.value as PropShapeKind;
                    setCustomKind(nextKind);
                    setCustomMass(
                      estimateItemMassKg(nextKind, customL, customW, customH, customMaterial)
                    );
                  }}
                >
                  <option value="block">🧱 Khối hộp (Xếp tầng)</option>
                  <option value="stool">🪑 Ghế nhựa không dựa (4 chân)</option>
                  <option value="basket">🧺 Rổ / Sọt nhựa (Úp ngược)</option>
                  <option value="cylinder">🥫 Hình trụ / Chai / Lon</option>
                  <option value="rod">🎋 Thanh dài / Gậy (Cắm ngọn)</option>
                  <option value="plate">🪵 Tấm phẳng (Khóa tầng)</option>
                  <option value="ballast">🪨 Vật nặng (Dằn móng)</option>
                  <option value="binder">🪢 Dây / Băng keo (Chằng buộc)</option>
                </select>
                <select
                  value={customMaterial}
                  onChange={(e) => {
                    const mat = e.target.value as typeof customMaterial;
                    setCustomMaterial(mat);
                    setCustomMass(estimateItemMassKg(customKind, customL, customW, customH, mat));
                  }}
                >
                  <option value="wood">Gỗ / Tre / Bìa</option>
                  <option value="brick">Gạch / Đất nung</option>
                  <option value="water">Đầy nước</option>
                  <option value="hollow_plastic">Nhựa rỗng nhẹ</option>
                  <option value="stone">Đá / Sắt nặng</option>
                </select>
              </div>
              <div className="brick-custom-dims">
                <label>
                  SL
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={customCount}
                    onChange={(e) => setCustomCount(Number(e.target.value))}
                  />
                </label>
                <label>
                  Dài(cm)
                  <input
                    type="number"
                    min={1}
                    value={customL}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCustomL(v);
                      setCustomMass(estimateItemMassKg(customKind, v, customW, customH, customMaterial));
                    }}
                  />
                </label>
                <label>
                  Rộng(cm)
                  <input
                    type="number"
                    min={1}
                    value={customW}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCustomW(v);
                      setCustomMass(estimateItemMassKg(customKind, customL, v, customH, customMaterial));
                    }}
                  />
                </label>
                <label>
                  Cao(cm)
                  <input
                    type="number"
                    min={1}
                    value={customH}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCustomH(v);
                      setCustomMass(estimateItemMassKg(customKind, customL, customW, v, customMaterial));
                    }}
                  />
                </label>
              </div>
              <div className="brick-custom-dims">
                <label style={{ gridColumn: 'span 2' }}>
                  Nặng mỗi món (kg)
                  <input
                    type="number"
                    step={0.05}
                    min={0.01}
                    value={customMass}
                    onChange={(e) => setCustomMass(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="primary-action-btn"
                  style={{ gridColumn: 'span 2', alignSelf: 'end' }}
                  onClick={handleAddCustomMysteryItem}
                >
                  ✅ Đưa vào tính 3D
                </button>
              </div>
            </div>
          )}

          <div className="brick-inv-list">
            {inventory.map((it) => (
              <div key={it.id} className="brick-inv-item">
                <div className="bii-info">
                  <span className="bii-dot" style={{ background: it.color }} />
                  <div>
                    <strong title={it.name}>{it.name}</strong>
                    <small>
                      {it.lengthCm}×{it.widthCm}×{it.heightCm}cm • {it.massKg}kg
                    </small>
                  </div>
                </div>
                <div className="bii-stepper">
                  <button type="button" onClick={() => handleChangeCount(it.id, -1)}>
                    −
                  </button>
                  <span>{it.count}</span>
                  <button type="button" onClick={() => handleChangeCount(it.id, 1)}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="brick-sec-head">
            <small>Thêm nhanh vật dụng hay gặp tại trạm:</small>
          </div>
          <div className="brick-preset-chips">
            <button type="button" onClick={() => handleQuickAddPreset(11)}>+ 🪑 Ghế nhựa</button>
            <button type="button" onClick={() => handleQuickAddPreset(12)}>+ 🧺 Rổ nhựa</button>
            <button type="button" onClick={() => handleQuickAddPreset(1)}>+ Gạch thẻ</button>
            <button type="button" onClick={() => handleQuickAddPreset(3)}>+ Chai rỗng</button>
            <button type="button" onClick={() => handleQuickAddPreset(6)}>+ Gậy tre 1.2m</button>
            <button type="button" onClick={() => handleQuickAddPreset(7)}>+ Tấm bìa</button>
            <button type="button" onClick={() => handleQuickAddPreset(8)}>+ Đá dằn</button>
            <button type="button" onClick={() => handleQuickAddPreset(9)}>+ Dây dù 3m</button>
            <button type="button" onClick={() => handleQuickAddPreset(10)}>+ Băng keo</button>
          </div>
        </aside>

        {/* CENTER 3D RIGID-BODY PHYSICS VIEWPORT */}
        <main className="brick-center-stage">
          <div ref={stageRef} className="brick-webgl-host" />

          <div className="brick-sim-hud">
            {candidateLadder.length > 1 && (
              <div className="hud-cand-stepper" title="Duyệt qua các phương án xếp khác nhau">
                <button
                  type="button"
                  disabled={safeCandIdx === 0}
                  onClick={() => {
                    setVisibleUpToCourse(null);
                    setPhysicsPaused(false);
                    setCandidateIdx((i) => Math.max(0, i - 1));
                  }}
                >
                  ◀
                </button>
                <span>
                  Kiểu #{safeCandIdx + 1}/{candidateLadder.length}
                </span>
                <button
                  type="button"
                  disabled={!canAdvanceCandidate}
                  onClick={() => {
                    setVisibleUpToCourse(null);
                    setPhysicsPaused(false);
                    setCandidateIdx((i) => Math.min(candidateLadder.length - 1, i + 1));
                  }}
                >
                  ▶
                </button>
              </div>
            )}

            {buildMode !== 'naive' && (
              <button
                type="button"
                className={autoSwitchOnCollapse ? 'is-active-auto' : ''}
                onClick={() => setAutoSwitchOnCollapse((v) => !v)}
              >
                {autoSwitchOnCollapse ? '✅ Tự đổi khi sập' : '⏸️ Giữ khi sập'}
              </button>
            )}

            <button
              type="button"
              className={showStressHeatmap ? 'is-heatmap-on' : ''}
              onClick={() => setShowStressHeatmap((v) => !v)}
              title="Hiện đỏ các tầng/vùng đang gánh lực nén & mô-men lật căng nhất trên tháp 3D"
            >
              {showStressHeatmap ? '🔴 Vùng chịu lực: BẬT' : '⚪ Vùng chịu lực'}
            </button>

            <button
              type="button"
              onClick={() => {
                setVisibleUpToCourse(null);
                setPhysicsPaused(false);
                setReplaySeq((s) => s + 1);
              }}
            >
              🔄 Dựng lại
            </button>
            <button
              type="button"
              onClick={handlePokeCrown}
              title="Tác động xung lực đẩy ngang vào ngọn tháp"
            >
              💥 Đẩy thử
            </button>
          </div>

          {/* Real Rigid-Body Collapse / Auto-Trying Next Candidate Banner */}
          {physCollapsed && visibleUpToCourse === null && (
            <div
              className={`brick-collapse-banner ${isAutoAdvancing ? 'is-searching' : ''}`}
              style={{ top: 44 }}
            >
              {isAutoAdvancing ? (
                <>
                  <div>
                    <strong>
                      🔄 Kiểu #{safeCandIdx + 1} ({baseSolution.totalHeightCm}cm) bị sập — Đang tự thử Kiểu #{safeCandIdx + 2}/{candidateLadder.length} ({candidateLadder[safeCandIdx + 1].totalHeightCm}cm • vững hơn)...
                    </strong>
                    <small>
                      Tự động loại bỏ phương án quá tải / sập và chuyển sang kết cấu chịu lực cao hơn!
                    </small>
                  </div>
                  <div className="bcb-actions">
                    <button
                      type="button"
                      className="secondary-action-btn"
                      onClick={() => setAutoSwitchOnCollapse(false)}
                    >
                      ⏹️ Dừng xem cảnh sập
                    </button>
                    <button
                      type="button"
                      className="primary-action-btn"
                      onClick={() => {
                        setRejectedCount((c) => c + 1);
                        setCandidateIdx((i) => Math.min(candidateLadder.length - 1, i + 1));
                      }}
                    >
                      ⏭️ Đổi ngay Kiểu #{safeCandIdx + 2}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <strong>
                      💥 KIỂU #{safeCandIdx + 1} ĐÃ ĐỔ SẬP ({dislodgedParts} vật rời vị trí)!
                    </strong>
                    <small>
                      {liveSolution.failReason ??
                        'Lực đè đỉnh, sức gió hoặc độ nghiêng đã vượt quá giới hạn chịu lực của tháp.'}
                    </small>
                  </div>
                  <div className="bcb-actions">
                    <button
                      type="button"
                      className="secondary-action-btn"
                      onClick={() => setReplaySeq((s) => s + 1)}
                    >
                      🔄 Dựng lại kiểu này
                    </button>
                    <button
                      type="button"
                      className="primary-action-btn"
                      onClick={() => handleOptimizeForCurrentLoad()}
                    >
                      {canAdvanceCandidate
                        ? `✨ Thử ngay Kiểu #${safeCandIdx + 2} vững hơn`
                        : '✨ Tự xếp lại chống đổ'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Bottom Layer-by-Layer Scrubber */}
          {baseSolution.courseCount > 0 && (
            <div className="brick-layer-scrubber">
              <button
                type="button"
                onClick={() =>
                  setVisibleUpToCourse((prev) =>
                    prev === null ? Math.max(0, baseSolution.courseCount - 2) : Math.max(0, prev - 1)
                  )
                }
              >
                ◀
              </button>
              <div className="bls-mid">
                <span>
                  👁️ Xem từng tầng:{' '}
                  <b>
                    {visibleUpToCourse === null
                      ? `Tất cả (${baseSolution.courseCount} tầng • Mượt 120Hz)`
                      : `Tầng ${visibleUpToCourse + 1} / ${baseSolution.courseCount} (Bản vẽ tĩnh)`}
                  </b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={baseSolution.courseCount}
                  value={visibleUpToCourse === null ? baseSolution.courseCount : visibleUpToCourse}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setVisibleUpToCourse(val >= baseSolution.courseCount ? null : val);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setVisibleUpToCourse((prev) => {
                    if (prev === null) return null;
                    return prev + 1 >= baseSolution.courseCount ? null : prev + 1;
                  })
                }
              >
                ▶
              </button>
            </div>
          )}
        </main>

        {/* RIGHT PANEL: 3 TABS -> WIND & SHAKE | LOAD-BEARING ANALYSIS | BUILD STEPS */}
        <aside className="brick-right-panel">
          <div className="subtab-strip">
            <button
              type="button"
              className={rightTab === 'stress' ? 'active' : ''}
              onClick={() => setRightTab('stress')}
            >
              💨 Gió &amp; Rung
            </button>
            <button
              type="button"
              className={rightTab === 'load' ? 'active' : ''}
              onClick={() => setRightTab('load')}
            >
              ⚖️ Chịu Lực
            </button>
            <button
              type="button"
              className={rightTab === 'steps' ? 'active' : ''}
              onClick={() => setRightTab('steps')}
            >
              📋 Cách Xếp ({baseSolution.steps.length})
            </button>
          </div>

          {rightTab === 'stress' && (
            <div className="brick-stress-stack">
              <div className="brick-ctrl-card">
                <div className="bcc-head">
                  <strong>💨 Sức Gió: {BEAUFORT_TABLE[testBeaufort]?.name}</strong>
                  <span>{BEAUFORT_TABLE[testBeaufort]?.windMps} m/s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={9}
                  step={1}
                  value={testBeaufort}
                  onChange={(e) => setTestBeaufort(Number(e.target.value))}
                />
                <small className="bcc-sub">{BEAUFORT_TABLE[testBeaufort]?.desc}</small>
                <div className="brick-quick-row">
                  {[0, 3, 5, 7].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={testBeaufort === lvl ? 'active' : ''}
                      onClick={() => setTestBeaufort(lvl)}
                    >
                      Cấp {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="brick-ctrl-card">
                <div className="bcc-head">
                  <strong>🫨 Nghiêng Nền &amp; Lung Lay</strong>
                  <span>{effectiveTiltDeg.toFixed(1)}° • Rung {testShakePct}%</span>
                </div>
                <label className="bcc-lbl">
                  Độ dốc / nghiêng mặt đất ({effectiveTiltDeg.toFixed(1)}°)
                  <input
                    type="range"
                    min={0}
                    max={15}
                    step={0.5}
                    disabled={usePhoneTiltTest && useRealSensor}
                    value={effectiveTiltDeg}
                    onChange={(e) => setTestTiltDeg(Number(e.target.value))}
                  />
                </label>
                <label className="bcc-lbl">
                  Rung lắc bàn / chạm tay ({testShakePct}%)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={testShakePct}
                    onChange={(e) => setTestShakePct(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className={`secondary-action-btn full-w ${usePhoneTiltTest ? 'active-pill-btn' : ''}`}
                  onClick={() => {
                    const next = !usePhoneTiltTest;
                    setUsePhoneTiltTest(next);
                    if (next && !useRealSensor && onToggleRealSensor) {
                      onToggleRealSensor(true);
                    }
                  }}
                >
                  {usePhoneTiltTest
                    ? '📱 Đang lắc theo cảm biến điện thoại thật!'
                    : '📱 Thử nghiêng/lắc bằng điện thoại thật'}
                </button>
              </div>

              <button
                type="button"
                className="brick-maxsolid-btn"
                onClick={() => handleOptimizeForCurrentLoad('max_solid')}
              >
                💎 Cao Nhất Nhưng Chắc Nhất Ở Chiều Cao Đó
              </button>

              <button
                type="button"
                className="secondary-action-btn full-w"
                onClick={() => handleOptimizeForCurrentLoad()}
              >
                ✨ Tính Lại Theo Gió Cấp {testBeaufort} &amp; Dốc {effectiveTiltDeg.toFixed(1)}°
              </button>

              <label className="mission-check-row">
                <input
                  type="checkbox"
                  checked={autoAdaptLive}
                  onChange={(e) => setAutoAdaptLive(e.target.checked)}
                />
                <span>Tự động đổi cách xếp ngay khi kéo thanh Gió / Rung</span>
              </label>

              {baseSolution.unusedSummary.length > 0 && (
                <div className="brick-unused-note">
                  💡 <b>Vật lý thực khuyên để ngoài:</b> {baseSolution.unusedSummary.join(', ')} (đặt thêm lên ở mức gió/rung này sẽ mất ổn định).
                </div>
              )}
            </div>
          )}

          {rightTab === 'load' && (
            <div className="brick-stress-stack">
              {/* 3D TOP PAYLOAD CALIBRATION WEIGHT TESTER */}
              <div className="brick-ctrl-card">
                <div className="bcc-head">
                  <strong>🏋️ Đặt Tải Thử Lên Đỉnh 3D</strong>
                  <span>{testTopPayloadKg.toFixed(1)} kg</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={25}
                  step={0.5}
                  value={testTopPayloadKg}
                  onChange={(e) => setTestTopPayloadKg(Number(e.target.value))}
                />
                <small className="bcc-sub">
                  Thả quả cân thật lên đỉnh tháp 3D để kiểm tra lật, bẹp chai rỗng, võng tấm bìa hoặc gãy uốn gậy!
                </small>
                <div className="brick-quick-row">
                  {[0, 2, 5, 12].map((kg) => (
                    <button
                      key={kg}
                      type="button"
                      className={testTopPayloadKg === kg ? 'active' : ''}
                      onClick={() => setTestTopPayloadKg(kg)}
                    >
                      {kg === 0 ? 'Bỏ tải' : `+${kg}kg`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4-METRIC ENGINEERING LOAD-BEARING DASHBOARD */}
              <div className="brick-load-grid">
                <div className="brick-load-stat">
                  <small>Chịu tải đỉnh tối đa</small>
                  <strong className="is-emerald">+{lr.maxSafeTopPayloadKg} kg</strong>
                </div>
                <div className="brick-load-stat">
                  <small>Tổng lực đè xuống móng</small>
                  <strong>
                    {lr.baseTotalWeightKg} kg ({Math.round(lr.baseAxialForceN)} N)
                  </strong>
                </div>
                <div className="brick-load-stat">
                  <small>Áp suất nén nền đất</small>
                  <strong className={lr.groundPressureKgCm2 > 0.75 ? 'is-amber' : ''}>
                    {lr.groundPressureKgCm2} kg/cm²
                  </strong>
                </div>
                <div className="brick-load-stat">
                  <small>Mức mang tải cực đại</small>
                  <strong className={lr.peakUtilizationPct > 75 ? 'is-amber' : 'is-emerald'}>
                    {lr.peakUtilizationPct}%
                  </strong>
                </div>
              </div>

              <div className="brick-limit-box">
                <div>
                  🔍 <b>Điểm tới hạn chịu lực:</b> {lr.limitingComponent}.
                </div>
                <div style={{ marginTop: 4, color: '#cbd5e1' }}>
                  🌱 <b>Nền đất rừng ({lr.baseContactAreaCm2} cm²):</b> {lr.groundVerdict}.
                </div>
              </div>

              <button
                type="button"
                className="secondary-action-btn full-w"
                onClick={() => setShowStressHeatmap((v) => !v)}
              >
                {showStressHeatmap
                  ? '🎨 Tắt màu nhiệt ứng suất trên tháp 3D'
                  : '🔥 Bật màu nhiệt ứng suất chịu lực 3D'}
              </button>

              {/* PER-COURSE AXIAL FORCE & STRESS BREAKDOWN */}
              <div className="brick-sec-head">
                <small>Phân bố lực đè &amp; mức tải từng tầng (từ chân lên ngọn):</small>
              </div>
              <div className="brick-layer-load-list">
                {liveSolution.jointChecks.map((jc) => {
                  const util = jc.utilizationPct ?? 0;
                  const barColor =
                    util < 38 ? '#10b981' : util < 68 ? '#f59e0b' : '#ef4444';
                  return (
                    <div key={jc.courseIndex} className="brick-layer-load-row">
                      <div className="bllr-head">
                        <strong>Tầng {jc.courseIndex + 1}</strong>
                        <span>
                          Đè {jc.axialLoadKg ?? jc.massAboveKg}kg • {jc.contactStressKgCm2 ?? 0}kg/cm² • SF {jc.safetyFactor}×
                        </span>
                      </div>
                      <div className="bllr-bar-track">
                        <div
                          className="bllr-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.max(4, util))}%`,
                            background: barColor
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rightTab === 'steps' && (
            <div className="brick-steps-list">
              {baseSolution.steps.map((st) => (
                <button
                  key={st.stepNumber}
                  type="button"
                  className="brick-step-card"
                  onClick={() => setVisibleUpToCourse(st.courseRange[1])}
                >
                  <div className="bsc-top">
                    <strong>
                      Bước {st.stepNumber}: {st.title}
                    </strong>
                    <span>→ {st.heightReachedCm}cm</span>
                  </div>
                  <p>{st.detail}</p>
                </button>
              ))}
              {visibleUpToCourse !== null && (
                <button
                  type="button"
                  className="secondary-action-btn full-w"
                  onClick={() => setVisibleUpToCourse(null)}
                >
                  👁️ Hiện lại toàn bộ tháp &amp; chạy vật lý thật
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

// Block 60Hz parent sensor micro-noise from re-rendering the 3D studio!
export const BrickTower3DModal = React.memo(BrickTower3DModalInner, (prev, next) => {
  if (prev.onClose !== next.onClose || prev.useRealSensor !== next.useRealSensor) {
    return false;
  }
  if (!next.useRealSensor) {
    return true;
  }
  const pDiff = Math.abs((prev.pitchDeg ?? 0) - (next.pitchDeg ?? 0));
  const rDiff = Math.abs((prev.rollDeg ?? 0) - (next.rollDeg ?? 0));
  return pDiff < 0.45 && rDiff < 0.45;
});
