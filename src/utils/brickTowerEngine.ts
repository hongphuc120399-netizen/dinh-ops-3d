/**
 * 100% Offline 3D Structural Physics & Non-Overlapping Combinatorial Tower Auto-Optimizer
 * Guarantees ZERO object interpenetration (exact SAT OBB/Cylinder clearance, real hollow chimney sockets,
 * solid bridging lintels over voids, non-clipping perimeter buttresses) and full compatibility with live
 * 120Hz cannon-es 3D rigid-body simulation.
 */

export type PropShapeKind =
  | 'block'
  | 'cylinder'
  | 'rod'
  | 'plate'
  | 'stool'
  | 'basket'
  | 'ballast'
  | 'binder';

export interface TowerInventoryItem {
  id: string;
  name: string;
  kind: PropShapeKind;
  count: number;
  /** Dimensions in centimeters (block/plate: L x W x H; cylinder/rod: diameter=widthCm, height=heightCm; binder: length=lengthCm) */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  massKg: number;
  color: string;
  /** Surface friction coefficient (0.30 smooth plastic .. 0.68 rough brick/stone) */
  frictionMu?: number;
  isCustom?: boolean;
}

export interface EnvironmentLoadConfig {
  beaufortLevel: number;
  windSpeedMps: number;
  /** Ground tilt / wobble angle in degrees (0..15°) */
  tiltDeg: number;
  /** Dynamic horizontal shake intensity in g (0..0.35g) */
  shakeG: number;
  /** Extra vertical payload weight placed on the crown in kg (0..30kg) */
  topPayloadKg?: number;
}

export type TowerBuildMode = 'optimal' | 'max_solid' | 'fortress' | 'naive';

export interface PlacedPart3D {
  id: string;
  courseIndex: number;
  itemName: string;
  kind: PropShapeKind;
  roleLabel: string;
  color: string;
  /** Center position in meters (Three.js & cannon-es Y-up, ground at y = 0) */
  x: number;
  y: number;
  z: number;
  /** Dimensions in meters along local X, Y (vertical), Z */
  sx: number;
  sy: number;
  sz: number;
  /** Rotation around vertical Y axis in radians */
  rotY: number;
  /** Optional Guy-Wire anchor on ground (wireToX, 0, wireToZ) when kind === 'binder' */
  wireToX?: number;
  wireToZ?: number;
  /** Physical metadata for cannon-es rigid-body world */
  frictionMu?: number;
  tapedToBelow?: boolean;
  lashedToCourseMin?: number;
  lashedToCourseMax?: number;
  massKg: number;
}

export interface CourseJointCheck {
  courseIndex: number;
  elevationM: number;
  effectiveRadiusM: number;
  massAboveKg: number;
  windMomentNm: number;
  shakeMomentNm: number;
  imperfectionMomentNm: number;
  restoringMomentNm: number;
  safetyFactor: number;
  slidingSafetyFactor: number;
  materialSafetyFactor?: number;
  axialLoadKg?: number;
  contactStressKgCm2?: number;
  utilizationPct?: number;
  failed: boolean;
  failureMode: 'none' | 'overturn' | 'slide' | 'crush';
}

export interface LoadBearingReport {
  /** Extra payload currently placed on the crown (kg) */
  appliedTopPayloadKg: number;
  /** Maximum extra payload (kg) the crown can carry under current wind/tilt/shake before any failure */
  maxSafeTopPayloadKg: number;
  /** Which physical mechanism limits the top payload */
  limitingComponent: string;
  /** Total vertical downward force at ground foundation (N) */
  baseAxialForceN: number;
  /** Total mass pressing on ground including tower, buttresses & top payload (kg) */
  baseTotalWeightKg: number;
  /** Effective base contact area on ground (cm²) */
  baseContactAreaCm2: number;
  /** Ground bearing pressure (kg/cm²) */
  groundPressureKgCm2: number;
  /** Soil bearing assessment for forest / mountain ground */
  groundVerdict: string;
  /** Peak combined stress/stability utilization across all courses (0..100+%) */
  peakUtilizationPct: number;
  /** Per-course utilization % (0..120) */
  courseUtilizationPct: number[];
  /** Per-course Red Load-Bearing Zone intensity (0..100, >=70 renders vivid RED load-bearing highlight) */
  courseRedIntensity: number[];
  /** Course index experiencing the highest combined load-bearing & overturning stress */
  criticalCourseIndex: number;
  /** Non-null if a bottle/plate/basket/stool/rod physically crushes or buckles under vertical load */
  crushFailedCourseIndex: number | null;
}

export interface BuildStepGuide {
  stepNumber: number;
  courseRange: [number, number];
  title: string;
  detail: string;
  heightReachedCm: number;
}

export interface InternalCourseSummary {
  courseIndex: number;
  yBottom: number;
  heightM: number;
  supportRadiusM: number;
  /** Exact clear inscribed circle radius at (0,0) in meters (0 if solid across center) */
  clearHoleRadiusM: number;
  /** Exact outer bounding radius from (0,0) in meters */
  maxOuterRadiusM: number;
  windWidthM: number;
  dragCoeff: number;
  massKg: number;
  frictionMu: number;
  binderMomentNm: number;
  bearingAreaCm2?: number;
  crushCapacityKg?: number;
  courseLabel?: string;
}

export interface TowerSolution {
  mode: TowerBuildMode;
  totalHeightCm: number;
  masonryHeightCm: number;
  spireAddedCm: number;
  totalMassKg: number;
  centerOfMassHeightCm: number;
  baseSupportRadiusCm: number;
  minSafetyFactor: number;
  minSlidingFactor: number;
  standing: boolean;
  failCourseIndex: number | null;
  failElevationM: number;
  failReason: string | null;
  maxSurvivedBeaufort: number;
  maxSurvivedWindMps: number;
  maxSurvivedTiltDeg: number;
  courseCount: number;
  partsUsedSummary: string[];
  unusedSummary: string[];
  parts: PlacedPart3D[];
  jointChecks: CourseJointCheck[];
  steps: BuildStepGuide[];
  loadReport: LoadBearingReport;
  /** Cached structural skeleton for instant (<0.1ms) live 120Hz wind/shake slider re-evaluation */
  _skeleton: {
    courses: InternalCourseSummary[];
    rodParts: PlacedPart3D[];
    ballastMassKg: number;
    ballastRadiusM: number;
    guyWireMomentNm: number;
    guyWireAttachY: number;
  };
}

export interface BeaufortMeta {
  level: number;
  name: string;
  windMps: number;
  desc: string;
}

export const BEAUFORT_TABLE: BeaufortMeta[] = [
  { level: 0, name: 'Cấp 0 • Đứng gió', windMps: 0.2, desc: 'Trong phòng kín / Lặng gió hoàn toàn' },
  { level: 1, name: 'Cấp 1 • Gió thoảng', windMps: 1.2, desc: 'Khói bay nhẹ (~4 km/h)' },
  { level: 2, name: 'Cấp 2 • Gió nhẹ', windMps: 2.6, desc: 'Lá cây xào xạc nhẹ (~9 km/h)' },
  { level: 3, name: 'Cấp 3 • Gió mát rừng', windMps: 4.5, desc: 'Cành nhỏ đung đưa (~16 km/h)' },
  { level: 4, name: 'Cấp 4 • Gió vừa', windMps: 6.8, desc: 'Bụi & giấy bay, quạt mạnh (~24 km/h)' },
  { level: 5, name: 'Cấp 5 • Gió khá mạnh', windMps: 9.5, desc: 'Cây nhỏ nghiêng ngả (~34 km/h)' },
  { level: 6, name: 'Cấp 6 • Gió mạnh đỉnh núi', windMps: 12.5, desc: 'Gió lộng Đỉnh La Bàn (~45 km/h)' },
  { level: 7, name: 'Cấp 7 • Gió giật mạnh', windMps: 15.6, desc: 'Đi ngược gió thấy nặng (~56 km/h)' },
  { level: 8, name: 'Cấp 8 • Gió bão nhỏ', windMps: 19.0, desc: 'Gió giật gãy cành khô (~68 km/h)' },
  { level: 9, name: 'Cấp 9 • Gió bão dữ', windMps: 22.8, desc: 'Thử tải cực đại (~82 km/h)' }
];

export const PRESET_PROP_TEMPLATES: Omit<TowerInventoryItem, 'id' | 'count'>[] = [
  {
    name: 'Gạch ống 4 lỗ (8×8×18)',
    kind: 'block',
    lengthCm: 18,
    widthCm: 8,
    heightCm: 8,
    massKg: 1.25,
    color: '#c85a32',
    frictionMu: 0.62
  },
  {
    name: 'Gạch thẻ đặc (20×10×5)',
    kind: 'block',
    lengthCm: 20,
    widthCm: 10,
    heightCm: 5,
    massKg: 1.85,
    color: '#b44828',
    frictionMu: 0.64
  },
  {
    name: 'Chai nước 500ml (Đầy)',
    kind: 'cylinder',
    lengthCm: 6.6,
    widthCm: 6.6,
    heightCm: 21,
    massKg: 0.53,
    color: '#38bdf8',
    frictionMu: 0.38
  },
  {
    name: 'Chai nhựa 500ml (Rỗng)',
    kind: 'cylinder',
    lengthCm: 6.6,
    widthCm: 6.6,
    heightCm: 21,
    massKg: 0.03,
    color: '#7dd3fc',
    frictionMu: 0.34
  },
  {
    name: 'Chai nước lớn 1.5L (Đầy)',
    kind: 'cylinder',
    lengthCm: 9.2,
    widthCm: 9.2,
    heightCm: 31,
    massKg: 1.55,
    color: '#0284c7',
    frictionMu: 0.38
  },
  {
    name: 'Lon nước ngọt / Bia',
    kind: 'cylinder',
    lengthCm: 6.6,
    widthCm: 6.6,
    heightCm: 12.2,
    massKg: 0.35,
    color: '#fbbf24',
    frictionMu: 0.36
  },
  {
    name: 'Gậy tre / Tầm vông 1.2m',
    kind: 'rod',
    lengthCm: 3.0,
    widthCm: 3.0,
    heightCm: 120,
    massKg: 0.28,
    color: '#a3be5c',
    frictionMu: 0.48
  },
  {
    name: 'Tấm bìa cứng / Ván phẳng',
    kind: 'plate',
    lengthCm: 28,
    widthCm: 28,
    heightCm: 0.8,
    massKg: 0.22,
    color: '#d4a373',
    frictionMu: 0.52
  },
  {
    name: 'Đá tảng / Balo dằn chân',
    kind: 'ballast',
    lengthCm: 20,
    widthCm: 16,
    heightCm: 12,
    massKg: 3.2,
    color: '#64748b',
    frictionMu: 0.68
  },
  {
    name: 'Dây dù / Dây buộc (3m)',
    kind: 'binder',
    lengthCm: 300,
    widthCm: 0.6,
    heightCm: 0.6,
    massKg: 0.08,
    color: '#fde047',
    frictionMu: 0.6
  },
  {
    name: 'Cuộn băng keo',
    kind: 'binder',
    lengthCm: 120,
    widthCm: 4.8,
    heightCm: 4.8,
    massKg: 0.1,
    color: '#e2e8f0',
    frictionMu: 0.65
  },
  {
    name: 'Ghế nhựa không dựa (28×28×30)',
    kind: 'stool',
    lengthCm: 28,
    widthCm: 28,
    heightCm: 30,
    massKg: 0.72,
    color: '#2563eb',
    frictionMu: 0.58
  },
  {
    name: 'Rổ nhựa úp ngược (30×30×14)',
    kind: 'basket',
    lengthCm: 30,
    widthCm: 30,
    heightCm: 14,
    massKg: 0.26,
    color: '#14b8a6',
    frictionMu: 0.5
  }
];

export function estimateItemMassKg(
  kind: PropShapeKind,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  material: 'brick' | 'wood' | 'water' | 'hollow_plastic' | 'stone' | 'metal'
): number {
  const rawVolCm3 =
    kind === 'cylinder' || kind === 'rod'
      ? Math.PI * Math.pow(widthCm * 0.5, 2) * heightCm
      : lengthCm * widthCm * heightCm;
  // Open-frame stools & perforated baskets occupy ~12-18% solid shell volume
  const fillFactor = kind === 'stool' ? 0.16 : kind === 'basket' ? 0.12 : 1.0;
  const volCm3 = rawVolCm3 * fillFactor;
  const densityGPerCm3: Record<typeof material, number> = {
    brick: 1.45,
    stone: 2.35,
    water: 0.96,
    wood: 0.62,
    hollow_plastic: kind === 'stool' || kind === 'basket' ? 0.36 : 0.08,
    metal: 2.7
  };
  return Math.max(0.02, Number(((volCm3 * densityGPerCm3[material]) / 1000).toFixed(2)));
}

const GRAVITY = 9.80665;
const AIR_DENSITY = 1.2;
const GUST_FACTOR = 1.25;
/** Intra-course clearance between bricks so physics bodies never spawn touching/overlapping laterally */
const INTRA_GAP_M = 0.0014;

type BlockOrient = 'flat' | 'edge' | 'upright';
type CoursePattern = 'ring4' | 'tri3' | 'crib2' | 'crib2_bridge' | 'single1';

interface SortedPools {
  blocks: TowerInventoryItem[];
  stools: TowerInventoryItem[];
  baskets: TowerInventoryItem[];
  heavyCyls: TowerInventoryItem[];
  lightCyls: TowerInventoryItem[];
  plates: TowerInventoryItem[];
  rods: TowerInventoryItem[];
  ballasts: TowerInventoryItem[];
  binders: TowerInventoryItem[];
  distinctOrients: BlockOrient[];
}

