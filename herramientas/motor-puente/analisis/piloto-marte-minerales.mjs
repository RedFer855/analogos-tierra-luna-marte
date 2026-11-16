// Piloto: ¿sumar minerales a la búsqueda mejora el parecido con los análogos documentados? (ensayo, 2026-11-13)
// Sitios de Marte: Jezero (SL-10), Gale (SL-11), Mawrth Vallis (SL-12). NO usa el motor Rust: usa una puntuación simple y declarada,
// igual para las dos variantes, para poder compararlas:
//   A = solo terreno y temperatura (las 6 variables del perfil terreno_termico, con sus tolerancias)
//   B = 0,5 · A + 0,5 · minerales (4 familias de TES frente a EMIT, comparadas por percentil dentro de cada cuerpo)
// Evaluación: para cada par análogo–objetivo documentado en I-26, el máximo de la puntuación en 50 km alrededor del análogo se compara
// con el de 300 ventanas de 50 km al azar (celdas áridas con dato EMIT). «top x %» = fracción de ventanas al azar que lo igualan o superan.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const M = 'D:/PP/ANALOGOS-run/etl/maestro';
const SALIDA = 'D:/PP/ANALOGOS-run/motor/piloto-marte';
const TES = 'D:/PP/ANALOGOS-datos/marte/tes-minerales-bandfield-2002/TES_mineral_maps_4_ppd.envi';
const TAU = 0.2; // tolerancia de la comparación por percentil (20 puntos)
const N_ALEATORIAS = 300;
const R_KM = 50;

const an = JSON.parse(readFileSync('D:/PP/ANALOGOS-run/etl/analogos/analogos.json', 'utf8'));
const sitiosMarte = JSON.parse(readFileSync('D:/PP/ANALOGOS/scripts/etl/sitios.json', 'utf8')).marte;
const st43 = JSON.parse(readFileSync('D:/PP/ANALOGOS/motor/escenarios/barridos-2026-11-13/indice_43.json', 'utf8'));
const nombreST = JSON.parse(readFileSync('D:/PP/ANALOGOS/scripts/etl/sitios.json', 'utf8')).tierra;

// Pares análogo–objetivo documentados en I-26 (certeza C = confirmado, P = parcial). Mawrth no tiene ninguno.
const PARES = {
  'SL-10': [['ST-07', 'P'], ['ST-10', 'P'], ['ST-13', 'C'], ['ST-17', 'C'], ['ST-35', 'P'], ['ST-36', 'P'], ['ST-37', 'C']],
  'SL-11': [['ST-07', 'C'], ['ST-10', 'P'], ['ST-13', 'C'], ['ST-14', 'C'], ['ST-15', 'C'], ['ST-31', 'C'], ['ST-32', 'C'], ['ST-41', 'C']],
  'SL-12': [],
};
const SITIOS = ['SL-10', 'SL-11', 'SL-12'];

