// Explicación en lenguaje natural de un área: lugar (país), datos reales del motor y texto.
// ENSAYO (ADR-005). La clave de DeepSeek se lee de .env (ignorado por git) y nunca sale de este proceso.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aGuion, guionDesdePlantilla, RITMOS } from './voz.mjs';
import { analizarMinerales, resumenMinerales } from './minerales.mjs';
import { confianzas } from './confianza.mjs';
import { analogosDe, estadoBusqueda, listarAreas, listarHistorialCorridas, listarObjetivos, MAX_CORRIDAS_BARRIDO, MAX_ESCENARIOS_BARRIDO, MAX_ESCENARIOS_CORRIDA, normalizarParams, obtenerArea, REPO, RUN, RUTAS, todasAreas, validarIndice } from './nucleo.mjs';

const CACHE = join(RUN, 'motor/cache-explicaciones');
const HIELO = join(RUN, 'motor/hielo_min/analogos_hielo.json');
const MCD_MARTE_RUTA = join(RUN, 'etl/objetivos/objetivos_marte_mcd.json');
// Viento de Marte: lo escribe `scripts/etl/objetivos.py mcd_sitios` (I-28). Sin archivo, el viento de Marte queda sin dato.
let _mcdMarte = null;
const mcdMarte = () => {
  if (_mcdMarte) return _mcdMarte;
  _mcdMarte = existsSync(MCD_MARTE_RUTA) ? JSON.parse(readFileSync(MCD_MARTE_RUTA, 'utf8')) : {};
  return _mcdMarte;
};
const NOMBRES = {
  slope_mean_deg: 'pendiente media', slope_std_deg: 'variación de la pendiente', slope_p90_deg: 'pendiente (percentil 90)',
  slope_p99_deg: 'pendiente (percentil 99)', slope_frac_gt15: 'fracción de terreno con más de 15° de pendiente',
  rug_rms_mean_m: 'rugosidad media', rug_rms_p90_m: 'rugosidad (percentil 90)', relieve_mean_m: 'relieve local medio',
  relieve_p90_m: 'relieve local (percentil 90)', dtr_k: 'oscilación térmica diaria', amp_anual_k: 'amplitud térmica anual',
  factor_cielo_visible: 'cielo visible', aridez_ai: 'índice de aridez', aster_ci: 'índice de carbonatos (ASTER)',
  aster_qi: 'índice de cuarzo (ASTER)', aster_mi: 'índice máfico (ASTER)', permafrost_prob: 'probabilidad de permafrost',
  viento_frac_tau_gt_0p05: 'fracción del tiempo con viento que mueve arena', polvo_frec_dod0p2_pct: 'frecuencia de polvo (%)',
  arena_movil_frac: 'fracción de arena móvil', hielo_suelo_gam: 'hielo en el suelo (señal gamma)', arcilla_gkg: 'arcilla (g/kg)',
};
const UNIDAD = { slope_mean_deg: '°', slope_std_deg: '°', slope_p90_deg: '°', slope_p99_deg: '°', rug_rms_mean_m: ' m', rug_rms_p90_m: ' m',
  relieve_mean_m: ' m', relieve_p90_m: ' m', dtr_k: ' K', amp_anual_k: ' K', arcilla_gkg: ' g/kg' };
const CUERPO = { luna: 'la Luna', marte: 'Marte' };
const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(2));

const leerJson = (r) => JSON.parse(readFileSync(r, 'utf8'));
const cacheJson = (nombre, f) => {
  mkdirSync(CACHE, { recursive: true });
  const ruta = join(CACHE, nombre);
  if (existsSync(ruta)) return Promise.resolve(leerJson(ruta));
  return Promise.resolve(f()).then((v) => { if (v) writeFileSync(ruta, JSON.stringify(v)); return v; });
};

/** Celda de la tabla maestra más cercana a (lat, lon): lectura por bloques de lat.f32 y lon.f32. */
export function celdaMasCercana(lat, lon) {
  const fl = openSync(join(RUTAS.maestro, 'lat.f32'), 'r'), fo = openSync(join(RUTAS.maestro, 'lon.f32'), 'r');
  const N = 1 << 22, bl = Buffer.alloc(N * 4), bo = Buffer.alloc(N * 4);
  const k = Math.cos((lat * Math.PI) / 180);
  let mejor = Infinity, idx = -1, base = 0;
  try {
    for (;;) {
      const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
      if (n <= 0) break;
      readSync(fo, bo, 0, n * 4, base * 4);
      const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
      for (let i = 0; i < n; i++) {
        const dla = a[i] - lat;
        if (dla > 1 || dla < -1) continue;
        let dlo = o[i] - lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
        const d = dla * dla + dlo * k * (dlo * k);
        if (d < mejor) { mejor = d; idx = base + i; }
      }
      base += n;
    }
  } finally { closeSync(fl); closeSync(fo); }
  return idx < 0 ? null : { idx, dist_km: Math.sqrt(mejor) * 111.195 };
}

function valorEn(variable, idx) {
  const f = join(RUTAS.maestro, `${variable}.f32`);
  if (!existsSync(f)) return null;
  const fd = openSync(f, 'r'), b = Buffer.alloc(4);
  try { readSync(fd, b, 0, 4, idx * 4); } finally { closeSync(fd); }
  const v = b.readFloatLE(0);
  return Number.isFinite(v) ? v : null;
}

const hashIdx = (i) => Math.imul(i ^ (i >>> 16), 0x45d9f3b) >>> 0;
function leerColIdxs(v, idxs) {
  const f = join(RUTAS.maestro, `${v}.f32`);
  if (!existsSync(f)) return idxs.map(() => null);
  const fd = openSync(f, 'r'), b = Buffer.alloc(4);
  try {
    return idxs.map((i) => { readSync(fd, b, 0, 4, i * 4); const x = b.readFloatLE(0); return Number.isFinite(x) ? x : null; });
  } finally { closeSync(fd); }
}

function muestraZona(lat, lon, radioKm = 50) {
  mkdirSync(CACHE, { recursive: true });
  const ruta = join(CACHE, `zona-${lat.toFixed(3)}_${lon.toFixed(3)}_${radioKm}.json`);
  if (existsSync(ruta)) {
    try {
      const j = leerJson(ruta);
      if (Array.isArray(j.muestra)) return j;
    } catch { /* regenerar */ }
  }
  const fl = openSync(join(RUTAS.maestro, 'lat.f32'), 'r'), fo = openSync(join(RUTAS.maestro, 'lon.f32'), 'r');
  const N = 1 << 22, bl = Buffer.alloc(N * 4), bo = Buffer.alloc(N * 4);
  const dmax = radioKm / 111.195, k = Math.cos((lat * Math.PI) / 180);
  const dentro = [];
  let base = 0;
  try {
    for (;;) {
      const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
      if (n <= 0) break;
      readSync(fo, bo, 0, n * 4, base * 4);
      const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
      for (let i = 0; i < n; i++) {
        const dla = a[i] - lat; if (dla > dmax || dla < -dmax) continue;
        let dlo = o[i] - lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
        if (dla * dla + (dlo * k) ** 2 <= dmax * dmax) dentro.push(base + i);
      }
      base += n;
    }
  } finally { closeSync(fl); closeSync(fo); }
  const muestra = dentro.sort((x, y) => hashIdx(x) - hashIdx(y)).slice(0, 400).sort((x, y) => x - y);
  const salida = { radio_km: radioKm, celdas_en_circulo: dentro.length, muestra };
  writeFileSync(ruta, JSON.stringify(salida));
  return salida;
}

function puntajeAdr008(pf, valores, j, minFraccion = 0) {
  let sum2 = 0, used = 0;
  for (const v of pf.variables) {
    const x = valores[v]?.[j];
    if (x == null) continue;
    const tol = pf.tolerancia[v] ?? 0;
    const sc = pf.escala_tierra?.[v] || tol || 1;
    const d = Math.max(0, Math.abs(x - pf.objetivo[v]) - tol);
    const z = d / sc;
    sum2 += z * z;
    used++;
  }
  if (!used || (minFraccion > 0 && used < Math.ceil(pf.variables.length * minFraccion))) return 0;
  return Math.exp(-0.5 * (sum2 / used));
}

