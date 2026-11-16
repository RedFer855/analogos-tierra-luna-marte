// Verifica el hallazgo de Bodélé contra la tabla maestra: valores en la celda y percentil frente a las celdas elegibles.
import { closeSync, openSync, readFileSync, readSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const M = 'D:/PP/ANALOGOS-run/etl/maestro';
const pts = { 'hallazgo (18.49, 19.51)': [18.49, 19.51], 'Bodélé del repo (16.9, 17.8)': [16.9, 17.8] };
const names = Object.keys(pts);
const st = JSON.parse(readFileSync('D:/PP/ANALOGOS/motor/escenarios/barridos-2026-11-13/indice_43.json', 'utf8'));
const hz = JSON.parse(readFileSync('D:/PP/ANALOGOS/herramientas/motor-puente/indice_hallazgos.json', 'utf8')).filter((h) => !/bodele/.test(h.id));
const hav = (a, b, c, d) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
for (const [n, [la, lo]] of Object.entries(pts)) {
  const dST = st.map((s) => [hav(la, lo, s.lat, s.lon), s.id]).sort((a, b) => a[0] - b[0])[0];
  const dHZ = hz.map((s) => [hav(la, lo, s.lat, s.lon), s.id]).sort((a, b) => a[0] - b[0])[0];
  console.log(`${n}: ST más cercano ${dST[1]} a ${Math.round(dST[0])} km | candidato previo más cercano ${dHZ[1]} a ${Math.round(dHZ[0])} km`);
}
// una pasada: celdas más cercanas + muestra de celdas elegibles (ndvi_media<=0.3, tierra) para percentiles
const cols = ['lat', 'lon', 'frac_tierra', 'ndvi_media'].map((c) => ({ c, fd: openSync(join(M, `${c}.f32`), 'r'), buf: Buffer.alloc((1 << 22) * 4) }));
const best = names.map(() => ({ d: Infinity, idx: -1 })); const pool = []; let base = 0, k = 0;
for (;;) {
  const n = readSync(cols[0].fd, cols[0].buf, 0, cols[0].buf.length, base * 4) / 4;
  if (n <= 0) break;
  for (const c of cols.slice(1)) readSync(c.fd, c.buf, 0, n * 4, base * 4);
  const [a, o, ft, nd] = cols.map((c) => new Float32Array(c.buf.buffer, c.buf.byteOffset, n));
  for (let i = 0; i < n; i++) {
    names.forEach((nm, j) => { const [la, lo] = pts[nm]; const dla = a[i] - la; if (dla > 0.5 || dla < -0.5) return; const dlo = (o[i] - lo) * Math.cos((la * Math.PI) / 180); const d = dla * dla + dlo * dlo; if (d < best[j].d) { best[j] = { d, idx: base + i }; } });
    if (ft[i] > 0.5 && nd[i] <= 0.3 && ++k % 20 === 0) pool.push(base + i);
  }
  base += n;
}
cols.forEach((c) => closeSync(c.fd));
console.log('muestra de celdas elegibles (tierra, ndvi<=0.3):', pool.length);
const cols2 = ['polvo_emision_kg_m2_s', 'viento_frac_tau_gt_0p05', 'polvo_frec_dod0p2_pct', 'aridez_ai', 'arena_movil_frac', 'ndvi_media', 'litologia_glim', 'gsw_frac_agua_alguna_vez'];
const val = (v, idx) => { const f = join(M, `${v}.f32`); if (!existsSync(f)) return null; const fd = openSync(f, 'r'), b = Buffer.alloc(4); try { readSync(fd, b, 0, 4, idx * 4); } finally { closeSync(fd); } const x = b.readFloatLE(0); return Number.isFinite(x) ? x : null; };
const pct = (v, x) => { // percentil de x entre la muestra de celdas elegibles (lectura puntual de la muestra)
  const fd = openSync(join(M, `${v}.f32`), 'r'), b = Buffer.alloc(4); let menor = 0, n = 0;
  try { for (const idx of pool) { readSync(fd, b, 0, 4, idx * 4); const y = b.readFloatLE(0); if (Number.isFinite(y)) { n++; if (y <= x) menor++; } } } finally { closeSync(fd); }
  return n ? (100 * menor / n).toFixed(1) : null;
};
names.forEach((nm, j) => {
  console.log(`\n== ${nm} -> celda a ${(Math.sqrt(best[j].d) * 111).toFixed(0)} km`);
  for (const v of cols2) { const x = val(v, best[j].idx); console.log('  ', v.padEnd(28), x == null ? 'sin dato' : x.toPrecision(4).padEnd(10) + ('percentil ' + (['litologia_glim', 'gsw_frac_agua_alguna_vez'].includes(v) ? '-' : pct(v, x)))); }
});