// ---------- Marte: minerales TES en el sitio y su percentil dentro de Marte ----------
const tesBuf = readFileSync(TES);
const NX = 1440, NY = 720, NB = 13;
const tes = (b, r, c) => tesBuf.readFloatBE(((b * NY + r) * NX + c) * 4);
const validos = (b) => { const v = []; for (let i = 0; i < NX * NY; i += 3) { const x = tesBuf.readFloatBE((b * NX * NY + i) * 4); if (x >= 0) v.push(x); } return v.sort((x, y) => x - y); };
const pct = (sorted, x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= x) lo = m + 1; else hi = m; } return lo / sorted.length; };
const FAMILIAS = [
  { id: 'hematita', tes: [7], emit: ['emit_hematite'] },
  { id: 'sulfatos', tes: [8], emit: ['emit_gypsum'] },
  { id: 'carbonatos', tes: [9], emit: ['emit_calcite', 'emit_dolomite'] },
  { id: 'cuarzo_feldespato', tes: [0, 1], emit: ['emit_quartz_feldspar'] },
];
const tesSorted = FAMILIAS.map((f) => (f.tes.length === 1 ? validos(f.tes[0]) : null));
// para familias con 2 bandas, la distribución es la de la suma píxel a píxel
tesSorted[3] = (() => { const v = []; for (let i = 0; i < NX * NY; i += 3) { const a = tesBuf.readFloatBE(i * 4), b = tesBuf.readFloatBE((NX * NY + i) * 4); if (a >= 0 && b >= 0) v.push(a + b); } return v.sort((x, y) => x - y); })();
function marteEnSitio(lat, lonE) {
  const lon = lonE > 180 ? lonE - 360 : lonE;
  const r0 = Math.floor((90 - lat) / 0.25), c0 = Math.floor((lon + 180) / 0.25);
  return FAMILIAS.map((f, k) => {
    let s = 0, n = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr, c = ((c0 + dc) % NX + NX) % NX; if (r < 0 || r >= NY) continue;
      const vals = f.tes.map((b) => tes(b, r, c)); if (vals.some((v) => v < 0)) continue; s += vals.reduce((a, b) => a + b, 0); n++;
    }
    const valor = n ? s / n : null;
    return { familia: f.id, valor, percentil_marte: valor == null ? null : pct(tesSorted[k], valor), pixeles: n };
  });
}

// ---------- Tierra: lectura por bloques ----------
const VARS = an.objetivos['SL-10'].perfiles.terreno_termico.variables; // las 6 del perfil
const COLS = ['lat', 'lon', 'frac_tierra', 'ndvi_media', ...VARS, 'emit_hematite', 'emit_gypsum', 'emit_calcite', 'emit_dolomite', 'emit_quartz_feldspar'];
const CH = 1 << 22;
const fds = Object.fromEntries(COLS.map((c) => [c, openSync(join(M, `${c}.f32`), 'r')]));
const bufs = Object.fromEntries(COLS.map((c) => [c, Buffer.alloc(CH * 4)]));
function* bloques() {
  for (let base = 0; ; base += CH) {
    const n = readSync(fds.lat, bufs.lat, 0, CH * 4, base * 4) / 4;
    if (n <= 0) return;
    const col = { n, base };
    for (const c of COLS) { if (c !== 'lat') readSync(fds[c], bufs[c], 0, n * 4, base * 4); col[c] = new Float32Array(bufs[c].buffer, bufs[c].byteOffset, n); }
    yield col;
  }
}
const fam = (b, i) => [b.emit_hematite[i], b.emit_gypsum[i], b.emit_calcite[i] + b.emit_dolomite[i], b.emit_quartz_feldspar[i]];
const elegible = (b, i) => b.frac_tierra[i] > 0.5 && b.ndvi_media[i] <= 0.3;

// Pase 0: muestra para percentiles (celdas áridas con dato EMIT) y reserva de centros al azar
const muestra = [[], [], [], []]; const reserva = []; let k = 0, cubiertas = 0;
for (const b of bloques()) {
  for (let i = 0; i < b.n; i++) {
    if (!elegible(b, i)) continue;
    const f = fam(b, i); if (f.some((x) => !Number.isFinite(x)) || VARS.some((v) => !Number.isFinite(b[v][i]))) continue;
    cubiertas++;
    if (++k % 40 === 0) { f.forEach((x, j) => muestra[j].push(x)); }
    if (k % 700 === 0) reserva.push([b.lat[i], b.lon[i]]);
  }
}
muestra.forEach((m) => m.sort((x, y) => x - y));
console.log(`celdas áridas con dato EMIT y terreno completo: ${cubiertas} (muestra ${muestra[0].length}, centros al azar posibles ${reserva.length})`);
const azarCentros = Array.from({ length: N_ALEATORIAS }, () => reserva[Math.floor(Math.random() * reserva.length)]);

