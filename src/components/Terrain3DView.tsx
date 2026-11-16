import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  Camera3DMode,
  ImportedGpxTrack,
  NuiDinhDataset,
  PinCategory,
  PoiItem,
  TacticalPalette,
  TacticalTarget,
  Terrain3DSkin,
  TrackPoint,
  UserPin
} from '../types';
import {
  clipAndSubdividePolygonToBounds,
  clipAndSubdividePolylineToBounds,
  computeBearingDeg,
  formatDistance,
  getWorldDimensions,
  haversineDistanceM,
  latLonToWorld3D,
  projectPointByBearing,
  sampleDemElevation,
  sampleDemSlopeDeg,
  world3DToLatLon
} from '../utils/geoMath';
import { fetchTileWithCache } from '../utils/offlineVault';

interface Terrain3DViewProps {
  dataset: NuiDinhDataset;
  skin: Terrain3DSkin;
  cameraMode: Camera3DMode;
  verticalScale: number;
  visibleRoutes: Record<string, boolean>;
  showAllTrails: boolean;
  showPois: boolean;
  hidePoiBadges?: boolean;
  playerLat: number;
  playerLon: number;
  playerEle: number;
  playerAccuracy: number | null;
  compassHeading: number; // 0..360 deg (0 = North)
  gpsCourse: number | null; // 0..360 deg when moving
  speedMps: number | null;
  userPins: UserPin[];
  trackPoints: TrackPoint[];
  importedGpx: ImportedGpxTrack[];
  lockedTarget: TacticalTarget | null;
  lockedBearing: number | null;
  isSimMode: boolean;
  syntheticLandscape?: boolean;
  headingUp: boolean;
  palette?: TacticalPalette;
  onToggleHeadingUp: () => void;
  onMapInteractionChange?: (active: boolean) => void;
  flyToTrigger: { lat: number; lon: number; zoom?: number; seq: number } | null;
  onSelectTarget: (target: TacticalTarget) => void;
  onSelectUserPin: (pin: UserPin) => void;
  onRequestPinAt: (lat: number, lon: number, ele: number) => void;
  onSimMoveTo: (lat: number, lon: number) => void;
}

interface ProjectedBadge {
  id: string;
  label: string;
  sub?: string;
  emoji: string;
  color: string;
  x: number;
  y: number;
  isUserPin?: boolean;
  isLocked?: boolean;
  pinRef?: UserPin;
  poiRef?: PoiItem;
}

const PIN_EMOJI: Record<PinCategory, { emoji: string; color: string }> = {
  rock: { emoji: '🪨', color: '#FF9F0A' },
  poop: { emoji: '💩', color: '#FFD60A' },
  checkpoint: { emoji: '🚩', color: '#FF375F' },
  clue: { emoji: '🧩', color: '#BF5AF2' },
  water: { emoji: '💧', color: '#32ADE6' },
  deadend: { emoji: '⚠️', color: '#FF453A' },
  cache: { emoji: '🎒', color: '#30D158' }
};

const POI_STYLE: Record<string, { emoji: string; color: string }> = {
  peak: { emoji: '⛰️', color: '#D4A154' },
  viewpoint: { emoji: '🚁', color: '#D4B150' },
  temple: { emoji: '⛩️', color: '#C49048' },
  water: { emoji: '🌊', color: '#5A92B2' },
  camp: { emoji: '⛺', color: '#5F9E7D' },
  junction: { emoji: '🔀', color: '#649BA6' },
  boulder: { emoji: '🧗', color: '#8E84B5' },
  historic: { emoji: '🏛️', color: '#BA6D68' },
  warning: { emoji: '⚡', color: '#C8554E' }
};

const TACTICAL_ROUTE_COLORS: Record<TacticalPalette, Record<string, string>> = {
  slate: {
    red: '#B07C74',
    yellow: '#B8AA82',
    blue: '#7A93AC',
    green: '#7E9B88'
  },
  olive: {
    red: '#A87668',
    yellow: '#B5A87E',
    blue: '#789296',
    green: '#84A37E'
  },
  amber: {
    red: '#D48856',
    yellow: '#C9A66B',
    blue: '#A38355',
    green: '#B89660'
  },
  vivid: {
    red: '#D9534F',
    yellow: '#D4B13B',
    blue: '#4A89DC',
    green: '#48A868'
  }
};

export function resolveRouteColor(
  routeId: string,
  fallbackColor: string,
  palette: TacticalPalette = 'slate'
): string {
  const key = routeId.toLowerCase();
  const table = TACTICAL_ROUTE_COLORS[palette] || TACTICAL_ROUTE_COLORS.slate;
  for (const idKey of ['red', 'yellow', 'blue', 'green']) {
    if (key.includes(idKey)) return table[idKey];
  }
  return fallbackColor;
}

export function getMapOverlayPalette(palette: TacticalPalette = 'slate') {
  const isVivid = palette === 'vivid';
  const isAmber = palette === 'amber';
  const primary = isAmber
    ? 0xd49b54
    : palette === 'olive'
      ? 0x9ab096
      : isVivid
        ? 0x00f5d4
        : 0x94a3b8;
  const primaryHex = isAmber
    ? '#D49B54'
    : palette === 'olive'
      ? '#9AB096'
      : isVivid
        ? '#00F5D4'
        : '#CBD5E1';
  return {
    stream: isVivid ? '#38BDF8' : '#4A667A',
    streamOpacity: isVivid ? 0.75 : 0.42,
    power: isVivid ? '#C084FC' : '#5A6572',
    powerOpacity: isVivid ? 0.65 : 0.32,
    trail2D: isVivid ? '#E2E8F0' : '#788696',
    trail2DOpacity: isVivid ? 0.65 : 0.4,
    hazardHex: isVivid ? '#FF2D55' : '#8F4B4B',
    hazardQuarryHex: isVivid ? '#FF9F0A' : '#8F4B4B',
    hazardNum: isVivid ? 0xff2d55 : 0x8f4b4b,
    hazardWallOpacity: isVivid ? 0.24 : 0.14,
    hazardLineOpacity: isVivid ? 0.92 : 0.45,
    warningNum: isVivid ? 0xff3b30 : 0xa65853,
    junctionNum: isVivid ? 0x22d3ee : 0x7b93ab,
    primaryHex,
    primaryNum: primary,
    beaconCoreNum: isAmber ? 0xfef08a : 0xe0f2fe,
    beaconGlowNum: isAmber ? 0xf59e0b : 0x38bdf8,
    beaconHex: isAmber ? '#FEF08A' : '#38BDF8',
    playerCoreNum: isVivid ? 0x00f5d4 : 0xcbd5e1,
    arrowHex: isVivid ? '#30D158' : '#7D9E85',
    arrowNum: isVivid ? 0x30d158 : 0x7d9e85,
    arcNum: isVivid ? 0xffd60a : 0xc8a25a,
    groundArcNum: isVivid ? 0xff9f0a : 0xb87e52
  };
}

function resolvePoiBadgeAccent(category: string, palette: TacticalPalette): string {
  if (palette === 'vivid') {
    return (POI_STYLE[category] || { color: '#94A3B8' }).color;
  }
  if (category === 'warning') return '#B06A63';
  if (palette === 'olive') return '#8FA68A';
  if (palette === 'amber') return '#C2955A';
  return '#8B9BB0';
}

function clearAndDisposeGroup(grp: THREE.Group): void {
  while (grp.children.length > 0) {
    const ch = grp.children.pop()!;
    grp.remove(ch);
    const meshOrLine = ch as THREE.Mesh | THREE.Line;
    if (meshOrLine.geometry) {
      meshOrLine.geometry.dispose();
    }
    if (meshOrLine.material) {
      if (Array.isArray(meshOrLine.material)) {
        meshOrLine.material.forEach((m) => m.dispose());
      } else {
        meshOrLine.material.dispose();
      }
    }
  }
}

function formatTacticalCallout(rawName: string): string {
  const withoutParens = rawName.replace(/\([^)]*\)/g, '').trim();
  const base = withoutParens.split(/[•\-–]/)[0]?.trim() || withoutParens;
  const cleaned = base
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, '')
    .replace(/^Vùng\s+/i, '')
    .trim();
  const text = (cleaned || rawName).toUpperCase();
  return text.length > 22 ? `${text.slice(0, 21).trimEnd()}…` : text;
}

function createCardinalSprite(label: string, color: string): {
  sprite: THREE.Sprite;
  tex: THREE.CanvasTexture;
  mat: THREE.SpriteMaterial;
} {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(7, 11, 18, 0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(6, 8, 180, 48, 24);
  } else {
    ctx.rect(6, 8, 180, 48);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 96, 33);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(280, 94, 1);
  return { sprite, tex, mat };
}

