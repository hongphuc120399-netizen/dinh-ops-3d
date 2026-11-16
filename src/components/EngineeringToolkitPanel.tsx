import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateMathExpression } from '../utils/cipherEngine';

interface EngineeringToolkitPanelProps {
  pitchDeg?: number;
  rollDeg?: number;
  useRealSensor?: boolean;
  onToggleRealSensor?: (enable: boolean) => void;
}

type EngSubTab = 'calc' | 'inclinometer' | 'knots' | 'sketch' | 'forces';
type UnitCategory = 'length' | 'mass_force' | 'angle' | 'volume_pressure';

interface UnitDef {
  id: string;
  label: string;
  toBase: (v: number) => number;
  fromBase: (b: number) => number;
}

const UNIT_TABLES: Record<UnitCategory, { title: string; units: UnitDef[] }> = {
  length: {
    title: 'Chiều dài & Cự ly',
    units: [
      { id: 'm', label: 'Mét (m)', toBase: (v) => v, fromBase: (b) => b },
      { id: 'km', label: 'Kilomét (km)', toBase: (v) => v * 1000, fromBase: (b) => b / 1000 },
      { id: 'cm', label: 'Centimét (cm)', toBase: (v) => v / 100, fromBase: (b) => b * 100 },
      { id: 'mm', label: 'Milimét (mm)', toBase: (v) => v / 1000, fromBase: (b) => b * 1000 },
      { id: 'ft', label: 'Feet (ft)', toBase: (v) => v * 0.3048, fromBase: (b) => b / 0.3048 },
      { id: 'in', label: 'Inch (in)', toBase: (v) => v * 0.0254, fromBase: (b) => b / 0.0254 },
      { id: 'mi', label: 'Dặm (mile)', toBase: (v) => v * 1609.344, fromBase: (b) => b / 1609.344 },
      { id: 'nmi', label: 'Hải lý (nmi)', toBase: (v) => v * 1852, fromBase: (b) => b / 1852 }
    ]
  },
  mass_force: {
    title: 'Khối lượng & Lực (g = 9.81)',
    units: [
      { id: 'kg', label: 'Kilôgam (kg)', toBase: (v) => v * 9.80665, fromBase: (b) => b / 9.80665 },
      { id: 'lb', label: 'Pound (lb)', toBase: (v) => v * 4.44822, fromBase: (b) => b / 4.44822 },
      { id: 'N', label: 'Newton (N)', toBase: (v) => v, fromBase: (b) => b },
      { id: 'kN', label: 'Kilônewton (kN)', toBase: (v) => v * 1000, fromBase: (b) => b / 1000 },
      { id: 'daN', label: 'Decanewton (daN)', toBase: (v) => v * 10, fromBase: (b) => b / 10 }
    ]
  },
  angle: {
    title: 'Góc phương vị & Độ dốc',
    units: [
      { id: 'deg', label: 'Độ (°)', toBase: (v) => v, fromBase: (b) => b },
      {
        id: 'rad',
        label: 'Radian (rad)',
        toBase: (v) => (v * 180) / Math.PI,
        fromBase: (b) => (b * Math.PI) / 180
      },
      {
        id: 'mil',
        label: 'Mil NATO (6400)',
        toBase: (v) => (v * 360) / 6400,
        fromBase: (b) => (b * 6400) / 360
      },
      {
        id: 'pct',
        label: 'Độ dốc (%)',
        toBase: (v) => (Math.atan(v / 100) * 180) / Math.PI,
        fromBase: (b) =>
          Math.abs(b % 180) === 90 ? Infinity : Math.tan((b * Math.PI) / 180) * 100
      }
    ]
  },
  volume_pressure: {
    title: 'Thể tích (L) & Áp suất',
    units: [
      { id: 'L', label: 'Lít (L)', toBase: (v) => v, fromBase: (b) => b },
      { id: 'm3', label: 'Mét khối (m³)', toBase: (v) => v * 1000, fromBase: (b) => b / 1000 },
      { id: 'gal', label: 'US Gallon', toBase: (v) => v * 3.78541, fromBase: (b) => b / 3.78541 },
      { id: 'bar', label: 'Bar (≈14.5 PSI)', toBase: (v) => v * 100, fromBase: (b) => b / 100 },
      { id: 'psi', label: 'PSI', toBase: (v) => v * 6.89476, fromBase: (b) => b / 6.89476 }
    ]
  }
};

interface KnotItem {
  id: string;
  name: string;
  enName: string;
  strength: string;
  useCase: string;
  steps: string[];
  warning: string;
}