function prepareSortedPools(inventory: TowerInventoryItem[]): SortedPools {
  const blocks: TowerInventoryItem[] = [];
  const stools: TowerInventoryItem[] = [];
  const baskets: TowerInventoryItem[] = [];
  const heavyCyls: TowerInventoryItem[] = [];
  const lightCyls: TowerInventoryItem[] = [];
  const plates: TowerInventoryItem[] = [];
  const rods: TowerInventoryItem[] = [];
  const ballasts: TowerInventoryItem[] = [];
  const binders: TowerInventoryItem[] = [];

  for (const it of inventory) {
    const qty = Math.max(0, Math.floor(it.count));
    for (let k = 0; k < qty; k++) {
      if (it.kind === 'block') blocks.push(it);
      else if (it.kind === 'stool') stools.push(it);
      else if (it.kind === 'basket') baskets.push(it);
      else if (it.kind === 'cylinder') {
        if (it.massKg >= 0.25) heavyCyls.push(it);
        else lightCyls.push(it);
      } else if (it.kind === 'plate') plates.push(it);
      else if (it.kind === 'rod') rods.push(it);
      else if (it.kind === 'ballast') ballasts.push(it);
      else if (it.kind === 'binder') binders.push(it);
    }
  }

  blocks.sort((a, b) => b.massKg - a.massKg);
  stools.sort((a, b) => b.lengthCm * b.widthCm - a.lengthCm * a.widthCm || b.heightCm - a.heightCm);
  baskets.sort((a, b) => b.lengthCm * b.widthCm - a.lengthCm * a.widthCm);
  heavyCyls.sort((a, b) => b.heightCm - a.heightCm || b.widthCm - a.widthCm);
  lightCyls.sort((a, b) => b.heightCm - a.heightCm);
  plates.sort((a, b) => b.lengthCm * b.widthCm - a.lengthCm * a.widthCm);
  rods.sort((a, b) => b.heightCm - a.heightCm);

  let distinctOrients: BlockOrient[] = ['flat', 'edge', 'upright'];
  if (blocks.length > 0) {
    const [dMin, dMid, dMax] = [blocks[0].lengthCm, blocks[0].widthCm, blocks[0].heightCm].sort((a, b) => a - b);
    if (Math.abs(dMin - dMax) < 0.05) {
      distinctOrients = ['flat'];
    } else if (Math.abs(dMin - dMid) < 0.05) {
      distinctOrients = ['flat', 'upright'];
    } else if (Math.abs(dMid - dMax) < 0.05) {
      distinctOrients = ['flat', 'edge'];
    }
  }

  return {
    blocks,
    stools,
    baskets,
    heavyCyls,
    lightCyls,
    plates,
    rods,
    ballasts,
    binders,
    distinctOrients
  };
}

function getBlockDimsForOrient(item: TowerInventoryItem, orient: BlockOrient): { lM: number; tM: number; hM: number } {
  let a = item.lengthCm;
  let b = item.widthCm;
  let c = item.heightCm;
  if (a > b) { const t = a; a = b; b = t; }
  if (b > c) { const t = b; a = a; b = c; c = t; }
  if (a > b) { const t = a; a = b; b = t; }
  if (orient === 'flat') return { lM: c * 0.01, tM: b * 0.01, hM: a * 0.01 };
  if (orient === 'edge') return { lM: c * 0.01, tM: a * 0.01, hM: b * 0.01 };
  return { lM: b * 0.01, tM: a * 0.01, hM: c * 0.01 };
}

/**
 * Physical Real-Gravity Validity Check:
 * - tri3 (60° alternating triangle) and crib2 (90° alternating box-crib) REQUIRE elongated horizontal bricks
 *   (lM >= 1.5 * tM) so upper bricks bear squarely across lower bricks with >= 3cm lever arm!
 *   Square-footprint upright bricks (e.g. 8x8cm) in tri3 or crib2 hang over empty air and topple under real gravity.
 */
function isPatternPhysicallyValid(pattern: CoursePattern, lM: number, tM: number): boolean {
  if (pattern === 'tri3') return lM >= 1.48 * tM;
  if (pattern === 'crib2' || pattern === 'crib2_bridge') return lM >= 1.55 * tM;
  return true; // ring4 and single1 have full 100% corner/center bearing in all orientations
}

/**
 * Exact center-to-brick offset for open `crib2` chimney:
 * Ensures >= 3.0cm CoM margin inside the perpendicular brick length `lM * 0.5`,
 * while opening a wide square central chimney (`4.0cm x 4.0cm` on 18x8cm bricks) so poles never clip!
 */
function computeCrib2OffsetM(lM: number, tM: number, isBridge: boolean): number {
  if (isBridge) {
    return tM * 0.5 + INTRA_GAP_M * 0.5;
  }
  const maxSafeCoM = lM * 0.5 - Math.max(0.028, tM * 0.36);
  const desiredOpenOffset = tM * 0.5 + 0.0195; // 3.9cm x 3.9cm clear hole (4.5mm clearance around 3cm pole, zero clipping!)
  return Math.max(tM * 0.5 + INTRA_GAP_M * 0.5, Math.min(maxSafeCoM, desiredOpenOffset));
}

function computeCourseMetricsOnly(
  courseIndex: number,
  yBottom: number,
  bricks: TowerInventoryItem[],
  startIdx: number,
  nBricks: number,
  pattern: CoursePattern,
  orient: BlockOrient,
  hasTiedBand: boolean
): InternalCourseSummary {
  const ref = bricks[startIdx];
  const { lM, tM, hM } = getBlockDimsForOrient(ref, orient);
  let totalMass = 0;
  for (let i = 0; i < nBricks; i++) totalMass += bricks[startIdx + i].massKg;
  const mu = ref.frictionMu ?? 0.62;
  const singleAreaCm2 = (lM * 100) * (tM * 100);
  // Hollow clay bricks ~16 kg/cm² net compressive strength, solid bricks ~60 kg/cm²
  const brickCrushKg = nBricks * singleAreaCm2 * 16;

  if (pattern === 'ring4') {
    const outerSpan = lM + tM + INTRA_GAP_M;
    const innerSpan = Math.max(0, lM - tM + INTRA_GAP_M);
    const monolithFactor = orient === 'upright' && !hasTiedBand ? 0.78 : 0.91;
    return {
      courseIndex,
      yBottom,
      heightM: hM,
      supportRadiusM: outerSpan * 0.5 * monolithFactor,
      clearHoleRadiusM: Math.max(0, innerSpan * 0.5 - 0.0015),
      maxOuterRadiusM: outerSpan * 0.5 * Math.SQRT2,
      windWidthM: outerSpan * 0.92,
      dragCoeff: 1.3,
      massKg: totalMass,
      frictionMu: mu,
      binderMomentNm: hasTiedBand ? 2.4 : 0,
      bearingAreaCm2: nBricks * singleAreaCm2,
      crushCapacityKg: brickCrushKg,
      courseLabel: ref.name
    };
  }
  if (pattern === 'tri3') {
    const rIn = lM / (2 * Math.sqrt(3)) + 0.0035;
    const rCenter = rIn + tM * 0.5;
    const rOuterCorner = Math.hypot(rIn + tM, lM * 0.5);
    return {
      courseIndex,
      yBottom,
      heightM: hM,
      supportRadiusM: (rCenter + tM * 0.36) * 0.9,
      clearHoleRadiusM: Math.max(0, rIn - 0.002),
      maxOuterRadiusM: rOuterCorner,
      windWidthM: (rCenter * 2 + tM) * 0.86,
      dragCoeff: 1.22,
      massKg: totalMass,
      frictionMu: mu,
      binderMomentNm: hasTiedBand ? 2.0 : 0,
      bearingAreaCm2: nBricks * singleAreaCm2,
      crushCapacityKg: brickCrushKg,
      courseLabel: ref.name
    };
  }
  if (pattern === 'crib2' || pattern === 'crib2_bridge') {
    const isBridge = pattern === 'crib2_bridge';
    const offset = computeCrib2OffsetM(lM, tM, isBridge);
    const spanAcross = offset * 2 + tM;
    const minSpan = Math.min(lM, spanAcross);
    const clearHalf = isBridge ? 0 : Math.max(0, offset - tM * 0.5 - 0.0015);
    return {
      courseIndex,
      yBottom,
      heightM: hM,
      supportRadiusM: minSpan * 0.5 * 0.77,
      clearHoleRadiusM: clearHalf,
      maxOuterRadiusM: Math.hypot(lM * 0.5, offset + tM * 0.5),
      windWidthM: Math.max(lM, spanAcross) * 0.88,
      dragCoeff: 1.26,
      massKg: totalMass,
      frictionMu: mu,
      binderMomentNm: hasTiedBand ? 1.8 : 0,
      bearingAreaCm2: nBricks * singleAreaCm2,
      crushCapacityKg: brickCrushKg,
      courseLabel: ref.name
    };
  }
  // Account for multi-joint P-Delta corner rounding on narrow single-brick columns so statics match real cannon-es!
  const weakHalf = Math.min(lM, tM) * 0.5 * 0.72;
  return {
    courseIndex,
    yBottom,
    heightM: hM,
    supportRadiusM: weakHalf,
    clearHoleRadiusM: 0,
    maxOuterRadiusM: Math.hypot(lM * 0.5, tM * 0.5),
    windWidthM: (lM + tM) * 0.5,
    dragCoeff: 1.28,
    massKg: totalMass,
    frictionMu: mu,
    binderMomentNm: hasTiedBand ? 1.1 : 0,
    bearingAreaCm2: singleAreaCm2,
    crushCapacityKg: brickCrushKg,
    courseLabel: ref.name
  };
}

function materializeBlockParts(
  courseIndex: number,
  yBottom: number,
  bricks: TowerInventoryItem[],
  pattern: CoursePattern,
  orient: BlockOrient
): PlacedPart3D[] {
  const ref = bricks[0];
  const { lM, tM, hM } = getBlockDimsForOrient(ref, orient);
  const yCenter = yBottom + hM * 0.5;
  const parts: PlacedPart3D[] = [];
  const parity = courseIndex % 2;
  const oriTxt = orient === 'upright' ? 'Dựng đứng' : orient === 'edge' ? 'Nghiêng cạnh' : 'Nằm bệt';

  if (pattern === 'ring4' && bricks.length === 4) {
    const chSign = parity === 0 ? 1 : -1;
    const g = INTRA_GAP_M;
    const placements: [number, number, number, number][] = [
      [chSign * (-(tM + g) * 0.5), -(lM + g) * 0.5, lM, tM],
      [chSign * ((lM + g) * 0.5), -(tM + g) * 0.5, tM, lM],
      [chSign * ((tM + g) * 0.5), (lM + g) * 0.5, lM, tM],
      [chSign * (-(lM + g) * 0.5), (tM + g) * 0.5, tM, lM]
    ];
    for (let i = 0; i < 4; i++) {
      const [px, pz, sx, sz] = placements[i];
      parts.push({
        id: `c${courseIndex}-b${i}`,
        courseIndex,
        itemName: bricks[i].name,
        kind: 'block',
        roleLabel: `Giếng vuông 4 viên (${oriTxt})`,
        color: bricks[i].color,
        x: px,
        y: yCenter,
        z: pz,
        sx,
        sy: hM,
        sz,
        rotY: 0,
        frictionMu: bricks[i].frictionMu ?? 0.62,
        massKg: bricks[i].massKg
      });
    }
    return parts;
  }

  if (pattern === 'tri3' && bricks.length === 3) {
    const rIn = lM / (2 * Math.sqrt(3)) + 0.0035;
    const rCenter = rIn + tM * 0.5;
    const baseAngle = parity * (Math.PI / 3);
    for (let i = 0; i < 3; i++) {
      const theta = baseAngle + (i * 2 * Math.PI) / 3;
      parts.push({
        id: `c${courseIndex}-t${i}`,
        courseIndex,
        itemName: bricks[i].name,
        kind: 'block',
        roleLabel: `Kiềng tam giác 3 viên (${oriTxt})`,
        color: bricks[i].color,
        x: Math.cos(theta) * rCenter,
        y: yCenter,
        z: Math.sin(theta) * rCenter,
        sx: tM,
        sy: hM,
        sz: lM,
        rotY: -theta,
        frictionMu: bricks[i].frictionMu ?? 0.62,
        massKg: bricks[i].massKg
      });
    }
    return parts;
  }

  if ((pattern === 'crib2' || pattern === 'crib2_bridge') && bricks.length === 2) {
    const isBridge = pattern === 'crib2_bridge';
    const offset = computeCrib2OffsetM(lM, tM, isBridge);
    const alongX = parity === 0;
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      parts.push({
        id: `c${courseIndex}-p${i}`,
        courseIndex,
        itemName: bricks[i].name,
        kind: 'block',
        roleLabel: isBridge
          ? `Sàn gạch khép kín bắc qua miệng giếng (${oriTxt})`
          : `Đan chữ thập 2 viên chừa giếng tâm (${oriTxt})`,
        color: bricks[i].color,
        x: alongX ? 0 : sign * offset,
        y: yCenter,
        z: alongX ? sign * offset : 0,
        sx: alongX ? lM : tM,
        sy: hM,
        sz: alongX ? tM : lM,
        rotY: 0,
        frictionMu: bricks[i].frictionMu ?? 0.62,
        massKg: bricks[i].massKg
      });
    }
    return parts;
  }

  const alongX = parity === 0;
  parts.push({
    id: `c${courseIndex}-s0`,
    courseIndex,
    itemName: ref.name,
    kind: 'block',
    roleLabel: `Trụ đơn 1 viên (${oriTxt})`,
    color: ref.color,
    x: 0,
    y: yCenter,
    z: 0,
    sx: alongX ? lM : tM,
    sy: hM,
    sz: alongX ? tM : lM,
    rotY: 0,
    frictionMu: ref.frictionMu ?? 0.62,
    massKg: ref.massKg
  });
  return parts;
}

/**
 * Exact 2D Rotated OBB Separating Axis Theorem + Y-Interval Overlap Detector!
 * Returns the number of interpenetrating physical object pairs (tolerance 0.8mm).
 */
export function countPairwiseOverlaps(parts: PlacedPart3D[], tolM = 0.0008): number {
  const solids = parts.filter((p) => p.kind !== 'binder');
  let overlaps = 0;
  for (let i = 0; i < solids.length; i++) {
    const a = solids[i];
    const aYMin = a.y - a.sy * 0.5 + tolM;
    const aYMax = a.y + a.sy * 0.5 - tolM;
    for (let j = i + 1; j < solids.length; j++) {
      const b = solids[j];
      const bYMin = b.y - b.sy * 0.5 + tolM;
      const bYMax = b.y + b.sy * 0.5 - tolM;
      if (aYMax <= bYMin || bYMax <= aYMin) continue;

      const aIsCirc = a.kind === 'cylinder' || a.kind === 'rod';
      const bIsCirc = b.kind === 'cylinder' || b.kind === 'rod';

      if (aIsCirc && bIsCirc) {
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        if (dist < (a.sx + b.sx) * 0.5 - tolM) overlaps++;
        continue;
      }

      if (aIsCirc !== bIsCirc) {
        const circ = aIsCirc ? a : b;
        const box = aIsCirc ? b : a;
        const r = circ.sx * 0.5 - tolM;
        const dx = circ.x - box.x;
        const dz = circ.z - box.z;
        const cos = Math.cos(-box.rotY);
        const sin = Math.sin(-box.rotY);
        // Transform circle center into box local frame (Three.js Y rotation: x' = x*cos + z*sin, z' = -x*sin + z*cos)
        const lx = dx * cos + dz * sin;
        const lz = -dx * sin + dz * cos;
        const hx = Math.max(0, box.sx * 0.5 - tolM);
        const hz = Math.max(0, box.sz * 0.5 - tolM);
        const cx = Math.max(-hx, Math.min(hx, lx));
        const cz = Math.max(-hz, Math.min(hz, lz));
        if (Math.hypot(lx - cx, lz - cz) < r) overlaps++;
        continue;
      }

      // Box vs Box 2D SAT in XZ plane
      if (obb2DOverlap(a, b, tolM)) overlaps++;
    }
  }
  return overlaps;
}