function enPoligono(lon, lat, anillo) {
  let inside = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const xi = anillo[i][0], yi = anillo[i][1];
    const xj = anillo[j][0], yj = anillo[j][1];
    const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distKmSimple(lat1, lon1, lat2, lon2) {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const dLon = ((lon2 - lon1 + 540) % 360) - 180;
  return Math.hypot(lat2 - lat1, dLon * k) * 111.195;
}

/** Analiza una zona dibujada en el visor (cualquier tamaño) leyendo solo sus celdas en la tabla maestra. */
export async function analizarZonaMapa(zona) {
  const coords = Array.isArray(zona?.coords) ? zona.coords : [];
  if (coords.length < 3) throw new Error('la zona necesita al menos 3 vértices');
  const rawAnillo = coords.map((c) => [Number(c.lon), Number(c.lat)]);
  if (!rawAnillo.every(([lo, la]) => Number.isFinite(lo) && Number.isFinite(la) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180)) {
    throw new Error('coordenadas inválidas en la zona');
  }
  let rawLonMin = 180, rawLonMax = -180;
  for (const [lo] of rawAnillo) {
    if (lo < rawLonMin) rawLonMin = lo;
    if (lo > rawLonMax) rawLonMax = lo;
  }
  const cruzaAntimeridiano = rawLonMax - rawLonMin > 180;
  const wrapLon = (lo) => (cruzaAntimeridiano && lo < 0 ? lo + 360 : lo);
  const anillo = rawAnillo.map(([lo, la]) => [wrapLon(lo), la]);
  let latMin = 90, latMax = -90, lonMin = 360, lonMax = -180;
  for (const [lo, la] of anillo) {
    if (la < latMin) latMin = la; if (la > latMax) latMax = la;
    if (lo < lonMin) lonMin = lo; if (lo > lonMax) lonMax = lo;
  }
  const cLat = (latMin + latMax) / 2;
  const cLonRaw = (lonMin + lonMax) / 2;
  const cLon = cLonRaw > 180 ? cLonRaw - 360 : cLonRaw;
  const firma = rawAnillo.map(([lo, la]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(';');
  let h1 = 2166136261, h2 = 0;
  for (let i = 0; i < firma.length; i++) {
    const ch = firma.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
    h2 = (Math.imul(31, h2) + ch) >>> 0;
  }
  mkdirSync(CACHE, { recursive: true });
  const cachePath = join(CACHE, `zonamapa-${h1.toString(36)}-${h2.toString(36)}.json`);
  let zData = null;
  if (existsSync(cachePath)) {
    try { zData = leerJson(cachePath); } catch { zData = null; }
  }
  if (!zData) {
    const fl = openSync(join(RUTAS.maestro, 'lat.f32'), 'r'), fo = openSync(join(RUTAS.maestro, 'lon.f32'), 'r');
    const N = 1 << 22, bl = Buffer.alloc(N * 4), bo = Buffer.alloc(N * 4);
    const dentro = [];
    let base = 0;
    try {
      for (;;) {
        const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
        if (n <= 0) break;
        readSync(fo, bo, 0, n * 4, base * 4);
        const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
        for (let i = 0; i < n; i++) {
          const la = a[i]; if (la < latMin || la > latMax) continue;
          const lo = wrapLon(o[i]); if (lo < lonMin || lo > lonMax) continue;
          if (enPoligono(lo, la, anillo)) dentro.push(base + i);
        }
        base += n;
      }
    } finally { closeSync(fl); closeSync(fo); }
    let modo = 'poligono';
    let idxs = dentro.sort((x, y) => hashIdx(x) - hashIdx(y)).slice(0, 400).sort((x, y) => x - y);
    if (!idxs.length) {
      const c = celdaMasCercana(cLat, cLon);
      if (c) { idxs = [c.idx]; modo = 'celda_mas_cercana_zona_chica'; }
    }
    zData = { total_celdas: dentro.length, muestra: idxs, modo };
    writeFileSync(cachePath, JSON.stringify(zData));
  }
  const idxs = zData.muestra ?? [];
  if (!idxs.length) return { error: 'la zona no tiene datos en la tabla maestra (puede estar en océano)' };

  const an = leerJson(RUTAS.analogos);
  const anBV = existsSync(RUTAS.analogosBV) ? leerJson(RUTAS.analogosBV) : null;
  const anHielo = existsSync(HIELO) ? leerJson(HIELO) : null;
  const cols = ['ndvi_media', 'slope_mean_deg', 'slope_std_deg', 'slope_p90_deg', 'slope_p99_deg', 'slope_frac_gt15',
    'rug_rms_mean_m', 'rug_rms_p90_m', 'relieve_mean_m', 'relieve_p90_m', 'dtr_k', 'amp_anual_k', 'factor_cielo_visible',
    'aridez_ai', 'permafrost_prob', 'magt_c', 'hielo_suelo_gam', 'deriv_volcanica_basica', 'aster_mi', 'aster_ci', 'aster_qi',
    'arcilla_gkg', 'dunas_frac', 'arena_movil_frac', 'gsw_ocurrencia_media_pct', 'humedal_area_pct',
    'polvo_frec_dod0p2_pct', 'viento_frac_tau_gt_0p05'];
  const vals = Object.fromEntries(cols.map((v) => [v, leerColIdxs(v, idxs)]));
  const media = (v) => {
    const xs = vals[v].filter((x) => x != null);
    return xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null;
  };
  const elig = idxs.map((_, j) => j).filter((j) => vals.ndvi_media[j] == null || vals.ndvi_media[j] <= 0.3);
  const todosJ = idxs.map((_, j) => j);

  const evaluar = (anSrc, perfilNombre, pool) => {
    if (!anSrc || !pool.length) return [];
    const out = [];
    for (const [sid, o] of Object.entries(anSrc.objetivos ?? {})) {
      const pf = o.perfiles?.[perfilNombre];
      if (!pf) continue;
      const scs = pool.map((j) => puntajeAdr008(pf, vals, j, 0.5)).sort((a, b) => b - a);
      out.push({
        objetivo: sid, nombre: o.nombre, cuerpo: o.cuerpo, perfil: perfilNombre,
        ...(pf.foco ? { foco: pf.foco } : {}),
        s_max_pct: Math.round(scs[0] * 100),
        s_p90_pct: Math.round((scs[Math.min(scs.length - 1, Math.floor(scs.length * 0.1))] ?? 0) * 100),
        s_med_pct: Math.round((scs[Math.floor(scs.length * 0.5)] ?? 0) * 100),
      });
    }
    return out.sort((a, b) => b.s_max_pct - a.s_max_pct || b.s_p90_pct - a.s_p90_pct);
  };

  const evaluarCasos = (anSrc, pool) => {
    if (!anSrc || !pool.length) return [];
    const out = [];
    for (const [sid, o] of Object.entries(anSrc.objetivos ?? {})) {
      for (const [pn, pf] of Object.entries(o.perfiles ?? {})) {
        if (!pn.startsWith('caso_')) continue;
        const scs = pool.map((j) => puntajeAdr008(pf, vals, j, 0.5)).sort((a, b) => b - a);
        out.push({
          objetivo: sid, nombre: o.nombre, cuerpo: o.cuerpo, caso: pn, foco: pf.foco ?? null,
          s_max_pct: Math.round(scs[0] * 100),
          s_p90_pct: Math.round((scs[Math.min(scs.length - 1, Math.floor(scs.length * 0.1))] ?? 0) * 100),
          s_med_pct: Math.round((scs[Math.floor(scs.length * 0.5)] ?? 0) * 100),
        });
      }
    }
    return out.sort((a, b) => b.s_max_pct - a.s_max_pct || b.s_p90_pct - a.s_p90_pct);
  };

  const topEstandar = evaluar(an, 'terreno_termico', elig).slice(0, 8);
  const topCasos = evaluarCasos(an, elig.length ? elig : todosJ).slice(0, 8);
  const topVegetacion = elig.length < idxs.length && anBV ? evaluar(anBV, 'bajo_vegetacion', todosJ).slice(0, 5) : [];

  const nAterrizaje = todosJ.filter((j) => (vals.slope_mean_deg[j] ?? 99) <= 5 && (vals.rug_rms_mean_m[j] ?? 999) <= 15).length;
  const nRover = todosJ.filter((j) => (vals.slope_mean_deg[j] ?? 99) <= 15 && (vals.ndvi_media[j] ?? 0) <= 0.3).length;
  const nAccidentado = todosJ.filter((j) => (vals.slope_mean_deg[j] ?? 0) >= 10 || (vals.relieve_mean_m[j] ?? 0) >= 100).length;
  const nHielo = todosJ.filter((j) => (vals.permafrost_prob[j] ?? 0) >= 0.5 || (vals.magt_c[j] ?? 99) < 0).length;
  const topHielo = nHielo > 0 && anHielo
    ? ['hielo_basalto', 'crater_hielo_alterado', 'hielo_arcilla']
      .flatMap((p) => evaluar(anHielo, p, todosJ))
      .sort((a, b) => b.s_max_pct - a.s_max_pct)
      .slice(0, 5)
    : [];

  const leerCapa = (archivo) => {
    const r = join(REPO, 'visor/public/capas', archivo);
    if (!existsSync(r)) return [];
    return leerJson(r).filter((x) => enPoligono(wrapLon(x.lon), x.lat, anillo) || distKmSimple(cLat, cLon, x.lat, x.lon) <= 30)
      .slice(0, 8).map((x) => ({ nombre: x.nombre, lat: x.lat, lon: x.lon, dentro: enPoligono(wrapLon(x.lon), x.lat, anillo) }));
  };
  const areasMapa = listarAreas().filter((a) => enPoligono(wrapLon(a.lon), a.lat, anillo) || distKmSimple(cLat, cLon, a.lat, a.lon) <= (a.radio_km ?? 50))
    .slice(0, 10).map((a) => ({ id: a.id, etiqueta: a.etiqueta, grupo: a.grupo, objetivo: a.objetivo, parecido_pct: a.parecido_pct }));

  const lugar = await lugarDe(cLat, cLon);
  return {
    zona: { id: zona.id ?? null, nombre: zona.nombre ?? 'Zona seleccionada', area_km2: zona.area_km2 ?? null, centro: { lat: cLat, lon: cLon }, lugar: lugar.texto },
    muestreo: { modo: zData.modo, total_celdas_en_zona: zData.total_celdas, celdas_muestra: idxs.length, celdas_elegibles_ndvi: elig.length },
    resumen_fisico_y_filtros: {
      ndvi_medio: media('ndvi_media'),
      pendiente_media_deg: media('slope_mean_deg'),
      pendiente_gt15_frac: media('slope_frac_gt15'),
      rugosidad_media_m: media('rug_rms_mean_m'),
      relieve_medio_m: media('relieve_mean_m'),
      cielo_visible: media('factor_cielo_visible'),
      aridez_ai: media('aridez_ai'),
      permafrost_prob: media('permafrost_prob'),
      magt_c: media('magt_c'),
      hielo_suelo_gam: media('hielo_suelo_gam'),
      roca_volcanica_frac: media('deriv_volcanica_basica'),
      aster_mi: media('aster_mi'),
      aster_ci: media('aster_ci'),
      aster_qi: media('aster_qi'),
      arcilla_gkg: media('arcilla_gkg'),
      dunas_frac: media('dunas_frac'),
      arena_movil_frac: media('arena_movil_frac'),
      agua_ocurrencia_pct: media('gsw_ocurrencia_media_pct'),
      polvo_frec_pct: media('polvo_frec_dod0p2_pct'),
      viento_arena_frac: media('viento_frac_tau_gt_0p05'),
    },
    casos_de_uso_en_zona: {
      aterrizaje_plano_celdas: nAterrizaje,
      rover_celdas_elegibles: nRover,
      terreno_accidentado_celdas: nAccidentado,
      hielo_o_permafrost_celdas: nHielo,
    },
    mejores_objetivos_estandar: topEstandar,
    mejores_casos_operativos: topCasos,
    mejores_objetivos_hielo: topHielo,
    mejores_objetivos_bajo_vegetacion: topVegetacion,
    cuevas_cercanas: leerCapa('cuevas.json'),
    crateres_cercanos: leerCapa('crateres.json'),
    areas_ya_catalogadas_cerca: areasMapa,
    puede_correr_motor_rust_directo: (zona.area_km2 ?? 0) >= 40000,
  };
}

/** País y lugar por geocodificación inversa (solo se envían las coordenadas; sin datos personales). */
async function lugarDe(lat, lon) {
  const clave = `lugar-${lat.toFixed(2)}_${lon.toFixed(2)}.json`;
  return cacheJson(clave, async () => {
    try {
      const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&accept-language=es&lat=${lat}&lon=${lon}`;
      const r = await fetch(u, { headers: { 'User-Agent': 'analogos-ensayo-local/0.1' }, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) return { pais: null, region: null, texto: 'sin nombre de lugar (zona remota, océano o sin cobertura)' };
      const a = j.address ?? {};
      const region = a.state ?? a.region ?? a.county ?? a.province ?? null;
      return { pais: a.country ?? null, region, texto: [region, a.country].filter(Boolean).join(', ') || j.display_name };
    } catch { return null; } // sin red: no se guarda en caché
  }).then((v) => v ?? { pais: null, region: null, texto: 'lugar no disponible (sin conexión al geocodificador)' });
}

function analogosPara(area) {
  const p = area.properties;
  const tag = `${p.corrida ?? ''} ${p.barrido ?? ''}`;
  const hielo = /arcadia|crateres|utopia/.test(tag) && existsSync(HIELO);
  const perfilHielo = /arcadia/.test(tag) ? 'hielo_basalto' : /crateres/.test(tag) ? 'crater_hielo_alterado' : /utopia/.test(tag) ? 'hielo_arcilla' : null;
  return { archivo: hielo ? HIELO : analogosDe(p.perfil ?? 'terreno_termico'), perfil: hielo ? perfilHielo : (p.perfil ?? 'terreno_termico') };
}

/** Reúne los hechos reales de un área (nada inventado): lugar, S del motor y variables objetivo vs aquí. */
export async function hechosDeArea(id) {
  const f = obtenerArea(id);
  if (!f) return null;
  const p = f.properties;
  const lugar = await lugarDe(p.lat, p.lon);
  const hechos = {
    id: p.id, etiqueta: p.etiqueta ?? p.id, grupo: p.grupo, estado: p.estado, lat: p.lat, lon: p.lon, radio_km: p.radio_km,
    lugar: lugar.texto, pais: lugar.pais, region: lugar.region, fuente: p.fuente, fecha: p.fecha,
    es_ensayo: true,
  };
  if (p.nombre) hechos.nombre = p.nombre;
  if (p.ubicacion) hechos.descripcion_del_sitio = p.ubicacion;
  if (p.resumen && p.grupo === 'hallado') hechos.resumen_del_sitio = p.resumen;
  if (p.fuente_url) hechos.fuente_url = p.fuente_url;
  if (p.pares_i26?.length) hechos.pares_i26 = p.pares_i26;
  hechos.confianza = confianzas()[id] ?? null;
  const s = p.s_mediana ?? p.s_max;
  if (s != null) hechos.parecido_motor_pct = Math.round(s * 100);
  if (p.fraccion != null) hechos.aparece_en_pct_escenarios = Math.round(p.fraccion * 100);
  if (p.aparece_en != null) hechos.aparece_en_n = p.aparece_en;
  if (p.corrida || p.barrido) hechos.corrida = p.corrida ?? p.barrido;

  // Celda de la tabla maestra más cercana al centro: de ahí salen las variables y los minerales.
  const celda = await cacheJson(`celda-${p.lat.toFixed(3)}_${p.lon.toFixed(3)}.json`, () => celdaMasCercana(p.lat, p.lon));
  if (celda) {
    hechos.celda_distancia_km = Number(celda.dist_km.toFixed(1));
    hechos.minerales = analizarMinerales(celda.idx, valorEn, { maestro: RUTAS.maestro, cache: CACHE });
    const dod02 = valorEn('polvo_frec_dod0p2_pct', celda.idx);
    const dod05 = valorEn('polvo_frec_dod0p5_pct', celda.idx);
    const emision = valorEn('polvo_emision_kg_m2_s', celda.idx);
    const arcilla = valorEn('arcilla_gkg', celda.idx);
    const limo = valorEn('limo_gkg', celda.idx);
    const arcilla_pct = arcilla == null ? null : Number((arcilla / 10).toFixed(1));
    const limo_pct = limo == null ? null : Number((limo / 10).toFixed(1));
    const fino_lt50_pct = arcilla_pct != null && limo_pct != null ? Number((arcilla_pct + limo_pct).toFixed(1)) : null;
    const nivel_polvo = dod02 == null ? null : (dod02 >= 25 || (dod05 ?? 0) >= 8) ? 'muy-polvoso' : dod02 >= 8 ? 'moderado' : 'bajo';
    if ([dod02, dod05, emision, arcilla_pct, limo_pct].some((x) => x != null)) {
      hechos.polvo_finos = {
        dod02_pct: dod02 == null ? null : Number(dod02.toFixed(1)),
        dod05_pct: dod05 == null ? null : Number(dod05.toFixed(1)),
        emision_kg_m2_s: emision == null ? null : Number(emision.toExponential(2)),
        arcilla_pct,
        limo_pct,
        fino_lt50_pct,
        nivel_polvo,
      };
    }

    // Filtros y contexto (no entran como variables del puntaje Mahalanobis/tolerancia)
    const filtros = [];
    const ndvi = valorEn('ndvi_media', celda.idx);
    if (ndvi != null) {
      filtros.push({
        nombre: 'Vegetación (NDVI)',
        valor: `${ndvi.toFixed(2)} (${ndvi <= 0.3 ? 'pasa filtro ≤ 0.30' : 'supera 0.30 · requiere bajo_vegetacion'})`,
        estado: ndvi <= 0.3 ? 'pasa' : 'alerta',
      });
    }
    const ai = valorEn('aridez_ai', celda.idx);
    if (ai != null) {
      const cat = ai < 0.05 ? 'hiperárido' : ai < 0.2 ? 'árido' : ai < 0.5 ? 'semiárido' : 'húmedo';
      filtros.push({ nombre: 'Aridez (AI)', valor: `${ai.toFixed(2)} (${cat})`, estado: ai < 0.2 ? 'pasa' : 'info' });
    }
    const perm = valorEn('permafrost_prob', celda.idx);
    const magt = valorEn('magt_c', celda.idx);
    const hielo = valorEn('hielo_suelo_gam', celda.idx);
    if (perm != null || magt != null || hielo != null) {
      filtros.push({
        nombre: 'Permafrost / hielo en suelo',
        valor: `${perm != null ? `${Math.round(perm * 100)} % prob.` : 'sin dato'}${magt != null ? ` · ${magt.toFixed(1)} °C` : ''}${hielo != null ? ` · hielo GAM ${hielo.toFixed(2)}` : ''}`,
        estado: (perm ?? 0) >= 0.5 ? 'pasa' : 'info',
      });
    }
    const volc = valorEn('deriv_volcanica_basica', celda.idx);
    if (volc != null && volc > 0) {
      filtros.push({ nombre: 'Roca volcánica básica', valor: `${Math.round(volc * 100)} %`, estado: 'pasa' });
    }
    const dunas = valorEn('dunas_frac', celda.idx);
    const arenaMov = valorEn('arena_movil_frac', celda.idx);
    if ((dunas != null && dunas > 0) || (arenaMov != null && arenaMov > 0)) {
      const tiposDuna = [
        ['crecientes', valorEn('dunas_creciente_frac', celda.idx) ?? 0],
        ['lineales', valorEn('dunas_lineal_frac', celda.idx) ?? 0],
        ['estrella', valorEn('dunas_estrella_frac', celda.idx) ?? 0],
      ].filter(([, v]) => Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
      const dom = tiposDuna[0] ? ` (predominan ${tiposDuna[0][0]})` : '';
      filtros.push({
        nombre: 'Dunas / arena móvil',
        valor: `dunas ${dunas != null ? Math.round(dunas * 100) : 0} %${dom} · arena móvil ${arenaMov != null ? Math.round(arenaMov * 100) : 0} %`,
        estado: 'info',
      });
    }
    const agua = valorEn('gsw_ocurrencia_media_pct', celda.idx);
    const humedal = valorEn('humedal_area_pct', celda.idx);
    const humClase = valorEn('humedal_clase', celda.idx);
    const efim = valorEn('frac_efimero', celda.idx);
    if (agua != null || humedal != null || efim != null) {
      const salarTxt = humClase === 32 ? ' · salar/humedal salino (GLWD 32)' : '';
      const efimTxt = efim != null && efim > 0 ? ` · efímero ${Math.round(efim * 100)} %` : '';
      filtros.push({
        nombre: 'Agua / salares',
        valor: `agua ${agua != null ? agua.toFixed(1) : 0} % · humedal ${humedal != null ? humedal.toFixed(1) : 0} %${salarTxt}${efimTxt}`,
        estado: (agua ?? 0) > 10 ? 'alerta' : 'info',
      });
    }
    const slp15 = valorEn('slope_frac_gt15', celda.idx);
    const cielo = valorEn('factor_cielo_visible', celda.idx);
    if (slp15 != null || cielo != null) {
      filtros.push({
        nombre: 'Terreno operativo / luz',
        valor: `${slp15 != null ? `${Math.round(slp15 * 100)} % pendiente > 15°` : ''}${slp15 != null && cielo != null ? ' · ' : ''}${cielo != null ? `cielo visible ${Math.round(cielo * 100)} %` : ''}`,
        estado: (slp15 ?? 0) > 0.3 ? 'alerta' : 'pasa',
      });
    }
    const viento = valorEn('viento_frac_tau_gt_0p05', celda.idx);
    const viento10 = valorEn('viento_frac_tau_gt_0p10', celda.idx);
    const ustar0 = valorEn('viento_ustar_media', celda.idx);
    const tau0 = valorEn('viento_tau_media_pa', celda.idx);
    if (viento != null || ustar0 != null) {
      hechos.viento_shields = {
        cuerpo: 'tierra',
        tierra_arrastre_pct: viento != null ? Number((viento * 100).toFixed(1)) : null,
        tierra_inicio_pct: viento10 != null ? Number((viento10 * 100).toFixed(1)) : null,
        tierra_ustar_ms: ustar0 != null ? Number(ustar0.toFixed(2)) : null,
        tierra_tau_pa: tau0 != null ? Number(tau0.toFixed(3)) : null,
        marte_arrastre_pct: null,
        marte_cota_baja_pct: null,
        marte_u_media_ms: null,
        marte_u_max_ms: null,
        marte_tau_max_pa: null,
        marte_arrastre_z0_liso_pct: null,
        advertencia: null,
      };
    }
    if (dod02 != null || viento != null) {
      filtros.push({
        nombre: 'Polvo / viento',
        valor: `polvo ${dod02 != null ? dod02.toFixed(1) : '—'} % · viento arena ${viento != null ? Math.round(viento * 100) : '—'} %`,
        estado: 'info',
      });
    }
    if (filtros.length) hechos.filtros = filtros;
  }

  let objetivo = p.objetivo;
  if (!objetivo && p.objetivos) objetivo = Object.entries(p.objetivos).sort((a, b) => b[1] - a[1])[0]?.[0];
  let desdeReferencia = false;
  if (!objetivo && Array.isArray(p.pares_i26) && p.pares_i26.length) {
    objetivo = p.pares_i26[0].sl;
    desdeReferencia = true;
  }
  if (!objetivo && p.grupo === 'hallado') {
    objetivo = 'SL-12';
    desdeReferencia = true;
  }
  if (!objetivo) return hechos; // sin objetivo asociado
  const { archivo, perfil } = analogosPara(f);
  const an = leerJson(archivo);
  const o = an.objetivos?.[objetivo];
  if (!o) return hechos;
  const pf = o.perfiles[perfil] ?? o.perfiles.terreno_termico ?? Object.values(o.perfiles)[0];
  const usado = o.perfiles[perfil] ? perfil : (o.perfiles.terreno_termico ? 'terreno_termico' : Object.keys(o.perfiles)[0]);
  hechos.objetivo = { id: objetivo, nombre: o.nombre, cuerpo: o.cuerpo, perfil: usado, ...(desdeReferencia ? { evaluado_desde_referencia: true } : {}) };
  if (p.objetivos) hechos.otros_objetivos_que_tambien_coinciden = p.objetivos;

  if (!celda) return hechos;

  // Para sitios de referencia (o si no hay s_mediana/s_max del barrido), evaluamos la zona del radio con ADR-008
  // y leemos las variables/filtros en la mejor celda elegible para no quedarnos con un afloramiento puntual en el centro.
  let idxEval = celda.idx;
  if (desdeReferencia || hechos.parecido_motor_pct == null) {
    const zInfo = muestraZona(p.lat, p.lon, p.radio_km ?? 50);
    const idxs = zInfo.muestra?.length ? zInfo.muestra : [celda.idx];
    const varsLeer = [...new Set([...pf.variables, 'ndvi_media'])];
    const vals = Object.fromEntries(varsLeer.map((v) => [v, leerColIdxs(v, idxs)]));
    const elig = idxs.map((_, j) => j).filter((j) => vals.ndvi_media[j] == null || vals.ndvi_media[j] <= 0.3);
    const pool = elig.length ? elig : idxs.map((_, j) => j);
    let bestJ = pool[0];
    let bestS = -1;
    const scores = [];
    for (const j of pool) {
      const sc = puntajeAdr008(pf, vals, j);
      scores.push(sc);
      if (sc > bestS) { bestS = sc; bestJ = j; }
    }
    scores.sort((a, b) => b - a);
    idxEval = idxs[bestJ];
    const sP90 = scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.1))] ?? 0;
    const sMed = scores[Math.floor(scores.length * 0.5)] ?? 0;
    hechos.parecido_motor_pct = Math.round(Math.max(0, bestS) * 100);
    hechos.evaluacion_zona = {
      modo: elig.length ? 'mejor_celda_en_radio' : 'celda_centro',
      radio_km: p.radio_km ?? 50,
      celdas_elegibles: elig.length,
      celdas_muestra: idxs.length,
      s_max_pct: Math.round(Math.max(0, bestS) * 100),
      s_p90_pct: Math.round(sP90 * 100),
      s_med_pct: Math.round(sMed * 100),
    };
  }

  hechos.variables = pf.variables.map((v) => {
    const aqui = valorEn(v, idxEval), obj = pf.objetivo[v], tol = pf.tolerancia[v];
    const d = aqui == null ? null : Math.abs(aqui - obj);
    const fuera = pf.fuera_del_alcance_de_la_tierra?.[v];
    return { variable: v, nombre: NOMBRES[v] ?? v, unidad: UNIDAD[v] ?? '', aqui, objetivo: obj, tolerancia: tol,
      coincide: d == null ? null : d <= tol, cercania_pct: d == null ? null : Math.round(Math.max(0, 1 - d / tol) * 100),
      veces_tolerancia: d == null || !tol ? null : Number((d / tol).toFixed(2)), direccion: d == null ? null : aqui > obj ? 'más alto' : 'más bajo',
      el_objetivo_supera_la_tierra: fuera ? `el valor del objetivo (${fuera.objetivo_real}) supera el máximo medido en la Tierra (${fuera['tope_tierra_p99.9']})` : null };
  });

  // Refrescar filtros con la celda evaluada y compararlos contra los filtros/casos del objetivo si existen
  const ndviEval = valorEn('ndvi_media', idxEval);
  const aiEval = valorEn('aridez_ai', idxEval);
  const permEval = valorEn('permafrost_prob', idxEval);
  const magtEval = valorEn('magt_c', idxEval);
  const hieloEval = valorEn('hielo_suelo_gam', idxEval);
  const volcEval = valorEn('deriv_volcanica_basica', idxEval);
  const dunasEval = valorEn('dunas_frac', idxEval);
  const arenaEval = valorEn('arena_movil_frac', idxEval);
  const aguaEval = valorEn('gsw_ocurrencia_media_pct', idxEval);
  const humEval = valorEn('humedal_area_pct', idxEval);
  const humClaseEval = valorEn('humedal_clase', idxEval);
  const efimEval = valorEn('frac_efimero', idxEval);
  const slp15Eval = valorEn('slope_frac_gt15', idxEval);
  const cieloEval = valorEn('factor_cielo_visible', idxEval);
  const dodEval = valorEn('polvo_frec_dod0p2_pct', idxEval);
  const vientoEval = valorEn('viento_frac_tau_gt_0p05', idxEval);
  const viento10Eval = valorEn('viento_frac_tau_gt_0p10', idxEval);
  const ustarEval = valorEn('viento_ustar_media', idxEval);
  const tauEval = valorEn('viento_tau_media_pa', idxEval);

  const tierraArrPct = vientoEval != null ? Number((vientoEval * 100).toFixed(1)) : null;
  const tierraIniPct = viento10Eval != null ? Number((viento10Eval * 100).toFixed(1)) : null;
  const mcdObj = o.cuerpo === 'marte' ? mcdMarte()?.[objetivo] : null;
  const marteArrPct = mcdObj?.viento_frac_tau_gt_0p01_pct ?? null;
  if (tierraArrPct != null || marteArrPct != null) {
    hechos.viento_shields = {
      cuerpo: o.cuerpo,
      tierra_arrastre_pct: tierraArrPct,
      tierra_inicio_pct: tierraIniPct,
      tierra_ustar_ms: ustarEval != null ? Number(ustarEval.toFixed(2)) : null,
      tierra_tau_pa: tauEval != null ? Number(tauEval.toFixed(3)) : null,
      marte_arrastre_pct: marteArrPct,
      marte_cota_baja_pct: mcdObj?.viento_frac_tau_gt_0p005_pct ?? null,
      marte_u_media_ms: mcdObj?.viento_u_media_ms ?? null,
      marte_u_max_ms: mcdObj?.viento_u_max_ms ?? null,
      marte_tau_max_pa: mcdObj?.viento_tau_max_pa ?? null,
      marte_arrastre_z0_liso_pct: mcdObj?.viento_frac_tau_gt_0p01_pct_z0_0p001 ?? null,
      // no hay veredicto de coincidencia: Marte es un ciclo medio sin ráfagas (cota inferior) y la Tierra es horaria
      advertencia: mcdObj?.viento_advertencia ?? null,
    };
  }

  const filtrosObj = [];
  if (ndviEval != null) {
    const pasa = ndviEval <= 0.3;
    const suf = hechos.evaluacion_zona ? ` · ${hechos.evaluacion_zona.celdas_elegibles}/${hechos.evaluacion_zona.celdas_muestra} celdas elegibles` : '';
    filtrosObj.push({ nombre: 'Vegetación (NDVI)', valor: `${ndviEval.toFixed(2)} (${pasa ? 'pasa filtro ≤ 0.30' : 'supera 0.30 · requiere bajo_vegetacion'}${suf})`, estado: pasa ? 'pasa' : 'alerta' });
  }
  if (aiEval != null) {
    const cat = aiEval < 0.05 ? 'hiperárido' : aiEval < 0.2 ? 'árido' : aiEval < 0.5 ? 'semiárido' : 'húmedo';
    const match = aiEval < 0.2 ? `coincide con ${o.cuerpo === 'luna' ? 'Luna' : 'Marte'} árido` : 'más húmedo que Marte';
    filtrosObj.push({ nombre: 'Aridez (AI)', valor: `${aiEval.toFixed(2)} (${cat} · ${match})`, estado: aiEval < 0.2 ? 'pasa' : 'info' });
  }
  if (permEval != null || magtEval != null || hieloEval != null) {
    filtrosObj.push({ nombre: 'Permafrost / hielo en suelo', valor: `${permEval != null ? `${Math.round(permEval * 100)} % prob.` : 'sin dato'}${magtEval != null ? ` · ${magtEval.toFixed(1)} °C` : ''}${hieloEval != null ? ` · hielo GAM ${hieloEval.toFixed(2)}` : ''}`, estado: (permEval ?? 0) >= 0.5 ? 'pasa' : 'info' });
  }
  if (volcEval != null && volcEval > 0) {
    filtrosObj.push({ nombre: 'Roca volcánica básica', valor: `${Math.round(volcEval * 100)} % (coincide con basalto)`, estado: 'pasa' });
  }
  if ((dunasEval != null && dunasEval > 0) || (arenaEval != null && arenaEval > 0)) {
    const tiposDuna = [
      ['crecientes', valorEn('dunas_creciente_frac', idxEval) ?? 0],
      ['lineales', valorEn('dunas_lineal_frac', idxEval) ?? 0],
      ['estrella', valorEn('dunas_estrella_frac', idxEval) ?? 0],
    ].filter(([, v]) => Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
    const dom = tiposDuna[0] ? ` (predominan ${tiposDuna[0][0]})` : '';
    filtrosObj.push({ nombre: 'Dunas / arena móvil', valor: `dunas ${dunasEval != null ? Math.round(dunasEval * 100) : 0} %${dom} · arena móvil ${arenaEval != null ? Math.round(arenaEval * 100) : 0} %`, estado: 'info' });
  }
  if (aguaEval != null || humEval != null || efimEval != null) {
    const salarTxt = humClaseEval === 32 ? ' · salar/humedal salino (GLWD 32)' : '';
    const efimTxt = efimEval != null && efimEval > 0 ? ` · efímero ${Math.round(efimEval * 100)} %` : '';
    filtrosObj.push({ nombre: 'Agua / salares', valor: `agua ${aguaEval != null ? aguaEval.toFixed(1) : 0} % · humedal ${humEval != null ? humEval.toFixed(1) : 0} %${salarTxt}${efimTxt}`, estado: (aguaEval ?? 0) > 10 ? 'alerta' : 'info' });
  }
  if (slp15Eval != null || cieloEval != null) {
    filtrosObj.push({
      nombre: 'Terreno operativo / luz',
      valor: `${slp15Eval != null ? `${Math.round(slp15Eval * 100)} % pendiente > 15°` : ''}${slp15Eval != null && cieloEval != null ? ' · ' : ''}${cieloEval != null ? `cielo visible ${Math.round(cieloEval * 100)} %` : ''}`,
      estado: (slp15Eval ?? 0) > 0.3 ? 'alerta' : 'pasa',
    });
  }
  if (dodEval != null || vientoEval != null) {
    filtrosObj.push({ nombre: 'Polvo / viento', valor: `polvo ${dodEval != null ? dodEval.toFixed(1) : '—'} % · viento arena ${vientoEval != null ? Math.round(vientoEval * 100) : '—'} %`, estado: 'info' });
  }
  if (filtrosObj.length) hechos.filtros = filtrosObj;
  return hechos;
}

/** Plantilla por defecto: texto determinista con los datos reales (funciona sin clave ni red). */
export function plantilla(h) {
  const L = [];
  const donde = `**${h.nombre ? `${h.nombre} (${h.id})` : h.etiqueta}** está en ${h.lugar} (${h.lat.toFixed(3)}°, ${h.lon.toFixed(3)}°); el área marcada es un círculo de ${h.radio_km} km.`;
  L.push(donde);
  if (!h.objetivo) {
    if (h.resumen_del_sitio) L.push(h.resumen_del_sitio);
    if (h.descripcion_del_sitio) L.push(h.descripcion_del_sitio);
    L.push(`Es un análogo ${h.estado} (fuente: ${h.fuente}, ${h.fecha}). No tiene un sitio objetivo asociado, así que el motor no calcula un porcentaje de parecido para él.`);
    if (h.pares_i26?.length) {
      const CERT = { C: 'confirmado', P: 'probable' };
      const pares = h.pares_i26.map((q) => `${q.nombre ?? q.sl} (${q.sl}${q.subzona ? `, ${q.subzona}` : ''}; ${q.categoria}, ${CERT[q.certeza] ?? q.certeza})`);
      L.push(`Según la literatura reunida en I-26, se usa como análogo de ${pares.join(', ')}.`);
    }
    if (h.minerales) L.push('**Minerales y roca**\n' + resumenMinerales(h.minerales).map((x) => `- ${x}`).join('\n'));
    L.push('_Ensayo: la analogía se mide con datos de superficie; no compara gravedad, atmósfera ni presión._');
    return L.join('\n\n');
  }
  const o = h.objetivo;
  const cuerpo = CUERPO[o.cuerpo] ?? o.cuerpo;
  let parecido = `Se parece a **${o.nombre}** (${o.id}, en ${cuerpo})`;
  if (h.parecido_motor_pct != null) parecido += ` con un parecido de **${h.parecido_motor_pct} %** según el motor`;
  if (h.aparece_en_pct_escenarios != null) parecido += ` y salió entre los mejores en el **${h.aparece_en_pct_escenarios} %** de los escenarios probados`;
  L.push(parecido + '.');
  if (h.variables?.length) {
    const si = h.variables.filter((v) => v.coincide === true), no = h.variables.filter((v) => v.coincide === false);
    const lin = (v) => `${v.nombre}: aquí ${fmt(v.aqui)}${v.unidad}, el objetivo ${fmt(v.objetivo)}${v.unidad} (tolerancia ±${fmt(v.tolerancia)}${v.unidad}; ${v.coincide ? 'dentro de la tolerancia' : `${v.direccion} que el objetivo, a ${v.veces_tolerancia}× la tolerancia`})`;
    if (si.length) L.push('**En qué coincide**\n' + si.map((v) => `- ${lin(v)}`).join('\n'));
    if (no.length) L.push('**En qué difiere**\n' + no.map((v) => `- ${lin(v)}${v.el_objetivo_supera_la_tierra ? ' — ' + v.el_objetivo_supera_la_tierra : ''}`).join('\n'));
    const sin = h.variables.filter((v) => v.coincide === null);
    if (sin.length) L.push(`Sin dato en la celda más cercana: ${sin.map((v) => v.nombre).join(', ')}.`);
    L.push(`_Valores leídos en la celda de la tabla maestra más cercana al centro (a ${h.celda_distancia_km} km). Que difiera no es un error: significa que el valor cae fuera del margen de tolerancia del objetivo._`);
  }
  if (h.corrida || h.aparece_en_n != null) L.push('_El porcentaje del motor sale de escenarios con distintos subconjuntos de variables; el detalle usa el perfil base completo, así que puede mostrar diferencias que algunos escenarios no consideran._');
  if (h.minerales) L.push('**Minerales y roca**\n' + resumenMinerales(h.minerales).map((x) => `- ${x}`).join('\n'));
  if (h.filtros?.length) L.push('**Filtros ambientales y operativos**\n' + h.filtros.map((x) => `- ${x.nombre}: ${x.valor}`).join('\n'));
  if (h.viento_shields) {
    const vs = h.viento_shields;
    if (vs.cuerpo === 'marte' && vs.marte_arrastre_pct != null) {
      L.push(`**Viento por umbral de arrastre (I-28, Shields)**\n- Fracción del tiempo que mueve arena (100–200 µm): aquí **${vs.tierra_arrastre_pct ?? '—'} %** (τ > 0,05 Pa, MERRA-2) frente a **al menos ${vs.marte_arrastre_pct} %** en ${o.nombre} (τ > 0,01 Pa, Ayoub 2014; ${vs.marte_arrastre_z0_liso_pct} % si la superficie es lisa, z0 0,001 m; τ > 0,005 Pa: ${vs.marte_cota_baja_pct} %; viento medio ${vs.marte_u_media_ms} m/s, máx ${vs.marte_u_max_ms} m/s).
- El dato de Marte sale del ciclo medio de la MCD 6.2, sin ráfagas: es una cota inferior y no se compara 1:1 con la cifra horaria de la Tierra.`);
    } else if (vs.cuerpo === 'luna') {
      L.push(`**Viento por umbral de arrastre (I-28)**\n- Aquí el viento mueve arena el **${vs.tierra_arrastre_pct ?? '—'} %** del tiempo (τ > 0,05 Pa); en la Luna es **0 %** (vacío sin atmósfera).`);
    }
  }
  if (h.polvo_finos?.dod02_pct != null || h.polvo_finos?.fino_lt50_pct != null) {
    const pf = h.polvo_finos;
    L.push(`**Polvo y granulometría (µm)**\n- Polvo suspendido: ${pf.dod02_pct != null ? `${pf.dod02_pct} % días DOD > 0.2` : 'sin dato'}; fracción muy fina (< 50 µm): ${pf.fino_lt50_pct != null ? `${pf.fino_lt50_pct} %` : 'sin dato'}.`);
  }
  L.push('_Ensayo: la analogía se mide con datos de superficie; no compara gravedad, atmósfera ni presión._');
  return L.join('\n\n');
}

// ---------- DeepSeek (opcional) y configuración segura de la clave ----------
const ENV = join(REPO, '.env'); // ignorado por git (.gitignore línea 25)

function leerEnv() {
  const env = {};
  if (existsSync(ENV)) for (const l of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function claveDeepseek() {
  const env = { ...process.env, ...leerEnv() };
  return { clave: env.DEEPSEEK_API_KEY || null, modelo: env.DEEPSEEK_MODEL || 'deepseek-chat', base: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' };
}
export const iaDisponible = () => Boolean(claveDeepseek().clave);

// Voces Aura-2 en español (nombres exactos según la documentación de Deepgram, leída 2026-11-13).
export const VOCES = {
  'aura-2-selena-es': 'Selena · latinoamericana · femenina', 'aura-2-aquila-es': 'Aquila · latinoamericano · masculino',
  'aura-2-celeste-es': 'Celeste · colombiana · femenina', 'aura-2-estrella-es': 'Estrella · mexicana · femenina',
  'aura-2-javier-es': 'Javier · mexicano · masculino', 'aura-2-luciano-es': 'Luciano · mexicano · masculino',
  'aura-2-nestor-es': 'Néstor · peninsular · masculino', 'aura-2-agustina-es': 'Agustina · peninsular · femenina',
  'aura-2-antonia-es': 'Antonia · argentina · femenina', 'aura-2-gloria-es': 'Gloria · colombiana · femenina',
  'aura-2-olivia-es': 'Olivia · mexicana · femenina', 'aura-2-sirio-es': 'Sirio · mexicano · masculino',
  'aura-2-valerio-es': 'Valerio · mexicano · masculino', 'aura-2-alvaro-es': 'Álvaro · peninsular · masculino',
  'aura-2-carina-es': 'Carina · peninsular · femenina', 'aura-2-diana-es': 'Diana · peninsular · femenina',
  'aura-2-silvia-es': 'Silvia · peninsular · femenina',
};
function claveDeepgram() {
  const env = { ...process.env, ...leerEnv() };
  const voz = VOCES[env.DEEPGRAM_VOICE] ? env.DEEPGRAM_VOICE : 'aura-2-selena-es';
  const v = Number(env.DEEPGRAM_SPEED);
  const velocidad = Number.isFinite(v) && v >= 0.8 && v <= 1.4 ? v : 1.15;
  return { clave: env.DEEPGRAM_API_KEY || null, voz, velocidad };
}
export const vozDisponible = () => Boolean(claveDeepgram().clave);

/** Estado de la configuración. Nunca devuelve ninguna clave, ni parte de ella. */
export function estadoConfig() {
  const { clave, modelo } = claveDeepseek();
  const dg = claveDeepgram();
  return { configurada: Boolean(clave), modelo, voz_configurada: Boolean(dg.clave), voz: dg.voz, velocidad: dg.velocidad, voces: VOCES, archivo_env_ignorado_por_git: true };
}

const MODELOS = ['deepseek-chat', 'deepseek-reasoner'];
const FORMATO_CLAVE = /^[A-Za-z0-9_.\-]{16,200}$/;

/** Guarda claves y/o ajustes en .env (conserva las demás líneas). Las claves no se registran ni se devuelven. */
export function guardarConfig({ clave, modelo, clave_deepgram, voz, velocidad }) {
  const cambios = {};
  if (clave !== undefined && clave !== '') {
    if (typeof clave !== 'string' || !FORMATO_CLAVE.test(clave)) throw new Error('la clave de DeepSeek no tiene un formato válido (16 a 200 caracteres, sin espacios)');
    cambios.DEEPSEEK_API_KEY = clave;
  }
  if (modelo !== undefined) {
    if (!MODELOS.includes(modelo)) throw new Error(`modelo no permitido; usa uno de: ${MODELOS.join(', ')}`);
    cambios.DEEPSEEK_MODEL = modelo;
  }
  if (clave_deepgram !== undefined && clave_deepgram !== '') {
    if (typeof clave_deepgram !== 'string' || !FORMATO_CLAVE.test(clave_deepgram)) throw new Error('la clave de Deepgram no tiene un formato válido (16 a 200 caracteres, sin espacios)');
    cambios.DEEPGRAM_API_KEY = clave_deepgram;
  }
  if (voz !== undefined) {
    if (!VOCES[voz]) throw new Error('voz no permitida');
    cambios.DEEPGRAM_VOICE = voz;
  }
  if (velocidad !== undefined) {
    const v = Number(velocidad);
    if (!Number.isFinite(v) || v < 0.8 || v > 1.4) throw new Error('velocidad fuera de [0,8 – 1,4]');
    cambios.DEEPGRAM_SPEED = v;
  }
  escribirEnv(cambios);
  return estadoConfig();
}
export function borrarClave(cual = 'deepseek') {
  if (!['deepseek', 'deepgram'].includes(cual)) throw new Error('cuál clave: deepseek o deepgram');
  escribirEnv({ [cual === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'DEEPSEEK_API_KEY']: null });
  return estadoConfig();
}
function escribirEnv(cambios) {
  const lineas = existsSync(ENV) ? readFileSync(ENV, 'utf8').split(/\r?\n/) : [];
  const pendientes = { ...cambios };
  const salida = [];
  for (const l of lineas) {
    const k = l.match(/^\s*([A-Z_]+)\s*=/)?.[1];
    if (k && k in pendientes) { if (pendientes[k] !== null) salida.push(`${k}=${pendientes[k]}`); delete pendientes[k]; }
    else if (l !== '' || salida.length) salida.push(l);
  }
  for (const [k, v] of Object.entries(pendientes)) if (v !== null) salida.push(`${k}=${v}`);
  writeFileSync(ENV, salida.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

async function llamarDeepseek(mensajes, maxTokens = 700) {
  const { clave, modelo, base } = claveDeepseek();
  if (!clave) throw new Error('No hay clave de DeepSeek: guárdala en la pestaña Ajustes');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
    body: JSON.stringify({ model: modelo, temperature: 0.2, max_tokens: maxTokens, messages: mensajes }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`DeepSeek respondió ${r.status}: ${j.error?.message ?? 'sin detalle'}`);
  const t = j.choices?.[0]?.message?.content;
  if (!t) throw new Error('DeepSeek no devolvió texto');
  return { texto: t.trim(), modelo };
}

const SISTEMA = `Explicas a cualquier persona, sin jerga, por qué un lugar de la Tierra se parece a un sitio de la Luna o de Marte.
Reglas: usa SOLO los datos del JSON; no inventes cifras, nombres ni causas; si algo falta di "no disponible".
Español sencillo, 120 a 180 palabras, en este orden: dónde está (lugar y país), a qué se parece y cuánto (porcentajes del JSON),
en qué coincide (con los números), en qué difiere (con los números) y una frase final: es un ensayo y no se compara gravedad ni atmósfera.
Usa los nombres de variables del JSON en palabras comunes.
Dirección de voz (opcional, el usuario NO la ve): puedes insertar marcas entre frases: [pausa], [pausa larga], [lento], [suave], [animado], [normal].
Tono enérgico y cercano, como quien cuenta algo interesante: abre con [animado], usa [animado] en los hallazgos y las coincidencias, [lento] solo para una cifra clave y [suave] solo para la advertencia final. Frases cortas y con ritmo; [pausa] breve, [pausa larga] solo entre secciones.
Una marca de ritmo vale hasta la siguiente. Úsalas con moderación (una cada dos o tres frases), nunca las menciones ni las expliques.`;

// El texto que se muestra sale sin marcas; las marcas viajan aparte en `guion` (solo para la voz).
const conGuion = (r) => ({ ...aGuion(r.texto), modelo: r.modelo });
export const textoConIA = async (hechos) => conGuion(await llamarDeepseek([{ role: 'system', content: SISTEMA }, { role: 'user', content: JSON.stringify(hechos) }]));

const HERRAMIENTAS_CHAT = [
  {
    type: 'function',
    function: {
      name: 'analizar_zona_mapa',
      description: 'Analiza directamente las celdas de la tabla maestra dentro de la zona/cuadro/polígono seleccionado en el mapa (sin importar si es pequeño < 40 000 km²): evalúa los 21 objetivos Luna/Marte (estándar y bajo_vegetacion), casos de uso (rover, aterrizaje, terreno accidentado, hielo), filtros ambientales, cuevas y cráteres cercanos.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_objetivos',
      description: 'Lista los sitios objetivo (SL-NN de Luna y Marte) y sus perfiles disponibles.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_areas',
      description: 'Lista áreas análogas del mapa (hallado, candidato o nuevo). Filtro opcional por grupo y objetivo. Máximo `limite` (por defecto 25).',
      parameters: {
        type: 'object',
        properties: {
          grupo: { type: 'string', enum: ['hallado', 'candidato', 'nuevo'] },
          objetivo: { type: 'string', description: 'Filtrar por ID de objetivo, p. ej. SL-12' },
          limite: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_area',
      description: 'Devuelve los datos completos de un área por su id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explicar_area',
      description: 'Obtiene los hechos reales, variables comparadas, rigor científico (medido/modelado/supuesto) y solidez del ajuste de un área.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'historial_corridas',
      description: 'Devuelve el registro de corridas previas (objetivo, perfil, variables, pesos, factores, ndvi_max, área y cantidad de hallazgos) para no repetir configuraciones y recomendar variantes nuevas.',
      parameters: { type: 'object', properties: { limite: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estado_busqueda',
      description: 'Consulta el estado de una búsqueda lanzada por id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proponer_busqueda',
      description: 'GUARDA OBLIGATORIA: valida parámetros y crea una tarjeta de confirmación en el chat para que la persona apruebe correr el motor Rust (pipeline.exe). Soporta variables, pesos, factores, ndvi_max, área (bbox/polígono), k_area y min_area_km2, y modo exploratorio/aleatorio si antes no hubo resultados.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título corto en español simple para la tarjeta' },
          explicacion_simple: { type: 'string', description: 'Qué va a buscar y qué variables compara en lenguaje no técnico' },
          rigor_cientifico: { type: 'string', description: 'Nivel de rigor esperado (qué es medido, modelado o supuesto, y qué no compara)' },
          es_exploracion_creativa: { type: 'boolean', description: 'true si relaja filtros o prueba combinaciones aleatorias fuera de la guarda normal' },
          objetivo: { type: 'string', description: 'ID del sitio objetivo, p. ej. SL-12' },
          perfil: { type: 'string', description: 'Perfil de variables (terreno_termico, bajo_vegetacion, etc.)' },
          variables: { type: 'array', items: { type: 'string' }, description: 'Subconjunto de variables del perfil' },
          pesos: { type: 'object', additionalProperties: { type: 'number' }, description: 'Pesos 0..10 por variable' },
          factores: { type: 'array', items: { type: 'number' }, description: 'Factores de tolerancia, p. ej. [0.5, 1, 2]' },
          candidatos: { type: 'number', description: 'Cantidad de candidatos (1..200)' },
          radio_km: { type: 'number', description: 'Radio de búsqueda en km (5..500)' },
          ndvi_max: { type: 'number', description: 'Tope NDVI (0..1; 1 incluye bosque)' },
          area: { type: 'object', description: 'Opcional: {tipo:"bbox", bbox:[lat1,lon1,lat2,lon2]} o {tipo:"poligono", anillo:[[lon,lat],...]}' },
          k_area: { type: 'number' },
          min_area_km2: { type: 'number' },
        },
        required: ['titulo', 'explicacion_simple', 'rigor_cientifico', 'objetivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proponer_barrido',
      description: 'GUARDA OBLIGATORIA: propone un barrido masivo de múltiples escenarios para que la persona lo apruebe en tarjeta antes de ejecutarse.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          explicacion_simple: { type: 'string' },
          rigor_cientifico: { type: 'string' },
          excluir_km: { type: 'number' },
          max_escenarios: { type: 'number' },
        },
        required: ['titulo', 'explicacion_simple', 'rigor_cientifico'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proponer_guardar_area',
      description: 'GUARDA OBLIGATORIA: propone guardar un hallazgo candidato en indice_hallazgos.json previa aprobación en tarjeta.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          lat: { type: 'number' },
          lon: { type: 'number' },
          radio_km: { type: 'number' },
          fuente: { type: 'string' },
          etiqueta: { type: 'string' },
          resumen: { type: 'string' },
        },
        required: ['id', 'lat', 'lon', 'radio_km', 'fuente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'controlar_mapa',
      description: 'Controla el globo 3D del visor: enfocar un área, volar a coordenadas, o prender/apagar las capas de Cuevas (50) y Cráteres (202).',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['enfocar_area', 'volar', 'capa_cuevas', 'capa_crateres'] },
          id: { type: 'string', description: 'ID del área para enfocar_area' },
          lat: { type: 'number' },
          lon: { type: 'number' },
          visible: { type: 'boolean', description: 'Para capa_cuevas o capa_crateres' },
        },
        required: ['tipo'],
      },
    },
  },
];

async function llamarDeepseekConHerramientas(mensajes, ejecutar, maxTokens = 700, maxRondas = 5) {
  const { clave, modelo, base } = claveDeepseek();
  if (!clave) throw new Error('No hay clave de DeepSeek: guárdala en la pestaña Ajustes');
  const historial = [...mensajes];
  for (let ronda = 0; ronda < maxRondas; ronda++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: historial,
        tools: HERRAMIENTAS_CHAT,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`DeepSeek respondió ${r.status}: ${j.error?.message ?? 'sin detalle'}`);
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error('DeepSeek no devolvió respuesta');
    const calls = msg.tool_calls;
    if (!Array.isArray(calls) || !calls.length) {
      const t = msg.content;
      if (!t) throw new Error('DeepSeek no devolvió texto');
      return { texto: t.trim(), modelo };
    }
    historial.push(msg);
    for (const tc of calls) {
      let args = {};
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = {}; }
      let salida;
      try { salida = await ejecutar(tc.function?.name, args); } catch (e) { salida = { error: String(e?.message ?? e) }; }
      historial.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(salida) });
    }
  }
  throw new Error('Se alcanzó el límite de llamadas a herramientas del motor');
}

const SISTEMA_CHAT = `Eres el guía científico y asistente del visor de análogos del equipo J4Ks (NASA Space Apps 2026).
Reglas de rigor y guarda:
1. CERO INVENTOS: apóyate SOLO en los datos reales del JSON y de tus herramientas. Si un dato falta, di "no disponible" o "no verificado".
2. EDUCATIVO Y COMPLETO (NO SOLO VARIABLES): habla en español claro, sin jerga innecesaria. Al explicar un área, NO te limites a las variables del puntaje: explica también su **composición de roca y minerales** (\`minerales\`), sus **filtros ambientales y operativos** (\`filtros\`: permafrost/hielo en suelo, aridez, NDVI, tipo de dunas, salares/agua, pendiente > 15°, cielo visible) y su **polvo suspendido y granulometría en µm** (\`polvo_finos\`). Distingue qué es medido directamente, qué viene de modelo climático y qué es supuesto; recuerda que el motor NO compara gravedad, atmósfera ni radiación, y que los candidatos nuevos están sin verificar en campo.
3. PREGUNTA ANTES DE CORRER: si la persona pide algo amplio o ambiguo (ej. "entrenar un rover", "ensayar aterrizajes", "establecer una colonia", "buscar refugio"), haz 1 o 2 preguntas sencillas (Luna o Marte, toda la Tierra o alguna región) si aún no están claras; cuando tengas lo necesario, usa \`proponer_busqueda\` / \`proponer_barrido\` para que aparezca la tarjeta de confirmación con la guarda antes de ejecutar el motor.
4. ESCENARIOS PREFABRICADOS: traduce intenciones humanas a parámetros reales tras consultar \`listar_objetivos\`:
   - Entrenar un rover -> prioriza pendiente, rugosidad, relieve y suelo/arena.
   - Ensayar aterrizajes -> prioriza pendiente baja, rugosidad baja y cielo visible.
   - Establecer una colonia / base -> prioriza temperatura, agua/hielo o permafrost y terreno; puedes sugerir encender la capa de Cuevas (50) o Cráteres (202) con \`controlar_mapa\`.
5. MODO CREATIVO SI NO ENCUENTRA: si una búsqueda o filtro da 0 resultados, propón ideas creativas fuera de la guarda con combinaciones exploratorias/aleatorias (ej. subir \`ndvi_max\` a 0.8 o 1, ampliar \`factores\` a [0.5, 1, 2, 3], o sortear un subconjunto distinto de variables), marcando \`es_exploracion_creativa: true\` y advirtiendo que es exploración experimental.
6. NO REPETIR CORRIDAS: revisa \`historial_reciente\` en DATOS (o usa \`historial_corridas\`) para ver qué pesos, variables, filtros y áreas ya se probaron; si la persona quiere lanzar más corridas, recomienda pesos/filtros/variables distintos para no repetir. Los barridos tienen tope de ${MAX_ESCENARIOS_CORRIDA} escenarios por corrida y máx ${MAX_CORRIDAS_BARRIDO} corridas (${MAX_ESCENARIOS_BARRIDO} en total).
7. MAPA 3D: usa \`controlar_mapa\` cuando convenga mostrar un área en el globo o encender/apagar Cuevas (50) o Cráteres (202).
8. RANKINGS: \`ranking_activo\` en DATOS trae el ranking actual (perfil, top_actual y rankings guardados). Si preguntan cuáles son los mejores sitios de su ranking o por qué están ahí, usa \`explicar_area\` sobre los mejores IDs para explicar todas sus variables reales, polvo/granulometría, minerales y rasgos cercanos.
9. ZONA DIBUJADA EN EL MAPA: si \`zona_mapa\` está presente en DATOS y preguntan por esa zona (si sirve para rover, aterrizaje, terreno accidentado, a qué sitio de Luna/Marte se parece o qué hay dentro), llama primero a \`analizar_zona_mapa\` para medir sus celdas reales, filtros, cuevas y cráteres sin recorrer todo el planeta; y si quieren lanzar \`pipeline.exe\` solo dentro de esa zona (con \`proponer_busqueda\`), incluye el polígono de \`zona_mapa\` como \`area\` y avisa si es menor de 40 000 km² (se requerirá \`min_area_km2: 0\`, aunque \`pipeline.exe\` pide al menos 4 regiones HEALPix nivel 6).
10. VIENTO POR UMBRAL DE ARRASTRE (I-28, SHIELDS): usa siempre \`viento_shields\` para hablar del viento. Nunca compares m/s directos entre la Tierra y Marte (la atmósfera de Marte es ~100 veces menos densa). Da \`tierra_arrastre_pct\` (% de horas con τ > 0,05 Pa en MERRA-2, umbral de impacto para arena de 100–200 µm) y \`marte_arrastre_pct\` (% con τ > 0,01 Pa, Ayoub 2014) como **cota inferior**, con el rango \`marte_arrastre_z0_liso_pct\` (superficie lisa). Di siempre que el dato de Marte es el ciclo medio del modelo MCD 6.2, sin ráfagas ni tormentas, y que por eso **no se puede afirmar que coincidan ni que difieran**: solo si la Tierra mueve arena más o menos seguido que esa cota. En la Luna es 0 % (no hay atmósfera).
Respuestas concisas (máx. 170 palabras) salvo que pidan detalle. Dirección de voz opcional ([pausa], [lento], [suave], [animado], [normal]) con moderación.`;

/** Inyecta el polígono de la zona del mapa en `proponer_busqueda`, o rechaza si es menor al piso de pipeline.exe. */
export function prepararArgsBusquedaConZona(args, zonaMapa) {
  if (args?.area || !zonaMapa?.coords || zonaMapa.coords.length < 3) return args;
  if ((zonaMapa.area_km2 ?? 0) < 15000) {
    throw new Error(`La zona seleccionada (${(zonaMapa.area_km2 ?? 0).toFixed(1)} km²) es demasiado pequeña para pipeline.exe (exige >= 4 regiones HEALPix nivel 6). Usa analizar_zona_mapa para evaluarla al instante sin error.`);
  }
  const src = zonaMapa.coords;
  const paso = src.length > 180 ? Math.ceil(src.length / 180) : 1;
  const anillo = src.filter((_, i) => i % paso === 0).map((c) => [Number(c.lon), Number(c.lat)]);
  return {
    ...args,
    area: { tipo: 'poligono', anillo, nombre: zonaMapa.nombre },
    ...(args?.min_area_km2 === undefined ? { min_area_km2: 0 } : {}),
  };
}

/** Chat con contexto, herramientas de lectura/mapa, ranking activo, zona dibujada y guarda previa para acciones del motor. */
export async function chat(mensajes, { areaId, ranking = null, zonaMapa = null } = {}) {
  if (!Array.isArray(mensajes) || !mensajes.length || mensajes.length > 20) throw new Error('entre 1 y 20 mensajes');
  const limpios = mensajes.map((m) => {
    if (!['user', 'assistant'].includes(m.rol) || typeof m.texto !== 'string' || m.texto.length > 2000) throw new Error('mensaje inválido');
    return { role: m.rol, content: m.texto };
  });
  if (limpios.at(-1).role !== 'user') throw new Error('el último mensaje debe ser del usuario');
  const resumen = listarAreas().reduce((a, x) => ((a[x.grupo] = (a[x.grupo] ?? 0) + 1), a), {});
  const ctx = {
    areas_en_el_mapa: resumen,
    area_seleccionada: areaId ? await hechosDeArea(areaId) : null,
    zona_mapa: zonaMapa ? { id: zonaMapa.id, nombre: zonaMapa.nombre, area_km2: zonaMapa.area_km2, n_vertices: zonaMapa.coords?.length ?? 0 } : null,
    ranking_activo: ranking,
    historial_reciente: listarHistorialCorridas(12),
  };
  let propuesta = null;
  const accionesMapa = [];
  const ejecutar = async (nombre, args) => {
    if (nombre === 'analizar_zona_mapa') {
      if (!zonaMapa?.coords?.length) return { error: 'no hay ninguna zona dibujada o seleccionada en el mapa' };
      return analizarZonaMapa(zonaMapa);
    }
    if (nombre === 'listar_objetivos') return listarObjetivos();
    if (nombre === 'historial_corridas') return listarHistorialCorridas(Math.max(1, Math.min(50, Number(args.limite ?? 20) || 20)));
    if (nombre === 'listar_areas') {
      const lim = Math.max(1, Math.min(50, Number(args.limite ?? 25) || 25));
      let lista = listarAreas({ grupo: args.grupo });
      if (args.objetivo) lista = lista.filter((a) => a.objetivo === args.objetivo);
      return lista.slice(0, lim);
    }
    if (nombre === 'obtener_area') return obtenerArea(args.id) ?? { error: 'área no encontrada' };
    if (nombre === 'explicar_area') return (await hechosDeArea(args.id)) ?? { error: 'área no encontrada' };
    if (nombre === 'estado_busqueda') return estadoBusqueda(args.id) ?? { error: 'búsqueda no encontrada' };
    if (nombre === 'proponer_busqueda') {
      const argsConZona = prepararArgsBusquedaConZona(args, zonaMapa);
      const params = normalizarParams(argsConZona);
      propuesta = {
        tipo: 'busqueda',
        titulo: String(args.titulo || `Búsqueda contra ${params.objetivo}`),
        explicacion_simple: String(args.explicacion_simple || ''),
        rigor_cientifico: String(args.rigor_cientifico || ''),
        es_exploracion_creativa: Boolean(args.es_exploracion_creativa),
        params,
      };
      return { ok: true, pendiente_confirmacion_usuario: true, params_validados: params };
    }
    if (nombre === 'proponer_barrido') {
      const params = {
        excluir_km: Math.max(0, Math.min(500, Number(args.excluir_km ?? 500) || 500)),
        max_escenarios: Math.max(1, Math.min(MAX_ESCENARIOS_BARRIDO, Number(args.max_escenarios ?? MAX_ESCENARIOS_BARRIDO) || MAX_ESCENARIOS_BARRIDO)),
      };
      propuesta = {
        tipo: 'barrido',
        titulo: String(args.titulo || 'Barrido múltiple de escenarios'),
        explicacion_simple: String(args.explicacion_simple || ''),
        rigor_cientifico: String(args.rigor_cientifico || ''),
        es_exploracion_creativa: false,
        params,
      };
      return { ok: true, pendiente_confirmacion_usuario: true, params_validados: params };
    }
    if (nombre === 'proponer_guardar_area') {
      const entrada = { ...args, estado: 'candidato-sin-verificar', fecha: new Date().toISOString().slice(0, 10), origen: 'chat' };
      const errs = validarIndice([entrada]);
      if (errs.length) throw new Error(errs.join('; '));
      propuesta = {
        tipo: 'guardar_area',
        titulo: `Guardar hallazgo ${entrada.id}`,
        explicacion_simple: String(args.resumen || `Guardar ${entrada.etiqueta ?? entrada.id} en el índice de hallazgos.`),
        rigor_cientifico: 'Se guarda como candidato-sin-verificar; requiere validación independiente.',
        es_exploracion_creativa: false,
        params: entrada,
      };
      return { ok: true, pendiente_confirmacion_usuario: true };
    }
    if (nombre === 'controlar_mapa') {
      accionesMapa.push(args);
      return { ok: true, accion_encolada: args };
    }
    return { error: `herramienta desconocida: ${nombre}` };
  };
  const resp = await llamarDeepseekConHerramientas(
    [{ role: 'system', content: `${SISTEMA_CHAT}\n\nDATOS:\n${JSON.stringify(ctx)}` }, ...limpios],
    ejecutar,
    1200
  );
  return {
    ...conGuion(resp),
    ...(propuesta ? { propuesta } : {}),
    ...(accionesMapa.length ? { acciones_mapa: accionesMapa } : {}),
  };
}

/**
 * Top de candidatos multivariable ya cargados (barrido b1: 200 escenarios con subconjuntos de variables distintos).
 * Orden: en cuántos escenarios aparece (de 200), luego a cuántos sitios objetivo se parece.
 */
export async function topMultivariable(n = 3) {
  const b1 = todasAreas().filter((a) => a.grupo === 'candidato' && a.id.startsWith('HZ-b1-'));
  b1.sort((x, y) => (y.aparece_en - x.aparece_en) || (Object.keys(y.objetivos ?? {}).length - Object.keys(x.objetivos ?? {}).length));
  return Promise.all(b1.slice(0, Math.max(1, Math.min(10, n))).map(async (p, i) => {
    const lugar = await lugarDe(p.lat, p.lon);
    const [principal, veces] = Object.entries(p.objetivos ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return {
      puesto: i + 1, id: p.id, lat: p.lat, lon: p.lon, lugar: lugar.texto, apariciones: p.aparece_en, escenarios: 200,
      n_objetivos: Object.keys(p.objetivos ?? {}).length, objetivo: principal, objetivo_nombre: p.objetivo_nombre ?? null, veces_objetivo: veces,
    };
  }));
}

export async function explicar(id, { ia = false } = {}) {
  const hechos = await hechosDeArea(id);
  if (!hechos) return null;
  const md = plantilla(hechos);
  const salida = { id, hechos, plantilla: md, plantilla_guion: guionDesdePlantilla(md), ia: null, ia_disponible: iaDisponible(), voz_disponible: vozDisponible(), aviso: null };
  if (ia) {
    try { salida.ia = await textoConIA(hechos); } catch (e) { salida.aviso = String(e.message ?? e); }
  }
  return salida;
}

// ---------- Voz (Deepgram Aura-2) ----------
/** Sintetiza un trozo corto. Devuelve { audio: Buffer, tipo }. La clave nunca sale de este proceso. */
export async function hablar(texto, ritmo = 'normal') {
  const { clave, voz, velocidad } = claveDeepgram();
  if (!clave) throw new Error('No hay clave de Deepgram: guárdala en la pestaña Ajustes');
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 1800) throw new Error('texto inválido (1 a 1800 caracteres)');
  const speed = Number(Math.min(1.5, (RITMOS[ritmo] ?? 1) * velocidad).toFixed(2)); // la doc admite 0.7–1.5
  const pedir = async (conSpeed) => fetch(`https://api.deepgram.com/v1/speak?model=${voz}&encoding=mp3${conSpeed && speed !== 1 ? `&speed=${speed}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${clave}` },
    body: JSON.stringify({ text: texto }),
    signal: AbortSignal.timeout(30000),
  });
  let r = await pedir(true);
  // "speed" no está soportado en todos los idiomas: si la API lo rechaza, se repite sin él.
  if (r.status === 400 && speed !== 1) r = await pedir(false);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Deepgram respondió ${r.status}: ${j.err_msg ?? j.error ?? 'sin detalle'}`);
  }
  return { audio: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') ?? 'audio/mpeg' };
}
