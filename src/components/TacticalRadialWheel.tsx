import React from 'react';
import type { TacticalPalette } from '../types';
import { computeBearingDeg, formatDistance, haversineDistanceM } from '../utils/geoMath';

export type RadialActionId = 'navigate-gta' | 'pin-here' | 'fly-move' | 'lock-radar';

export interface RadialSpotState {
  lat: number;
  lon: number;
  ele: number;
  slope: number;
  screenX: number;
  screenY: number;
  originX: number;
  originY: number;
  dragX: number;
  dragY: number;
  activeSector: RadialActionId | null;
  pointerActive: boolean;
}

interface TacticalRadialWheelProps {
  spot: RadialSpotState;
  playerLat: number;
  playerLon: number;
  isSimMode: boolean;
  palette?: TacticalPalette;
  onSelectAction: (action: RadialActionId) => void;
  onClose: () => void;
}

interface SectorConfig {
  id: RadialActionId;
  startDeg: number;
  endDeg: number;
  labelX: number;
  labelY: number;
  icon: string;
  title: string;
  subtitle: string;
  isPrimary?: boolean;
}

const PALETTE_WHEEL_THEME: Record<
  TacticalPalette,
  { accent: string; accentGlow: string; gtaAccent: string; ringStroke: string }
> = {
  slate: {
    accent: '#7DD3FC',
    accentGlow: 'rgba(125, 211, 252, 0.28)',
    gtaAccent: '#93C5FD',
    ringStroke: 'rgba(148, 163, 184, 0.42)'
  },
  olive: {
    accent: '#A3E635',
    accentGlow: 'rgba(163, 230, 53, 0.26)',
    gtaAccent: '#BEF264',
    ringStroke: 'rgba(143, 166, 138, 0.48)'
  },
  amber: {
    accent: '#FBBF24',
    accentGlow: 'rgba(251, 191, 36, 0.28)',
    gtaAccent: '#F59E0B',
    ringStroke: 'rgba(194, 149, 90, 0.48)'
  },
  vivid: {
    accent: '#38BDF8',
    accentGlow: 'rgba(56, 189, 248, 0.34)',
    gtaAccent: '#FACC15',
    ringStroke: 'rgba(125, 211, 252, 0.5)'
  }
};

/**
 * Resolves pointer drag delta (dx, dy) into one of 4 cardinal tactical sectors or null inside deadzone.
 */
export function resolveRadialSector(
  dx: number,
  dy: number,
  deadzonePx = 24
): RadialActionId | null {
  const dist = Math.hypot(dx, dy);
  if (dist < deadzonePx) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= -135 && deg < -45) return 'navigate-gta'; // Swipe Up (-90°)
  if (deg >= -45 && deg < 45) return 'pin-here'; // Swipe Right (0°)
  if (deg >= 45 && deg < 135) return 'fly-move'; // Swipe Down (+90°)
  return 'lock-radar'; // Swipe Left (±180°)
}

function buildAnnularWedgePath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number
): string {
  const gapDeg = 3.2;
  const a1 = ((startDeg + gapDeg) * Math.PI) / 180;
  const a2 = ((endDeg - gapDeg) * Math.PI) / 180;
  const x1Out = cx + outerR * Math.cos(a1);
  const y1Out = cy + outerR * Math.sin(a1);
  const x2Out = cx + outerR * Math.cos(a2);
  const y2Out = cy + outerR * Math.sin(a2);
  const x2In = cx + innerR * Math.cos(a2);
  const y2In = cy + innerR * Math.sin(a2);
  const x1In = cx + innerR * Math.cos(a1);
  const y1In = cy + innerR * Math.sin(a1);
  const largeArc = endDeg - startDeg - 2 * gapDeg > 180 ? 1 : 0;

  return [
    `M ${x1Out.toFixed(2)} ${y1Out.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)}`,
    `L ${x2In.toFixed(2)} ${y2In.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1In.toFixed(2)} ${y1In.toFixed(2)}`,
    'Z'
  ].join(' ');
}

