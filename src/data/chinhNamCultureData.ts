/**
 * Dữ liệu nguyên văn 100% (22 trang) — SỔ TAY VĂN HÓA LÀM VIỆC CHÍNH NAM (Bản in 20.08)
 * Cấu trúc hóa phục vụ tra cứu Offline tức thì (< 0.3ms): BM25 Từ khóa + Vector Ngữ Nghĩa (Embedded).
 */

export type CulturePillarId =
  | 'chu_dong'
  | 'chuyen_nghiep'
  | 'ky_luat'
  | 'toc_do'
  | 'doan_ket'
  | 'custom';

export type CultureSectionType =
  | 'essence_formula'
  | 'tier'
  | 'checklist'
  | 'levels'
  | 'golden_rules'
  | 'custom_note';

export interface CultureLevelRow {
  level: number;
  label: string;
  description: string;
}

export interface CulturePillarMeta {
  id: Exclude<CulturePillarId, 'custom'>;
  index: number;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  pageStart: number;
  pageEnd: number;
  tierCount: number;
  definition: string;
  formula: string;
  quote: string;
  levels: CultureLevelRow[];
}

export interface CultureKnowledgeChunk {
  id: string;
  pillarId: CulturePillarId;
  pillarName: string;
  pillarIcon: string;
  pillarColor: string;
  sectionType: CultureSectionType;
  sectionBadge: string;
  page: number;
  tierNumber?: number;
  title: string;
  highlightFormulaOrQuote?: string;
  bullets: string[];
  /** Dấu hiệu thiếu văn hóa (in nghiêng dưới mỗi tầng trong Sổ tay) */
  warningLack?: string;
  /** Từ khóa đồng nghĩa / ý nghĩa thực tế giúp Vector Ngữ Nghĩa bắt trúng câu hỏi biến thể */
  semanticKeywords: string[];
  isCustom?: boolean;
}

export const CHINH_NAM_PILLARS: CulturePillarMeta[] = [
  {
    id: 'chu_dong',
    index: 1,
    name: 'Văn Hóa Chủ Động',
    shortName: 'Chủ Động',
    icon: '🔥',
    color: '#f59e0b',
    pageStart: 2,
    pageEnd: 5,
    tierCount: 6,
    definition:
      'Là trạng thái mà cá nhân tự khởi tạo giá trị thay vì chờ tác động từ bên ngoài.',
    formula: 'Chủ động = Nhận trách nhiệm → Hành động trước → Tạo kết quả',
    quote:
      '“Văn hóa chủ động không phải là tính cách, mà là chuỗi hành vi được lặp lại có ý thức.”',
    levels: [
      { level: 0, label: '0 – Phụ thuộc', description: 'Chờ lệnh, làm cho xong' },
      { level: 1, label: '1 – Phản ứng', description: 'Làm khi bị yêu cầu' },
      { level: 2, label: '2 – Chủ động cá nhân', description: 'Tự làm tốt phần việc' },
      { level: 3, label: '3 – Chủ động hệ thống', description: 'Tạo giải pháp cho đội nhóm' },
      { level: 4, label: '4 – Kiến tạo', description: 'Dẫn dắt thay đổi, tạo giá trị mới' }
    ]
  },
  {
    id: 'chuyen_nghiep',
    index: 2,
    name: 'Văn Hóa Chuyên Nghiệp',
    shortName: 'Chuyên Nghiệp',
    icon: '💼',
    color: '#38bdf8',
    pageStart: 6,
    pageEnd: 9,
    tierCount: 7,
    definition:
      'Chuyên nghiệp là khả năng thực hiện công việc đúng chuẩn – đúng cam kết – đúng vai trò, ổn định theo thời gian, không phụ thuộc cảm xúc cá nhân.',
    formula: 'Chuyên nghiệp = Chuẩn mực + Nhất quán + Trách nhiệm',
    quote:
      '“Chuyên nghiệp không phải phong cách, mà là chuẩn mực hành vi ổn định theo thời gian.”',
    levels: [
      { level: 0, label: '0 – Thiếu chuẩn', description: 'Tùy hứng, cảm tính' },
      { level: 1, label: '1 – Tuân thủ', description: 'Làm theo yêu cầu' },
      { level: 2, label: '2 – Ổn định', description: 'Đúng chuẩn cá nhân' },
      { level: 3, label: '3 – Đáng tin cậy', description: 'Chuẩn mực cho đội' },
      { level: 4, label: '4 – Hình mẫu', description: 'Lan tỏa chuẩn mực' }
    ]
  },
  {
    id: 'ky_luat',
    index: 3,
    name: 'Văn Hóa Kỷ Luật',
    shortName: 'Kỷ Luật',
    icon: '🛡️',
    color: '#818cf8',
    pageStart: 10,
    pageEnd: 13,
    tierCount: 8,
    definition:
      'Kỷ luật là khả năng tự tuân thủ chuẩn mực đã cam kết, ngay cả khi không có giám sát và duy trì ổn định theo thời gian.',
    formula: 'Kỷ luật = Cam kết rõ ràng + Tuân thủ nhất quán + Tự chịu trách nhiệm',
    quote:
      '“Kỷ luật không phải siết chặt, mà là nền móng để tự do trong khuôn khổ và phát triển bền vững.”',
    levels: [
      { level: 0, label: '0 – Vô kỷ luật', description: 'Phá quy định' },
      { level: 1, label: '1 – Bị kiểm soát', description: 'Làm khi bị giám sát' },
      { level: 2, label: '2 – Tuân thủ cá nhân', description: 'Giữ kỷ luật cho mình' },
      { level: 3, label: '3 – Ổn định hệ thống', description: 'Giữ nhịp cho đội' },
      { level: 4, label: '4 – Hình mẫu', description: 'Lan tỏa kỷ luật' }
    ]
  },
  {
    id: 'toc_do',
    index: 4,
    name: 'Văn Hóa Tốc Độ',
    shortName: 'Tốc Độ',
    icon: '⚡',
    color: '#34d399',
    pageStart: 14,
    pageEnd: 17,
    tierCount: 8,
    definition:
      'Tốc độ là khả năng ra quyết định – hành động – tạo kết quả nhanh trong khuôn khổ chuẩn mực, không hy sinh chất lượng.',
    formula: 'Tốc độ = Quyết nhanh + Làm gọn + Phản hồi sớm + Hoàn thành đúng hạn',
    quote: '“Tốc độ không phải vội, mà là đi nhanh trong khuôn khổ chuẩn mực.”',
    levels: [
      { level: 0, label: '0 – Trì trệ', description: 'Chậm, phụ thuộc' },
      { level: 1, label: '1 – Phản ứng chậm', description: 'Làm khi bị thúc' },
      { level: 2, label: '2 – Đúng hạn', description: 'Tốc độ cá nhân' },
      { level: 3, label: '3 – Nhanh hệ thống', description: 'Giữ nhịp cho đội' },
      { level: 4, label: '4 – Vượt trội', description: 'Lợi thế cạnh tranh' }
    ]
  },
  {
    id: 'doan_ket',
    index: 5,
    name: 'Văn Hóa Đoàn Kết',
    shortName: 'Đoàn Kết',
    icon: '🤝',
    color: '#f472b6',
    pageStart: 18,
    pageEnd: 21,
    tierCount: 9,
    definition:
      'Đoàn kết là khả năng hợp lực bền vững giữa các cá nhân và đơn vị để đạt mục tiêu chung, đặt lợi ích tập thể lên trên lợi ích cá nhân, trong khuôn khổ chuẩn mực và tôn trọng lẫn nhau.',
    formula: 'Đoàn kết = Mục tiêu chung + Tin cậy + Phối hợp + Trách nhiệm tập thể',
    quote:
      '“Đoàn kết không phải là “ở cùng nhau”, mà là cùng hướng – cùng làm – cùng chịu trách nhiệm.”',
    levels: [
      { level: 0, label: '0 – Chia rẽ', description: 'Phe nhóm, nghi kỵ' },
      { level: 1, label: '1 – Hình thức', description: 'Hợp tác bề mặt' },
      { level: 2, label: '2 – Phối hợp cơ bản', description: 'Làm việc cùng nhau' },
      { level: 3, label: '3 – Hợp lực hiệu quả', description: 'Tin cậy – phối hợp nhịp' },
      { level: 4, label: '4 – Gắn kết cao', description: 'Sức mạnh tập thể' }
    ]
  }
];

