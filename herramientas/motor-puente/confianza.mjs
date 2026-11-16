// Confianza (y su rango) de cada candidato. ENSAYO (ADR-005).
// Mide cuánto creer que el ajuste con su sitio objetivo es real, NO si ya está verificado (todos los candidatos están sin verificar).
// Cinco componentes con puntos fijos y a la vista: ajuste 40, discriminación 20, robustez 20, calidad del perfil 10, cobertura 10.
// Es un índice orientativo, no una probabilidad calibrada (19 pares de validación, 0 en la Luna: P-029).
// La robustez puntual es k/n; el rango propaga Wilson al 95 % de la robustez, el P25–P75 del ajuste en el círculo
// (con cotas de Manski por variables faltantes), la cobertura de la huella y la calidad cuando no hay regiones (P-031).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analogosDe, listarAreas, obtenerArea, PERFILES_EXTRA, REPO, RUN, RUTAS, todasAreas } from './nucleo.mjs';

const CACHE = join(RUN, 'motor/cache-explicaciones');
const HIELO = join(RUN, 'motor/hielo_min/analogos_hielo.json');
export const HIELO_PERFILES = ['hielo_basalto', 'hielo_arcilla', 'crater_hielo_alterado'];
const HIELO_VARS_POR_PERFIL = {
  hielo_basalto: ['slope_mean_deg', 'rug_rms_mean_m', 'amp_anual_k', 'permafrost_prob', 'hielo_suelo_gam', 'aster_mi', 'aster_qi'],
  hielo_arcilla: ['slope_mean_deg', 'rug_rms_mean_m', 'amp_anual_k', 'permafrost_prob', 'hielo_suelo_gam', 'arcilla_gkg', 'aster_ci'],
  crater_hielo_alterado: ['slope_mean_deg', 'amp_anual_k', 'permafrost_prob', 'hielo_suelo_gam', 'arcilla_gkg', 'aster_ci'],
};
const CASOS_RUTAS = [
  join(REPO, 'scripts/etl/casos/casos_agy.json'),
  join(REPO, 'scripts/etl/casos/casos_orquestador.json'),
];
export const PUNTOS = { ajuste: 40, discriminacion: 20, robustez: 20, calidad: 10, cobertura: 10 };
export const UMBRALES = { alta: 65, media: 40 };
// La cadena es tan fuerte como su eslabón más débil: aunque el puntaje sume mucho, el nivel tiene topes.
export const TOPES = {
  ajuste: { minimo: 0.6, texto: 'el ajuste con el objetivo es flojo (menos de 60 % entre variables dentro de tolerancia y cercanía)' },
  discriminacion: { minimo: 0.5, texto: 'la mitad o más de las variables tienen tolerancias tan anchas que casi no discriminan' },
  calidad: { minimo: 0.3, texto: 'el motor marca la calidad de este perfil como baja' },
  robustez: { minimo: 0.7, texto: 'aparece en pocos escenarios y el margen de la robustez es amplio' },
  elegibles: { texto: 'casi todo el círculo es vegetación o no tiene datos (menos de 40 de 400 celdas elegibles): la mediana del ajuste es poco fiable' },
};

/**
 * Apariciones (k) y escenarios (n) del objetivo con que se mide el área, o null si no hay dato.
 * k y n son siempre del mismo objetivo: un barrido de varios objetivos no se cuenta contra el total del barrido.
 * 1) n_escenarios guardado en el área (hallazgos y búsquedas nuevas); 2) búsquedas viejas: n = aparece_en / fraccion.
 */
export function escenariosDe(p) {
  if (p.n_escenarios > 0) {
    const k = p.aparece_en_objetivo ?? p.aparece_en ?? 0;
    return { k: Math.min(k, p.n_escenarios), n: p.n_escenarios, cota: !!p.aparece_en_es_cota };
  }
  if (p.fraccion > 0 && p.aparece_en > 0) return { k: p.aparece_en, n: Math.max(p.aparece_en, Math.round(p.aparece_en / p.fraccion)), cota: false };
  return null;
}