const KNOT_LIBRARY: KnotItem[] = [
  {
    id: 'reef',
    name: 'Nút Dẹt (Nút Bò Chuẩn)',
    enName: 'Square / Reef Knot',
    strength: '~45% độ bền dây',
    useCase: 'Nối 2 đầu dây CÙNG đường kính, buộc băng gạc hoặc gói đồ nhẹ.',
    steps: [
      'Đặt đầu Phải lên trên đầu Trái rồi vòng xoắn lại (nửa nút 1).',
      'Đưa đầu Trái mới lên trên đầu Phải rồi vòng xoắn ngược lại (nửa nút 2).',
      'Hai sợi cùng đầu phải nằm song song chui ra cùng phía.'
    ],
    warning: 'Không dùng nối dây chịu tải người/trục nặng vì dễ tuột khi rung lắc.'
  },
  {
    id: 'sheet_bend',
    name: 'Nút Thợ Dệt',
    enName: 'Sheet Bend',
    strength: '~55–60% độ bền dây',
    useCase: 'Nối 2 dây KHÁC đường kính (1 dây to + 1 dây nhỏ) hoặc buộc góc bạt lều.',
    steps: [
      'Gập chữ U (bight) bằng đầu dây TO hơn.',
      'Luồn đầu dây NHỎ từ dưới lên qua vòng chữ U.',
      'Vòng qua sau cả 2 nhánh chữ U, rồi nhét ngược xuống dưới chính dây nhỏ đó.'
    ],
    warning: 'Nếu tải ướt/trơn, vòng thêm 1 vòng nữa thành Double Sheet Bend.'
  },
  {
    id: 'bowline',
    name: 'Nút Ghế Đơn (Vua Các Nút)',
    enName: 'Bowline',
    strength: '~70–75% độ bền dây',
    useCase: 'Tạo vòng tròn cố định KHÔNG thắt cổ ở đầu dây; dễ tháo dù vừa kéo tải nặng.',
    steps: [
      'Tạo vòng tròn nhỏ (cái hố) trên thân dây chính sao cho đầu ngắn hướng lên.',
      'Đưa đầu dây ngắn từ dưới "chui lên khỏi hố" (thỏ ra hang).',
      'Vòng ra sau thân dây chính (quanh gốc cây), rồi chui ngược xuống lại cái hố và xiết chặt.'
    ],
    warning: 'Luôn thắt thêm nút chặn (stopper) ở đầu thừa khi dùng ở nơi rung lắc.'
  },
  {
    id: 'figure8',
    name: 'Nút Số 8 Kép (Vòng Treo Chuẩn)',
    enName: 'Figure-Eight on a Bight',
    strength: '~75–80% độ bền dây',
    useCase: 'Tạo vòng neo chịu tải lớn (leo dốc, cáng cứu thương, chốt giữ ròng rọc).',
    steps: [
      'Gập đôi đoạn đầu dây tạo thành quai chữ U (bight).',
      'Vặn chéo qua thân tạo 1 vòng hình số 8.',
      'Đưa đầu quai vòng qua sau thân rồi luồn thẳng qua vòng đỉnh trên.'
    ],
    warning: 'Chỉnh các nếp dây song song gọn gàng trước khi xiết tải để đạt lực giữ tối đa.'
  },
  {
    id: 'clove',
    name: 'Nút Thuyền Chài',
    enName: 'Clove Hitch',
    strength: '~65% độ bền dây',
    useCase: 'Khởi đầu/kết thúc nhanh khi buộc dây vào cọc gỗ đứng hoặc cột khung.',
    steps: [
      'Quấn dây 1 vòng quanh trụ sao cho đầu dây bắt chéo đè lên thân dây.',
      'Tiếp tục quấn thêm 1 vòng cùng chiều sát bên cạnh.',
      'Luồn đầu dây kẹp xuống dưới vòng quấn thứ 2 tại điểm giao chéo.'
    ],
    warning: 'Có thể tự tuột nếu trụ quay tròn trơn — nên khóa bằng 2 nửa khóa hoặc chuyển nút kéo gỗ.'
  },
  {
    id: 'timber',
    name: 'Nút Kéo Gỗ / Thắt Cổ Chày',
    enName: 'Timber Hitch',
    strength: '~70% độ bền dây',
    useCase: 'Kéo khúc gỗ, buộc cọc tre dài — kéo càng mạnh nút càng bám chặt, thả ra là gỡ được.',
    steps: [
      'Vòng dây quanh khúc gỗ, vắt đầu thừa qua thân dây chính.',
      'Quấn xoắn đầu thừa quanh chính vòng thòng lọng tối thiểu 3–5 vòng cùng chiều.',
      'Kéo căng thân dây chính để ép chặt các vòng xoắn vào vỏ gỗ.'
    ],
    warning: 'Phải giữ lực căng liên tục khi kéo hoặc thêm 1 vòng khóa trước (Killick Hitch).'
  },
  {
    id: 'taut_line',
    name: 'Nút Chạy Căng Lều',
    enName: 'Taut-Line / Midshipman Hitch',
    strength: '~65% (chỉnh tăng/giảm lực)',
    useCase: 'Căng dây bạt, lều trại, dây neo cọc mà cần trượt để tăng chỉnh độ căng.',
    steps: [
      'Vòng dây qua cọc neo, đưa đầu thừa quấn 2 vòng bên trong vòng tròn.',
      'Tiếp tục quấn thêm 1 vòng khóa nằm ở phía ngoài 2 vòng đầu.',
      'Trượt cụm nút dọc theo dây chính để căng hoặc chùng dây bạt.'
    ],
    warning: 'Làm khóa 2 vòng + 1 vòng cùng hướng xoắn thì lực giữ khi gió mạnh tốt hơn.'
  },
  {
    id: 'prusik',
    name: 'Nút Prusik (Khóa Trượt Tự Hãm)',
    enName: 'Prusik Hitch',
    strength: 'Kẹp bám dây chính mà không trượt khi có tải',
    useCase: 'Leo bám dây chính, làm chốt giữ trong hệ ròng rọc Z-Drag 3:1.',
    steps: [
      'Dùng vòng dây phụ đường kính nhỏ hơn (~60–75% dây chính).',
      'Luồn vòng dây nhỏ ôm quanh dây chính 3 vòng liên tiếp qua chính nó.',
      'Vuốt gọn các vòng nằm phẳng đều; buông tay khi có tải sẽ tự khóa cứng.'
    ],
    warning: 'Đẩy thân nút nhẹ bằng tay mới trượt; không nắm chặt thân nút khi trượt xuống.'
  },
  {
    id: 'lashing',
    name: 'Nút Ráp Cây Vuông & Chữ X',
    enName: 'Square & Diagonal Lashing',
    strength: 'Khóa kết cấu giàn/tháp gỗ tre',
    useCase: 'Buộc chặt 2 thanh gỗ giao góc 90° (Vuông) hoặc chéo tạo tam giác giằng (Chéo).',
    steps: [
      'Khởi đầu bằng nút Thuyền Chài (vuông góc) hoặc Kéo Gỗ (chéo) vào 1 cây.',
      'Quấn 3–4 vòng áp sát mặt ngoài/trong ôm qua hai thân cây.',
      'Quấn 2–3 vòng siết (frapping turns) KẸP Ở GIỮA 2 thân cây để ép chặt, rồi khóa bằng Thuyền Chài.'
    ],
    warning: 'Vòng siết ở giữa (frapping) quyết định 80% độ cứng của khớp nối!'
  }
];