function obb2DOverlap(a: PlacedPart3D, b: PlacedPart3D, tolM: number): boolean {
  const axes: [number, number][] = [
    [Math.cos(a.rotY), -Math.sin(a.rotY)],
    [Math.sin(a.rotY), Math.cos(a.rotY)],
    [Math.cos(b.rotY), -Math.sin(b.rotY)],
    [Math.sin(b.rotY), Math.cos(b.rotY)]
  ];
  const corners = (p: PlacedPart3D): [number, number][] => {
    const hx = Math.max(0, p.sx * 0.5 - tolM * 0.5);
    const hz = Math.max(0, p.sz * 0.5 - tolM * 0.5);
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    return [
      [p.x + hx * c + hz * s, p.z - hx * s + hz * c],
      [p.x - hx * c + hz * s, p.z + hx * s + hz * c],
      [p.x + hx * c - hz * s, p.z - hx * s - hz * c],
      [p.x - hx * c - hz * s, p.z + hx * s - hz * c]
    ];
  };
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    let minA = Infinity, maxA = -Infinity;
    for (const [px, pz] of ca) {
      const pr = px * ax + pz * az;
      if (pr < minA) minA = pr;
      if (pr > maxA) maxA = pr;
    }
    let minB = Infinity, maxB = -Infinity;
    for (const [px, pz] of cb) {
      const pr = px * ax + pz * az;
      if (pr < minB) minB = pr;
      if (pr > maxB) maxB = pr;
    }
    if (maxA <= minB + tolM * 0.5 || maxB <= minA + tolM * 0.5) return false;
  }
  return true;
}

/**
 *Resolves non-clipping 3D placement for a Spire Rod (`Gậy tre` / `Thanh dài`):
 * 1. First tries dropping down an ACTUAL open central chimney (`clearHoleRadiusM >= rodRadius + 1.5mm`),
 *    stopping squarely on top of the first solid floor (`plate` / `crib2_bridge` / `single1` / ground `y=0`).
 * 2. Otherwise, if `hasBinder` is true, lashes the rod flush against the OUTSIDE `+X` face of the upper courses (`0.0mm` clipping!).
 * 3. Otherwise returns `null` (never pierces solid bricks!).
 */
function resolveSpireRodPlacement(
  courses: InternalCourseSummary[],
  rod: TowerInventoryItem,
  hasBinder: boolean
): PlacedPart3D | null {
  if (courses.length === 0) return null;
  const rodLenM = rod.heightCm * 0.01;
  const rodDiamM = Math.max(0.014, rod.widthCm * 0.01);
  const rodRadiusM = rodDiamM * 0.5;
  const topCourse = courses[courses.length - 1];
  const yTop = topCourse.yBottom + topCourse.heightM;

  // Option 1: True hollow central chimney socket!
  const minClearNeeded = rodRadiusM + 0.0018;
  if (topCourse.clearHoleRadiusM >= minClearNeeded) {
    let floorY = 0;
    for (let k = courses.length - 1; k >= 0; k--) {
      if (courses[k].clearHoleRadiusM >= minClearNeeded) {
        floorY = courses[k].yBottom;
      } else {
        floorY = courses[k].yBottom + courses[k].heightM;
        break;
      }
    }
    const socketDepthM = yTop - floorY;
    // Require >= 30cm deep chimney socket (4 flat brick courses) when dry-stacked, >= 23cm (3 courses) when bound!
    const minRequiredDepth = hasBinder
      ? Math.min(0.23, rodLenM * 0.22)
      : Math.min(0.30, rodLenM * 0.27);
    if (socketDepthM >= minRequiredDepth && rodLenM > socketDepthM + 0.05) {
      return {
        id: 'spire-rod-0',
        courseIndex: courses.length - 1,
        itemName: rod.name,
        kind: 'rod',
        roleLabel: `Cắm vào lòng giếng rỗng sâu ${(socketDepthM * 100).toFixed(0)}cm (tựa trên sàn kín)`,
        color: rod.color,
        x: 0,
        y: floorY + 0.0005 + rodLenM * 0.5,
        z: 0,
        sx: rodDiamM,
        sy: rodLenM,
        sz: rodDiamM,
        rotY: 0,
        frictionMu: rod.frictionMu ?? 0.48,
        massKg: rod.massKg
      };
    }
  }

  // Option 2: Side-lashed mast strapped outside the upper brick courses when binder (rope/tape) exists!
  if (hasBinder && yTop >= 0.22) {
    const lashDepthM = Math.min(yTop * 0.65, Math.max(0.18, rodLenM * 0.22));
    const lashBotY = Math.max(0.02, yTop - lashDepthM);
    let maxOuterX = 0.04;
    let minCourse = courses.length - 1;
    for (let k = courses.length - 1; k >= 0; k--) {
      const cTop = courses[k].yBottom + courses[k].heightM;
      if (cTop <= lashBotY) break;
      minCourse = k;
      if (courses[k].maxOuterRadiusM > maxOuterX) {
        maxOuterX = courses[k].maxOuterRadiusM;
      }
    }
    if (rodLenM > lashDepthM + 0.05) {
      return {
        id: 'spire-rod-0',
        courseIndex: courses.length - 1,
        itemName: rod.name,
        kind: 'rod',
        roleLabel: `Buộc nẹp sát sườn ngoài tầng ${minCourse + 1}–${courses.length} bằng dây/băng keo`,
        color: rod.color,
        x: maxOuterX + rodRadiusM + 0.0025,
        y: lashBotY + rodLenM * 0.5,
        z: 0,
        sx: rodDiamM,
        sy: rodLenM,
        sz: rodDiamM,
        rotY: 0,
        frictionMu: rod.frictionMu ?? 0.48,
        lashedToCourseMin: minCourse,
        lashedToCourseMax: courses.length - 1,
        massKg: rod.massKg
      };
    }
  }

  return null;
}

/**
 * Fast O(N) Structural Stability Pass across all courses
 */