/** Intervalo de Wilson (95 %) para k éxitos de n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { lo: 0, centro: 0, hi: 1 };
  const p = Math.min(1, k / n), d = 1 + (z * z) / n;
  const centro = (p + (z * z) / (2 * n)) / d, m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, centro - m), centro, hi: Math.min(1, centro + m) };
}
const ORDEN = ['baja', 'media', 'alta'];
export const nivelDe = (puntaje) => (puntaje >= UMBRALES.alta ? 'alta' : puntaje >= UMBRALES.media ? 'media' : 'baja');
const tope = (nivel, max) => (ORDEN.indexOf(nivel) > ORDEN.indexOf(max) ? max : nivel);

const esMedidaTerrenoTermica = (v) => /^(slope_|rug_rms_|relieve_|dtr_k$|amp_anual_k$)/.test(String(v ?? ''));
const normalizarTexto = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const esRazonSupuesta = (razon) => {
  const t = normalizarTexto(razon);
  return /^suposicion\b/.test(t) || /\(supuesto,\s*no verificado\)\.?$/.test(t);
};
const esRazonModelada = (razon) => /^modelo,\s*no medicion\b/.test(normalizarTexto(razon));

function variablesPorRazon(perfilNombre, casos, pred, variables = null) {
  if (!String(perfilNombre ?? '').startsWith('caso_')) return [];
  const id = String(perfilNombre).slice(5);
  const lista = (Array.isArray(casos) ? casos : []).flatMap((c) => (Array.isArray(c?.casos) ? c.casos : c ? [c] : []));
  const caso = lista.find((c) => c?.id === id);
  if (!caso || !Array.isArray(caso.a_priori)) return [];
  const encontradas = caso.a_priori.filter((x) => pred(x?.razon)).map((x) => x.variable).filter(Boolean);
  const filtradas = Array.isArray(variables) ? encontradas.filter((v) => variables.includes(v)) : encontradas;
  return [...new Set(filtradas)];
}

/** Lista las variables de un perfil cuyo valor objetivo es un supuesto, no un dato medido (P-029). */
export function variablesSupuestas(perfilNombre, casos = [], hieloPerfiles = HIELO_PERFILES, variables = null) {
  if (!perfilNombre) return [];
  if (Array.isArray(hieloPerfiles) && hieloPerfiles.includes(perfilNombre)) {
    const vars = Array.isArray(variables) ? variables : (HIELO_VARS_POR_PERFIL[perfilNombre] ?? []);
    return [...new Set(vars.filter((v) => !esMedidaTerrenoTermica(v)))];
  }
  return variablesPorRazon(perfilNombre, casos, esRazonSupuesta, variables);
}

/** Lista las variables de un perfil cuyo valor objetivo sale de un modelo climático (ej. MCD 6.2) y no de una medición directa (P-029). */
export function variablesModeladas(perfilNombre, casos = [], variables = null) {
  if (!perfilNombre) return [];
  return variablesPorRazon(perfilNombre, casos, esRazonModelada, variables);
}

