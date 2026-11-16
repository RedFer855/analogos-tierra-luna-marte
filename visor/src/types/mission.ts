export type TargetBody = 'mars' | 'moon';

export type ShapeType = 'rectangle' | 'polygon' | 'circle';

export type DrawMode = 'navigate' | 'rectangle' | 'circle' | 'polygon' | 'pin';

export type PinCategory = 'earth' | 'mars' | 'moon';

export interface ZoneColorPreset {
  name: string;
  hex: string;
}

export const ZONE_PRESET_COLORS: ZoneColorPreset[] = [
  { name: 'Naranja Marte', hex: '#f97316' },
  { name: 'Cian Luna', hex: '#38bdf8' },
  { name: 'Esmeralda', hex: '#10b981' },
  { name: 'Amarillo Solar', hex: '#eab308' },
  { name: 'Rojo Óxido', hex: '#ef4444' },
  { name: 'Púrpura', hex: '#a855f7' },
  { name: 'Magenta', hex: '#ec4899' },
  { name: 'Turquesa', hex: '#14b8a6' },
  { name: 'Índigo', hex: '#6366f1' },
  { name: 'Coral', hex: '#f43f5e' },
];

/** De dónde salió el relieve de una zona. Sin terreno real no hay relieve: 'sin-dato' (P1). */
export type TerrainSource =
  | 'terreno-local'
  | 'cesium-world-terrain'
  | 'teselas-cargadas'
  | 'importado'
  | 'sin-dato';

export interface SavedPin {
  id: string;
  name: string;
  category: PinCategory;
  lat: number;
  lon: number;
  /** Altura del terreno sobre el elipsoide WGS84 (P8). null = sin dato (P9). */
  elevationM: number | null;
  notes: string;
  createdAt: string;
}

export interface GeoCoord {
  lat: number;
  lon: number;
}

export interface TopographicMetrics {
  /** Área y perímetro salen solo de la geometría: siempre son reales. */
  areaM2: number;
  areaHa: number;
  areaKm2: number;
  perimeterM: number;
  perimeterKm: number;
  /** Alturas sobre el elipsoide WGS84. null = sin dato, nunca 0 (P9). */
  maxElevationM: number | null;
  minElevationM: number | null;
  reliefDepthM: number | null;
  /** Pendiente media estimada en vivo entre vecinos de la cuadrícula (P2). No es la del ETL (ADR-007). */
  avgSlopePercent: number | null;
  /** Separación de la cuadrícula con la que se estimó la pendiente. */
  slopeSpacingM: number | null;
  approxVolumeM3: number | null;
  terrainSource: TerrainSource;
}

export interface MissionZone {
  id: string;
  name: string;
  targetBody: TargetBody;
  analogSiteName: string;
  notes: string;
  shapeType: ShapeType;
  color?: string;
  coordinates: GeoCoord[];
  metrics: TopographicMetrics;
  createdAt: string;
}
