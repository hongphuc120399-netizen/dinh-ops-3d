/**
 * 100% Offline 3D Structural Physics & Non-Overlapping Combinatorial Tower Auto-Optimizer
 * Guarantees ZERO object interpenetration (exact SAT OBB/Cylinder clearance, real hollow chimney sockets,
 * solid bridging lintels over voids, non-clipping perimeter buttresses) and full compatibility with live
 * 120Hz cannon-es 3D rigid-body simulation.
 */

export type PropShapeKind = 'block' | 'cylinder' | 'rod' | 'plate' | 'ballast' | 'binder';

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
  failed: boolean;
  failureMode: 'none' | 'overturn' | 'slide';
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
  }
];

export function estimateItemMassKg(
  kind: PropShapeKind,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  material: 'brick' | 'wood' | 'water' | 'hollow_plastic' | 'stone' | 'metal'
): number {
  const volCm3 =
    kind === 'cylinder' || kind === 'rod'
      ? Math.PI * Math.pow(widthCm * 0.5, 2) * heightCm
      : lengthCm * widthCm * heightCm;
  const densityGPerCm3: Record<typeof material, number> = {
    brick: 1.45,
    stone: 2.35,
    water: 0.96,
    wood: 0.62,
    hollow_plastic: 0.08,
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

  return { blocks, heavyCyls, lightCyls, plates, rods, ballasts, binders, distinctOrients };
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
      binderMomentNm: hasTiedBand ? 2.4 : 0
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
      binderMomentNm: hasTiedBand ? 2.0 : 0
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
      binderMomentNm: hasTiedBand ? 1.8 : 0
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
    binderMomentNm: hasTiedBand ? 1.1 : 0
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
} {
  const n = courses.length;
  if (n === 0) {
    return {
      jointChecks: [],
      minSF: 99,
      minSlideSF: 99,
      failCourseIndex: null,
      failElevationM: 0,
      failReason: null
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

  let suffixMass = 0;
  let suffixWeightedY = 0;
  let suffixWindForce = 0;
  let suffixWindForceY = 0;

  const rod0 = rodParts[0];
  const jointChecks: CourseJointCheck[] = recordJoints ? new Array(n) : [];
  let minSF = Infinity;
  let minSlideSF = Infinity;
  let failCourseIndex: number | null = null;
  let failElevationM = 0;
  let failReason: string | null = null;

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
        rodEccentricMoment += mPart * GRAVITY * Math.abs(rod0.x);
        const fRod = qWind * 0.9 * (rod0.sx * exposedH);
        windForceHoriz += fRod;
        windMoment += fRod * Math.max(0.01, midY - zCut);
      }
    }

    const rSupport =
      i === 0 ? c.supportRadiusM : Math.min(c.supportRadiusM, courses[i - 1].supportRadiusM * 1.08);
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

    const effectiveSf = Math.min(sf, slideSf);
    if (slideSf < minSlideSF) minSlideSF = slideSf;

    if (effectiveSf < minSF || (effectiveSf < 1.0 && failCourseIndex !== null && i < failCourseIndex)) {
      if (effectiveSf < minSF) minSF = effectiveSf;
      if (effectiveSf < 1.0) {
        failCourseIndex = i;
        failElevationM = zCut;
        if (recordJoints) {
          failReason =
            slideSf < sf
              ? `Trượt ngang tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do vật nhẹ/trơn gặp gió mạnh!`
              : windMoment >= shakeMoment
                ? `Đổ lật tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do sức gió vượt mô-men giữ chân đế!`
                : `Đổ lật tại tầng ${i + 1} (cao ${(zCut * 100).toFixed(0)}cm) do độ nghiêng / rung lắc vượt giới hạn!`;
        }
      }
    }

    if (recordJoints) {
      jointChecks[i] = {
        courseIndex: i,
        elevationM: zCut,
        effectiveRadiusM: rSupport,
        massAboveKg: massAbove,
        windMomentNm: windMoment,
        shakeMomentNm: shakeMoment,
        imperfectionMomentNm: imperfectionMoment,
        restoringMomentNm: restoringMoment,
        safetyFactor: Number(effectiveSf.toFixed(2)),
        slidingSafetyFactor: Number(slideSf.toFixed(2)),
        failed: effectiveSf < 1.0,
        failureMode: effectiveSf >= 1.0 ? 'none' : slideSf < sf ? 'slide' : 'overturn'
      };
    }
  }

  return {
    jointChecks,
    minSF: Number.isFinite(minSF) ? Number(minSF.toFixed(2)) : 99,
    minSlideSF: Number.isFinite(minSlideSF) ? Number(minSlideSF.toFixed(2)) : 99,
    failCourseIndex,
    failElevationM,
    failReason
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
  return {
    ...sol,
    minSafetyFactor: evalRes.minSF,
    minSlidingFactor: evalRes.minSlideSF,
    standing: evalRes.minSF >= 1.0,
    failCourseIndex: evalRes.failCourseIndex,
    failElevationM: evalRes.failElevationM,
    failReason: evalRes.failReason,
    jointChecks: evalRes.jointChecks
  };
}

interface TaperedBlueprint {
  tiers: { pattern: CoursePattern; orient: BlockOrient; maxCourses: number }[];
}

function evaluateCandidateFast(
  pools: SortedPools,
  bp: TaperedBlueprint,
  mode: TowerBuildMode,
  env: EnvironmentLoadConfig,
  targetSF: number
): { heightCm: number; minSF: number; keptLightCyls: number; keptRod: boolean } {
  const courses: InternalCourseSummary[] = [];
  let yCursor = 0;
  let blockCursor = 0;
  let plateCursor = 0;
  const hasLongRope = pools.binders.some((b) => b.lengthCm >= 180);
  const hasAnyBinder = pools.binders.length > 0;
  let availableBands = Math.max(0, pools.binders.length * 2 - (hasLongRope && mode !== 'naive' ? 2 : 0));

  const insertPlateFast = (): boolean => {
    if (mode === 'naive' || plateCursor >= pools.plates.length) return false;
    const pl = pools.plates[plateCursor++];
    const sx = pl.lengthCm * 0.01;
    const sz = pl.widthCm * 0.01;
    const sy = Math.max(0.006, pl.heightCm * 0.01);
    const cIdx = courses.length;
    if (cIdx > 0) courses[cIdx - 1].supportRadiusM *= 1.12;
    const prevR = cIdx > 0 ? courses[cIdx - 1].supportRadiusM : Math.min(sx, sz) * 0.45;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: sy,
      supportRadiusM: Math.min(Math.min(sx, sz) * 0.46, prevR * 1.18),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: Math.hypot(sx * 0.5, sz * 0.5),
      windWidthM: Math.max(sx, sz),
      dragCoeff: 1.2,
      massKg: pl.massKg,
      frictionMu: pl.frictionMu ?? 0.52,
      binderMomentNm: 0.8
    });
    yCursor += sy;
    return true;
  };

  // Automatically close hollow center hole before placing single1 or narrow cylinders!
  const ensureClosedCenterFloorFast = (neededFootprintM: number): boolean => {
    if (courses.length === 0) return true;
    const topHole = courses[courses.length - 1].clearHoleRadiusM;
    if (topHole * 2 <= neededFootprintM * 0.36) return true;
    if (insertPlateFast()) return true;
    if (blockCursor + 2 <= pools.blocks.length) {
      const ref = pools.blocks[blockCursor];
      const { lM, tM } = getBlockDimsForOrient(ref, 'flat');
      if (isPatternPhysicallyValid('crib2_bridge', lM, tM)) {
        const bridgeCourse = computeCourseMetricsOnly(
          courses.length,
          yCursor,
          pools.blocks,
          blockCursor,
          2,
          'crib2_bridge',
          'flat',
          false
        );
        blockCursor += 2;
        courses.push(bridgeCourse);
        yCursor += bridgeCourse.heightM;
        return true;
      }
    }
    return false;
  };

  let lastMasonrySupportR = Infinity;
  for (let t = 0; t < bp.tiers.length; t++) {
    const tier = bp.tiers[t];
    if (blockCursor >= pools.blocks.length) break;
    const ref = pools.blocks[blockCursor];
    const { lM, tM } = getBlockDimsForOrient(ref, tier.orient);
    if (!isPatternPhysicallyValid(tier.pattern, lM, tM)) {
      return { heightCm: 0, minSF: 0, keptLightCyls: 0, keptRod: false };
    }

    // Enforce true Eiffel tapering: upper masonry tiers must never overhang wider than lower masonry tiers
    // (except open crib2/ring4 continuing immediately above a single solid crib2_bridge floor!)
    const prevPat = t > 0 ? bp.tiers[t - 1].pattern : null;
    const probeMetrics = computeCourseMetricsOnly(0, 0, pools.blocks, blockCursor, 1, tier.pattern, tier.orient, false);
    if (prevPat !== 'crib2_bridge' && probeMetrics.supportRadiusM > lastMasonrySupportR * 1.03) {
      return { heightCm: 0, minSF: 0, keptLightCyls: 0, keptRod: false };
    }
    if (tier.pattern !== 'crib2_bridge') {
      lastMasonrySupportR = probeMetrics.supportRadiusM;
    }

    // Prevent 120° triangular courses from resting directly across an un-bridged 90° square hole (or vice-versa) without a plate!
    const prevTopHole = courses.length > 0 ? courses[courses.length - 1].clearHoleRadiusM : 0;
    if (
      prevTopHole > 0.01 &&
      ((prevPat === 'ring4' && tier.pattern === 'tri3') || (prevPat === 'tri3' && tier.pattern === 'crib2'))
    ) {
      return { heightCm: 0, minSF: 0, keptLightCyls: 0, keptRod: false };
    }

    if (tier.pattern === 'single1') {
      if (!ensureClosedCenterFloorFast(Math.min(lM, tM))) break;
    }

    const nNeed =
      tier.pattern === 'ring4'
        ? 4
        : tier.pattern === 'tri3'
          ? 3
          : tier.pattern === 'crib2' || tier.pattern === 'crib2_bridge'
            ? 2
            : 1;
    // Prevent un-glued narrow single1 stacks from rocking off a tall swaying tower when dynamic shake/wind is active
    const underDynamicLoad = env.shakeG > 0.015 || env.tiltDeg > 1.0 || env.windSpeedMps > 3.0;
    const disallowTallUprightFinial =
      mode !== 'naive' &&
      tier.pattern === 'single1' &&
      tier.orient === 'upright' &&
      courses.length >= 6 &&
      underDynamicLoad;
    if (disallowTallUprightFinial) {
      return { heightCm: 0, minSF: 0, keptLightCyls: 0, keptRod: false };
    }
    const effectiveMaxCourses =
      mode !== 'naive' && tier.pattern === 'single1' && courses.length > 0
        ? tier.orient === 'upright'
          ? Math.min(tier.maxCourses, 1)
          : underDynamicLoad && courses.length >= 4
            ? Math.min(tier.maxCourses, 2)
            : tier.maxCourses
        : tier.maxCourses;
    let built = 0;
    while (built < effectiveMaxCourses && blockCursor + nNeed <= pools.blocks.length) {
      const canUseBandHere = tier.orient === 'upright' && availableBands > pools.lightCyls.length;
      if (canUseBandHere) availableBands--;
      const c = computeCourseMetricsOnly(
        courses.length,
        yCursor,
        pools.blocks,
        blockCursor,
        nNeed,
        tier.pattern,
        tier.orient,
        canUseBandHere
      );
      blockCursor += nNeed;
      courses.push(c);
      yCursor += c.heightM;
      built++;
    }
    if (built > 0 && t < bp.tiers.length - 1) {
      // Place thin diaphragm plates at upper tier transitions (<= 10 bricks above) so 20kg of masonry never crushes cardboard at the base!
      const nextPat = bp.tiers[t + 1]?.pattern;
      if (pools.blocks.length - blockCursor <= 10 || nextPat === 'crib2' || nextPat === 'single1') {
        if (pools.blocks.length - blockCursor <= 12) {
          insertPlateFast();
        }
      }
    }
  }

  let ballastMassKg = 0;
  let ballastRadiusM = (courses[0]?.supportRadiusM ?? 0.1) + 0.06;
  if (mode !== 'naive') {
    for (const b of pools.ballasts) ballastMassKg += b.massKg;
    for (const h of pools.heavyCyls) ballastMassKg += h.massKg;
  }

  if ((mode === 'max_solid' || mode === 'fortress') && blockCursor + 2 <= pools.blocks.length && courses.length >= 2) {
    const spareBricks = pools.blocks.length - blockCursor;
    const refB = pools.blocks[blockCursor];
    const { tM: btM, hM: bhM } = getBlockDimsForOrient(refB, 'flat');
    const maxAllowedH = Math.min(yCursor * 0.62, bhM * 4);
    const maxRing0 = Math.max(0, Math.floor((maxAllowedH + 0.001) / bhM));
    const buttressLayers = Math.min(maxRing0, Math.max(1, Math.floor(spareBricks / 4)));
    if (buttressLayers >= 1) {
      const buttressH = buttressLayers * bhM;
      const usedForButtress = Math.min(spareBricks, buttressLayers * 4 + Math.max(0, buttressLayers - 1) * 4);
      let spareMass = 0;
      for (let s = 0; s < usedForButtress; s++) {
        spareMass += pools.blocks[blockCursor + s].massKg;
      }
      ballastMassKg += spareMass;
      ballastRadiusM = Math.max(ballastRadiusM, (courses[0]?.supportRadiusM ?? 0.09) + btM * 0.85);
      for (let ci = 0; ci < courses.length; ci++) {
        if (courses[ci].yBottom < buttressH - 0.01) {
          courses[ci].supportRadiusM += btM * (ci === 0 ? 0.62 : 0.38);
        }
      }
    }
  }

  const guyWireMomentNm = hasLongRope && mode !== 'naive' && courses.length >= 3 ? 18.5 : 0;
  const baseMasonryY = yCursor;
  const guyWireAttachY = guyWireMomentNm > 0 ? baseMasonryY * 0.68 : 0;

  // Evaluate direct Rod on Masonry BEFORE adding light cylinders (so narrow bottles never block a tall chimney spire!)
  let rodOnlyHeightCm = -1;
  let rodOnlySF = 0;
  if (pools.rods.length > 0 && courses.length > 0) {
    const directRod = resolveSpireRodPlacement(courses, pools.rods[0], hasAnyBinder);
    if (directRod) {
      const rCheck = evaluateSkeletonStability(
        courses,
        [directRod],
        ballastMassKg,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        env,
        false
      );
      if (rCheck.minSF >= targetSF) {
        const topRodM = Math.max(yCursor, directRod.y + directRod.sy * 0.5);
        rodOnlyHeightCm = topRodM * 100;
        rodOnlySF = rCheck.minSF;
      }
    }
  }

  let keptLightCyls = 0;
  for (const cyl of pools.lightCyls) {
    const dM = cyl.widthCm * 0.01;
    const hM = cyl.heightCm * 0.01;
    if (dM * 0.42 < 0.02) break;
    // Never balance a narrow bottle over a wide open chimney hole!
    if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM * 2 > dM * 0.35) {
      if (!insertPlateFast()) break;
    }
    const prevR = courses.length > 0 ? courses[courses.length - 1].supportRadiusM : dM * 0.45;
    const useTape = availableBands > 0;
    const candidateCourse: InternalCourseSummary = {
      courseIndex: courses.length,
      yBottom: yCursor,
      heightM: hM,
      supportRadiusM: Math.min(dM * 0.44, prevR),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: dM * 0.5,
      windWidthM: dM,
      dragCoeff: 0.85,
      massKg: cyl.massKg,
      frictionMu: useTape ? 0.65 : (cyl.frictionMu ?? 0.34),
      binderMomentNm: useTape ? 2.6 : 0
    };
    courses.push(candidateCourse);
    const check = evaluateSkeletonStability(
      courses,
      [],
      ballastMassKg,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY,
      env,
      false
    );
    if (mode === 'naive' || check.minSF >= targetSF) {
      if (useTape) availableBands--;
      yCursor += hM;
      keptLightCyls++;
    } else {
      courses.pop();
      break;
    }
  }

  const rodParts: PlacedPart3D[] = [];
  let topReachedM = yCursor;
  let keptRod = false;
  if (pools.rods.length > 0 && courses.length > 0) {
    const candidateRod = resolveSpireRodPlacement(courses, pools.rods[0], hasAnyBinder);
    if (candidateRod) {
      const withRodCheck = evaluateSkeletonStability(
        courses,
        [candidateRod],
        ballastMassKg,
        ballastRadiusM,
        guyWireMomentNm,
        guyWireAttachY,
        env,
        false
      );
      if (mode === 'naive' || withRodCheck.minSF >= targetSF) {
        rodParts.push(candidateRod);
        topReachedM = Math.max(yCursor, candidateRod.y + candidateRod.sy * 0.5);
        keptRod = true;
      }
    }
  }

  const evalRes = evaluateSkeletonStability(
    courses,
    rodParts,
    ballastMassKg,
    ballastRadiusM,
    guyWireMomentNm,
    guyWireAttachY,
    env,
    false
  );

  const comboHeightCm = topReachedM * 100;
  if (mode !== 'naive' && rodOnlyHeightCm > comboHeightCm) {
    return {
      heightCm: rodOnlyHeightCm,
      minSF: rodOnlySF,
      keptLightCyls: 0,
      keptRod: true
    };
  }

  return {
    heightCm: comboHeightCm,
    minSF: evalRes.minSF,
    keptLightCyls,
    keptRod
  };
}