/** Puntaje y rango a partir de las señales ya medidas (puro, para pruebas). */
export function puntuar({ ok, n, cerc, sin, wideras, k, nEsc, calidad, margenCelda = 0, zona = null, pocasElegibles = false, supuestas = 0, modeladas = 0 }) {
  const disc = n ? (n - wideras) / n : 0;
  const w = wilson(k, nEsc);
  // Sin doble castigo en robustez (P-031): el puntaje usa k/n y deja Wilson para el rango y el tope.
  const rob = nEsc > 0 ? Math.min(1, k / nEsc) : 0;
  // Sin regiones clasificadas no hay dato de calidad: neutro (0,5) en el punto, pero rango [0,1..1,0].
  const nCal = calidad ? calidad.alta + calidad.media + calidad.baja : 0;
  const q = nCal > 0 ? (calidad.alta + 0.5 * calidad.media + 0.1 * calidad.baja) / nCal : 0.5;
  const qLo = nCal > 0 ? q : 0.1, qHi = nCal > 0 ? q : 1.0;
  // Cobertura en toda la huella del círculo si está medida; si no, en la celda central.
  const cobCentro = n ? 1 - sin / n : 0;
  const cob = zona?.cobertura != null ? zona.cobertura : cobCentro;
  const fracSinNdvi = zona?.sin_ndvi != null ? zona.sin_ndvi / Math.max(1, zona.celdas + (zona.sin_datos ?? 0)) : 0;
  const cobLo = zona?.cobertura_p25 != null ? Math.min(cob, zona.cobertura_p25 * (1 - 0.25 * fracSinNdvi)) : cob;
  const cobHi = zona?.cobertura_p75 != null ? Math.max(cob, zona.cobertura_p75) : cob;
  // El ajuste es el de la zona (mediana de las celdas del círculo) si se midió; si no, el de la celda central.
  const ajCentro = 0.5 * (n ? ok / n : 0) + 0.5 * cerc;
  const aj = zona ? zona.mediana : ajCentro;
  const comp = {
    ajuste: PUNTOS.ajuste * aj, discriminacion: PUNTOS.discriminacion * disc,
    robustez: PUNTOS.robustez * rob, calidad: PUNTOS.calidad * q, cobertura: PUNTOS.cobertura * cob,
  };
  const r = (x) => Math.round(x);
  const puntaje = comp.ajuste + comp.discriminacion + comp.robustez + comp.calidad + comp.cobertura;
  // Rango: propaga dispersión del ajuste en el círculo (P25–P75 con cotas de Manski), cobertura, calidad y robustez (Wilson).
  const ajLo = zona ? zona.p25 : aj, ajHi = zona ? zona.p75 : aj, m = zona ? 0 : margenCelda;
  const bajo = Math.max(0, PUNTOS.ajuste * ajLo + PUNTOS.discriminacion * disc + PUNTOS.calidad * qLo + PUNTOS.cobertura * cobLo + PUNTOS.robustez * w.lo - m);
  const alto = Math.min(100, PUNTOS.ajuste * ajHi + PUNTOS.discriminacion * disc + PUNTOS.calidad * qHi + PUNTOS.cobertura * cobHi + PUNTOS.robustez * w.hi + m);
  const fracs = { ajuste: aj, discriminacion: disc, calidad: q, robustez: w.lo };
  let nivel = nivelDe(puntaje);
  const limitantes = [];
  if (fracs.ajuste < TOPES.ajuste.minimo) { nivel = tope(nivel, fracs.ajuste < 0.4 ? 'baja' : 'media'); limitantes.push(TOPES.ajuste.texto); }
  for (const k2 of ['discriminacion', 'calidad', 'robustez']) if (fracs[k2] < TOPES[k2].minimo) { nivel = tope(nivel, 'media'); limitantes.push(TOPES[k2].texto); }
  if (pocasElegibles) { nivel = tope(nivel, 'media'); limitantes.push(TOPES.elegibles.texto); }
  // Evidencia epistémica del objetivo: distinguimos medido (1,0), modelado (0,6) y supuesto a priori (0,1).
  const nSup = Array.isArray(supuestas) ? supuestas.length : (Number(supuestas) || 0);
  const nMod = Array.isArray(modeladas) ? modeladas.length : (Number(modeladas) || 0);
  const nMed = Math.max(0, n - nSup - nMod);
  const evidencia_objetivo = n ? Number(Math.max(0.1, (nMed + 0.6 * nMod + 0.1 * nSup) / n).toFixed(3)) : 1;
  // Un modelo es mejor evidencia que un supuesto (0,6 frente a 0,1): limita a media, pero no cuenta para bajar a «baja».
  if (nMod >= 1) {
    nivel = tope(nivel, 'media');
    limitantes.push(`el objetivo de ${nMod} de ${n} variables sale de un modelo climático, no de una medición directa`);
  }
  if (nSup >= 1) {
    nivel = tope(nivel, nSup >= Math.ceil(n / 2) ? 'baja' : 'media');
    limitantes.push(`el objetivo de ${nSup} de ${n} variables es un supuesto, no un dato medido de Marte`);
  }
  // El puntaje mostrado respeta el nivel (si un eslabón débil lo limita, no se enseña un 72 con la etiqueta «baja»).
  const techo = nivel === 'baja' ? UMBRALES.media - 1 : nivel === 'media' ? UMBRALES.alta - 1 : 100;
  const c = (x) => Math.min(techo, r(x));
  // El rango NO se recorta con el techo: es la incertidumbre del puntaje bruto y recortarlo lo colapsaba a ancho 0.
  return { ajuste_centro: Number(ajCentro.toFixed(3)), ajuste_zona: zona ? { p25: Number(zona.p25.toFixed(3)), mediana: Number(zona.mediana.toFixed(3)), p75: Number(zona.p75.toFixed(3)), celdas: zona.celdas, ...(zona.cobertura != null ? { cobertura: zona.cobertura } : {}) } : null,
    puntaje: c(puntaje), puntaje_bruto: r(puntaje), bajo_bruto: r(bajo), alto_bruto: r(alto), bajo: r(bajo), alto: r(alto), nivel, limitantes, componentes: Object.fromEntries(Object.entries(comp).map(([k2, v]) => [k2, Number(v.toFixed(1))])), robustez_rango: [Math.round(w.lo * 100), Math.round(w.hi * 100)], evidencia_objetivo };
}

