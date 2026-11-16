// Análisis de minerales y roca de una celda de la tabla maestra. ENSAYO (ADR-005).
// Todo sale de columnas reales (manifest.json de la tabla): GLiM, ASTER GED, EMIT L3 ASA, SoilGrids.
// Cada valor se sitúa frente al resto de la Tierra con dato (percentil sobre una muestra de la columna).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// GLiM v1.0 (leyenda del manifest, clases 1 a 16). Los ejemplos entre paréntesis son geología general.
const ROCAS = {
  1: ['su', 'sedimentos no consolidados (arena, grava, limo)'], 2: ['vb', 'volcánicas básicas (basalto y afines)'],
  3: ['ss', 'sedimentarias siliciclásticas (arenisca, lutita)'], 4: ['pb', 'plutónicas básicas (gabro)'],
  5: ['sm', 'sedimentarias mixtas'], 6: ['sc', 'sedimentarias carbonatadas (caliza, dolomía)'],
  7: ['va', 'volcánicas ácidas (riolita)'], 8: ['mt', 'metamórficas'], 9: ['pa', 'plutónicas ácidas (granito)'],
  10: ['vi', 'volcánicas intermedias (andesita)'], 11: ['wb', 'cuerpos de agua'], 12: ['py', 'piroclásticas (cenizas, tobas)'],
  13: ['pi', 'plutónicas intermedias'], 14: ['ev', 'evaporitas (yeso, sal)'], 15: ['nd', 'sin dato'], 16: ['ig', 'hielo y glaciares'],
};
const ASTER = [
  ['aster_qi', 'Índice de cuarzo (QI)', 'Mayor que 1 en arena de cuarzo.'],
  ['aster_ci', 'Índice de carbonato (CI)', 'Más alto cuanto más carbonato (indicio, no medida directa).'],
  ['aster_mi', 'Índice máfico (MI)', 'Bajo en rocas ricas en sílice, alto en basaltos.'],
];
const EMIT = {
  emit_calcite: 'Calcita', emit_dolomite: 'Dolomita', emit_gypsum: 'Yeso', emit_hematite: 'Hematita', emit_goethite: 'Goethita',
  emit_kaolinite: 'Caolinita', emit_montmorillonite: 'Montmorillonita', emit_illite_muscovite: 'Illita / moscovita',
  emit_chlorite: 'Clorita', emit_vermiculite: 'Vermiculita', emit_quartz_feldspar: 'Cuarzo y feldespato',
};
const SUELO = { arcilla_gkg: 'Arcilla', limo_gkg: 'Limo' };

/** Percentiles 0..100 de una columna, de una muestra (1 de cada 150 valores válidos). Se calcula una vez y queda en caché. */
function cuantiles(maestro, cache, col) {
  mkdirSync(cache, { recursive: true });
  const ruta = join(cache, `cuantiles-${col}.json`);
  if (existsSync(ruta)) return JSON.parse(readFileSync(ruta, 'utf8'));
  const fd = openSync(join(maestro, `${col}.f32`), 'r');
  const N = 1 << 22, buf = Buffer.alloc(N * 4), muestra = [];
  let base = 0, k = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, base * 4) / 4;
      if (n <= 0) break;
      const a = new Float32Array(buf.buffer, buf.byteOffset, n);
      for (let i = 0; i < n; i++) if (Number.isFinite(a[i]) && ++k % 150 === 0) muestra.push(a[i]);
      base += n;
    }
  } finally { closeSync(fd); }
  muestra.sort((x, y) => x - y);
  const q = Array.from({ length: 101 }, (_, i) => muestra[Math.min(muestra.length - 1, Math.floor((i / 100) * (muestra.length - 1)))]);
  const r = { n_muestra: muestra.length, q };
  writeFileSync(ruta, JSON.stringify(r));
  return r;
}