function materializeWinningTower(
  inventory: TowerInventoryItem[],
  pools: SortedPools,
  bp: TaperedBlueprint,
  mode: TowerBuildMode,
  env: EnvironmentLoadConfig,
  keptLightCyls = 999,
  keptRod = true
): TowerSolution {
  const usedCounts = new Map<string, number>();
  const addUsed = (id: string, n = 1) => usedCounts.set(id, (usedCounts.get(id) ?? 0) + n);

  const hasLongRope = pools.binders.some((b) => b.lengthCm >= 180);
  const hasAnyBinder = pools.binders.length > 0;
  let availableBands = Math.max(0, pools.binders.length * 2 - (hasLongRope && mode !== 'naive' ? 2 : 0));

  const courses: InternalCourseSummary[] = [];
  const allParts: PlacedPart3D[] = [];
  const steps: BuildStepGuide[] = [];
  let yCursor = 0;
  let blockCursor = 0;
  let plateCursor = 0;

  const insertPlateFull = (reason: string): boolean => {
    if (mode === 'naive' || plateCursor >= pools.plates.length) return false;
    const pl = pools.plates[plateCursor++];
    addUsed(pl.id, 1);
    const sx = pl.lengthCm * 0.01;
    const sz = pl.widthCm * 0.01;
    const sy = Math.max(0.006, pl.heightCm * 0.01);
    const cIdx = courses.length;
    if (cIdx > 0) courses[cIdx - 1].supportRadiusM *= 1.12;
    const prevR = cIdx > 0 ? courses[cIdx - 1].supportRadiusM : Math.min(sx, sz) * 0.45;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: sy,
      supportRadiusM: Math.min(Math.min(sx, sz) * 0.46, prevR * 1.18),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: Math.hypot(sx * 0.5, sz * 0.5),
      windWidthM: Math.max(sx, sz),
      dragCoeff: 1.2,
      massKg: pl.massKg,
      frictionMu: pl.frictionMu ?? 0.52,
      binderMomentNm: 0.8
    });
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
    yCursor += sy;
    steps.push({
      stepNumber: steps.length + 1,
      courseRange: [cIdx, cIdx],
      title: `Đặt "${pl.name}" khóa mặt phẳng`,
      detail: `${reason} — tạo mặt sàn đặc liền khối không để vật tầng trên lọt xuống lỗ rỗng.`,
      heightReachedCm: Number((yCursor * 100).toFixed(1))
    });
    return true;
  };

  const ensureClosedCenterFloorFull = (neededFootprintM: number, targetDesc: string): boolean => {
    if (courses.length === 0) return true;
    const topHole = courses[courses.length - 1].clearHoleRadiusM;
    if (topHole * 2 <= neededFootprintM * 0.36) return true;
    if (insertPlateFull(`Bắc sàn phẳng che kín miệng giếng trước khi đặt ${targetDesc}`)) return true;
    if (blockCursor + 2 <= pools.blocks.length) {
      const ref = pools.blocks[blockCursor];
      const { lM, tM } = getBlockDimsForOrient(ref, 'flat');
      if (isPatternPhysicallyValid('crib2_bridge', lM, tM)) {
        const cIdx = courses.length;
        const c = computeCourseMetricsOnly(cIdx, yCursor, pools.blocks, blockCursor, 2, 'crib2_bridge', 'flat', false);
        const slice = pools.blocks.slice(blockCursor, blockCursor + 2);
        slice.forEach((b) => addUsed(b.id, 1));
        allParts.push(...materializeBlockParts(cIdx, yCursor, slice, 'crib2_bridge', 'flat'));
        blockCursor += 2;
        courses.push(c);
        yCursor += c.heightM;
        steps.push({
          stepNumber: steps.length + 1,
          courseRange: [cIdx, cIdx],
          title: 'Khép 2 viên gạch nằm sát tâm làm sàn đỡ',
          detail: `Bắc 2 viên gạch sát nhau che kín lỗ giếng bên dưới để ${targetDesc} đứng vững 100% trên gạch đặc.`,
          heightReachedCm: Number((yCursor * 100).toFixed(1))
        });
        return true;
      }
    }
    return false;
  };

  for (let t = 0; t < bp.tiers.length; t++) {
    const tier = bp.tiers[t];
    if (blockCursor >= pools.blocks.length) break;
    const ref = pools.blocks[blockCursor];
    const { lM, tM } = getBlockDimsForOrient(ref, tier.orient);
    if (!isPatternPhysicallyValid(tier.pattern, lM, tM)) break;

    const prevPatFull = t > 0 ? bp.tiers[t - 1].pattern : null;
    const prevTopHoleFull = courses.length > 0 ? courses[courses.length - 1].clearHoleRadiusM : 0;
    if (
      prevTopHoleFull > 0.01 &&
      ((prevPatFull === 'ring4' && tier.pattern === 'tri3') || (prevPatFull === 'tri3' && tier.pattern === 'crib2'))
    ) {
      break;
    }

    if (tier.pattern === 'single1') {
      if (!ensureClosedCenterFloorFull(Math.min(lM, tM), 'trụ gạch đơn')) break;
    }

    const nNeed =
      tier.pattern === 'ring4'
        ? 4
        : tier.pattern === 'tri3'
          ? 3
          : tier.pattern === 'crib2' || tier.pattern === 'crib2_bridge'
            ? 2
            : 1;
    const underDynamicLoad = env.shakeG > 0.015 || env.tiltDeg > 1.0 || env.windSpeedMps > 3.0;
    const effectiveMaxCourses =
      mode !== 'naive' && tier.pattern === 'single1' && courses.length > 0
        ? tier.orient === 'upright'
          ? Math.min(tier.maxCourses, 1)
          : underDynamicLoad && courses.length >= 4
            ? Math.min(tier.maxCourses, 2)
            : tier.maxCourses
        : tier.maxCourses;
    let built = 0;
    const startCourse = courses.length;
    while (built < effectiveMaxCourses && blockCursor + nNeed <= pools.blocks.length) {
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
      const slice = pools.blocks.slice(blockCursor, blockCursor + nNeed);
      slice.forEach((b) => addUsed(b.id, 1));
      const parts = materializeBlockParts(courses.length, yCursor, slice, tier.pattern, tier.orient);
      allParts.push(...parts);
      blockCursor += nNeed;
      courses.push(c);
      yCursor += c.heightM;
      built++;
    }

    if (built > 0) {
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
                ? 'Đan chữ thập 2 viên song song (xoay 90° qua lại, chừa giếng vuông 4cm ở tâm)'
                : 'Trụ đơn 1 viên căn thẳng trục tâm (xoay 90° triệt tiêu độ vát)';
      const stageName = t === 0 ? 'Móng chân đế' : t === bp.tiers.length - 1 ? 'Ngọn vươn cao' : `Thân thu gọn đợt ${t}`;
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [startCourse, courses.length - 1],
        title: `${stageName}: ${built} tầng × ${nNeed} viên (${oriName})`,
        detail: `Xếp kiểu ${patDesc}.`,
        heightReachedCm: Number((yCursor * 100).toFixed(1))
      });
      if (t < bp.tiers.length - 1) {
        if (pools.blocks.length - blockCursor <= 12) {
          insertPlateFull('Khóa mặt phẳng chuyển bậc trước khi thu hẹp tầng trên');
        }
      }
    }
  }

  // Light Cylinders at Crown (only mount up to keptLightCyls & ensure solid center floor!)
  const baseMasonryY = yCursor;
  let builtLightCyl = 0;
  const cylStart = courses.length;
  for (let ci = 0; ci < Math.min(keptLightCyls, pools.lightCyls.length); ci++) {
    const cyl = pools.lightCyls[ci];
    const dM = cyl.widthCm * 0.01;
    const hM = cyl.heightCm * 0.01;
    if (dM * 0.42 < 0.02) continue;
    if (courses.length > 0 && courses[courses.length - 1].clearHoleRadiusM * 2 > dM * 0.35) {
      if (!insertPlateFull('Che kín miệng giếng trước khi đặt chai nhẹ lên đỉnh')) break;
    }
    addUsed(cyl.id, 1);
    const prevR = courses.length > 0 ? courses[courses.length - 1].supportRadiusM : dM * 0.45;
    const useTape = availableBands > 0;
    if (useTape) availableBands--;
    const cIdx = courses.length;
    courses.push({
      courseIndex: cIdx,
      yBottom: yCursor,
      heightM: hM,
      supportRadiusM: Math.min(dM * 0.44, prevR),
      clearHoleRadiusM: 0,
      maxOuterRadiusM: dM * 0.5,
      windWidthM: dM,
      dragCoeff: 0.85,
      massKg: cyl.massKg,
      frictionMu: useTape ? 0.65 : (cyl.frictionMu ?? 0.34),
      binderMomentNm: useTape ? 2.6 : 0
    });
    allParts.push({
      id: `cyl-${cIdx}`,
      courseIndex: cIdx,
      itemName: cyl.name,
      kind: 'cylinder',
      roleLabel: useTape ? 'Vật rỗng nối đỉnh (dán băng keo chống gió trượt)' : 'Vật rỗng nhẹ nối đỉnh',
      color: cyl.color,
      x: 0,
      y: yCursor + hM * 0.5,
      z: 0,
      sx: dM,
      sy: hM,
      sz: dM,
      rotY: 0,
      frictionMu: cyl.frictionMu ?? 0.34,
      tapedToBelow: useTape,
      massKg: cyl.massKg
    });
    yCursor += hM;
    builtLightCyl++;
  }
  if (builtLightCyl > 0) {
    steps.push({
      stepNumber: steps.length + 1,
      courseRange: [cylStart, courses.length - 1],
      title: `Đặt ${builtLightCyl} vật rỗng siêu nhẹ lên đỉnh`,
      detail: 'Tăng chiều cao tối đa mà không gây nặng đầu (dán băng keo nếu có gió mạnh).',
      heightReachedCm: Number((yCursor * 100).toFixed(1))
    });
  }

  // Non-Clipping Spire Rod (Chimney Socket OR Outside Side-Lash — NEVER pierces bricks/plates!)
  const rodParts: PlacedPart3D[] = [];
  let spireAddedCm = 0;
  if (keptRod && pools.rods.length > 0 && courses.length > 0) {
    const rod = pools.rods[0];
    const rodPart = resolveSpireRodPlacement(courses, rod, hasAnyBinder);
    if (rodPart) {
      addUsed(rod.id, 1);
      const topRodM = Math.max(yCursor, rodPart.y + rodPart.sy * 0.5);
      spireAddedCm = Number(((topRodM - yCursor) * 100).toFixed(1));
      rodParts.push(rodPart);
      allParts.push(rodPart);
      const isChimney = Math.abs(rodPart.x) < 0.001;
      steps.push({
        stepNumber: steps.length + 1,
        courseRange: [courses.length - 1, courses.length - 1],
        title: `Dựng "${rod.name}" vươn ngọn (+${spireAddedCm}cm)`,
        detail: isChimney
          ? `Thả gậy lọt thẳng vào giếng vuông rỗng ở tâm các tầng trên (không chạm/cấn gạch), chân gậy tựa lên mặt sàn kín bên dưới.`
          : `Áp gậy sát mặt ngoài các tầng gạch trên cùng rồi quấn chặt dây/băng keo giữ cố định.`,
        heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
      });
    }
  }

  // Non-Clipping 4-Sided Stepped Pyramid Brick Buttress Skirt (for 'max_solid' & 'fortress' when spare bricks remain!)
  let buttressMassKg = 0;
  let buttressOuterR = 0;
  if ((mode === 'max_solid' || mode === 'fortress') && blockCursor + 2 <= pools.blocks.length && courses.length >= 2) {
    const refB = pools.blocks[blockCursor];
    const { lM: blM, tM: btM, hM: bhM } = getBlockDimsForOrient(refB, 'flat');
    const gap = 0.0025;

    // Cap buttress height below any wide overhanging plate and at most 55% of masonry height (max 4 flat courses)
    let maxAllowedH = Math.min(yCursor * 0.62, bhM * 4);
    for (const p of allParts) {
      if (p.kind === 'plate' && p.y - p.sy * 0.5 > bhM * 0.9) {
        maxAllowedH = Math.min(maxAllowedH, p.y - p.sy * 0.5 - 0.004);
        break;
      }
    }
    const maxRing0Courses = Math.max(0, Math.floor((maxAllowedH + 0.001) / bhM));

    if (maxRing0Courses >= 1) {
      const spanH = maxRing0Courses * bhM;
      let reachX = 0.04;
      let reachZ = 0.04;
      for (const p of allParts) {
        if (p.kind === 'binder') continue;
        const pBot = p.y - p.sy * 0.5;
        const pTop = p.y + p.sy * 0.5;
        if (pBot < spanH - 0.001 && pTop > 0.001) {
          if (p.kind === 'cylinder' || p.kind === 'rod') {
            reachX = Math.max(reachX, Math.abs(p.x) + p.sx * 0.5);
            reachZ = Math.max(reachZ, Math.abs(p.z) + p.sx * 0.5);
          } else {
            const c = Math.abs(Math.cos(p.rotY));
            const s = Math.abs(Math.sin(p.rotY));
            reachX = Math.max(reachX, Math.abs(p.x) + p.sx * 0.5 * c + p.sz * 0.5 * s);
            reachZ = Math.max(reachZ, Math.abs(p.z) + p.sx * 0.5 * s + p.sz * 0.5 * c);
          }
        }
      }

      // Ring 0: Inner 4-sided buttress hugging the core base (zero corner overlap guaranteed by Z >= max(reachZ, blM/2)!)
      const xDist0 = reachX + btM * 0.5 + gap;
      const zDist0 = Math.max(reachZ, blM * 0.5) + btM * 0.5 + gap;
      const ring0Slots: [number, number, number, number][] = [
        [xDist0, 0, btM, blM],   // +X (leeward priority #1!)
        [-xDist0, 0, btM, blM],  // -X (windward #2)
        [0, zDist0, blM, btM],   // +Z (#3)
        [0, -zDist0, blM, btM]   // -Z (#4)
      ];

      let placedButtressCount = 0;
      let actualRing0Courses = 0;
      for (let lv = 0; lv < maxRing0Courses; lv++) {
        const rem = pools.blocks.length - blockCursor;
        const sidesToPlace = rem >= 4 ? 4 : rem >= 2 ? 2 : 0;
        if (sidesToPlace === 0) break;
        actualRing0Courses = lv + 1;
        for (let si = 0; si < sidesToPlace; si++) {
          const bItem = pools.blocks[blockCursor++];
          addUsed(bItem.id, 1);
          buttressMassKg += bItem.massKg;
          placedButtressCount++;
          const [px, pz, sx, sz] = ring0Slots[si];
          buttressOuterR = Math.max(buttressOuterR, Math.hypot(px, pz) + btM * 0.5);
          allParts.push({
            id: `buttress-r0-${lv}-${si}`,
            courseIndex: Math.min(courses.length - 1, lv),
            itemName: bItem.name,
            kind: 'block',
            roleLabel: 'Bệ gạch ốp kè khóa cứng 4 mặt chân móng (tăng độ chắc tối đa)',
            color: bItem.color,
            x: px,
            y: lv * bhM + bhM * 0.5,
            z: pz,
            sx,
            sy: bhM,
            sz,
            rotY: 0,
            frictionMu: bItem.frictionMu ?? 0.62,
            massKg: bItem.massKg
          });
        }
      }

      // Ring 1: Stepped outer pyramid skirt if spare bricks STILL remain!
      const maxRing1Courses = Math.max(0, actualRing0Courses - 1);
      if (maxRing1Courses >= 1 && blockCursor + 2 <= pools.blocks.length) {
        const xDist1 = xDist0 + btM + gap;
        const zDist1 = Math.max(zDist0 + btM * 0.5, blM * 0.5) + btM * 0.5 + gap;
        const ring1Slots: [number, number, number, number][] = [
          [xDist1, 0, btM, blM],
          [-xDist1, 0, btM, blM],
          [0, zDist1, blM, btM],
          [0, -zDist1, blM, btM]
        ];
        for (let lv = 0; lv < maxRing1Courses; lv++) {
          const rem = pools.blocks.length - blockCursor;
          const sidesToPlace = rem >= 4 ? 4 : rem >= 2 ? 2 : 0;
          if (sidesToPlace === 0) break;
          for (let si = 0; si < sidesToPlace; si++) {
            const bItem = pools.blocks[blockCursor++];
            addUsed(bItem.id, 1);
            buttressMassKg += bItem.massKg;
            placedButtressCount++;
            const [px, pz, sx, sz] = ring1Slots[si];
            buttressOuterR = Math.max(buttressOuterR, Math.hypot(px, pz) + btM * 0.5);
            allParts.push({
              id: `buttress-r1-${lv}-${si}`,
              courseIndex: Math.min(courses.length - 1, lv),
              itemName: bItem.name,
              kind: 'block',
              roleLabel: 'Bệ gạch tam cấp vòng ngoài gia cố chân đế',
              color: bItem.color,
              x: px,
              y: lv * bhM + bhM * 0.5,
              z: pz,
              sx,
              sy: bhM,
              sz,
              rotY: 0,
              frictionMu: bItem.frictionMu ?? 0.62,
              massKg: bItem.massKg
            });
          }
        }
      }

      if (placedButtressCount > 0) {
        const bracedH = actualRing0Courses * bhM;
        for (let ci = 0; ci < courses.length; ci++) {
          if (courses[ci].yBottom < bracedH - 0.01) {
            courses[ci].supportRadiusM += btM * (ci === 0 ? 0.62 : 0.38);
          }
        }
        steps.push({
          stepNumber: steps.length + 1,
          courseRange: [0, Math.min(courses.length - 1, Math.max(0, actualRing0Courses - 1))],
          title: `Ốp kè ${placedButtressCount} viên gạch dư thành bệ tam cấp khóa 4 mặt chân móng`,
          detail: `Tận dụng toàn bộ gạch còn dư xếp ép sát 4 mặt Đông-Tây-Nam-Bắc quanh tầng đế (cao ${(bracedH * 100).toFixed(0)}cm) để mở rộng chân đế gấp đôi mà không giảm 1cm chiều cao nào!`,
          heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
        });
      }
    }
  }

  // Non-Clipping Base Ballasts & Heavy Full Bottles (clears ALL overhanging plates, buttresses & bricks in [0..ancHeight]!)
  let ballastMassKg = buttressMassKg;
  let ballastRadiusM = Math.max((courses[0]?.supportRadiusM ?? 0.1) + 0.06, buttressOuterR);
  if (mode !== 'naive') {
    const anchors = [...pools.ballasts, ...pools.heavyCyls];
    for (let i = 0; i < anchors.length; i++) {
      const anc = anchors[i];
      addUsed(anc.id, 1);
      ballastMassKg += anc.massKg;
      const sx = anc.lengthCm * 0.01;
      const sz = anc.widthCm * 0.01;
      const sy = anc.heightCm * 0.01;
      const ancHalfRadial = anc.kind === 'cylinder' ? sx * 0.5 : Math.hypot(sx * 0.5, sz * 0.5);

      // Find exact max outer radius of EVERY placed part that overlaps vertically with [0, sy + 4mm]
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
      ballastRadiusM = safeDist;

      allParts.push({
        id: `ballast-${i}`,
        courseIndex: 0,
        itemName: anc.name,
        kind: anc.kind,
        roleLabel: 'Đối trọng chắn chân móng (chống trượt & lật đế)',
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
        title: `Chèn ${anchors.length} vật nặng (${ballastMassKg.toFixed(1)}kg) quanh chân đế`,
        detail: `Đặt ${anchors[0].name} sát mép ngoài chân móng (tránh vướng rìa tấm phẳng) để khóa chân tháp.`,
        heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
      });
    }
  }

  // 3-Way Guy-Wires
  let guyWireMomentNm = 0;
  let guyWireAttachY = 0;
  if (hasLongRope && mode !== 'naive' && courses.length >= 3) {
    const ropeItem = pools.binders.find((b) => b.lengthCm >= 180)!;
    addUsed(ropeItem.id, 1);
    const attachCourseIdx = Math.min(courses.length - 1, Math.max(1, Math.floor(courses.length * 0.68)));
    const attachCourse = courses[attachCourseIdx];
    guyWireAttachY = attachCourse.yBottom + attachCourse.heightM * 0.5;
    const attachOuterR = Math.max(0.05, attachCourse.supportRadiusM);
    const guySpreadR = Math.max(0.30, yCursor * 0.38);
    guyWireMomentNm = 18.5;
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
        y: guyWireAttachY,
        z: Math.sin(ang) * attachOuterR,
        sx: 0.006,
        sy: guyWireAttachY,
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
      title: `Chằng 3 dây neo 120° từ tầng ${attachCourseIdx + 1} (${(guyWireAttachY * 100).toFixed(0)}cm)`,
      detail: `Buộc "${ropeItem.name}" quanh thân tầng ${attachCourseIdx + 1} rồi kéo căng về 3 góc 120° ghìm xuống đất.`,
      heightReachedCm: Number((yCursor * 100 + spireAddedCm).toFixed(1))
    });
  } else {
    for (const b of pools.binders) {
      if (!usedCounts.has(b.id)) addUsed(b.id, 1);
    }
  }

  const evalRes = evaluateSkeletonStability(
    courses,
    rodParts,
    ballastMassKg,
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
      ballastMassKg,
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
      ballastMassKg,
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
    const u = Math.min(it.count, usedCounts.get(it.id) ?? 0);
    if (u > 0) partsUsedSummary.push(`${u}/${it.count} ${it.name}`);
    if (u < it.count) unusedSummary.push(`${it.count - u} ${it.name}`);
  }

  return {
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
    _skeleton: {
      courses,
      rodParts,
      ballastMassKg,
      ballastRadiusM,
      guyWireMomentNm,
      guyWireAttachY
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

  if (mode === 'naive') {
    const naiveBp: TaperedBlueprint = {
      tiers: [{ pattern: 'single1', orient: 'upright', maxCourses: Math.max(1, totalBlocks) }]
    };
    return [materializeWinningTower(inventory, pools, naiveBp, 'naive', env)];
  }

  const orients = pools.distinctOrients;
  const candidates: TaperedBlueprint[] = [];
  const hasRod = pools.rods.length > 0;

  const basePatterns: CoursePattern[] = ['ring4', 'tri3', 'crib2'];
  const midPatterns: CoursePattern[] = ['tri3', 'crib2', 'single1'];
  const baseCounts = [1, 2, 3, 4, 6, 8];
  const midCounts = [0, 1, 2, 3, 4, 6];

  for (const bp of basePatterns) {
    const nB = bp === 'ring4' ? 4 : bp === 'tri3' ? 3 : 2;
    for (const bo of orients) {
      for (const bc of baseCounts) {
        if (bc > 1 && (bc - 1) * nB >= totalBlocks) continue;
        // Pure wide base-only towers (progressively capped height for extreme wind/shake survival!)
        candidates.push({
          tiers: [{ pattern: bp, orient: bo, maxCourses: bc }]
        });

        for (const mp of midPatterns) {
          const nM = mp === 'tri3' ? 3 : mp === 'crib2' ? 2 : 1;
          if (nM > nB) continue;
          for (const mo of orients) {
            for (const mc of midCounts) {
              if (mc > 0 && bc * nB + (mc - 1) * nM >= totalBlocks) continue;
              if (mc > 0 && bp === mp && bo === mo) continue;
              // Two-tier wide tower WITHOUT narrow single1 tail (huge stability boost for 20-40 brick stacks!)
              if (mc > 0 && mp !== 'single1') {
                candidates.push({
                  tiers: [
                    { pattern: bp, orient: bo, maxCourses: bc },
                    { pattern: mp, orient: mo, maxCourses: mc }
                  ]
                });
              }
              for (const to of orients) {
                const tailPat: CoursePattern = mode === 'fortress' ? 'crib2' : 'single1';
                if (mc > 0 && mp === tailPat) {
                  continue;
                }
                candidates.push({
                  tiers: [
                    { pattern: bp, orient: bo, maxCourses: bc },
                    ...(mc > 0 ? [{ pattern: mp, orient: mo, maxCourses: mc }] : []),
                    { pattern: tailPat, orient: to, maxCourses: 999 }
                  ]
                });
                if (mode === 'optimal' && to === 'flat') {
                  for (const fc of [1, 2]) {
                    candidates.push({
                      tiers: [
                        { pattern: bp, orient: bo, maxCourses: bc },
                        ...(mc > 0 ? [{ pattern: mp, orient: mo, maxCourses: mc }] : []),
                        { pattern: 'single1', orient: 'flat', maxCourses: fc },
                        { pattern: 'single1', orient: 'upright', maxCourses: 1 }
                      ]
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

  // Dedicated Chimney-Socket Blueprints when a Rod (`Gậy tre` / `Thanh dài`) is in inventory
  if (hasRod && totalBlocks >= 6) {
    for (const bp of basePatterns) {
      for (const bo of orients) {
        for (const bc of [1, 2, 3, 4, 6]) {
          for (const chimneyCourses of [4, 5, 6, 7, 8, 10]) {
            candidates.push({
              tiers: [
                { pattern: bp, orient: bo, maxCourses: bc },
                { pattern: 'crib2', orient: 'flat', maxCourses: chimneyCourses }
              ]
            });
            candidates.push({
              tiers: [
                { pattern: bp, orient: bo, maxCourses: bc },
                { pattern: 'crib2_bridge', orient: 'flat', maxCourses: 1 },
                { pattern: 'crib2', orient: 'flat', maxCourses: chimneyCourses }
              ]
            });
            candidates.push({
              tiers: [
                { pattern: bp, orient: bo, maxCourses: bc },
                { pattern: 'ring4', orient: 'flat', maxCourses: chimneyCourses }
              ]
            });
            candidates.push({
              tiers: [
                { pattern: 'ring4', orient: bo, maxCourses: bc },
                { pattern: 'crib2_bridge', orient: 'flat', maxCourses: 1 },
                { pattern: 'ring4', orient: 'flat', maxCourses: chimneyCourses }
              ]
            });
          }
        }
      }
    }
  }

  if (totalBlocks >= 12) {
    for (const bo of orients) {
      for (let c4 = 1; c4 <= 4; c4++) {
        for (let c3 = 1; c3 <= 4; c3++) {
          for (let c2 = 1; c2 <= 4; c2++) {
            candidates.push({
              tiers: [
                { pattern: 'ring4', orient: bo, maxCourses: c4 },
                { pattern: 'tri3', orient: 'flat', maxCourses: c3 },
                { pattern: 'crib2', orient: 'flat', maxCourses: c2 },
                { pattern: mode === 'fortress' ? 'crib2' : 'single1', orient: mode === 'fortress' ? 'flat' : 'upright', maxCourses: 999 }
              ]
            });
          }
        }
      }
    }
  }

  for (const o of orients) {
    candidates.push({ tiers: [{ pattern: 'single1', orient: o, maxCourses: 999 }] });
  }

  const targetSF = mode === 'fortress' ? 1.85 : mode === 'max_solid' ? 1.45 : 1.22;

  interface ScoredEntry {
    bp: TaperedBlueprint;
    heightCm: number;
    minSF: number;
    keptLightCyls: number;
    keptRod: boolean;
    score: number;
    sig: string;
  }

  const bestBySig = new Map<string, ScoredEntry>();

  const recordEntry = (
    bp: TaperedBlueprint,
    heightCm: number,
    minSF: number,
    keptLightCyls: number,
    keptRod: boolean
  ) => {
    if (heightCm <= 0) return;
    const patKey = bp.tiers.map((t) => `${t.pattern[0]}${t.orient[0]}`).join('');
    const hBucket = Math.round(heightCm / 3);
    // In 'max_solid', deduplicate strictly per height rung & keep ONLY the highest-SF (sturdiest!) architecture at each height!
    const sig =
      mode === 'max_solid'
        ? `H${hBucket}-${keptRod ? 'R' : 'M'}`
        : `${patKey}-${Math.round(heightCm / 4)}-${keptRod ? 'R' : 'M'}-${keptLightCyls}`;
    const wideBaseBonus = bp.tiers[0].pattern === 'ring4' ? 0.18 : bp.tiers[0].pattern === 'tri3' ? 0.12 : 0;
    const score =
      mode === 'fortress'
        ? heightCm * 0.65 + Math.min(4.5, minSF) * 45
        : mode === 'max_solid'
          ? heightCm + Math.min(6.0, minSF + wideBaseBonus) * 6.5
          : heightCm + Math.min(2.5, minSF) * 2.0;
    const prev = bestBySig.get(sig);
    if (!prev || minSF + wideBaseBonus > prev.minSF) {
      bestBySig.set(sig, { bp, heightCm, minSF, keptLightCyls, keptRod, score, sig });
    }
  };

  for (let i = 0; i < candidates.length; i++) {
    const bp = candidates[i];
    const res = evaluateCandidateFast(pools, bp, mode, env, targetSF);
    if (res.heightCm <= 0) continue;
    recordEntry(bp, res.heightCm, res.minSF, res.keptLightCyls, res.keptRod);

    // If this candidate mounted a spire rod, ALSO evaluate its pure-masonry counterpart (keptRod = false)
    // so if strong wind on the pole topples the tower in 3D physics, the next attempt can shed the pole cleanly!
    if (res.keptRod && pools.rods.length > 0) {
      const noRodPools: SortedPools = { ...pools, rods: [] };
      const noRodRes = evaluateCandidateFast(noRodPools, bp, mode, env, targetSF);
      if (noRodRes.heightCm > 0) {
        recordEntry(bp, noRodRes.heightCm, noRodRes.minSF, noRodRes.keptLightCyls, false);
      }
    }
  }

  const allEntries = Array.from(bestBySig.values());
  if (allEntries.length === 0) {
    return [materializeWinningTower(inventory, pools, candidates[0], mode, env, 0, false)];
  }

  // Build a rich 2-track Pareto Stability Ladder:
  // Track A: Overall Pareto frontier (tallest -> progressively higher SF)
  // Track B: Pure-masonry (rod-free) Pareto frontier so if wind topples the pole, the next attempts step smoothly through 96cm -> 72cm -> 56cm -> 40cm solid brick towers!
  const buildParetoFrontier = (list: ScoredEntry[], cap: number): ScoredEntry[] => {
    const byHeight = [...list].sort((a, b) => b.heightCm - a.heightCm || b.minSF - a.minSF);
    const out: ScoredEntry[] = [];
    let bestSF = -Infinity;
    for (const e of byHeight) {
      if (out.length >= cap) break;
      if (out.length === 0) {
        out.push(e);
        bestSF = e.minSF;
      } else if (e.minSF > bestSF * 1.11 && e.heightCm <= out[out.length - 1].heightCm - 6) {
        out.push(e);
        bestSF = e.minSF;
      }
    }
    return out;
  };

  const passingRaw = allEntries.filter((e) => e.minSF >= targetSF);
  const peakHeightCm = passingRaw.length > 0 ? Math.max(...passingRaw.map((e) => e.heightCm)) : 0;
  const peakBandCm = Math.max(4.0, peakHeightCm * 0.04);

  // In 'max_solid' ("Cao nhất, nhưng chắc nhất có thể so với chiều cao đó"):
  // Among all designs reaching the peak height band (within ~4% of peakHeightCm), rank STRICTLY by highest Safety Factor!
  const passing = [...passingRaw].sort((a, b) => {
    if (mode === 'max_solid') {
      const aInPeak = a.heightCm >= peakHeightCm - peakBandCm ? 1 : 0;
      const bInPeak = b.heightCm >= peakHeightCm - peakBandCm ? 1 : 0;
      if (aInPeak !== bInPeak) return bInPeak - aInPeak;
      if (aInPeak === 1) return b.minSF - a.minSF || b.heightCm - a.heightCm;
      return b.heightCm - a.heightCm || b.minSF - a.minSF;
    }
    return b.score - a.score;
  });

  const chosenMap = new Map<string, ScoredEntry>();
  if (passing.length > 0) {
    // Always put the #1 top-scored design first!
    chosenMap.set(passing[0].sig, passing[0]);
    // Also include up to 2 alternative base-pattern families near the top height
    for (const e of passing) {
      if (chosenMap.size >= 3) break;
      if (
        e.bp.tiers[0].pattern !== passing[0].bp.tiers[0].pattern &&
        e.heightCm >= passing[0].heightCm * 0.85
      ) {
        chosenMap.set(e.sig, e);
      }
    }
  }

  for (const e of buildParetoFrontier(passing.length > 0 ? passing : allEntries, maxLadder)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  // Interleave pure-masonry (no-rod) Pareto steps so pole-free brick pyramids are always tested too!
  const masonryOnly = allEntries.filter((e) => !e.keptRod && e.minSF >= 1.1);
  for (const e of buildParetoFrontier(masonryOnly, 6)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  // Guarantee ultra-sturdy low-CoG bunkers at the bottom of the ladder
  for (const e of buildParetoFrontier(allEntries, maxLadder)) {
    if (chosenMap.size < maxLadder) chosenMap.set(e.sig, e);
  }

  const firstPick = passing[0] ?? allEntries.sort((a, b) => b.minSF - a.minSF)[0];
  const restSorted = Array.from(chosenMap.values())
    .filter((e) => e.sig !== firstPick.sig)
    .sort((a, b) => b.heightCm - a.heightCm || b.minSF - a.minSF);
  const chosen = [firstPick, ...restSorted].slice(0, maxLadder);

  return chosen.map((entry) =>
    materializeWinningTower(
      inventory,
      entry.keptRod ? pools : { ...pools, rods: [] },
      entry.bp,
      mode,
      env,
      entry.keptLightCyls,
      entry.keptRod
    )
  );
}

export function solveOptimalBrickTower(
  inventory: TowerInventoryItem[],
  env: EnvironmentLoadConfig,
  mode: TowerBuildMode = 'optimal'
): TowerSolution {
  return solveRankedBrickTowers(inventory, env, mode, 1)[0];
}
