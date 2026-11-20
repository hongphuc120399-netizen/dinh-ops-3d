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
import { BrickTowerPhysicsSim, PHYS_SCALE } from '../utils/brickPhysicsWorld';

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

export interface BrickTower3DModalProps {
  pitchDeg?: number;
  rollDeg?: number;
  useRealSensor?: boolean;
  onToggleRealSensor?: (enable: boolean) => void;
  onClose: () => void;
}

type RightPanelTab = 'stress' | 'steps';

export const BrickTower3DModal: React.FC<BrickTower3DModalProps> = React.memo(
  ({ pitchDeg = 0, rollDeg = 0, useRealSensor = false, onToggleRealSensor, onClose }) => {
    const [inventory, setInventory] = useState<TowerInventoryItem[]>(() => loadSavedInventory());
    const [buildMode, setBuildMode] = useState<TowerBuildMode>('optimal');

    // Design target load (used when Auto-Optimizing the blueprint)
    const [designEnv, setDesignEnv] = useState<EnvironmentLoadConfig>({
      beaufortLevel: 3,
      windSpeedMps: BEAUFORT_TABLE[3].windMps,
      tiltDeg: 2.0,
      shakeG: 0.035
    });

    // Live interactive test load (sliders act directly on the live 3D cannon-es rigid-body world!)
    const [testBeaufort, setTestBeaufort] = useState<number>(3);
    const [testTiltDeg, setTestTiltDeg] = useState<number>(2.0);
    const [testShakePct, setTestShakePct] = useState<number>(12); // 0..100% -> 0..0.28g
    const [usePhoneTiltTest, setUsePhoneTiltTest] = useState<boolean>(false);
    const [autoAdaptLive, setAutoAdaptLive] = useState<boolean>(false);
    const [physicsPaused, setPhysicsPaused] = useState<boolean>(false);

    // Real-time rigid-body collapse status reported by cannon-es
    const [physCollapsed, setPhysCollapsed] = useState<boolean>(false);
    const [dislodgedParts, setDislodgedParts] = useState<number>(0);

    // Self-evolving candidate ladder: if #1 collapses in real 3D physics, automatically try #2, #3... until standing!
    const [candidateIdx, setCandidateIdx] = useState<number>(0);
    const [rejectedCount, setRejectedCount] = useState<number>(0);
    const [autoSwitchOnCollapse, setAutoSwitchOnCollapse] = useState<boolean>(true);

    // Layer-by-layer build scrubber (null = show all layers + run live 3D physics)
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

    // Effective live test load (combines sliders OR live phone accelerometer tilt!)
    const effectiveTiltDeg = useMemo(() => {
      if (usePhoneTiltTest && useRealSensor) {
        return Math.min(18, Number(Math.hypot(pitchDeg, rollDeg).toFixed(1)));
      }
      return testTiltDeg;
    }, [usePhoneTiltTest, useRealSensor, pitchDeg, rollDeg, testTiltDeg]);

    const liveEnv = useMemo<EnvironmentLoadConfig>(
      () => ({
        beaufortLevel: testBeaufort,
        windSpeedMps: BEAUFORT_TABLE[testBeaufort]?.windMps ?? 0,
        tiltDeg: effectiveTiltDeg,
        shakeG: Number(((testShakePct / 100) * 0.28).toFixed(3))
      }),
      [testBeaufort, effectiveTiltDeg, testShakePct]
    );

    const activeDesignEnv = autoAdaptLive ? liveEnv : designEnv;
    const candidateLadder = useMemo<TowerSolution[]>(
      () => solveRankedBrickTowers(inventory, activeDesignEnv, buildMode, 12),
      [inventory, activeDesignEnv, buildMode]
    );

    // Reset ladder cursor whenever inventory, designEnv, or mode generates a fresh ladder
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

    // Live Self-Evolving Physics Loop:
    // Whenever a tower genuinely collapses in 3D cannon-es simulation, wait 850ms so the user sees why it fell,
    // then AUTOMATICALLY switch to the next sturdier architecture in `candidateLadder`!
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
      }, 880);
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

    const handleOptimizeForCurrentLoad = () => {
      const sameEnv =
        designEnv.beaufortLevel === liveEnv.beaufortLevel &&
        Math.abs(designEnv.tiltDeg - liveEnv.tiltDeg) < 0.05 &&
        Math.abs(designEnv.shakeG - liveEnv.shakeG) < 0.002;

      setPhysicsPaused(false);
      setVisibleUpToCourse(null);
      setAutoSwitchOnCollapse(true);

      if (buildMode === 'naive') {
        setBuildMode('optimal');
        setDesignEnv(liveEnv);
      } else if (!sameEnv) {
        setDesignEnv(liveEnv);
      } else if (safeCandIdx + 1 < candidateLadder.length) {
        // Already calibrated for this load — advance immediately to the next sturdier architecture!
        setRejectedCount((c) => c + 1);
        setCandidateIdx(safeCandIdx + 1);
      } else {
        // Reached bottom of optimal ladder -> switch to Fortress mode for maximum stability
        setBuildMode('fortress');
        setDesignEnv(liveEnv);
      }
      setReplaySeq((s) => s + 1);
      if (navigator.vibrate) navigator.vibrate(22);
    };

    // =========================================================================
    // THREE.JS + CANNON-ES 120Hz REAL RIGID-BODY PHYSICS STUDIO
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
      liveLaserLine: THREE.Line;
      comMarker: THREE.Mesh;
      plumbLine: THREE.Line;
      supportRing: THREE.Mesh;
      windLines: THREE.LineSegments;
      windPositions: Float32Array;
      partMeshes: Map<string, THREE.Object3D>;
      guyWireLines: Map<string, THREE.Line>;
    } | null>(null);

    const handlePokeCrown = useCallback(() => {
      const sim = physicsSimRef.current;
      if (!sim || sim.handles.length === 0) return;
      // Find highest currently standing dynamic part
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

    // 1. Initialize Three.js Scene + Interactive Raycast Finger-Poke + 120Hz Physics Loop
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileCoarse ? 1.5 : 2));
      renderer.setSize(container.clientWidth || 640, container.clientHeight || 360);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera);
      controls.domElement = renderer.domElement;

      // Support Pure-OTA Synthetic Landscape (+90deg CSS rotation) seamlessly!
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

      // Crisp studio lighting
      scene.add(new THREE.AmbientLight(0xdbeafe, 1.15));
      const keyLight = new THREE.DirectionalLight(0xfff3db, 1.45);
      keyLight.position.set(2.5, 4.2, 2.8);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
      rimLight.position.set(-2.5, 2.0, -2.2);
      scene.add(rimLight);

      // Subtle floor grid below the test table so tumbled bricks have visual ground context
      const catchFloorMesh = new THREE.Mesh(
        new THREE.CircleGeometry(1.8, 36),
        new THREE.MeshBasicMaterial({ color: 0x09111e, transparent: true, opacity: 0.7 })
      );
      catchFloorMesh.rotation.x = -Math.PI / 2;
      catchFloorMesh.position.y = -0.32;
      scene.add(catchFloorMesh);

      // Shake / Tilt Test Platform Table (exact match with cannon-es D'Alembert table frame!)
      const tableGroup = new THREE.Group();
      scene.add(tableGroup);

      const padGeo = new THREE.BoxGeometry(1.24, 0.08, 1.24);
      padGeo.translate(0, -0.04, 0);
      const padMat = new THREE.MeshLambertMaterial({ color: 0x162030 });
      const padMesh = new THREE.Mesh(padGeo, padMat);
      tableGroup.add(padMesh);
      tableGroup.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(padGeo),
          new THREE.LineBasicMaterial({ color: 0x334155 })
        )
      );

      const grid = new THREE.GridHelper(1.2, 12, 0x334155, 0x1e293b);
      grid.position.y = 0.001;
      tableGroup.add(grid);

      const ringGeo = new THREE.RingGeometry(0.085, 0.1, 36);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const supportRing = new THREE.Mesh(ringGeo, ringMat);
      supportRing.position.y = 0.003;
      tableGroup.add(supportRing);

      const partsGroup = new THREE.Group();
      const rulerGroup = new THREE.Group();
      tableGroup.add(partsGroup, rulerGroup);

      // Live Height Gold Laser Bar (tracks actual standing physics height at 120Hz!)
      const laserGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.42, 0.5, -0.24),
        new THREE.Vector3(0.22, 0.5, 0)
      ]);
      const liveLaserLine = new THREE.Line(
        laserGeo,
        new THREE.LineBasicMaterial({ color: 0xfde047 })
      );
      tableGroup.add(liveLaserLine);

      // Live 3D Center of Mass sphere + vertical plumb line
      const comGeo = new THREE.SphereGeometry(0.02, 14, 14);
      const comMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
      const comMarker = new THREE.Mesh(comGeo, comMat);
      tableGroup.add(comMarker);

      const plumbGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.5, 0)
      ]);
      const plumbMat = new THREE.LineBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.72
      });
      const plumbLine = new THREE.Line(plumbGeo, plumbMat);
      tableGroup.add(plumbLine);

      // Animated 3D Wind Streamlines (+X direction)
      const STREAM_COUNT = 26;
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
      const windMat = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.35
      });
      const windLines = new THREE.LineSegments(windGeo, windMat);
      scene.add(windLines);

      threeCtxRef.current = {
        scene,
        camera,
        renderer,
        controls,
        tableGroup,
        partsGroup,
        rulerGroup,
        liveLaserLine,
        comMarker,
        plumbLine,
        supportRing,
        windLines,
        windPositions,
        partMeshes: new Map(),
        guyWireLines: new Map()
      };

      // Interactive Raycast Tap-to-Poke ("Chạm vào viên gạch bất kỳ để đẩy thử vật lý thật!")
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
            // Flash hit brick briefly
            const primaryMesh = cur?.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
            if (primaryMesh && primaryMesh.material) {
              const mat = primaryMesh.material as THREE.MeshLambertMaterial;
              const origHex = mat.color.getHex();
              mat.color.setHex(0xfbbf24);
              setTimeout(() => {
                mat.color.setHex(origHex);
              }, 160);
            }
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

      // 120Hz Real Rigid-Body Physics & Wind-Tunnel Render Loop
      let rafId = 0;
      let lastMs = performance.now();
      let lastUiSyncMs = 0;
      let prevCollapsedFlag = false;
      let vibratedOnCollapse = false;

      const animate = () => {
        rafId = requestAnimationFrame(animate);
        const nowMs = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastMs) * 0.001));
        lastMs = nowMs;

        const { baseSol, env, visibleUpToCourse: visCourse, physicsPaused: isPaused } = liveAnimRef.current;
        const ctx = threeCtxRef.current;
        const sim = physicsSimRef.current;
        if (!ctx) return;

        // 1. Animate 3D wind streamlines proportional to windSpeedMps
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

        // 2. Step Real 3D Rigid-Body Physics (cannon-es) OR Static Blueprint Layer Scrubber
        if (visCourse !== null) {
          // Layer-by-layer build inspection mode: show crisp static blueprint up to `visCourse`
          tableGroup.position.set(0, 0, 0);
          tableGroup.quaternion.identity();
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
          const tel = sim.step(dt, env, isPaused);

          // Sync table tilt & harmonic shake
          tableGroup.position.set(tel.tablePosM.x, tel.tablePosM.y, tel.tablePosM.z);
          tableGroup.quaternion.set(
            tel.tableQuat.x,
            tel.tableQuat.y,
            tel.tableQuat.z,
            tel.tableQuat.w
          );

          // Sync every rigid body's true 3D position & quaternion at 120Hz!
          for (const h of sim.handles) {
            const obj = ctx.partMeshes.get(h.part.id);
            if (!obj) continue;
            obj.visible = true;
            obj.position.set(
              h.body.position.x / PHYS_SCALE,
              h.body.position.y / PHYS_SCALE,
              h.body.position.z / PHYS_SCALE
            );
            obj.quaternion.set(
              h.body.quaternion.x,
              h.body.quaternion.y,
              h.body.quaternion.z,
              h.body.quaternion.w
            );
          }

          // Sync live 3D Guy-Wire tension cables
          for (const gw of tel.guyWires) {
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

          // Sync live Center of Mass + Plumb Line + Gold Height Laser Bar
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

          // Zero-overhead 120Hz DOM readout for live height
          if (liveHeightDomRef.current) {
            liveHeightDomRef.current.textContent = `${tel.liveTopHeightCm.toFixed(1)} cm`;
          }

          if (tel.collapsed && !vibratedOnCollapse) {
            vibratedOnCollapse = true;
            if (navigator.vibrate) navigator.vibrate([40, 25, 85]);
          } else if (!tel.collapsed) {
            vibratedOnCollapse = false;
          }

          if (tel.collapsed !== prevCollapsedFlag || nowMs - lastUiSyncMs > 260) {
            prevCollapsedFlag = tel.collapsed;
            lastUiSyncMs = nowMs;
            setPhysCollapsed(tel.collapsed);
            setDislodgedParts((prev) => (prev === tel.dislodgedCount ? prev : tel.dislodgedCount));
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
        renderer.dispose();
        if (renderer.domElement.parentElement === container) {
          container.removeChild(renderer.domElement);
        }
        threeCtxRef.current = null;
      };
    }, []);

    // 2. Spawn Fresh Cannon-ES 3D Rigid-Body World + Matching Non-Overlapping Meshes
    useEffect(() => {
      const ctx = threeCtxRef.current;
      if (!ctx) return;

      const disposeGroup = (grp: THREE.Group) => {
        while (grp.children.length > 0) {
          const ch = grp.children.pop()!;
          grp.remove(ch);
          ch.traverse((node) => {
            const m = node as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
              if (Array.isArray(m.material)) m.material.forEach((mt) => mt.dispose());
              else m.material.dispose();
            }
          });
        }
      };

      disposeGroup(ctx.partsGroup);
      disposeGroup(ctx.rulerGroup);
      ctx.partMeshes.clear();
      ctx.guyWireLines.clear();

      // Spawn fresh real rigid-body world!
      physicsSimRef.current = new BrickTowerPhysicsSim(baseSolution);
      setPhysCollapsed(false);
      setDislodgedParts(0);
      if (liveHeightDomRef.current) {
        liveHeightDomRef.current.textContent = `${baseSolution.totalHeightCm.toFixed(1)} cm`;
      }

      const edgeMatShared = new THREE.LineBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.7
      });

      const createPartObject = (p: PlacedPart3D): THREE.Object3D => {
        if (p.kind === 'binder' && p.wireToX !== undefined && p.wireToZ !== undefined) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p.x, p.y, p.z),
            new THREE.Vector3(p.wireToX, 0, p.wireToZ)
          ]);
          const mat = new THREE.LineBasicMaterial({ color: p.color });
          const line = new THREE.Line(geo, mat);
          line.userData = { partId: p.id, courseIndex: p.courseIndex };
          ctx.guyWireLines.set(p.id, line);
          return line;
        }

        const holder = new THREE.Group();
        holder.position.set(p.x, p.y, p.z);
        holder.rotation.y = p.rotY;
        holder.userData = { partId: p.id, courseIndex: p.courseIndex };

        if (p.kind === 'cylinder' || p.kind === 'rod') {
          const r = Math.max(0.007, p.sx * 0.5);
          const geo = new THREE.CylinderGeometry(r * 0.98, r * 0.98, p.sy * 0.994, p.kind === 'rod' ? 12 : 18);
          const isTransparentBottle = p.kind === 'cylinder' && p.massKg < 0.1;
          const mat = new THREE.MeshLambertMaterial({
            color: p.color,
            transparent: isTransparentBottle,
            opacity: isTransparentBottle ? 0.62 : 0.96
          });
          holder.add(new THREE.Mesh(geo, mat));

          // Visual tape band if taped to below or side-lashed!
          if (p.tapedToBelow || p.lashedToCourseMin !== undefined) {
            const bandGeo = new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.024, 14);
            bandGeo.translate(0, -p.sy * 0.36, 0);
            holder.add(
              new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: 0xfef08a }))
            );
          }
          return holder;
        }

        // Exact BoxGeometry matching CANNON.Box collider (Bricks, Plates, Stone/Bag Ballasts) -> ZERO visual clipping!
        const boxGeo = new THREE.BoxGeometry(p.sx * 0.992, p.sy * 0.992, p.sz * 0.992);
        const mat = new THREE.MeshLambertMaterial({ color: p.color });
        holder.add(new THREE.Mesh(boxGeo, mat));

        const edges = new THREE.EdgesGeometry(boxGeo);
        holder.add(new THREE.LineSegments(edges, edgeMatShared.clone()));
        return holder;
      };

      for (const p of baseSolution.parts) {
        const obj = createPartObject(p);
        ctx.partsGroup.add(obj);
        ctx.partMeshes.set(p.id, obj);
      }
      edgeMatShared.dispose();

      // Update Support Footprint Ring size & color
      const baseR = Math.max(0.04, baseSolution.baseSupportRadiusCm / 100);
      ctx.supportRing.geometry.dispose();
      const newRingGeo = new THREE.RingGeometry(baseR * 0.88, baseR * 1.04, 36);
      newRingGeo.rotateX(-Math.PI / 2);
      ctx.supportRing.geometry = newRingGeo;

      // Build Vertical Metric Height Ruler Pole at x = -0.42m, z = -0.24m
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

      // Frame camera smoothly around tower height
      const targetCenterY = Math.max(0.32, totalM * 0.46);
      ctx.controls.target.set(0, targetCenterY, 0);
    }, [baseSolution, replaySeq]);

    // Update support ring warning color reactively when sliders change
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
    }, [physCollapsed, liveSolution.standing, liveSolution.minSafetyFactor]);

    const isActuallyStanding = !physCollapsed && liveSolution.standing;
    const sfBadgeClass = physCollapsed
      ? 'is-bad'
      : !liveSolution.standing || liveSolution.minSafetyFactor < 1.35
        ? 'is-warn'
        : 'is-ok';

    return (
      <div className="ar-fullscreen-overlay brick-lab-overlay" role="dialog" aria-label="Phòng Thí Nghiệm Xếp Tháp Gạch 3D Vật Lý Thực">
        {/* TOP TELEMETRY & STRATEGY BAR */}
        <header className="ar-fs-topbar brick-topbar">
          <div className="ar-fs-metrics">
            <span>
              CAO THỰC TẾ{' '}
              <strong ref={liveHeightDomRef} className="brick-gold-txt">
                {baseSolution.totalHeightCm.toFixed(1)} cm
              </strong>
              <small style={{ color: '#94a3b8', marginLeft: 4 }}>
                / {baseSolution.totalHeightCm.toFixed(1)} cm
              </small>
            </span>
            <span className="ar-hide-sm">
              CHỊU TỐI ĐA <strong>Cấp {liveSolution.maxSurvivedBeaufort} • {liveSolution.maxSurvivedTiltDeg}°</strong>
            </span>
          </div>

          <div className={`brick-sf-pill ${sfBadgeClass}`}>
            {isAutoAdvancing
              ? `🔄 KIỂU #${safeCandIdx + 1} SẬP → ĐANG TỰ ĐỔI SANG KIỂU #${safeCandIdx + 2}/${candidateLadder.length}...`
              : physCollapsed
                ? `🔴 KIỂU #${safeCandIdx + 1} ĐÃ SẬP (${dislodgedParts} vật rơi)`
                : rejectedCount > 0
                  ? `🟢 ĐỨNG VỮNG THẬT • Kiểu #${safeCandIdx + 1}/${candidateLadder.length} (Đã loại ${rejectedCount} kiểu sập)`
                  : isActuallyStanding
                    ? `🟢 ĐỨNG VỮNG VẬT LÝ THẬT • Kiểu #${safeCandIdx + 1}/${candidateLadder.length}`
                    : `🟡 ĐANG THỬ TẢI • Kiểu #${safeCandIdx + 1}/${candidateLadder.length} (SF ${liveSolution.minSafetyFactor}×)`}
          </div>

          <div className="ar-fs-top-actions">
            <div className="brick-mode-pills">
              <button
                type="button"
                className={buildMode === 'optimal' ? 'active' : ''}
                onClick={() => setBuildMode('optimal')}
                title="Tự động xếp cao nhất mà vẫn đứng vững trong vật lý thật"
              >
                🏆 Cao Nhất
              </button>
              <button
                type="button"
                className={buildMode === 'fortress' ? 'active' : ''}
                onClick={() => setBuildMode('fortress')}
                title="Ưu tiên siêu vững chống bão & rung mạnh"
              >
                🛡️ Siêu Vững
              </button>
              <button
                type="button"
                className={buildMode === 'naive' ? 'active' : ''}
                onClick={() => setBuildMode('naive')}
                title="Xếp chồng thẳng 1 cột để xem vật lý 3D sập đổ thực tế!"
              >
                ⚡ Xếp Thẳng (Thử Sập)
              </button>
            </div>
            <button type="button" className="ar-close-btn" onClick={onClose}>
              ✕ Đóng
            </button>
          </div>
        </header>

        {/* 3-COLUMN LANDSCAPE STUDIO */}
        <div className="brick-studio-body">
          {/* LEFT PANEL: BRICKS & MYSTERY PROPS INVENTORY */}
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

            {/* Active Inventory Items */}
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

            {/* 1-Tap Quick Add Common Station Props */}
            <div className="brick-sec-head">
              <small>Thêm nhanh vật dụng hay gặp tại trạm:</small>
            </div>
            <div className="brick-preset-chips">
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

            {/* Floating Live Physics Controls (Candidate Switcher, Auto-Retry, Reset, Poke Test) */}
            <div className="brick-sim-hud">
              {candidateLadder.length > 1 && (
                <div className="hud-cand-stepper" title="Duyệt qua các phương án xếp khác nhau (từ cao nhất đến đằm chắc nhất)">
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
                  title="Tự động chuyển sang cách xếp khác vững hơn ngay khi mô hình bị sập"
                >
                  {autoSwitchOnCollapse ? '✅ Tự đổi khi sập' : '⏸️ Không tự đổi'}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setVisibleUpToCourse(null);
                  setPhysicsPaused(false);
                  setReplaySeq((s) => s + 1);
                }}
                title="Xếp dựng lại kiểu hiện tại"
              >
                🔄 Dựng lại
              </button>
              <button
                type="button"
                onClick={handlePokeCrown}
                title="Tác động một lực chạm tay ngang vào ngọn tháp như trọng tài kiểm tra"
              >
                💥 Đẩy thử ngọn
              </button>
              <button
                type="button"
                onClick={() => setPhysicsPaused((p) => !p)}
              >
                {physicsPaused ? '▶️ Chạy' : '⏸️ Dừng'}
              </button>
              <span className="brick-sim-chip ar-hide-sm">
                👆 Chạm gạch bất kỳ để đẩy!
              </span>
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
                        🔄 Kiểu #{safeCandIdx + 1} ({baseSolution.totalHeightCm}cm) bị sập — Đang tự thử Kiểu #{safeCandIdx + 2}/{candidateLadder.length} ({candidateLadder[safeCandIdx + 1].totalHeightCm}cm • đằm vững hơn)...
                      </strong>
                      <small>
                        Hệ thống tự động loại bỏ phương án yếu trong vật lý 3D và chuyển tiếp đến khi tìm ra tháp đứng vững!
                      </small>
                    </div>
                    <div className="bcb-actions">
                      <button
                        type="button"
                        className="secondary-action-btn"
                        onClick={() => setAutoSwitchOnCollapse(false)}
                      >
                        ⏹️ Dừng lại xem cảnh sập
                      </button>
                      <button
                        type="button"
                        className="primary-action-btn"
                        onClick={() => {
                          setRejectedCount((c) => c + 1);
                          setCandidateIdx((i) => Math.min(candidateLadder.length - 1, i + 1));
                        }}
                      >
                        ⏭️ Đổi ngay sang Kiểu #{safeCandIdx + 2}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <strong>
                        💥 KIỂU #{safeCandIdx + 1} ĐÃ ĐỔ SẬP TRONG VẬT LÝ 3D ({dislodgedParts} vật rời vị trí)!
                      </strong>
                      <small>
                        {liveSolution.failReason ??
                          'Lực gió, độ nghiêng nền hoặc xung lực đẩy đã vượt quá ma sát & trọng lực giữ của các viên gạch rời.'}
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
                        onClick={handleOptimizeForCurrentLoad}
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
                        ? `Tất cả (${baseSolution.courseCount} tầng • Vật lý thật 120Hz)`
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

          {/* RIGHT PANEL: WIND & SHAKE TESTING + STEP-BY-STEP BUILD GUIDE */}
          <aside className="brick-right-panel">
            <div className="subtab-strip">
              <button
                type="button"
                className={rightTab === 'stress' ? 'active' : ''}
                onClick={() => setRightTab('stress')}
              >
                💨 Thử Gió &amp; Rung
              </button>
              <button
                type="button"
                className={rightTab === 'steps' ? 'active' : ''}
                onClick={() => setRightTab('steps')}
              >
                📋 Cách Xếp ({baseSolution.steps.length})
              </button>
            </div>

            {rightTab === 'stress' ? (
              <div className="brick-stress-stack">
                {/* WIND TUNNEL CONTROL */}
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

                {/* GROUND TILT & SHAKE CONTROL */}
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

                {/* AUTO-OPTIMIZE BUTTON + LIVE AUTO-ADAPT CHECK */}
                <button
                  type="button"
                  className="primary-action-btn full-w"
                  onClick={handleOptimizeForCurrentLoad}
                >
                  ✨ Tự Xếp Cao Nhất Chịu Gió Cấp {testBeaufort} &amp; {effectiveTiltDeg.toFixed(1)}°
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
                    💡 <b>Vật lý thực khuyên để ngoài:</b> {baseSolution.unusedSummary.join(', ')} (đặt thêm lên ở mức gió/rung này sẽ mất ổn định và tự rơi).
                  </div>
                )}
              </div>
            ) : (
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
  }
);
