// Validación por par análogo–objetivo contra el azar (ensayo, 2026-11-13). Pares: scripts/etl/analogo_de_i26.json (salen de I-26).
// Para cada sitio de Marte con al menos un par se puntúa cada celda de la Tierra y se mide en qué «top x %» cae la ventana de 50 km del análogo
// frente a 300 ventanas de 50 km al azar. «top x %» = fracción de ventanas al azar que igualan o superan al análogo (menor es mejor).
//   A = terreno y temperatura (6 variables del perfil terreno_termico) sobre TODAS las celdas elegibles (ndvi_media <= 0.3, tierra > 50 %).
//   B = 0,5·A + 0,5·minerales (TES frente a EMIT, por percentil dentro de cada cuerpo) sobre las celdas con dato EMIT.
// Solo los pares de categoría «terreno» validan un motor de terreno: «proceso» (viento) y «astrobiologia» se reportan aparte y no se esperan arriba.
// Una sola lectura de la tabla por pasada y las mismas ventanas para todos los sitios. No usa el motor Rust: puntuación simple, igual para todos.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const M = 'D:/PP/ANALOGOS-run/etl/maestro';
const TES = 'D:/PP/ANALOGOS-datos/marte/tes-minerales-bandfield-2002/TES_mineral_maps_4_ppd.envi';
const SALIDA = join(REPO, 'herramientas/motor-puente/analisis/resultados');
const TAU = 0.2, R_KM = 50, N_ALEATORIAS = 300;
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s';

const an = JSON.parse(readFileSync('D:/PP/ANALOGOS-run/etl/analogos/analogos.json', 'utf8'));
const sitiosMarte = JSON.parse(readFileSync(join(REPO, 'scripts/etl/sitios.json'), 'utf8'));
const st43 = JSON.parse(readFileSync(join(REPO, 'motor/escenarios/barridos-2026-11-13/indice_43.json'), 'utf8'));
const pares = JSON.parse(readFileSync(join(REPO, 'scripts/etl/analogo_de_i26.json'), 'utf8')).pares;
const SITIOS = [...new Set(pares.map((p) => p.sl))].sort();
const ANALOGOS = [...new Set(pares.map((p) => p.st))];
const nombreST = (id) => sitiosMarte.tierra[id]?.nombre ?? id;
console.log(`sitios con par: ${SITIOS.join(', ')} | análogos: ${ANALOGOS.length} | pares: ${pares.length}`);

// ---------- Marte: minerales TES por sitio (percentil dentro de Marte) ----------
const tesBuf = readFileSync(TES);
const NX = 1440, NY = 720;
const tes = (b, r, c) => tesBuf.readFloatBE(((b * NY + r) * NX + c) * 4);
const pct = (s, x) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] <= x) lo = m + 1; else hi = m; } return lo / s.length; };
const FAMILIAS = [{ id: 'hematita', tes: [7] }, { id: 'sulfatos', tes: [8] }, { id: 'carbonatos', tes: [9] }, { id: 'cuarzo_feldespato', tes: [0, 1] }];
const distTES = FAMILIAS.map((f) => { const v = []; for (let i = 0; i < NX * NY; i += 3) { const xs = f.tes.map((b) => tesBuf.readFloatBE((b * NX * NY + i) * 4)); if (xs.every((x) => x >= 0)) v.push(xs.reduce((a, b) => a + b, 0)); } return v.sort((x, y) => x - y); });
function marteEnSitio(lat, lonE) {
  const lon = lonE > 180 ? lonE - 360 : lonE, r0 = Math.floor((90 - lat) / 0.25), c0 = Math.floor((lon + 180) / 0.25);
  return FAMILIAS.map((f, k) => {
    let s = 0, n = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr, c = ((c0 + dc) % NX + NX) % NX; if (r < 0 || r >= NY) continue;
      const v = f.tes.map((b) => tes(b, r, c)); if (v.some((x) => x < 0)) continue; s += v.reduce((a, b) => a + b, 0); n++;
    }
    const valor = n ? s / n : null;
    return { familia: f.id, valor, percentil_marte: valor == null ? null : pct(distTES[k], valor) };
  });
}

