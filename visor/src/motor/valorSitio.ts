import { distanciaKm, RADIO_BONO_KM, type PuntoGeologico } from './bonoCercania';

export type RankingId = 'fisico' | 'cuevas' | 'crateres' | 'integral';

export interface PerfilRanking {
  id: RankingId;
  nombre: string;
  descripcion: string;
  pesoParecido: number;
  pesoSolidez: number;
  pesoCuevas: number;
  pesoCrateres: number;
}

export const PERFILES_RANKING: PerfilRanking[] = [
  {
    id: 'fisico',
    nombre: 'Físico estricto',
    descripcion: '55 % parecido físico · 45 % solidez del ajuste',
    pesoParecido: 0.55,
    pesoSolidez: 0.45,
    pesoCuevas: 0,
    pesoCrateres: 0,
  },
  {
    id: 'cuevas',
    nombre: 'Subsuelo / Cuevas',
    descripcion: '40 % parecido · 30 % solidez · 30 % cercanía a cuevas A/B',
    pesoParecido: 0.4,
    pesoSolidez: 0.3,
    pesoCuevas: 0.3,
    pesoCrateres: 0,
  },
  {
    id: 'crateres',
    nombre: 'Cráteres',
    descripcion: '40 % parecido · 30 % solidez · 30 % cercanía a cráteres',
    pesoParecido: 0.4,
    pesoSolidez: 0.3,
    pesoCuevas: 0,
    pesoCrateres: 0.3,
  },
  {
    id: 'integral',
    nombre: 'Valor integral',
    descripcion: '40 % parecido · 35 % solidez · 12,5 % cuevas · 12,5 % cráteres',
    pesoParecido: 0.4,
    pesoSolidez: 0.35,
    pesoCuevas: 0.125,
    pesoCrateres: 0.125,
  },
];

export interface EntradaValor {
  id: string;
  etiqueta: string;
  lat: number;
  lon: number;
  grupo: string;
  objetivo: string | null;
  parecido_pct: number | null;
  solidez_pct: number | null;
  es_referencia?: boolean;
}

export interface ResultadoValor {
  entrada: EntradaValor;
  valor: number;
  desglose: {
    parecido: number;
    solidez: number;
    cuevas: number;
    crateres: number;
  };
  rasgoCercano: { nombre: string; tipo: 'cueva' | 'crater'; distKm: number } | null;
}

export interface RankingGuardado {
  rankingId: RankingId;
  nombreRanking: string;
  fechaIso: string;
  items: Array<{
    puesto: number;
    id: string;
    etiqueta: string;
    objetivo: string | null;
    valor: number;
    parecido_pct: number | null;
    solidez_pct: number | null;
    rasgo: string | null;
  }>;
}

const STORAGE_RANKINGS = 'motor.rankingsGuardados.v1';

function masCercano(
  lat: number,
  lon: number,
  tipo: 'cueva' | 'crater',
  puntos: PuntoGeologico[]
): { nombre: string; distKm: number } | null {
  let best: { nombre: string; distKm: number } | null = null;
  for (const p of puntos) {
    if (p.tipo !== tipo || Math.abs(p.lat - lat) > 1.0) continue;
    const d = distanciaKm(lat, lon, p.lat, p.lon);
    if (d <= RADIO_BONO_KM && (!best || d < best.distKm)) {
      best = { nombre: p.nombre, distKm: d };
    }
  }
  return best;
}

export function calcularValorSitio(
  entrada: EntradaValor,
  perfil: PerfilRanking,
  puntosGeo: PuntoGeologico[] = []
): ResultadoValor {
  const parecido = entrada.parecido_pct ?? (entrada.es_referencia ? 75 : 0);
  const solidez = entrada.solidez_pct ?? (entrada.es_referencia ? 85 : 0);
  const factorBase = Math.max(0, Math.min(1, parecido / 100));

  const cueva = perfil.pesoCuevas > 0 ? masCercano(entrada.lat, entrada.lon, 'cueva', puntosGeo) : null;
  const crater = perfil.pesoCrateres > 0 ? masCercano(entrada.lat, entrada.lon, 'crater', puntosGeo) : null;

  // Escala por similitud base para que un sitio de baja similitud no lidere solo por estar cerca de un rasgo.
  const cuevasScore = cueva ? Math.round(100 * (1 - cueva.distKm / RADIO_BONO_KM) * factorBase) : 0;
  const crateresScore = crater ? Math.round(100 * (1 - crater.distKm / RADIO_BONO_KM) * factorBase) : 0;

  const valor = Math.min(
    100,
    Math.round(
      parecido * perfil.pesoParecido +
        solidez * perfil.pesoSolidez +
        cuevasScore * perfil.pesoCuevas +
        crateresScore * perfil.pesoCrateres
    )
  );

  const rasgoCercano =
    cueva && (!crater || cueva.distKm <= crater.distKm)
      ? { nombre: cueva.nombre, tipo: 'cueva' as const, distKm: Number(cueva.distKm.toFixed(1)) }
      : crater
        ? { nombre: crater.nombre, tipo: 'crater' as const, distKm: Number(crater.distKm.toFixed(1)) }
        : null;

  return {
    entrada,
    valor,
    desglose: {
      parecido: Math.round(parecido),
      solidez: Math.round(solidez),
      cuevas: cuevasScore,
      crateres: crateresScore,
    },
    rasgoCercano,
  };
}

export function ordenarPorRanking(
  entradas: EntradaValor[],
  perfil: PerfilRanking,
  puntosGeo: PuntoGeologico[] = []
): ResultadoValor[] {
  return entradas
    .map((e) => calcularValorSitio(e, perfil, puntosGeo))
    .sort((a, b) => b.valor - a.valor || b.desglose.parecido - a.desglose.parecido || b.desglose.solidez - a.desglose.solidez);
}

export function leerRankingsGuardados(): Partial<Record<RankingId, RankingGuardado>> {
  try {
    const raw = localStorage.getItem(STORAGE_RANKINGS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<RankingId, RankingGuardado>>) : {};
  } catch {
    return {};
  }
}

export function guardarSnapshotRanking(
  perfil: PerfilRanking,
  resultados: ResultadoValor[],
  topN = 15
): Partial<Record<RankingId, RankingGuardado>> {
  const todos = leerRankingsGuardados();
  todos[perfil.id] = {
    rankingId: perfil.id,
    nombreRanking: perfil.nombre,
    fechaIso: new Date().toISOString(),
    items: resultados.slice(0, topN).map((r, idx) => ({
      puesto: idx + 1,
      id: r.entrada.id,
      etiqueta: r.entrada.etiqueta,
      objetivo: r.entrada.objetivo,
      valor: r.valor,
      parecido_pct: r.entrada.parecido_pct,
      solidez_pct: r.entrada.solidez_pct,
      rasgo: r.rasgoCercano ? `${r.rasgoCercano.nombre} (${r.rasgoCercano.distKm} km)` : null,
    })),
  };
  try {
    localStorage.setItem(STORAGE_RANKINGS, JSON.stringify(todos));
  } catch {
    // Ignorar error de cuota
  }
  return todos;
}