const KnotDiagramSvg: React.FC<{ id: string }> = ({ id }) => {
  const strokeMain = 'var(--accent-hud, #cbd5e1)';
  const strokeAccent = 'var(--accent-gold, #c8a25a)';
  return (
    <svg width="74" height="54" viewBox="0 0 74 54" className="knot-svg">
      <rect x="1" y="1" width="72" height="52" rx="6" fill="rgba(0,0,0,0.28)" stroke="rgba(148,163,184,0.22)" />
      {id === 'reef' && (
        <g fill="none" strokeWidth="3" strokeLinecap="round">
          <path d="M8 18 C22 18, 22 36, 37 36 C52 36, 52 18, 66 18" stroke={strokeMain} />
          <path d="M8 36 C22 36, 22 18, 37 18 C52 18, 52 36, 66 36" stroke={strokeAccent} />
        </g>
      )}
      {id === 'sheet_bend' && (
        <g fill="none" strokeLinecap="round">
          <path d="M10 18 L34 18 A9 9 0 0 1 34 36 L10 36" stroke={strokeMain} strokeWidth="4.5" />
          <path d="M64 27 L42 27 C34 27, 30 12, 42 12 C52 12, 50 40, 64 40" stroke={strokeAccent} strokeWidth="2.4" />
        </g>
      )}
      {id === 'bowline' && (
        <g fill="none" strokeWidth="2.6" strokeLinecap="round">
          <path d="M22 48 L22 18" stroke={strokeMain} />
          <circle cx="22" cy="18" r="7" stroke={strokeMain} />
          <path d="M22 25 C22 44, 56 44, 56 26 C56 12, 34 12, 26 18 L14 23" stroke={strokeAccent} />
        </g>
      )}
      {id === 'figure8' && (
        <g fill="none" strokeWidth="3.2" strokeLinecap="round">
          <path d="M12 18 C24 18, 24 36, 36 36 C48 36, 48 18, 36 18 C24 18, 24 36, 12 36" stroke={strokeMain} />
          <path d="M46 18 C64 14, 64 40, 46 36" stroke={strokeAccent} />
        </g>
      )}
      {(id === 'clove' || id === 'timber' || id === 'prusik' || id === 'taut_line') && (
        <g fill="none" strokeLinecap="round">
          <rect x="8" y="21" width="58" height="12" rx="4" fill="rgba(148,163,184,0.22)" stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" />
          <path d="M24 14 L29 40 M35 14 L40 40 M46 14 L51 40" stroke={strokeAccent} strokeWidth="2.8" />
          <path d="M18 14 L56 14" stroke={strokeMain} strokeWidth="2.2" />
        </g>
      )}
      {id === 'lashing' && (
        <g fill="none" strokeLinecap="round">
          <rect x="31" y="6" width="12" height="42" rx="3" fill="rgba(148,163,184,0.22)" stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" />
          <rect x="10" y="21" width="54" height="12" rx="3" fill="rgba(148,163,184,0.22)" stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" />
          <path d="M26 15 L48 39 M48 15 L26 39" stroke={strokeAccent} strokeWidth="2.8" />
        </g>
      )}
    </svg>
  );
};

// Structure Sketchpad Types & Presets
type SketchTool = 'beam' | 'cable' | 'support' | 'load' | 'free';

type SketchShape =
  | { kind: 'beam' | 'cable' | 'load'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'support'; x: number; y: number }
  | { kind: 'free'; points: { x: number; y: number }[] };

const SKETCH_W = 620;
const SKETCH_H = 340;
const SKETCH_GRID = 20; // 20px = 0.5m reference
const SKETCH_STORAGE_KEY = 'dinh_structure_sketch_v1';

const SKETCH_PRESETS: Record<string, SketchShape[]> = {
  a_frame: [
    { kind: 'support', x: 160, y: 280 },
    { kind: 'support', x: 460, y: 280 },
    { kind: 'beam', x1: 160, y1: 280, x2: 310, y2: 80 },
    { kind: 'beam', x1: 460, y1: 280, x2: 310, y2: 80 },
    { kind: 'beam', x1: 210, y1: 210, x2: 410, y2: 210 },
    { kind: 'load', x1: 310, y1: 40, x2: 310, y2: 80 }
  ],
  bridge_truss: [
    { kind: 'support', x: 80, y: 280 },
    { kind: 'support', x: 540, y: 280 },
    { kind: 'beam', x1: 80, y1: 280, x2: 540, y2: 280 },
    { kind: 'beam', x1: 80, y1: 280, x2: 200, y2: 140 },
    { kind: 'beam', x1: 200, y1: 140, x2: 420, y2: 140 },
    { kind: 'beam', x1: 420, y1: 140, x2: 540, y2: 280 },
    { kind: 'beam', x1: 200, y1: 140, x2: 310, y2: 280 },
    { kind: 'beam', x1: 420, y1: 140, x2: 310, y2: 280 },
    { kind: 'load', x1: 310, y1: 95, x2: 310, y2: 140 }
  ],
  tower_guy: [
    { kind: 'support', x: 310, y: 280 },
    { kind: 'support', x: 120, y: 280 },
    { kind: 'support', x: 500, y: 280 },
    { kind: 'beam', x1: 310, y1: 280, x2: 310, y2: 80 },
    { kind: 'cable', x1: 310, y1: 80, x2: 120, y2: 280 },
    { kind: 'cable', x1: 310, y1: 80, x2: 500, y2: 280 },
    { kind: 'cable', x1: 310, y1: 180, x2: 120, y2: 280 },
    { kind: 'cable', x1: 310, y1: 180, x2: 500, y2: 280 }
  ],
  z_drag: [
    { kind: 'support', x: 100, y: 160 },
    { kind: 'cable', x1: 100, y1: 160, x2: 460, y2: 160 },
    { kind: 'cable', x1: 460, y1: 160, x2: 200, y2: 210 },
    { kind: 'cable', x1: 200, y1: 210, x2: 520, y2: 210 },
    { kind: 'load', x1: 460, y1: 160, x2: 540, y2: 160 }
  ]
};