// ventanas de 50 km: análogos y centros al azar
const ventanas = [];
const añadir = (id, tipo, lat, lon) => ventanas.push({ id, tipo, lat, lon, idx: [] });
const analogosUsados = new Set(SITIOS.flatMap((s) => PARES[s].map((p) => p[0])));
for (const s of st43) if (analogosUsados.has(s.id)) añadir(s.id, 'analogo', s.lat, s.lon);
azarCentros.forEach((c, j) => añadir(`azar-${j}`, 'azar', c[0], c[1]));
const bandas = new Map(); ventanas.forEach((v) => { const b = Math.floor(v.lat); (bandas.get(b) ?? bandas.set(b, []).get(b)).push(v); });
for (const b of bloques()) {
  for (let i = 0; i < b.n; i++) {
    const la = b.lat[i], b0 = Math.floor(la);
    for (let q = b0 - 1; q <= b0 + 1; q++) for (const v of bandas.get(q) ?? []) {
      const dla = (la - v.lat) * 111.195; if (dla > R_KM || dla < -R_KM) continue;
      let dlo = b.lon[i] - v.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
      if (Math.hypot(dla, dlo * 111.195 * Math.cos((v.lat * Math.PI) / 180)) <= R_KM) v.idx.push(b.base + i);
    }
  }
}

// Pase 1: puntuaciones A y B por sitio en todas las celdas cubiertas
const N = (() => { let n = 0; for (const b of bloques()) n += b.n; return n; })();
const perfiles = Object.fromEntries(SITIOS.map((s) => [s, an.objetivos[s].perfiles.terreno_termico]));
const marte = Object.fromEntries(SITIOS.map((s) => [s, marteEnSitio(sitiosMarte[s].lat, sitiosMarte[s].lon)]));
const A = Object.fromEntries(SITIOS.map((s) => [s, new Float32Array(N).fill(NaN)]));
const B = Object.fromEntries(SITIOS.map((s) => [s, new Float32Array(N).fill(NaN)]));
const rango = (sorted, x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= x) lo = m + 1; else hi = m; } return lo / sorted.length; };
for (const b of bloques()) {
  for (let i = 0; i < b.n; i++) {
    if (!elegible(b, i)) continue;
    const f = fam(b, i); if (f.some((x) => !Number.isFinite(x)) || VARS.some((v) => !Number.isFinite(b[v][i]))) continue;
    const pe = f.map((x, j) => rango(muestra[j], x));
    for (const s of SITIOS) {
      const pf = perfiles[s]; let t = 0;
      for (const v of VARS) { const z = (b[v][i] - pf.objetivo[v]) / pf.tolerancia[v]; t += Math.exp(-0.5 * z * z); }
      t /= VARS.length;
      let m = 0, nm = 0;
      marte[s].forEach((mm, j) => { if (mm.percentil_marte == null) return; const z = (pe[j] - mm.percentil_marte) / TAU; m += Math.exp(-0.5 * z * z); nm++; });
      m = nm ? m / nm : NaN;
      A[s][b.base + i] = t; B[s][b.base + i] = Number.isFinite(m) ? 0.5 * t + 0.5 * m : NaN;
    }
  }
}
Object.values(fds).forEach(closeSync);

