// Núcleo del puente motor <-> mapa. ENSAYO (ADR-005): no es parte de la entrega.
// Una sola lógica; servidor.mjs (HTTP para el visor) y mcp.mjs (IA) solo la envuelven.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(AQUI, '..', '..');
export const RUN = process.env.ANALOGOS_RUN || 'D:/PP/ANALOGOS-run';
const BARRIDOS = join(REPO, 'motor/escenarios/barridos-2026-11-13');
export const RUTAS = {
  indice43: join(BARRIDOS, 'indice_43.json'),
  hallazgos: join(AQUI, 'indice_hallazgos.json'),
  pipeline: join(REPO, 'motor/target/release/pipeline.exe'),
  analogos: process.env.ANALOGOS_ANALOGOS || join(RUN, 'etl/analogos/analogos.json'),
  maestro: process.env.ANALOGOS_MAESTRO || join(RUN, 'etl/maestro'),
  busquedas: join(RUN, 'motor/ui'),
  // Perfil «bajo vegetación» (ensayo): forma, roca y permafrost, lo que se mide a través del bosque.
  // Lo arma scripts/barridos/perfil_bajo_vegetacion.py; si no existe, el perfil no se ofrece.
  analogosBV: join(RUN, 'motor/bajo_vegetacion/analogos_bv.json'),
};

/** Perfiles que viven en otro analogos.json: perfil -> ruta. */
export const PERFILES_EXTRA = { bajo_vegetacion: RUTAS.analogosBV };
/** analogos.json que trae el perfil pedido. */
export const analogosDe = (perfil) => (PERFILES_EXTRA[perfil] && existsSync(PERFILES_EXTRA[perfil]) ? PERFILES_EXTRA[perfil] : RUTAS.analogos);

export const ESTADOS = ['documentado', 'verificado_remoto', 'verificado_campo', 'candidato-sin-verificar'];
const leer = (r) => JSON.parse(readFileSync(r, 'utf8'));

/** Valida un índice: esquema, rangos, ids únicos. Devuelve lista de errores (vacía = ok). */
export function validarIndice(entradas) {
  const errs = [];
  if (!Array.isArray(entradas)) return ['el índice debe ser un arreglo'];
  const ids = new Set();
  entradas.forEach((e, i) => {
    const p = `[${i}] ${e?.id ?? '?'}`;
    if (typeof e.id !== 'string' || !e.id) errs.push(`${p}: falta id`);
    else if (ids.has(e.id)) errs.push(`${p}: id repetido`);
    else ids.add(e.id);
    if (!(e.lat >= -90 && e.lat <= 90)) errs.push(`${p}: lat fuera de rango`);
    if (!(e.lon >= -180 && e.lon <= 180)) errs.push(`${p}: lon fuera de rango`);
    if (!(e.radio_km > 0 && e.radio_km <= 1000)) errs.push(`${p}: radio_km inválido`);
    if (!ESTADOS.includes(e.estado)) errs.push(`${p}: estado '${e.estado}' no válido`);
    if (!e.fuente) errs.push(`${p}: falta fuente`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fecha ?? '')) errs.push(`${p}: fecha AAAA-MM-DD`);
  });
  return errs;
}

function cargarHallazgos() {
  return existsSync(RUTAS.hallazgos) ? leer(RUTAS.hallazgos) : [];
}

function cargarBusquedas() {
  const salida = [];
  if (!existsSync(RUTAS.busquedas)) return salida;
  for (const d of readdirSync(RUTAS.busquedas)) {
    const f = join(RUTAS.busquedas, d, 'areas.json');
    if (existsSync(f)) salida.push(...leer(f));
  }
  return salida;
}

/** Grupo de color: 'hallado' (azul) | 'candidato' (ámbar) | 'nuevo' (magenta). */
function grupoDe(e) {
  if (e.origen === 'busqueda') return 'nuevo';
  return e.estado === 'candidato-sin-verificar' ? 'candidato' : 'hallado';
}

// ---------- nombres legibles ----------
let _sitios = null;
const sitios = () => (_sitios ??= leer(join(REPO, 'scripts/etl/sitios.json')));
const nombreObjetivo = (id) => (sitios().luna?.[id] ?? sitios().marte?.[id])?.nombre ?? null;
const _fichas = new Map();

