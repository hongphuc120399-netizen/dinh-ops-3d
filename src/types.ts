export interface DemGrid {
  cols: number;
  rows: number;
  minEle: number;
  maxEle: number;
  elevations: number[];
}

export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface HikingRoute {
  id: string;
  name: string;
  label: string;
  shortLabel: string;
  color: string;
  difficulty: string;
  distanceKm: number;
  segments: [number, number][][];
}

export interface TrailSegment {
  id: number;
  type: string;
  name: string | null;
  routes: string[];
  coords: [number, number][];
}

export interface StreamSegment {
  id: number;
  name: string;
  coords: [number, number][];
}

export interface HazardZone {
  id: number;
  kind: 'military' | 'quarry';
  name: string;
  coords: [number, number][];
}

export type PoiConfidence = 'verified-gps' | 'verified-dem' | 'zone-approx';

export interface PoiItem {
  id: string;
  name: string;
  altName: string | null;
  category: 'peak' | 'temple' | 'boulder' | 'viewpoint' | 'water' | 'camp' | 'historic' | 'warning' | 'junction';
  lat: number;
  lon: number;
  ele: number;
  note: string;
  confidence?: PoiConfidence;
  accuracyM?: number;
  source?: string;
}

export interface NuiDinhDataset {
  bounds: GeoBounds;
  center: [number, number];
  dem: DemGrid;
  routes: HikingRoute[];
  trails: TrailSegment[];
  streams: StreamSegment[];
  hazards: HazardZone[];
  lakes: StreamSegment[];
  powerlines: StreamSegment[];
  pois: PoiItem[];
}

export type PinCategory = 'rock' | 'poop' | 'checkpoint' | 'clue' | 'water' | 'deadend' | 'cache';

export interface UserPin {
  id: string;
  name: string;
  category: PinCategory;
  lat: number;
  lon: number;
  ele: number;
  accuracy: number | null;
  createdAt: number;
  note: string;
  photoDataUrl?: string;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
  accuracy: number | null;
  speedMps: number | null;
  gpsCourse: number | null;
  timestamp: number;
}

export interface ImportedGpxTrack {
  id: string;
  name: string;
  color: string;
  points: [number, number, number][]; // lat, lon, ele
}

export interface TacticalTarget {
  id: string;
  name: string;
  lat: number;
  lon: number;
  ele: number;
  category: string;
  note?: string;
  photoDataUrl?: string;
}

export interface SafetyAlert {
  level: 'critical' | 'warning';
  kind: 'military' | 'quarry' | 'pipe-trap' | 'offtrail';
  title: string;
  detail: string;
  distanceM: number;
}

export type ViewMode = '3d' | 'split' | '2d';
export type Terrain3DSkin = 'tactical' | 'topo' | 'satellite' | 'night';
export type Camera3DMode = 'orbit' | 'chase';
export type Map2DStyle = 'google-hybrid' | 'google-terrain' | 'opentopo' | 'offline-vector';