export const TacticalRadialWheel: React.FC<TacticalRadialWheelProps> = ({
  spot,
  playerLat,
  playerLon,
  isSimMode,
  palette = 'slate',
  onSelectAction,
  onClose
}) => {
  const theme = PALETTE_WHEEL_THEME[palette] || PALETTE_WHEEL_THEME.slate;
  const distM = haversineDistanceM(playerLat, playerLon, spot.lat, spot.lon);
  const brngDeg = Math.round(computeBearingDeg(playerLat, playerLon, spot.lat, spot.lon));

  const sectors: SectorConfig[] = [
    {
      id: 'navigate-gta',
      startDeg: -135,
      endDeg: -45,
      labelX: 124,
      labelY: 46,
      icon: '➤',
      title: 'ĐI TỚI ĐÂY',
      subtitle: 'LỘ TRÌNH GTA',
      isPrimary: true
    },
    {
      id: 'pin-here',
      startDeg: -45,
      endDeg: 45,
      labelX: 202,
      labelY: 124,
      icon: '⚑',
      title: 'GHIM MỐC',
      subtitle: 'LƯU ĐIỂM'
    },
    {
      id: 'fly-move',
      startDeg: 45,
      endDeg: 135,
      labelX: 124,
      labelY: 202,
      icon: isSimMode ? '⇣' : '⌖',
      title: isSimMode ? 'TỚI NGAY' : 'SOI GẦN',
      subtitle: isSimMode ? 'DI CHUYỂN NHANH' : 'CĂN CAMERA'
    },
    {
      id: 'lock-radar',
      startDeg: 135,
      endDeg: 225,
      labelX: 46,
      labelY: 124,
      icon: '◎',
      title: 'KHÓA TIA',
      subtitle: 'RADAR THẲNG'
    }
  ];

  // Rubber-banded 1:1 visual pointer indicator inside the wheel
  const rawDist = Math.hypot(spot.dragX, spot.dragY);
  const maxVisualR = 96;
  const clampedScale = rawDist > maxVisualR ? (maxVisualR + (rawDist - maxVisualR) * 0.18) / rawDist : 1;
  const ptrX = 124 + spot.dragX * clampedScale;
  const ptrY = 124 + spot.dragY * clampedScale;

  const activeCfg = sectors.find((s) => s.id === spot.activeSector) || null;

  return (
    <div
      className={`tactical-radial-overlay ${spot.pointerActive ? 'is-dragging' : 'is-pinned'}`}
      onPointerDown={(e) => {
        // Clicking outside closes when pinned; never interfere while active drag
        if (!spot.pointerActive && e.target === e.currentTarget) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="tactical-radial-wheel"
        style={
          {
            left: `${spot.screenX}px`,
            top: `${spot.screenY}px`,
            '--wheel-accent': theme.accent,
            '--wheel-gta': theme.gtaAccent,
            '--wheel-glow': theme.accentGlow
          } as React.CSSProperties
        }
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Top live telemetry pill above wheel */}
        <div className="radial-tele-badge">
          <span>
            ⛰️ <strong>{spot.ele}m</strong>
            {spot.slope > 0 ? (
              <>
                {' '}
                • Dốc <strong className={spot.slope >= 32 ? 'text-danger' : ''}>{spot.slope}°</strong>
              </>
            ) : null}
          </span>
          <span className="radial-tele-sep">•</span>
          <span>
            {formatDistance(distM)} ({String(brngDeg).padStart(3, '0')}°)
          </span>
        </div>

        {/* SVG Precision Rotary Dial */}
        <svg className="radial-svg-layer" width="248" height="248" viewBox="0 0 248 248">
          {/* Subtle Outer Tactical Tick Ring */}
          <circle
            cx="124"
            cy="124"
            r="116"
            fill="none"
            stroke={theme.ringStroke}
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {Array.from({ length: 16 }).map((_, i) => {
            const rad = (i * 22.5 * Math.PI) / 180;
            const r1 = i % 4 === 0 ? 111 : 114;
            const r2 = 120;
            return (
              <line
                key={i}
                x1={124 + r1 * Math.cos(rad)}
                y1={124 + r1 * Math.sin(rad)}
                x2={124 + r2 * Math.cos(rad)}
                y2={124 + r2 * Math.sin(rad)}
                stroke={i % 4 === 0 ? theme.accent : theme.ringStroke}
                strokeWidth={i % 4 === 0 ? 1.5 : 1}
                opacity={i % 4 === 0 ? 0.85 : 0.45}
              />
            );
          })}

          {/* 4 Annular Wedge Sectors */}
          {sectors.map((sec) => {
            const isActive = spot.activeSector === sec.id;
            const d = buildAnnularWedgePath(124, 124, 42, 110, sec.startDeg, sec.endDeg);
            const sectorAccent = sec.isPrimary ? theme.gtaAccent : theme.accent;
            return (
              <path
                key={sec.id}
                d={d}
                className={`radial-wedge ${isActive ? 'is-active' : ''} ${sec.isPrimary ? 'is-primary' : ''}`}
                fill={
                  isActive
                    ? theme.accentGlow
                    : sec.isPrimary
                      ? 'rgba(15, 23, 42, 0.88)'
                      : 'rgba(10, 15, 24, 0.84)'
                }
                stroke={isActive || sec.isPrimary ? sectorAccent : 'rgba(148, 163, 184, 0.34)'}
                strokeWidth={isActive ? 2.4 : sec.isPrimary ? 1.4 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAction(sec.id);
                }}
              />
            );
          })}

          {/* Live Gesture Vector Tether & Finger Cursor */}
          {spot.pointerActive && rawDist > 5 && (
            <g className="radial-pointer-tether">
              <line
                x1="124"
                y1="124"
                x2={ptrX}
                y2={ptrY}
                stroke={activeCfg ? (activeCfg.isPrimary ? theme.gtaAccent : theme.accent) : 'rgba(226, 232, 240, 0.6)'}
                strokeWidth="2"
                strokeDasharray="4 3"
              />
              <circle
                cx={ptrX}
                cy={ptrY}
                r={activeCfg ? 7 : 5}
                fill={activeCfg ? (activeCfg.isPrimary ? theme.gtaAccent : theme.accent) : '#E2E8F0'}
                stroke="#070B12"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Interactive Sector Labels (accessible via Swipe Release or Direct Tap) */}
        {sectors.map((sec) => {
          const isActive = spot.activeSector === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              className={`radial-sector-label ${isActive ? 'is-active' : ''} ${sec.isPrimary ? 'is-primary' : ''}`}
              style={{ left: `${sec.labelX}px`, top: `${sec.labelY}px` }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAction(sec.id);
              }}
            >
              <span className="rs-icon">{sec.icon}</span>
              <span className="rs-title">{sec.title}</span>
              <span className="rs-sub">{sec.subtitle}</span>
            </button>
          );
        })}

        {/* Center Reticle Hub (shows active action or close button) */}
        <button
          type="button"
          className={`radial-center-hub ${activeCfg ? 'has-selection' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (activeCfg) {
              onSelectAction(activeCfg.id);
            } else {
              onClose();
            }
          }}
          title={activeCfg ? activeCfg.title : 'Đóng vòng tròn chiến thuật'}
        >
          {activeCfg ? (
            <>
              <span className="rc-active-icon">{activeCfg.icon}</span>
              <span className="rc-active-text">THẢ</span>
            </>
          ) : (
            <>
              <span className="rc-cross">✕</span>
              <span className="rc-hint">{spot.pointerActive ? 'VUỐT' : 'CHỌN'}</span>
            </>
          )}
        </button>

        {/* Bottom coordinate strip */}
        <div className="radial-coord-strip">
          {spot.lat.toFixed(5)}N • {spot.lon.toFixed(5)}E
        </div>
      </div>
    </div>
  );
};