export const EngineeringToolkitPanel: React.FC<EngineeringToolkitPanelProps> = ({
  pitchDeg = 0,
  rollDeg = 0,
  useRealSensor = false,
  onToggleRealSensor
}) => {
  const [subTab, setSubTab] = useState<EngSubTab>('calc');

  // 1. Calculator, Scale & Unit Converter
  const [mathExpr, setMathExpr] = useState('sqrt(3^2 + 4^2)');
  const [calcHistory, setCalcHistory] = useState<{ expr: string; res: string }[]>([]);
  const [scaleDenom, setScaleDenom] = useState('10000');
  const [scaleMapCm, setScaleMapCm] = useState('2.5');
  const [unitCat, setUnitCat] = useState<UnitCategory>('length');
  const [unitVal, setUnitVal] = useState('100');
  const [fromUnit, setFromUnit] = useState('m');
  const [toUnit, setToUnit] = useState('ft');

  // 2. Clinometer / Inclinometer State
  const [tarePitch, setTarePitch] = useState(0);
  const [simPitch, setSimPitch] = useState(18);
  const [isHeld, setIsHeld] = useState(false);
  const [heldPitch, setHeldPitch] = useState(0);
  const [heldRoll, setHeldRoll] = useState(0);
  const [heightDistM, setHeightDistM] = useState('25');
  const [eyeHeightM, setEyeHeightM] = useState('1.6');
  const [capturedAngleDeg, setCapturedAngleDeg] = useState<number | null>(null);

  // 3. Knot Library Search
  const [knotQuery, setKnotQuery] = useState('');

  // 4. Structure Sketchpad
  const [tool, setTool] = useState<SketchTool>('beam');
  const [snapGrid, setSnapGrid] = useState(true);
  const [shapes, setShapes] = useState<SketchShape[]>(() => {
    try {
      const saved = localStorage.getItem(SKETCH_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as SketchShape[];
    } catch {
      // ignore
    }
    return SKETCH_PRESETS.a_frame;
  });
  const [draftShape, setDraftShape] = useState<SketchShape | null>(null);
  const sketchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 5. Force Distribution V-Sling Calculator
  const [loadKg, setLoadKg] = useState('100');
  const [slingAngleDeg, setSlingAngleDeg] = useState(60);

  // Calculator Evaluation
  const liveMathValue = useMemo(() => evaluateMathExpression(mathExpr), [mathExpr]);

  const handleCommitMath = () => {
    const val = evaluateMathExpression(mathExpr);
    if (val === null) return;
    const formatted = Math.abs(val) < 1e-9 ? '0' : Number(val.toPrecision(10)).toString();
    setCalcHistory((prev) => [{ expr: mathExpr, res: formatted }, ...prev].slice(0, 6));
  };

  // Scale Calculation
  const scaleStats = useMemo(() => {
    const d = Math.max(1, parseFloat(scaleDenom) || 1);
    const cm = parseFloat(scaleMapCm) || 0;
    const realCm = cm * d;
    const realM = realCm / 100;
    const realKm = realM / 1000;
    return { realM, realKm, oneCmM: d / 100 };
  }, [scaleDenom, scaleMapCm]);

  // Unit Conversion Table
  const convertedVal = useMemo(() => {
    const table = UNIT_TABLES[unitCat].units;
    const f = table.find((u) => u.id === fromUnit) || table[0];
    const t = table.find((u) => u.id === toUnit) || table[1] || table[0];
    const num = parseFloat(unitVal);
    if (!Number.isFinite(num)) return '--';
    const base = f.toBase(num);
    const out = t.fromBase(base);
    if (!Number.isFinite(out)) return '∞ (Thẳng đứng)';
    return Number(out.toPrecision(8)).toString();
  }, [unitCat, unitVal, fromUnit, toUnit]);

  // Clinometer Reading (Live hardware or Simulator slider)
  const rawActivePitch = useRealSensor ? pitchDeg - tarePitch : simPitch - tarePitch;
  const rawActiveRoll = useRealSensor ? rollDeg : 0;
  const displayPitch = isHeld ? heldPitch : rawActivePitch;
  const displayRoll = isHeld ? heldRoll : rawActiveRoll;
  const pitchRad = (displayPitch * Math.PI) / 180;
  const slopePct = Math.abs(displayPitch) >= 89.5 ? Infinity : Math.tan(pitchRad) * 100;
  const effectiveAngleForHeight = capturedAngleDeg ?? Math.abs(displayPitch);
  const measuredHeightM =
    (parseFloat(heightDistM) || 0) * Math.tan((Math.min(89, effectiveAngleForHeight) * Math.PI) / 180) +
    (parseFloat(eyeHeightM) || 0);

  // Save sketch automatically
  useEffect(() => {
    try {
      localStorage.setItem(SKETCH_STORAGE_KEY, JSON.stringify(shapes));
    } catch {
      // ignore storage quota errors
    }
  }, [shapes]);

  // Structural Members / Joints Counter
  const sketchMetrics = useMemo(() => {
    const memberCount = shapes.filter((s) => s.kind === 'beam' || s.kind === 'cable').length;
    const ptSet = new Set<string>();
    for (const s of shapes) {
      if (s.kind === 'beam' || s.kind === 'cable') {
        ptSet.add(`${Math.round(s.x1 / 10)},${Math.round(s.y1 / 10)}`);
        ptSet.add(`${Math.round(s.x2 / 10)},${Math.round(s.y2 / 10)}`);
      }
    }
    const joints = ptSet.size;
    const minReq = Math.max(0, 2 * joints - 3);
    const isStiff = memberCount > 0 && memberCount >= minReq;
    return { memberCount, joints, minReq, isStiff };
  }, [shapes]);

  // Render Sketch Canvas
  useEffect(() => {
    if (subTab !== 'sketch') return;
    const canvas = sketchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#070a0f';
    ctx.fillRect(0, 0, SKETCH_W, SKETCH_H);

    // Technical grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= SKETCH_W; x += SKETCH_GRID) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, SKETCH_H);
      ctx.stroke();
    }
    for (let y = 0; y <= SKETCH_H; y += SKETCH_GRID) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SKETCH_W, y);
      ctx.stroke();
    }

    const drawItem = (s: SketchShape, isPreview = false) => {
      ctx.save();
      if (isPreview) ctx.globalAlpha = 0.65;
      if (s.kind === 'beam') {
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();

        // Joint nodes + Length & angle annotation
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(s.x1, s.y1, 4, 0, Math.PI * 2);
        ctx.arc(s.x2, s.y2, 4, 0, Math.PI * 2);
        ctx.fill();

        const lenPx = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (lenPx >= 24) {
          const lenM = (lenPx / (SKETCH_GRID * 2)).toFixed(1); // 40px = 1m
          const angDeg = Math.round(Math.abs((Math.atan2(s.y1 - s.y2, s.x2 - s.x1) * 180) / Math.PI));
          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`${lenM}m (${angDeg}°)`, (s.x1 + s.x2) / 2 + 5, (s.y1 + s.y2) / 2 - 5);
        }
      } else if (s.kind === 'cable') {
        ctx.strokeStyle = '#d49b54';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      } else if (s.kind === 'support') {
        ctx.fillStyle = 'rgba(132, 166, 125, 0.32)';
        ctx.strokeStyle = '#84a67d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - 11, s.y + 18);
        ctx.lineTo(s.x + 11, s.y + 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === 'load') {
        ctx.strokeStyle = '#c26d68';
        ctx.fillStyle = '#c26d68';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        ctx.beginPath();
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - 9 * Math.cos(a - 0.5), s.y2 - 9 * Math.sin(a - 0.5));
        ctx.lineTo(s.x2 - 9 * Math.cos(a + 0.5), s.y2 - 9 * Math.sin(a + 0.5));
        ctx.closePath();
        ctx.fill();
      } else if (s.kind === 'free' && s.points.length > 1) {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    shapes.forEach((s) => drawItem(s));
    if (draftShape) drawItem(draftShape, true);
  }, [subTab, shapes, draftShape]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = sketchCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * SKETCH_W;
    let y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * SKETCH_H;
    if (snapGrid && tool !== 'free') {
      x = Math.round(x / SKETCH_GRID) * SKETCH_GRID;
      y = Math.round(y / SKETCH_GRID) * SKETCH_GRID;
    }
    return {
      x: Math.max(0, Math.min(SKETCH_W, x)),
      y: Math.max(0, Math.min(SKETCH_H, y))
    };
  };

  // V-Sling Tension Physics
  const slingStats = useMemo(() => {
    const wKg = Math.max(0, parseFloat(loadKg) || 0);
    const halfRad = ((slingAngleDeg / 2) * Math.PI) / 180;
    const cosHalf = Math.max(0.05, Math.cos(halfRad));
    const perLegKg = wKg / (2 * cosHalf);
    const factorPct = Math.round((perLegKg / Math.max(0.01, wKg)) * 100);
    const perLegKn = (perLegKg * 9.80665) / 1000;
    return { perLegKg, perLegKn, factorPct, danger: slingAngleDeg >= 120 };
  }, [loadKg, slingAngleDeg]);

  const filteredKnots = KNOT_LIBRARY.filter((k) => {
    if (!knotQuery.trim()) return true;
    const q = knotQuery.toLowerCase();
    return (
      k.name.toLowerCase().includes(q) ||
      k.enName.toLowerCase().includes(q) ||
      k.useCase.toLowerCase().includes(q)
    );
  });

  return (
    <div className="toolkit-body eng-toolkit-root">
      <div className="subtab-strip">
        <button type="button" className={subTab === 'calc' ? 'active' : ''} onClick={() => setSubTab('calc')}>
          🧮 Máy Tính
        </button>
        <button
          type="button"
          className={subTab === 'inclinometer' ? 'active' : ''}
          onClick={() => setSubTab('inclinometer')}
        >
          📐 Góc Nghiêng
        </button>
        <button type="button" className={subTab === 'knots' ? 'active' : ''} onClick={() => setSubTab('knots')}>
          🪢 Nút Dây
        </button>
        <button type="button" className={subTab === 'sketch' ? 'active' : ''} onClick={() => setSubTab('sketch')}>
          ✏️ Phác Thảo
        </button>
        <button type="button" className={subTab === 'forces' ? 'active' : ''} onClick={() => setSubTab('forces')}>
          🏗️ Lực & Ổn Định
        </button>
      </div>

      {subTab === 'calc' && (
        <div className="eng-stack">
          {/* 1. Expression Scientific Calculator */}
          <div className="eng-card">
            <div className="eng-card-head">
              <strong>🧮 Máy Tính Khoa Học (Góc tính theo Độ °)</strong>
              <span className="eng-result-pill">
                = {liveMathValue === null ? 'Lỗi cú pháp' : Number(liveMathValue.toPrecision(9)).toString()}
              </span>
            </div>
            <div className="calc-input-row">
              <input
                type="text"
                value={mathExpr}
                onChange={(e) => setMathExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitMath();
                }}
                placeholder="VD: 120 * cos(30) + sqrt(5^2 + 12^2)"
              />
              <button type="button" className="secondary-action-btn" onClick={handleCommitMath}>
                = Lưu
              </button>
            </div>
            <div className="calc-fn-pad">
              {['sin(', 'cos(', 'tan(', 'sqrt(', '^2', 'pi', '(', ')', '/', 'C'].map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => (tok === 'C' ? setMathExpr('') : setMathExpr((p) => p + tok))}
                >
                  {tok}
                </button>
              ))}
            </div>
            {calcHistory.length > 0 && (
              <div className="calc-history-list">
                {calcHistory.map((h, i) => (
                  <button key={i} type="button" onClick={() => setMathExpr(h.expr)}>
                    {h.expr} = <strong>{h.res}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. Scale Calculator */}
          <div className="eng-card">
            <div className="eng-card-head">
              <strong>📏 Tính Tỷ Lệ Bản Đồ / Bản Vẽ (1 : {scaleDenom || '1'})</strong>
            </div>
            <div className="two-col-inputs">
              <div className="form-group">
                <label>Tỷ lệ (1 : N)</label>
                <input
                  type="number"
                  min={1}
                  value={scaleDenom}
                  onChange={(e) => setScaleDenom(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Đo trên bản vẽ/bản đồ (cm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={scaleMapCm}
                  onChange={(e) => setScaleMapCm(e.target.value)}
                />
              </div>
            </div>
            <div className="preset-chips">
              {[50, 100, 1000, 5000, 10000, 25000].map((s) => (
                <button key={s} type="button" onClick={() => setScaleDenom(String(s))}>
                  1:{s.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="eng-stat-line">
              Thực tế: <strong>{scaleStats.realM.toFixed(2)} m</strong> ({scaleStats.realKm.toFixed(4)} km) •
              1 cm = <strong>{scaleStats.oneCmM} m</strong>
            </div>
          </div>

          {/* 3. Unit Converter */}
          <div className="eng-card">
            <div className="eng-card-head">
              <strong>🔄 Chuyển Đổi Đơn Vị</strong>
            </div>
            <div className="chip-row">
              {(Object.keys(UNIT_TABLES) as UnitCategory[]).map((catKey) => (
                <button
                  key={catKey}
                  type="button"
                  className={unitCat === catKey ? 'active' : ''}
                  onClick={() => {
                    setUnitCat(catKey);
                    const list = UNIT_TABLES[catKey].units;
                    setFromUnit(list[0].id);
                    setToUnit((list[1] || list[0]).id);
                  }}
                >
                  {UNIT_TABLES[catKey].title}
                </button>
              ))}
            </div>
            <div className="unit-conv-row">
              <input
                type="number"
                value={unitVal}
                onChange={(e) => setUnitVal(e.target.value)}
              />
              <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
                {UNIT_TABLES[unitCat].units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
                {UNIT_TABLES[unitCat].units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="eng-stat-line">
              Kết quả quy đổi: <strong>{convertedVal} {toUnit}</strong>
            </div>
          </div>
        </div>
      )}

      {subTab === 'inclinometer' && (
        <div className="eng-stack">
          <div className="eng-card clinometer-card">
            <div className="eng-card-head">
              <strong>📐 Đo Góc Nghiêng (Clinometer Cảm Biến)</strong>
              {onToggleRealSensor && (
                <button
                  type="button"
                  className={`mini-toggle-btn ${useRealSensor ? 'active' : ''}`}
                  onClick={() => onToggleRealSensor(!useRealSensor)}
                >
                  {useRealSensor ? '🛰️ Đang dùng Cảm Biến' : '🎛️ Đang Giả Lập'}
                </button>
              )}
            </div>

            <div className="clinometer-dial-row">
              <svg width="110" height="110" viewBox="0 0 120 120" className="clinometer-svg">
                <circle cx="60" cy="60" r="54" fill="rgba(0,0,0,0.35)" stroke="var(--accent-border)" strokeWidth="2" />
                <line x1="6" y1="60" x2="114" y2="60" stroke="rgba(148,163,184,0.35)" strokeDasharray="3,3" />
                <line x1="60" y1="6" x2="60" y2="114" stroke="rgba(148,163,184,0.35)" strokeDasharray="3,3" />
                <g transform={`rotate(${-displayPitch} 60 60)`}>
                  <line x1="16" y1="60" x2="104" y2="60" stroke="var(--accent-hud)" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="100" cy="60" r="4" fill="var(--accent-gold)" />
                </g>
                <circle cx="60" cy="60" r="4" fill="#f8fafc" />
              </svg>

              <div className="clinometer-metrics">
                <div>
                  <small>GÓC NGHIÊNG (PITCH)</small>
                  <strong className="clino-big">{displayPitch.toFixed(1)}°</strong>
                </div>
                <div>
                  <small>ĐỘ DỐC (%) / ROLL</small>
                  <strong>
                    {Number.isFinite(slopePct) ? `${slopePct.toFixed(1)}%` : '∞'} • {displayRoll.toFixed(1)}°
                  </strong>
                </div>
              </div>
            </div>

            <div className="clino-actions-row">
              <button
                type="button"
                className="secondary-action-btn"
                onClick={() => setTarePitch(useRealSensor ? pitchDeg : simPitch)}
              >
                🎯 Đặt mốc 0° (Tare)
              </button>
              <button type="button" className="secondary-action-btn" onClick={() => setTarePitch(0)}>
                ↺ Gốc 0° máy
              </button>
              <button
                type="button"
                className={`secondary-action-btn ${isHeld ? 'active-pill-btn' : ''}`}
                onClick={() => {
                  if (!isHeld) {
                    setHeldPitch(rawActivePitch);
                    setHeldRoll(rawActiveRoll);
                  }
                  setIsHeld((v) => !v);
                }}
              >
                {isHeld ? '▶️ Bỏ giữ (HOLD)' : '⏸️ Giữ số đo'}
              </button>
            </div>

            {!useRealSensor && (
              <div className="sim-compass-row">
                <label>Thanh chỉnh góc nghiêng giả lập (test trên PC): {simPitch}°</label>
                <input
                  type="range"
                  min={-65}
                  max={65}
                  value={simPitch}
                  onChange={(e) => setSimPitch(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <div className="eng-card">
            <div className="eng-card-head">
              <strong>🌲 Tính Chiều Cao Vật Thể Qua Góc Nghiêng</strong>
            </div>
            <p className="helper-note">
              Đứng cách chân cây/trụ cổng <strong>D (m)</strong>, ngắm mép điện thoại lên đỉnh vật rồi chốt góc θ:
            </p>
            <div className="two-col-inputs">
              <div className="form-group">
                <label>Khoảng cách ngang D (m)</label>
                <input
                  type="number"
                  value={heightDistM}
                  onChange={(e) => setHeightDistM(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Độ cao tầm mắt h₀ (m)</label>
                <input
                  type="number"
                  step="0.1"
                  value={eyeHeightM}
                  onChange={(e) => setEyeHeightM(e.target.value)}
                />
              </div>
            </div>
            <div className="clino-actions-row">
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => setCapturedAngleDeg(Number(Math.abs(displayPitch).toFixed(1)))}
              >
                📌 Chốt góc đang đo ({Math.abs(displayPitch).toFixed(1)}°)
              </button>
              {capturedAngleDeg !== null && (
                <button
                  type="button"
                  className="secondary-action-btn"
                  onClick={() => setCapturedAngleDeg(null)}
                >
                  ↺ Theo góc live
                </button>
              )}
            </div>
            <div className="eng-stat-line">
              Góc θ = <strong>{effectiveAngleForHeight.toFixed(1)}°</strong> → Chiều cao H ≈{' '}
              <strong>{measuredHeightM.toFixed(2)} m</strong>
            </div>
          </div>
        </div>
      )}

      {subTab === 'knots' && (
        <div className="eng-stack">
          <input
            type="text"
            className="search-input"
            value={knotQuery}
            onChange={(e) => setKnotQuery(e.target.value)}
            placeholder="🔍 Tìm nhanh: ghế đơn, số 8, thợ dệt, ráp cây, prusik, lều..."
          />
          <div className="knots-list">
            {filteredKnots.map((k) => (
              <div key={k.id} className="eng-card knot-card">
                <div className="knot-top">
                  <KnotDiagramSvg id={k.id} />
                  <div className="knot-meta">
                    <strong>{k.name}</strong>
                    <span className="mono-sub">
                      {k.enName} • {k.strength}
                    </span>
                    <p>{k.useCase}</p>
                  </div>
                </div>
                <ol className="knot-steps">
                  {k.steps.map((st, idx) => (
                    <li key={idx}>{st}</li>
                  ))}
                </ol>
                <div className="knot-warn">⚠️ {k.warning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'sketch' && (
        <div className="eng-stack">
          <div className="sketch-toolbar">
            {(
              [
                ['beam', '➖ Thanh gỗ'],
                ['cable', '┄ Dây neo'],
                ['support', '▲ Gối neo'],
                ['load', '⬇ Tải trọng'],
                ['free', '✏️ Tự do']
              ] as [SketchTool, string][]
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={tool === k ? 'active' : ''}
                onClick={() => setTool(k)}
              >
                {lbl}
              </button>
            ))}
            <button
              type="button"
              className={snapGrid ? 'active' : ''}
              onClick={() => setSnapGrid((v) => !v)}
            >
              ⊞ Bắt lưới
            </button>
          </div>

          <canvas
            ref={sketchCanvasRef}
            width={SKETCH_W}
            height={SKETCH_H}
            className="structure-canvas"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const pt = getCanvasPoint(e);
              if (tool === 'support') {
                setShapes((prev) => [...prev, { kind: 'support', x: pt.x, y: pt.y }]);
              } else if (tool === 'free') {
                setDraftShape({ kind: 'free', points: [pt] });
              } else {
                setDraftShape({ kind: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
              }
            }}
            onPointerMove={(e) => {
              if (!draftShape) return;
              const pt = getCanvasPoint(e);
              if (draftShape.kind === 'free') {
                setDraftShape({ ...draftShape, points: [...draftShape.points, pt] });
              } else if (draftShape.kind !== 'support') {
                setDraftShape({ ...draftShape, x2: pt.x, y2: pt.y });
              }
            }}
            onPointerUp={() => {
              if (!draftShape) return;
              if (draftShape.kind === 'free') {
                if (draftShape.points.length > 1) setShapes((prev) => [...prev, draftShape]);
              } else if (draftShape.kind !== 'support') {
                if (Math.hypot(draftShape.x2 - draftShape.x1, draftShape.y2 - draftShape.y1) > 6) {
                  setShapes((prev) => [...prev, draftShape]);
                }
              }
              setDraftShape(null);
            }}
          />

          <div className="eng-stat-line">
            1 ô lưới = 0.5m • Thanh/Dây M = <strong>{sketchMetrics.memberCount}</strong> • Nút J ={' '}
            <strong>{sketchMetrics.joints}</strong> •{' '}
            {sketchMetrics.memberCount === 0
              ? 'Chạm kéo trên lưới để phác thảo'
              : sketchMetrics.isStiff
                ? `✅ Đạt ngưỡng tam giác cứng (M ≥ 2J−3 = ${sketchMetrics.minReq})`
                : `⚠️ Khung dễ xô nghiêng (nên thêm giằng chéo đạt M ≥ ${sketchMetrics.minReq})`}
          </div>

          <div className="sketch-actions-row">
            <button type="button" onClick={() => setShapes(SKETCH_PRESETS.a_frame)}>
              Mẫu: Khung Chữ A
            </button>
            <button type="button" onClick={() => setShapes(SKETCH_PRESETS.bridge_truss)}>
              Mẫu: Cầu Giàn
            </button>
            <button type="button" onClick={() => setShapes(SKETCH_PRESETS.tower_guy)}>
              Mẫu: Tháp Dây Neo
            </button>
            <button type="button" onClick={() => setShapes(SKETCH_PRESETS.z_drag)}>
              Mẫu: Ròng Rọc Z-Drag
            </button>
            <button type="button" onClick={() => setShapes((p) => p.slice(0, -1))}>
              ↩ Hoàn tác
            </button>
            <button type="button" onClick={() => setShapes([])}>
              🧹 Xóa trắng
            </button>
            <button
              type="button"
              onClick={() => {
                const c = sketchCanvasRef.current;
                if (!c) return;
                const a = document.createElement('a');
                a.href = c.toDataURL('image/png');
                a.download = `phac-thao-ket-cau-${Date.now()}.png`;
                a.click();
              }}
            >
              📥 Xuất PNG
            </button>
          </div>
        </div>
      )}

      {subTab === 'forces' && (
        <div className="eng-stack">
          {/* Interactive V-Sling / Guy-Wire Force Calculator */}
          <div className="eng-card">
            <div className="eng-card-head">
              <strong>⚖️ Tính Lực Căng Dây Chữ V Theo Góc Mở (T = W / 2cos(α/2))</strong>
            </div>
            <div className="two-col-inputs">
              <div className="form-group">
                <label>Tổng tải trọng W (kg)</label>
                <input
                  type="number"
                  min={1}
                  value={loadKg}
                  onChange={(e) => setLoadKg(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Góc mở 2 nhánh dây α = {slingAngleDeg}°</label>
                <input
                  type="range"
                  min={0}
                  max={170}
                  step={5}
                  value={slingAngleDeg}
                  onChange={(e) => setSlingAngleDeg(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="force-diagram-row">
              <svg width="92" height="72" viewBox="0 0 92 72">
                <rect x="1" y="1" width="90" height="70" rx="6" fill="rgba(0,0,0,0.3)" stroke="var(--accent-border)" />
                <line
                  x1="46"
                  y1="48"
                  x2={46 - Math.sin(((slingAngleDeg / 2) * Math.PI) / 180) * 34}
                  y2={48 - Math.cos(((slingAngleDeg / 2) * Math.PI) / 180) * 34}
                  stroke={slingStats.danger ? '#c26d68' : '#d49b54'}
                  strokeWidth="2.5"
                />
                <line
                  x1="46"
                  y1="48"
                  x2={46 + Math.sin(((slingAngleDeg / 2) * Math.PI) / 180) * 34}
                  y2={48 - Math.cos(((slingAngleDeg / 2) * Math.PI) / 180) * 34}
                  stroke={slingStats.danger ? '#c26d68' : '#d49b54'}
                  strokeWidth="2.5"
                />
                <circle cx="46" cy="54" r="7" fill="var(--accent-surface)" stroke="var(--accent-hud)" />
              </svg>
              <div className="force-readout">
                <div>
                  Lực căng mỗi nhánh: <strong>{slingStats.perLegKg.toFixed(1)} kgf</strong> (
                  {slingStats.perLegKn.toFixed(2)} kN)
                </div>
                <div>
                  Tỷ lệ lực / tải: <strong>{slingStats.factorPct}%</strong>
                </div>
                <div className={slingStats.danger ? 'force-danger-txt' : 'mono-sub'}>
                  {slingStats.danger
                    ? '⚠️ Cảnh báo góc mở ≥ 120°: Lực kéo trên MỖI sợi dây vượt quá 100% tải trọng! Hãy thu hẹp góc ≤ 90°.'
                    : '✅ Góc an toàn (khuyên dùng ≤ 60°–90°).'}
                </div>
              </div>
            </div>
          </div>

          {/* Engineering Reference Cards */}
          <div className="formula-ref-list">
            <div className="formula-card">
              <strong>🔺 Quy tắc Tam Giác Hóa (Triangulation)</strong>
              <p>
                Khung hình chữ nhật rất dễ bị xô thành hình bình hành khi có lực ngang. Luôn đóng thêm{' '}
                <strong>thanh giằng chéo</strong> biến ô vuông thành 2 hình tam giác — tam giác là hình duy nhất không biến dạng cạnh khi chịu lực.
              </p>
            </div>
            <div className="formula-card">
              <strong>🪵 Nén (Compression) vs Kéo (Tension)</strong>
              <p>
                Cột chống chịu <strong>Nén</strong> (thanh càng dài càng dễ oằn bụng → cần thanh giằng ngang chia đôi chiều dài). Dây chằng chỉ chịu <strong>Kéo</strong> (bố trí góc 45° so với mặt đất để cân bằng lực giữ ngang và lực đè xuống).
              </p>
            </div>
            <div className="formula-card">
              <strong>⛺ Chân Đế, Cọc Neo & Trọng Tâm</strong>
              <p>
                Cắm cọc lều nghiêng <strong>45° ngược hướng kéo của dây</strong>, dùng nút neo đôi ở đất mềm. Với giàn tháp cao, mở rộng chân đế tối thiểu bằng 1/3 chiều cao để giữ trọng tâm luôn rơi trong mặt đáy.
              </p>
            </div>
            <div className="formula-card">
              <strong>⚙️ Hệ Ròng Rọc Lợi Lực (Z-Drag 3:1)</strong>
              <p>
                Mỗi puly di động gắn vào vật tải nhân lực kéo lên theo lý thuyết (2:1, 3:1 với nút Prusik kẹp hoàn hồi). Trong thực tế có ma sát nên lợi lực thực đạt khoảng 70–85% lý thuyết; lưu ý lực tác động lên điểm neo gốc bằng tổng tải cộng lực kéo.
              </p>
            </div>
          </div>
          <p className="helper-note">
            ⓘ Mọi chỉ số & hướng dẫn kỹ thuật ở trên mang tính tham khảo thực địa / dựng trại. Với công trình chịu tải người hoặc kết cấu cố định, luôn kiểm tra hệ số an toàn thực tế tại hiện trường.
          </p>
        </div>
      )}
    </div>
  );
};