function buildProceduralTerrainCanvas(
  dataset: NuiDinhDataset,
  mode: 'tactical' | 'topo' | 'night',
  palette: TacticalPalette = 'slate'
): HTMLCanvasElement {
  const W = 1536;
  const H = 1536;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;

  const { bounds, dem } = dataset;
  const dLat = bounds.north - bounds.south;
  const dLon = bounds.east - bounds.west;

  // Sun vector from NW (315 deg, altitude 48 deg)
  const sunX = -0.52;
  const sunY = 0.52;
  const sunZ = 0.68;

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const lat = bounds.north - v * dLat;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const lon = bounds.west + u * dLon;

      const ele = sampleDemElevation(dem, bounds, lat, lon);
      const eR = sampleDemElevation(dem, bounds, lat, lon + 0.00025);
      const eL = sampleDemElevation(dem, bounds, lat, lon - 0.00025);
      const eU = sampleDemElevation(dem, bounds, lat + 0.00025, lon);
      const eD = sampleDemElevation(dem, bounds, lat - 0.00025, lon);

      const dx = (eR - eL) / 54.0;
      const dy = (eU - eD) / 55.0;
      const slope = Math.sqrt(dx * dx + dy * dy);
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const shade = Math.max(0.18, Math.min(1.22, (-dx * sunX - dy * sunY + sunZ) * invLen * 1.25));

      let r = 0, g = 0, b = 0;

      if (mode === 'tactical') {
        if (palette === 'slate') {
          // Low-saturation Obsidian Charcoal-Slate Spec-Ops Terrain
          if (ele < 25) {
            r = 8; g = 11; b = 15;
          } else if (ele < 110) {
            const t = (ele - 25) / 85;
            r = 8 + t * 6;
            g = 11 + t * 7;
            b = 15 + t * 7;
          } else if (ele < 260) {
            const t = (ele - 110) / 150;
            r = 14 + t * 7;
            g = 18 + t * 8;
            b = 22 + t * 9;
          } else if (ele < 400) {
            const t = (ele - 260) / 140;
            r = 21 + t * 6;
            g = 26 + t * 7;
            b = 31 + t * 8;
          } else {
            const t = Math.min(1, (ele - 400) / 115);
            r = 27 + t * 7;
            g = 33 + t * 8;
            b = 39 + t * 8;
          }

          if (slope > 0.62) {
            const cliffFactor = Math.min(1, (slope - 0.62) * 2.2);
            r = r * (1 - cliffFactor) + 120 * cliffFactor;
            g = g * (1 - cliffFactor) + 96 * cliffFactor;
            b = b * (1 - cliffFactor) + 84 * cliffFactor;
          }

          r *= shade * 1.18;
          g *= shade * 1.18;
          b *= shade * 1.18;

          if (ele > 15) {
            const mod100 = ele % 100;
            const mod25 = ele % 25;
            const tol = Math.max(0.32, slope * 1.55);
            if (mod100 < tol || 100 - mod100 < tol) {
              r = r * 0.56 + 130 * 0.44;
              g = g * 0.56 + 145 * 0.44;
              b = b * 0.56 + 160 * 0.44;
            } else if (mod25 < tol * 0.6 || 25 - mod25 < tol * 0.6) {
              r = r * 0.78 + 70 * 0.22;
              g = g * 0.78 + 82 * 0.22;
              b = b * 0.78 + 94 * 0.22;
            }
          }

          const mx = Math.min(x % 96, 96 - (x % 96));
          const my = Math.min(y % 96, 96 - (y % 96));
          if ((mx === 0 && my <= 5) || (my === 0 && mx <= 5)) {
            r += 14; g += 18; b += 24;
          }
        } else if (palette === 'olive') {
          // Muted Olive-Black Spec-Ops Recon Skin
          if (ele < 25) {
            r = 8; g = 13; b = 10;
          } else if (ele < 180) {
            const t = (ele - 25) / 155;
            r = 8 + t * 11;
            g = 13 + t * 14;
            b = 10 + t * 9;
          } else if (ele < 360) {
            const t = (ele - 180) / 180;
            r = 19 + t * 8;
            g = 27 + t * 9;
            b = 19 + t * 8;
          } else {
            const t = Math.min(1, (ele - 360) / 155);
            r = 27 + t * 8;
            g = 36 + t * 9;
            b = 27 + t * 7;
          }

          if (slope > 0.62) {
            const cliffFactor = Math.min(1, (slope - 0.62) * 2.2);
            r = r * (1 - cliffFactor) + 125 * cliffFactor;
            g = g * (1 - cliffFactor) + 92 * cliffFactor;
            b = b * (1 - cliffFactor) + 76 * cliffFactor;
          }

          r *= shade * 1.15;
          g *= shade * 1.15;
          b *= shade * 1.15;

          if (ele > 15) {
            const mod100 = ele % 100;
            const mod25 = ele % 25;
            const tol = Math.max(0.32, slope * 1.55);
            if (mod100 < tol || 100 - mod100 < tol) {
              r = r * 0.56 + 132 * 0.44;
              g = g * 0.56 + 154 * 0.44;
              b = b * 0.56 + 128 * 0.44;
            } else if (mod25 < tol * 0.6 || 25 - mod25 < tol * 0.6) {
              r = r * 0.78 + 64 * 0.22;
              g = g * 0.78 + 82 * 0.22;
              b = b * 0.78 + 62 * 0.22;
            }
          }

          const mx = Math.min(x % 96, 96 - (x % 96));
          const my = Math.min(y % 96, 96 - (y % 96));
          if ((mx === 0 && my <= 5) || (my === 0 && mx <= 5)) {
            r += 14; g += 24; b += 16;
          }
        } else if (palette === 'amber') {
          // Cockpit Night Amber Brown Terrain Skin
          const norm = Math.min(1, ele / 515);
          r = 12 + norm * 24;
          g = 9 + norm * 18;
          b = 6 + norm * 12;

          if (slope > 0.62) {
            const cliffFactor = Math.min(1, (slope - 0.62) * 2.2);
            r = r * (1 - cliffFactor) + 148 * cliffFactor;
            g = g * (1 - cliffFactor) + 90 * cliffFactor;
            b = b * (1 - cliffFactor) + 58 * cliffFactor;
          }

          r *= shade * 1.15;
          g *= shade * 1.15;
          b *= shade * 1.15;

          if (ele > 15) {
            const mod100 = ele % 100;
            const mod25 = ele % 25;
            const tol = Math.max(0.32, slope * 1.55);
            if (mod100 < tol || 100 - mod100 < tol) {
              r = r * 0.55 + 176 * 0.45;
              g = g * 0.55 + 130 * 0.45;
              b = b * 0.55 + 74 * 0.45;
            } else if (mod25 < tol * 0.6 || 25 - mod25 < tol * 0.6) {
              r = r * 0.78 + 92 * 0.22;
              g = g * 0.78 + 68 * 0.22;
              b = b * 0.78 + 40 * 0.22;
            }
          }

          const mx = Math.min(x % 96, 96 - (x % 96));
          const my = Math.min(y % 96, 96 - (y % 96));
          if ((mx === 0 && my <= 5) || (my === 0 && mx <= 5)) {
            r += 24; g += 16; b += 8;
          }
        } else {
          // Vivid Deep-Teal / Olive Spec-Ops Skin
          if (ele < 25) {
            r = 5; g = 10; b = 15;
          } else if (ele < 110) {
            const t = (ele - 25) / 85;
            r = 5 + t * 5;
            g = 10 + t * 11;
            b = 15 + t * 15;
          } else if (ele < 260) {
            const t = (ele - 110) / 150;
            r = 10 + t * 7;
            g = 21 + t * 13;
            b = 30 + t * 7;
          } else if (ele < 400) {
            const t = (ele - 260) / 140;
            r = 17 + t * 10;
            g = 34 + t * 15;
            b = 37 - t * 4;
          } else {
            const t = Math.min(1, (ele - 400) / 115);
            r = 27 + t * 16;
            g = 49 + t * 17;
            b = 33 + t * 13;
          }

          if (slope > 0.62) {
            const cliffFactor = Math.min(1, (slope - 0.62) * 2.3);
            r = r * (1 - cliffFactor) + 175 * cliffFactor;
            g = g * (1 - cliffFactor) + 72 * cliffFactor;
            b = b * (1 - cliffFactor) + 56 * cliffFactor;
          }

          r *= shade * 1.1;
          g *= shade * 1.1;
          b *= shade * 1.1;

          if (ele > 15) {
            const mod100 = ele % 100;
            const mod25 = ele % 25;
            const tol = Math.max(0.32, slope * 1.55);
            if (mod100 < tol || 100 - mod100 < tol) {
              r = r * 0.45 + 215 * 0.55;
              g = g * 0.45 + 175 * 0.55;
              b = b * 0.45 + 75 * 0.55;
            } else if (mod25 < tol * 0.6 || 25 - mod25 < tol * 0.6) {
              r = r * 0.72 + 56 * 0.28;
              g = g * 0.72 + 165 * 0.28;
              b = b * 0.72 + 195 * 0.28;
            }
          }

          const mx = Math.min(x % 96, 96 - (x % 96));
          const my = Math.min(y % 96, 96 - (y % 96));
          if ((mx === 0 && my <= 5) || (my === 0 && mx <= 5)) {
            r += 16; g += 62; b += 66;
          }
        }
      } else if (mode === 'night') {
        // Tactical Night Vision Recon Skin
        const norm = Math.min(1, ele / 515);
        r = 6 + norm * 16;
        g = 24 + norm * 95;
        b = 20 + norm * 48;

        // 20m & 100m neon contour lines
        const mod20 = ele % 20;
        const mod100 = ele % 100;
        const cThick = Math.max(0.35, slope * 1.6);
        if (ele > 12 && (mod100 < cThick || 100 - mod100 < cThick)) {
          r = 40; g = 245; b = 170;
        } else if (ele > 12 && (mod20 < cThick * 0.65 || 20 - mod20 < cThick * 0.65)) {
          r = 18; g = 135; b = 95;
        }

        // Steep cliff alert glow in night mode
        if (slope > 0.68) {
          r = Math.min(255, r + 140);
          g = Math.max(40, g * 0.65);
        }

        // 500m tactical grid
        if (x % 96 === 0 || y % 96 === 0) {
          r += 12; g += 38; b += 28;
        }

        r *= shade * 0.95;
        g *= shade * 0.95;
        b *= shade * 0.95;
      } else {
        // Rich Outdoor Hypsometric Forest Topo Skin
        if (ele < 22) {
          r = 26; g = 38; b = 34;
        } else if (ele < 90) {
          const t = (ele - 22) / 68;
          r = 28 + t * 14;
          g = 52 + t * 28;
          b = 36 + t * 8;
        } else if (ele < 240) {
          const t = (ele - 90) / 150;
          r = 42 + t * 24;
          g = 80 + t * 26;
          b = 44 + t * 6;
        } else if (ele < 390) {
          const t = (ele - 240) / 150;
          r = 66 + t * 44;
          g = 106 - t * 6;
          b = 50 + t * 12;
        } else {
          const t = Math.min(1, (ele - 390) / 125);
          r = 110 + t * 58;
          g = 100 + t * 42;
          b = 62 + t * 36;
        }

        // Highlight steep granite cliffs (> 32 deg slope)
        if (slope > 0.62) {
          const cliffFactor = Math.min(1, (slope - 0.62) * 2.2);
          r = r * (1 - cliffFactor) + 178 * cliffFactor;
          g = g * (1 - cliffFactor) + 92 * cliffFactor;
          b = b * (1 - cliffFactor) + 58 * cliffFactor;
        }

        r *= shade;
        g *= shade;
        b *= shade;

        // Crisp 10m & 50m Topographic Contour Lines
        if (ele > 15) {
          const mod50 = ele % 50;
          const mod10 = ele % 10;
          const tol = Math.max(0.28, slope * 1.35);
          if (mod50 < tol || 50 - mod50 < tol) {
            r = r * 0.45 + 235 * 0.55;
            g = g * 0.45 + 210 * 0.55;
            b = b * 0.45 + 160 * 0.55;
          } else if (mod10 < tol * 0.55 || 10 - mod10 < tol * 0.55) {
            r = r * 0.76 + 195 * 0.24;
            g = g * 0.76 + 185 * 0.24;
            b = b * 0.76 + 150 * 0.24;
          }
        }
      }

      const idx = (y * W + x) * 4;
      px[idx] = Math.min(255, Math.max(0, r));
      px[idx + 1] = Math.min(255, Math.max(0, g));
      px[idx + 2] = Math.min(255, Math.max(0, b));
      px[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function stitchSatelliteCanvas(
  dataset: NuiDinhDataset,
  fallbackTopo: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  const W = 1536;
  const H = 1536;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Draw offline topo underneath first so missing/offline tiles gracefully blend!
  ctx.drawImage(fallbackTopo, 0, 0, W, H);

  const z = 15;
  const lon2f = (lon: number) => ((lon + 180) / 360) * Math.pow(2, z);
  const lat2f = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
  };

  const { bounds } = dataset;
  const fxMin = lon2f(bounds.west);
  const fxMax = lon2f(bounds.east);
  const fyMin = lat2f(bounds.north);
  const fyMax = lat2f(bounds.south);

  const txStart = Math.floor(fxMin);
  const txEnd = Math.floor(fxMax);
  const tyStart = Math.floor(fyMin);
  const tyEnd = Math.floor(fyMax);

  const tasks: Promise<void>[] = [];
  for (let tx = txStart; tx <= txEnd; tx++) {
    for (let ty = tyStart; ty <= tyEnd; ty++) {
      tasks.push(
        (async () => {
          const blob = await fetchTileWithCache('google-sat', z, tx, ty);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image();
              el.onload = () => resolve(el);
              el.onerror = reject;
              el.src = url;
            });
            const dx0 = ((tx - fxMin) / (fxMax - fxMin)) * W;
            const dx1 = ((tx + 1 - fxMin) / (fxMax - fxMin)) * W;
            const dy0 = ((ty - fyMin) / (fyMax - fyMin)) * H;
            const dy1 = ((ty + 1 - fyMin) / (fyMax - fyMin)) * H;
            ctx.drawImage(img, dx0, dy0, dx1 - dx0 + 0.6, dy1 - dy0 + 0.6);
          } catch {
            // keep topo fallback
          } finally {
            URL.revokeObjectURL(url);
          }
        })()
      );
    }
  }

  await Promise.all(tasks);
  return canvas;
}