function evaluateSkeletonStability(
  courses: InternalCourseSummary[],
  rodParts: PlacedPart3D[],
  ballastMassKg: number,
  ballastRadiusM: number,
  guyWireMomentNm: number,
  guyWireAttachY: number,
  env: EnvironmentLoadConfig,
  recordJoints: boolean
): {
  jointChecks: CourseJointCheck[];
  minSF: number;
  minSlideSF: number;
  failCourseIndex: number | null;
  failElevationM: number;
  failReason: string | null;
  crushFailedCourseIndex: number | null;
  rodEulerLimitKg: number;
} {
  const n = courses.length;
  if (n === 0) {
    return {
      jointChecks: [],
      minSF: 99,
      minSlideSF: 99,
      failCourseIndex: null,
      failElevationM: 0,
      failReason: null,
      crushFailedCourseIndex: null,
      rodEulerLimitKg: 999
    };
  }

  const totalHeightM = courses[n - 1].yBottom + courses[n - 1].heightM;
  const baseRadiusM = Math.max(0.02, courses[0].supportRadiusM);
  const slenderness = totalHeightM / (baseRadiusM * 2);
  const daf = 1 + 0.28 * Math.min(4.2, slenderness / 4.5);

  const vEff = Math.max(0, env.windSpeedMps) * GUST_FACTOR;
  const qWind = 0.5 * AIR_DENSITY * vEff * vEff;
  const tiltRad = (Math.max(0, env.tiltDeg) * Math.PI) / 180;
  const sinTilt = Math.sin(tiltRad);
  const cosTilt = Math.cos(tiltRad);
  const lateralAccelRatio = sinTilt + env.shakeG * daf;

  const topPayloadKg = Math.max(0, env.topPayloadKg ?? 0);
  const rod0 = rodParts[0];
  const topTowerY = rod0 ? Math.max(totalHeightM, rod0.y + rod0.sy * 0.5) : totalHeightM;

  // Euler Column Buckling Limit for Spire Rod if top payload sits on the rod!
  let rodEulerLimitKg = 999;
  if (rod0 && rod0.y + rod0.sy * 0.5 > totalHeightM + 0.02) {
    const freeLenM = Math.max(0.08, rod0.y + rod0.sy * 0.5 - totalHeightM);
    const dM = Math.max(0.012, rod0.sx);
    const inertiaM4 = (Math.PI * Math.pow(dM, 4)) / 64;
    // E_wood_bamboo ≈ 9.5 GPa, effective length factor K = 2.1 (cantilever spire) + eccentricity knockdown 0.35
    const eulerN = (Math.PI * Math.PI * 9.5e9 * inertiaM4) / Math.pow(2.1 * freeLenM, 2);
    rodEulerLimitKg = Math.max(1.2, (eulerN * 0.35) / GRAVITY);
  }

  let suffixMass = topPayloadKg;
  let suffixWeightedY = topPayloadKg * (topTowerY + 0.03);
  let suffixWindForce = topPayloadKg > 0.05 ? qWind * 1.1 * (0.09 * 0.08) : 0;
  let suffixWindForceY = suffixWindForce * (topTowerY + 0.04);

  const jointChecks: CourseJointCheck[] = recordJoints ? new Array(n) : [];
  let minSF = Infinity;
  let minSlideSF = Infinity;
  let failCourseIndex: number | null = null;
  let failElevationM = 0;
  let failReason: string | null = null;
  let crushFailedCourseIndex: number | null = null;

  // Check if top payload buckles the spire rod first!
  if (topPayloadKg > rodEulerLimitKg) {
    minSF = Number((rodEulerLimitKg / topPayloadKg).toFixed(2));
    failCourseIndex = n - 1;
    failElevationM = totalHeightM;
    crushFailedCourseIndex = n - 1;
    if (recordJoints) {
      failReason = `Gãy uốn dọc (Euler) ngọn "${rod0.itemName}" do tải đỉnh ${topPayloadKg.toFixed(1)}kg vượt giới hạn chịu uốn ${rodEulerLimitKg.toFixed(1)}kg!`;
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    const c = courses[i];
    const zCut = c.yBottom;
    const yMid = zCut + c.heightM * 0.5;
    suffixMass += c.massKg;
    suffixWeightedY += c.massKg * yMid;

    const heightBoost = 0.85 + 0.15 * Math.min(2.0, yMid);
    const fWind = qWind * heightBoost * c.dragCoeff * (c.windWidthM * c.heightM);
    suffixWindForce += fWind;
    suffixWindForceY += fWind * yMid;

    let massAbove = suffixMass;
    let weightedY = suffixWeightedY;
    let windForceHoriz = suffixWindForce;
    let windMoment = suffixWindForceY - suffixWindForce * zCut;
    let rodEccentricMoment = 0;

    if (rod0) {
      const topY = rod0.y + rod0.sy * 0.5;
      if (topY > zCut) {
        const botY = Math.max(zCut, rod0.y - rod0.sy * 0.5);
        const exposedH = Math.max(0, topY - botY);
        const frac = rod0.sy > 0 ? exposedH / rod0.sy : 0;
        const mPart = rod0.massKg * frac;
        const midY = botY + exposedH * 0.5;
        massAbove += mPart;
        weightedY += mPart * midY;
        rodEccentricMoment += (mPart + (topY === rod0.y + rod0.sy * 0.5 ? topPayloadKg : 0)) * GRAVITY * Math.abs(rod0.x);
        const fRod = qWind * 0.9 * (rod0.sx * exposedH);
        windForceHoriz += fRod;
        windMoment += fRod * Math.max(0.01, midY - zCut);
      }
    }

    const rawRSupport =
      i === 0 ? c.supportRadiusM : Math.min(c.supportRadiusM, courses[i - 1].supportRadiusM * 1.08);
    // Multi-joint dry-stack P-Delta rocking knockdown (matches real 3D cannon-es multi-body sway!)
    const jointsAbove = n - 1 - i;
    const jointCompliance = Math.max(0.55, 1 - 0.033 * jointsAbove);
    const rSupport = rawRSupport * jointCompliance;
    const zCg = massAbove > 1e-5 ? weightedY / massAbove : zCut + 0.02;
    const hCg = Math.max(0.005, zCg - zCut);

    const shakeMoment = massAbove * GRAVITY * lateralAccelRatio * hCg;
    const impEccM = 0.003 + Math.min(0.0055, (n - i) * 0.0003);
    const imperfectionMoment = massAbove * GRAVITY * impEccM + rodEccentricMoment;

    const ballastBonusNm =
      i === 0 && ballastMassKg > 0 ? ballastMassKg * GRAVITY * cosTilt * Math.max(rSupport, ballastRadiusM) * 0.45 : 0;
    const guyWireBonusNm =
      guyWireMomentNm > 0 && guyWireAttachY > zCut + 0.05
        ? guyWireMomentNm * Math.min(1, (guyWireAttachY - zCut) / Math.max(0.2, guyWireAttachY))
        : 0;
    const restoringMoment =
      massAbove * GRAVITY * cosTilt * rSupport + c.binderMomentNm + ballastBonusNm + guyWireBonusNm;

    const totalDestabilizing = Math.max(1e-5, windMoment + shakeMoment + imperfectionMoment);
    const sf = restoringMoment / totalDestabilizing;

    const horizForce = windForceHoriz + massAbove * GRAVITY * lateralAccelRatio;
    const normalForce = Math.max(0.05, (massAbove + (i === 0 ? ballastMassKg * 0.4 : 0)) * GRAVITY * cosTilt);
    const slideResistance = c.frictionMu * normalForce + (c.binderMomentNm > 0 ? 12 : 0);
    const slideSf = horizForce > 1e-5 ? slideResistance / horizForce : 99;

    // Material Crush / Hollow-Span Bending Check!
    const crushCapKg = c.crushCapacityKg ?? 1800;
    // Load pressing ON top of course `i` is `massAbove - c.massKg` (plus self-weight at bottom of course `i`)
    const loadOnCourseKg = Math.max(0.01, massAbove - c.massKg * 0.5);
    const matSf = crushCapKg / loadOnCourseKg;

    const effectiveSf = Math.min(sf, slideSf, matSf);
    if (slideSf < minSlideSF) minSlideSF = slideSf;
    if (matSf < 1.0 && (crushFailedCourseIndex === null || i < crushFailedCourseIndex)) {
      crushFailedCourseIndex = i;
    }

    if (effectiveSf < minSF || (effectiveSf < 1.0 && failCourseIndex !== null && i < failCourseIndex)) {
      if (effectiveSf < minSF) minSF = effectiveSf;
      if (effectiveSf < 1.0) {
        failCourseIndex = i;
        failElevationM = zCut;
        if (recordJoints) {
          failReason =
            matSf <= sf && matSf <= slideSf
              ? `Quá tải chịu lực vật liệu tại tầng ${i + 1} (${c.courseLabel ?? 'vật mỏng'}): đè ${loadOnCourseKg.toFixed(1)}kg vượt ngưỡng bẹp/uốn ${crushCapKg.toFixed(1)}kg!`
              : slideSf < sf
                ? `Trượt ngang tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do vật nhẹ/trơn gặp gió mạnh!`
                : windMoment >= shakeMoment
                  ? `Đổ lật tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do sức gió vượt mô-men giữ chân đế!`
                  : `Đổ lật tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do tải trọng / độ nghiêng / rung lắc vượt giới hạn!`;
        }
      }
    }

    if (recordJoints) {
      const areaCm2 = Math.max(4, c.bearingAreaCm2 ?? 120);
      const utilPct = Math.min(150, Math.round((1 / Math.max(0.08, effectiveSf)) * 100));
      jointChecks[i] = {
        courseIndex: i,
        elevationM: zCut,
        effectiveRadiusM: rSupport,
        massAboveKg: Number(massAbove.toFixed(2)),
        windMomentNm: windMoment,
        shakeMomentNm: shakeMoment,
        imperfectionMomentNm: imperfectionMoment,
        restoringMomentNm: restoringMoment,
        safetyFactor: Number(effectiveSf.toFixed(2)),
        slidingSafetyFactor: Number(slideSf.toFixed(2)),
        materialSafetyFactor: Number(Math.min(99, matSf).toFixed(2)),
        axialLoadKg: Number(massAbove.toFixed(2)),
        contactStressKgCm2: Number((massAbove / areaCm2).toFixed(3)),
        utilizationPct: utilPct,
        failed: effectiveSf < 1.0,
        failureMode:
          effectiveSf >= 1.0
            ? 'none'
            : matSf <= sf && matSf <= slideSf
              ? 'crush'
              : slideSf < sf
                ? 'slide'
                : 'overturn'
      };
    }
  }

  return {
    jointChecks,
    minSF: Number.isFinite(minSF) ? Number(minSF.toFixed(2)) : 99,
    minSlideSF: Number.isFinite(minSlideSF) ? Number(minSlideSF.toFixed(2)) : 99,
    failCourseIndex,
    failElevationM,
    failReason,
    crushFailedCourseIndex,
    rodEulerLimitKg
  };
}

function buildLoadBearingReport(
  courses: InternalCourseSummary[],
  rodParts: PlacedPart3D[],
  ballastMassKg: number,
  ballastRadiusM: number,
  guyWireMomentNm: number,
  guyWireAttachY: number,
  env: EnvironmentLoadConfig,
  evalRes: ReturnType<typeof evaluateSkeletonStability>
): LoadBearingReport {
  const appliedTopPayloadKg = Math.max(0, env.topPayloadKg ?? 0);
  if (courses.length === 0) {
    return {
      appliedTopPayloadKg,
      maxSafeTopPayloadKg: 0,
      limitingComponent: 'Chưa có vật liệu',
      baseAxialForceN: 0,
      baseTotalWeightKg: 0,
      baseContactAreaCm2: 0,
      groundPressureKgCm2: 0,
      groundVerdict: 'Chưa có tải',
      peakUtilizationPct: 0,
      courseUtilizationPct: [],
      courseRedIntensity: [],
      criticalCourseIndex: 0,
      crushFailedCourseIndex: null
    };
  }

  let lo = 0;
  let hi = 60;
  const zeroCheck = evaluateSkeletonStability(
    courses,
    rodParts,
    ballastMassKg,
    ballastRadiusM,
    guyWireMomentNm,
    guyWireAttachY,
    { ...env, topPayloadKg: 0 },
    false
  );
  let maxSafeTopPayloadKg = 0;
  let limitingComponent = 'Đã quá tải gió/nghiêng ngay cả khi chưa đặt vật nặng';
  if (zeroCheck.minSF >= 1.0) {
    for (let it = 0; it < 11; it++) {
      const mid = (lo + hi) * 0.5;
      const r = evaluateSkeletonStability(
        courses,
        rodParts,
        ballastMassKg,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        { ...env, topPayloadKg: mid },
        false
      );
      if (r.minSF >= 1.05) lo = mid;
      else hi = mid;
    }
    maxSafeTopPayloadKg = Number(lo.toFixed(1));
    const probeOver = evaluateSkeletonStability(
      courses,
      rodParts,
      ballastMassKg,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY,
      { ...env, topPayloadKg: Math.max(lo * 1.2 + 1.5, hi + 1.0) },
      true
    );
    limitingComponent =
      probeOver.failReason?.replace(/!$/, '') ??
      (rodParts.length > 0
        ? `Uốn dọc ngọn ${rodParts[0].itemName} (${evalRes.rodEulerLimitKg.toFixed(1)}kg)`
        : 'Ổn định chống lật toàn tháp (> 60kg)');
  }

  const baseAxialKg = (evalRes.jointChecks[0]?.massAboveKg ?? 0) + ballastMassKg;
  const baseForceN = Number((baseAxialKg * GRAVITY).toFixed(1));
  const coreAreaCm2 = courses[0]?.bearingAreaCm2 ?? 144;
  const totalBaseAreaCm2 = Math.max(16, Math.round(coreAreaCm2));
  const groundPressureKgCm2 = Number((baseAxialKg / totalBaseAreaCm2).toFixed(3));
  const groundVerdict =
    groundPressureKgCm2 <= 0.35
      ? 'Đất rừng ẩm / cỏ mềm chịu tốt, không lo lún lệch'
      : groundPressureKgCm2 <= 0.85
        ? 'Đất nện đường mòn chịu ổn (tránh đặt trên bùn xốp)'
        : 'Áp lực chân khá lớn — nên lót đá dẹt / tấm ván dưới tầng 1 chống lún!';

  const courseUtilizationPct = evalRes.jointChecks.map((jc) => jc?.utilizationPct ?? 0);
  const peakUtilizationPct =
    courseUtilizationPct.length > 0 ? Math.max(...courseUtilizationPct) : 0;

  // Red Load-Bearing Zone intensity (0..100):
  // Highlights foundation courses bearing heavy vertical compression, narrow bottle/pillar necks,
  // hollow-span plates/baskets, and overturning bottlenecks in vivid RED!
  const maxCourseAxialKg = Math.max(
    0.5,
    ...evalRes.jointChecks.map((jc) => jc?.axialLoadKg ?? 0)
  );
  let criticalCourseIndex = 0;
  let bestCritScore = -Infinity;
  const courseRedIntensity: number[] = evalRes.jointChecks.map((jc, idx) => {
    if (!jc) return 0;
    const uRatio = (jc.utilizationPct ?? 0) / 100;
    const axialShare = (jc.axialLoadKg ?? 0) / maxCourseAxialKg;
    const matRatio = 1 / Math.max(0.08, jc.materialSafetyFactor ?? 99);
    const sfPeakRatio = evalRes.minSF / Math.max(0.08, jc.safetyFactor);
    const contactPressureBoost = Math.min(1, (jc.contactStressKgCm2 ?? 0) / 0.11);

    const critScore =
      uRatio * 1.15 + axialShare * 0.65 + matRatio * 1.4 + sfPeakRatio * 0.55 + contactPressureBoost * 0.35;
    if (critScore > bestCritScore) {
      bestCritScore = critScore;
      criticalCourseIndex = idx;
    }

    const raw = Math.max(
      uRatio,
      axialShare >= 0.76 ? 0.72 + (axialShare - 0.76) * 1.1 : axialShare * 0.74,
      sfPeakRatio >= 0.88 ? 0.76 + (sfPeakRatio - 0.88) * 1.6 : sfPeakRatio * 0.55,
      matRatio * 1.45,
      contactPressureBoost * 0.82
    );
    return Math.max(0, Math.min(100, Math.round(raw * 100)));
  });

  if (courseRedIntensity.length > 0) {
    courseRedIntensity[criticalCourseIndex] = Math.max(88, courseRedIntensity[criticalCourseIndex]);
  }

  return {
    appliedTopPayloadKg,
    maxSafeTopPayloadKg,
    limitingComponent,
    baseAxialForceN: baseForceN,
    baseTotalWeightKg: Number(baseAxialKg.toFixed(2)),
    baseContactAreaCm2: totalBaseAreaCm2,
    groundPressureKgCm2,
    groundVerdict,
    peakUtilizationPct,
    courseUtilizationPct,
    courseRedIntensity,
    criticalCourseIndex,
    crushFailedCourseIndex: evalRes.crushFailedCourseIndex
  };
}

export function evaluateTowerUnderLoad(sol: TowerSolution, env: EnvironmentLoadConfig): TowerSolution {
  if (sol.courseCount === 0 && sol.parts.length === 0) return sol;
  const sk = sol._skeleton;
  const evalRes = evaluateSkeletonStability(
    sk.courses,
    sk.rodParts,
    sk.ballastMassKg,
    sk.ballastRadiusM,
    sk.guyWireMomentNm,
    sk.guyWireAttachY,
    env,
    true
  );
  const loadReport = buildLoadBearingReport(
    sk.courses,
    sk.rodParts,
    sk.ballastMassKg,
    sk.ballastRadiusM,
    sk.guyWireMomentNm,
    sk.guyWireAttachY,
    env,
    evalRes
  );
  return {
    ...sol,
    minSafetyFactor: evalRes.minSF,
    minSlidingFactor: evalRes.minSlideSF,
    standing: evalRes.minSF >= 1.0,
    failCourseIndex: evalRes.failCourseIndex,
    failElevationM: evalRes.failElevationM,
    failReason: evalRes.failReason,
    jointChecks: evalRes.jointChecks,
    loadReport
  };
}

interface TaperedBlueprint {
  tiers: { pattern: CoursePattern; orient: BlockOrient; maxCourses: number }[];
  stoolPos?: 'base' | 'upper';
  elevateHeavyCyls?: boolean;
  reserveCapBricks?: number;
  preferChimneySpire?: boolean;
}

interface FastBuildOutcome {
  valid: boolean;
  heightCm: number;
  minSF: number;
  keptCrownCyls: number;
  keptRod: boolean;
  elevatedHeavyCount: number;
  usedBlocks: number;
  solution?: TowerSolution;
}

/**
 * Unified Vertical-Stacking Structural Builder:
 * - ZERO single-brick vertical domino/totem stacks (Screenshots 1 & 2 banned!)
 * - ZERO bricks wasted lying around the base on the ground (Screenshot 3 banned — all bricks stack UP for height!)
 * - Elevates heavy water bottles ("2 cái cục kia") UP onto the tower as Twin/Tripod/Quad-Pillar portal frames!
 * - Integrates Backless Plastic Stools (stool, 95kg capacity) & Inverted Plastic Baskets (basket, 9.5kg capacity)
 */
function buildTowerFromBlueprint(
  inventory: TowerInventoryItem[],
  pools: SortedPools,
  bp: TaperedBlueprint,
  mode: TowerBuildMode,
  env: EnvironmentLoadConfig,
  targetSF: number,
  materializeParts: boolean,
  maxCrownCylsCap = 999,
  allowRod = true
): FastBuildOutcome {
  const usedCounts = materializeParts ? new Map<string, number>() : null;
  const addUsed = (id: string, n = 1) => {
    if (usedCounts) usedCounts.set(id, (usedCounts.get(id) ?? 0) + n);
  };

  const hasLongRope = pools.binders.some((b) => b.lengthCm >= 180);
  const hasAnyBinder = pools.binders.length > 0;
  let availableBands = Math.max(0, pools.binders.length * 2 - (hasLongRope ? 2 : 0));

  const courses: InternalCourseSummary[] = [];
  const allParts: PlacedPart3D[] = [];
  const steps: BuildStepGuide[] = [];

  let yCursor = 0;
  let blockCursor = 0;
  let plateCursor = 0;
  let stoolCursor = 0;
  let basketCursor = 0;
  let elevatedHeavyCount = 0;
  const unElevatedHeavyCyls: TowerInventoryItem[] = [];

  const failOut = (): FastBuildOutcome => ({
    valid: false,
    heightCm: 0,
    minSF: 0,
    keptCrownCyls: 0,
    keptRod: false,
    elevatedHeavyCount: 0,
    usedBlocks: 0
  });

  const placePlateCourse = (reason: string): boolean => {
    if (plateCursor >= pools.plates.length) return false;
    const pl = pools.plates[plateCursor++];
    addUsed(pl.id, 1);
    const sx = pl.lengthCm * 0.01;
    const sz = pl.widthCm * 0.01;
    const sy = Math.max(0.006, pl.heightCm * 0.01);
    const cIdx = courses.length;
    const holeSpanCm = cIdx > 0 ? courses[cIdx - 1].clearHoleRadiusM * 200 : 0;
    const plateCrushKg =
      holeSpanCm > 2.0
        ? Math.max(
            3.5,
            ((Math.min(pl.lengthCm, pl.widthCm) * Math.pow(Math.max(0.5, pl.heightCm), 1.65)) / holeSpanCm) * 3.8
          )
        : 65;
    if (cIdx > 0) courses[cIdx - 1].supportRadiusM *= 1.12;
    const prevR = cIdx > 0 ? courses[cIdx - 1].supportRadiusM : Math.min(sx, sz) * 0.45;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: sy,
      supportRadiusM: Math.min(Math.min(sx, sz) * 0.46, prevR * 1.22),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: Math.hypot(sx * 0.5, sz * 0.5),
      windWidthM: Math.max(sx, sz),
      dragCoeff: 1.15,
      massKg: pl.massKg,
      frictionMu: pl.frictionMu ?? 0.52,
      binderMomentNm: 0.8,
      bearingAreaCm2: pl.lengthCm * pl.widthCm * 0.5,
      crushCapacityKg: plateCrushKg,
      courseLabel: pl.name
    });
    if (materializeParts) {
      allParts.push({
        id: `plate-${cIdx}`,
        courseIndex: cIdx,
        itemName: pl.name,
        kind: 'plate',
        roleLabel: reason,
        color: pl.color,
        x: 0,
        y: yCursor + sy * 0.5,
        z: 0,
        sx,
        sy,
        sz,
        rotY: 0,
        frictionMu: pl.frictionMu ?? 0.52,
        massKg: pl.massKg
      });
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [cIdx, cIdx],
        title: `Đặt "${pl.name}" khóa mặt phẳng`,
        detail: `${reason} — phân tán đều lực nén lên các trụ bên dưới.`,
        heightReachedCm: Number(((yCursor + sy) * 100).toFixed(1))
      });
    }
    yCursor += sy;
    return true;
  };

  const placeStoolCourse = (st: TowerInventoryItem, roleDesc: string): boolean => {
    const sx = st.lengthCm * 0.01;
    const sz = st.widthCm * 0.01;
    const sy = st.heightCm * 0.01;
    const cIdx = courses.length;
    if (cIdx > 0) {
      const prevSupport = courses[cIdx - 1].supportRadiusM;
      // All 4 corner legs of the stool must land on a wide ring4 / plate platform (never overhang narrow 2-brick crib2!)
      if (prevSupport < Math.min(sx, sz) * 0.38) return false;
    }
    addUsed(st.id, 1);
    const seatR = Math.min(sx, sz) * 0.45;
    const prevR = cIdx > 0 ? courses[cIdx - 1].supportRadiusM : seatR;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: sy,
      supportRadiusM: cIdx === 0 ? seatR : Math.min(seatR, prevR * 1.08),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: Math.hypot(sx * 0.5, sz * 0.5),
      windWidthM: Math.max(sx, sz),
      dragCoeff: 0.44,
      massKg: st.massKg,
      frictionMu: st.frictionMu ?? 0.58,
      binderMomentNm: 0.4,
      bearingAreaCm2: st.lengthCm * st.widthCm * 0.36,
      crushCapacityKg: 95,
      courseLabel: st.name
    });
    if (materializeParts) {
      allParts.push({
        id: `stool-${cIdx}`,
        courseIndex: cIdx,
        itemName: st.name,
        kind: 'stool',
        roleLabel: roleDesc,
        color: st.color,
        x: 0,
        y: yCursor + sy * 0.5,
        z: 0,
        sx,
        sy,
        sz,
        rotY: 0,
        frictionMu: st.frictionMu ?? 0.58,
        massKg: st.massKg
      });
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [cIdx, cIdx],
        title: `Đặt "${st.name}" (+${st.heightCm}cm)`,
        detail: `${roleDesc} (khung 4 chân thoáng gió, chịu tải nén tới 95kg).`,
        heightReachedCm: Number(((yCursor + sy) * 100).toFixed(1))
      });
    }
    yCursor += sy;
    return true;
  };

  const placeBasketCourse = (bk: TowerInventoryItem, roleDesc: string): boolean => {
    const sx = bk.lengthCm * 0.01;
    const sz = bk.widthCm * 0.01;
    const sy = bk.heightCm * 0.01;
    const cIdx = courses.length;
    if (cIdx > 0) {
      const prevOuter = courses[cIdx - 1].maxOuterRadiusM;
      if (prevOuter < Math.min(sx, sz) * 0.25) return false;
    }
    addUsed(bk.id, 1);
    const topDeckR = Math.min(sx, sz) * 0.38;
    const prevR = cIdx > 0 ? courses[cIdx - 1].supportRadiusM : topDeckR;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: sy,
      supportRadiusM: cIdx === 0 ? topDeckR : Math.min(topDeckR, prevR * 1.15),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: Math.hypot(sx * 0.5, sz * 0.5),
      windWidthM: Math.max(sx, sz),
      dragCoeff: 0.52,
      massKg: bk.massKg,
      frictionMu: bk.frictionMu ?? 0.5,
      binderMomentNm: 0.3,
      bearingAreaCm2: bk.lengthCm * bk.widthCm * 0.28,
      crushCapacityKg: 9.5,
      courseLabel: bk.name
    });
    if (materializeParts) {
      allParts.push({
        id: `basket-${cIdx}`,
        courseIndex: cIdx,
        itemName: bk.name,
        kind: 'basket',
        roleLabel: roleDesc,
        color: bk.color,
        x: 0,
        y: yCursor + sy * 0.5,
        z: 0,
        sx,
        sy,
        sz,
        rotY: 0,
        frictionMu: bk.frictionMu ?? 0.5,
        massKg: bk.massKg
      });
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [cIdx, cIdx],
        title: `Úp ngược "${bk.name}" (+${bk.heightCm}cm)`,
        detail: `${roleDesc} — vành miệng rộng bám nền dưới, đáy phẳng hướng lên đỡ tầng ngọn (chịu nén tối đa 9.5kg).`,
        heightReachedCm: Number(((yCursor + sy) * 100).toFixed(1))
      });
    }
    yCursor += sy;
    return true;
  };

  const placeBridgeBricksCourse = (brickLimitIdx: number, reason: string): boolean => {
    if (blockCursor + 2 > brickLimitIdx) return false;
    const ref = pools.blocks[blockCursor];
    const { lM, tM } = getBlockDimsForOrient(ref, 'flat');
    if (!isPatternPhysicallyValid('crib2_bridge', lM, tM)) return false;
    const cIdx = courses.length;
    const c = computeCourseMetricsOnly(cIdx, yCursor, pools.blocks, blockCursor, 2, 'crib2_bridge', 'flat', false);
    if (materializeParts) {
      const slice = pools.blocks.slice(blockCursor, blockCursor + 2);
      slice.forEach((b) => addUsed(b.id, 1));
      allParts.push(...materializeBlockParts(cIdx, yCursor, slice, 'crib2_bridge', 'flat'));
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [cIdx, cIdx],
        title: 'Khép 2 viên gạch nằm sát tâm làm sàn đặc',
        detail: reason,
        heightReachedCm: Number(((yCursor + c.heightM) * 100).toFixed(1))
      });
    }
    blockCursor += 2;
    courses.push(c);
    yCursor += c.heightM;
    return true;
  };

  // ================= STAGE 1: Optional Base Stool Pedestal =================
  let lastMasonrySupportR = Infinity;
  if (bp.stoolPos === 'base' && stoolCursor < pools.stools.length) {
    while (stoolCursor < pools.stools.length) {
      const st = pools.stools[stoolCursor];
      if (!placeStoolCourse(st, 'Bệ ghế đẩu 4 chân làm móng cao vượt trội')) break;
      stoolCursor++;
      lastMasonrySupportR = courses[courses.length - 1].supportRadiusM;
      if (pools.blocks.length > 0) break;
    }
  }

  // ================= STAGE 2: Multi-Brick Interlocking Masonry =================
  const wantElevateHeavy =
    bp.elevateHeavyCyls !== false && !bp.preferChimneySpire && pools.heavyCyls.length > 0;
  const reserveForCap = Math.max(0, bp.reserveCapBricks ?? 0);
  const masonryBrickLimit = Math.max(0, pools.blocks.length - reserveForCap);

  for (let t = 0; t < bp.tiers.length; t++) {
    const tier = bp.tiers[t];
    if (blockCursor >= masonryBrickLimit) break;
    const ref = pools.blocks[blockCursor];
    const { lM, tM } = getBlockDimsForOrient(ref, tier.orient);
    if (!isPatternPhysicallyValid(tier.pattern, lM, tM)) return failOut();

    if (tier.pattern === 'single1' && pools.blocks.length >= 2) {
      if (tier.orient !== 'flat' || tier.maxCourses > 1) return failOut();
    }
    if ((tier.pattern === 'crib2' || tier.pattern === 'crib2_bridge') && tier.orient === 'upright') {
      return failOut();
    }

    const prevPat = t > 0 ? bp.tiers[t - 1].pattern : null;
    const probeMetrics = computeCourseMetricsOnly(0, 0, pools.blocks, blockCursor, 1, tier.pattern, tier.orient, false);
    if (prevPat !== 'crib2_bridge' && probeMetrics.supportRadiusM > lastMasonrySupportR * 1.06) {
      return failOut();
    }
    if (tier.pattern !== 'crib2_bridge') {
      lastMasonrySupportR = probeMetrics.supportRadiusM;
    }

    const prevTopHole = courses.length > 0 ? courses[courses.length - 1].clearHoleRadiusM : 0;
    if (
      prevTopHole > 0.01 &&
      ((prevPat === 'ring4' && tier.pattern === 'tri3') || (prevPat === 'tri3' && tier.pattern === 'crib2'))
    ) {
      const sparePlates = pools.plates.length - plateCursor - (wantElevateHeavy && pools.heavyCyls.length >= 2 ? 1 : 0);
      if (sparePlates > 0 && placePlateCourse('Khóa mặt phẳng chuyển hệ 4 viên sang 3 viên')) {
        // bridged via plate
      } else if (tier.pattern === 'crib2' && placeBridgeBricksCourse(masonryBrickLimit, 'Khép sàn gạch chuyển bậc')) {
        // bridged via 2 flat bricks!
      } else {
        return failOut();
      }
    }

    if (tier.pattern === 'single1') {
      if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM * 2 > Math.min(lM, tM) * 0.36) {
        if (!placeBridgeBricksCourse(pools.blocks.length, 'Khép sàn 2 viên đỡ viên gạch khóa đỉnh')) {
          if (!placePlateCourse('Che kín miệng giếng trước khi đặt viên khóa đỉnh')) break;
        }
      }
    }

    const nNeed =
      tier.pattern === 'ring4'
        ? 4
        : tier.pattern === 'tri3'
          ? 3
          : tier.pattern === 'crib2' || tier.pattern === 'crib2_bridge'
            ? 2
            : 1;
    const effectiveMaxCourses =
      tier.pattern === 'single1'
        ? 1
        : tier.orient === 'upright'
          ? Math.min(tier.maxCourses, tier.pattern === 'ring4' ? 2 : 1)
          : tier.maxCourses;

    let built = 0;
    const startCourse = courses.length;
    while (built < effectiveMaxCourses && blockCursor + nNeed <= masonryBrickLimit) {
      const useBand = tier.orient === 'upright' && availableBands > pools.lightCyls.length;
      if (useBand) availableBands--;
      const c = computeCourseMetricsOnly(
        courses.length,
        yCursor,
        pools.blocks,
        blockCursor,
        nNeed,
        tier.pattern,
        tier.orient,
        useBand
      );
      if (materializeParts) {
        const slice = pools.blocks.slice(blockCursor, blockCursor + nNeed);
        slice.forEach((b) => addUsed(b.id, 1));
        allParts.push(...materializeBlockParts(courses.length, yCursor, slice, tier.pattern, tier.orient));
      }
      blockCursor += nNeed;
      courses.push(c);
      yCursor += c.heightM;
      built++;
    }

    if (materializeParts && built > 0) {
      const oriName =
        tier.orient === 'flat' ? 'nằm bệt' : tier.orient === 'edge' ? 'nằm nghiêng cạnh' : 'dựng đứng';
      const patDesc =
        tier.pattern === 'ring4'
          ? 'Giếng vuông cánh quạt 4 viên (xoay đảo mạch mỗi tầng)'
          : tier.pattern === 'tri3'
            ? 'Kiềng tam giác đều 3 viên (xoay lệch 60° mỗi tầng)'
            : tier.pattern === 'crib2_bridge'
              ? 'Sàn 2 viên khép sát tâm làm bệ đỡ đặc'
              : tier.pattern === 'crib2'
                ? 'Đan chữ thập 2 viên song song (xoay 90° qua lại khóa mạch)'
                : 'Viên gạch nằm ngang khóa đỉnh';
      const stageName = t === 0 && courses[0]?.courseIndex === startCourse ? 'Móng chân đế' : `Thân gạch đợt ${t + 1}`;
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [startCourse, courses.length - 1],
        title: `${stageName}: ${built} tầng × ${nNeed} viên (${oriName})`,
        detail: `Xếp kiểu ${patDesc}.`,
        heightReachedCm: Number((yCursor * 100).toFixed(1))
      });
    }
  }

  // ================= STAGE 3: Optional Upper Stool Booster =================
  if (bp.stoolPos !== 'base' && stoolCursor < pools.stools.length && !bp.preferChimneySpire) {
    while (stoolCursor < pools.stools.length) {
      const st = pools.stools[stoolCursor];
      if (!placeStoolCourse(st, 'Đặt ghế nhựa không dựa chồng lên mặt tháp gạch để vươn cao +30cm')) break;
      stoolCursor++;
    }
  }

  // ================= STAGE 3.5: Inverted Plastic Baskets (Ro nhua up nguoc 30x30cm — wide base BELOW narrow bottles!) =================
  if (!bp.preferChimneySpire && basketCursor < pools.baskets.length) {
    while (basketCursor < pools.baskets.length) {
      if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM > 0.015) {
        if (!placeBridgeBricksCourse(pools.blocks.length, 'Khép sàn 2 viên trước khi úp rổ nhựa')) {
          placePlateCourse('Che kín miệng giếng trước khi úp rổ nhựa');
        }
      }
      const bk = pools.baskets[basketCursor];
      if (!placeBasketCourse(bk, 'Úp ngược rổ nhựa (vành rộng 30cm bám nền, đáy phẳng hướng lên đỡ tầng chai/ngọn)')) {
        break;
      }
      basketCursor++;
    }
  }

  // ================= STAGE 4: Elevate Heavy Cylinders ("Đưa 2 cục chai nước lên tháp!") =================
  const singleCrownHeavyQueue: TowerInventoryItem[] = [];
  if (wantElevateHeavy) {
    let hcIdx = 0;
    while (hcIdx < pools.heavyCyls.length) {
      const lead = pools.heavyCyls[hcIdx];
      const group: TowerInventoryItem[] = [lead];
      while (
        hcIdx + group.length < pools.heavyCyls.length &&
        group.length < 4 &&
        Math.abs(pools.heavyCyls[hcIdx + group.length].heightCm - lead.heightCm) <= 1.0 &&
        Math.abs(pools.heavyCyls[hcIdx + group.length].widthCm - lead.widthCm) <= 1.5
      ) {
        group.push(pools.heavyCyls[hcIdx + group.length]);
      }

      if (group.length >= 2) {
        const k = group.length;
        const dM = lead.widthCm * 0.01;
        const hM = lead.heightCm * 0.01;
        const offset =
          k === 4
            ? Math.max(dM * 0.5 + 0.009, 0.044)
            : k === 3
              ? Math.max(dM * 0.62, 0.046)
              : Math.max(dM * 0.5 + 0.011, 0.044);
        const neededOuterM = offset + dM * 0.5;

        if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM > 0.008) {
          if (!placeBridgeBricksCourse(pools.blocks.length, 'Khép kín mặt sàn gạch để dựng hệ trụ chai nước bên trên')) {
            if (pools.plates.length - plateCursor >= 2 || basketCursor < pools.baskets.length || blockCursor < pools.blocks.length) {
              placePlateCourse('Lót sàn phẳng đỡ hệ trụ chai nước');
            }
          }
        }

        const deckClearHole = courses.length > 0 ? courses[courses.length - 1].clearHoleRadiusM : 0;
        const deckSupportR = courses.length > 0 ? courses[courses.length - 1].supportRadiusM : neededOuterM;
        if (deckClearHole <= 0.01 && (courses.length === 0 || deckSupportR >= neededOuterM * 0.75)) {
          const cIdx = courses.length;
          const totalMass = group.reduce((s, it) => s + it.massKg, 0);
          const singleCrush = lead.massKg < 0.12 ? 7.5 : lead.massKg < 0.42 ? 24 : 38;
          const stageSupportR =
            k === 4
              ? offset + dM * 0.38
              : k === 3
                ? offset * 0.72 + dM * 0.35
                : Math.min(offset + dM * 0.35, dM * 0.5 * 1.65);

          courses.push({
            courseIndex: cIdx,
            yBottom: yCursor,
            heightM: hM,
            supportRadiusM: courses.length === 0 ? stageSupportR : Math.min(stageSupportR, deckSupportR * 1.05),
            clearHoleRadiusM: 0,
            maxOuterRadiusM: neededOuterM,
            windWidthM: k === 2 ? dM * 1.75 : dM * 2.1,
            dragCoeff: 0.82,
            massKg: totalMass,
            frictionMu: lead.frictionMu ?? 0.38,
            binderMomentNm: 0,
            bearingAreaCm2: k * Math.PI * Math.pow(lead.widthCm * 0.5, 2),
            crushCapacityKg: k * singleCrush,
            courseLabel: `Hệ ${k} trụ ${lead.name}`
          });

          if (materializeParts) {
            const coords: [number, number][] =
              k === 4
                ? [
                    [-offset, -offset],
                    [offset, -offset],
                    [-offset, offset],
                    [offset, offset]
                  ]
                : k === 3
                  ? [0, 1, 2].map((idx) => [
                      Math.cos((idx * 2 * Math.PI) / 3) * offset,
                      Math.sin((idx * 2 * Math.PI) / 3) * offset
                    ])
                  : [
                      [-offset, 0],
                      [offset, 0]
                    ];
            for (let gi = 0; gi < k; gi++) {
              addUsed(group[gi].id, 1);
              allParts.push({
                id: `pillar-cyl-${cIdx}-${gi}`,
                courseIndex: cIdx,
                itemName: group[gi].name,
                kind: 'cylinder',
                roleLabel: `Hệ ${k} cột trụ song song đưa lên thân tháp (+${lead.heightCm}cm)`,
                color: group[gi].color,
                x: coords[gi][0],
                y: yCursor + hM * 0.5,
                z: coords[gi][1],
                sx: dM,
                sy: hM,
                sz: dM,
                rotY: 0,
                frictionMu: group[gi].frictionMu ?? 0.38,
                massKg: group[gi].massKg
              });
            }
            steps.push({
              stepNumber: steps.length + 1,
              courseRange: [cIdx, cIdx],
              title: `Đưa ${k} "${lead.name}" lên làm tầng cột trụ (+${lead.heightCm}cm)`,
              detail:
                k === 2
                  ? `Dựng đứng song song 2 chai cách tâm ±${(offset * 100).toFixed(1)}cm trên sàn gạch đặc để ăn trọn +${lead.heightCm}cm chiều cao!`
                  : `Xếp ${k} trụ đối xứng trên sàn phẳng tạo hệ cột chịu nén ${(k * singleCrush).toFixed(0)}kg.`,
              heightReachedCm: Number(((yCursor + hM) * 100).toFixed(1))
            });
          }

          yCursor += hM;
          hcIdx += k;
          elevatedHeavyCount += k;

          // Cap the top of the multi-cylinder pillars so the roof plate locks both bottles into a portal arch!
          if (plateCursor < pools.plates.length) {
            placePlateCourse(`Bắc phẳng qua đầu ${k} trụ ${lead.name} khóa thành khung cổng vững chắc`);
          } else if (basketCursor < pools.baskets.length) {
            placeBasketCourse(pools.baskets[basketCursor++], `Úp ngược khóa đầu ${k} trụ ${lead.name}`);
          } else if (blockCursor < pools.blocks.length) {
            const lintelRef = pools.blocks[blockCursor];
            const { lM, tM, hM: bhM } = getBlockDimsForOrient(lintelRef, 'flat');
            if (lM >= neededOuterM * 1.92) {
              const lcIdx = courses.length;
              addUsed(lintelRef.id, 1);
              courses.push({
                courseIndex: lcIdx,
                yBottom: yCursor,
                heightM: bhM,
                supportRadiusM: Math.min(courses[lcIdx - 1].supportRadiusM, tM * 0.48),
                clearHoleRadiusM: 0,
                maxOuterRadiusM: Math.hypot(lM * 0.5, tM * 0.5),
                windWidthM: lM,
                dragCoeff: 1.18,
                massKg: lintelRef.massKg,
                frictionMu: lintelRef.frictionMu ?? 0.62,
                binderMomentNm: 0,
                bearingAreaCm2: lM * tM * 10000,
                crushCapacityKg: 1400,
                courseLabel: `Đà ngang ${lintelRef.name}`
              });
              if (materializeParts) {
                allParts.push({
                  id: `lintel-${lcIdx}`,
                  courseIndex: lcIdx,
                  itemName: lintelRef.name,
                  kind: 'block',
                  roleLabel: `Đà ngang bắc qua đầu ${k} trụ chai nước (kiểu cổng đá)`,
                  color: lintelRef.color,
                  x: 0,
                  y: yCursor + bhM * 0.5,
                  z: 0,
                  sx: lM,
                  sy: bhM,
                  sz: tM,
                  rotY: 0,
                  frictionMu: lintelRef.frictionMu ?? 0.62,
                  massKg: lintelRef.massKg
                });
                steps.push({
                  stepNumber: steps.length + 1,
                  courseRange: [lcIdx, lcIdx],
                  title: `Gác 1 "${lintelRef.name}" nằm ngang khóa đầu ${k} chai nước`,
                  detail: 'Đặt viên gạch nằm ngang 18cm đè đều lên cả 2 nắp chai tạo khung cổng chịu lực.',
                  heightReachedCm: Number(((yCursor + bhM) * 100).toFixed(1))
                });
              }
              blockCursor++;
              yCursor += bhM;
            }
          }
          continue;
        }
      }

      singleCrownHeavyQueue.push(lead);
      hcIdx++;
    }
  } else {
    unElevatedHeavyCyls.push(...pools.heavyCyls);
  }

  // ================= STAGE 5: Inverted Plastic Baskets (Ro nhua up nguoc) & Light Upper Crown =================
  // Golden Structural Rule ("Nặng dưới - Nhẹ trên"):
  // Heavy clay bricks NEVER perch above narrow plastic water bottles or lightweight baskets!
  if (!bp.preferChimneySpire) {
    if (elevatedHeavyCount === 0) {
      while (
        blockCursor + 2 <= pools.blocks.length &&
        courses.length > 0 &&
        courses[courses.length - 1].clearHoleRadiusM <= 0.01 &&
        courses[courses.length - 1].supportRadiusM >= 0.048
      ) {
        if (!placeBridgeBricksCourse(pools.blocks.length, 'Xếp chồng tiếp 2 viên gạch nằm phẳng lên trên để tăng tối đa chiều cao')) {
          break;
        }
      }
    }

    // Place Inverted Plastic Baskets (Ro nhua up nguoc) near the top where load above is light!
    while (basketCursor < pools.baskets.length) {
      if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM > 0.015) {
        if (!placePlateCourse('Che kín miệng giếng trước khi úp rổ nhựa')) {
          if (elevatedHeavyCount === 0) {
            placeBridgeBricksCourse(pools.blocks.length, 'Khép sàn 2 viên trước khi úp rổ nhựa');
          }
        }
      }
      const bk = pools.baskets[basketCursor];
      if (!placeBasketCourse(bk, 'Úp ngược rổ nhựa làm tầng đôn nhẹ trên cao')) break;
      basketCursor++;
    }

    // Final single flat capstone brick ONLY when resting on solid bricks/stool (NEVER on plastic bottles or baskets!)
    if (
      elevatedHeavyCount === 0 &&
      basketCursor === 0 &&
      blockCursor < pools.blocks.length &&
      courses.length > 0 &&
      courses[courses.length - 1].clearHoleRadiusM <= 0.01 &&
      courses[courses.length - 1].supportRadiusM >= 0.038
    ) {
      const capB = pools.blocks[blockCursor++];
      addUsed(capB.id, 1);
      const { lM, tM, hM } = getBlockDimsForOrient(capB, 'flat');
      const topSupportR = courses[courses.length - 1].supportRadiusM;
      const cIdx = courses.length;
      courses.push({
        courseIndex: cIdx,
        yBottom: yCursor,
        heightM: hM,
        supportRadiusM: Math.min(topSupportR, tM * 0.48),
        clearHoleRadiusM: 0,
        maxOuterRadiusM: Math.hypot(lM * 0.5, tM * 0.5),
        windWidthM: (lM + tM) * 0.5,
        dragCoeff: 1.18,
        massKg: capB.massKg,
        frictionMu: capB.frictionMu ?? 0.62,
        binderMomentNm: 0,
        bearingAreaCm2: lM * tM * 10000,
        crushCapacityKg: 1400,
        courseLabel: `Viên khóa đỉnh ${capB.name}`
      });
      if (materializeParts) {
        allParts.push({
          id: `cap-block-${cIdx}`,
          courseIndex: cIdx,
          itemName: capB.name,
          kind: 'block',
          roleLabel: 'Viên gạch nằm bệt khóa đỉnh (tối đa 1 viên đơn)',
          color: capB.color,
          x: 0,
          y: yCursor + hM * 0.5,
          z: 0,
          sx: lM,
          sy: hM,
          sz: tM,
          rotY: 0,
          frictionMu: capB.frictionMu ?? 0.62,
          massKg: capB.massKg
        });
        steps.push({
          stepNumber: steps.length + 1,
          courseRange: [cIdx, cIdx],
          title: `Đặt 1 "${capB.name}" nằm bệt khóa đỉnh (+${(hM * 100).toFixed(0)}cm)`,
          detail: 'Đặt viên gạch cuối cùng nằm ngang chính tâm trên đỉnh để ăn trọn chiều cao.',
          heightReachedCm: Number(((yCursor + hM) * 100).toFixed(1))
        });
      }
      yCursor += hM;
    }
  }

  while (stoolCursor < pools.stools.length && courses.length === 0) {
    if (!placeStoolCourse(pools.stools[stoolCursor++], 'Đặt ghế nhựa làm thân tháp')) break;
  }
  while (basketCursor < pools.baskets.length && !bp.preferChimneySpire && courses.length === 0) {
    if (!placeBasketCourse(pools.baskets[basketCursor++], 'Úp ngược rổ nhựa làm bệ')) break;
  }

  let baseBallastMass = 0;
  for (const b of pools.ballasts) baseBallastMass += b.massKg;
  for (const uh of unElevatedHeavyCyls) baseBallastMass += uh.massKg;
  let ballastRadiusM = (courses[0]?.supportRadiusM ?? 0.1) + 0.06;
  const guyWireMomentNm = hasLongRope && courses.length >= 3 ? 18.5 : 0;
  const baseMasonryY = yCursor;
  const guyWireAttachY = guyWireMomentNm > 0 ? baseMasonryY * 0.68 : 0;

  let rodOnlyHeightCm = -1;
  let rodOnlySF = 0;
  if (!materializeParts && allowRod && pools.rods.length > 0 && courses.length > 0) {
    const directRod = resolveSpireRodPlacement(courses, pools.rods[0], hasAnyBinder);
    if (directRod) {
      const rCheck = evaluateSkeletonStability(
        courses,
        [directRod],
        baseBallastMass,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        env,
        false
      );
      if (rCheck.minSF >= targetSF) {
        rodOnlyHeightCm = Math.max(yCursor, directRod.y + directRod.sy * 0.5) * 100;
        rodOnlySF = rCheck.minSF;
      }
    }
  }

  // ================= STAGE 6: Crown Cylinders =================
  const crownQueue = [...singleCrownHeavyQueue, ...pools.lightCyls];
  let keptCrownCyls = 0;
  const cylStartCourse = courses.length;
  for (let ci = 0; ci < crownQueue.length && keptCrownCyls < maxCrownCylsCap; ci++) {
    const cyl = crownQueue[ci];
    if (keptCrownCyls >= 1 && availableBands <= 0) {
      if (cyl.massKg >= 0.25) unElevatedHeavyCyls.push(cyl);
      continue;
    }
    const dM = cyl.widthCm * 0.01;
    const hM = cyl.heightCm * 0.01;
    if (dM * 0.42 < 0.02) continue;
    if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM * 2 > dM * 0.35) {
      if (!placePlateCourse('Che kín miệng giếng trước khi đặt chai lên đỉnh')) {
        if (cyl.massKg >= 0.25) unElevatedHeavyCyls.push(cyl);
        break;
      }
    }
    const prevR = courses.length > 0 ? courses[courses.length - 1].supportRadiusM : dM * 0.45;
    const useTape = availableBands > 0;
    const cIdx = courses.length;
    const candCourse: InternalCourseSummary = {
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: hM,
      supportRadiusM: Math.min(dM * 0.44, prevR),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: dM * 0.5,
      windWidthM: dM,
      dragCoeff: 0.85,
      massKg: cyl.massKg,
      frictionMu: useTape ? 0.65 : (cyl.frictionMu ?? 0.36),
      binderMomentNm: useTape ? 2.6 : 0,
      bearingAreaCm2: Math.PI * Math.pow(cyl.widthCm * 0.5, 2),
      crushCapacityKg: cyl.massKg < 0.12 ? 7.5 : cyl.massKg < 0.42 ? 24 : 38,
      courseLabel: cyl.name
    };
    courses.push(candCourse);
    if (!materializeParts) {
      const check = evaluateSkeletonStability(
        courses,
        [],
        baseBallastMass,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        env,
        false
      );
      if (check.minSF >= targetSF) {
        if (useTape) availableBands--;
        yCursor += hM;
        keptCrownCyls++;
        if (cyl.massKg >= 0.25) elevatedHeavyCount++;
      } else {
        courses.pop();
        if (cyl.massKg >= 0.25) unElevatedHeavyCyls.push(cyl);
        break;
      }
    } else {
      addUsed(cyl.id, 1);
      if (useTape) availableBands--;
      allParts.push({
        id: `crown-cyl-${cIdx}`,
        courseIndex: cIdx,
        itemName: cyl.name,
        kind: 'cylinder',
        roleLabel: useTape ? 'Trụ nối đỉnh (dán băng keo chống trượt)' : 'Trụ đặt chính tâm đỉnh tháp',
        color: cyl.color,
        x: 0,
        y: yCursor + hM * 0.5,
        z: 0,
        sx: dM,
        sy: hM,
        sz: dM,
        rotY: 0,
        frictionMu: cyl.frictionMu ?? 0.36,
        tapedToBelow: useTape,
        massKg: cyl.massKg
      });
      yCursor += hM;
      keptCrownCyls++;
      if (cyl.massKg >= 0.25) elevatedHeavyCount++;
    }
  }
  if (materializeParts && keptCrownCyls > 0) {
    steps.push({
      stepNumber: steps.length + 1,
      courseRange: [cylStartCourse, courses.length - 1],
      title: `Đặt ${keptCrownCyls} trụ tròn lên đỉnh tháp`,
      detail: 'Căn đúng chính giữa mặt phẳng đỉnh để vươn tối đa chiều cao.',
      heightReachedCm: Number((yCursor * 100).toFixed(1))
    });
  } else if (materializeParts) {
    for (let ci = keptCrownCyls; ci < singleCrownHeavyQueue.length; ci++) {
      unElevatedHeavyCyls.push(singleCrownHeavyQueue[ci]);
    }
  }

  baseBallastMass = 0;
  for (const b of pools.ballasts) baseBallastMass += b.massKg;
  for (const uh of unElevatedHeavyCyls) baseBallastMass += uh.massKg;

  // ================= STAGE 7: Non-Clipping Spire Rod =================
  const rodParts: PlacedPart3D[] = [];
  let spireAddedCm = 0;
  let keptRod = false;
  if (allowRod && pools.rods.length > 0 && courses.length > 0) {
    const rod = pools.rods[0];
    const rodPart = resolveSpireRodPlacement(courses, rod, hasAnyBinder);
    if (rodPart) {
      const checkRod = evaluateSkeletonStability(
        courses,
        [rodPart],
        baseBallastMass,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        env,
        false
      );
      if (materializeParts || checkRod.minSF >= targetSF) {
        keptRod = true;
        rodParts.push(rodPart);
        const topRodM = Math.max(yCursor, rodPart.y + rodPart.sy * 0.5);
        spireAddedCm = Number(((topRodM - yCursor) * 100).toFixed(1));
        if (materializeParts) {
          addUsed(rod.id, 1);
          allParts.push(rodPart);
          const isChimney = Math.abs(rodPart.x) < 0.001;
          steps.push({
            stepNumber: steps.length + 1,
            courseRange: [courses.length - 1, courses.length - 1],
            title: `Dựng "${rod.name}" vươn ngọn (+${spireAddedCm}cm)`,
            detail: isChimney
              ? 'Thả gậy lọt thẳng vào giếng vuông rỗng ở tâm các tầng trên, chân gậy tựa lên sàn kín bên dưới.'
              : 'Áp gậy sát mặt ngoài các tầng trên rồi quấn chặt dây/băng keo giữ cố định.',
            heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
          });
        }
      }
    }
  }

  if (!materializeParts) {
    const evalFast = evaluateSkeletonStability(
      courses,
      rodParts,
      baseBallastMass,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY,
      env,
      false
    );
    const comboHeightCm = yCursor * 100 + spireAddedCm;
    if (rodOnlyHeightCm > comboHeightCm) {
      return {
        valid: courses.length > 0,
        heightCm: rodOnlyHeightCm,
        minSF: rodOnlySF,
        keptCrownCyls: 0,
        keptRod: true,
        elevatedHeavyCount,
        usedBlocks: blockCursor
      };
    }
    return {
      valid: courses.length > 0,
      heightCm: comboHeightCm,
      minSF: evalFast.minSF,
      keptCrownCyls,
      keptRod,
      elevatedHeavyCount,
      usedBlocks: blockCursor
    };
  }

  // ================= STAGE 8: Dedicated Heavy Ballasts (Da dan) & Guy-Wires ONLY (ZERO wasted bricks!) =================
  const anchors = [...pools.ballasts, ...unElevatedHeavyCyls];
  for (let i = 0; i < anchors.length; i++) {
    const anc = anchors[i];
    addUsed(anc.id, 1);
    const sx = anc.lengthCm * 0.01;
    const sz = anc.widthCm * 0.01;
    const sy = anc.heightCm * 0.01;
    const ancHalfRadial = anc.kind === 'cylinder' ? sx * 0.5 : Math.hypot(sx * 0.5, sz * 0.5);

    let maxObstacleR = courses[0]?.maxOuterRadiusM ?? 0.09;
    for (const p of allParts) {
      if (p.kind === 'binder') continue;
      const pBot = p.y - p.sy * 0.5;
      const pTop = p.y + p.sy * 0.5;
      if (pBot < sy + 0.004 && pTop > 0) {
        const pOuter =
          p.kind === 'cylinder' || p.kind === 'rod'
            ? Math.hypot(p.x, p.z) + p.sx * 0.5
            : Math.hypot(p.x, p.z) + Math.hypot(p.sx * 0.5, p.sz * 0.5);
        if (pOuter > maxObstacleR) maxObstacleR = pOuter;
      }
    }

    const angle = (i * 2 * Math.PI) / Math.max(2, anchors.length) + Math.PI * 0.25;
    const safeDist = maxObstacleR + ancHalfRadial + 0.005;
    ballastRadiusM = Math.max(ballastRadiusM, safeDist);

    allParts.push({
      id: `ballast-${i}`,
      courseIndex: 0,
      itemName: anc.name,
      kind: anc.kind,
      roleLabel: 'Đối trọng chèn chân móng (chống lật khi gió bão)',
      color: anc.color,
      x: Math.cos(angle) * safeDist,
      y: sy * 0.5,
      z: Math.sin(angle) * safeDist,
      sx,
      sy,
      sz,
      rotY: -angle,
      frictionMu: anc.frictionMu ?? 0.5,
      massKg: anc.massKg
    });
  }
  if (anchors.length > 0) {
    steps.push({
      stepNumber: steps.length + 1,
      courseRange: [0, Math.min(1, Math.max(0, courses.length - 1))],
      title: `Chèn ${anchors.length} đối trọng quanh chân đế`,
      detail: `Đặt ${anchors[0].name} sát mép ngoài chân móng để ghìm trọng tâm.`,
      heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
    });
  }

  if (guyWireMomentNm > 0) {
    const ropeItem = pools.binders.find((b) => b.lengthCm >= 180)!;
    addUsed(ropeItem.id, 1);
    const attachCourseIdx = Math.min(courses.length - 1, Math.max(1, Math.floor(courses.length * 0.68)));
    const attachCourse = courses[attachCourseIdx];
    const attachY = attachCourse.yBottom + attachCourse.heightM * 0.5;
    const attachOuterR = Math.max(0.05, attachCourse.supportRadiusM);
    const guySpreadR = Math.max(0.3, yCursor * 0.38);
    for (let w = 0; w < 3; w++) {
      const ang = (w * 2 * Math.PI) / 3 + Math.PI / 6;
      allParts.push({
        id: `guywire-${w}`,
        courseIndex: attachCourseIdx,
        itemName: ropeItem.name,
        kind: 'binder',
        roleLabel: 'Dây chằng neo 3 góc 120° chịu kéo thực tế',
        color: ropeItem.color,
        x: Math.cos(ang) * attachOuterR,
        y: attachY,
        z: Math.sin(ang) * attachOuterR,
        sx: 0.006,
        sy: attachY,
        sz: 0.006,
        rotY: 0,
        wireToX: Math.cos(ang) * guySpreadR,
        wireToZ: Math.sin(ang) * guySpreadR,
        massKg: 0.02
      });
    }
    steps.push({
      stepNumber: steps.length + 1,
      courseRange: [0, courses.length - 1],
      title: `Chằng 3 dây neo 120° từ tầng ${attachCourseIdx + 1}`,
      detail: `Buộc "${ropeItem.name}" quanh thân tháp rồi kéo căng 3 góc 120° ghìm xuống đất.`,
      heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
    });
  } else {
    for (const b of pools.binders) {
      if (usedCounts && !usedCounts.has(b.id)) addUsed(b.id, 1);
    }
  }

  const evalRes = evaluateSkeletonStability(
    courses,
    rodParts,
    baseBallastMass,
    ballastRadiusM,
    guyWireMomentNm,
    guyWireAttachY,
    env,
    true
  );

  let maxBeaufort = 0;
  let maxWindMps = 0;
  for (const b of BEAUFORT_TABLE) {
    const r = evaluateSkeletonStability(
      courses,
      rodParts,
      baseBallastMass,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY,
      { ...env, beaufortLevel: b.level, windSpeedMps: b.windMps },
      false
    );
    if (r.minSF >= 1.0) {
      maxBeaufort = b.level;
      maxWindMps = b.windMps;
    } else break;
  }

  let maxTiltDeg = 0;
  for (let deg = 0; deg <= 20; deg += 0.5) {
    const r = evaluateSkeletonStability(
      courses,
      rodParts,
      baseBallastMass,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY,
      { ...env, tiltDeg: deg },
      false
    );
    if (r.minSF >= 1.0) maxTiltDeg = deg;
    else break;
  }

  let totalMassKg = 0;
  let weightedY = 0;
  for (const p of allParts) {
    totalMassKg += p.massKg;
    weightedY += p.massKg * p.y;
  }
  const comM = totalMassKg > 1e-5 ? weightedY / totalMassKg : 0;
  const masonryHeightCm = Number((yCursor * 100).toFixed(1));
  const totalHeightCm = Number((masonryHeightCm + spireAddedCm).toFixed(1));

  const partsUsedSummary: string[] = [];
  const unusedSummary: string[] = [];
  for (const it of inventory) {
    if (it.count <= 0) continue;
    const u = Math.min(it.count, usedCounts?.get(it.id) ?? 0);
    if (u > 0) partsUsedSummary.push(`${u}/${it.count} ${it.name}`);
    if (u < it.count) unusedSummary.push(`${it.count - u} ${it.name}`);
  }

  const loadReport = buildLoadBearingReport(
    courses,
    rodParts,
    baseBallastMass,
    ballastRadiusM,
    guyWireMomentNm,
    guyWireAttachY,
    env,
    evalRes
  );

  return {
    valid: true,
    heightCm: totalHeightCm,
    minSF: evalRes.minSF,
    keptCrownCyls,
    keptRod,
    elevatedHeavyCount,
    usedBlocks: blockCursor,
    solution: {
      mode,
      totalHeightCm,
      masonryHeightCm,
      spireAddedCm,
      totalMassKg: Number(totalMassKg.toFixed(2)),
      centerOfMassHeightCm: Number((comM * 100).toFixed(1)),
      baseSupportRadiusCm: Number(((courses[0]?.supportRadiusM ?? 0) * 100).toFixed(1)),
      minSafetyFactor: evalRes.minSF,
      minSlidingFactor: evalRes.minSlideSF,
      standing: evalRes.minSF >= 1.0,
      failCourseIndex: evalRes.failCourseIndex,
      failElevationM: evalRes.failElevationM,
      failReason: evalRes.failReason,
      maxSurvivedBeaufort: maxBeaufort,
      maxSurvivedWindMps: maxWindMps,
      maxSurvivedTiltDeg: maxTiltDeg,
      courseCount: courses.length,
      partsUsedSummary,
      unusedSummary,
      parts: allParts,
      jointChecks: evalRes.jointChecks,
      steps,
      loadReport,
      _skeleton: {
        courses,
        rodParts,
        ballastMassKg: baseBallastMass,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY
      }
    }
  };
}

