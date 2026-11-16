// Geometría del área de búsqueda del motor (caja o polígono). Sin Cesium: se prueba con Node.
// Convenciones del motor (motor/LEEME.md, «Búsqueda por área»): bbox = [lat1, lon1, lat2, lon2] con lat1 < lat2;
// si lon1 > lon2 la caja cruza ±180°. Los polígonos van como anillo [lon, lat] (GeoJSON).

export type Bbox = [number, number, number, number];

export type AreaBusqueda =
  | { tipo: 'bbox'; bbox: Bbox; nombre: string | null }
  | { tipo: 'poligono'; anillo: [number, number][]; nombre: string | null };

const R_KM = 6371; // el mismo radio que motor/pipeline/src/geo.rs
const rad = (g: number): number => (g * Math.PI) / 180;

/** Ancho en grados de longitud de la caja, contando el cruce de ±180°. */
export function anchoLon(b: Bbox): number {
  const d = b[3] - b[1];
  return d > 0 ? d : d + 360;
}

/** Área de la caja sobre la esfera (km²): R²·Δλ·|sen φ2 − sen φ1|. Incluye mar: es la caja, no la tierra. */
export function areaBboxKm2(b: Bbox): number {
  return R_KM * R_KM * rad(anchoLon(b)) * Math.abs(Math.sin(rad(b[2])) - Math.sin(rad(b[0])));
}

/** Área de un polígono pequeño-mediano sobre la esfera (km²), con longitudes desenrolladas para el cruce de ±180°. */
export function areaAnilloKm2(anillo: [number, number][]): number {
  const pts = cerrado(anillo) ? anillo.slice(0, -1) : anillo;
  if (pts.length < 3) return 0;
  const lons = desenrollar(pts.map((p) => p[0]));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += rad(lons[j] - lons[i]) * (2 + Math.sin(rad(pts[i][1])) + Math.sin(rad(pts[j][1])));
  }
  return Math.abs((s * R_KM * R_KM) / 2);
}

export function areaKm2(a: AreaBusqueda): number {
  return a.tipo === 'bbox' ? areaBboxKm2(a.bbox) : areaAnilloKm2(a.anillo);
}

/** Longitudes continuas: cada salto de más de 180° se corrige sumando o restando 360°. */
export function desenrollar(lons: number[]): number[] {
  const out: number[] = [];
  for (const l of lons) {
    if (!out.length) { out.push(l); continue; }
    let x = l;
    const prev = out[out.length - 1];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push(x);
  }
  return out;
}

const cerrado = (r: [number, number][]): boolean =>
  r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

/** Lon a (-180, 180]. */
export function normLon(l: number): number {
  const x = ((((l + 180) % 360) + 360) % 360) - 180;
  return x === -180 ? 180 : x;
}

/** Caja a partir de dos esquinas clicadas: toma el ancho más corto en longitud (puede cruzar ±180°). */
export function bboxDeEsquinas(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Bbox {
  const [l1, l2] = [normLon(a.lon), normLon(b.lon)];
  let oeste = Math.min(l1, l2);
  let este = Math.max(l1, l2);
  if (este - oeste > 180) [oeste, este] = [este, oeste]; // el camino corto cruza el antimeridiano
  return [Math.min(a.lat, b.lat), oeste, Math.max(a.lat, b.lat), este].map((x) => redondear(x, 3)) as Bbox;
}

/** Valida una caja como lo hace el puente; devuelve el problema o null. */
export function problemaBbox(b: (number | null)[]): string | null {
  if (b.length !== 4 || b.some((x) => x == null || !Number.isFinite(x))) return 'Faltan valores de la caja.';
  const [la1, lo1, la2, lo2] = b as number[];
  if ([la1, la2].some((x) => x < -90 || x > 90)) return 'La latitud va de −90 a 90.';
  if ([lo1, lo2].some((x) => x < -180 || x > 180)) return 'La longitud va de −180 a 180.';
  if (la1 >= la2) return 'La latitud sur debe ser menor que la norte.';
  if (lo1 === lo2) return 'Las longitudes oeste y este no pueden ser iguales.';
  return null;
}

/** Centro aproximado (para volar la cámara y poner la etiqueta). */
export function centro(a: AreaBusqueda): { lat: number; lon: number } {
  if (a.tipo === 'bbox') {
    const [la1, lo1, la2] = a.bbox;
    return { lat: (la1 + la2) / 2, lon: normLon(lo1 + anchoLon(a.bbox) / 2) };
  }
  const pts = cerrado(a.anillo) ? a.anillo.slice(0, -1) : a.anillo;
  const lons = desenrollar(pts.map((p) => p[0]));
  return {
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    lon: normLon(lons.reduce((s, l) => s + l, 0) / lons.length),
  };
}

/** Radio efectivo de exclusión con área (motor/pipeline/src/area.rs): min(radio, k·√área de tierra). */
export function radioEfectivoKm(radioKm: number, tierraKm2: number, k: number): number {
  return Math.min(radioKm, k * Math.sqrt(tierraKm2));
}

export function redondear(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** «176 400 km²», «8,2 M km²». */
export function formatoKm2(km2: number): string {
  if (km2 >= 1e6) return `${(km2 / 1e6).toLocaleString('es', { maximumFractionDigits: 1 })} M km²`;
  const paso = km2 >= 1e5 ? 1000 : km2 >= 1e4 ? 100 : 10;
  return `${(Math.round(km2 / paso) * paso).toLocaleString('es')} km²`;
}

/**
 * Regiones sugeridas: cajas aproximadas alrededor de zonas con análogos documentados (no son límites oficiales).
 * Todas superan el piso de 40 000 km²; el motor confirma cuánta tierra elegible tienen.
 */
export const REGIONES: { id: string; nombre: string; nota: string; bbox: Bbox }[] = [
  { id: 'atacama', nombre: 'Atacama (Chile)', nota: 'desierto hiperárido, suelos tipo Marte', bbox: [-27, -71, -19, -67] },
  { id: 'mojave', nombre: 'Mojave y Death Valley (EE. UU.)', nota: 'playas salinas y abanicos aluviales', bbox: [34, -118.5, 37.5, -114.5] },
  { id: 'islandia', nombre: 'Islandia', nota: 'basalto, lava reciente y glaciares', bbox: [63.3, -24.5, 66.6, -13.5] },
  { id: 'sahara', nombre: 'Bodélé y Tibesti (Chad)', nota: 'polvo fino, dunas y volcanes', bbox: [15, 15, 22, 20] },
  { id: 'qaidam', nombre: 'Cuenca de Qaidam (China)', nota: 'alta, fría y salina', bbox: [36, 90, 39, 97] },
  { id: 'devon', nombre: 'Isla Devon (Canadá)', nota: 'desierto polar y cráter Haughton', bbox: [74, -95, 77, -80] },
  { id: 'pilbara', nombre: 'Pilbara (Australia)', nota: 'roca antigua y óxidos de hierro', bbox: [-23.5, 116, -20, 121] },
  { id: 'chukotka', nombre: 'Chukotka (Rusia, cruza ±180°)', nota: 'permafrost; prueba la caja que cruza el antimeridiano', bbox: [64, 170, 69, -172] },
];