export const Terrain3DView: React.FC<Terrain3DViewProps> = ({
  dataset,
  skin,
  cameraMode,
  verticalScale,
  visibleRoutes,
  showAllTrails,
  showPois,
  hidePoiBadges = false,
  playerLat,
  playerLon,
  playerEle,
  compassHeading,
  gpsCourse,
  speedMps,
  userPins,
  trackPoints,
  importedGpx,
  lockedTarget,
  lockedBearing,
  isSimMode,
  syntheticLandscape = false,
  headingUp,
  palette = 'slate',
  onToggleHeadingUp,
  onMapInteractionChange,
  flyToTrigger,
  onSelectTarget,
  onSelectUserPin,
  onRequestPinAt,
  onSimMoveTo
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneResizeRef = useRef<(() => void) | null>(null);
  const followPlayerRef = useRef<boolean>(false);
  const [badges, setBadges] = useState<ProjectedBadge[]>([]);
  const [camAzimuthDeg, setCamAzimuthDeg] = useState<number>(0);
  const [inspectedSpot, setInspectedSpot] = useState<{
    lat: number;
    lon: number;
    ele: number;
    slope: number;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [satLoading, setSatLoading] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowGestureHint(false), 3500);
    return () => window.clearTimeout(timer);
  }, []);

  // Refs for mutable live values inside requestAnimationFrame
  const liveStateRef = useRef({
    playerLat,
    playerLon,
    playerEle,
    compassHeading,
    gpsCourse,
    speedMps,
    cameraMode,
    verticalScale,
    showPois,
    hidePoiBadges,
    userPins,
    lockedTarget,
    isSimMode,
    syntheticLandscape,
    headingUp,
    palette,
    onMapInteractionChange
  });
  liveStateRef.current = {
    playerLat,
    playerLon,
    playerEle,
    compassHeading,
    gpsCourse,
    speedMps,
    cameraMode,
    verticalScale,
    showPois,
    hidePoiBadges,
    userPins,
    lockedTarget,
    isSimMode,
    syntheticLandscape,
    headingUp,
    palette,
    onMapInteractionChange
  };

  useEffect(() => {
    const raf = requestAnimationFrame(() => sceneResizeRef.current?.());
    return () => cancelAnimationFrame(raf);
  }, [syntheticLandscape]);

  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    terrainMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    skirtMesh: THREE.Mesh;
    overlaysGroup: THREE.Group;
    pinsGroup: THREE.Group;
    trackGroup: THREE.Group;
    targetArcGroup: THREE.Group;
    playerGroup: THREE.Group;
    viewConeMesh: THREE.Mesh;
    courseArrowGroup: THREE.Group;
    inspectMarker: THREE.Mesh;
    tacticalTexture: THREE.CanvasTexture | null;
    tacticalPalette: TacticalPalette;
    topoTexture: THREE.CanvasTexture | null;
    nightTexture: THREE.CanvasTexture | null;
    satTexture: THREE.CanvasTexture | null;
    playerMaterials: {
      coreMat: THREE.MeshBasicMaterial;
      haloMat: THREE.MeshBasicMaterial;
      rangeMat: THREE.MeshBasicMaterial;
      spireMat: THREE.MeshBasicMaterial;
      spireGlowMat: THREE.MeshBasicMaterial;
      pillarPulseMat: THREE.MeshBasicMaterial;
      coneMat: THREE.MeshBasicMaterial;
      sightBeamMat: THREE.LineBasicMaterial;
      arrowMat: THREE.MeshBasicMaterial;
    };
  } | null>(null);

  // 1. Initialize Three.js Scene Once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { widthM, depthM } = getWorldDimensions(dataset.bounds);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070A0F');
    scene.fog = new THREE.FogExp2('#070A0F', 0.000058);

    const camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / Math.max(1, container.clientHeight),
      8,
      26000
    );
    // Start looking at Nui Dinh from South-Southwest overlooking Suoi Da -> Dinh La Ban!
    camera.position.set(-1450, 2250, 3950);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera);
    controls.domElement = renderer.domElement;
    // Remap pointer & wheel coordinates cleanly when running in Pure-OTA Synthetic Landscape (+90deg)
    const rawCtrl = controls as unknown as {
      _onPointerDown: (ev: PointerEvent) => void;
      _onPointerMove: (ev: PointerEvent) => void;
      _onPointerUp: (ev: PointerEvent) => void;
      _onMouseWheel: (ev: WheelEvent) => void;
      connect: () => void;
    };
    const wrapEv = <E extends Event>(ev: E): E => {
      if (!liveStateRef.current.syntheticLandscape) return ev;
      const me = ev as unknown as { clientX?: number; clientY?: number };
      const rx = typeof me.clientY === 'number' ? me.clientY : 0;
      const ry = typeof me.clientX === 'number' ? window.innerWidth - me.clientX : 0;
      return new Proxy(ev, {
        get(target, prop) {
          if (prop === 'clientX' || prop === 'pageX') return rx;
          if (prop === 'clientY' || prop === 'pageY') return ry;
          const val = Reflect.get(target, prop, target);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
    };
    const origPtrDown = rawCtrl._onPointerDown;
    const origPtrMove = rawCtrl._onPointerMove;
    const origPtrUp = rawCtrl._onPointerUp;
    const origWheel = rawCtrl._onMouseWheel;
    rawCtrl._onPointerDown = (ev: PointerEvent) => origPtrDown(wrapEv(ev));
    rawCtrl._onPointerMove = (ev: PointerEvent) => origPtrMove(wrapEv(ev));
    rawCtrl._onPointerUp = (ev: PointerEvent) => origPtrUp(wrapEv(ev));
    rawCtrl._onMouseWheel = (ev: WheelEvent) => origWheel(wrapEv(ev));
    rawCtrl.connect();

    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI * 0.482; // never clip underground
    controls.minDistance = 160;
    controls.maxDistance = 11500;
    controls.target.set(0, 320, 150);

    let isUserInteracting = false;
    const dragStartTarget = new THREE.Vector3();
    const onCtrlStart = () => {
      isUserInteracting = true;
      dragStartTarget.copy(controls.target);
    };
    const onCtrlEnd = () => {
      isUserInteracting = false;
      if (controls.target.distanceTo(dragStartTarget) > 45) {
        followPlayerRef.current = false;
      }
    };
    controls.addEventListener('start', onCtrlStart);
    controls.addEventListener('end', onCtrlEnd);

    // Lighting for crisp 3D mountain ridges
    const ambient = new THREE.AmbientLight(0xdbeafe, 1.05);
    scene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.35);
    sunLight.position.set(-3200, 4600, -2800);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x64748b, 0.35);
    rimLight.position.set(3000, 1800, 3200);
    scene.add(rimLight);

    // Build Real 192x192 SRTM Terrain Geometry
    const { cols, rows, elevations } = dataset.dem;
    const terrainGeo = new THREE.PlaneGeometry(widthM, depthM, cols - 1, rows - 1);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, elevations[i] * verticalScale);
    }
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingBox();
    terrainGeo.computeBoundingSphere();

    const initPalette = liveStateRef.current.palette || 'slate';
    const initOv = getMapOverlayPalette(initPalette);
    const tacticalCanvas = buildProceduralTerrainCanvas(dataset, 'tactical', initPalette);
    const tacticalTex = new THREE.CanvasTexture(tacticalCanvas);
    tacticalTex.colorSpace = THREE.SRGBColorSpace;
    tacticalTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const terrainMat = new THREE.MeshStandardMaterial({
      map: tacticalTex,
      roughness: 0.9,
      metalness: 0.05
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrainMesh);

    // Geological Sand-Table Base Plinth under the mountain block
    const plinthGeo = new THREE.BoxGeometry(widthM + 20, 160, depthM + 20);
    plinthGeo.translate(0, -82, 0);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x0c1117,
      roughness: 0.95,
      metalness: 0.08
    });
    const skirtMesh = new THREE.Mesh(plinthGeo, plinthMat);
    scene.add(skirtMesh);

    // Subtle North-South-East-West Cardinal Rim Ring & Perimeter Sprites
    const gridHelper = new THREE.GridHelper(Math.max(widthM, depthM) * 1.15, 24, 0x1e293b, 0x0d131a);
    gridHelper.position.y = -4;
    scene.add(gridHelper);

    const staticDisposables: { dispose: () => void }[] = [];
    const cardinalDefs: [string, string, number, number, number][] = [
      ['B • 000°', '#B85C56', 0, 90, -depthM * 0.54],
      ['Đ • 090°', '#7B93AB', widthM * 0.54, 90, 0],
      ['N • 180°', '#64748B', 0, 90, depthM * 0.54],
      ['T • 270°', '#7B93AB', -widthM * 0.54, 90, 0]
    ];
    for (const [lbl, col, cx, cy, cz] of cardinalDefs) {
      const { sprite, tex, mat } = createCardinalSprite(lbl, col);
      sprite.position.set(cx, cy, cz);
      scene.add(sprite);
      staticDisposables.push(tex, mat);
    }

    const overlaysGroup = new THREE.Group();
    const pinsGroup = new THREE.Group();
    const trackGroup = new THREE.Group();
    const targetArcGroup = new THREE.Group();
    scene.add(overlaysGroup, pinsGroup, trackGroup, targetArcGroup);

    // Player 3D Group (Avatar + 120m Range Ring + Compass View Cone + Laser Sighting Beam + GPS Course Vector)
    const playerGroup = new THREE.Group();
    scene.add(playerGroup);

    // Core Sphere
    const coreGeo = new THREE.SphereGeometry(14, 20, 20);
    const coreMat = new THREE.MeshBasicMaterial({
      color: initOv.beaconCoreNum,
      blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 16;
    playerGroup.add(coreMesh);

    // Outer Halo Ring
    const haloGeo = new THREE.RingGeometry(22, 34, 32);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({
      color: initOv.beaconGlowNum,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.y = 4;
    playerGroup.add(haloMesh);

    // Tactical 120m Perimeter Range Ring
    const rangeGeo = new THREE.RingGeometry(118, 122, 48);
    rangeGeo.rotateX(-Math.PI / 2);
    const rangeMat = new THREE.MeshBasicMaterial({
      color: initOv.primaryNum,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const rangeMesh = new THREE.Mesh(rangeGeo, rangeMat);
    rangeMesh.position.y = 5;
    playerGroup.add(rangeMesh);
    staticDisposables.push(rangeGeo, rangeMat);

    // 420m Sky Light Pillar (Bright core + soft outer aura + ascending pulse ring)
    const spireGeo = new THREE.CylinderGeometry(2.8, 6.0, 420, 16);
    spireGeo.translate(0, 210, 0);
    const spireMat = new THREE.MeshBasicMaterial({
      color: initOv.beaconCoreNum,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    playerGroup.add(new THREE.Mesh(spireGeo, spireMat));

    const spireGlowGeo = new THREE.CylinderGeometry(10, 24, 420, 16, 1, true);
    spireGlowGeo.translate(0, 210, 0);
    const spireGlowMat = new THREE.MeshBasicMaterial({
      color: initOv.beaconGlowNum,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    playerGroup.add(new THREE.Mesh(spireGlowGeo, spireGlowMat));

    const pillarPulseGeo = new THREE.RingGeometry(9, 20, 28);
    pillarPulseGeo.rotateX(-Math.PI / 2);
    const pillarPulseMat = new THREE.MeshBasicMaterial({
      color: initOv.beaconCoreNum,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const pillarPulseMesh = new THREE.Mesh(pillarPulseGeo, pillarPulseMat);
    pillarPulseMesh.position.y = 8;
    playerGroup.add(pillarPulseMesh);
    staticDisposables.push(
      spireGeo,
      spireMat,
      spireGlowGeo,
      spireGlowMat,
      pillarPulseGeo,
      pillarPulseMat
    );

    // Sensor Compass View Frustum Fan (points along -Z when rotation.y = 0 => Due North!)
    const sectorShape = new THREE.Shape();
    sectorShape.moveTo(0, 0);
    const coneRadius = 260;
    const halfAngle = (26 * Math.PI) / 180;
    const steps = 18;
    for (let s = 0; s <= steps; s++) {
      const a = -halfAngle + (s / steps) * halfAngle * 2;
      // In Shape 2D before rotateX(-PI/2): +Y becomes -Z (North)!
      sectorShape.lineTo(Math.sin(a) * coneRadius, Math.cos(a) * coneRadius);
    }
    sectorShape.closePath();
    const coneGeo = new THREE.ShapeGeometry(sectorShape);
    coneGeo.rotateX(-Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: initOv.primaryNum,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const viewConeMesh = new THREE.Mesh(coneGeo, coneMat);
    viewConeMesh.position.y = 8;

    // 380m Sighting Centerline along forward phone axis (-Z)
    const sightBeamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, -380)
    ]);
    const sightBeamMat = new THREE.LineBasicMaterial({
      color: initOv.playerCoreNum,
      transparent: true,
      opacity: 0.58
    });
    viewConeMesh.add(new THREE.Line(sightBeamGeo, sightBeamMat));
    staticDisposables.push(sightBeamGeo, sightBeamMat);
    playerGroup.add(viewConeMesh);

    // True GPS Course Arrow (Subdued Olive/Emerald Vector)
    const courseArrowGroup = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(3.2, 3.2, 130, 8);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 12, -65);
    const headGeo = new THREE.ConeGeometry(12, 34, 12);
    headGeo.rotateX(-Math.PI / 2);
    headGeo.translate(0, 12, -142);
    const arrowMat = new THREE.MeshBasicMaterial({ color: initOv.arrowNum });
    courseArrowGroup.add(new THREE.Mesh(shaftGeo, arrowMat), new THREE.Mesh(headGeo, arrowMat));
    playerGroup.add(courseArrowGroup);

    // Raycast Inspect Ring Marker
    const inspectGeo = new THREE.RingGeometry(14, 22, 24);
    inspectGeo.rotateX(-Math.PI / 2);
    const inspectMat = new THREE.MeshBasicMaterial({
      color: 0xc8a25a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });
    const inspectMarker = new THREE.Mesh(inspectGeo, inspectMat);
    inspectMarker.visible = false;
    scene.add(inspectMarker);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      terrainMesh,
      skirtMesh,
      overlaysGroup,
      pinsGroup,
      trackGroup,
      targetArcGroup,
      playerGroup,
      viewConeMesh,
      courseArrowGroup,
      inspectMarker,
      tacticalTexture: tacticalTex,
      tacticalPalette: initPalette,
      topoTexture: null,
      nightTexture: null,
      satTexture: null,
      playerMaterials: {
        coreMat,
        haloMat,
        rangeMat,
        spireMat,
        spireGlowMat,
        pillarPulseMat,
        coneMat,
        sightBeamMat,
        arrowMat
      }
    };

    // Raycasting for Double-Tap / Long-Press on 3D Mountain
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = { x: 0, y: 0, time: 0 };
    let longPressTimer: number | null = null;

    const triggerInspectAtClientXY = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const viewW = renderer.domElement.clientWidth || rect.width;
      const viewH = renderer.domElement.clientHeight || rect.height;
      const localX = liveStateRef.current.syntheticLandscape
        ? clientY - rect.top
        : clientX - rect.left;
      const localY = liveStateRef.current.syntheticLandscape
        ? rect.right - clientX
        : clientY - rect.top;
      const ndc = new THREE.Vector2(
        (localX / Math.max(1, viewW)) * 2 - 1,
        -(localY / Math.max(1, viewH)) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(terrainMesh, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const { lat, lon } = world3DToLatLon(pt.x, pt.z, dataset.bounds);
        const ele = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, lat, lon));
        const slope = Math.round(sampleDemSlopeDeg(dataset.dem, dataset.bounds, lat, lon));
        inspectMarker.position.set(pt.x, pt.y + 4, pt.z);
        inspectMarker.visible = true;
        if (navigator.vibrate) navigator.vibrate(18);
        const padX = Math.min(150, viewW * 0.45);
        setInspectedSpot({
          lat: Number(lat.toFixed(6)),
          lon: Number(lon.toFixed(6)),
          ele,
          slope,
          screenX: Math.min(viewW - padX, Math.max(padX, localX)),
          screenY: Math.max(Math.min(90, viewH * 0.45), localY - 16)
        });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      setShowGestureHint(false);
      liveStateRef.current.onMapInteractionChange?.(true);
      pointerDownPos.x = e.clientX;
      pointerDownPos.y = e.clientY;
      pointerDownPos.time = performance.now();
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        triggerInspectAtClientXY(e.clientX, e.clientY);
      }, 520);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (longPressTimer) {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (dist > 10) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    };

    const onPointerUp = () => {
      liveStateRef.current.onMapInteractionChange?.(false);
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onDblClick = (e: MouseEvent) => {
      triggerInspectAtClientXY(e.clientX, e.clientY);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDblClick);

    const onResize = () => {
      if (!container || !container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    sceneResizeRef.current = onResize;
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Animation Loop (60fps smooth spring camera + projected 3D badges)
    let rafId = 0;
    let frameCounter = 0;
    const tempV = new THREE.Vector3();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      frameCounter++;
      const st = liveStateRef.current;

      // Update Player 3D Position & Dual Heading smoothly (anchored directly on 3D triangle mesh!)
      const groundPlayerEle = sampleDemElevation(
        dataset.dem,
        dataset.bounds,
        st.playerLat,
        st.playerLon
      );
      const [px, py, pz] = latLonToWorld3D(
        st.playerLat,
        st.playerLon,
        groundPlayerEle,
        dataset.bounds,
        st.verticalScale
      );
      playerGroup.position.lerp(new THREE.Vector3(px, py, pz), 0.25);

      // Pulse ground halo & ascending light-pillar ring
      const nowMs = performance.now();
      const pulse = 1 + Math.sin(nowMs * 0.0045) * 0.18;
      haloMesh.scale.set(pulse, pulse, pulse);
      const liftPhase = (nowMs * 0.00055) % 1;
      pillarPulseMesh.position.y = 8 + liftPhase * 372;
      const ringScale = 0.78 + liftPhase * 0.65;
      pillarPulseMesh.scale.set(ringScale, ringScale, ringScale);
      pillarPulseMat.opacity = (1 - liftPhase) * 0.85;

      // Rotate Compass View Cone (clockwise bearing -> negative Y rotation in Three.js!)
      const targetConeRotY = -(st.compassHeading * Math.PI) / 180;
      viewConeMesh.rotation.y = targetConeRotY;

      // GPS Course Arrow visible when moving or in sim mode
      if (st.gpsCourse !== null && (st.speedMps === null || st.speedMps > 0.35 || st.isSimMode)) {
        courseArrowGroup.visible = true;
        courseArrowGroup.rotation.y = -(st.gpsCourse * Math.PI) / 180;
      } else {
        courseArrowGroup.visible = false;
      }

      // Chase Camera Mode ("Khóa góc nhìn sau lưng theo hướng đi")
      if (st.cameraMode === 'chase') {
        const headingRad = ((st.gpsCourse ?? st.compassHeading) * Math.PI) / 180;
        const chaseDist = 520;
        const chaseHeight = 310;
        // Behind player: opposite of heading vector (sin(h), -cos(h))
        const desiredCamX = playerGroup.position.x - Math.sin(headingRad) * chaseDist;
        const desiredCamZ = playerGroup.position.z + Math.cos(headingRad) * chaseDist;
        const groundAtCam = sampleDemElevation(
          dataset.dem,
          dataset.bounds,
          world3DToLatLon(desiredCamX, desiredCamZ, dataset.bounds).lat,
          world3DToLatLon(desiredCamX, desiredCamZ, dataset.bounds).lon
        ) * st.verticalScale;
        const desiredCamY = Math.max(playerGroup.position.y + chaseHeight, groundAtCam + 120);

        camera.position.lerp(new THREE.Vector3(desiredCamX, desiredCamY, desiredCamZ), 0.08);
        const lookAheadX = playerGroup.position.x + Math.sin(headingRad) * 160;
        const lookAheadZ = playerGroup.position.z - Math.cos(headingRad) * 160;
        controls.target.lerp(new THREE.Vector3(lookAheadX, playerGroup.position.y + 35, lookAheadZ), 0.12);
      } else if (st.headingUp && !isUserInteracting) {
        if (followPlayerRef.current) {
          const dtx = (playerGroup.position.x - controls.target.x) * 0.12;
          const dty = (playerGroup.position.y + 22 - controls.target.y) * 0.12;
          const dtz = (playerGroup.position.z - controls.target.z) * 0.12;
          controls.target.x += dtx;
          controls.target.y += dty;
          controls.target.z += dtz;
          camera.position.x += dtx;
          camera.position.y += dty;
          camera.position.z += dtz;
        }

        const offX = camera.position.x - controls.target.x;
        const offZ = camera.position.z - controls.target.z;
        const horizDist = Math.max(80, Math.hypot(offX, offZ));
        const curAzDeg = ((Math.atan2(-offX, offZ) * 180) / Math.PI + 360) % 360;
        const deltaAz = ((st.compassHeading - curAzDeg + 540) % 360) - 180;
        if (Math.abs(deltaAz) > 0.12) {
          const nextAzRad = ((curAzDeg + deltaAz * 0.18) * Math.PI) / 180;
          camera.position.x = controls.target.x - Math.sin(nextAzRad) * horizDist;
          camera.position.z = controls.target.z + Math.cos(nextAzRad) * horizDist;
        }
        const camLl = world3DToLatLon(camera.position.x, camera.position.z, dataset.bounds);
        const groundAtCam =
          sampleDemElevation(dataset.dem, dataset.bounds, camLl.lat, camLl.lon) * st.verticalScale;
        if (camera.position.y < groundAtCam + 55) {
          camera.position.y = groundAtCam + 55;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      // Update Projected HTML Badges & 3D Camera North Azimuth every 2 frames for silky performance
      if (frameCounter % 2 === 0 && container) {
        const lookDx = controls.target.x - camera.position.x;
        const lookDz = controls.target.z - camera.position.z;
        const az = Math.round(((Math.atan2(lookDx, -lookDz) * 180) / Math.PI + 360) % 360);
        setCamAzimuthDeg(az);

        const w = container.clientWidth;
        const h = container.clientHeight;
        const nextBadges: ProjectedBadge[] = [];

        // 1. User Dropped Pins (ALWAYS shown with priority!)
        for (const pin of st.userPins) {
          const pinGroundEle = sampleDemElevation(dataset.dem, dataset.bounds, pin.lat, pin.lon);
          const [wx, wy, wz] = latLonToWorld3D(pin.lat, pin.lon, pinGroundEle, dataset.bounds, st.verticalScale);
          tempV.set(wx, wy + 78, wz).project(camera);
          if (tempV.z >= -1 && tempV.z <= 1) {
            const sx = (tempV.x * 0.5 + 0.5) * w;
            const sy = (-tempV.y * 0.5 + 0.5) * h;
            if (sx > -40 && sx < w + 40 && sy > -30 && sy < h + 30) {
              const dist = haversineDistanceM(st.playerLat, st.playerLon, pin.lat, pin.lon);
              const meta = PIN_EMOJI[pin.category] || PIN_EMOJI.rock;
              nextBadges.push({
                id: pin.id,
                label: pin.name,
                sub: formatDistance(dist),
                emoji: meta.emoji,
                color: meta.color,
                x: sx,
                y: sy,
                isUserPin: true,
                isLocked: st.lockedTarget?.id === pin.id,
                pinRef: pin
              });
            }
          }
        }

        // 2. Strategic POIs (Sorted by priority + screen-space collision avoidance so labels never overlap!)
        if (st.showPois) {
          const candidates: (ProjectedBadge & { priority: number })[] = [];
          for (const poi of dataset.pois) {
            if (poi.name.startsWith('Đỉnh phụ') && poi.ele < 350) continue;
            const isLocked = st.lockedTarget?.id === poi.id;
            if (st.hidePoiBadges && !isLocked) continue;
            const priority = isLocked
              ? 100
              : poi.id === 'verified-la-ban-helipad' ||
                  poi.name === 'Núi Bao Quan' ||
                  poi.id === 'junc-4way-central'
                ? 94
                : poi.category === 'warning'
                  ? 86
                  : poi.category === 'junction' ||
                      poi.id.startsWith('verified-') ||
                      poi.id === 'osm-thanh-gia-nui-dinh'
                    ? 80
                    : poi.id.startsWith('zone-') ||
                        poi.name.includes('Hang Tổ') ||
                        poi.name.includes('Hang Mai') ||
                        poi.name.includes('Tây Phương') ||
                        poi.name.includes('Phật Quang') ||
                        poi.name.includes('Hồ Đá Xanh')
                      ? 72
                      : poi.category === 'peak' || poi.category === 'viewpoint' || poi.category === 'boulder'
                        ? 55
                        : 30;

            if (priority < 50) continue;

            const poiGroundEle = sampleDemElevation(dataset.dem, dataset.bounds, poi.lat, poi.lon);
            const [wx, wy, wz] = latLonToWorld3D(poi.lat, poi.lon, poiGroundEle, dataset.bounds, st.verticalScale);
            tempV.set(wx, wy + 46, wz).project(camera);
            if (tempV.z >= -1 && tempV.z <= 1) {
              const sx = (tempV.x * 0.5 + 0.5) * w;
              const sy = (-tempV.y * 0.5 + 0.5) * h;
              const safeMarginX = Math.min(86, w * 0.2);
              if (sx > safeMarginX && sx < w - safeMarginX && sy > 36 && sy < h - 42) {
                const stStyle = POI_STYLE[poi.category] || { emoji: '📍', color: '#94A3B8' };
                const shortLabel = formatTacticalCallout(poi.name);
                const cleanSub = shortLabel.includes(`${poi.ele}M`) ? undefined : `${poi.ele}m`;
                candidates.push({
                  id: poi.id,
                  label: shortLabel,
                  sub: cleanSub,
                  emoji: stStyle.emoji,
                  color: resolvePoiBadgeAccent(poi.category, st.palette || 'slate'),
                  x: sx,
                  y: sy,
                  isLocked,
                  poiRef: poi,
                  priority
                });
              }
            }
          }

          candidates.sort((a, b) => b.priority - a.priority);
          const maxPois = h < 500 ? 4 : 6;
          let placedPoiCount = 0;
          for (const cand of candidates) {
            if (!cand.isLocked) {
              if (placedPoiCount >= maxPois) continue;
              const collides = nextBadges.some((placed) => {
                const reqX = (placed.label.length + cand.label.length) * 3.4 + 48;
                return Math.abs(placed.x - cand.x) < reqX && Math.abs(placed.y - cand.y) < 34;
              });
              if (collides) continue;
              placedPoiCount++;
            }
            nextBadges.push(cand);
          }
        }

        setBadges(nextBadges);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      sceneResizeRef.current = null;
      ro.disconnect();
      controls.removeEventListener('start', onCtrlStart);
      controls.removeEventListener('end', onCtrlEnd);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      for (const d of staticDisposables) {
        d.dispose();
      }
      const curCtx = sceneRef.current;
      if (curCtx) {
        clearAndDisposeGroup(curCtx.overlaysGroup);
        clearAndDisposeGroup(curCtx.pinsGroup);
        clearAndDisposeGroup(curCtx.trackGroup);
        clearAndDisposeGroup(curCtx.targetArcGroup);
        curCtx.tacticalTexture?.dispose();
        curCtx.topoTexture?.dispose();
        curCtx.nightTexture?.dispose();
        curCtx.satTexture?.dispose();
        curCtx.terrainMesh.geometry.dispose();
        curCtx.terrainMesh.material.dispose();
      }
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, [dataset]);

  // 2. Update Terrain Vertical Exaggeration dynamically
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const posAttr = ctx.terrainMesh.geometry.attributes.position;
    const { elevations } = dataset.dem;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, elevations[i] * verticalScale);
    }
    posAttr.needsUpdate = true;
    ctx.terrainMesh.geometry.computeVertexNormals();
    ctx.terrainMesh.geometry.computeBoundingBox();
    ctx.terrainMesh.geometry.computeBoundingSphere();
  }, [dataset, verticalScale]);

  // 3. Switch 3D Terrain Skin & Spec-Ops Palette (Slate / Olive / Amber / Vivid)
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    let cancelled = false;

    const ov = getMapOverlayPalette(palette);
    ctx.playerMaterials.coreMat.color.setHex(ov.beaconCoreNum);
    ctx.playerMaterials.haloMat.color.setHex(ov.beaconGlowNum);
    ctx.playerMaterials.rangeMat.color.setHex(ov.primaryNum);
    ctx.playerMaterials.spireMat.color.setHex(ov.beaconCoreNum);
    ctx.playerMaterials.spireGlowMat.color.setHex(ov.beaconGlowNum);
    ctx.playerMaterials.pillarPulseMat.color.setHex(ov.beaconCoreNum);
    ctx.playerMaterials.coneMat.color.setHex(ov.primaryNum);
    ctx.playerMaterials.sightBeamMat.color.setHex(ov.playerCoreNum);
    ctx.playerMaterials.arrowMat.color.setHex(ov.arrowNum);

    if (skin === 'tactical') {
      if (!ctx.tacticalTexture || ctx.tacticalPalette !== palette) {
        ctx.tacticalTexture?.dispose();
        const c = buildProceduralTerrainCanvas(dataset, 'tactical', palette);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
        ctx.tacticalTexture = tex;
        ctx.tacticalPalette = palette;
      }
      ctx.terrainMesh.material.map = ctx.tacticalTexture;
      ctx.terrainMesh.material.needsUpdate = true;
    } else if (skin === 'topo') {
      if (!ctx.topoTexture) {
        const c = buildProceduralTerrainCanvas(dataset, 'topo');
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
        ctx.topoTexture = tex;
      }
      ctx.terrainMesh.material.map = ctx.topoTexture;
      ctx.terrainMesh.material.needsUpdate = true;
    } else if (skin === 'night') {
      if (!ctx.nightTexture) {
        const c = buildProceduralTerrainCanvas(dataset, 'night');
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        ctx.nightTexture = tex;
      }
      ctx.terrainMesh.material.map = ctx.nightTexture;
      ctx.terrainMesh.material.needsUpdate = true;
    } else if (skin === 'satellite') {
      if (ctx.satTexture) {
        ctx.terrainMesh.material.map = ctx.satTexture;
        ctx.terrainMesh.material.needsUpdate = true;
      } else {
        setSatLoading(true);
        const baseCanvas = buildProceduralTerrainCanvas(dataset, 'topo');
        stitchSatelliteCanvas(dataset, baseCanvas)
          .then((satCanvas) => {
            if (cancelled || !sceneRef.current) return;
            const tex = new THREE.CanvasTexture(satCanvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(8, sceneRef.current.renderer.capabilities.getMaxAnisotropy());
            sceneRef.current.satTexture = tex;
            sceneRef.current.terrainMesh.material.map = tex;
            sceneRef.current.terrainMesh.material.needsUpdate = true;
          })
          .finally(() => {
            if (!cancelled) setSatLoading(false);
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [dataset, skin, palette]);

  // 4. Rebuild Draped 3D Trails, Color Routes, Streams, 220kV Corridor, Geofence Force-Fields, and GPX
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const grp = ctx.overlaysGroup;
    clearAndDisposeGroup(grp);

    const addDrapedPolylineClipped = (
      coords: [number, number][],
      colorHex: string,
      liftM: number,
      opacity = 0.9,
      maxStepM = 18
    ) => {
      const clippedRuns = clipAndSubdividePolylineToBounds(coords, dataset.bounds, maxStepM);
      if (clippedRuns.length === 0) return;
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: opacity < 1,
        opacity
      });
      for (const run of clippedRuns) {
        if (run.length < 2) continue;
        const pts: THREE.Vector3[] = [];
        for (const [lat, lon] of run) {
          const ele = sampleDemElevation(dataset.dem, dataset.bounds, lat, lon);
          const [x, y, z] = latLonToWorld3D(lat, lon, ele, dataset.bounds, verticalScale);
          pts.push(new THREE.Vector3(x, y + liftM, z));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        grp.add(new THREE.Line(geo, mat));
      }
    };

    const ov = getMapOverlayPalette(palette);

    // Streams in 3D valleys (clipped cleanly to 3D mountain plinth)
    for (const s of dataset.streams) {
      addDrapedPolylineClipped(s.coords, ov.stream, 3.5, ov.streamOpacity, 18);
    }

    // 220kV High-Voltage Powerline Corridor (clipped to plinth & subdivided every 18m over ridges!)
    if (dataset.powerlines) {
      for (const pl of dataset.powerlines) {
        addDrapedPolylineClipped(pl.coords, ov.power, 14.0, ov.powerOpacity, 18);
      }
    }

    // All 281 forest footpaths
    if (showAllTrails) {
      const trailCol =
        palette !== 'vivid'
          ? '#64748B'
          : skin === 'night'
            ? '#34D399'
            : skin === 'tactical'
              ? '#7DD3FC'
              : '#E2E8F0';
      const trailOp = palette !== 'vivid' ? 0.28 : skin === 'tactical' ? 0.38 : 0.45;
      for (const t of dataset.trails) {
        if (t.routes.length > 0) continue; // drawn brighter by routes below
        addDrapedPolylineClipped(t.coords, trailCol, 4.2, trailOp, 18);
      }
    }

    // 4 Official Color-Coded Routes (Red, Yellow, Blue, Green)
    for (const r of dataset.routes) {
      if (visibleRoutes[r.id] === false) continue;
      const routeCol = resolveRouteColor(r.id, r.color, palette);
      for (const seg of r.segments) {
        addDrapedPolylineClipped(seg, routeCol, 6.5, palette === 'vivid' ? 0.95 : 0.85, 18);
        addDrapedPolylineClipped(seg, routeCol, 8.2, palette === 'vivid' ? 0.65 : 0.52, 18);
      }
    }

    // Imported GPX Routes
    for (const gpx of importedGpx) {
      const coords = gpx.points.map(([lat, lon]) => [lat, lon] as [number, number]);
      addDrapedPolylineClipped(coords, gpx.color, 9.5, 0.9, 18);
    }

    // 3D Force-Field Walls around Military Shooting Range & Deep Quarries
    for (const h of dataset.hazards) {
      const clippedPoly = clipAndSubdividePolygonToBounds(h.coords, dataset.bounds, 45);
      if (clippedPoly.length < 3) continue;
      const wallHeight = h.kind === 'military' ? 145 : 85;
      const wallColor =
        palette === 'vivid' ? (h.kind === 'military' ? 0xff2d55 : 0xff9f0a) : ov.hazardNum;
      const wallHex =
        palette === 'vivid'
          ? h.kind === 'military'
            ? ov.hazardHex
            : ov.hazardQuarryHex
          : ov.hazardHex;
      const positions: number[] = [];

      for (let i = 0; i < clippedPoly.length - 1; i++) {
        const [lat1, lon1] = clippedPoly[i];
        const [lat2, lon2] = clippedPoly[i + 1];
        const e1 = sampleDemElevation(dataset.dem, dataset.bounds, lat1, lon1);
        const e2 = sampleDemElevation(dataset.dem, dataset.bounds, lat2, lon2);
        const [x1, y1, z1] = latLonToWorld3D(lat1, lon1, e1, dataset.bounds, verticalScale);
        const [x2, y2, z2] = latLonToWorld3D(lat2, lon2, e2, dataset.bounds, verticalScale);

        // Two triangles per fence segment
        positions.push(x1, y1, z1, x2, y2, z2, x2, y2 + wallHeight, z2);
        positions.push(x1, y1, z1, x2, y2 + wallHeight, z2, x1, y1 + wallHeight, z1);
      }

      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const wallMat = new THREE.MeshBasicMaterial({
        color: wallColor,
        transparent: true,
        opacity: ov.hazardWallOpacity,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      grp.add(new THREE.Mesh(wallGeo, wallMat));

      addDrapedPolylineClipped(clippedPoly, wallHex, wallHeight, ov.hazardLineOpacity, 50);
    }

    // Hazard Beacons & Trail Junction Rings (anchored strictly to triangle mesh elevation!)
    for (const poi of dataset.pois) {
      if (poi.category === 'warning') {
        const groundEle = sampleDemElevation(dataset.dem, dataset.bounds, poi.lat, poi.lon);
        const [hx, hy, hz] = latLonToWorld3D(poi.lat, poi.lon, groundEle, dataset.bounds, verticalScale);
        const ringGeo = new THREE.RingGeometry(18, 30, 24);
        ringGeo.rotateX(-Math.PI / 2);
        ringGeo.translate(hx, hy + 4.5, hz);
        const ringMat = new THREE.MeshBasicMaterial({
          color: ov.warningNum,
          transparent: true,
          opacity: palette === 'vivid' ? 0.78 : 0.5,
          side: THREE.DoubleSide
        });
        grp.add(new THREE.Mesh(ringGeo, ringMat));

        const beamGeo = new THREE.CylinderGeometry(1.8, 7, 56, 8);
        beamGeo.translate(hx, hy + 28, hz);
        const beamMat = new THREE.MeshBasicMaterial({
          color: ov.warningNum,
          transparent: true,
          opacity: palette === 'vivid' ? 0.48 : 0.28
        });
        grp.add(new THREE.Mesh(beamGeo, beamMat));
      } else if (poi.category === 'junction') {
        const groundEle = sampleDemElevation(dataset.dem, dataset.bounds, poi.lat, poi.lon);
        const [jx, jy, jz] = latLonToWorld3D(poi.lat, poi.lon, groundEle, dataset.bounds, verticalScale);
        const jRingGeo = new THREE.RingGeometry(12, 20, 20);
        jRingGeo.rotateX(-Math.PI / 2);
        jRingGeo.translate(jx, jy + 5, jz);
        const jRingMat = new THREE.MeshBasicMaterial({
          color: ov.junctionNum,
          transparent: true,
          opacity: palette === 'vivid' ? 0.85 : 0.52,
          side: THREE.DoubleSide
        });
        grp.add(new THREE.Mesh(jRingGeo, jRingMat));
      }
    }
  }, [dataset, verticalScale, visibleRoutes, showAllTrails, importedGpx, skin, palette]);

  // 5. Render 3D Beacon Pillars for User Pins ("Ghim Cục Đá / 💩")
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const grp = ctx.pinsGroup;
    clearAndDisposeGroup(grp);

    for (const pin of userPins) {
      const meta = PIN_EMOJI[pin.category] || PIN_EMOJI.rock;
      const groundEle = sampleDemElevation(dataset.dem, dataset.bounds, pin.lat, pin.lon);
      const [x, y, z] = latLonToWorld3D(pin.lat, pin.lon, groundEle, dataset.bounds, verticalScale);
      const col = new THREE.Color(meta.color);

      // Vertical Light Pillar (75m tall so you spot your pinned rock over ridges!)
      const pillarGeo = new THREE.CylinderGeometry(2.2, 5.5, 72, 10);
      pillarGeo.translate(x, y + 36, z);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: lockedTarget?.id === pin.id ? 0.88 : 0.55
      });
      grp.add(new THREE.Mesh(pillarGeo, pillarMat));

      // Ground Ring
      const ringGeo = new THREE.RingGeometry(10, 17, 20);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(x, y + 3.5, z);
      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide
      });
      grp.add(new THREE.Mesh(ringGeo, ringMat));
    }
  }, [dataset, userPins, verticalScale, lockedTarget]);

  // 6. Render 3D Glowing Breadcrumb Tracklog Ribbon ("Vết chân điện tử")
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const grp = ctx.trackGroup;
    clearAndDisposeGroup(grp);

    if (trackPoints.length < 2) return;
    const pts = trackPoints.map((tp) => {
      const groundEle = Math.max(tp.ele, sampleDemElevation(dataset.dem, dataset.bounds, tp.lat, tp.lon));
      const [x, y, z] = latLonToWorld3D(tp.lat, tp.lon, groundEle, dataset.bounds, verticalScale);
      return new THREE.Vector3(x, y + 7.5, z);
    });
    const ov = getMapOverlayPalette(palette);
    const curveGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const curveMat = new THREE.LineBasicMaterial({ color: ov.playerCoreNum });
    grp.add(new THREE.Line(curveGeo, curveMat));
  }, [dataset, trackPoints, verticalScale, palette]);

  // 7. Render 3D Parabolic Homing Arc + Terrain Line to Locked Target + Locked Compass Bearing Ray
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const grp = ctx.targetArcGroup;
    clearAndDisposeGroup(grp);

    const ov = getMapOverlayPalette(palette);

    // A. Locked Sighting Compass Ray (1,200m Line draped over 3D mountain ridges & clipped to plinth)
    if (lockedBearing !== null) {
      const rayEnd = projectPointByBearing(playerLat, playerLon, lockedBearing, 1200);
      const rayRuns = clipAndSubdividePolylineToBounds(
        [
          [playerLat, playerLon],
          [rayEnd.lat, rayEnd.lon]
        ],
        dataset.bounds,
        18
      );
      for (const run of rayRuns) {
        if (run.length < 2) continue;
        const rayPts = run.map(([lat, lon]) => {
          const ele = sampleDemElevation(dataset.dem, dataset.bounds, lat, lon);
          const [rx, ry, rz] = latLonToWorld3D(lat, lon, ele, dataset.bounds, verticalScale);
          return new THREE.Vector3(rx, ry + 8.5, rz);
        });
        const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPts);
        const rayMat = new THREE.LineBasicMaterial({ color: ov.playerCoreNum });
        grp.add(new THREE.Line(rayGeo, rayMat));
      }
    }

    if (!lockedTarget) return;

    const startGroundEle = sampleDemElevation(dataset.dem, dataset.bounds, playerLat, playerLon);
    const targetGroundEle = sampleDemElevation(
      dataset.dem,
      dataset.bounds,
      lockedTarget.lat,
      lockedTarget.lon
    );
    const [sx, sy, sz] = latLonToWorld3D(playerLat, playerLon, startGroundEle, dataset.bounds, verticalScale);
    const [tx, ty, tz] = latLonToWorld3D(
      lockedTarget.lat,
      lockedTarget.lon,
      targetGroundEle,
      dataset.bounds,
      verticalScale
    );

    // 1. Parabolic Sky Guidance Arc
    const dist3D = Math.hypot(tx - sx, tz - sz);
    const arcLift = Math.min(480, Math.max(95, dist3D * 0.24));
    const mid = new THREE.Vector3((sx + tx) / 2, Math.max(sy, ty) + arcLift, (sz + tz) / 2);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(sx, sy + 16, sz),
      mid,
      new THREE.Vector3(tx, ty + 20, tz)
    );
    const arcGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(42));
    const arcMat = new THREE.LineBasicMaterial({ color: ov.arcNum });
    grp.add(new THREE.Line(arcGeo, arcMat));

    // 2. Draped Ground Slope Line (shows exact terrain profile between you and target!)
    const groundPts: THREE.Vector3[] = [];
    const samples = 40;
    for (let i = 0; i <= samples; i++) {
      const f = i / samples;
      const lat = playerLat + (lockedTarget.lat - playerLat) * f;
      const lon = playerLon + (lockedTarget.lon - playerLon) * f;
      const ele = sampleDemElevation(dataset.dem, dataset.bounds, lat, lon);
      const [gx, gy, gz] = latLonToWorld3D(lat, lon, ele, dataset.bounds, verticalScale);
      groundPts.push(new THREE.Vector3(gx, gy + 6, gz));
    }
    const groundGeo = new THREE.BufferGeometry().setFromPoints(groundPts);
    const groundMat = new THREE.LineBasicMaterial({
      color: ov.groundArcNum,
      transparent: true,
      opacity: 0.72
    });
    grp.add(new THREE.Line(groundGeo, groundMat));
  }, [dataset, lockedTarget, lockedBearing, playerLat, playerLon, playerEle, verticalScale, palette]);

  // 8. Fly Camera Smoothly to Requested Coordinate
  useEffect(() => {
    if (!flyToTrigger || !sceneRef.current) return;
    const { camera, controls } = sceneRef.current;
    const ele = sampleDemElevation(dataset.dem, dataset.bounds, flyToTrigger.lat, flyToTrigger.lon);
    const [tx, ty, tz] = latLonToWorld3D(flyToTrigger.lat, flyToTrigger.lon, ele, dataset.bounds, verticalScale);
    controls.target.set(tx, ty + 20, tz);
    camera.position.set(tx - 380, ty + 620, tz + 820);
    controls.update();
  }, [flyToTrigger, dataset, verticalScale]);

  const focusPlayer3D = useCallback(() => {
    if (!sceneRef.current) return;
    followPlayerRef.current = true;
    const { camera, controls } = sceneRef.current;
    const [px, py, pz] = latLonToWorld3D(playerLat, playerLon, playerEle, dataset.bounds, verticalScale);
    controls.target.set(px, py + 25, pz);
    camera.position.set(px - 260, py + 480, pz + 680);
    controls.update();
  }, [dataset, playerLat, playerLon, playerEle, verticalScale]);

  const snapCameraNorth3D = useCallback(() => {
    if (!sceneRef.current) return;
    const { camera, controls } = sceneRef.current;
    const horizDist = Math.max(
      280,
      Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z)
    );
    camera.position.set(controls.target.x, camera.position.y, controls.target.z + horizDist);
    controls.update();
    setCamAzimuthDeg(0);
  }, []);

  const prevHeadingUpRef = useRef<boolean>(headingUp);
  useEffect(() => {
    if (headingUp) {
      followPlayerRef.current = true;
    } else if (prevHeadingUpRef.current) {
      followPlayerRef.current = false;
      snapCameraNorth3D();
    }
    prevHeadingUpRef.current = headingUp;
  }, [headingUp, snapCameraNorth3D]);

  return (
    <div className="terrain-3d-wrapper" ref={containerRef}>
      <div className="tactical-hud-corners" aria-hidden="true">
        <span className="thc tl" />
        <span className="thc tr" />
        <span className="thc bl" />
        <span className="thc br" />
        <span className="tactical-center-crosshair" />
      </div>
      {/* Projected 3D Interactive Badges */}
      <div className="badges-3d-layer">
        {badges.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`badge-3d ${b.isUserPin ? 'is-user-pin' : ''} ${b.isLocked ? 'is-locked' : ''}`}
            style={
              {
                transform: `translate3d(${b.x}px, ${b.y}px, 0) translate(-50%, -100%)`,
                '--badge-accent': b.color
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              e.stopPropagation();
              if (navigator.vibrate) navigator.vibrate(12);
              if (b.pinRef) {
                onSelectUserPin(b.pinRef);
              } else if (b.poiRef) {
                onSelectTarget({
                  id: b.poiRef.id,
                  name: b.poiRef.name,
                  lat: b.poiRef.lat,
                  lon: b.poiRef.lon,
                  ele: b.poiRef.ele,
                  category: b.poiRef.category,
                  note: b.poiRef.note
                });
              }
            }}
          >
            {b.isUserPin ? (
              <span className="badge-emoji">{b.emoji}</span>
            ) : (
              <span className="badge-dot" style={{ background: b.color }} />
            )}
            <span className="badge-text">{b.label}</span>
            {b.sub && <span className="badge-sub">{b.sub}</span>}
          </button>
        ))}
      </div>

      {/* Satellite Stitching Indicator */}
      {satLoading && (
        <div className="sat-loading-pill">🛰️ Đang phủ ảnh Vệ Tinh Google lên địa hình 3D Núi Dinh...</div>
      )}

      {/* 3D Camera Heading-Up / North-Up Toggle + Quick Focus Player Stack */}
      <div className="floating-3d-right-stack">
        <button
          type="button"
          className={`cam-north-3d-btn ${headingUp ? 'active' : ''}`}
          onClick={onToggleHeadingUp}
          title={
            headingUp
              ? 'Đang xoay 3D theo hướng điện thoại (Bấm để khóa về hướng Bắc chuẩn)'
              : 'Bấm để xoay bản đồ 3D theo hướng điện thoại (Heading-Up)'
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            style={{ transform: `rotate(${-camAzimuthDeg}deg)` }}
          >
            <polygon points="12,2 8.5,12 15.5,12" fill="#C26D68" />
            <polygon points="12,22 8.5,12 15.5,12" fill="#94A3B8" />
          </svg>
          <span>{headingUp ? 'H-UP' : 'BẮC'}</span>
        </button>

        <button
          type="button"
          className="floating-recenter-btn"
          onClick={focusPlayer3D}
          title="Đưa camera 3D về vị trí của tôi"
        >
          TÔI
        </button>
      </div>

      {/* Raycast Spot Inspector Popover (Double-click or Long-press on 3D mountain) */}
      {inspectedSpot && (
        <div
          className="spot-inspector-card"
          style={{ left: `${inspectedSpot.screenX}px`, top: `${inspectedSpot.screenY}px` }}
        >
          <div className="spot-inspector-header">
            <span>
              ⛰️ Cao <strong>{inspectedSpot.ele}m</strong> • Dốc{' '}
              <strong className={inspectedSpot.slope >= 32 ? 'text-danger' : ''}>{inspectedSpot.slope}°</strong>
            </span>
            <button
              type="button"
              className="spot-close"
              onClick={() => {
                setInspectedSpot(null);
                if (sceneRef.current) sceneRef.current.inspectMarker.visible = false;
              }}
            >
              ✕
            </button>
          </div>
          <div className="spot-coords">
            {inspectedSpot.lat.toFixed(5)}, {inspectedSpot.lon.toFixed(5)} • Cách bạn{' '}
            <strong>
              {formatDistance(
                haversineDistanceM(playerLat, playerLon, inspectedSpot.lat, inspectedSpot.lon)
              )}
            </strong>{' '}
            ({Math.round(computeBearingDeg(playerLat, playerLon, inspectedSpot.lat, inspectedSpot.lon))}°)
          </div>
          <div className="spot-actions">
            <button
              type="button"
              onClick={() => {
                onRequestPinAt(inspectedSpot.lat, inspectedSpot.lon, inspectedSpot.ele);
                setInspectedSpot(null);
              }}
            >
              🪨 Ghim tại đây
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectTarget({
                  id: `spot-${Date.now()}`,
                  name: `Điểm 3D (${inspectedSpot.ele}m)`,
                  lat: inspectedSpot.lat,
                  lon: inspectedSpot.lon,
                  ele: inspectedSpot.ele,
                  category: 'checkpoint'
                });
                setInspectedSpot(null);
              }}
            >
              🎯 Khóa Radar
            </button>
            {isSimMode && (
              <button
                type="button"
                className="sim-go-btn"
                onClick={() => {
                  onSimMoveTo(inspectedSpot.lat, inspectedSpot.lon);
                  setInspectedSpot(null);
                }}
              >
                🏃 Đi tới đây
              </button>
            )}
          </div>
        </div>
      )}

      {showGestureHint && (
        <div className="hint-3d-gesture">
          1 ngón xoay • 2 ngón phóng/nghiêng • Nhấn giữ sườn núi để ghim
        </div>
      )}
    </div>
  );
};