/** Ficha de un sitio terrestre documentado (ST-NN): nombre, resumen y párrafo de ubicación de su nota en contexto/. */
export function fichaSitio(id) {
  if (_fichas.has(id)) return _fichas.get(id);
  const dir = join(REPO, 'contexto/32-sitios');
  let r = null;
  const archivo = existsSync(dir) ? readdirSync(dir).find((n) => n.startsWith(id + '-') && n.endsWith('.md')) : null;
  if (archivo) {
    const t = readFileSync(join(dir, archivo), 'utf8');
    const resumen = t.match(/^summary:\s*"(.*)"\s*$/m)?.[1] ?? null;
    const ubic = t.match(/## Ubicación y área\s+([^\n]+(?:\n(?!\n)[^\n]+)*)/)?.[1]?.trim() ?? null;
    const url = t.match(/-\s*url:\s*(\S+)/)?.[1] ?? null;
    r = { resumen, ubicacion: ubic, fuente_url: url, nota: `contexto/32-sitios/${archivo}` };
  }
  _fichas.set(id, r);
  return r;
}

/** Agrega nombre del sitio, nombre del objetivo y una etiqueta legible a cada entrada. */
function enriquecer(e) {
  const x = { ...e };
  const st = sitios().tierra?.[e.id];
  if (st) {
    x.nombre = st.nombre;
    x.etiqueta = `${e.id} · ${st.nombre}`;
    const f = fichaSitio(e.id);
    x.resumen = e.resumen ?? f?.resumen ?? 'Análogo terrestre documentado';
    x.ubicacion = f?.ubicacion ?? null;
    x.nota = f?.nota ?? null;
    x.fuente_url = f?.fuente_url ?? null;
    // Pares de I-26 (P-035): a qué sitios SL imita según la literatura; no cambia el puntaje ni la confianza.
    if (Array.isArray(st.analogo_de)) {
      x.pares_i26 = st.analogo_de.flatMap((a) => a.objetivos_sl.map((sl) => ({ sl, nombre: nombreObjetivo(sl), categoria: a.categoria, certeza: a.certeza, ...(a.subzona ? { subzona: a.subzona } : {}) })));
    }
  }
  if (e.objetivo) x.objetivo_nombre = nombreObjetivo(e.objetivo);
  return x;
}

export function todasAreas() {
  return [...leer(RUTAS.indice43), ...cargarHallazgos(), ...cargarBusquedas()].map((e) => ({
    ...enriquecer(e),
    grupo: grupoDe(e),
  }));
}

function todas() {
  return todasAreas();
}

/** Pines livianos (sin polígono). */
export function listarAreas({ grupo } = {}) {
  return todas()
    .map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, radio_km: e.radio_km, estado: e.estado,
      grupo: grupoDe(e), etiqueta: e.etiqueta ?? e.id, resumen: e.resumen ?? null,
      nombre: e.nombre ?? null, objetivo: e.objetivo ?? null, objetivo_nombre: e.objetivo_nombre ?? null,
      parecido_pct: (e.s_mediana ?? e.s_max) != null ? Math.round((e.s_mediana ?? e.s_max) * 100) : null }))
    .filter((a) => !grupo || a.grupo === grupo);
}

/** Círculo de `radio_km` como anillo [lon,lat] cerrado (esférico; error <0,5 % a estos radios). */
export function circulo(lat, lon, radioKm, n = 64) {
  const R = 6371.0088, d = radioKm / R, f1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180;
  const anillo = [];
  for (let i = 0; i < n; i++) {
    const b = (2 * Math.PI * i) / n;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    anillo.push([((((l2 * 180) / Math.PI + 540) % 360) - 180), (f2 * 180) / Math.PI]);
  }
  anillo.push(anillo[0]);
  return anillo;
}

/** Detalle de un área como Feature GeoJSON con su polígono (compatible con importCatalogFromObject). */
export function obtenerArea(id) {
  const e = todas().find((x) => x.id === id);
  if (!e) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circulo(e.lat, e.lon, e.radio_km)] },
    properties: { ...e, grupo: grupoDe(e), geometria: 'circulo-desde-radio_km' },
  };
}