export function solveRankedBrickTowers(
  inventory: TowerInventoryItem[],
  env: EnvironmentLoadConfig,
  mode: TowerBuildMode = 'optimal',
  maxLadder = 12
): TowerSolution[] {
  const pools = prepareSortedPools(inventory);
  const totalBlocks = pools.blocks.length;

  if (
    totalBlocks === 0 &&
    pools.stools.length === 0 &&
    pools.baskets.length === 0 &&
    pools.heavyCyls.length === 0 &&
    pools.lightCyls.length === 0 &&
    pools.rods.length === 0 &&
    pools.plates.length === 0
  ) {
    return [
      {
        mode,
        totalHeightCm: 0,
        masonryHeightCm: 0,
        spireAddedCm: 0,
        totalMassKg: 0,
        centerOfMassHeightCm: 0,
        baseSupportRadiusCm: 0,
        minSafetyFactor: 0,
        minSlidingFactor: 0,
        standing: true,
        failCourseIndex: null,
        failElevationM: 0,
        failReason: null,
        maxSurvivedBeaufort: 9,
        maxSurvivedWindMps: 22.8,
        maxSurvivedTiltDeg: 20,
        courseCount: 0,
        partsUsedSummary: [],
        unusedSummary: [],
        parts: [],
        jointChecks: [],
        steps: [],
        loadReport: {
          appliedTopPayloadKg: 0,
          maxSafeTopPayloadKg: 0,
          limitingComponent: 'Chưa có vật liệu',
          baseAxialForceN: 0,
          baseTotalWeightKg: 0,
          baseContactAreaCm2: 0,
          groundPressureKgCm2: 0,
          groundVerdict: 'Chưa có tải',
          peakUtilizationPct: 0,
          courseUtilizationPct: [],
          courseRedIntensity: [],
          criticalCourseIndex: 0,
          crushFailedCourseIndex: null
        },
        _skeleton: {
          courses: [],
          rodParts: [],
          ballastMassKg: 0,
          ballastRadiusM: 0.1,
          guyWireMomentNm: 0,
          guyWireAttachY: 0
        }
      }
    ];
  }

  const orients = pools.distinctOrients;
  const nonUprightOrients = orients.filter((o) => o !== 'upright');
  const cribOrients: BlockOrient[] = nonUprightOrients.length > 0 ? nonUprightOrients : ['flat'];
  const candidates: TaperedBlueprint[] = [];

  const hasRod = pools.rods.length > 0;
  const hasStool = pools.stools.length > 0;
  const hasHeavyCyl = pools.heavyCyls.length > 0;

  // Heavy bricks belong at the ground foundation ("Nặng dưới - Nhẹ trên"):
  // Only put lightweight plastic stools at ground y=0 when < 6 bricks exist; otherwise mount stool ON TOP of the brick base!
  const stoolPositions: ('base' | 'upper')[] = hasStool && totalBlocks < 6 ? ['base', 'upper'] : ['upper'];
  const capReserves: number[] = [0];

  if (totalBlocks === 0) {
    candidates.push({ tiers: [], stoolPos: 'base', elevateHeavyCyls: true, reserveCapBricks: 0 });
  } else if (totalBlocks === 1) {
    for (const sp of stoolPositions) {
      candidates.push({
        tiers: [{ pattern: 'single1', orient: 'flat', maxCourses: 1 }],
        stoolPos: sp,
        elevateHeavyCyls: true,
        reserveCapBricks: 0
      });
    }
  } else {
    const basePatterns: CoursePattern[] = ['ring4', 'tri3', 'crib2'];
    const midPatterns: CoursePattern[] = ['tri3', 'crib2'];
    const baseCounts = [1, 2, 3, 4, 6];
    const midCounts = [1, 2, 3, 4, 6];

    for (const sp of stoolPositions) {
      for (const rc of capReserves) {
        // 1. Single-pattern multi-brick towers using ALL bricks (plus storm-fallback shorter counts)
        for (const bpPat of basePatterns) {
          const allowedBo = bpPat === 'crib2' ? cribOrients : orients;
          for (const bo of allowedBo) {
            for (const bc of [999, ...baseCounts]) {
              if (bo === 'upright' && bc > 2) continue;
              candidates.push({
                tiers: [{ pattern: bpPat, orient: bo, maxCourses: bc }],
                stoolPos: sp,
                elevateHeavyCyls: true,
                reserveCapBricks: rc
              });
            }
          }
        }

        // 2. Two-tier & Three-tier Eiffel Tapered Multi-Brick Towers (ring4 -> tri3 -> crib2, consuming 100% of bricks!)
        for (const bpPat of ['ring4', 'tri3'] as CoursePattern[]) {
          const nB = bpPat === 'ring4' ? 4 : 3;
          for (const bo of orients) {
            for (const bc of [1, 2, 3, 4]) {
              if (bo === 'upright' && bc > (bpPat === 'ring4' ? 2 : 1)) continue;
              if ((bc - 1) * nB >= totalBlocks) continue;

              for (const mpPat of midPatterns) {
                const nM = mpPat === 'tri3' ? 3 : 2;
                if (nM >= nB && bpPat === mpPat) continue;
                if (nM > nB) continue;
                const allowedMo = mpPat === 'crib2' ? cribOrients : orients;
                for (const mo of allowedMo) {
                  if (mo === 'upright' && mpPat !== 'tri3') continue;
                  for (const mc of [999, ...midCounts]) {
                    if (mo === 'upright' && mc > 1) continue;
                    if (mc < 999 && bc * nB + (mc - 1) * nM >= totalBlocks) continue;
                    candidates.push({
                      tiers: [
                        { pattern: bpPat, orient: bo, maxCourses: bc },
                        { pattern: mpPat, orient: mo, maxCourses: mc }
                      ],
                      stoolPos: sp,
                      elevateHeavyCyls: true,
                      reserveCapBricks: rc
                    });

                    if (bpPat === 'ring4' && mpPat === 'tri3' && mc <= 3 && totalBlocks >= 12) {
                      for (const co of cribOrients) {
                        candidates.push({
                          tiers: [
                            { pattern: 'ring4', orient: bo, maxCourses: bc },
                            { pattern: 'tri3', orient: mo, maxCourses: mc },
                            { pattern: 'crib2', orient: co, maxCourses: 999 }
                          ],
                          stoolPos: sp,
                          elevateHeavyCyls: true,
                          reserveCapBricks: rc
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 3. Dedicated Hollow Chimney-Socket Blueprints when a Spire Rod (Gay tre) is in inventory!
    if (hasRod && totalBlocks >= 6) {
      for (const sp of stoolPositions) {
        for (const bpPat of ['ring4', 'tri3', 'crib2'] as CoursePattern[]) {
          const allowedBo = bpPat === 'crib2' ? cribOrients : orients;
          for (const bo of allowedBo) {
            if (bo === 'upright' && bpPat !== 'ring4') continue;
            for (const bc of [1, 2, 3, 4]) {
              if (bo === 'upright' && bc > 2) continue;
              for (const chimneyCourses of [4, 5, 6, 8, 10]) {
                candidates.push({
                  tiers: [
                    { pattern: bpPat, orient: bo, maxCourses: bc },
                    { pattern: 'crib2_bridge', orient: 'flat', maxCourses: 1 },
                    { pattern: 'crib2', orient: 'flat', maxCourses: chimneyCourses }
                  ],
                  stoolPos: sp,
                  elevateHeavyCyls: false,
                  preferChimneySpire: true
                });
                candidates.push({
                  tiers: [
                    { pattern: bpPat, orient: bo, maxCourses: bc },
                    { pattern: 'crib2', orient: 'flat', maxCourses: chimneyCourses }
                  ],
                  stoolPos: sp,
                  elevateHeavyCyls: false,
                  preferChimneySpire: true
                });
              }
            }
          }
        }
      }
    }

    // 4. Emergency Storm-Bunker Fallback Blueprints (only for hurricane survival at bottom of ladder!)
    if (hasHeavyCyl) {
      for (const bpPat of ['ring4', 'tri3'] as CoursePattern[]) {
        for (const bc of [2, 3, 4, 5]) {
          candidates.push({
            tiers: [{ pattern: bpPat, orient: 'flat', maxCourses: bc }],
            stoolPos: 'upper',
            elevateHeavyCyls: false,
            reserveCapBricks: 0
          });
        }
      }
    }
  }

  const targetSF = mode === 'fortress' ? 1.85 : mode === 'max_solid' ? 1.48 : 1.32;

  interface ScoredEntry {
    bp: TaperedBlueprint;
    heightCm: number;
    minSF: number;
    keptCrownCyls: number;
    keptRod: boolean;
    elevatedHeavyCount: number;
    usedBlocks: number;
    score: number;
    sig: string;
  }

  const bestBySig = new Map<string, ScoredEntry>();

  const recordEntry = (
    bp: TaperedBlueprint,
    heightCm: number,
    minSF: number,
    keptCrownCyls: number,
    keptRod: boolean,
    elevatedHeavyCount: number,
    usedBlocks: number
  ) => {
    if (heightCm <= 0) return;
    const patKey = bp.tiers.map((t) => `${t.pattern[0]}${t.orient[0]}`).join('') || 'props';
    const hBucket = Math.round(heightCm / 3);
    const fullUseTag = usedBlocks >= totalBlocks - 1 ? 'F' : 'P';
    const sig =
      mode === 'max_solid'
        ? `H${hBucket}-${fullUseTag}-${keptRod ? 'R' : 'M'}-E${elevatedHeavyCount}`
        : `${patKey}-${bp.stoolPos ?? 'u'}-H${Math.round(heightCm / 4)}-${fullUseTag}-${keptRod ? 'R' : 'M'}-E${elevatedHeavyCount}`;
    const wideBaseBonus =
      bp.tiers[0]?.pattern === 'ring4' ? 0.22 : bp.tiers[0]?.pattern === 'tri3' ? 0.14 : 0;
    // Strongly prioritize stacking 100% of bricks + elevating bottles UP for real vertical height!
    const unusedBrickPenalty = Math.max(0, totalBlocks - usedBlocks) * 3.8;
    const elevatedBonus = elevatedHeavyCount * 5.0;
    const score =
      mode === 'fortress'
        ? heightCm * 0.88 + Math.min(4.0, minSF) * 28 + elevatedBonus - unusedBrickPenalty
        : mode === 'max_solid'
          ? heightCm + Math.min(5.0, minSF + wideBaseBonus) * 7.5 + elevatedBonus - unusedBrickPenalty
          : heightCm + Math.min(2.8, minSF) * 3.5 + elevatedBonus - unusedBrickPenalty;
    const prev = bestBySig.get(sig);
    if (!prev || score > prev.score) {
      bestBySig.set(sig, {
        bp,
        heightCm,
        minSF,
        keptCrownCyls,
        keptRod,
        elevatedHeavyCount,
        usedBlocks,
        score,
        sig
      });
    }
  };

  for (let i = 0; i < candidates.length; i++) {
    const bp = candidates[i];
    const res = buildTowerFromBlueprint(inventory, pools, bp, mode, env, targetSF, false, 999, true);
    if (!res.valid || res.heightCm <= 0) continue;
    recordEntry(
      bp,
      res.heightCm,
      res.minSF,
      res.keptCrownCyls,
      res.keptRod,
      res.elevatedHeavyCount,
      res.usedBlocks
    );

    if (res.keptRod && pools.rods.length > 0) {
      const noRodBp: TaperedBlueprint = { ...bp, preferChimneySpire: false, elevateHeavyCyls: true };
      const noRodRes = buildTowerFromBlueprint(inventory, pools, noRodBp, mode, env, targetSF, false, 999, false);
      if (noRodRes.valid && noRodRes.heightCm > 0) {
        recordEntry(
          noRodBp,
          noRodRes.heightCm,
          noRodRes.minSF,
          noRodRes.keptCrownCyls,
          false,
          noRodRes.elevatedHeavyCount,
          noRodRes.usedBlocks
        );
      }
    }
  }

  const allEntries = Array.from(bestBySig.values());
  if (allEntries.length === 0) {
    const fallback = buildTowerFromBlueprint(
      inventory,
      pools,
      candidates[0] ?? { tiers: [] },
      mode,
      env,
      1.0,
      true,
      0,
      false
    );
    return [fallback.solution!];
  }

  const buildParetoFrontier = (list: ScoredEntry[], cap: number): ScoredEntry[] => {
    const byHeight = [...list].sort((a, b) => b.heightCm - a.heightCm || b.minSF - a.minSF);
    const out: ScoredEntry[] = [];
    let bestSF = -Infinity;
    for (const e of byHeight) {
      if (out.length >= cap) break;
      if (out.length === 0) {
        out.push(e);
        bestSF = e.minSF;
      } else if (e.minSF > bestSF * 1.1 && e.heightCm <= out[out.length - 1].heightCm - 5) {
        out.push(e);
        bestSF = e.minSF;
      }
    }
    return out;
  };

  // Prefer designs that stack ALL bricks (>= totalBlocks - 1) & pass targetSF!
  const fullStackPassing = allEntries.filter(
    (e) => e.minSF >= targetSF && e.usedBlocks >= Math.max(1, totalBlocks - 1)
  );
  const passingRaw =
    fullStackPassing.length > 0 ? fullStackPassing : allEntries.filter((e) => e.minSF >= targetSF);
  const peakHeightCm = passingRaw.length > 0 ? Math.max(...passingRaw.map((e) => e.heightCm)) : 0;
  const peakBandCm = Math.max(4.0, peakHeightCm * 0.04);

  const passing = [...passingRaw].sort((a, b) => {
    if (mode === 'max_solid') {
      const aInPeak = a.heightCm >= peakHeightCm - peakBandCm ? 1 : 0;
      const bInPeak = b.heightCm >= peakHeightCm - peakBandCm ? 1 : 0;
      if (aInPeak !== bInPeak) return bInPeak - aInPeak;
      if (aInPeak === 1) {
        if (b.elevatedHeavyCount !== a.elevatedHeavyCount) return b.elevatedHeavyCount - a.elevatedHeavyCount;
        return b.minSF - a.minSF || b.heightCm - a.heightCm;
      }
      return b.heightCm - a.heightCm || b.minSF - a.minSF;
    }
    return b.score - a.score;
  });

  const chosenMap = new Map<string, ScoredEntry>();
  if (passing.length > 0) {
    chosenMap.set(passing[0].sig, passing[0]);
    for (const e of passing) {
      if (chosenMap.size >= 4) break;
      if (
        e.bp.tiers[0]?.pattern !== passing[0].bp.tiers[0]?.pattern &&
        e.heightCm >= passing[0].heightCm * 0.82
      ) {
        chosenMap.set(e.sig, e);
      }
    }
  }

  // Primary ladder: Full-brick-use Pareto frontier!
  for (const e of buildParetoFrontier(passing.length > 0 ? passing : allEntries, maxLadder)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  // Secondary ladder: Pure-masonry full-brick Pareto frontier (if rod present)
  const masonryFull = allEntries.filter(
    (e) => !e.keptRod && e.minSF >= 1.2 && e.usedBlocks >= Math.max(1, totalBlocks - 2)
  );
  for (const e of buildParetoFrontier(masonryFull, 6)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  // Final emergency storm rungs (only include designs that at least stand statically: minSF >= 1.12!)
  const standingEntries = allEntries.filter((e) => e.minSF >= 1.12);
  for (const e of buildParetoFrontier(standingEntries.length > 0 ? standingEntries : allEntries, maxLadder)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  const firstPick = passing[0] ?? allEntries.sort((a, b) => b.minSF - a.minSF)[0];
  const restSorted = Array.from(chosenMap.values())
    .filter((e) => e.sig !== firstPick.sig)
    .sort((a, b) => {
      // Keep full-stack designs ahead of emergency storm-shedding designs!
      const aFull = a.usedBlocks >= Math.max(1, totalBlocks - 2) ? 1 : 0;
      const bFull = b.usedBlocks >= Math.max(1, totalBlocks - 2) ? 1 : 0;
      if (aFull !== bFull) return bFull - aFull;
      return b.heightCm - a.heightCm || b.minSF - a.minSF;
    });
  const chosen = [firstPick, ...restSorted].slice(0, maxLadder);

  return chosen.map(
    (entry) =>
      buildTowerFromBlueprint(
        inventory,
        pools,
        entry.bp,
        mode,
        env,
        targetSF,
        true,
        entry.keptCrownCyls,
        entry.keptRod
      ).solution!
  );
}

export function solveOptimalBrickTower(
  inventory: TowerInventoryItem[],
  env: EnvironmentLoadConfig,
  mode: TowerBuildMode = 'optimal'
): TowerSolution {
  return solveRankedBrickTowers(inventory, env, mode, 1)[0];
}
