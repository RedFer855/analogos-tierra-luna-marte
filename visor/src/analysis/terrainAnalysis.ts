import * as Cesium from 'cesium';
import type { TerrainStatus } from '../map/viewer';
import type { GeoCoord, TerrainSource, TopographicMetrics } from '../types/mission';

export const PLANET_RADII_M = {
  earth: 6371008.8,
  mars: 3396190.0,
  moon: 1737400.0,
} as const;

/** Separación mínima de la cuadrícula de muestreo (la regla fina de ADR-007). */
const MIN_SPACING_M = 30;
/** Tope de celdas por lado: con figuras grandes la separación crece y se informa. */
const MAX_CELLS_PER_SIDE = 40;
const METERS_PER_DEGREE = 111_320;

/**
 * Desenrolla las longitudes respecto al primer vértice para que ningún lado salte
 * de +180 a −180 (P10). Los valores pueden quedar fuera de [−180, 180]; Cesium los acepta.
 */
export function unwrapLongitudes(coords: GeoCoord[]): GeoCoord[] {
  if (coords.length === 0) return [];
  const out: GeoCoord[] = [{ ...coords[0] }];
  for (let i = 1; i < coords.length; i++) {
    let lon = coords[i].lon;
    const prev = out[i - 1].lon;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push({ lat: coords[i].lat, lon });
  }
  return out;
}

function haversineM(a: GeoCoord, b: GeoCoord, radiusM: number): number {
  const toRad = Cesium.Math.toRadians;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Perímetro sobre la esfera del cuerpo. Usa el mismo modelo que el área (P3):
 * en la Tierra difiere del elipsoide en décimas de por ciento.
 */
export function computeSphericalPerimeterM(
  coords: GeoCoord[],
  radiusM: number = PLANET_RADII_M.earth
): number {
  if (coords.length < 2) return 0;
  const u = unwrapLongitudes(coords);
  let total = 0;
  for (let i = 0; i < u.length; i++) {
    total += haversineM(u[i], u[(i + 1) % u.length], radiusM);
  }
  return total;
}

/**
 * Área esférica (fórmula de Chamberlain-Duquette) con el radio del cuerpo.
 */
export function computeSphericalAreaM2(
  coords: GeoCoord[],
  radiusM: number = PLANET_RADII_M.earth
): number {
  const u = unwrapLongitudes(coords);
  const n = u.length;
  if (n < 3) return 0;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = u[i];
    const p2 = u[(i + 1) % n];
    const p3 = u[(i + 2) % n];
    total +=
      (Cesium.Math.toRadians(p3.lon) - Cesium.Math.toRadians(p1.lon)) *
      Math.sin(Cesium.Math.toRadians(p2.lat));
  }
  return (Math.abs(total) * radiusM * radiusM) / 2.0;
}

/** Ray-casting sobre coordenadas ya desenrolladas. */
function isPointInPolygon(pt: GeoCoord, polygon: GeoCoord[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon;
    const yi = polygon[i].lat;
    const xj = polygon[j].lon;
    const yj = polygon[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface SampleGrid {
  rows: number;
  cols: number;
  spacingM: number;
  /** Punto de cada nodo (fila mayor) o null si cae fuera de la figura. */
  nodes: Array<GeoCoord | null>;
}

function buildSampleGrid(polygon: GeoCoord[]): SampleGrid {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const c of polygon) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLon = Math.min(minLon, c.lon);
    maxLon = Math.max(maxLon, c.lon);
  }

  const latCenter = (minLat + maxLat) / 2;
  const mPerDegLon = METERS_PER_DEGREE * Math.max(0.01, Math.cos(Cesium.Math.toRadians(latCenter)));
  const heightM = (maxLat - minLat) * METERS_PER_DEGREE;
  const widthM = (maxLon - minLon) * mPerDegLon;
  const spacingM = Math.max(MIN_SPACING_M, Math.max(heightM, widthM) / MAX_CELLS_PER_SIDE);

  const rows = Math.max(1, Math.round(heightM / spacingM));
  const cols = Math.max(1, Math.round(widthM / spacingM));
  const nodes: Array<GeoCoord | null> = [];

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const pt = {
        lat: minLat + ((maxLat - minLat) * r) / rows,
        lon: minLon + ((maxLon - minLon) * c) / cols,
      };
      nodes.push(isPointInPolygon(pt, polygon) ? pt : null);
    }
  }

  return { rows, cols, spacingM, nodes };
}

function finiteOrNull(h: number | undefined): number | null {
  return h !== undefined && Number.isFinite(h) ? h : null;
}

/**
 * Pide las alturas de todos los puntos en una sola llamada.
 * Devuelve un arreglo del mismo largo y en el mismo orden que `points` (P7):
 * null donde no hubo dato. Nunca inventa alturas (P1).
 */