// ---------- evaluación ----------
const maxVentana = (arr, v) => { let m = -Infinity; for (const i of v.idx) { const x = arr[i]; if (x > m) m = x; } return m === -Infinity ? null : m; };
const azar = ventanas.filter((v) => v.tipo === 'azar');
const resultado = { generado: new Date().toISOString(), parametros: { TAU, R_KM, N_ALEATORIAS, celdas_cubiertas: cubiertas }, sitios: {} };
for (const s of SITIOS) {
  const base = { marte_en_el_sitio: marte[s], pares: [], mejores_regiones: {} };
  for (const modo of ['A', 'B']) {
    const arr = (modo === 'A' ? A : B)[s];
    const nulo = azar.map((v) => maxVentana(arr, v)).filter((x) => x != null);
    for (const [id, cert] of PARES[s]) {
      const v = ventanas.find((w) => w.id === id); const m = v ? maxVentana(arr, v) : null;
      let par = base.pares.find((p) => p.analogo === id); if (!par) base.pares.push(par = { analogo: id, nombre: nombreST[id]?.nombre, certeza: cert, celdas_en_ventana: v?.idx.length ?? 0 });
      par[modo] = m == null ? null : { maximo: Number(m.toFixed(4)), top_pct: Number((100 * nulo.filter((x) => x >= m).length / nulo.length).toFixed(1)) };
    }
    // mejores regiones (agrupadas a 150 km)
    const idx = []; const thr = (() => { const s2 = []; for (let i = 0; i < arr.length; i += 97) if (Number.isFinite(arr[i])) s2.push(arr[i]); s2.sort((x, y) => x - y); return s2[Math.floor(s2.length * 0.9995)]; })();
    for (let i = 0; i < arr.length; i++) if (arr[i] >= thr) idx.push(i);
    idx.sort((x, y) => arr[y] - arr[x]);
    base.mejores_regiones[modo] = { umbral: Number(thr.toFixed(4)), celdas_sobre_umbral: idx.length, _idx: idx.slice(0, 4000) };
  }
  resultado.sitios[s] = base;
}
// coordenadas de las mejores regiones: se leen lat/lon de esos índices
{
  const need = new Set(); for (const s of SITIOS) for (const m of ['A', 'B']) resultado.sitios[s].mejores_regiones[m]._idx.forEach((i) => need.add(i));
  const lat = openSync(join(M, 'lat.f32'), 'r'), lon = openSync(join(M, 'lon.f32'), 'r'), b4 = Buffer.alloc(4); const co = new Map();
  for (const i of need) { readSync(lat, b4, 0, 4, i * 4); const a = b4.readFloatLE(0); readSync(lon, b4, 0, 4, i * 4); co.set(i, [a, b4.readFloatLE(0)]); }
  closeSync(lat); closeSync(lon);
  const hav = (a, b, c, d) => { const r = (x) => (x * Math.PI) / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  for (const s of SITIOS) for (const m of ['A', 'B']) {
    const r = resultado.sitios[s].mejores_regiones[m]; const reg = [];
    for (const i of r._idx) { const [la, lo] = co.get(i); if (reg.every((g) => hav(g.lat, g.lon, la, lo) > 150)) reg.push({ lat: la, lon: lo, puntaje: Number(((m === 'A' ? A : B)[s][i]).toFixed(3)) }); if (reg.length >= 5) break; }
    for (const g of reg) { const c = st43.map((t) => [hav(g.lat, g.lon, t.lat, t.lon), t.id]).sort((x, y) => x[0] - y[0])[0]; g.st_cercano = c[1]; g.st_km = Math.round(c[0]); }
    r.regiones = reg; delete r._idx;
  }
}
mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify(resultado, null, 1));
for (const s of SITIOS) {
  console.log(`\n=== ${s} ${an.objetivos[s].nombre} — minerales de TES en el sitio (percentil dentro de Marte)`);
  console.log('  ' + marte[s].map((m) => `${m.familia} ${m.valor == null ? 'sin dato' : m.valor.toFixed(3)} (P${m.percentil_marte == null ? '-' : Math.round(m.percentil_marte * 100)})`).join(' | '));
  for (const p of resultado.sitios[s].pares) console.log(`  par ${p.analogo} ${p.nombre} [${p.certeza}]  A: ${p.A ? 'top ' + p.A.top_pct + ' %' : 'sin cobertura'}   B: ${p.B ? 'top ' + p.B.top_pct + ' %' : 'sin cobertura'}`);
  for (const m of ['A', 'B']) console.log(`  mejores regiones ${m}: ` + resultado.sitios[s].mejores_regiones[m].regiones.map((g) => `${g.lat.toFixed(1)},${g.lon.toFixed(1)} (${g.puntaje}; ${g.st_cercano} a ${g.st_km} km)`).join(' | '));
}