// ---------- Tierra: lectura por bloques ----------
const VARS = an.objetivos[SITIOS[0]].perfiles.terreno_termico.variables;
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
const terrenoOk = (b, i) => b.frac_tierra[i] > 0.5 && b.ndvi_media[i] <= 0.3 && VARS.every((v) => Number.isFinite(b[v][i]));
const emitOk = (f) => f.every((x) => Number.isFinite(x));

// Pase 0: muestra para percentiles EMIT y reservas de centros al azar (P1: terreno; P2: terreno + EMIT)
const muestra = [[], [], [], []], reserva1 = [], reserva2 = []; let k1 = 0, k2 = 0, n1 = 0, n2 = 0;
for (const b of bloques()) for (let i = 0; i < b.n; i++) {
  if (!terrenoOk(b, i)) continue;
  n1++; if (++k1 % 600 === 0) reserva1.push([b.lat[i], b.lon[i]]);
  const f = fam(b, i); if (!emitOk(f)) continue;
  n2++; if (++k2 % 40 === 0) f.forEach((x, j) => muestra[j].push(x));
  if (k2 % 700 === 0) reserva2.push([b.lat[i], b.lon[i]]);
}
muestra.forEach((m) => m.sort((x, y) => x - y));
console.log(`[${seg()}] celdas elegibles con terreno completo: ${n1}; con EMIT además: ${n2}`);
const azar = (r) => Array.from({ length: N_ALEATORIAS }, () => r[Math.floor(Math.random() * r.length)]);

// ventanas de 50 km
const ventanas = [];
const nueva = (id, tipo, grupo, lat, lon) => ventanas.push({ id, tipo, grupo, lat, lon, idx: [] });
for (const s of st43) if (ANALOGOS.includes(s.id)) nueva(s.id, 'analogo', null, s.lat, s.lon);
azar(reserva1).forEach((c, j) => nueva(`azarA-${j}`, 'azar', 'A', c[0], c[1]));
azar(reserva2).forEach((c, j) => nueva(`azarB-${j}`, 'azar', 'B', c[0], c[1]));
const bandas = new Map(); ventanas.forEach((v) => { const b = Math.floor(v.lat); (bandas.get(b) ?? bandas.set(b, []).get(b)).push(v); });
let N = 0;
for (const b of bloques()) {
  N += b.n;
  for (let i = 0; i < b.n; i++) {
    const la = b.lat[i], b0 = Math.floor(la);
    for (let q = b0 - 1; q <= b0 + 1; q++) for (const v of bandas.get(q) ?? []) {
      const dla = (la - v.lat) * 111.195; if (dla > R_KM || dla < -R_KM) continue;
      let dlo = b.lon[i] - v.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
      if (Math.hypot(dla, dlo * 111.195 * Math.cos((v.lat * Math.PI) / 180)) <= R_KM) v.idx.push(b.base + i);
    }
  }
}
console.log(`[${seg()}] ventanas listas (${ventanas.length})`);

// Pase 1: puntuaciones por sitio
const perfiles = Object.fromEntries(SITIOS.map((s) => [s, an.objetivos[s].perfiles.terreno_termico]));
const marte = Object.fromEntries(SITIOS.map((s) => [s, marteEnSitio(sitiosMarte.marte[s].lat, sitiosMarte.marte[s].lon)]));
const A = Object.fromEntries(SITIOS.map((s) => [s, new Float32Array(N).fill(NaN)]));
const B = Object.fromEntries(SITIOS.map((s) => [s, new Float32Array(N).fill(NaN)]));
const rango = (s, x) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] <= x) lo = m + 1; else hi = m; } return lo / s.length; };
for (const b of bloques()) for (let i = 0; i < b.n; i++) {
  if (!terrenoOk(b, i)) continue;
  const f = fam(b, i), conEmit = emitOk(f), pe = conEmit ? f.map((x, j) => rango(muestra[j], x)) : null;
  for (const s of SITIOS) {
    const pf = perfiles[s]; let t = 0;
    for (const v of VARS) { const z = (b[v][i] - pf.objetivo[v]) / pf.tolerancia[v]; t += Math.exp(-0.5 * z * z); }
    t /= VARS.length; A[s][b.base + i] = t;
    if (conEmit) { let m = 0, nm = 0; marte[s].forEach((mm, j) => { if (mm.percentil_marte == null) return; const z = (pe[j] - mm.percentil_marte) / TAU; m += Math.exp(-0.5 * z * z); nm++; }); if (nm) B[s][b.base + i] = 0.5 * t + 0.5 * (m / nm); }
  }
}
Object.values(fds).forEach(closeSync);
console.log(`[${seg()}] puntuaciones listas`);

