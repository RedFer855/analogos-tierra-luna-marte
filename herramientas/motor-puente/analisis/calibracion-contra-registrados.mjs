// ¿Qué tan especial es Hadramaut para SL-03 (Malapert)? Se compara con los 43 análogos registrados y con la tasa base de la Tierra.
import { closeSync, openSync, readFileSync, readSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { RUTAS } = await import('file:///D:/PP/ANALOGOS/herramientas/motor-puente/nucleo.mjs');
const M = RUTAS.maestro;
const an = JSON.parse(readFileSync(RUTAS.analogos, 'utf8'));
const st = JSON.parse(readFileSync('D:/PP/ANALOGOS/motor/escenarios/barridos-2026-11-13/indice_43.json', 'utf8'));
const nombres = JSON.parse(readFileSync('D:/PP/ANALOGOS/scripts/etl/sitios.json', 'utf8')).tierra;
const pf = an.objetivos['SL-03'].perfiles.terreno_termico;
console.log('Objetivo SL-03', an.objetivos['SL-03'].nombre, '| variables:', pf.variables.join(', '));
console.log('Celdas de la Tierra que coinciden con el perfil:', pf.celdas_que_coinciden_en_la_tierra, 'de', an.filtros.elegibles_total, 'elegibles =', (100 * pf.celdas_que_coinciden_en_la_tierra / an.filtros.elegibles_total).toFixed(2) + ' %');
console.log('Calidad:', JSON.stringify(pf.resumen_calidad), '| tolerancias:', JSON.stringify(pf.tolerancia));

const pts = [{ id: 'HADRAMAUT', lat: 14.81487, lon: 48.88916 }, ...st.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }))];
for (const p of pts) { p.d = Infinity; p.idx = -1; }
const fl = openSync(join(M, 'lat.f32'), 'r'), fo = openSync(join(M, 'lon.f32'), 'r');
const NB = 1 << 22, bl = Buffer.alloc(NB * 4), bo = Buffer.alloc(NB * 4);
let base = 0;
for (;;) {
  const n = readSync(fl, bl, 0, bl.length, base * 4) / 4;
  if (n <= 0) break;
  readSync(fo, bo, 0, n * 4, base * 4);
  const a = new Float32Array(bl.buffer, bl.byteOffset, n), o = new Float32Array(bo.buffer, bo.byteOffset, n);
  for (let i = 0; i < n; i++) for (const p of pts) {
    const dla = a[i] - p.lat; if (dla > 0.5 || dla < -0.5) continue;
    let dlo = o[i] - p.lon; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
    const d = dla * dla + (dlo * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < p.d) { p.d = d; p.idx = base + i; }
  }
  base += n;
}
closeSync(fl); closeSync(fo);
const val = (v, idx) => { const fd = openSync(join(M, `${v}.f32`), 'r'), b = Buffer.alloc(4); try { readSync(fd, b, 0, 4, idx * 4); } finally { closeSync(fd); } const x = b.readFloatLE(0); return Number.isFinite(x) ? x : null; };
const res = pts.map((p) => {
  const vs = pf.variables.map((v) => { const x = p.idx < 0 ? null : val(v, p.idx); const d = x == null ? null : Math.abs(x - pf.objetivo[v]); return { ok: d == null ? null : d <= pf.tolerancia[v], cerc: d == null ? 0 : Math.max(0, 1 - d / pf.tolerancia[v]) }; });
  return { id: p.id, nombre: nombres[p.id]?.nombre ?? '', ok: vs.filter((v) => v.ok).length, n: vs.length, sin: vs.filter((v) => v.ok === null).length, cerc: vs.reduce((s, v) => s + v.cerc, 0) / vs.length };
});
const h = res[0], reg = res.slice(1).filter((r) => r.sin === 0);
console.log('\nHADRAMAUT:', h.ok + '/' + h.n, 'en tolerancia, cercanía', Math.round(h.cerc * 100) + '%');
console.log('De los 43 registrados con dato completo (' + reg.length + '): con 5/5 en tolerancia =', reg.filter((r) => r.ok === r.n).length, '| mejor cercanía entre ellos:', Math.round(Math.max(...reg.map((r) => r.cerc)) * 100) + '%', '| mediana:', Math.round(reg.map((r) => r.cerc).sort((a, b) => a - b)[Math.floor(reg.length / 2)] * 100) + '%');
console.log('Registrados que lo superan o igualan en cercanía (' + Math.round(h.cerc * 100) + '%):', reg.filter((r) => r.cerc >= h.cerc).map((r) => r.id + ' ' + r.nombre + ' ' + Math.round(r.cerc * 100) + '%').join(' | ') || 'ninguno');
console.log('Los 5 mejores registrados:', reg.sort((a, b) => b.cerc - a.cerc).slice(0, 5).map((r) => r.id + ' ' + r.nombre + ' ' + r.ok + '/' + r.n + ' ' + Math.round(r.cerc * 100) + '%').join(' | '));
