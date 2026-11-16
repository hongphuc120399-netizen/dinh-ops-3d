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

type DecoderSubTab = 'multi' | 'caesar25' | 'ref' | 'history';

interface DecodedCardRow {
  key: string;
  cipherType: CipherType;
  label: string;
  output: string;
  coord: DetectedCoord | null;
  highlight?: boolean;
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
    title: 'Định lý Cosin & Sin (Tam giác thường)',
    formula: 'c² = a² + b² - 2ab·cos(C)  |  a/sin(A) = b/sin(B)',
    note: 'Đo khoảng cách gián tiếp qua sông/vực không cần qua bờ bên kia.'
  },
  {
    title: 'Chiều cao vật thể qua góc nghiêng',
    formula: 'H = D · tan(θ) + h_mắt',
    note: 'D: khoảng cách ngang tới chân vật; θ: góc nâng (đo ở tab Đo Góc Nghiêng).'
  },
  {
    title: 'Ước lượng cự ly Mil quân sự (NATO 6400)',
    formula: 'D (m) = (Rộng mục tiêu m × 1000) / Số Mil',
    note: '1° ≈ 17.78 Mil. Ngón út duỗi thẳng tay rộng ~20 Mil (khoảng 1°).'
  },
  {
    title: 'Công thức Naismith (Thời gian leo núi)',
    formula: 'T (giờ) = Quãng đường (km)/4 + Độ cao leo (m)/600',
    note: 'Ước tính giờ tới trạm trên địa hình dốc Núi Dinh (cộng thêm khi mệt/mưa).'
  },
  {
    title: 'Giải phương trình bậc 2',
    formula: 'x = (-b ± √(b² - 4ac)) / (2a)',
    note: 'Hữu ích cho các mật thư ẩn bài toán tọa độ hoặc mật khẩu số.'
  }
];