/** Agrega/actualiza un hallazgo (solo escribe indice_hallazgos.json; nunca indice_43.json). */
export function agregarArea(e) {
  const nuevo = { estado: 'candidato-sin-verificar', fecha: new Date().toISOString().slice(0, 10), ...e };
  if (nuevo.origen === 'busqueda') nuevo.origen = 'hallazgo-guardado';
  const lista = cargarHallazgos().filter((x) => x.id !== nuevo.id);
  lista.push(nuevo);
  const errs = validarIndice([...leer(RUTAS.indice43), ...lista]);
  if (errs.length) throw new Error('índice inválido: ' + errs.join('; '));
  writeFileSync(RUTAS.hallazgos, JSON.stringify(lista, null, 1) + '\n');
  return nuevo;
}

/** Mueve las búsquedas nuevas (motor/ui/) a un respaldo con fecha para limpiar el mapa sin perder datos. */
export function limpiarBusquedas() {
  if (activo) throw new Error(`hay una corrida en curso (${activo}); espera a que termine`);
  if (!existsSync(RUTAS.busquedas)) return { movidas: 0, respaldo: null };
  const dirs = readdirSync(RUTAS.busquedas, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  if (!dirs.length) return { movidas: 0, respaldo: null };
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const respaldo = join(RUN, 'motor', `respaldo-${sello}`, 'ui');
  mkdirSync(respaldo, { recursive: true });
  for (const name of dirs) {
    renameSync(join(RUTAS.busquedas, name), join(respaldo, name));
  }
  return { movidas: dirs.length, respaldo };
}

/** Objetivos y perfiles disponibles (de analogos.json). */
export function listarObjetivos() {
  const a = leer(RUTAS.analogos);
  const extra = Object.entries(PERFILES_EXTRA).filter(([, r]) => existsSync(r)).map(([p, r]) => [p, leer(r)]);
  return Object.entries(a.objetivos).map(([id, o]) => ({
    id, nombre: o.nombre, cuerpo: o.cuerpo,
    perfiles: [...Object.keys(o.perfiles), ...extra.filter(([p, x]) => x.objetivos[id]?.perfiles?.[p]).map(([p]) => p)],
  }));
}

// ---------- búsquedas ----------
const TOPE_HILOS = Math.max(1, Math.floor(os.cpus().length * 0.7));
const trabajos = new Map();
let activo = null;

/** Valida parámetros contra lista blanca y devuelve los normalizados. */
export function normalizarParams(p) {
  const objs = listarObjetivos();
  const obj = objs.find((o) => o.id === p.objetivo);
  if (!obj) throw new Error(`objetivo desconocido: ${p.objetivo}`);
  const perfil = p.perfil ?? 'terreno_termico';
  if (!obj.perfiles.includes(perfil)) throw new Error(`perfil '${perfil}' no existe para ${obj.id}`);
  const num = (v, d, lo, hi, nom) => {
    const x = v === undefined ? d : Number(v);
    if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${nom} fuera de [${lo}, ${hi}]`);
    return x;
  };
  const factores = (p.factores ?? [0.5, 1, 2]).map((f) => num(f, 1, 0.1, 4, 'factor'));
  if (!factores.length || factores.length > 6) throw new Error('entre 1 y 6 factores de tolerancia');
  // Subconjunto de variables y pesos (P-027): solo variables del perfil base; el motor arma la submatriz de R.
  const delPerfil = leer(analogosDe(perfil)).objetivos?.[obj.id]?.perfiles?.[perfil]?.variables ?? [];
  if (!Array.isArray(p.variables ?? [])) throw new Error('variables debe ser una lista');
  const variables = [...new Set(p.variables ?? [])];
  const ajena = variables.find((v) => !delPerfil.includes(v));
  if (ajena !== undefined) throw new Error(`variable '${ajena}' no está en el perfil ${perfil} de ${obj.id} (${delPerfil.join(', ')})`);
  const usadas = variables.length ? variables : delPerfil;
  const pesos = {};
  for (const [v, w] of Object.entries(p.pesos ?? {})) {
    if (!usadas.includes(v)) throw new Error(`el peso de '${v}' no corresponde a ninguna variable de la búsqueda`);
    pesos[v] = num(w, 1, 0, 10, `peso de ${v}`);
  }
  if (usadas.length && Object.keys(pesos).length === usadas.length && Object.values(pesos).every((w) => w === 0)) throw new Error('al menos un peso debe ser mayor que 0');
  const area = normalizarArea(p.area);
  return {
    area,
    // Solo con área: k del radio efectivo y piso de tierra elegible (los dos provisionales en el motor).
    k_area: area ? num(p.k_area, 0.15, 0.01, 1, 'k_area') : null,
    min_area_km2: area ? num(p.min_area_km2, 40000, 0, 5e6, 'min_area_km2') : null,
    objetivo: obj.id, perfil, factores, variables, pesos,
    ndvi_max: num(p.ndvi_max, 0.3, 0, 1, 'ndvi_max'),
    candidatos: Math.round(num(p.candidatos, 30, 1, 200, 'candidatos')),
    separacion_km: num(p.separacion_km, 300, 0, 2000, 'separacion_km'),
    excluir_indice: p.excluir_indice !== false,
    excluir_previos: p.excluir_previos !== false, // hallazgos y búsquedas anteriores
    excluir_km: num(p.excluir_km, 0, 0, 500, 'excluir_km'), // 0 = cada área con su propio radio_km
    radio_km: num(p.radio_km, 50, 5, 500, 'radio_km'),
    // Se recorta al tope (~70 % de los hilos) en vez de rechazar: la PC no debe trabarse.
    hilos: Math.max(1, Math.min(TOPE_HILOS, Math.round(Number(p.hilos ?? TOPE_HILOS) || TOPE_HILOS))),
  };
}

/**
 * Área de búsqueda opcional (lista blanca): null = toda la Tierra.
 * - { tipo: 'bbox', bbox: [lat1, lon1, lat2, lon2] }: lat1 < lat2; si lon1 > lon2 cruza ±180° (como el motor).
 * - { tipo: 'poligono', anillo: [[lon, lat], ...] }: de 3 a 200 vértices, sin cerrar o cerrado.
 */
export function normalizarArea(a) {
  if (a == null) return null;
  const nombre = typeof a.nombre === 'string' ? a.nombre.slice(0, 80) : null;
  const lat = (x) => Number.isFinite(x) && x >= -90 && x <= 90;
  const lon = (x) => Number.isFinite(x) && x >= -180 && x <= 180;
  if (a.tipo === 'bbox') {
    const b = (Array.isArray(a.bbox) ? a.bbox : []).map(Number);
    if (b.length !== 4 || !lat(b[0]) || !lon(b[1]) || !lat(b[2]) || !lon(b[3])) throw new Error('bbox debe ser [lat1, lon1, lat2, lon2] en grados');
    if (b[0] >= b[2]) throw new Error('bbox: lat1 debe ser menor que lat2');
    if (b[1] === b[3]) throw new Error('bbox: lon1 y lon2 no pueden ser iguales');
    return { tipo: 'bbox', bbox: b, nombre };
  }
  if (a.tipo === 'poligono') {
    const r = Array.isArray(a.anillo) ? a.anillo.map((v) => (Array.isArray(v) ? v.map(Number) : [])) : [];
    if (r.length && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
    if (r.length < 3 || r.length > 200) throw new Error('el polígono necesita de 3 a 200 vértices');
    if (!r.every((v) => v.length === 2 && lon(v[0]) && lat(v[1]))) throw new Error('vértices del polígono: [lon, lat] en grados');
    return { tipo: 'poligono', anillo: [...r, r[0]], nombre };
  }
  throw new Error(`tipo de área desconocido: ${a.tipo}`);
}

/** Argumentos del motor para el área; escribe region.geojson en `dir` si es polígono. */
export function argsArea(p, dir) {
  if (!p.area) return [];
  const args = p.area.tipo === 'bbox' ? ['--bbox', p.area.bbox.join(',')] : ['--region', join(dir, 'region.geojson')];
  if (p.area.tipo === 'poligono') {
    writeFileSync(join(dir, 'region.geojson'), JSON.stringify({
      type: 'Feature', properties: { nombre: p.area.nombre ?? 'dibujada en el visor' },
      geometry: { type: 'Polygon', coordinates: [p.area.anillo] },
    }));
  }
  return [...args, '--k-area', String(p.k_area), '--min-area-km2', String(p.min_area_km2)];
}

/** Última línea «Error: …» del motor (anyhow): lo que el visor muestra en vez del código de salida. */
export function errorDelMotor(log, code) {
  const lineas = String(log).split(/\r?\n/).filter((l) => l.startsWith('Error:'));
  return lineas.length ? `motor: ${lineas.at(-1).slice(6).trim()}` : `pipeline salió con código ${code}`;
}

let areaCelda = null;
/** Área media (km²) de una celda del maestro: 4πR² / (12·4^nivel), con el nivel del manifest. */
export function areaCeldaKm2() {
  if (areaCelda == null) {
    let nivel = 12;
    try { nivel = leer(join(RUTAS.maestro, 'manifest.json')).healpix?.nivel ?? 12; } catch { /* sin manifest: nivel 12 */ }
    areaCelda = (4 * Math.PI * 6371 ** 2) / (12 * 4 ** nivel);
  }
  return areaCelda;
}

/** Resumen del área que el motor dejó en robustez.json (null si la búsqueda fue global). */
export function resumenArea(rob, p) {
  if (!p.area || rob.celdas_en_area == null) return null;
  return {
    ...p.area, k_area: p.k_area, min_area_km2: p.min_area_km2,
    celdas_en_area: rob.celdas_en_area, regiones_con_tierra: rob.regiones_con_tierra,
    sin_celdas_por_ndvi: rob.sin_celdas_por_ndvi,
    tierra_km2: Math.round(rob.celdas_en_area * areaCeldaKm2()),
  };
}

/**
 * Entradas que el motor debe excluir: los 43 documentados y, si se pide, los candidatos previos y las áreas de
 * búsquedas anteriores. El motor solo usa lat/lon/radio_km (el estado es de formato), así que todo va como
 * 'documentado' en un archivo interno de la búsqueda; el índice real no cambia.
 */
export function entradasAExcluir(p) {
  const fuentes = [];
  if (p.excluir_indice) fuentes.push(...leer(RUTAS.indice43));
  if (p.excluir_previos) fuentes.push(...cargarHallazgos(), ...cargarBusquedas());
  const vistos = new Set();
  return fuentes.filter((e) => !vistos.has(e.id) && vistos.add(e.id)).map((e) => ({
    id: e.id, lat: e.lat, lon: e.lon, radio_km: e.radio_km, estado: 'documentado',
    fuente: String(e.fuente ?? 'indice'), fecha: e.fecha,
  }));
}

export const MAX_ESCENARIOS_CORRIDA = 50;
export const MAX_CORRIDAS_BARRIDO = 10;
export const MAX_ESCENARIOS_BARRIDO = MAX_ESCENARIOS_CORRIDA * MAX_CORRIDAS_BARRIDO; // 500
const HISTORIAL_RUTA = join(RUN, 'motor/historial-corridas.json');

export function listarHistorialCorridas(limite = 30) {
  if (!existsSync(HISTORIAL_RUTA)) return [];
  try {
    const lista = leer(HISTORIAL_RUTA);
    return Array.isArray(lista) ? lista.slice(-limite).reverse() : [];
  } catch {
    return [];
  }
}

function registrarCorrida(entry) {
  mkdirSync(dirname(HISTORIAL_RUTA), { recursive: true });
  const prev = existsSync(HISTORIAL_RUTA) ? (() => { try { return leer(HISTORIAL_RUTA); } catch { return []; } })() : [];
  const lista = Array.isArray(prev) ? prev.filter((x) => x?.id !== entry.id) : [];
  lista.push({ fecha: new Date().toISOString(), ...entry });
  writeFileSync(HISTORIAL_RUTA, JSON.stringify(lista.slice(-200), null, 1) + '\n');
}

/** Lanza una búsqueda (un trabajo a la vez). Devuelve {id,estado}. */
export function lanzarBusqueda(params) {
  if (activo) throw new Error(`ya hay una búsqueda en curso (${activo})`);
  const p = normalizarParams(params);
  const id = 'B' + Date.now().toString(36).toUpperCase();
  const dir = join(RUTAS.busquedas, id);
  mkdirSync(dir, { recursive: true });
  const escenarios = p.factores.map((f, i) => ({
    id: `${id}-${i + 1}`, objetivo: p.objetivo, perfil: p.perfil, factor_tolerancia: f, ndvi_max: p.ndvi_max,
    ...(p.variables.length ? { variables: p.variables } : {}), ...(Object.keys(p.pesos).length ? { pesos: p.pesos } : {}),
  }));
  writeFileSync(join(dir, 'escenarios.json'), JSON.stringify({ escenarios }));
  // Lista blanca de argumentos: rutas fijas bajo RUN, sin shell.
  const args = ['--maestro', RUTAS.maestro, '--analogos', analogosDe(p.perfil), '--escenarios', join(dir, 'escenarios.json'),
    '--salida', dir, '--candidatos', String(p.candidatos), '--separacion-km', String(p.separacion_km),
    '--hilos', String(p.hilos)];
  const excl = entradasAExcluir(p);
  if (excl.length) {
    writeFileSync(join(dir, 'indice_exclusion.json'), JSON.stringify(excl));
    args.push('--indice', join(dir, 'indice_exclusion.json'));
    if (p.excluir_km > 0) args.push('--excluir-km', String(p.excluir_km));
  }
  args.push(...argsArea(p, dir));
  const t = { id, estado: 'corriendo', params: p, inicio: Date.now(), log: '', areas: [], area: null };
  trabajos.set(id, t);
  activo = id;
  const hijo = spawn(RUTAS.pipeline, args, { shell: false, windowsHide: true });
  hijo.stdout.on('data', (b) => (t.log = (t.log + b).slice(-4000)));
  hijo.stderr.on('data', (b) => (t.log = (t.log + b).slice(-4000)));
  hijo.on('error', (e) => { t.estado = 'error'; t.error = String(e); activo = null; });
  hijo.on('close', (code) => {
    activo = null;
    t.segundos = (Date.now() - t.inicio) / 1000;
    if (code !== 0) { t.estado = 'error'; t.error = errorDelMotor(t.log, code); return; }
    try {
      const rob = leer(join(dir, 'robustez.json'));
      t.area = resumenArea(rob, p);
      t.areas = robustezAAreas(rob, p, id);
      writeFileSync(join(dir, 'areas.json'), JSON.stringify(t.areas));
      t.estado = 'terminado';
      registrarCorrida({
        id, tipo: 'busqueda', objetivo: p.objetivo, perfil: p.perfil,
        variables: p.variables, pesos: p.pesos, factores: p.factores,
        ndvi_max: p.ndvi_max, area: p.area?.nombre ?? p.area?.tipo ?? 'tierra',
        radio_km: p.radio_km, n_areas: t.areas.length, estado: 'terminado',
      });
    } catch (e) { t.estado = 'error'; t.error = String(e); }
  });
  return { id, estado: t.estado };
}

/** Escenarios de un objetivo en robustez.json (la confianza necesita el n de ese objetivo, no el del barrido entero). */
export function escenariosDelObjetivo(rob, objetivo) {
  const esc = rob.escenarios ?? [];
  return esc.length ? esc.filter((e) => e.objetivo === objetivo).length : (rob.n_escenarios ?? null);
}

/** robustez.json -> entradas de índice (origen 'busqueda'), mejores primero. */
export function robustezAAreas(rob, p, idBusqueda) {
  const lista = rob.robustez?.[p.objetivo] ?? [];
  const nEsc = escenariosDelObjetivo(rob, p.objetivo);
  const fecha = new Date().toISOString().slice(0, 10);
  return lista.map((c, i) => ({
    id: `${idBusqueda}-${String(i + 1).padStart(2, '0')}`,
    lat: c.lat, lon: c.lon, radio_km: p.radio_km,
    estado: 'candidato-sin-verificar', fuente: `motor/pipeline ${idBusqueda}`, fecha,
    origen: 'busqueda', objetivo: p.objetivo, perfil: p.perfil,
    s_mediana: c.s_mediana, fraccion: c.fraccion, aparece_en: c.aparece_en, n_escenarios: nEsc,
    etiqueta: `${p.objetivo} #${i + 1}`,
    resumen: `S mediana ${c.s_mediana.toFixed(2)}, aparece en ${Math.round(c.fraccion * 100)} % de los escenarios`,
  }));
}

