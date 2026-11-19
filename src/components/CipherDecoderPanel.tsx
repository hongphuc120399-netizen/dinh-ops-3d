import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bruteForceCaesar25,
  caesarTransform,
  clearSolvedCiphers,
  decodeA1Z26,
  decodeAtbash,
  decodeBase64,
  decodeMorse,
  decodeRot13,
  deleteSolvedCipher,
  detectCoordinateInText,
  encodeA1Z26,
  encodeBase64,
  encodeMorse,
  loadSolvedCiphers,
  MORSE_TABLE,
  playMorseAudio,
  reverseText,
  saveSolvedCipher,
  scorePlaintextLikelihood,
  type CipherType,
  type DetectedCoord,
  type SolvedCipherEntry
} from '../utils/cipherEngine';

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

interface TextDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

interface CipherDecoderPanelProps {
  onPinCoordinate: (lat: number, lon: number, label: string, note: string) => void;
}

type DecoderSubTab = 'quick' | 'history';

interface DecodedCardRow {
  key: string;
  cipherType: CipherType;
  label: string;
  output: string;
  coord: DetectedCoord | null;
  confidence: number; // higher = shown at top
  badge?: string;
  audioMorse?: string;
}

const REFERENCE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const FIELD_FORMULAS: { title: string; formula: string; note: string }[] = [
  {
    title: 'Định lý Pythagoras (Tam giác vuông)',
    formula: 'c = √(a² + b²)  |  a = √(c² - b²)',
    note: 'Tính cạnh huyền, đường chéo kết cấu, hoặc độ dài dây chằng.'
  },
  {
    title: 'Chiều cao vật thể trên sườn dốc (2 góc)',
    formula: 'H = D · (tan(θ_đỉnh) − tan(θ_chân))',
    note: 'Chính xác trên sườn núi dốc; đất phẳng dùng H = D · tan(θ) + h_mắt.'
  },
  {
    title: 'Ước lượng cự ly Mil quân sự (NATO 6400)',
    formula: 'D (m) = (Rộng mục tiêu m × 1000) / Số Mil',
    note: '1° ≈ 17.78 Mil. Ngón út duỗi thẳng tay rộng ~20 Mil (khoảng 1°).'
  },
  {
    title: 'Công thức Naismith (Thời gian leo núi)',
    formula: 'T (giờ) = Quãng đường (km)/4 + Độ cao leo (m)/600',
    note: 'Ước tính giờ tới trạm trên địa hình dốc Núi Dinh.'
  }
];

