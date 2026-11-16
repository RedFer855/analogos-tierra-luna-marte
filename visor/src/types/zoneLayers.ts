export type ZoneLayerFamily =
  | 'none'
  | 'geology'
  | 'soil'
  | 'radiation'
  | 'elevation'
  | 'slope'
  | 'hydrology'
  | 'ndvi';

export type ZoneSubLayerId =
  | 'geology-lithology'
  | 'geology-silica-etl'
  | 'soil-texture'
  | 'soil-sand'
  | 'soil-clay'
  | 'soil-dust-gibs'
  | 'radiation-solar'
  | 'radiation-uv'
  | 'elevation-dem'
  | 'slope-percent'
  | 'slope-ruggedness'
  | 'hydrology-surface'
  | 'hydrology-seasonality'
  | 'ndvi-modis';

export type LayerScientificRole = 'comparable' | 'filtro' | 'contexto';

export interface ZoneSubLayerOption {
  id: ZoneSubLayerId;
  family: Exclude<ZoneLayerFamily, 'none'>;
  label: string;
  role: LayerScientificRole;
  roleLabel: string;
}

export interface ZoneLayerLegendStop {
  color: string;
  label: string;
}

export interface ZoneLayerMetricRow {
  label: string;
  value: string;
}

export interface ZoneBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ZoneLayerResult {
  subLayerId: ZoneSubLayerId;
  title: string;
  role: LayerScientificRole;
  roleLabel: string;
  unit: string;
  resolutionLabel: string;
  sourceLabel: string;
  note: string;
  minLabel: string;
  maxLabel: string;
  meanLabel: string;
  gradientCss?: string;
  legendStops: ZoneLayerLegendStop[];
  metricsRows: ZoneLayerMetricRow[];
  canvas: HTMLCanvasElement | null;
  bounds: ZoneBounds;
  available: boolean;
  unavailableReason?: string;
  creditText?: string;
}

export const ZONE_SUBLAYER_OPTIONS: ZoneSubLayerOption[] = [
  {
    id: 'geology-lithology',
    family: 'geology',
    label: 'Litología y Formaciones (Macrostrat)',
    role: 'filtro',
    roleLabel: 'Geología · Contexto/Filtro (D1)',
  },
  {
    id: 'geology-silica-etl',
    family: 'geology',
    label: 'Sílice % SiO₂ / Minerales (ETL ASTER/EMIT)',
    role: 'comparable',
    roleLabel: 'Comparable N4 + Filtro mineral (ADR-008)',
  },
  {
    id: 'soil-texture',
    family: 'soil',
    label: 'Clases de Suelo: Arena / Limo / Arcilla (SoilGrids)',
    role: 'contexto',
    roleLabel: 'Movilidad / Suelo · Ficha (D8)',
  },
  {
    id: 'soil-sand',
    family: 'soil',
    label: '% Arena superficial 0–5 cm (SoilGrids)',
    role: 'contexto',
    roleLabel: 'Movilidad / Dunas · Ficha (D5, D8)',
  },
  {
    id: 'soil-clay',
    family: 'soil',
    label: '% Arcilla superficial 0–5 cm (SoilGrids)',
    role: 'contexto',
    roleLabel: 'Composición / Cohesión · Ficha (D1, D8)',
  },
  {
    id: 'soil-dust-gibs',
    family: 'soil',
    label: 'Polvo y Aerosoles AOD (NASA GIBS MODIS)',
    role: 'contexto',
    roleLabel: 'Proceso atmosférico · Contexto Marte (D5)',
  },
  {
    id: 'radiation-solar',
    family: 'radiation',
    label: 'Irradiancia Solar Superficial (NASA POWER)',
    role: 'contexto',
    roleLabel: 'Límite terrestre / Energía · Ficha (D3)',
  },
  {
    id: 'radiation-uv',
    family: 'radiation',
    label: 'Índice UV Superficial (NASA POWER)',
    role: 'contexto',
    roleLabel: 'Estrés astrobiológico / Límite Tierra (P9)',
  },
  {
    id: 'elevation-dem',
    family: 'elevation',
    label: 'Elevación DEM absoluto 30 m (Terrarium)',
    role: 'contexto',
    roleLabel: 'Altitud / Referencia hipsométrica (D1)',
  },
  {
    id: 'slope-percent',
    family: 'slope',
    label: 'Pendientes % — Variable N1 (DEM 30 m)',
    role: 'comparable',
    roleLabel: 'Comparable N1 · Movilidad (ADR-008)',
  },
  {
    id: 'slope-ruggedness',
    family: 'slope',
    label: 'Relieve relativo y Rugosidad TRI (DEM 30 m)',
    role: 'comparable',
    roleLabel: 'Comparable N2 / Rugosidad (ADR-008)',
  },
  {
    id: 'hydrology-surface',
    family: 'hydrology',
    label: 'Agua superficial y Salares (JRC GSW + OSM)',
    role: 'filtro',
    roleLabel: 'Filtro hídrico / Salares · Análogos (ADR-008)',
  },
  {
    id: 'hydrology-seasonality',
    family: 'hydrology',
    label: 'Estacionalidad hídrica meses/año (JRC GSW)',
    role: 'filtro',
    roleLabel: 'Estacionalidad lacustre / evaporitas (D4)',
  },
  {
    id: 'ndvi-modis',
    family: 'ndvi',
    label: 'Vegetación — NDVI 8 días (NASA GIBS MODIS)',
    role: 'filtro',
    roleLabel: 'Filtro biótico / Cobertura vegetal (D4, ADR-008)',
  },
];
