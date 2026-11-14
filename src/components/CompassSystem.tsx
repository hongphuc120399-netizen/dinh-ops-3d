import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NuiDinhDataset, TacticalTarget, UserPin } from '../types';
import {
  computeBearingDeg,
  formatBearingCardinal,
  formatDistance,
  haversineDistanceM,
  projectPointByBearing,
  sampleDemElevation,
  sampleDemSlopeDeg
} from '../utils/geoMath';
import { PIN_CATEGORIES } from './TacticalPanels';

/**
 * Prevents 359° -> 0° wraparound spin-back glitches in CSS transforms
 */
export function useContinuousAngle(targetDeg: number): number {
  const ref = useRef<number>(targetDeg);
  const prevNorm = ((ref.current % 360) + 360) % 360;
  const nextNorm = ((targetDeg % 360) + 360) % 360;
  const delta = ((nextNorm - prevNorm + 540) % 360) - 180;
  ref.current += delta;
  return ref.current;
}

function getVietnameseOrdinalName(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const names = [
    'BẮC',
    'BẮC - ĐÔNG BẮC',
    'ĐÔNG BẮC',
    'ĐÔNG - ĐÔNG BẮC',
    'ĐÔNG',
    'ĐÔNG - ĐÔNG NAM',
    'ĐÔNG NAM',
    'NAM - ĐÔNG NAM',
    'NAM',
    'NAM - TÂY NAM',
    'TÂY NAM',
    'TÂY - TÂY NAM',
    'TÂY',
    'TÂY - TÂY BẮC',
    'TÂY BẮC',
    'BẮC - TÂY BẮC'
  ];
  return names[Math.round(d / 22.5) % 16];
}

function signedAngleDelta(target: number, current: number): number {
  return ((target - current + 540) % 360) - 180;
}

interface FloatingCompassWidgetProps {
  compassHeading: number;
  gpsCourse: number | null;
  lockedTarget: TacticalTarget | null;
  lockedBearing: number | null;
  playerLat: number;
  playerLon: number;
  hasMagneticWarning: boolean;
  onOpenFullCompass: () => void;
}