async function sampleHeights(
  viewer: Cesium.Viewer,
  points: GeoCoord[],
  terrain: TerrainStatus
): Promise<{ heights: Array<number | null>; source: TerrainSource }> {
  if (terrain.kind === 'ninguno' || points.length === 0) {
    return { heights: points.map(() => null), source: 'sin-dato' };
  }

  const cartographics = points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
  const provider = viewer.terrainProvider;

  if (provider.availability) {
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(provider, cartographics);
      const heights = sampled.map((c) => finiteOrNull(c.height));
      if (heights.some((h) => h !== null)) {
        return {
          heights,
          source: terrain.kind === 'local' ? 'terreno-local' : 'cesium-world-terrain',
        };
      }
    } catch (err) {
      console.warn('sampleTerrainMostDetailed falló; se usan las teselas ya cargadas:', err);
    }
  }

  // Respaldo con terreno real pero menos detalle: las teselas que el globo ya cargó.
  const heights = points.map((p) =>
    finiteOrNull(viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(p.lon, p.lat)))
  );
  return {
    heights,
    source: heights.some((h) => h !== null) ? 'teselas-cargadas' : 'sin-dato',
  };
}

const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

/**
 * Mide una figura dibujada:
 * - Área y perímetro: de la geometría, siempre reales.
 * - Cotas, desnivel, pendiente y volumen: solo con terreno real; si no, null (P1, P9).
 * - Pendiente: entre vecinos de una cuadrícula regular (P2), con la separación informada.
 *   Es una estimación en vivo; la pendiente oficial sale del ETL (ADR-007).
 */
export async function analyzePolygonTerrain(
  viewer: Cesium.Viewer,
  coords: GeoCoord[],
  terrain: TerrainStatus
): Promise<TopographicMetrics> {
  const radius = PLANET_RADII_M.earth;
  const areaM2 = computeSphericalAreaM2(coords, radius);
  const perimeterM = computeSphericalPerimeterM(coords, radius);

  const polygon = unwrapLongitudes(coords);
  const grid = buildSampleGrid(polygon);

  // Lista de puntos a muestrear: nodos interiores de la cuadrícula y luego los vértices.
  const nodeIndexToPoint: number[] = new Array(grid.nodes.length).fill(-1);
  const points: GeoCoord[] = [];
  grid.nodes.forEach((node, idx) => {
    if (node) {
      nodeIndexToPoint[idx] = points.length;
      points.push(node);
    }
  });
  const interiorCount = points.length;
  points.push(...polygon);

  const { heights, source } = await sampleHeights(viewer, points, terrain);

  const valid = heights.filter((h): h is number => h !== null);
  if (valid.length === 0) {
    return {
      areaM2,
      areaHa: areaM2 / 10_000,
      areaKm2: areaM2 / 1_000_000,
      perimeterM,
      perimeterKm: perimeterM / 1_000,
      maxElevationM: null,
      minElevationM: null,
      reliefDepthM: null,
      avgSlopePercent: null,
      slopeSpacingM: null,
      approxVolumeM3: null,
      terrainSource: 'sin-dato',
    };
  }

  const maxElevationM = Math.max(...valid);
  const minElevationM = Math.min(...valid);

  // Pendiente: magnitud del gradiente en cada nodo, con su vecino de la derecha (este-oeste)
  // y el de abajo (norte-sur), los tres con dato. Así un plano inclinado da su pendiente
  // real en cualquier orientación.
  const heightAtNode = (idx: number): number | null => {
    const p = nodeIndexToPoint[idx];
    return p >= 0 ? heights[p] : null;
  };
  let slopeSum = 0;
  let slopeCount = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * (grid.cols + 1) + c;
      const right = idx + 1;
      const down = idx + grid.cols + 1;
      const node = grid.nodes[idx];
      const nodeR = grid.nodes[right];
      const nodeD = grid.nodes[down];
      const h = heightAtNode(idx);
      const hR = heightAtNode(right);
      const hD = heightAtNode(down);
      if (!node || !nodeR || !nodeD || h === null || hR === null || hD === null) continue;
      const dx = haversineM(node, nodeR, radius);
      const dy = haversineM(node, nodeD, radius);
      if (dx > 1 && dy > 1) {
        const gx = (hR - h) / dx;
        const gy = (hD - h) / dy;
        slopeSum += Math.sqrt(gx * gx + gy * gy) * 100;
        slopeCount++;
      }
    }
  }
  const avgSlopePercent = slopeCount > 0 ? slopeSum / slopeCount : null;

  // Volumen sobre la cota mínima con la altura media del interior.
  const interior = heights.slice(0, interiorCount).filter((h): h is number => h !== null);
  const meanInterior =
    interior.length > 0 ? interior.reduce((a, b) => a + b, 0) / interior.length : null;
  const approxVolumeM3 =
    meanInterior === null ? null : Math.round(areaM2 * Math.max(0, meanInterior - minElevationM));

  return {
    areaM2,
    areaHa: areaM2 / 10_000,
    areaKm2: areaM2 / 1_000_000,
    perimeterM,
    perimeterKm: perimeterM / 1_000,
    maxElevationM: round1(maxElevationM),
    minElevationM: round1(minElevationM),
    reliefDepthM: round1(maxElevationM - minElevationM),
    avgSlopePercent: round1(avgSlopePercent),
    slopeSpacingM: slopeCount > 0 ? Math.round(grid.spacingM) : null,
    approxVolumeM3,
    terrainSource: source,
  };
}