// ---------- evaluación ----------
const maxV = (arr, v) => { let m = -Infinity; for (const i of v.idx) { const x = arr[i]; if (x > m) m = x; } return m === -Infinity ? null : m; };
const nulos = { A: ventanas.filter((v) => v.grupo === 'A'), B: ventanas.filter((v) => v.grupo === 'B') };
const resultado = { generado: new Date().toISOString(), parametros: { R_KM, N_ALEATORIAS, TAU, tiempo_s: null }, celdas: { elegibles: n1, con_emit: n2 }, pares: [], resumen: {} };
for (const p of pares) {
  const v = ventanas.find((w) => w.id === p.st);
  const fila = { st: p.st, nombre: nombreST(p.st), sl: p.sl, categoria: p.categoria, certeza: p.certeza };
  for (const modo of ['A', 'B']) {
    const arr = (modo === 'A' ? A : B)[p.sl];
    const nulo = nulos[modo].map((w) => maxV(arr, w)).filter((x) => x != null);
    const m = v ? maxV(arr, v) : null;
    fila[modo] = m == null ? null : { maximo: Number(m.toFixed(4)), top_pct: Number((100 * nulo.filter((x) => x >= m).length / nulo.length).toFixed(1)) };
  }
  resultado.pares.push(fila);
}
for (const cat of ['terreno', 'proceso', 'astrobiologia']) {
  const f = resultado.pares.filter((p) => p.categoria === cat);
  const eval_ = (modo) => { const ok = f.filter((p) => p[modo]); return { evaluables: ok.length, en_top10: ok.filter((p) => p[modo].top_pct <= 10).length, esperado_al_azar: Number((ok.length * 0.1).toFixed(1)), mediana_top_pct: ok.length ? ok.map((p) => p[modo].top_pct).sort((x, y) => x - y)[Math.floor(ok.length / 2)] : null }; };
  resultado.resumen[cat] = { pares: f.length, A: eval_('A'), B: eval_('B') };
}
resultado.parametros.tiempo_s = Math.round((Date.now() - t0) / 1000);
mkdirSync(SALIDA, { recursive: true });
// una línea por par (el archivo entra en un PR chico)
writeFileSync(join(SALIDA, 'validacion-pares.json'), ['{', ` "generado": ${JSON.stringify(resultado.generado)},`, ` "parametros": ${JSON.stringify(resultado.parametros)},`, ` "celdas": ${JSON.stringify(resultado.celdas)},`,
  ' "pares": [', resultado.pares.map((p) => '  ' + JSON.stringify(p)).join(',\n'), ' ],', ` "resumen": ${JSON.stringify(resultado.resumen)}`, '}'].join('\n') + '\n');
for (const p of resultado.pares) console.log(`${p.categoria.padEnd(13)} ${p.st} ${p.nombre.slice(0, 26).padEnd(26)} → ${p.sl} [${p.certeza}]  A: ${p.A ? 'top ' + p.A.top_pct + ' %' : 'sin cobertura'}   B: ${p.B ? 'top ' + p.B.top_pct + ' %' : 'sin cobertura'}`);
console.log(JSON.stringify(resultado.resumen, null, 1));
console.log(`tiempo total: ${resultado.parametros.tiempo_s} s`);
