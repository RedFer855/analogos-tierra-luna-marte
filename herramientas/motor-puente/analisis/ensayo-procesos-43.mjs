// Ensayo de las etiquetas de procesos y usos (procesos.json) sobre los 43 análogos documentados.
// Compara con procesos-esperados-43.json (escrito antes de correr). Una sola pasada por columna sobre la tabla maestra.
import { closeSync, openSync, readFileSync, readSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnasDe, cuantil, cuantilesPedidos, etiquetarVentana } from '../procesos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUN = process.env.ANALOGOS_RUN ?? 'D:/PP/ANALOGOS-run';
const M = join(RUN, 'etl/maestro');
const reglas = JSON.parse(readFileSync(join(AQUI, '../procesos.json'), 'utf8'));
const esperados = JSON.parse(readFileSync(join(AQUI, 'procesos-esperados-43.json'), 'utf8')).esperados;
const sitios = JSON.parse(readFileSync(join(AQUI, '../../../scripts/etl/sitios.json'), 'utf8')).tierra;
const ids = Object.keys(sitios).filter((k) => /^ST-\d+$/.test(k)).sort();
const R = reglas.ventana.radio_km;
const BLOQUE = 1 << 22;
const t0 = Date.now();

const hav = (a, b, c, d) => { const r = (x) => (x * Math.PI) / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * 6371.0088 * Math.asin(Math.sqrt(x)); };

function recorrer(cols, f) {
  const fds = cols.map((c) => ({ fd: openSync(join(M, `${c}.f32`), 'r'), buf: Buffer.alloc(BLOQUE * 4) }));
  let base = 0;
  try {
    for (;;) {
      const n = readSync(fds[0].fd, fds[0].buf, 0, fds[0].buf.length, base * 4) / 4;
      if (n <= 0) break;
      for (const c of fds.slice(1)) readSync(c.fd, c.buf, 0, n * 4, base * 4);
      f(base, n, fds.map((c) => new Float32Array(c.buf.buffer, c.buf.byteOffset, n)));
      base += n;
    }
  } finally { fds.forEach((c) => closeSync(c.fd)); }
}

// 1) Celdas de tierra dentro de R km de cada sitio, y muestra de tierra para los cuantiles (1 de cada 37).
const caja = ids.map((id) => { const s = sitios[id]; const dla = R / 111.2, dlo = R / (111.2 * Math.max(0.05, Math.cos((s.lat * Math.PI) / 180))); return { id, lat: s.lat, lon: ((s.lon + 540) % 360) - 180, dla, dlo }; });
const enVentana = new Map(ids.map((id) => [id, []]));
const muestra = [];
let k = 0;
recorrer(['lat', 'lon', 'frac_tierra'], (base, n, [la, lo, ft]) => {
  for (let i = 0; i < n; i++) {
    if (!(ft[i] >= 0.5)) continue;
    if (++k % 37 === 0) muestra.push(base + i);
    for (const c of caja) {
      if (Math.abs(la[i] - c.lat) > c.dla) continue;
      let d = lo[i] - c.lon; if (d > 180) d -= 360; else if (d < -180) d += 360;
      if (Math.abs(d) > c.dlo) continue;
      if (hav(c.lat, c.lon, la[i], lo[i]) <= R) enVentana.get(c.id).push(base + i);
    }
  }
});

// 2) Valores de las columnas que usan las reglas en esas celdas y en la muestra.
const cols = [...new Set([...reglas.procesos, ...reglas.usos].flatMap(columnasDe))];
const todas = [...new Set([...[...enVentana.values()].flat(), ...muestra])].sort((a, b) => a - b);
const pos = new Map(todas.map((x, j) => [x, j]));
const val = Object.fromEntries(cols.map((c) => [c, new Float32Array(todas.length).fill(NaN)]));
for (const c of cols) {
  let j = 0;
  recorrer([c], (base, n, [v]) => { while (j < todas.length && todas[j] < base + n) { val[c][j] = v[todas[j] - base]; j++; } });
}

// 3) Cuantiles terrestres pedidos por las reglas.
const q = {};
for (const [c, qs] of Object.entries(cuantilesPedidos(reglas))) {
  const m = muestra.map((x) => val[c][pos.get(x)]);
  q[c] = Object.fromEntries(qs.map((x) => [x, cuantil(m, x)]));
}

// 4) Etiquetas por ventana y comparación con lo esperado.
const res = {};
for (const id of ids) {
  const celdas = enVentana.get(id).map((x) => { const j = pos.get(x); return (c) => val[c][j]; });
  const columnas = Object.fromEntries(cols.map((c) => {
    const v = enVentana.get(id).map((x) => val[c][pos.get(x)]).filter(Number.isFinite);
    const moda = /glim|clase/.test(c) && v.length ? Object.entries(v.reduce((a, x) => ((a[Math.round(x)] = (a[Math.round(x)] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k2, n2]) => `${k2}:${n2}`).join(' ') : undefined;
    return [c, { n: v.length, mediana: v.length ? cuantil(v, 50) : null, p90: v.length ? cuantil(v, 90) : null, max: v.length ? Math.max(...v) : null, ...(moda ? { clases: moda } : {}) }];
  }));
  res[id] = { nombre: sitios[id].nombre, n_celdas: celdas.length, etiquetas: etiquetarVentana(reglas, celdas, q), columnas };
}
const resumen = {};
for (const r of reglas.procesos) {
  const esp = new Set(esperados[r.id] ?? []);
  const si = ids.filter((id) => res[id].etiquetas[r.id].estado === 'si');
  const sinDato = ids.filter((id) => res[id].etiquetas[r.id].estado === 'sin_dato');
  resumen[r.id] = {
    esperados: esp.size,
    aciertos: [...esp].filter((id) => si.includes(id)),
    fallos: [...esp].filter((id) => !si.includes(id)).map((id) => `${id} (${res[id].etiquetas[r.id].estado}, ${(100 * res[id].etiquetas[r.id].frac).toFixed(0)} %)`),
    no_previstos: si.filter((id) => !esp.has(id)),
    sin_dato: sinDato,
  };
}
const usos = Object.fromEntries(reglas.usos.map((u) => [u.id, ids.filter((id) => res[id].etiquetas[u.id].estado === 'si')]));

const salida = { generado: new Date().toISOString(), reglas_version: reglas.version, ventana: reglas.ventana, n_muestra: muestra.length, cuantiles_tierra: q, resumen, usos, sitios: res, segundos: Math.round((Date.now() - t0) / 1000) };
mkdirSync(join(AQUI, 'resultados'), { recursive: true });
writeFileSync(join(AQUI, 'resultados/ensayo-procesos-43.json'), JSON.stringify(salida, null, 1));

console.log(`Cuantiles de la Tierra (muestra de ${muestra.length} celdas de tierra):`, JSON.stringify(q));
for (const [id, r] of Object.entries(resumen)) {
  const tot = r.aciertos.length + r.fallos.length;
  console.log(`\n${id}: ${r.aciertos.length}/${tot} esperados`);
  if (r.fallos.length) console.log(`  fallan: ${r.fallos.join(', ')}`);
  if (r.no_previstos.length) console.log(`  no previstos: ${r.no_previstos.map((x) => `${x} ${res[x].nombre}`).join(', ')}`);
  if (r.sin_dato.length) console.log(`  sin dato: ${r.sin_dato.join(', ')}`);
}
console.log('\nUsos:');
for (const [u, l] of Object.entries(usos)) console.log(`  ${u}: ${l.length} sitios (${l.join(' ')})`);
console.log(`\n${salida.segundos} s`);
