// Ranking por AJUSTE de todos los candidatos del mapa (previos y nuevos) que no estén registrados.
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
const N = 'file:///D:/PP/ANALOGOS/herramientas/motor-puente/nucleo.mjs';
const { listarAreas, obtenerArea, RUTAS } = await import(N);
const MAESTRO = RUTAS.maestro;
const HIELO = 'D:/PP/ANALOGOS-run/motor/hielo_min/analogos_hielo.json';
const an = JSON.parse(readFileSync(RUTAS.analogos, 'utf8'));
const anH = existsSync(HIELO) ? JSON.parse(readFileSync(HIELO, 'utf8')) : null;
const st = JSON.parse(readFileSync('D:/PP/ANALOGOS/motor/escenarios/barridos-2026-11-13/indice_43.json', 'utf8'));
const hav = (p, q) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const d = Math.sin(r(q.lat - p.lat) / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(r(q.lon - p.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(d)); };

// candidatos: todo lo que no sea documentado y tenga objetivo
const cand = [];
for (const a of listarAreas()) {
  if (a.grupo === 'hallado') continue;
  const p = obtenerArea(a.id).properties;
  let objetivo = p.objetivo;
  if (!objetivo && p.objetivos) objetivo = Object.entries(p.objetivos).sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!objetivo) continue;
  const tag = `${p.corrida ?? ''} ${p.barrido ?? ''}`;
  const hielo = /arcadia|crateres|utopia/.test(tag) && anH;
  const perfil = /arcadia/.test(tag) ? 'hielo_basalto' : /crateres/.test(tag) ? 'crater_hielo_alterado' : /utopia/.test(tag) ? 'hielo_arcilla' : (p.perfil ?? 'terreno_termico');
  const o = (hielo ? anH : an).objetivos[objetivo];
  const pf = o?.perfiles[perfil] ?? o?.perfiles.terreno_termico;
  if (!pf) continue;
  const near = st.map((s) => [hav(p, s), s.id]).sort((x, y) => x[0] - y[0])[0];
  cand.push({ id: a.id, grupo: a.grupo, lat: p.lat, lon: p.lon, objetivo, nombre: o.nombre, pf, perfil, st_km: near[0], st_id: near[1], ap: p.aparece_en, fr: p.fraccion, mejor: null });
}
console.log('candidatos con objetivo:', cand.length);

// una sola pasada sobre lat/lon: celda más cercana de cada candidato (por bandas de 1° de latitud)
const bandas = new Map();
for (const c of cand) { const b = Math.floor(c.lat); (bandas.get(b) ?? bandas.set(b, []).get(b)).push(c); c.d = Infinity; c.idx = -1; }
const fl = openSync(join(MAESTRO, 'lat.f32'), 'r'), fo = openSync(join(MAESTRO, 'lon.f32'), 'r');
const NB = 1 << 22, bl = Buffer.alloc(NB * 4), bo = Buffer.alloc(NB * 4);
let base = 0;
for (;;) {
  const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
  if (n <= 0) break;
  readSync(fo, bo, 0, n * 4, base * 4);
  const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const la = a[i];
    const lista = bandas.get(Math.floor(la)) ?? (bandas.get(Math.floor(la) - 1)) ?? (bandas.get(Math.floor(la) + 1));
    if (!lista && !bandas.get(Math.floor(la) - 1) && !bandas.get(Math.floor(la) + 1)) continue;
    for (const b of [-1, 0, 1]) for (const c of bandas.get(Math.floor(la) + b) ?? []) {
      const dla = la - c.lat; if (dla > 0.6 || dla < -0.6) continue;
      let dlo = o[i] - c.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
      const k = Math.cos((c.lat * Math.PI) / 180), d = dla * dla + (dlo * k) ** 2;
      if (d < c.d) { c.d = d; c.idx = base + i; }
    }
  }
  base += n;
}
closeSync(fl); closeSync(fo);

const val = (v, idx) => { const f = join(MAESTRO, `${v}.f32`); if (!existsSync(f)) return null; const fd = openSync(f, 'r'), b = Buffer.alloc(4); try { readSync(fd, b, 0, 4, idx * 4); } finally { closeSync(fd); } const x = b.readFloatLE(0); return Number.isFinite(x) ? x : null; };
for (const c of cand) {
  const vs = c.pf.variables.map((v) => { const aqui = c.idx >= 0 ? val(v, c.idx) : null, obj = c.pf.objetivo[v], tol = c.pf.tolerancia[v]; const d = aqui == null ? null : Math.abs(aqui - obj); return { v, aqui, obj, tol, ok: d == null ? null : d <= tol, cerc: d == null ? 0 : Math.max(0, 1 - d / tol) }; });
  c.n = vs.length; c.ok = vs.filter((x) => x.ok).length; c.sin = vs.filter((x) => x.ok === null).length; c.cerc = vs.reduce((s, x) => s + x.cerc, 0) / vs.length; c.vs = vs;
}
const ok = cand.filter((c) => c.sin === 0 && c.n >= 4);
const ord = (a, b) => (b.ok / b.n - a.ok / a.n) || (b.cerc - a.cerc) || ((b.ap ?? 0) - (a.ap ?? 0));
for (const [titulo, filtro] of [['SIN filtro de registro', () => true], ['NO registrados (≥500 km de los 43)', (c) => c.st_km >= 500], ['NO registrados (≥150 km)', (c) => c.st_km >= 150]]) {
  console.log('\n== ' + titulo + ' · evaluados:', ok.filter(filtro).length);
  ok.filter(filtro).sort(ord).slice(0, 6).forEach((c, i) => console.log(`${i + 1}. ${c.id.slice(0, 34).padEnd(34)} ${c.lat.toFixed(2)},${c.lon.toFixed(2)} | ${c.objetivo} ${c.nombre.slice(0, 22)} [${c.perfil}] | ${c.ok}/${c.n} en tol., cercanía ${Math.round(c.cerc * 100)}% | ST ${c.st_id} a ${Math.round(c.st_km)} km | ${c.grupo}`));
}
const t = ok.filter((c) => c.st_km >= 500).sort(ord)[0];
console.log('\nDETALLE del primero (≥500 km):', t.id); t.vs.forEach((x) => console.log('  ', x.v.padEnd(26), 'aquí', x.aqui?.toFixed(3), 'obj', x.obj, '±', x.tol, x.ok ? 'OK' : 'difiere'));