function isReadableBase64Output(text: string): boolean {
  if (text.length < 2) return false;
  const printable = text.match(/[\p{L}\p{N}\s.,:;!?+\-_/()°'"°]/gu)?.length ?? 0;
  return printable / text.length >= 0.85;
}

export const CipherDecoderPanel: React.FC<CipherDecoderPanelProps> = ({ onPinCoordinate }) => {
  const [subTab, setSubTab] = useState<DecoderSubTab>('quick');
  const [rawInput, setRawInput] = useState<string>('');
  const [caesarShift, setCaesarShift] = useState<number>(3);
  const [showMoreDecoders, setShowMoreDecoders] = useState<boolean>(false);
  const [showSamples, setShowSamples] = useState<boolean>(false);
  const [showRefTools, setShowRefTools] = useState<boolean>(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<SolvedCipherEntry[]>(() => loadSolvedCiphers());

  // QR Camera Scanner State
  const [camActive, setCamActive] = useState(false);
  const [camInfo, setCamInfo] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Photo / Image OCR & Contrast Loupe State
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoFilter, setPhotoFilter] = useState<'normal' | 'contrast' | 'invert'>('normal');
  const [photoOcrNote, setPhotoOcrNote] = useState<string | null>(null);

  // Manual History Entry Title
  const [saveTitle, setSaveTitle] = useState<string>('');
  const [manualResult, setManualResult] = useState<string>('');

  const notify = useCallback((msg: string) => {
    setStatusNote(msg);
    window.setTimeout(() => {
      setStatusNote((prev) => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const stopQrCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCamActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!camActive) return;
    let cancelled = false;
    let scanTimer = 0;

    const startScan = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCamInfo('Thiết bị không cho phép mở camera trực tiếp — hãy dùng nút Ảnh hoặc nhập tay.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const BarcodeDetCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;

        if (!BarcodeDetCtor) {
          setCamInfo('WebView máy này chưa bật tự nhận QR — hãy đọc trực tiếp hoặc chọn ảnh.');
          return;
        }

        const detector = new BarcodeDetCtor({
          formats: ['qr_code', 'code_128', 'ean_13', 'data_matrix']
        });
        setCamInfo('Đang soi tìm QR Code... Đưa camera lại gần mã QR.');

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          if (videoRef.current.readyState >= 2) {
            try {
              const hits = await detector.detect(videoRef.current);
              const val = hits.find((h) => h.rawValue)?.rawValue?.trim();
              if (val) {
                setRawInput(val);
                stopQrCamera();
                notify(`✅ Đã quét QR Code (${val.length} ký tự)!`);
                return;
              }
            } catch {
              // ignore transient frame read errors
            }
          }
          scanTimer = window.setTimeout(tick, 320);
        };
        scanTimer = window.setTimeout(tick, 400);
      } catch (err) {
        setCamInfo(
          `Không mở được camera (${err instanceof Error ? err.message : 'từ chối quyền'}). Dùng nhập tay bên dưới.`
        );
      }
    };

    startScan();
    return () => {
      cancelled = true;
      window.clearTimeout(scanTimer);
    };
  }, [camActive, stopQrCamera, notify]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoOcrNote('Đang phân tích ảnh mật thư (QR + OCR)...');
    const url = URL.createObjectURL(file);
    setPhotoSrc(url);

    try {
      const bitmap = await createImageBitmap(file);
      const foundParts: string[] = [];

      const BarcodeDetCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
        }
      ).BarcodeDetector;
      if (BarcodeDetCtor) {
        try {
          const bd = new BarcodeDetCtor({ formats: ['qr_code', 'code_128', 'data_matrix'] });
          const barcodes = await bd.detect(bitmap);
          for (const b of barcodes) {
            if (b.rawValue) foundParts.push(b.rawValue.trim());
          }
        } catch {
          // ignore QR fallback
        }
      }

      const TextDetCtor = (
        window as unknown as { TextDetector?: new () => TextDetectorLike }
      ).TextDetector;
      if (TextDetCtor) {
        try {
          const td = new TextDetCtor();
          const blocks = await td.detect(bitmap);
          const text = blocks
            .map((b) => b.rawValue?.trim() || '')
            .filter(Boolean)
            .join(' ');
          if (text) foundParts.push(text);
        } catch {
          // ignore text detector fallback
        }
      }

      bitmap.close?.();
      if (foundParts.length > 0) {
        setRawInput(foundParts.join('\n'));
        setPhotoOcrNote(`✅ Đã trích xuất tự động ${foundParts.length} đoạn từ ảnh!`);
      } else {
        setPhotoOcrNote('Bật lọc "Đen-Trắng" hoặc "Âm bản" trên ảnh để đọc rõ rồi nhập tay bên dưới.');
      }
    } catch {
      setPhotoOcrNote('Đã nạp ảnh vào kính lúp. Bấm Đen-Trắng để soi rõ hơn.');
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      notify(`📋 Đã chép kết quả ${label}`);
    } catch {
      notify('Không truy cập được khay nhớ tạm');
    }
  };

  const handleSaveEntry = (cipherType: CipherType, label: string, output: string, coord: DetectedCoord | null) => {
    const title =
      saveTitle.trim() ||
      `${label} • ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    const updated = saveSolvedCipher({
      title,
      cipherType,
      rawInput: rawInput.trim() || manualResult.trim(),
      output,
      coord: coord ?? undefined
    });
    setSavedList(updated);
    setSaveTitle('');
    notify(`💾 Đã lưu "${title}" vào kho mật thư!`);
  };

  const caesar25List = useMemo(() => {
    const s = rawInput.trim();
    if (!s || !/[A-Za-z]/.test(s)) return [];
    return bruteForceCaesar25(s);
  }, [rawInput]);

  // Smart Auto-Detect: ranks top 1-3 most accurate answers at the top, tucks noisy/encode cards into "Xem thêm"
  const { primaryResults, secondaryResults, encodeResults } = useMemo(() => {
    const s = rawInput.trim();
    if (!s) {
      return {
        primaryResults: [] as DecodedCardRow[],
        secondaryResults: [] as DecodedCardRow[],
        encodeResults: [] as DecodedCardRow[]
      };
    }

    const primary: DecodedCardRow[] = [];
    const secondary: DecodedCardRow[] = [];
    const encodes: DecodedCardRow[] = [];

    const directCoord = detectCoordinateInText(s);
    if (directCoord) {
      primary.push({
        key: 'coord-direct',
        cipherType: 'coord',
        label: `Tọa độ trực tiếp (${directCoord.format})`,
        output: `${directCoord.lat.toFixed(6)}, ${directCoord.lon.toFixed(6)}`,
        coord: directCoord,
        confidence: 120,
        badge: '★ TỌA ĐỘ'
      });
    }

    // 1. Morse Detection (strict check so GPS dots never cause false-positive Morse)
    const looksLikeMorse = /^[\s.\-·•*–—_/|]+$/.test(s) && /[.\-·•*–—_]/.test(s);
    if (looksLikeMorse) {
      const morseDecoded = decodeMorse(s);
      if (morseDecoded) {
        const cleanRatio =
          morseDecoded.replace(/\?/g, '').length / Math.max(1, morseDecoded.length);
        const coord = detectCoordinateInText(morseDecoded);
        const row: DecodedCardRow = {
          key: 'morse-dec',
          cipherType: 'morse',
          label: 'Mã Morse → Chữ',
          output: morseDecoded,
          coord,
          confidence: cleanRatio >= 0.9 ? 110 : 75,
          badge: '★ MORSE',
          audioMorse: s
        };
        primary.push(row);
      }
    }

    // 2. A1Z26 Detection (numbers separated by dash/space/slash, NOT a GPS coordinate)
    const looksLikeA1Z26 = !directCoord && /^[\d\s\-.,;/|]+$/.test(s) && /\d/.test(s);
    if (looksLikeA1Z26) {
      const a1z26Dec = decodeA1Z26(s);
      if (a1z26Dec && !a1z26Dec.includes('[')) {
        primary.push({
          key: 'a1z26-dec',
          cipherType: 'a1z26',
          label: 'A1Z26 (Số → Chữ)',
          output: a1z26Dec,
          coord: detectCoordinateInText(a1z26Dec),
          confidence: 105,
          badge: '★ A1Z26'
        });
      } else if (a1z26Dec) {
        secondary.push({
          key: 'a1z26-dec',
          cipherType: 'a1z26',
          label: 'A1Z26 (Số → Chữ)',
          output: a1z26Dec,
          coord: detectCoordinateInText(a1z26Dec),
          confidence: 20
        });
      }
    }

    // 3. Base64 UTF-8 Detection
    const compact = s.replace(/\s+/g, '');
    const b64Dec = compact.length >= 6 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) ? decodeBase64(s) : null;
    if (b64Dec && isReadableBase64Output(b64Dec) && b64Dec !== s) {
      const coord = detectCoordinateInText(b64Dec);
      const hasSpacesOrVi = /\s/.test(b64Dec) || /[^\x00-\x7F]/.test(b64Dec) || compact.endsWith('=');
      const row: DecodedCardRow = {
        key: 'b64-dec',
        cipherType: 'base64',
        label: 'Base64 → Văn bản (UTF-8)',
        output: b64Dec,
        coord,
        confidence: hasSpacesOrVi || coord ? 108 : 50,
        badge: hasSpacesOrVi || coord ? '★ BASE64' : undefined
      };
      if (row.confidence >= 80) primary.push(row);
      else secondary.push(row);
    }

    const hasLetters = /[A-Za-z]/.test(s);
    if (hasLetters && !directCoord) {
      // 4. Automatic Best-Match Caesar across all 25 shifts (no manual slider needed!)
      const rankedCaesar = [...caesar25List].sort((a, b) => b.score - a.score);
      const bestCaesar = rankedCaesar[0];
      if (bestCaesar && (bestCaesar.isLikely || bestCaesar.coord || bestCaesar.score >= 12)) {
        primary.push({
          key: `caesar-auto-${bestCaesar.shift}`,
          cipherType: 'caesar',
          label: `Caesar tự động (dịch −${bestCaesar.shift} / +${bestCaesar.encryptShift})`,
          output: bestCaesar.output,
          coord: bestCaesar.coord,
          confidence: 70 + Math.min(35, bestCaesar.score),
          badge: `★ TỰ ĐOÁN K=${bestCaesar.shift}`
        });
        const secondBest = rankedCaesar[1];
        if (
          secondBest &&
          secondBest.shift !== bestCaesar.shift &&
          (secondBest.coord || secondBest.score >= bestCaesar.score - 4) &&
          secondBest.score >= 14
        ) {
          primary.push({
            key: `caesar-auto-${secondBest.shift}`,
            cipherType: 'caesar',
            label: `Caesar gợi ý #2 (dịch −${secondBest.shift})`,
            output: secondBest.output,
            coord: secondBest.coord,
            confidence: 65 + Math.min(30, secondBest.score)
          });
        }
      }

      // 5. ROT13, Atbash & Reverse — promote to Primary ONLY if high plaintext score or contains coordinate
      const rot = decodeRot13(s);
      const rotEval = scorePlaintextLikelihood(rot);
      const rotRow: DecodedCardRow = {
        key: 'rot13',
        cipherType: 'rot13',
        label: 'ROT13 (Dịch 13)',
        output: rot,
        coord: rotEval.coord,
        confidence: rotEval.score
      };
      if (rotEval.coord || rotEval.score >= 22) {
        if (!primary.some((p) => p.output === rot)) primary.push(rotRow);
      } else {
        secondary.push(rotRow);
      }

      const atb = decodeAtbash(s);
      const atbEval = scorePlaintextLikelihood(atb);
      const atbRow: DecodedCardRow = {
        key: 'atbash',
        cipherType: 'atbash',
        label: 'Atbash (A ↔ Z)',
        output: atb,
        coord: atbEval.coord,
        confidence: atbEval.score
      };
      if (atbEval.coord || atbEval.score >= 22) primary.push(atbRow);
      else secondary.push(atbRow);
    }

    // 6. Reverse text
    const rev = reverseText(s);
    const revEval = scorePlaintextLikelihood(rev.full);
    const revRow: DecodedCardRow = {
      key: 'rev-full',
      cipherType: 'reverse',
      label: 'Đảo Ngược (Toàn chuỗi)',
      output: rev.full,
      coord: revEval.coord,
      confidence: revEval.score
    };
    if ((revEval.coord || revEval.score >= 22) && !directCoord) primary.push(revRow);
    else secondary.push(revRow);

    if (rev.words !== rev.full) {
      const revWordEval = scorePlaintextLikelihood(rev.words);
      const row: DecodedCardRow = {
        key: 'rev-words',
        cipherType: 'reverse',
        label: 'Đảo Ngược (Từng từ)',
        output: rev.words,
        coord: revWordEval.coord,
        confidence: revWordEval.score
      };
      if ((revWordEval.coord || revWordEval.score >= 22) && !directCoord) primary.push(row);
      else secondary.push(row);
    }

    // Fallback: if nothing hit high confidence yet, always show manual Caesar K + Reverse so user never sees blank
    if (primary.length === 0 && hasLetters) {
      const decManual = caesarTransform(s, -caesarShift);
      primary.push({
        key: 'caesar-manual-fallback',
        cipherType: 'caesar',
        label: `Caesar dịch −${caesarShift}`,
        output: decManual,
        coord: detectCoordinateInText(decManual),
        confidence: 40
      });
    }

    // Encode tools tucked cleanly into expandable section
    if (hasLetters || /\d/.test(s)) {
      const morseEnc = encodeMorse(s);
      if (morseEnc && morseEnc !== s) {
        encodes.push({
          key: 'morse-enc',
          cipherType: 'morse',
          label: 'Chữ → Mã Morse',
          output: morseEnc,
          coord: null,
          confidence: 10,
          audioMorse: morseEnc
        });
      }
      if (hasLetters) {
        const a1z26Enc = encodeA1Z26(s);
        if (a1z26Enc) {
          encodes.push({
            key: 'a1z26-enc',
            cipherType: 'a1z26',
            label: 'Chữ → A1Z26',
            output: a1z26Enc,
            coord: null,
            confidence: 10
          });
        }
        encodes.push({
          key: 'caesar-enc',
          cipherType: 'caesar',
          label: `Caesar mã hóa (+${caesarShift})`,
          output: caesarTransform(s, caesarShift),
          coord: null,
          confidence: 10
        });
      }
      const b64Enc = encodeBase64(s);
      if (b64Enc) {
        encodes.push({
          key: 'b64-enc',
          cipherType: 'base64',
          label: 'Chữ → Base64',
          output: b64Enc,
          coord: null,
          confidence: 10
        });
      }
    }

    primary.sort((a, b) => b.confidence - a.confidence);
    return { primaryResults: primary.slice(0, 4), secondaryResults: secondary, encodeResults: encodes };
  }, [rawInput, caesar25List, caesarShift]);

  const renderResultCard = (row: DecodedCardRow, isTop = false) => (
    <div key={row.key} className={`cipher-result-card ${isTop || row.badge ? 'is-match' : ''}`}>
      <div className="cipher-card-top">
        <div className="cipher-card-title-wrap">
          {row.badge && <span className="cipher-best-badge">{row.badge}</span>}
          <strong>{row.label}</strong>
        </div>
        <div className="cipher-card-btns">
          {row.audioMorse && (
            <button
              type="button"
              onClick={() => playMorseAudio(row.audioMorse!)}
              title="Phát tiếng tít-te Morse"
            >
              🔊
            </button>
          )}
          <button type="button" onClick={() => handleCopy(row.output, row.label)} title="Chép kết quả">
            📋
          </button>
          <button
            type="button"
            onClick={() => setRawInput(row.output)}
            title="Giải thêm 1 lớp nữa từ kết quả này"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={() => handleSaveEntry(row.cipherType, row.label, row.output, row.coord)}
            title="Lưu vào kho mật thư"
          >
            💾
          </button>
        </div>
      </div>
      <pre className="cipher-output-pre">{row.output}</pre>
      {row.coord && (
        <button
          type="button"
          className="primary-action-btn cipher-pin-btn"
          onClick={() =>
            onPinCoordinate(
              row.coord!.lat,
              row.coord!.lon,
              `Mật thư (${row.label})`,
              `Gốc: ${rawInput.trim()} → Giải: ${row.output}`
            )
          }
        >
          🎯 Ghim &amp; Dẫn Đường 3D ({row.coord.lat.toFixed(5)}, {row.coord.lon.toFixed(5)})
        </button>
      )}
    </div>
  );

  return (
    <div className="toolkit-body cipher-decoder-root">
      <div className="subtab-strip">
        <button
          type="button"
          className={subTab === 'quick' ? 'active' : ''}
          onClick={() => setSubTab('quick')}
        >
          ⚡ Giải Tự Động
        </button>
        <button
          type="button"
          className={subTab === 'history' ? 'active' : ''}
          onClick={() => setSubTab('history')}
        >
          🗂️ Đã Lưu ({savedList.length})
        </button>
      </div>

      {statusNote && <div className="success-box compact-alert">{statusNote}</div>}

      {subTab === 'quick' && (
        <>
          {/* Single Clean Input Box + Minimal 4-Button Bar */}
          <div className="cipher-input-box">
            <textarea
              rows={2}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Dán hoặc gõ mật thư bất kỳ (Caesar, Morse, A1Z26, Base64, Tọa độ, Plus Code) — app tự đoán kết quả đúng nhất!"
            />
            <div className="cipher-quick-actions">
              <button
                type="button"
                className={camActive ? 'active-pill-btn' : ''}
                onClick={() => (camActive ? stopQrCamera() : setCamActive(true))}
              >
                {camActive ? '⏹️ Tắt QR' : '📷 Quét QR'}
              </button>
              <label className="file-btn-inline">
                <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                🖼️ Ảnh
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const txt = await navigator.clipboard?.readText();
                    if (txt) setRawInput(txt);
                  } catch {
                    notify('Nhấn giữ vào ô nhập phía trên để Dán');
                  }
                }}
              >
                📋 Dán
              </button>
              <button type="button" onClick={() => setRawInput('')}>
                🧹 Xóa
              </button>
            </div>

            {/* Compact Morse helper + collapsible sample picker */}
            <div className="cipher-micro-bar">
              <div className="cipher-morse-keys">
                {['.', '-', '/', ' '].map((tok) => (
                  <button
                    key={tok === ' ' ? 'sp' : tok}
                    type="button"
                    onClick={() => setRawInput((prev) => prev + tok)}
                    title="Chèn nhanh ký tự Morse"
                  >
                    {tok === ' ' ? '␣' : tok}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ota-mini-link"
                onClick={() => setShowSamples((v) => !v)}
              >
                {showSamples ? 'Ẩn mẫu thử ▴' : 'Thử mẫu nhanh ▾'}
              </button>
            </div>

            {showSamples && (
              <div className="preset-chips">
                <button type="button" onClick={() => { setRawInput('WUDP 2 GLQK OD EDQ 10.53875, 107.12942'); setShowSamples(false); }}>
                  Caesar
                </button>
                <button type="button" onClick={() => { setRawInput('-.. .. -. .... / -. ..- .. / .---- ----- .-.-.- ..... ...-- ---..'); setShowSamples(false); }}>
                  Morse
                </button>
                <button type="button" onClick={() => { setRawInput('4-9-14-8 / 12-1-2-1-14'); setShowSamples(false); }}>
                  A1Z26
                </button>
                <button type="button" onClick={() => { setRawInput('VHLhuqFtIERpbmggLSBUcsaw4budbmcgQuG6r24='); setShowSamples(false); }}>
                  Base64
                </button>
                <button type="button" onClick={() => { setRawInput('7P29G4QH+GQ'); setShowSamples(false); }}>
                  Plus Code
                </button>
              </div>
            )}
          </div>

          {camActive && (
            <div className="qr-cam-box">
              <video ref={videoRef} playsInline muted className="qr-video-feed" />
              {camInfo && <span className="mono-sub">{camInfo}</span>}
            </div>
          )}

          {photoSrc && (
            <div className="cipher-photo-loupe">
              <div className="loupe-toolbar">
                <span>Soi ảnh:</span>
                <button type="button" className={photoFilter === 'normal' ? 'active' : ''} onClick={() => setPhotoFilter('normal')}>
                  Gốc
                </button>
                <button type="button" className={photoFilter === 'contrast' ? 'active' : ''} onClick={() => setPhotoFilter('contrast')}>
                  Rõ nét
                </button>
                <button type="button" className={photoFilter === 'invert' ? 'active' : ''} onClick={() => setPhotoFilter('invert')}>
                  Âm bản
                </button>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(photoSrc);
                    setPhotoSrc(null);
                    setPhotoOcrNote(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <img src={photoSrc} alt="Ảnh mật thư" className={`loupe-img filter-${photoFilter}`} />
              {photoOcrNote && <span className="mono-sub">{photoOcrNote}</span>}
            </div>
          )}

          {/* Top Auto-Detected Results */}
          {!rawInput.trim() ? (
            <div className="empty-box">
              Nhập hoặc quét mật thư — kết quả hợp nghĩa nhất (hoặc tọa độ GPS) sẽ tự động nhảy lên ngay tại đây.
            </div>
          ) : (
            <div className="cipher-results-list">
              {primaryResults.map((row, idx) => renderResultCard(row, idx === 0))}
            </div>
          )}

          {/* Expandable Advanced Decoders, All 25 Caesar Shifts & Encode Tools */}
          {rawInput.trim() && (
            <div className="simple-accordion">
              <button
                type="button"
                className="simple-accordion-btn"
                onClick={() => setShowMoreDecoders((v) => !v)}
              >
                <span>
                  🔍 Xem thêm các hệ khác, đủ 25 Caesar &amp; Mã hóa ngược
                </span>
                <strong>{showMoreDecoders ? '▴' : '▾'}</strong>
              </button>
              {showMoreDecoders && (
                <div className="simple-accordion-body">
                  {/[A-Za-z]/.test(rawInput) && (
                    <div className="caesar-shift-bar">
                      <span>Thử Caesar thủ công K = <strong>{caesarShift}</strong></span>
                      <div className="shift-steppers">
                        <button type="button" onClick={() => setCaesarShift((v) => ((v - 2 + 25) % 25) + 1)}>
                          −1
                        </button>
                        <input
                          type="range"
                          min={1}
                          max={25}
                          value={caesarShift}
                          onChange={(e) => setCaesarShift(Number(e.target.value))}
                        />
                        <button type="button" onClick={() => setCaesarShift((v) => (v % 25) + 1)}>
                          +1
                        </button>
                      </div>
                    </div>
                  )}

                  {secondaryResults.map((row) => renderResultCard(row))}

                  {caesar25List.length > 0 && (
                    <div className="cipher-sub-section">
                      <span className="mono-sub">Bảng đủ 25 phép dịch Caesar (K = 1 → 25):</span>
                      {caesar25List.map((cand) => (
                        <div
                          key={cand.shift}
                          className={`caesar25-row ${cand.isLikely || cand.coord ? 'likely' : ''}`}
                        >
                          <div className="caesar25-meta">
                            <span className="shift-badge">−{cand.shift}</span>
                            {(cand.isLikely || cand.coord) && <span className="likely-tag">★</span>}
                          </div>
                          <span className="caesar25-text">{cand.output}</span>
                          <div className="cipher-card-btns">
                            {cand.coord && (
                              <button
                                type="button"
                                onClick={() =>
                                  onPinCoordinate(
                                    cand.coord!.lat,
                                    cand.coord!.lon,
                                    `Caesar K=${cand.shift}`,
                                    cand.output
                                  )
                                }
                              >
                                🎯
                              </button>
                            )}
                            <button type="button" onClick={() => handleCopy(cand.output, `Caesar -${cand.shift}`)}>
                              📋
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {encodeResults.length > 0 && (
                    <div className="cipher-sub-section">
                      <span className="mono-sub">Mã hóa ngược (tạo mật thư):</span>
                      {encodeResults.map((row) => renderResultCard(row))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Expandable Morse / A1Z26 Quick Lookup & Formulas */}
          <div className="simple-accordion">
            <button
              type="button"
              className="simple-accordion-btn"
              onClick={() => setShowRefTools((v) => !v)}
            >
              <span>📖 Bảng tra nhanh Morse / A1Z26 &amp; Công thức thực địa</span>
              <strong>{showRefTools ? '▴' : '▾'}</strong>
            </button>
            {showRefTools && (
              <div className="simple-accordion-body">
                <div className="alpha-ref-grid">
                  {REFERENCE_LETTERS.map((ch, idx) => (
                    <button
                      key={ch}
                      type="button"
                      className="alpha-ref-cell"
                      onClick={() => {
                        setRawInput((prev) => `${prev}${prev ? ' ' : ''}${MORSE_TABLE[ch] || ''}`);
                        notify(`Đã chèn Morse "${ch}" (${MORSE_TABLE[ch]})`);
                      }}
                    >
                      <b>{ch}</b>
                      <span>{idx + 1}</span>
                      <small>{MORSE_TABLE[ch]}</small>
                    </button>
                  ))}
                </div>
                <div className="formula-ref-list">
                  {FIELD_FORMULAS.map((f) => (
                    <div key={f.title} className="formula-card">
                      <strong>{f.title}</strong>
                      <code>{f.formula}</code>
                      <p>{f.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {subTab === 'history' && (
        <div className="cipher-history-wrap">
          <div className="cipher-manual-save-box">
            <strong>➕ Ghi chú nhanh mật thư giải tay</strong>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Tên trạm (VD: Trạm 3 Suối Đá)"
            />
            <input
              type="text"
              value={manualResult}
              onChange={(e) => setManualResult(e.target.value)}
              placeholder="Nội dung đã giải (VD: 10.5387, 107.1294)"
            />
            <button
              type="button"
              className="secondary-action-btn full-w"
              onClick={() => {
                if (!manualResult.trim() && !rawInput.trim()) {
                  notify('Hãy nhập kết quả cần lưu!');
                  return;
                }
                const out = manualResult.trim() || rawInput.trim();
                handleSaveEntry('manual', 'Lưu thủ công', out, detectCoordinateInText(out));
                setManualResult('');
              }}
            >
              💾 Lưu vào máy (Offline)
            </button>
          </div>

          {savedList.length === 0 ? (
            <div className="empty-box">Chưa có mật thư nào được lưu. Bấm 💾 ở kết quả giải để lưu lại.</div>
          ) : (
            <div className="cipher-results-list">
              <div className="history-clear-row">
                <span>Đã lưu {savedList.length} mật thư</span>
                <button type="button" onClick={() => setSavedList(clearSolvedCiphers())}>
                  🗑️ Xóa hết
                </button>
              </div>
              {savedList.map((item) => (
                <div key={item.id} className="cipher-result-card">
                  <div className="cipher-card-top">
                    <strong>{item.title}</strong>
                    <div className="cipher-card-btns">
                      <button
                        type="button"
                        onClick={() => {
                          setRawInput(item.rawInput);
                          setSubTab('quick');
                        }}
                        title="Nạp lại để giải tiếp"
                      >
                        🔄
                      </button>
                      <button type="button" onClick={() => handleCopy(item.output, item.title)}>
                        📋
                      </button>
                      <button type="button" onClick={() => setSavedList(deleteSolvedCipher(item.id))}>
                        🗑️
                      </button>
                    </div>
                  </div>
                  {item.rawInput && item.rawInput !== item.output && (
                    <span className="mono-sub">Mã gốc: {item.rawInput}</span>
                  )}
                  <pre className="cipher-output-pre">{item.output}</pre>
                  {item.coord && (
                    <button
                      type="button"
                      className="primary-action-btn cipher-pin-btn"
                      onClick={() =>
                        onPinCoordinate(item.coord!.lat, item.coord!.lon, item.title, item.output)
                      }
                    >
                      🎯 Ghim &amp; Bay 3D ({item.coord.lat.toFixed(5)}, {item.coord.lon.toFixed(5)})
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