/** Porcentaje de celdas con dato cuyo valor es menor o igual al dado (0 a 100). */
function percentil(q, v) {
  let lo = 0, hi = q.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (q[m] <= v) lo = m + 1; else hi = m; }
  return Math.max(0, Math.min(100, lo - 1));
}

const lectura = (p) => (p >= 85 ? 'alto' : p <= 15 ? 'bajo' : 'típico');

/**
 * @param idx celda de la tabla maestra; @param valorEn (columna, idx) => número | null
 * @returns hechos de minerales y roca (todo con su fuente y resolución)
 */
export function analizarMinerales(idx, valorEn, { maestro, cache }) {
  const out = { fuentes: 'GLiM (0,5°), ASTER GED (~1 km), EMIT L3 ASA (0,5°), SoilGrids (1 km)' };
  const g = valorEn('litologia_glim', idx);
  if (g != null && ROCAS[Math.round(g)]) {
    const [cod, nombre] = ROCAS[Math.round(g)];
    out.roca = { clase: Math.round(g), codigo: cod, nombre, nota: 'Mapa de rocas de 0,5° (unos 55 km): es la roca dominante de la zona, no la del punto exacto.' };
  }
  out.aster = ASTER.map(([col, nombre, pista]) => {
    const v = valorEn(col, idx);
    if (v == null) return { columna: col, nombre, valor: null, pista };
    const p = percentil(cuantiles(maestro, cache, col).q, v);
    return { columna: col, nombre, valor: v, percentil: p, lectura: lectura(p), pista };
  });
  const emit = Object.entries(EMIT).map(([col, nombre]) => ({ columna: col, nombre, valor: valorEn(col, idx) }));
  const conDato = emit.filter((m) => m.valor != null);
  out.emit = {
    cobertura: conDato.length > 0,
    nota: 'Abundancia espectral de la capa superficial (no % en peso), malla de 0,5° (~55 km), solo zonas áridas entre ~55° N y 55° S.',
    minerales: conDato.map((m) => ({ ...m, percentil: percentil(cuantiles(maestro, cache, m.columna).q, m.valor) }))
      .sort((a, b) => b.valor - a.valor),
  };
  out.suelo = Object.entries(SUELO).map(([col, nombre]) => {
    const v = valorEn(col, idx);
    return { columna: col, nombre, valor: v, unidad: 'g/kg', percentil: v == null ? null : percentil(cuantiles(maestro, cache, col).q, v) };
  });
  return out;
}

/** Resumen en una frase por bloque, para la plantilla y la voz. */
export function resumenMinerales(m) {
  const L = [];
  if (m.roca) L.push(`La roca dominante de la zona son ${m.roca.nombre}.`);
  const as = (m.aster ?? []).filter((a) => a.valor != null);
  if (as.length) {
    L.push('Índices espectrales ASTER: ' + as.map((a) => `${a.nombre.replace(/ \(.+\)/, '').toLowerCase()} ${a.lectura} (más alto que el ${a.percentil} % de la Tierra)`).join('; ') + '.');
  }
  else L.push('ASTER no tiene dato en esta celda (agua, costa o fuera de cobertura), así que no hay índices de cuarzo, carbonato ni máficos.');
  if (m.emit?.cobertura) {
    const top = m.emit.minerales.filter((x) => x.valor > 0).slice(0, 3);
    L.push(top.length ? `EMIT detecta en superficie: ${top.map((x) => `${x.nombre.toLowerCase()} (${x.valor.toFixed(2)})`).join(', ')}.` : 'EMIT cubre la zona pero no detecta ninguno de los 11 minerales.');
  } else L.push('EMIT no cubre esta zona (no es árida o queda fuera de la malla), así que no hay minerales por espectroscopía.');
  const arc = m.suelo?.find((s) => s.columna === 'arcilla_gkg' && s.valor != null);
  if (arc) L.push(`El suelo tiene ${Math.round(arc.valor)} g/kg de arcilla.`);
  return L;
}