export const CipherDecoderPanel: React.FC<CipherDecoderPanelProps> = ({ onPinCoordinate }) => {
  const [subTab, setSubTab] = useState<DecoderSubTab>('multi');
  const [rawInput, setRawInput] = useState<string>('');
  const [caesarShift, setCaesarShift] = useState<number>(3);
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
  const imgRef = useRef<HTMLImageElement | null>(null);

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
          setCamInfo('Thiết bị không cho phép mở camera trực tiếp — hãy dùng Ảnh/OCR hoặc nhập tay.');
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
          setCamInfo(
            'WebView máy này chưa bật API tự nhận QR trực tiếp. Hãy soi để đọc bằng mắt hoặc dùng "Ảnh / OCR"!'
          );
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
        const merged = foundParts.join('\n');
        setRawInput(merged);
        setPhotoOcrNote(`✅ Đã trích xuất tự động ${foundParts.length} đoạn từ ảnh! Kiểm tra & chỉnh lại nếu cần.`);
      } else {
        setPhotoOcrNote(
          'Máy không hỗ trợ OCR/QR offline trên ảnh này — bật lọc "Đen-Trắng" hoặc "Âm bản" trên ảnh mẫu để đọc rõ rồi nhập tay vào ô bên dưới.'
        );
      }
    } catch {
      setPhotoOcrNote('Đã nạp ảnh vào kính lúp. Bấm Đen-Trắng để soi và gõ tay mật thư.');
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
    const title = saveTitle.trim() || `${label} • ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
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

  const directCoord = useMemo(() => detectCoordinateInText(rawInput), [rawInput]);

  const multiResults = useMemo<DecodedCardRow[]>(() => {
    const s = rawInput.trim();
    if (!s) return [];
    const rows: DecodedCardRow[] = [];

    if (directCoord) {
      rows.push({
        key: 'coord-direct',
        cipherType: 'coord',
        label: `📍 Tọa độ trực tiếp (${directCoord.format})`,
        output: `${directCoord.lat.toFixed(6)}, ${directCoord.lon.toFixed(6)}`,
        coord: directCoord,
        highlight: true
      });
    }

    const hasLetters = /[A-Za-z]/.test(s);
    if (hasLetters) {
      const decCaesar = caesarTransform(s, -caesarShift);
      rows.push({
        key: 'caesar-dec',
        cipherType: 'caesar',
        label: `Caesar giải dịch (-${caesarShift} / +${26 - caesarShift})`,
        output: decCaesar,
        coord: detectCoordinateInText(decCaesar)
      });

      const encCaesar = caesarTransform(s, caesarShift);
      rows.push({
        key: 'caesar-enc',
        cipherType: 'caesar',
        label: `Caesar mã hóa (+${caesarShift})`,
        output: encCaesar,
        coord: detectCoordinateInText(encCaesar)
      });

      const rot = decodeRot13(s);
      rows.push({
        key: 'rot13',
        cipherType: 'rot13',
        label: 'ROT13 (Dịch 13)',
        output: rot,
        coord: detectCoordinateInText(rot)
      });
    }

    const morseDecoded = decodeMorse(s);
    if (morseDecoded) {
      rows.push({
        key: 'morse-dec',
        cipherType: 'morse',
        label: 'Morse → Chữ',
        output: morseDecoded,
        coord: detectCoordinateInText(morseDecoded),
        highlight: !morseDecoded.includes('?'),
        audioMorse: s
      });
    }

    if (hasLetters || /\d/.test(s)) {
      const morseEncoded = encodeMorse(s);
      if (morseEncoded && morseEncoded !== s) {
        rows.push({
          key: 'morse-enc',
          cipherType: 'morse',
          label: 'Chữ → Mã Morse',
          output: morseEncoded,
          coord: null,
          audioMorse: morseEncoded
        });
      }
    }

    const a1z26Dec = decodeA1Z26(s);
    if (a1z26Dec) {
      rows.push({
        key: 'a1z26-dec',
        cipherType: 'a1z26',
        label: 'A1Z26 (Số → Chữ)',
        output: a1z26Dec,
        coord: detectCoordinateInText(a1z26Dec),
        highlight: !a1z26Dec.includes('[')
      });
    }

    if (hasLetters) {
      const a1z26Enc = encodeA1Z26(s);
      if (a1z26Enc) {
        rows.push({
          key: 'a1z26-enc',
          cipherType: 'a1z26',
          label: 'Chữ → A1Z26',
          output: a1z26Enc,
          coord: null
        });
      }
    }

    const b64Dec = decodeBase64(s);
    if (b64Dec) {
      rows.push({
        key: 'b64-dec',
        cipherType: 'base64',
        label: 'Base64 → Chữ (UTF-8)',
        output: b64Dec,
        coord: detectCoordinateInText(b64Dec),
        highlight: true
      });
    }

    const b64Enc = encodeBase64(s);
    if (b64Enc) {
      rows.push({
        key: 'b64-enc',
        cipherType: 'base64',
        label: 'Chữ → Base64',
        output: b64Enc,
        coord: null
      });
    }

    const rev = reverseText(s);
    rows.push({
      key: 'rev-full',
      cipherType: 'reverse',
      label: 'Đảo Ngược (Toàn chuỗi)',
      output: rev.full,
      coord: detectCoordinateInText(rev.full)
    });
    if (rev.words !== rev.full) {
      rows.push({
        key: 'rev-words',
        cipherType: 'reverse',
        label: 'Đảo Ngược (Từng từ)',
        output: rev.words,
        coord: detectCoordinateInText(rev.words)
      });
    }

    if (hasLetters) {
      const atb = decodeAtbash(s);
      rows.push({
        key: 'atbash',
        cipherType: 'atbash',
        label: 'Atbash (A ↔ Z)',
        output: atb,
        coord: detectCoordinateInText(atb)
      });
    }

    return rows;
  }, [rawInput, caesarShift, directCoord]);

  const caesar25List = useMemo(() => {
    if (subTab !== 'caesar25' || !rawInput.trim()) return [];
    return bruteForceCaesar25(rawInput);
  }, [subTab, rawInput]);

  return (
    <div className="toolkit-body cipher-decoder-root">
      <div className="subtab-strip">
        <button
          type="button"
          className={subTab === 'multi' ? 'active' : ''}
          onClick={() => setSubTab('multi')}
        >
          ⚡ Giải Đa Hệ
        </button>
        <button
          type="button"
          className={subTab === 'caesar25' ? 'active' : ''}
          onClick={() => setSubTab('caesar25')}
        >
          🔢 25 Caesar
        </button>
        <button
          type="button"
          className={subTab === 'ref' ? 'active' : ''}
          onClick={() => setSubTab('ref')}
        >
          📐 Công Thức
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

      {(subTab === 'multi' || subTab === 'caesar25') && (
        <>
          {/* Camera QR & Photo OCR Scanner Controls */}
          <div className="cipher-capture-row">
            <button
              type="button"
              className={`secondary-action-btn mini-btn ${camActive ? 'active-pill-btn' : ''}`}
              onClick={() => (camActive ? stopQrCamera() : setCamActive(true))}
            >
              {camActive ? '⏹️ Tắt Camera' : '📷 Quét QR Camera'}
            </button>
            <label className="secondary-action-btn mini-btn file-btn">
              <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
              🖼️ Ảnh QR / Đọc Chữ OCR
            </label>
            {photoSrc && (
              <button
                type="button"
                className="secondary-action-btn mini-btn"
                onClick={() => {
                  URL.revokeObjectURL(photoSrc);
                  setPhotoSrc(null);
                  setPhotoOcrNote(null);
                }}
              >
                ✕ Đóng ảnh
              </button>
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
                <span>Kính lúp mật thư:</span>
                <button
                  type="button"
                  className={photoFilter === 'normal' ? 'active' : ''}
                  onClick={() => setPhotoFilter('normal')}
                >
                  Gốc
                </button>
                <button
                  type="button"
                  className={photoFilter === 'contrast' ? 'active' : ''}
                  onClick={() => setPhotoFilter('contrast')}
                >
                  Đen-Trắng Rõ Nét
                </button>
                <button
                  type="button"
                  className={photoFilter === 'invert' ? 'active' : ''}
                  onClick={() => setPhotoFilter('invert')}
                >
                  Âm Bản
                </button>
              </div>
              <img
                ref={imgRef}
                src={photoSrc}
                alt="Ảnh mật thư"
                className={`loupe-img filter-${photoFilter}`}
              />
              {photoOcrNote && <span className="mono-sub">{photoOcrNote}</span>}
            </div>
          )}

          {/* Manual Input Area + Quick Symbols */}
          <div className="cipher-input-box">
            <textarea
              rows={2}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Nhập tay hoặc dán mật thư: Caesar, ROT13, Morse (... --- ...), A1Z26 (20-18-1-13), Base64, chữ ngược, hoặc tọa độ GPS / Plus Code..."
            />
            <div className="cipher-keypad-bar">
              {['.', '-', '/', ' ', '10.53875, 107.12942'].map((tok) => (
                <button
                  key={tok === ' ' ? 'sp' : tok}
                  type="button"
                  onClick={() => setRawInput((prev) => prev + (tok === '10.53875, 107.12942' ? tok : tok))}
                >
                  {tok === ' ' ? '␣ Cách' : tok === '10.53875, 107.12942' ? '📍 Mẫu GPS' : tok}
                </button>
              ))}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const txt = await navigator.clipboard?.readText();
                    if (txt) setRawInput(txt);
                  } catch {
                    notify('Nhấn giữ ô nhập để Dán trên điện thoại');
                  }
                }}
              >
                📋 Dán
              </button>
              <button type="button" onClick={() => setRawInput('')}>
                🧹 Xóa
              </button>
            </div>
            <div className="preset-chips">
              <button type="button" onClick={() => setRawInput('WUDP 2 GLQK OD EDQ 10.53875, 107.12942')}>
                Thử Caesar
              </button>
              <button type="button" onClick={() => setRawInput('-.. .. -. .... / -. ..- .. / .---- ----- .-.-.- ..... ...-- ---..')}>
                Thử Morse
              </button>
              <button type="button" onClick={() => setRawInput('4-9-14-8 / 12-1-2-1-14')}>
                Thử A1Z26
              </button>
              <button type="button" onClick={() => setRawInput('VHLhuqFtIERpbmggLSBUcsaw4budbmcgQuG6r24=')}>
                Thử Base64
              </button>
              <button type="button" onClick={() => setRawInput('7P29G4QH+GQ')}>
                Thử Plus Code
              </button>
            </div>
          </div>

          {subTab === 'multi' && (
            <>
              <div className="caesar-shift-bar">
                <span>Dịch Caesar K = <strong>{caesarShift}</strong></span>
                <div className="shift-steppers">
                  <button
                    type="button"
                    onClick={() => setCaesarShift((v) => ((v - 2 + 25) % 25) + 1)}
                  >
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

              {multiResults.length === 0 ? (
                <div className="empty-box">
                  Nhập mật thư hoặc quét mã QR phía trên — tất cả kết quả (Caesar, ROT13, Morse, A1Z26, Base64, Đảo ngược, Tọa độ) sẽ giải đồng thời ngay lập tức!
                </div>
              ) : (
                <div className="cipher-results-list">
                  {multiResults.map((row) => (
                    <div
                      key={row.key}
                      className={`cipher-result-card ${row.highlight ? 'is-match' : ''}`}
                    >
                      <div className="cipher-card-top">
                        <strong>{row.label}</strong>
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
                          <button type="button" onClick={() => handleCopy(row.output, row.label)}>
                            📋
                          </button>
                          <button
                            type="button"
                            onClick={() => setRawInput(row.output)}
                            title="Đưa kết quả này lên ô nhập để giải lớp tiếp theo"
                          >
                            🔄
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEntry(row.cipherType, row.label, row.output, row.coord)}
                            title="Lưu mật thư đã giải"
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
                          🎯 Ghim &amp; Bay Tới Đích 3D ({row.coord.lat.toFixed(5)}, {row.coord.lon.toFixed(5)})
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {subTab === 'caesar25' && (
            <div className="cipher-results-list">
              {!rawInput.trim() ? (
                <div className="empty-box">
                  Nhập đoạn mã Caesar ở ô trên để app tự thử đồng thời cả 25 phép dịch (K = 1 → 25) và tô sáng kết quả hợp nghĩa nhất.
                </div>
              ) : (
                caesar25List.map((cand) => (
                  <div
                    key={cand.shift}
                    className={`caesar25-row ${cand.isLikely || cand.coord ? 'likely' : ''}`}
                  >
                    <div className="caesar25-meta">
                      <span className="shift-badge">
                        −{cand.shift} / +{cand.encryptShift}
                      </span>
                      {(cand.isLikely || cand.coord) && (
                        <span className="likely-tag">★ GỢI Ý</span>
                      )}
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
                          title="Ghim tọa độ này lên 3D"
                        >
                          🎯
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(cand.output, `Caesar -${cand.shift}`)}
                      >
                        📋
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveEntry('caesar', `Caesar -${cand.shift}`, cand.output, cand.coord)
                        }
                      >
                        💾
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {subTab === 'ref' && (
        <div className="cipher-ref-wrap">
          <div className="ref-section">
            <strong>🔤 Bảng đối chiếu nhanh A1Z26 &amp; Morse (Chạm chữ để chèn mã)</strong>
            <div className="alpha-ref-grid">
              {REFERENCE_LETTERS.map((ch, idx) => (
                <button
                  key={ch}
                  type="button"
                  className="alpha-ref-cell"
                  onClick={() => {
                    setRawInput((prev) => `${prev}${prev ? ' ' : ''}${MORSE_TABLE[ch] || ''}`);
                    notify(`Đã chèn mã Morse "${ch}" (${MORSE_TABLE[ch]})`);
                  }}
                >
                  <b>{ch}</b>
                  <span>{idx + 1}</span>
                  <small>{MORSE_TABLE[ch]}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="ref-section">
            <strong>📐 Công Thức Toán Học &amp; Đo Đạc Thực Địa</strong>
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
        </div>
      )}

      {subTab === 'history' && (
        <div className="cipher-history-wrap">
          <div className="cipher-manual-save-box">
            <strong>➕ Lưu nhanh mật thư giải tay</strong>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Tên trạm / Ghi chú (VD: Trạm 3 Suối Đá)"
            />
            <input
              type="text"
              value={manualResult}
              onChange={(e) => setManualResult(e.target.value)}
              placeholder="Nội dung đã giải được (VD: Đi 200m hướng Đông hoặc 10.5387, 107.1294)"
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
              💾 Lưu vào lịch sử Offline
            </button>
          </div>

          {savedList.length === 0 ? (
            <div className="empty-box">
              Chưa có mật thư nào được lưu. Bấm biểu tượng 💾 ở bất kỳ kết quả giải nào để lưu lại!
            </div>
          ) : (
            <div className="cipher-results-list">
              <div className="history-clear-row">
                <span>Đã lưu {savedList.length} mật thư trong máy</span>
                <button
                  type="button"
                  onClick={() => setSavedList(clearSolvedCiphers())}
                >
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
                          setSubTab('multi');
                        }}
                        title="Nạp lại vào bộ giải"
                      >
                        🔄
                      </button>
                      <button type="button" onClick={() => handleCopy(item.output, item.title)}>
                        📋
                      </button>
                      <button
                        type="button"
                        onClick={() => setSavedList(deleteSolvedCipher(item.id))}
                        title="Xóa bản lưu"
                      >
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
                        onPinCoordinate(
                          item.coord!.lat,
                          item.coord!.lon,
                          item.title,
                          item.output
                        )
                      }
                    >
                      🎯 Bay &amp; Ghim Tọa Độ ({item.coord.lat.toFixed(5)}, {item.coord.lon.toFixed(5)})
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