/** Celdas más cercanas de varios puntos en una sola pasada sobre lat/lon (con caché por punto, igual que la ficha). */
function celdas(puntos) {
  mkdirSync(CACHE, { recursive: true });
  const pendientes = [];
  const leidos = new Map();
  for (const p of puntos) {
    const f = join(CACHE, `celda-${p.lat.toFixed(3)}_${p.lon.toFixed(3)}.json`);
    if (leidos.has(f)) { p.idx = leidos.get(f); }
    else if (existsSync(f)) { p.idx = JSON.parse(readFileSync(f, 'utf8')).idx; leidos.set(f, p.idx); }
    else { p.d = Infinity; p.idx = -1; p.f = f; pendientes.push(p); }
  }
  if (!pendientes.length) return;
  const bandas = new Map();
  for (const p of pendientes) { const b = Math.floor(p.lat); (bandas.get(b) ?? bandas.set(b, []).get(b)).push(p); }
  const fl = openSync(join(RUTAS.maestro, 'lat.f32'), 'r'), fo = openSync(join(RUTAS.maestro, 'lon.f32'), 'r');
  const N = 1 << 22, bl = Buffer.alloc(N * 4), bo = Buffer.alloc(N * 4);
  let base = 0;
  try {
    for (;;) {
      const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
      if (n <= 0) break;
      readSync(fo, bo, 0, n * 4, base * 4);
      const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
      for (let i = 0; i < n; i++) {
        const b0 = Math.floor(a[i]);
        for (let b = b0 - 1; b <= b0 + 1; b++) for (const p of bandas.get(b) ?? []) {
          const dla = a[i] - p.lat; if (dla > 0.6 || dla < -0.6) continue;
          let dlo = o[i] - p.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
          const k = Math.cos((p.lat * Math.PI) / 180), d = dla * dla + (dlo * k) ** 2;
          if (d < p.d) { p.d = d; p.idx = base + i; }
        }
      }
      base += n;
    }
  } finally { closeSync(fl); closeSync(fo); }
  for (const p of pendientes) if (p.idx >= 0) writeFileSync(p.f, JSON.stringify({ idx: p.idx, dist_km: Math.sqrt(p.d) * 111.195 }));
}

/** Muestra fija de hasta MUESTRA celdas dentro del círculo de cada punto (con caché). Fija: se elige por un hash del
 * índice, así dos corridas dan la misma muestra. Una zona de 150 km tiene ~28 000 celdas; 400 bastan para la mediana. */