export function estadoBusqueda(id) {
  const t = trabajos.get(id);
  if (!t) return null;
  const { areas, ...resto } = t;
  return { ...resto, n_areas: areas.length };
}

// ---------- barrido: varias corridas con los escenarios ya medidos ----------
const ESC = join(BARRIDOS);
const HIELO = join(RUN, 'motor/hielo_min/analogos_hielo.json');
/** Corridas permitidas (lista blanca): cada una con sus variables o casos distintos. */
export const CORRIDAS = {
  'b1-multivariable': { archivo: join(ESC, 'b1-multivariable-200/escenarios_200.json'), n: 200, analogos: RUTAS.analogos },
  'b2-minerales-permafrost': { archivo: join(ESC, 'b2-minerales-permafrost-200/escenarios_200.json'), n: 200, analogos: RUTAS.analogos },
  'muestreo-sl12': { archivo: join(REPO, 'motor/escenarios/muestreo-sl12.json'), n: 201, analogos: RUTAS.analogos },
  'b3-hielo-arcadia': { archivo: join(ESC, 'b3-hielo-mineral/esc_arcadia.json'), n: 66, analogos: HIELO },
  'b3-hielo-crateres': { archivo: join(ESC, 'b3-hielo-mineral/esc_crateres.json'), n: 67, analogos: HIELO },
  'b3-hielo-utopia': { archivo: join(ESC, 'b3-hielo-mineral/esc_utopia.json'), n: 67, analogos: HIELO },
};