export const CHINH_NAM_CULTURE_CHUNKS: CultureKnowledgeChunk[] = [
  // =========================================================================
  // 1. VĂN HÓA CHỦ ĐỘNG (TRANG 2 - 5 • 6 TẦNG)
  // =========================================================================
  {
    id: 'cd-essence',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'essence_formula',
    sectionBadge: 'Bản chất & Công thức',
    page: 2,
    title: 'I. Bản chất & Công thức Văn Hóa Chủ Động (6 Tầng)',
    highlightFormulaOrQuote: 'Chủ động = Nhận trách nhiệm → Hành động trước → Tạo kết quả',
    bullets: [
      'Là trạng thái mà cá nhân tự khởi tạo giá trị thay vì chờ tác động từ bên ngoài.',
      'Xây dựng Văn Hóa Chủ Động gồm 6 tầng: (1) Tư duy, (2) Hành vi cá nhân, (3) Giao tiếp & Báo cáo, (4) Quản lý công việc, (5) Trách nhiệm & Cam kết, (6) Thái độ & Năng lượng.'
    ],
    semanticKeywords: [
      'khái niệm chủ động là gì',
      'định nghĩa chủ động',
      'công thức chủ động',
      'mấy tầng chủ động 6 tầng',
      'tự giác không chờ nhắc',
      'khởi tạo giá trị'
    ]
  },
  {
    id: 'cd-t1',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 1/6',
    page: 2,
    tierNumber: 1,
    title: '1. Tầng Tư Duy (Văn Hóa Chủ Động)',
    bullets: [
      'Tư duy “Tôi chịu trách nhiệm” thay vì “Họ phải làm cho tôi”',
      'Nhìn vấn đề như việc của mình, không phải việc của ai đó',
      'Tập trung vào giải pháp, không dừng ở phân tích nguyên nhân',
      'Sẵn sàng học nhanh để giải quyết việc mới',
      'Không lệ thuộc cảm xúc, hoàn cảnh, hay người khác'
    ],
    warningLack:
      'Dấu hiệu thiếu chủ động: hay nói “tôi không biết”, “tôi chưa được dạy”, “đợi chỉ đạo”.',
    semanticKeywords: [
      'tôi không biết',
      'chưa được dạy',
      'đợi chỉ đạo chờ lệnh sếp',
      'thụ động ỷ lại',
      'tư duy giải pháp',
      'ownership làm chủ'
    ]
  },
  {
    id: 'cd-t2',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 2/6',
    page: 2,
    tierNumber: 2,
    title: '2. Tầng Hành Vi Cá Nhân (Văn Hóa Chủ Động)',
    bullets: [
      'Tự lập kế hoạch công việc ngày/tuần',
      'Tự theo dõi tiến độ, không chờ nhắc',
      'Chủ động hỏi để hiểu việc, không chờ giải thích',
      'Chuẩn bị trước khi họp, khi làm việc',
      'Tự đề xuất cải tiến quy trình, cách làm'
    ],
    warningLack:
      'Dấu hiệu thiếu chủ động: làm đúng phần được giao nhưng không quan tâm kết quả cuối.',
    semanticKeywords: [
      'lập kế hoạch ngày tuần',
      'không chờ nhắc nhở',
      'chuẩn bị trước khi họp',
      'làm hết trách nhiệm làm cho xong phần mình',
      'cải tiến quy trình'
    ]
  },
  {
    id: 'cd-t3',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 3/6',
    page: 3,
    tierNumber: 3,
    title: '3. Tầng Giao Tiếp & Báo Cáo (Văn Hóa Chủ Động)',
    bullets: [
      'Báo cáo trước khi bị hỏi',
      'Báo cáo kèm giải pháp hoặc phương án',
      'Giao tiếp rõ ràng, có cấu trúc',
      'Chủ động xác nhận lại yêu cầu',
      'Chủ động phản hồi khi có thay đổi'
    ],
    warningLack: 'Dấu hiệu thiếu chủ động: im lặng khi có vấn đề, chỉ báo khi đã trễ.',
    semanticKeywords: [
      'báo cáo trước khi hỏi',
      'im lặng giấu vấn đề báo trễ',
      'báo cáo kèm đề xuất phương án',
      'xác nhận yêu cầu'
    ]
  },
  {
    id: 'cd-t4',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 4/6',
    page: 3,
    tierNumber: 4,
    title: '4. Tầng Quản Lý Công Việc (Văn Hóa Chủ Động)',
    bullets: [
      'Ưu tiên việc quan trọng, không đợi cấp trên sắp xếp',
      'Tự quyết trong phạm vi được trao quyền',
      'Tự phân bổ thời gian hợp lý',
      'Theo sát công việc đến kết quả cuối',
      'Chủ động phối hợp liên phòng ban'
    ],
    warningLack: 'Dấu hiệu thiếu chủ động: đẩy việc lên cấp trên dù có thể tự xử lý.',
    semanticKeywords: [
      'đẩy việc lên sếp cấp trên',
      'trao quyền tự quyết',
      'phối hợp liên phòng ban',
      'sắp xếp thứ tự ưu tiên'
    ]
  },
  {
    id: 'cd-t5',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 5/6',
    page: 3,
    tierNumber: 5,
    title: '5. Tầng Trách Nhiệm & Cam Kết (Văn Hóa Chủ Động)',
    bullets: [
      'Dám nhận việc khó',
      'Dám chịu trách nhiệm khi sai',
      'Cam kết rõ ràng về thời gian – chất lượng – kết quả',
      'Theo việc đến khi hoàn tất',
      'Không đổ lỗi cho hoàn cảnh'
    ],
    warningLack: 'Dấu hiệu thiếu chủ động: hay viện lý do khách quan để thoái trách nhiệm.',
    semanticKeywords: [
      'đổ thừa đổ lỗi hoàn cảnh',
      'viện lý do khách quan thoái thác trốn trách nhiệm',
      'dám nhận việc khó dám nhận sai'
    ]
  },
  {
    id: 'cd-t6',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'tier',
    sectionBadge: 'Tầng 6/6',
    page: 3,
    tierNumber: 6,
    title: '6. Tầng Thái Độ & Năng Lượng (Văn Hóa Chủ Động)',
    bullets: [
      'Năng lượng tích cực, không chờ động lực bên ngoài',
      'Bình tĩnh trước áp lực',
      'Kiên trì đến cùng',
      'Không than phiền vô ích',
      'Sẵn sàng hỗ trợ người khác'
    ],
    warningLack:
      'Dấu hiệu thiếu chủ động: lan truyền tâm lý tiêu cực, chờ người khác thúc đẩy.',
    semanticKeywords: [
      'than vãn than phiền tiêu cực độc hại',
      'năng lượng tích cực tự tạo động lực',
      'chịu áp lực kiên trì'
    ]
  },
  {
    id: 'cd-checklist-levels',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'levels',
    sectionBadge: 'Checklist & 5 Cấp độ',
    page: 4,
    title: 'III & IV. Checklist & Phân Loại Mức Độ Chủ Động (Cấp 0 → 4)',
    bullets: [
      'Checklist (7 tiêu chí): Luôn đề xuất giải pháp • Tự quản lý thời gian và tiến độ • Báo cáo trước khi bị hỏi • Theo việc đến kết quả cuối • Nhận trách nhiệm khi có sai sót • Tự học để giải quyết vấn đề • Không chờ mệnh lệnh mới hành động.',
      'Cấp độ 0 – Phụ thuộc: Chờ lệnh, làm cho xong',
      'Cấp độ 1 – Phản ứng: Làm khi bị yêu cầu',
      'Cấp độ 2 – Chủ động cá nhân: Tự làm tốt phần việc',
      'Cấp độ 3 – Chủ động hệ thống: Tạo giải pháp cho đội nhóm',
      'Cấp độ 4 – Kiến tạo: Dẫn dắt thay đổi, tạo giá trị mới'
    ],
    semanticKeywords: [
      'cấp độ 0 1 2 3 4 chủ động',
      'phụ thuộc phản ứng chủ động cá nhân chủ động hệ thống kiến tạo',
      'checklist nhận diện người chủ động'
    ]
  },
  {
    id: 'cd-golden',
    pillarId: 'chu_dong',
    pillarName: 'Văn Hóa Chủ Động',
    pillarIcon: '🔥',
    pillarColor: '#f59e0b',
    sectionType: 'golden_rules',
    sectionBadge: 'Nguyên tắc vàng',
    page: 5,
    title: 'V. Nguyên Tắc Vàng & Đúc Kết Văn Hóa Chủ Động',
    highlightFormulaOrQuote:
      '“Văn hóa chủ động không phải là tính cách, mà là chuỗi hành vi được lặp lại có ý thức.”',
    bullets: [
      'Chủ động luôn đo bằng hành vi, không đo bằng lời nói',
      'Chủ động không phụ thuộc chức danh',
      'Chủ động có thể huấn luyện – rèn luyện – đo lường',
      'Không có văn hóa chủ động nếu lãnh đạo không làm gương'
    ],
    semanticKeywords: [
      'nguyên tắc vàng chủ động',
      'câu nói slogan trích dẫn chủ động',
      'sếp lãnh đạo làm gương',
      'chuỗi hành vi lặp lại có ý thức'
    ]
  },

  // =========================================================================
  // 2. VĂN HÓA CHUYÊN NGHIỆP (TRANG 6 - 9 • 7 TẦNG)
  // =========================================================================
  {
    id: 'cn-essence',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'essence_formula',
    sectionBadge: 'Bản chất & Công thức',
    page: 6,
    title: 'I. Bản chất & Công thức Văn Hóa Chuyên Nghiệp (7 Tầng)',
    highlightFormulaOrQuote: 'Chuyên nghiệp = Chuẩn mực + Nhất quán + Trách nhiệm',
    bullets: [
      'Chuyên nghiệp là khả năng thực hiện công việc đúng chuẩn – đúng cam kết – đúng vai trò, ổn định theo thời gian, không phụ thuộc cảm xúc cá nhân.',
      'Tiêu chí nhận diện Văn Hóa Chuyên Nghiệp gồm 7 tầng: (1) Tư duy & Thái độ, (2) Chuẩn mực công việc, (3) Quản lý thời gian & Cam kết, (4) Giao tiếp & Ứng xử, (5) Hình ảnh & Tác phong, (6) Trách nhiệm & Đạo đức nghề, (7) Học tập & Phát triển.'
    ],
    semanticKeywords: [
      'định nghĩa bản chất chuyên nghiệp là gì',
      'công thức chuyên nghiệp',
      'mấy tầng chuyên nghiệp 7 tầng',
      'không phụ thuộc cảm xúc cá nhân'
    ]
  },
  {
    id: 'cn-t1',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 1/7',
    page: 6,
    tierNumber: 1,
    title: '1. Tầng Tư Duy & Thái Độ (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Hiểu rõ vai trò, phạm vi, trách nhiệm',
      'Tách bạch cảm xúc cá nhân khỏi công việc',
      'Lấy chất lượng & uy tín làm chuẩn',
      'Tôn trọng thời gian của mình và người khác',
      'Ý thức rằng mọi hành động đại diện cho tổ chức/nghề nghiệp'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: đổ lỗi cảm xúc, “làm cho xong”, tùy hứng.',
    semanticKeywords: [
      'tách bạch cảm xúc tâm trạng vui buồn',
      'làm cho xong làm đối phó tùy hứng',
      'uy tín đại diện công ty'
    ]
  },
  {
    id: 'cn-t2',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 2/7',
    page: 6,
    tierNumber: 2,
    title: '2. Tầng Chuẩn Mực Công Việc (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Tuân thủ quy trình, tiêu chuẩn, checklist',
      'Đầu ra đạt chuẩn kỹ thuật/chất lượng',
      'Kiểm tra – soát lỗi trước khi bàn giao',
      'Ghi chép, lưu trữ, truy xuất được',
      'Làm đúng ngay từ đầu (Right-first-time)'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: làm không theo chuẩn, sửa sai lặp lại.',
    semanticKeywords: [
      'right first time right-first-time làm đúng ngay từ đầu',
      'soát lỗi kiểm tra trước bàn giao nghiệm thu',
      'lưu trữ hồ sơ truy xuất',
      'sửa sai lặp lại'
    ]
  },
  {
    id: 'cn-t3',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 3/7',
    page: 7,
    tierNumber: 3,
    title: '3. Tầng Quản Lý Thời Gian & Cam Kết (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Đúng giờ trong họp, deadline, phản hồi',
      'Cam kết rõ ràng – khả thi',
      'Báo sớm khi có rủi ro trễ hạn',
      'Ưu tiên việc theo mức độ quan trọng',
      'Không “hứa cho xong”'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: trễ hạn không báo, hứa mơ hồ.',
    semanticKeywords: [
      'trễ deadline trễ giờ đi trễ họp',
      'hứa cho xong hứa suông hứa mơ hồ',
      'báo sớm rủi ro chậm tiến độ'
    ]
  },
  {
    id: 'cn-t4',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 4/7',
    page: 7,
    tierNumber: 4,
    title: '4. Tầng Giao Tiếp & Ứng Xử (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Giao tiếp rõ ràng, lịch sự, có cấu trúc',
      'Lắng nghe đầy đủ trước khi phản hồi',
      'Trình bày dựa trên dữ liệu & lập luận',
      'Phản hồi đúng kênh, đúng người, đúng lúc',
      'Giữ thái độ tôn trọng trong bất đồng'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: nói vòng vo, công kích cá nhân.',
    semanticKeywords: [
      'công kích cá nhân cãi nhau mất bình tĩnh',
      'nói chuyện bằng số liệu dữ liệu lập luận',
      'nói vòng vo lan man',
      'lắng nghe'
    ]
  },
  {
    id: 'cn-t5',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 5/7',
    page: 7,
    tierNumber: 5,
    title: '5. Tầng Hình Ảnh & Tác Phong (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Trang phục phù hợp bối cảnh công việc',
      'Tác phong gọn gàng, ngăn nắp',
      'Hồ sơ, tài liệu trình bày chuẩn mực',
      'Không gian làm việc trật tự',
      'Thái độ điềm tĩnh, kiểm soát bản thân'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: xuề xòa, cẩu thả, mất kiểm soát.',
    semanticKeywords: [
      'ăn mặc đồng phục trang phục diện mạo',
      'gọn gàng ngăn nắp 5s bàn làm việc',
      'xuề xòa luộm thuộm cẩu thả'
    ]
  },
  {
    id: 'cn-t6',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 6/7',
    page: 7,
    tierNumber: 6,
    title: '6. Tầng Trách Nhiệm & Đạo Đức Nghề (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Nhận trách nhiệm với kết quả',
      'Trung thực trong báo cáo',
      'Bảo mật thông tin',
      'Không lợi dụng vị trí để trục lợi',
      'Tuân thủ pháp luật & chuẩn đạo đức nghề'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: che giấu sai sót, vi phạm chuẩn mực.',
    semanticKeywords: [
      'đạo đức nghề nghiệp liêm chính trung thực',
      'bảo mật thông tin lộ dữ liệu',
      'trục lợi tham nhũng hoa hồng',
      'che giấu lỗi sai sót'
    ]
  },
  {
    id: 'cn-t7',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 7/7',
    page: 8,
    tierNumber: 7,
    title: '7. Tầng Học Tập & Phát Triển (Văn Hóa Chuyên Nghiệp)',
    bullets: [
      'Cập nhật kiến thức, kỹ năng định kỳ',
      'Đón nhận phản hồi mang tính xây dựng',
      'Chủ động cải tiến cách làm',
      'Không tự mãn với kinh nghiệm cũ',
      'Học từ sai lầm và chuẩn hóa lại'
    ],
    warningLack: 'Dấu hiệu thiếu chuyên nghiệp: bảo thủ, ngại học, né phản hồi.',
    semanticKeywords: [
      'bảo thủ tự mãn kinh nghiệm cũ',
      'ngại học né góp ý phản hồi',
      'phát triển bản thân học hỏi nâng cấp kỹ năng'
    ]
  },
  {
    id: 'cn-checklist-levels',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'levels',
    sectionBadge: 'Checklist & 5 Cấp độ',
    page: 8,
    title: 'III & IV. Checklist & Phân Loại Mức Độ Chuyên Nghiệp (Cấp 0 → 4)',
    bullets: [
      'Checklist (6 tiêu chí): Hiểu rõ vai trò & làm đúng chuẩn • Đúng giờ – đúng hẹn – đúng cam kết • Giao tiếp rõ ràng, tôn trọng • Kiểm soát cảm xúc trong công việc • Chịu trách nhiệm với kết quả • Giữ uy tín cá nhân & nghề nghiệp.',
      'Cấp độ 0 – Thiếu chuẩn: Tùy hứng, cảm tính',
      'Cấp độ 1 – Tuân thủ: Làm theo yêu cầu',
      'Cấp độ 2 – Ổn định: Đúng chuẩn cá nhân',
      'Cấp độ 3 – Đáng tin cậy: Chuẩn mực cho đội',
      'Cấp độ 4 – Hình mẫu: Lan tỏa chuẩn mực'
    ],
    semanticKeywords: [
      'cấp độ 0 1 2 3 4 chuyên nghiệp',
      'thiếu chuẩn tuân thủ ổn định đáng tin cậy hình mẫu',
      'checklist chuyên nghiệp'
    ]
  },
  {
    id: 'cn-golden',
    pillarId: 'chuyen_nghiep',
    pillarName: 'Văn Hóa Chuyên Nghiệp',
    pillarIcon: '💼',
    pillarColor: '#38bdf8',
    sectionType: 'golden_rules',
    sectionBadge: 'Nguyên tắc vàng',
    page: 9,
    title: 'V. Nguyên Tắc Vàng & Đúc Kết Văn Hóa Chuyên Nghiệp',
    highlightFormulaOrQuote:
      '“Chuyên nghiệp không phải phong cách, mà là chuẩn mực hành vi ổn định theo thời gian.”',
    bullets: [
      'Chuyên nghiệp đo bằng hành vi lặp lại, không bằng hình ảnh bề ngoài',
      'Chuyên nghiệp không phụ thuộc chức danh',
      'Chuyên nghiệp có chuẩn – có đo – có rèn',
      'Lãnh đạo phải là hình mẫu'
    ],
    semanticKeywords: [
      'nguyên tắc vàng chuyên nghiệp',
      'câu nói trích dẫn chuyên nghiệp',
      'sếp lãnh đạo là hình mẫu',
      'không bằng hình ảnh bề ngoài hào nhoáng'
    ]
  },

  // =========================================================================
  // 3. VĂN HÓA KỶ LUẬT (TRANG 10 - 13 • 8 TẦNG)
  // =========================================================================
  {
    id: 'kl-essence',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'essence_formula',
    sectionBadge: 'Bản chất & Công thức',
    page: 10,
    title: 'I. Bản chất & Công thức Văn Hóa Kỷ Luật (8 Tầng)',
    highlightFormulaOrQuote:
      'Kỷ luật = Cam kết rõ ràng + Tuân thủ nhất quán + Tự chịu trách nhiệm',
    bullets: [
      'Kỷ luật là khả năng tự tuân thủ chuẩn mực đã cam kết, ngay cả khi không có giám sát và duy trì ổn định theo thời gian.',
      'Tiêu chí nhận diện Văn Hóa Kỷ Luật gồm 8 tầng: (1) Tư duy kỷ luật, (2) Cam kết & Lời hứa, (3) Tuân thủ quy trình, (4) Quản lý thời gian, (5) Hành vi nhất quán, (6) Tự kiểm soát & Tự chịu trách nhiệm, (7) Kỷ luật trong hệ thống & đội nhóm, (8) Kỷ luật học tập & cải tiến.'
    ],
    semanticKeywords: [
      'định nghĩa bản chất kỷ luật là gì',
      'công thức kỷ luật',
      'mấy tầng kỷ luật 8 tầng',
      'tự giác khi không ai giám sát'
    ]
  },
  {
    id: 'kl-t1',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 1/8',
    page: 10,
    tierNumber: 1,
    title: '1. Tầng Tư Duy Kỷ Luật (Văn Hóa Kỷ Luật)',
    bullets: [
      'Hiểu rõ quy định – tiêu chuẩn – nguyên tắc',
      'Chấp nhận kỷ luật là bảo vệ hệ thống, không phải kiểm soát cá nhân',
      'Ưu tiên nguyên tắc hơn tiện lợi',
      'Không tìm “đường tắt”',
      'Tự giác tuân thủ, không chờ nhắc'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: biện minh, linh động sai nguyên tắc.',
    semanticKeywords: [
      'đường tắt lách luật biện minh',
      'linh động sai nguyên tắc phá lệ',
      'nội quy quy định bảo vệ hệ thống'
    ]
  },
  {
    id: 'kl-t2',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 2/8',
    page: 10,
    tierNumber: 2,
    title: '2. Tầng Cam Kết & Lời Hứa (Văn Hóa Kỷ Luật)',
    bullets: [
      'Cam kết rõ ràng về việc – thời hạn – tiêu chuẩn',
      'Không hứa khi chưa chắc thực hiện',
      'Theo cam kết đến cùng',
      'Chủ động xin điều chỉnh khi có rủi ro',
      'Ghi nhận cam kết bằng văn bản/hệ thống'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: hứa miệng, đổi cam kết tùy hứng.',
    semanticKeywords: [
      'hứa miệng nói miệng không có văn bản',
      'thất hứa bẻ kèo đổi cam kết',
      'giữ lời hứa chữ tín'
    ]
  },
  {
    id: 'kl-t3',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 3/8',
    page: 11,
    tierNumber: 3,
    title: '3. Tầng Tuân Thủ Quy Trình (Văn Hóa Kỷ Luật)',
    bullets: [
      'Thực hiện đúng quy trình chuẩn',
      'Không bỏ bước vì “quen tay”',
      'Áp dụng checklist',
      'Ghi nhận – lưu vết – truy xuất được',
      'Sửa sai theo quy trình'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: làm tắt, làm theo thói quen.',
    semanticKeywords: [
      'làm tắt bỏ bước chủ quan quen tay',
      'làm theo thói quen kinh nghiệm tự phát',
      'tuân thủ sop iso quy trình checklist'
    ]
  },
  {
    id: 'kl-t4',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 4/8',
    page: 11,
    tierNumber: 4,
    title: '4. Tầng Quản Lý Thời Gian (Văn Hóa Kỷ Luật)',
    bullets: [
      'Đúng giờ họp, đúng hạn công việc',
      'Bám sát kế hoạch',
      'Không trì hoãn vô cớ',
      'Chủ động sắp xếp thứ tự ưu tiên',
      'Không viện cớ cá nhân cho việc chung'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: trễ hạn lặp lại, quản lý thời gian yếu.',
    semanticKeywords: [
      'viện cớ việc riêng bận việc nhà cá nhân',
      'trễ deadline lặp đi lặp lại cao su giờ giấc',
      'trì hoãn ngâm việc'
    ]
  },
  {
    id: 'kl-t5',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 5/8',
    page: 11,
    tierNumber: 5,
    title: '5. Tầng Hành Vi Nhất Quán (Văn Hóa Kỷ Luật)',
    bullets: [
      'Làm đúng chuẩn mỗi ngày, không chỉ khi bị kiểm tra',
      'Không “hôm nay thế này, mai thế khác”',
      'Duy trì hiệu suất ổn định',
      'Không bị cảm xúc chi phối hành vi',
      'Giữ chuẩn cả việc nhỏ'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: phong độ thất thường.',
    semanticKeywords: [
      'phong độ thất thường nắng mưa sớm nắng chiều mưa',
      'chỉ làm đối phó khi có sếp kiểm tra giám sát',
      'giữ chuẩn từ việc nhỏ nhất'
    ]
  },
  {
    id: 'kl-t6',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 6/8',
    page: 11,
    tierNumber: 6,
    title: '6. Tầng Tự Kiểm Soát & Tự Chịu Trách Nhiệm (Văn Hóa Kỷ Luật)',
    bullets: [
      'Tự phát hiện sai sót',
      'Tự sửa sai trước khi bị nhắc',
      'Nhận trách nhiệm cá nhân',
      'Không đổ lỗi hoàn cảnh',
      'Rút bài học và phòng ngừa tái phạm'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: né tránh trách nhiệm.',
    semanticKeywords: [
      'tự giác sửa lỗi trước khi bị phát hiện nhắc nhở',
      'né tránh trách nhiệm đổ thừa',
      'phòng ngừa tái phạm'
    ]
  },
  {
    id: 'kl-t7',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 7/8',
    page: 12,
    tierNumber: 7,
    title: '7. Tầng Kỷ Luật Trong Hệ Thống & Đội Nhóm (Văn Hóa Kỷ Luật)',
    bullets: [
      'Tôn trọng quy định chung',
      'Không phá vỡ nhịp đội nhóm',
      'Tuân thủ vai trò – phân công',
      'Phối hợp đúng quy ước',
      'Chấp hành quyết định tập thể'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: làm theo ý mình, phá nhịp chung.',
    semanticKeywords: [
      'tự ý làm theo ý mình ngôi sao cá nhân phá nhịp đội',
      'chấp hành quyết định chung tập thể phân công'
    ]
  },
  {
    id: 'kl-t8',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'tier',
    sectionBadge: 'Tầng 8/8',
    page: 12,
    tierNumber: 8,
    title: '8. Tầng Kỷ Luật Học Tập & Cải Tiến (Văn Hóa Kỷ Luật)',
    bullets: [
      'Thực hiện đào tạo bắt buộc',
      'Áp dụng kiến thức đã học',
      'Chuẩn hóa bài học thành quy trình',
      'Không lặp lại lỗi cũ',
      'Kiên trì cải tiến từng bước'
    ],
    warningLack: 'Dấu hiệu thiếu kỷ luật: học nhưng không áp dụng.',
    semanticKeywords: [
      'học xong để đó học không hành không áp dụng',
      'tham gia đào tạo nội bộ bắt buộc kaizen'
    ]
  },
  {
    id: 'kl-checklist-levels',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'levels',
    sectionBadge: 'Checklist & 5 Cấp độ',
    page: 13,
    title: 'III & IV. Checklist & Phân Loại Mức Độ Kỷ Luật (Cấp 0 → 4)',
    bullets: [
      'Checklist (6 tiêu chí - Trang 12): Tuân thủ quy định dù không ai giám sát • Đúng giờ – đúng hạn – đúng cam kết • Không làm tắt, không phá quy trình • Giữ chuẩn hành vi ổn định theo thời gian • Tự nhận và sửa sai • Không viện lý do cá nhân cho việc chung.',
      'Cấp độ 0 – Vô kỷ luật: Phá quy định',
      'Cấp độ 1 – Bị kiểm soát: Làm khi bị giám sát',
      'Cấp độ 2 – Tuân thủ cá nhân: Giữ kỷ luật cho mình',
      'Cấp độ 3 – Ổn định hệ thống: Giữ nhịp cho đội',
      'Cấp độ 4 – Hình mẫu: Lan tỏa kỷ luật'
    ],
    semanticKeywords: [
      'cấp độ 0 1 2 3 4 kỷ luật',
      'vô kỷ luật bị kiểm soát tuân thủ cá nhân ổn định hệ thống hình mẫu',
      'checklist kỷ luật'
    ]
  },
  {
    id: 'kl-golden',
    pillarId: 'ky_luat',
    pillarName: 'Văn Hóa Kỷ Luật',
    pillarIcon: '🛡️',
    pillarColor: '#818cf8',
    sectionType: 'golden_rules',
    sectionBadge: 'Nguyên tắc vàng',
    page: 13,
    title: 'V. Nguyên Tắc Vàng & Đúc Kết Văn Hóa Kỷ Luật',
    highlightFormulaOrQuote:
      '“Kỷ luật không phải siết chặt, mà là nền móng để tự do trong khuôn khổ và phát triển bền vững.”',
    bullets: [
      'Kỷ luật đo bằng hành vi lặp lại, không bằng lời nói',
      'Kỷ luật không phụ thuộc chức danh',
      'Kỷ luật có chuẩn – có đo – có xử lý',
      'Lãnh đạo phải gương mẫu tuyệt đối'
    ],
    semanticKeywords: [
      'nguyên tắc vàng kỷ luật',
      'tự do trong khuôn khổ nền móng phát triển bền vững',
      'sếp lãnh đạo gương mẫu tuyệt đối chế tài xử phạt'
    ]
  },

  // =========================================================================
  // 4. VĂN HÓA TỐC ĐỘ (TRANG 14 - 17 • 8 TẦNG)
  // =========================================================================
  {
    id: 'td-essence',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'essence_formula',
    sectionBadge: 'Bản chất & Công thức',
    page: 14,
    title: 'I. Bản chất & Công thức Văn Hóa Tốc Độ (8 Tầng)',
    highlightFormulaOrQuote:
      'Tốc độ = Quyết nhanh + Làm gọn + Phản hồi sớm + Hoàn thành đúng hạn',
    bullets: [
      'Tốc độ là khả năng ra quyết định – hành động – tạo kết quả nhanh trong khuôn khổ chuẩn mực, không hy sinh chất lượng.',
      'Tiêu chí nhận diện Văn Hóa Tốc Độ gồm 8 tầng: (1) Tư duy tốc độ, (2) Ra quyết định, (3) Phản hồi & Giao tiếp, (4) Thực thi công việc, (5) Quản lý thời gian, (6) Tốc độ của quy trình, (7) Học nhanh – Sửa nhanh, (8) Phối hợp & Đội nhóm.'
    ],
    semanticKeywords: [
      'định nghĩa bản chất tốc độ là gì',
      'công thức tốc độ 4 vế',
      'mấy tầng tốc độ 8 tầng',
      'nhanh không hy sinh chất lượng'
    ]
  },
  {
    id: 'td-t1',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 1/8',
    page: 14,
    tierNumber: 1,
    title: '1. Tầng Tư Duy Tốc Độ (Văn Hóa Tốc Độ)',
    bullets: [
      'Ưu tiên hành động sớm hơn chờ hoàn hảo',
      'Chấp nhận 80/20 để đi nhanh',
      'Nhận thức rằng chậm là rủi ro',
      'Không cầu toàn thái quá',
      'Sẵn sàng thử – sửa nhanh'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: phân tích kéo dài, sợ sai, trì hoãn.',
    semanticKeywords: [
      'quy tắc 80/20 pareto',
      'cầu toàn thái quá chờ hoàn hảo sợ sai phân tích quá lâu',
      'thử sai sửa nhanh agile'
    ]
  },
  {
    id: 'td-t2',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 2/8',
    page: 14,
    tierNumber: 2,
    title: '2. Tầng Ra Quyết Định (Văn Hóa Tốc Độ)',
    bullets: [
      'Quyết trong thẩm quyền',
      'Không đẩy việc lên trên khi có thể tự xử',
      'Có khung quyết định rõ (mục tiêu – phương án – rủi ro)',
      'Quyết theo dữ liệu đủ dùng',
      'Chấp nhận điều chỉnh sau khi làm'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: né quyết định, xin ý kiến vòng vo.',
    semanticKeywords: [
      'né quyết định do dự chần chừ xin ý kiến vòng vo',
      'khung quyết định mục tiêu phương án rủi ro',
      'quyết nhanh trong thẩm quyền'
    ]
  },
  {
    id: 'td-t3',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 3/8',
    page: 15,
    tierNumber: 3,
    title: '3. Tầng Phản Hồi & Giao Tiếp (Văn Hóa Tốc Độ)',
    bullets: [
      'Phản hồi thông tin nhanh, rõ, đúng kênh',
      'Xác nhận yêu cầu sớm',
      'Báo sớm khi có thay đổi',
      'Không để thông tin “treo”',
      'Giao tiếp ngắn gọn, đi thẳng trọng tâm'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: chậm phản hồi, im lặng kéo dài.',
    semanticKeywords: [
      'seen không rep ngâm tin nhắn treo thông tin chậm phản hồi',
      'đi thẳng vào trọng tâm ngắn gọn súc tích'
    ]
  },
  {
    id: 'td-t4',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 4/8',
    page: 15,
    tierNumber: 4,
    title: '4. Tầng Thực Thi Công Việc (Văn Hóa Tốc Độ)',
    bullets: [
      'Bắt tay làm ngay sau quyết định',
      'Chia nhỏ việc để chạy song song',
      'Loại bỏ bước thừa',
      'Dùng mẫu hóa, tiêu chuẩn hóa',
      'Theo sát đến khi hoàn tất'
    ],
    warningLack:
      'Dấu hiệu thiếu tốc độ: chờ đủ điều kiện mới làm, làm tuần tự không cần thiết.',
    semanticKeywords: [
      'chạy song song chia nhỏ việc template biểu mẫu',
      'chờ đủ điều kiện mới làm',
      'bắt tay làm ngay'
    ]
  },
  {
    id: 'td-t5',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 5/8',
    page: 15,
    tierNumber: 5,
    title: '5. Tầng Quản Lý Thời Gian (Văn Hóa Tốc Độ)',
    bullets: [
      'Ưu tiên việc tạo giá trị cao',
      'Hạn rõ ràng cho từng đầu việc',
      'Không kéo dài họp',
      'Chốt việc – chốt người – chốt hạn',
      'Không trì hoãn không lý do'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: họp dài, deadline mơ hồ.',
    semanticKeywords: [
      'họp hành lan man kéo dài mất thời gian',
      'chốt việc chốt người chốt hạn 3 chốt',
      'deadline mơ hồ'
    ]
  },
  {
    id: 'td-t6',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 6/8',
    page: 15,
    tierNumber: 6,
    title: '6. Tầng Tốc Độ Của Quy Trình (Văn Hóa Tốc Độ)',
    bullets: [
      'Quy trình ngắn – rõ – dễ chạy',
      'Có deadline cho từng bước',
      'Ít cấp phê duyệt',
      'Ứng dụng công nghệ',
      'Đo thời gian xử lý thực tế'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: quy trình rườm rà, nhiều cửa.',
    semanticKeywords: [
      'quan liêu giấy tờ nhiều tầng phê duyệt nhiều cửa rườm rà',
      'chuyển đổi số công nghệ tinh gọn quy trình SLA'
    ]
  },
  {
    id: 'td-t7',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 7/8',
    page: 16,
    tierNumber: 7,
    title: '7. Tầng Học Nhanh – Sửa Nhanh (Văn Hóa Tốc Độ)',
    bullets: [
      'Nhận phản hồi sớm',
      'Sửa sai ngay khi phát hiện',
      'Chuẩn hóa bài học nhanh',
      'Không lặp lỗi cũ',
      'Cải tiến liên tục theo vòng ngắn'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: sửa chậm, để lỗi kéo dài.',
    semanticKeywords: [
      'khắc phục sự cố sửa lỗi ngay lập tức vòng lặp ngắn',
      'để lỗi kéo dài'
    ]
  },
  {
    id: 'td-t8',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'tier',
    sectionBadge: 'Tầng 8/8',
    page: 16,
    tierNumber: 8,
    title: '8. Tầng Phối Hợp & Đội Nhóm (Văn Hóa Tốc Độ)',
    bullets: [
      'Phối hợp nhanh, không “giữ việc”',
      'Chia sẻ thông tin kịp thời',
      'Hỗ trợ để cả đội chạy nhanh',
      'Không chờ đủ người mới làm',
      'Giữ nhịp chung của tổ chức'
    ],
    warningLack: 'Dấu hiệu thiếu tốc độ: nghẽn phối hợp, đùn đẩy.',
    semanticKeywords: [
      'om việc giữ việc điểm nghẽn cổ chai đùn đẩy',
      'không chờ đủ người'
    ]
  },
  {
    id: 'td-checklist-levels',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'levels',
    sectionBadge: 'Checklist & 5 Cấp độ',
    page: 17,
    title: 'III & IV. Checklist & Phân Loại Mức Độ Tốc Độ (Cấp 0 → 4)',
    bullets: [
      'Checklist (6 tiêu chí - Trang 16): Quyết trong thẩm quyền • Phản hồi nhanh, rõ ràng • Bắt tay làm ngay sau quyết định • Hoàn thành đúng hoặc sớm hạn • Quy trình gọn, ít chờ đợi • Sửa sai nhanh, không kéo dài.',
      'Cấp độ 0 – Trì trệ: Chậm, phụ thuộc',
      'Cấp độ 1 – Phản ứng chậm: Làm khi bị thúc',
      'Cấp độ 2 – Đúng hạn: Tốc độ cá nhân',
      'Cấp độ 3 – Nhanh hệ thống: Giữ nhịp cho đội',
      'Cấp độ 4 – Vượt trội: Lợi thế cạnh tranh'
    ],
    semanticKeywords: [
      'cấp độ 0 1 2 3 4 tốc độ',
      'trì trệ phản ứng chậm đúng hạn nhanh hệ thống vượt trội lợi thế cạnh tranh',
      'checklist tốc độ'
    ]
  },
  {
    id: 'td-golden',
    pillarId: 'toc_do',
    pillarName: 'Văn Hóa Tốc Độ',
    pillarIcon: '⚡',
    pillarColor: '#34d399',
    sectionType: 'golden_rules',
    sectionBadge: 'Nguyên tắc vàng',
    page: 17,
    title: 'V. Nguyên Tắc Vàng & Đúc Kết Văn Hóa Tốc Độ',
    highlightFormulaOrQuote: '“Tốc độ không phải vội, mà là đi nhanh trong khuôn khổ chuẩn mực.”',
    bullets: [
      'Tốc độ đi cùng kỷ luật, không đi cùng cẩu thả',
      'Tốc độ đo bằng thời gian & kết quả, không bằng cảm nhận',
      'Tốc độ không phụ thuộc chức danh',
      'Lãnh đạo phải quyết nhanh để tổ chức chạy nhanh'
    ],
    semanticKeywords: [
      'nguyên tắc vàng tốc độ',
      'tốc độ không phải vội vàng hấp tấp ẩu cẩu thả',
      'sếp lãnh đạo quyết nhanh duyệt nhanh'
    ]
  },

  // =========================================================================
  // 5. VĂN HÓA ĐOÀN KẾT (TRANG 18 - 21 • 9 TẦNG)
  // =========================================================================
  {
    id: 'dk-essence',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'essence_formula',
    sectionBadge: 'Bản chất & Công thức',
    page: 18,
    title: 'I. Bản chất & Công thức Văn Hóa Đoàn Kết (9 Tầng)',
    highlightFormulaOrQuote:
      'Đoàn kết = Mục tiêu chung + Tin cậy + Phối hợp + Trách nhiệm tập thể',
    bullets: [
      'Đoàn kết là khả năng hợp lực bền vững giữa các cá nhân và đơn vị để đạt mục tiêu chung, đặt lợi ích tập thể lên trên lợi ích cá nhân, trong khuôn khổ chuẩn mực và tôn trọng lẫn nhau.',
      'Tiêu chí nhận diện Văn Hóa Đoàn Kết gồm 9 tầng (nhiều tầng nhất!): (1) Mục tiêu chung, (2) Niềm tin & Tin cậy, (3) Phối hợp & Hợp lực, (4) Giao tiếp tích cực, (5) Chia sẻ & Hỗ trợ, (6) Trách nhiệm tập thể, (7) Công bằng & Tôn trọng, (8) Gắn kết cảm xúc, (9) Lan tỏa & Bảo vệ văn hóa.'
    ],
    semanticKeywords: [
      'định nghĩa bản chất đoàn kết là gì',
      'công thức đoàn kết',
      'văn hóa nào nhiều tầng nhất 9 tầng',
      'hợp lực đồng đội tập thể'
    ]
  },
  {
    id: 'dk-t1',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 1/9',
    page: 18,
    tierNumber: 1,
    title: '1. Tầng Mục Tiêu Chung (Văn Hóa Đoàn Kết)',
    bullets: [
      'Hiểu rõ mục tiêu chung của đội/tổ chức',
      'Ưu tiên mục tiêu tập thể hơn thành tích cá nhân',
      'Không kéo mục tiêu chung về lợi ích riêng',
      'Sẵn sàng hy sinh cái “tôi” khi cần',
      'Hành động nhất quán với định hướng chung'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: mạnh ai nấy làm, tối ưu cục bộ.',
    semanticKeywords: [
      'hạ cái tôi ích kỷ cục bộ địa phương mạnh ai nấy làm',
      'lợi ích tập thể trên lợi ích cá nhân'
    ]
  },
  {
    id: 'dk-t2',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 2/9',
    page: 18,
    tierNumber: 2,
    title: '2. Tầng Niềm Tin & Tin Cậy (Văn Hóa Đoàn Kết)',
    bullets: [
      'Tin vào năng lực và thiện chí của đồng đội',
      'Giữ lời hứa với nhau',
      'Không nghi ngờ, không nói xấu sau lưng',
      'Minh bạch trong chia sẻ thông tin',
      'Bảo vệ uy tín của đồng đội'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: nghi kỵ, đồn đoán, chia bè phái.',
    semanticKeywords: [
      'chia bè kết phái phe cánh nói xấu sau lưng đâm sau lưng drama công sở',
      'nghi kỵ đồn đoán mất đoàn kết',
      'bảo vệ đồng đội'
    ]
  },
  {
    id: 'dk-t3',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 3/9',
    page: 19,
    tierNumber: 3,
    title: '3. Tầng Phối Hợp & Hợp Lực (Văn Hóa Đoàn Kết)',
    bullets: [
      'Phối hợp nhịp nhàng giữa các vai trò',
      'Chủ động hỗ trợ khi thấy người khác quá tải',
      'Không “giữ việc”, không giữ thông tin',
      'Làm việc theo chuỗi giá trị, không cá nhân, không tách biệt',
      'Ưu tiên hiệu quả chung hơn tốc độ cá nhân'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: đùn đẩy, nghẽn phối hợp.',
    semanticKeywords: [
      'hỗ trợ đồng đội quá tải gánh vác cùng nhau',
      'chuỗi giá trị không giữ thông tin'
    ]
  },
  {
    id: 'dk-t4',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 4/9',
    page: 19,
    tierNumber: 4,
    title: '4. Tầng Giao Tiếp Tích Cực (Văn Hóa Đoàn Kết)',
    bullets: [
      'Giao tiếp tôn trọng, xây dựng',
      'Phản hồi thẳng nhưng thiện chí',
      'Lắng nghe để hiểu, không để thắng',
      'Không công kích cá nhân',
      'Giải quyết mâu thuẫn bằng đối thoại'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: nói xấu, chỉ trích công khai.',
    semanticKeywords: [
      'lắng nghe để hiểu không phải để hơn thua thắng thua',
      'chỉ trích công khai bóc phốt mâu thuẫn xung đột nội bộ',
      'góp ý thẳng thắn thiện chí đối thoại'
    ]
  },
  {
    id: 'dk-t5',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 5/9',
    page: 19,
    tierNumber: 5,
    title: '5. Tầng Chia Sẻ & Hỗ Trợ (Văn Hóa Đoàn Kết)',
    bullets: [
      'Sẵn sàng chia sẻ kiến thức, kinh nghiệm',
      'Kèm cặp người mới/yếu hơn',
      'Không giữ bí quyết vì sợ mất lợi thế',
      'Ghi nhận công lao của người khác',
      'Hỗ trợ vượt phạm vi công việc khi cần'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: giấu nghề, giữ ghế.',
    semanticKeywords: [
      'giấu nghề giữ ghế ma cũ bắt nạt ma mới không chỉ dẫn nhân viên mới',
      'mentoring kèm cặp đào tạo người mới ghi nhận công lao'
    ]
  },
  {
    id: 'dk-t6',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 6/9',
    page: 19,
    tierNumber: 6,
    title: '6. Tầng Trách Nhiệm Tập Thể (Văn Hóa Đoàn Kết)',
    bullets: [
      'Nhận trách nhiệm chung khi đội chưa đạt',
      'Không đổ lỗi cá nhân',
      'Cùng nhau xử lý hậu quả',
      'Rút bài học cho cả đội',
      'Cam kết cải thiện cùng nhau'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: đổ lỗi, né trách nhiệm.',
    semanticKeywords: [
      'thất bại chung cùng chịu trách nhiệm không tìm người tế thần đổ lỗi cá nhân',
      'cùng xử lý hậu quả'
    ]
  },
  {
    id: 'dk-t7',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 7/9',
    page: 20,
    tierNumber: 7,
    title: '7. Tầng Công Bằng & Tôn Trọng (Văn Hóa Đoàn Kết)',
    bullets: [
      'Đối xử công bằng giữa các thành viên',
      'Tôn trọng sự khác biệt',
      'Không thiên vị',
      'Công nhận đóng góp đúng mức',
      'Phản đối bất công trong đội'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: ưu ái phe nhóm, bất công.',
    semanticKeywords: [
      'thiên vị con cưng ưu ái phe nhóm bất công',
      'công bằng tôn trọng sự khác biệt ghi nhận đúng mức'
    ]
  },
  {
    id: 'dk-t8',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 8/9',
    page: 20,
    tierNumber: 8,
    title: '8. Tầng Gắn Kết Cảm Xúc (Văn Hóa Đoàn Kết)',
    bullets: [
      'Có cảm giác thuộc về đội',
      'Quan tâm đến nhau ngoài công việc',
      'Tự hào khi là thành viên của tập thể',
      'Chia sẻ khó khăn, thành công cùng nhau',
      'Giữ tinh thần tích cực trong tập thể'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: lạnh nhạt, xa cách.',
    semanticKeywords: [
      'lạnh nhạt vô cảm xa cách thờ ơ',
      'tự hào gắn bó yêu thương quan tâm đời sống đồng nghiệp'
    ]
  },
  {
    id: 'dk-t9',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'tier',
    sectionBadge: 'Tầng 9/9',
    page: 20,
    tierNumber: 9,
    title: '9. Tầng Lan Tỏa & Bảo Vệ Văn Hóa (Văn Hóa Đoàn Kết)',
    bullets: [
      'Làm gương cho hành vi đoàn kết',
      'Nhắc nhở khi có dấu hiệu chia rẽ',
      'Bảo vệ văn hóa đội nhóm',
      'Không dung túng hành vi phá đoàn kết',
      'Lan tỏa tinh thần hợp lực sang đơn vị khác'
    ],
    warningLack: 'Dấu hiệu thiếu đoàn kết: thờ ơ với sai lệch văn hóa.',
    semanticKeywords: [
      'bảo vệ văn hóa lên tiếng nhắc nhở sai lệch không dung túng kẻ phá hoại',
      'thờ ơ im lặng trước cái xấu'
    ]
  },
  {
    id: 'dk-checklist-levels',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'levels',
    sectionBadge: 'Checklist & 5 Cấp độ',
    page: 21,
    title: 'III & IV. Checklist & Phân Loại Mức Độ Đoàn Kết (Cấp 0 → 4)',
    bullets: [
      'Checklist (6 tiêu chí - Trang 20): Hiểu và hành động vì mục tiêu chung • Tin cậy, minh bạch, giữ lời hứa • Phối hợp nhịp nhàng, không cá nhân, tách biệt • Giao tiếp tôn trọng, giải quyết mâu thuẫn tích cực • Cùng chịu trách nhiệm khi thất bại • Chia sẻ, hỗ trợ, ghi nhận lẫn nhau.',
      'Cấp độ 0 – Chia rẽ: Phe nhóm, nghi kỵ',
      'Cấp độ 1 – Hình thức: Hợp tác bề mặt',
      'Cấp độ 2 – Phối hợp cơ bản: Làm việc cùng nhau',
      'Cấp độ 3 – Hợp lực hiệu quả: Tin cậy – phối hợp nhịp',
      'Cấp độ 4 – Gắn kết cao: Sức mạnh tập thể'
    ],
    semanticKeywords: [
      'cấp độ 0 1 2 3 4 đoàn kết',
      'chia rẽ hình thức phối hợp cơ bản hợp lực hiệu quả gắn kết cao sức mạnh tập thể',
      'checklist đoàn kết'
    ]
  },
  {
    id: 'dk-golden',
    pillarId: 'doan_ket',
    pillarName: 'Văn Hóa Đoàn Kết',
    pillarIcon: '🤝',
    pillarColor: '#f472b6',
    sectionType: 'golden_rules',
    sectionBadge: 'Nguyên tắc vàng',
    page: 21,
    title: 'V. Nguyên Tắc Vàng & Đúc Kết Văn Hóa Đoàn Kết',
    highlightFormulaOrQuote:
      '“Đoàn kết không phải là “ở cùng nhau”, mà là cùng hướng – cùng làm – cùng chịu trách nhiệm.”',
    bullets: [
      'Đoàn kết không tự nhiên có, phải được xây dựng & bảo vệ',
      'Đoàn kết đo bằng hành vi hằng ngày, không bằng khẩu hiệu',
      'Đoàn kết không triệt tiêu cá nhân, mà kết nối cá nhân thành sức mạnh chung',
      'Lãnh đạo là chất keo gắn kết quan trọng nhất'
    ],
    semanticKeywords: [
      'nguyên tắc vàng đoàn kết',
      'chất keo gắn kết lãnh đạo sếp',
      'cùng hướng cùng làm cùng chịu trách nhiệm',
      'không phải ở cùng nhau hòa cả làng'
    ]
  }
];