export const MUESTRA = 400;
const NDVI = 'ndvi_media';
/** Con menos celdas elegibles que esto en la muestra del círculo, la mediana no es fiable y el nivel se limita a media. */
export const MIN_ELEGIBLES = 40;
const hashIdx = (i) => Math.imul(i ^ (i >>> 16), 0x45d9f3b) >>> 0;
function zonas(puntos) {
  mkdirSync(CACHE, { recursive: true });
  const pendientes = [];
  const leidos = new Map();
  for (const p of puntos) {
    const f = join(CACHE, `zona-${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${p.radio}.json`);
    if (leidos.has(f)) p.muestra = leidos.get(f);
    else if (existsSync(f)) { p.muestra = JSON.parse(readFileSync(f, 'utf8')).muestra; leidos.set(f, p.muestra); }
    else { p.f = f; p.dentro = []; p.dmax = p.radio / 111.195; pendientes.push(p); }
  }
  if (!pendientes.length) return;
  const bandas = new Map();
  for (const p of pendientes) { const b = Math.floor(p.lat); (bandas.get(b) ?? bandas.set(b, []).get(b)).push(p); }
  const ancho = Math.ceil(Math.max(...pendientes.map((p) => p.dmax))) + 1;
  const fl = openSync(join(RUTAS.maestro, 'lat.f32'), 'r'), fo = openSync(join(RUTAS.maestro, 'lon.f32'), 'r');
  const N = 1 << 22, bl = Buffer.alloc(N * 4), bo = Buffer.alloc(N * 4);
  let base = 0;
  try {
    for (;;) {
      const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
      if (n <= 0) break;
      readSync(fo, bo, 0, n * 4, base * 4);
      const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
      for (let i = 0; i < n; i++) {
        const b0 = Math.floor(a[i]);
        for (let b = b0 - ancho; b <= b0 + ancho; b++) for (const p of bandas.get(b) ?? []) {
          const dla = a[i] - p.lat; if (dla > p.dmax || dla < -p.dmax) continue;
          let dlo = o[i] - p.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
          const k = Math.cos((p.lat * Math.PI) / 180);
          if (dla * dla + (dlo * k) ** 2 <= p.dmax * p.dmax) p.dentro.push(base + i);
        }
      }
      base += n;
    }
  } finally { closeSync(fl); closeSync(fo); }
  for (const p of pendientes) {
    p.muestra = p.dentro.sort((x, y) => hashIdx(x) - hashIdx(y)).slice(0, MUESTRA).sort((x, y) => x - y);
    writeFileSync(p.f, JSON.stringify({ radio_km: p.radio, celdas_en_circulo: p.dentro.length, muestra: p.muestra }));
    delete p.dentro;
  }
}

/** Valores de una columna en varias celdas, abriendo el archivo una sola vez. */
function leerVarias(v, idxs) {
  const f = join(RUTAS.maestro, `${v}.f32`);
  if (!existsSync(f)) return idxs.map(() => null);
  const fd = openSync(f, 'r'), b = Buffer.alloc(4);
  try {
    return idxs.map((i) => { readSync(fd, b, 0, 4, i * 4); const x = b.readFloatLE(0); return Number.isFinite(x) ? x : null; });
  } finally { closeSync(fd); }
}

/** Pone en cada punto `valores[v]` (una lista alineada con su muestra) para las variables de su perfil. Lo que falta
 * se lee en una pasada por variable y se guarda en la caché de la zona, para no releer el maestro en cada arranque. */
