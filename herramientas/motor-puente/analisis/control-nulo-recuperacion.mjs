// Control nulo del barrido de 2500 escenarios: ¿cuántos de los 43 «recupera» frente a puntos al azar del mismo número?
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
const M = 'D:/PP/ANALOGOS-run/etl/maestro';
const st = JSON.parse(readFileSync('D:/PP/ANALOGOS/motor/escenarios/barridos-2026-11-13/indice_43.json', 'utf8'));
const hav = (a, b, c, d) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

for (const [nombre, ruta] of [['2500 escenarios', 'D:/PP/ANALOGOS-run/motor/escenarios_2500/salida/robustez.json'], ['10000 escenarios', 'D:/PP/ANALOGOS-run/motor/escenarios_10000/salida/robustez.json']]) {
  const r = JSON.parse(readFileSync(ruta, 'utf8'));
  const set = new Map(); let total = 0;
  for (const o of Object.keys(r.robustez)) for (const c of r.robustez[o]) { total++; set.set(`${c.lat.toFixed(3)},${c.lon.toFixed(3)}`, [c.lat, c.lon]); }
  const pts = [...set.values()];
  const cubre = (p, R) => st.filter((s) => p.some((q) => hav(s.lat, s.lon, q[0], q[1]) <= R)).length;
  console.log(`\n${nombre}: ${r.n_escenarios} esc., ${Object.keys(r.robustez).length} objetivos, ${total} candidatos (${pts.length} únicos)`);
  console.log(`  REAL: ${cubre(pts, 50)}/43 a <=50 km | ${cubre(pts, 100)}/43 a <=100 km`);
  globalThis.__pts = pts; globalThis.__n = pts.length;
  // piscina de celdas de tierra poco vegetadas (muestra)
  if (!globalThis.__pool) {
    const cols = ['lat', 'lon', 'frac_tierra', 'ndvi_media'].map((c) => ({ c, fd: openSync(join(M, `${c}.f32`), 'r'), buf: Buffer.alloc((1 << 22) * 4) }));
    const pool = []; let base = 0, k = 0;
    for (;;) {
      const n = readSync(cols[0].fd, cols[0].buf, 0, cols[0].buf.length, base * 4) / 4;
      if (n <= 0) break;
      for (const c of cols.slice(1)) readSync(c.fd, c.buf, 0, n * 4, base * 4);
      const [a, o, ft, nd] = cols.map((c) => new Float32Array(c.buf.buffer, c.buf.byteOffset, n));
      for (let i = 0; i < n; i++) if (ft[i] > 0.5 && nd[i] <= 0.3 && ++k % 400 === 0) pool.push([a[i], o[i]]);
      base += n;
    }
    cols.forEach((c) => closeSync(c.fd));
    globalThis.__pool = pool;
  }
  const pool = globalThis.__pool;
  for (const R of [50, 100]) {
    const res = [];
    for (let t = 0; t < 200; t++) res.push(cubre(Array.from({ length: pts.length }, () => pool[Math.floor(Math.random() * pool.length)]), R));
    res.sort((x, y) => x - y);
    console.log(`  AZAR (${pts.length} puntos de tierra poco vegetada al azar), radio ${R} km: mediana ${res[100]}/43, 95 % [${res[5]}, ${res[194]}]`);
  }
}
