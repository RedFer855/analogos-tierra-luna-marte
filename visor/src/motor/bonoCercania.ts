export interface PuntoGeologico {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  tipo: 'cueva' | 'crater';
}

export interface CercaniaResultado {
  punto: PuntoGeologico;
  distKm: number;
  bonoPct: number;
  totalPct: number;
}

const RADIO_TIERRA_KM = 6371.0088;
export const RADIO_BONO_KM = 50;

export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Bono proporcional a la similitud base (`basePct`), al número de variables (`nVars`)
 * y a la cercanía (`distKm <= 50 km`). Un sitio bajo casi no sube; uno alto con varias variables sí.
 */
export function calcularBonoCercania(
  basePct: number | null | undefined,
  nVars: number,
  distKm: number,
  maxDistKm = RADIO_BONO_KM
): { bonoPct: number; totalPct: number } {
  if (basePct == null || !Number.isFinite(basePct) || distKm > maxDistKm || distKm < 0) {
    const base = basePct ?? 0;
    return { bonoPct: 0, totalPct: Math.min(100, Math.round(base)) };
  }
  const factorDist = Math.max(0, 1 - distKm / maxDistKm);
  const factorSim = Math.max(0, Math.min(1, basePct / 100)) ** 2;
  const factorVars = Math.min(1, Math.max(1, nVars) / 6);
  const raw = 10 * factorDist * factorSim * factorVars;
  const bonoPct = Number(raw.toFixed(1));
  const totalPct = Math.min(100, Math.round(basePct + raw));
  return { bonoPct, totalPct };
}

export function evaluarCercaniaArea(
  lat: number,
  lon: number,
  basePct: number | null | undefined,
  nVars: number,
  puntos: PuntoGeologico[],
  maxDistKm = RADIO_BONO_KM
): CercaniaResultado | null {
  if (!puntos.length || basePct == null) return null;
  let mejor: { punto: PuntoGeologico; distKm: number } | null = null;
  for (const p of puntos) {
    if (Math.abs(p.lat - lat) > 1.0) continue;
    const d = distanciaKm(lat, lon, p.lat, p.lon);
    if (d <= maxDistKm && (!mejor || d < mejor.distKm)) {
      mejor = { punto: p, distKm: d };
    }
  }
  if (!mejor) return null;
  const { bonoPct, totalPct } = calcularBonoCercania(basePct, nVars, mejor.distKm, maxDistKm);
  if (bonoPct <= 0) return null;
  return { punto: mejor.punto, distKm: Number(mejor.distKm.toFixed(1)), bonoPct, totalPct };
}