function valoresDeZona(puntos) {
  const faltan = new Map(); // variable -> Set de celdas
  const sucias = new Set();
  const cachesPorRuta = new Map();
  for (const p of puntos) {
    p.fz = join(CACHE, `zona-${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${p.radio}.json`);
    let cache = cachesPorRuta.get(p.fz);
    if (!cache) {
      cache = JSON.parse(readFileSync(p.fz, 'utf8'));
      cache.valores ??= {};
      cache.valores_centro ??= {};
      cachesPorRuta.set(p.fz, cache);
    }
    p.cacheZona = cache;
    for (const v of [...p.pf.variables, NDVI]) {
      const faltaMuestra = !cache.valores[v];
      const faltaCentro = p.idx >= 0 && !(v in cache.valores_centro);
      if (faltaMuestra || faltaCentro) {
        const s = faltan.get(v) ?? faltan.set(v, new Set()).get(v);
        if (faltaMuestra) for (const i of p.muestra) s.add(i);
        if (faltaCentro) s.add(p.idx);
        sucias.add(p);
      }
    }
  }
  for (const [v, s] of faltan) {
    const idxs = [...s].sort((x, y) => x - y), xs = leerVarias(v, idxs), m = new Map();
    idxs.forEach((i, j) => m.set(i, xs[j]));
    for (const p of sucias) {
      if (v === NDVI || p.pf.variables.includes(v)) {
        if (!p.cacheZona.valores[v]) p.cacheZona.valores[v] = p.muestra.map((i) => m.get(i));
        if (p.idx >= 0 && !(v in p.cacheZona.valores_centro)) p.cacheZona.valores_centro[v] = m.get(p.idx) ?? null;
      }
    }
  }
  // varios candidatos pueden compartir zona: se escribe una vez por archivo, con todas sus variables
  const porArchivo = new Map();
  for (const p of sucias) {
    const dest = porArchivo.get(p.fz) ?? porArchivo.set(p.fz, { ...p.cacheZona, valores: {}, valores_centro: {} }).get(p.fz);
    Object.assign(dest.valores, p.cacheZona.valores);
    Object.assign(dest.valores_centro, p.cacheZona.valores_centro);
  }
  for (const [f, c] of porArchivo) {
    const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    writeFileSync(f, JSON.stringify({ ...c, valores: { ...(prev.valores ?? {}), ...c.valores }, valores_centro: { ...(prev.valores_centro ?? {}), ...c.valores_centro } }));
  }
  for (const p of puntos) {
    p.valores = Object.fromEntries([...p.pf.variables, NDVI].map((v) => [v, p.cacheZona.valores[v]]));
    p.valoresCentro = p.cacheZona.valores_centro ?? {};
  }
}

/** Percentil q (0..1) de una lista ya ordenada. */
const pct = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0);

/** Ajuste (0.5·fracción OK + 0.5·cercanía) de cada celda de la muestra contra el perfil; devuelve P25 (Manski inf.), mediana y P75 (Manski sup.),
 * más cobertura media de variables en toda la huella descontando ausencia de NDVI.
 * Igual que el motor: (1) solo celdas elegibles (NDVI <= ndviMax; sin dato de NDVI se conserva, ADR-014) y
 * (2) las variables sin dato no cuentan como fallo en la mediana (Gower), pero abren el rango P25–P75 con cotas de Manski
 * y reducen la cobertura media de la huella; una celda con menos de la mitad de las variables no entra al ajuste. */
export function ajusteDeZona(pf, valores, ndviMax = Infinity) {
  const n = pf.variables.length, m = valores[pf.variables[0]]?.length ?? 0, ndvi = valores[NDVI];
  const aj = [], ajLo = [], ajHi = [], cobs = [];
  let noElegibles = 0, sinDatos = 0, sinNdvi = 0;
  for (let j = 0; j < m; j++) {
    if (ndvi?.[j] != null && ndvi[j] > ndviMax) { noElegibles++; continue; }
    if (ndvi?.[j] == null) sinNdvi++;
    let ok = 0, cerc = 0, obs = 0;
    for (const v of pf.variables) {
      const x = valores[v][j]; if (x == null) continue;
      const d = Math.abs(x - pf.objetivo[v]), t = pf.tolerancia[v];
      obs++;
      if (d <= t) ok++;
      cerc += Math.max(0, 1 - d / t);
    }
    const cob = n ? obs / n : 0;
    cobs.push(cob);
    if (obs * 2 < n) { sinDatos++; continue; }
    const a = 0.5 * (ok / obs) + 0.5 * (cerc / obs);
    aj.push(a);
    ajLo.push(cob * a);
    ajHi.push(cob * a + (1 - cob));
  }
  aj.sort((x, y) => x - y);
  ajLo.sort((x, y) => x - y);
  ajHi.sort((x, y) => x - y);
  cobs.sort((x, y) => x - y);
  const fracSinNdvi = cobs.length ? sinNdvi / cobs.length : 0;
  const cobMedia = cobs.length ? (cobs.reduce((s, x) => s + x, 0) / cobs.length) * (1 - 0.25 * fracSinNdvi) : 0;
  return {
    p25: pct(ajLo, 0.25), mediana: pct(aj, 0.5), p75: pct(ajHi, 0.75),
    celdas: aj.length, muestra: m, no_elegibles: noElegibles, sin_datos: sinDatos, sin_ndvi: sinNdvi,
    cobertura: Number(cobMedia.toFixed(3)), cobertura_p25: Number(pct(cobs, 0.25).toFixed(3)), cobertura_p75: Number(pct(cobs, 0.75).toFixed(3)),
  };
}