export const FloatingCompassWidget: React.FC<FloatingCompassWidgetProps> = ({
  compassHeading,
  gpsCourse,
  lockedTarget,
  lockedBearing,
  playerLat,
  playerLon,
  hasMagneticWarning,
  onOpenFullCompass
}) => {
  const dialRot = useContinuousAngle(-compassHeading);

  const targetBearing = useMemo(() => {
    if (!lockedTarget) return null;
    return computeBearingDeg(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
  }, [lockedTarget, playerLat, playerLon]);

  return (
    <button
      type="button"
      className={`floating-compass-widget ${hasMagneticWarning ? 'mag-warn' : ''}`}
      onClick={onOpenFullCompass}
      title="Mở La Bàn Chiến Thuật 360° & Ngắm Phương Vị"
    >
      <div className="fcw-dial-shell">
        {/* Fixed top lubber mark */}
        <span className="fcw-lubber" />

        <svg
          width="66"
          height="66"
          viewBox="0 0 100 100"
          className="fcw-svg"
          style={{ transform: `rotate(${dialRot}deg)` }}
        >
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
          {/* 12 tick marks every 30 deg */}
          {Array.from({ length: 12 }).map((_, idx) => {
            const a = idx * 30;
            const isMajor = idx % 3 === 0;
            return (
              <line
                key={a}
                x1="50"
                y1={isMajor ? '6' : '8'}
                x2="50"
                y2={isMajor ? '14' : '12'}
                stroke={idx === 0 ? '#FF3B30' : isMajor ? '#E2E8F0' : 'rgba(148,163,184,0.55)'}
                strokeWidth={isMajor ? '2.2' : '1.3'}
                transform={`rotate(${a} 50 50)`}
              />
            );
          })}

          {/* Cardinal Labels */}
          <text x="50" y="25" textAnchor="middle" fill="#FF453A" fontSize="13" fontWeight="800">
            B
          </text>
          <text x="79" y="54" textAnchor="middle" fill="#CBD5E1" fontSize="10.5" fontWeight="700">
            Đ
          </text>
          <text x="50" y="83" textAnchor="middle" fill="#94A3B8" fontSize="10.5" fontWeight="700">
            N
          </text>
          <text x="21" y="54" textAnchor="middle" fill="#CBD5E1" fontSize="10.5" fontWeight="700">
            T
          </text>

          {/* Center North/South Needle */}
          <polygon points="50,28 45.5,50 54.5,50" fill="#FF3B30" />
          <polygon points="50,72 45.5,50 54.5,50" fill="rgba(226,232,240,0.75)" />
          <circle cx="50" cy="50" r="3.5" fill="#0F172A" stroke="#F8FAFC" strokeWidth="1.5" />

          {/* Locked Sighting Bearing Bug (Cyan) */}
          {lockedBearing !== null && (
            <g transform={`rotate(${lockedBearing} 50 50)`}>
              <polygon points="50,2 45,10 55,10" fill="#00F5D4" />
            </g>
          )}

          {/* Locked Target Bearing Bug (Gold) */}
          {targetBearing !== null && (
            <g transform={`rotate(${targetBearing} 50 50)`}>
              <circle cx="50" cy="6" r="4.2" fill="#FFD60A" stroke="#090D16" strokeWidth="1.2" />
            </g>
          )}

          {/* GPS Course Bug (Emerald) */}
          {gpsCourse !== null && (
            <g transform={`rotate(${gpsCourse} 50 50)`}>
              <circle cx="50" cy="11" r="2.5" fill="#30D158" />
            </g>
          )}
        </svg>
      </div>

      <div className="fcw-readout">
        <strong>{formatBearingCardinal(compassHeading)}</strong>
        <span>{lockedBearing !== null ? `🔒 ${lockedBearing}°` : '🧭 La bàn'}</span>
      </div>
    </button>
  );
};

interface TacticalCompassModalProps {
  dataset: NuiDinhDataset;
  playerLat: number;
  playerLon: number;
  playerEle: number;
  compassHeading: number;
  gpsCourse: number | null;
  speedMps: number | null;
  pitchDeg: number;
  rollDeg: number;
  useRealSensor: boolean;
  sensorSupported: boolean;
  lockedBearing: number | null;
  lockedTarget: TacticalTarget | null;
  userPins: UserPin[];
  hasMagneticWarning: boolean;
  magneticWarningReason: string | null;
  onChangeSimHeading: (deg: number) => void;
  onToggleRealSensor: (enable: boolean) => void;
  onChangeLockedBearing: (deg: number | null) => void;
  onSelectTarget: (target: TacticalTarget) => void;
  onProjectBearingPin: (pin: UserPin) => void;
  onFlyTo: (lat: number, lon: number) => void;
  onClose: () => void;
}

export const TacticalCompassModal: React.FC<TacticalCompassModalProps> = ({
  dataset,
  playerLat,
  playerLon,
  playerEle,
  compassHeading,
  gpsCourse,
  pitchDeg,
  rollDeg,
  useRealSensor,
  lockedBearing,
  lockedTarget,
  userPins,
  hasMagneticWarning,
  magneticWarningReason,
  onChangeSimHeading,
  onToggleRealSensor,
  onChangeLockedBearing,
  onSelectTarget,
  onProjectBearingPin,
  onFlyTo,
  onClose
}) => {
  const dialRot = useContinuousAngle(-compassHeading);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ active: boolean; lastPointerAngle: number }>({
    active: false,
    lastPointerAngle: 0
  });
  const [customBearingInput, setCustomBearingInput] = useState<string>(
    lockedBearing !== null ? String(lockedBearing) : String(compassHeading)
  );

  useEffect(() => {
    if (lockedBearing !== null) {
      setCustomBearingInput(String(lockedBearing));
    }
  }, [lockedBearing]);

  const normHeading = ((Math.round(compassHeading) % 360) + 360) % 360;
  const backAzimuth = (normHeading + 180) % 360;
  const groundSlope = useMemo(
    () => Math.round(sampleDemSlopeDeg(dataset.dem, dataset.bounds, playerLat, playerLon)),
    [dataset, playerLat, playerLon]
  );

  const targetBearing = useMemo(() => {
    if (!lockedTarget) return null;
    return computeBearingDeg(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
  }, [lockedTarget, playerLat, playerLon]);

  // Deviation from locked sighting bearing
  const bearingDeviation = useMemo(() => {
    if (lockedBearing === null) return null;
    return Math.round(signedAngleDelta(lockedBearing, normHeading));
  }, [lockedBearing, normHeading]);

  // Real-time Line-of-Sight Scanner: Which Nui Dinh Landmarks & Pinned Rocks are straight ahead (±15°)?
  const landmarksAhead = useMemo(() => {
    const items: {
      id: string;
      name: string;
      emoji: string;
      dist: number;
      brng: number;
      deltaDeg: number;
      eleDiff: number;
      lat: number;
      lon: number;
      ele: number;
      category: string;
      note?: string;
      photoDataUrl?: string;
      isUserPin?: boolean;
    }[] = [];

    for (const pin of userPins) {
      const dist = haversineDistanceM(playerLat, playerLon, pin.lat, pin.lon);
      if (dist < 2) continue;
      const brng = computeBearingDeg(playerLat, playerLon, pin.lat, pin.lon);
      const delta = signedAngleDelta(brng, normHeading);
      if (Math.abs(delta) <= 18) {
        const cat = PIN_CATEGORIES.find((c) => c.id === pin.category);
        items.push({
          id: pin.id,
          name: pin.name,
          emoji: cat?.emoji || '🪨',
          dist,
          brng,
          deltaDeg: delta,
          eleDiff: Math.round(pin.ele - playerEle),
          lat: pin.lat,
          lon: pin.lon,
          ele: pin.ele,
          category: pin.category,
          note: pin.note,
          photoDataUrl: pin.photoDataUrl,
          isUserPin: true
        });
      }
    }

    const catEmoji: Record<string, string> = {
      peak: '⛰️',
      viewpoint: '🚁',
      temple: '⛩️',
      water: '🌊',
      camp: '⛺',
      junction: '🔀',
      boulder: '🧗',
      historic: '🏛️',
      warning: '⚠️'
    };

    for (const poi of dataset.pois) {
      if (poi.name.startsWith('Đỉnh phụ') && poi.ele < 350) continue;
      const dist = haversineDistanceM(playerLat, playerLon, poi.lat, poi.lon);
      if (dist < 3 || dist > 4800) continue;
      const brng = computeBearingDeg(playerLat, playerLon, poi.lat, poi.lon);
      const delta = signedAngleDelta(brng, normHeading);
      if (Math.abs(delta) <= 14) {
        const hasLeadIcon = (poi.name.codePointAt(0) ?? 0) > 0x2000;
        items.push({
          id: poi.id,
          name: poi.name,
          emoji: hasLeadIcon ? '' : catEmoji[poi.category] || '📍',
          dist,
          brng,
          deltaDeg: delta,
          eleDiff: Math.round(poi.ele - playerEle),
          lat: poi.lat,
          lon: poi.lon,
          ele: poi.ele,
          category: poi.category,
          note: poi.note
        });
      }
    }

    items.sort((a, b) => {
      if (a.isUserPin && !b.isUserPin) return -1;
      if (!a.isUserPin && b.isUserPin) return 1;
      return Math.abs(a.deltaDeg) * 25 + a.dist * 0.2 - (Math.abs(b.deltaDeg) * 25 + b.dist * 0.2);
    });

    return items.slice(0, 4);
  }, [userPins, dataset.pois, playerLat, playerLon, playerEle, normHeading]);

  // Interactive Pointer Drag on Dial (for smooth Web / Sim testing)
  const getPointerAngle = (clientX: number, clientY: number) => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
  };

  const handleDialPointerDown = (e: React.PointerEvent) => {
    if (useRealSensor) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = {
      active: true,
      lastPointerAngle: getPointerAngle(e.clientX, e.clientY)
    };
  };

  const handleDialPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current.active || useRealSensor) return;
    const curAngle = getPointerAngle(e.clientX, e.clientY);
    const delta = signedAngleDelta(curAngle, draggingRef.current.lastPointerAngle);
    draggingRef.current.lastPointerAngle = curAngle;
    // Dragging dial clockwise turns heading counter-clockwise (natural physical compass feel!)
    const nextHeading = (((compassHeading - delta) % 360) + 360) % 360;
    onChangeSimHeading(Math.round(nextHeading));
  };

  const handleDialPointerUp = () => {
    draggingRef.current.active = false;
  };

  const handleProjectAtDistance = (distM: number) => {
    const activeAzimuth = lockedBearing !== null ? lockedBearing : normHeading;
    const dest = projectPointByBearing(playerLat, playerLon, activeAzimuth, distM);
    const ele = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, dest.lat, dest.lon));
    const newPin: UserPin = {
      id: `compass-proj-${Date.now()}`,
      name: `Ngắm La Bàn ${activeAzimuth}° • ${distM}m`,
      category: 'checkpoint',
      lat: dest.lat,
      lon: dest.lon,
      ele,
      accuracy: null,
      createdAt: Date.now(),
      note: `Phóng từ la bàn góc ${activeAzimuth}° (${getVietnameseOrdinalName(activeAzimuth)}), cách ${distM}m`
    };
    if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    onProjectBearingPin(newPin);
    onFlyTo(dest.lat, dest.lon);
    onClose();
  };

  // Bubble Level clamping (-25..+25 deg -> -24..+24 px)
  const bubbleX = Math.max(-24, Math.min(24, (rollDeg / 25) * 24));
  const bubbleY = Math.max(-24, Math.min(24, (pitchDeg / 25) * 24));
  const isLevel = Math.hypot(pitchDeg, rollDeg) < 5;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="tactical-sheet compass-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <h3>🧭 La Bàn Chiến Thuật Thực Địa 360°</h3>
            <p className="mono-sub">
              Từ kế + Hướng GPS Vệ tinh + Thước thủy cân bằng & Ngắm cột mốc Offline
            </p>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Sensor Source Switcher */}
        <div className="compass-sensor-toggle">
          <button
            type="button"
            className={!useRealSensor ? 'active' : ''}
            onClick={() => onToggleRealSensor(false)}
          >
            🎛️ Xoay Tay Trên Web (Kéo mặt la bàn)
          </button>
          <button
            type="button"
            className={useRealSensor ? 'active' : ''}
            onClick={() => onToggleRealSensor(true)}
          >
            🧭 Cảm Biến Từ Kế Thật (Điện thoại)
          </button>
        </div>

        {/* Magnetic Interference Alert (220kV Powerline or Compass vs GPS Drift) */}
        {hasMagneticWarning && magneticWarningReason && (
          <div className="compass-mag-alert">
            <strong>⚡ CẢNH BÁO NHIỄU TỪ TRƯỜNG LA BÀN!</strong>
            <p>{magneticWarningReason}</p>
          </div>
        )}

        {/* Primary Digital Heading Readout */}
        <div className="compass-hero-readout">
          <div className="compass-big-deg">
            <span>{String(normHeading).padStart(3, '0')}°</span>
            <small>{getVietnameseOrdinalName(normHeading)}</small>
          </div>

          {bearingDeviation !== null && (
            <div className={`sighting-deviation-pill ${Math.abs(bearingDeviation) <= 3 ? 'on-target' : ''}`}>
              {Math.abs(bearingDeviation) <= 3
                ? `✅ ĐÚNG GÓC KHÓA ${lockedBearing}°`
                : bearingDeviation > 0
                  ? `🔒 Mục tiêu ${lockedBearing}°: Quay PHẢI +${bearingDeviation}°`
                  : `🔒 Mục tiêu ${lockedBearing}°: Quay TRÁI ${bearingDeviation}°`}
            </div>
          )}
        </div>

        {/* 360° Precision Sighting Dial + Spirit Bubble Level */}
        <div className="compass-stage-wrap">
          <div
            ref={dialRef}
            className={`compass-master-dial ${!useRealSensor ? 'draggable' : ''}`}
            onPointerDown={handleDialPointerDown}
            onPointerMove={handleDialPointerMove}
            onPointerUp={handleDialPointerUp}
            onPointerCancel={handleDialPointerUp}
          >
            {/* Fixed Lubber Sighting Hairline at 12 o'clock */}
            <div className="compass-lubber-top">
              <svg width="20" height="22" viewBox="0 0 20 22">
                <polygon points="10,20 2,4 18,4" fill="#FF3B30" />
              </svg>
            </div>

            {/* Rotating 360° SVG Rose */}
            <svg
              viewBox="0 0 300 300"
              className="compass-rose-svg"
              style={{ transform: `rotate(${dialRot}deg)` }}
            >
              <circle
                cx="150"
                cy="150"
                r="142"
                fill="rgba(9, 14, 24, 0.92)"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth="2"
              />
              <circle
                cx="150"
                cy="150"
                r="106"
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />

              {/* 180 Ticks (every 2 degrees) */}
              {Array.from({ length: 180 }).map((_, idx) => {
                const deg = idx * 2;
                const is30 = deg % 30 === 0;
                const is10 = deg % 10 === 0;
                const y1 = is30 ? 10 : is10 ? 12 : 14;
                const y2 = is30 ? 25 : is10 ? 21 : 18;
                const stroke =
                  deg === 0
                    ? '#FF3B30'
                    : is30
                      ? '#F8FAFC'
                      : is10
                        ? 'rgba(203,213,225,0.75)'
                        : 'rgba(148,163,184,0.34)';
                return (
                  <line
                    key={deg}
                    x1="150"
                    y1={y1}
                    x2="150"
                    y2={y2}
                    stroke={stroke}
                    strokeWidth={is30 ? 2.4 : is10 ? 1.4 : 0.9}
                    transform={`rotate(${deg} 150 150)`}
                  />
                );
              })}

              {/* Degree Labels every 30° */}
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
                <g key={`lbl-${deg}`} transform={`rotate(${deg} 150 150)`}>
                  <text
                    x="150"
                    y="39"
                    textAnchor="middle"
                    fill={deg === 0 ? '#FF453A' : '#94A3B8'}
                    fontSize="11"
                    fontWeight="700"
                  >
                    {deg}
                  </text>
                </g>
              ))}

              {/* Cardinal & Intercardinal Vietnamese Directions */}
              {[
                { deg: 0, txt: 'B', col: '#FF453A', size: 20, weight: 900 },
                { deg: 45, txt: 'ĐB', col: '#94A3B8', size: 12, weight: 700 },
                { deg: 90, txt: 'Đ', col: '#F8FAFC', size: 17, weight: 800 },
                { deg: 135, txt: 'ĐN', col: '#94A3B8', size: 12, weight: 700 },
                { deg: 180, txt: 'N', col: '#CBD5E1', size: 17, weight: 800 },
                { deg: 225, txt: 'TN', col: '#94A3B8', size: 12, weight: 700 },
                { deg: 270, txt: 'T', col: '#F8FAFC', size: 17, weight: 800 },
                { deg: 315, txt: 'TB', col: '#94A3B8', size: 12, weight: 700 }
              ].map((item) => (
                <g key={item.txt} transform={`rotate(${item.deg} 150 150)`}>
                  <text
                    x="150"
                    y="64"
                    textAnchor="middle"
                    fill={item.col}
                    fontSize={item.size}
                    fontWeight={item.weight}
                  >
                    {item.txt}
                  </text>
                </g>
              ))}

              {/* North Red Pointer Triangle on Rose */}
              <polygon points="150,70 143,86 157,86" fill="#FF3B30" />

              {/* Locked Sighting Bearing Marker (Cyan) */}
              {lockedBearing !== null && (
                <g transform={`rotate(${lockedBearing} 150 150)`}>
                  <line
                    x1="150"
                    y1="10"
                    x2="150"
                    y2="104"
                    stroke="#00F5D4"
                    strokeWidth="2.2"
                    strokeDasharray="5,4"
                  />
                  <polygon points="150,4 142,18 158,18" fill="#00F5D4" />
                </g>
              )}

              {/* Locked Waypoint/POI Target Bearing Bug (Gold) */}
              {targetBearing !== null && (
                <g transform={`rotate(${targetBearing} 150 150)`}>
                  <line
                    x1="150"
                    y1="14"
                    x2="150"
                    y2="98"
                    stroke="#FFD60A"
                    strokeWidth="2"
                    strokeDasharray="3,4"
                  />
                  <circle cx="150" cy="14" r="7" fill="#FFD60A" stroke="#090D16" strokeWidth="2" />
                </g>
              )}

              {/* Satellite GPS Course Vector Bug (Emerald Green) */}
              {gpsCourse !== null && (
                <g transform={`rotate(${gpsCourse} 150 150)`}>
                  <polygon points="150,22 144,34 156,34" fill="#30D158" />
                </g>
              )}
            </svg>

            {/* Center Spirit Bubble Level Crosshair (Fixed to Phone Frame) */}
            <div className={`spirit-level-core ${isLevel ? 'is-level' : ''}`}>
              <div className="spirit-cross-h" />
              <div className="spirit-cross-v" />
              <div
                className="spirit-bubble-dot"
                style={{ transform: `translate3d(${bubbleX}px, ${bubbleY}px, 0)` }}
              />
            </div>
          </div>

          {!useRealSensor && (
            <div className="compass-nudge-row">
              <button type="button" onClick={() => onChangeSimHeading((normHeading + 345) % 360)}>
                ↺ -15°
              </button>
              <button type="button" onClick={() => onChangeSimHeading((normHeading + 359) % 360)}>
                -1°
              </button>
              <button type="button" onClick={() => onChangeSimHeading(0)}>
                Bắc 0°
              </button>
              <button type="button" onClick={() => onChangeSimHeading((normHeading + 1) % 360)}>
                +1°
              </button>
              <button type="button" onClick={() => onChangeSimHeading((normHeading + 15) % 360)}>
                +15° ↻
              </button>
            </div>
          )}
        </div>

        {/* Tactical Readout Strip: Back-Azimuth, GPS Course, Ground Slope & Bubble Tilt */}
        <div className="compass-telemetry-grid">
          <div className="ct-cell">
            <small>🔄 GÓC NGƯỢC RÚT LUI</small>
            <strong>{formatBearingCardinal(backAzimuth)}</strong>
          </div>
          <div className="ct-cell">
            <small>🛰️ HƯỚNG ĐI GPS</small>
            <strong className="text-emerald">
              {gpsCourse !== null ? formatBearingCardinal(gpsCourse) : 'Đang đứng yên'}
            </strong>
          </div>
          <div className="ct-cell">
            <small>⛰️ CAO • DỐC ĐẤT</small>
            <strong>
              {playerEle}m • {groundSlope}°
            </strong>
          </div>
          <div className="ct-cell">
            <small>🫧 CÂN BẰNG MÁY</small>
            <strong className={isLevel ? 'text-emerald' : ''}>
              {isLevel ? 'Chuẩn phẳng' : `Nghiêng ${Math.round(Math.hypot(pitchDeg, rollDeg))}°`}
            </strong>
          </div>
        </div>

        {/* Line-of-Sight Landmarks Scanner ("Trước mũi la bàn có gì?") */}
        <div className="compass-los-box">
          <div className="los-header">
            <span>🔭 ĐỊA HÌNH & CỘT MỐC TRƯỚC MŨI NGẮM (±14°)</span>
            <small>{landmarksAhead.length} mốc khớp hướng</small>
          </div>
          {landmarksAhead.length === 0 ? (
            <div className="los-empty">
              Không có đỉnh/chùa/điểm ghim lớn nằm thẳng góc {normHeading}°. Hãy xoay la bàn để quét các mốc quanh bạn!
            </div>
          ) : (
            <div className="los-list">
              {landmarksAhead.map((lm) => (
                <div key={lm.id} className="los-item">
                  <div className="los-info">
                    <strong>
                      {lm.emoji ? `${lm.emoji} ` : ''}
                      {lm.name}
                    </strong>
                    <span>
                      Cách <b>{formatDistance(lm.dist)}</b> • Góc {Math.round(lm.brng)}° (
                      {Math.abs(Math.round(lm.deltaDeg)) <= 2
                        ? 'Thẳng mũi'
                        : lm.deltaDeg > 0
                          ? `Phải ${Math.round(lm.deltaDeg)}°`
                          : `Trái ${Math.abs(Math.round(lm.deltaDeg))}°`}
                      ) • {lm.eleDiff >= 0 ? `+${lm.eleDiff}m` : `${lm.eleDiff}m`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="los-lock-btn"
                    onClick={() => {
                      onSelectTarget({
                        id: lm.id,
                        name: lm.name,
                        lat: lm.lat,
                        lon: lm.lon,
                        ele: lm.ele,
                        category: lm.category,
                        note: lm.note,
                        photoDataUrl: lm.photoDataUrl
                      });
                      onFlyTo(lm.lat, lm.lon);
                      onClose();
                    }}
                  >
                    🎯 Khóa
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sighting Bearing Lock & 3D Terrain Ray Projection */}
        <div className="compass-lock-box">
          <div className="lock-row-top">
            <button
              type="button"
              className={`btn-sight-lock ${lockedBearing !== null ? 'locked' : ''}`}
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(20);
                if (lockedBearing !== null) {
                  onChangeLockedBearing(null);
                } else {
                  onChangeLockedBearing(normHeading);
                }
              }}
            >
              {lockedBearing !== null
                ? `🔓 Bỏ Khóa Góc (${lockedBearing}°)`
                : `🔒 Khóa Góc Đang Ngắm (${normHeading}°)`}
            </button>

            <div className="manual-bearing-set">
              <input
                type="number"
                min={0}
                max={359}
                value={customBearingInput}
                onChange={(e) => setCustomBearingInput(e.target.value)}
                placeholder="Góc °"
              />
              <button
                type="button"
                onClick={() => {
                  const v = ((Math.round(Number(customBearingInput) || 0) % 360) + 360) % 360;
                  onChangeLockedBearing(v);
                }}
              >
                Đặt góc
              </button>
            </div>
          </div>

          <div className="proj-ray-row">
            <small>
              🚀 Phóng tia hướng {lockedBearing !== null ? `${lockedBearing}° (đã khóa)` : `${normHeading}°`} lên núi 3D:
            </small>
            <div className="proj-ray-btns">
              <button type="button" onClick={() => handleProjectAtDistance(150)}>
                +150m
              </button>
              <button type="button" onClick={() => handleProjectAtDistance(350)}>
                +350m
              </button>
              <button type="button" onClick={() => handleProjectAtDistance(700)}>
                +700m
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