/** robustez.json de varios objetivos -> áreas (top por objetivo). */
export function robustezTodosAAreas(rob, { id, corrida, radio_km, top }) {
  const fecha = new Date().toISOString().slice(0, 10);
  const salida = [];
  for (const [obj, lista] of Object.entries(rob.robustez ?? {})) {
    const nEsc = escenariosDelObjetivo(rob, obj);
    lista.slice(0, top).forEach((c, i) => salida.push({
      id: `${id}-${obj}-${String(i + 1).padStart(2, '0')}`, lat: c.lat, lon: c.lon, radio_km,
      estado: 'candidato-sin-verificar', fuente: `motor/pipeline ${id}`, fecha, origen: 'busqueda',
      objetivo: obj, corrida, s_mediana: c.s_mediana, fraccion: c.fraccion, aparece_en: c.aparece_en, n_escenarios: nEsc,
      etiqueta: `${obj} #${i + 1} · ${corrida}`,
      resumen: `${corrida}: S mediana ${c.s_mediana.toFixed(2)}, aparece en ${Math.round(c.fraccion * 100)} % de los escenarios`,
    }));
  }
  return salida;
}

/** Lanza varias corridas seguidas (cada una excluye lo hallado antes, también las corridas anteriores). */
export function lanzarBarrido(params = {}) {
  if (activo) throw new Error(`ya hay una búsqueda en curso (${activo})`);
  const num = (v, d, lo, hi, n) => { const x = v === undefined ? d : Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${n} fuera de [${lo}, ${hi}]`); return x; };
  const excluirKm = num(params.excluir_km, 500, 0, 2000, 'excluir_km');
  const maxEsc = Math.round(num(params.max_escenarios, MAX_ESCENARIOS_BARRIDO, 1, MAX_ESCENARIOS_BARRIDO, 'max_escenarios'));
  const top = Math.round(num(params.top_por_objetivo, 10, 1, 100, 'top_por_objetivo'));
  const nombres = (params.corridas ?? Object.keys(CORRIDAS)).slice(0, MAX_CORRIDAS_BARRIDO);
  for (const n of nombres) if (!CORRIDAS[n]) throw new Error(`corrida desconocida: ${n}`);
  const plan = []; let total = 0;
  for (const n of nombres) {
    const nEsc = Math.min(CORRIDAS[n].n, MAX_ESCENARIOS_CORRIDA);
    if (total + nEsc > maxEsc || plan.length >= MAX_CORRIDAS_BARRIDO) continue;
    plan.push({ nombre: n, n: nEsc });
    total += nEsc;
  }
  if (!plan.length) throw new Error('ninguna corrida cabe en max_escenarios');
  const hilos = Math.max(1, Math.min(TOPE_HILOS, Math.round(Number(params.hilos ?? TOPE_HILOS) || TOPE_HILOS)));
  const id = 'G' + Date.now().toString(36).toUpperCase();
  const t = { id, tipo: 'barrido', estado: 'corriendo', plan: plan.map((p) => p.nombre), escenarios: total, corridas: [], inicio: Date.now(), areas: [], params: { excluir_km: excluirKm, top, hilos, max_escenarios_corrida: MAX_ESCENARIOS_CORRIDA } };
  trabajos.set(id, t);
  activo = id;
  const propias = [];
  const siguiente = (i) => {
    if (i >= plan.length) {
      t.estado = 'terminado';
      t.segundos = (Date.now() - t.inicio) / 1000;
      activo = null;
      registrarCorrida({ id, tipo: 'barrido', corridas: t.plan, escenarios: total, excluir_km: excluirKm, n_areas: t.areas.length, estado: 'terminado' });
      return;
    }
    const { nombre, n: nEsc } = plan[i], c = CORRIDAS[nombre];
    const dir = join(RUTAS.busquedas, `${id}-${nombre}`);
    mkdirSync(dir, { recursive: true });
    const escSrc = leer(c.archivo);
    const escRecortado = Array.isArray(escSrc.escenarios) ? { ...escSrc, escenarios: escSrc.escenarios.slice(0, MAX_ESCENARIOS_CORRIDA) } : escSrc;
    const escArchivo = join(dir, 'escenarios.json');
    writeFileSync(escArchivo, JSON.stringify(escRecortado));
    const base = entradasAExcluir({ excluir_indice: true, excluir_previos: true });
    const ids = new Set(base.map((e) => e.id));
    const excl = [...base, ...propias.filter((e) => !ids.has(e.id)).map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, radio_km: e.radio_km, estado: 'documentado', fuente: e.fuente, fecha: e.fecha }))];
    writeFileSync(join(dir, 'indice_exclusion.json'), JSON.stringify(excl));
    const args = ['--maestro', RUTAS.maestro, '--analogos', c.analogos, '--escenarios', escArchivo, '--salida', dir,
      '--indice', join(dir, 'indice_exclusion.json'), '--excluir-km', String(excluirKm), '--separacion-km', String(Math.max(excluirKm, 300)),
      '--candidatos', '50', '--hilos', String(hilos)];
    const reg = { corrida: nombre, estado: 'corriendo', escenarios: nEsc, areas: 0, log: '' };
    t.corridas.push(reg);
    const hijo = spawn(RUTAS.pipeline, args, { shell: false, windowsHide: true });
    hijo.stdout.on('data', (b) => (reg.log = (reg.log + b).slice(-1500)));
    hijo.stderr.on('data', (b) => (reg.log = (reg.log + b).slice(-1500)));
    hijo.on('error', (e) => { reg.estado = 'error'; reg.error = String(e); siguiente(i + 1); });
    hijo.on('close', (code) => {
      if (code !== 0) { reg.estado = 'error'; reg.error = `código ${code}`; return siguiente(i + 1); }
      try {
        const areas = robustezTodosAAreas(leer(join(dir, 'robustez.json')), { id: `${id}-${nombre}`, corrida: nombre, radio_km: 50, top });
        writeFileSync(join(dir, 'areas.json'), JSON.stringify(areas));
        propias.push(...areas); t.areas.push(...areas); reg.areas = areas.length; reg.estado = 'terminado';
      } catch (e) { reg.estado = 'error'; reg.error = String(e); }
      siguiente(i + 1);
    });
  };
  siguiente(0);
  return { id, estado: t.estado, corridas: plan, escenarios: total };
}