const leerCol = (v, idx) => {
  const f = join(RUTAS.maestro, `${v}.f32`);
  if (!existsSync(f) || idx < 0) return null;
  const fd = openSync(f, 'r'), b = Buffer.alloc(4);
  try { readSync(fd, b, 0, 4, idx * 4); } finally { closeSync(fd); }
  const x = b.readFloatLE(0);
  return Number.isFinite(x) ? x : null;
};

const cargarCasos = () => CASOS_RUTAS.flatMap((r) => (existsSync(r) ? (JSON.parse(readFileSync(r, 'utf8')).casos ?? []) : []));

let memo = null;
/** Confianza de todas las áreas del mapa que tienen sitio objetivo. Se recalcula si cambia el número de áreas. */
export function confianzas() {
  const todas = todasAreas();
  if (memo && memo.n === todas.length) return memo.datos;
  const an = JSON.parse(readFileSync(RUTAS.analogos, 'utf8'));
  const anH = existsSync(HIELO) ? JSON.parse(readFileSync(HIELO, 'utf8')) : null;
  const casos = cargarCasos();
  const extra = Object.fromEntries(Object.keys(PERFILES_EXTRA).map((pf) => [pf, analogosDe(pf) !== RUTAS.analogos ? JSON.parse(readFileSync(analogosDe(pf), 'utf8')) : null]));
  const cand = [];
  const datos = {};
  for (const p of todas) {
    if (p.grupo === 'hallado') { datos[p.id] = { nivel: 'referencia', razones: ['Análogo documentado: es la referencia, no un candidato.'] }; continue; }
    let objetivo = p.objetivo;
    if (!objetivo && p.objetivos) objetivo = Object.entries(p.objetivos).sort((x, y) => y[1] - x[1])[0]?.[0];
    if (!objetivo) continue;
    const tag = `${p.corrida ?? ''} ${p.barrido ?? ''}`;
    const hielo = /arcadia|crateres|utopia/.test(tag) && anH;
    const perfil = /arcadia/.test(tag) ? 'hielo_basalto' : /crateres/.test(tag) ? 'crater_hielo_alterado' : /utopia/.test(tag) ? 'hielo_arcilla' : (p.perfil ?? 'terreno_termico');
    const o = (hielo ? anH : extra[perfil] ?? an).objetivos[objetivo];
    const perfilUso = o?.perfiles[perfil] ? perfil : 'terreno_termico';
    const pf = o?.perfiles[perfilUso];
    if (!pf) continue;
    cand.push({ id: p.id, lat: p.lat, lon: p.lon, radio: p.radio_km ?? 50, p, pf, objetivo, perfil: perfilUso, barrido: p.barrido });
  }
  celdas(cand);
  zonas(cand);
  valoresDeZona(cand);
  for (const c of cand) {
    // Corte de NDVI del círculo: el más amplio que usan los barridos (0,6 = ndvi_max_proxima_pasada). Las áreas no
    // guardan el corte del escenario que las halló, y con 0,3 se castigaba a las halladas legítimamente con 0,6.
    const z = !c.muestra?.length ? null : ajusteDeZona(c.pf, c.valores, an.parametros?.ndvi_max_proxima_pasada ?? 0.6);
    c.pocas = z ? z.celdas < MIN_ELEGIBLES : false;
    c.zona = z && z.celdas > 0 ? z : null;
  }
  for (const c of cand) {
    const { pf, p } = c;
    const vs = pf.variables.map((v) => {
      const x = c.valoresCentro?.[v] ?? null, obj = pf.objetivo[v], tol = pf.tolerancia[v], d = x == null ? null : Math.abs(x - obj);
      const esc = pf.escala_tierra?.[v];
      return { ok: d != null && d <= tol, sin: d == null, cerc: d == null ? 0 : Math.max(0, 1 - d / tol), ancha: esc ? tol / esc > 5 : false, v };
    });
    const n = vs.length, ok = vs.filter((x) => x.ok).length, sin = vs.filter((x) => x.sin).length, anchas = vs.filter((x) => x.ancha).length;
    const e = escenariosDe(p);
    const supuestas = variablesSupuestas(c.perfil, casos, HIELO_PERFILES, pf.variables);
    const modeladas = variablesModeladas(c.perfil, casos, pf.variables);
    const k = e?.k ?? 0, nEsc = e?.n ?? 0;
    const r = puntuar({ ok, n, cerc: vs.reduce((s, x) => s + x.cerc, 0) / n, sin, wideras: anchas, k, nEsc, calidad: pf.resumen_calidad, zona: c.zona, pocasElegibles: c.pocas, supuestas: supuestas.length, modeladas: modeladas.length });
    const z = c.zona, pc = (x) => Math.round(x * 100);
    const razones = [`${ok} de ${n} variables dentro de la tolerancia del objetivo en la celda del centro.`,
      z ? `En el círculo de ${c.radio} km (${z.celdas} de ${z.muestra} celdas muestreadas son elegibles) el ajuste es ${pc(z.mediana)} % de mediana (P25 ${pc(z.p25)} %, P75 ${pc(z.p75)} %) y la cobertura en la huella es ${pc(z.cobertura)} %${z.sin_ndvi ? ` (${z.sin_ndvi} sin NDVI)` : ''}; en el centro, ${pc(r.ajuste_centro)} %. El puntaje usa la mediana y la cobertura del círculo.`
        : 'No hay celdas elegibles con datos en el círculo: el ajuste y la cobertura se miden solo en la celda del centro.'];
    if (anchas) razones.push(`${anchas} de ${n} variables tienen una tolerancia más de 5 veces la variación natural de la Tierra: casi no discriminan.`);
    if (!e) razones.push('Sin dato de en cuántos escenarios aparece: la robustez cuenta 0 y su rango va de 0 % a 100 %.');
    else razones.push(`Aparece en ${e.cota ? 'hasta ' : ''}${k} de los ${nEsc} escenarios de ${c.objetivo} (${Math.round((k / nEsc) * 100)} %): el intervalo de Wilson al 95 % para el rango va de ${r.robustez_rango[0]} % a ${r.robustez_rango[1]} %.`);
    if (e?.cota) razones.push('Es una zona: el barrido no guarda las apariciones de una sola celda por objetivo, así que se usa una cota superior.');
    const cal = pf.resumen_calidad;
    if (cal && cal.alta + cal.media + cal.baja === 0) razones.push('Sin regiones clasificadas en este perfil: la calidad puntual queda neutra (50 %) y su incertidumbre (10 %–100 %) entra al rango.');
    else if (cal && cal.alta + cal.media === 0) razones.push('El motor marca la calidad de este perfil como baja en todas sus regiones.');
    if (sin) razones.push(`${sin} variable(s) sin dato en la celda.`);
    for (const l of r.limitantes) razones.push(`Nivel limitado porque ${l}.`);
    razones.push('Sin verificar con una fuente independiente: es un índice orientativo de solidez del ajuste, no una probabilidad calibrada ni una validez científica.');
    datos[c.id] = { ...r, objetivo: c.objetivo, variables_ok: ok, variables: n, supuestas, variables_supuestas: supuestas.length, modeladas, variables_modeladas: modeladas.length, razones, puntos: PUNTOS };
  }
  memo = { n: todas.length, datos };
  return datos;
}
