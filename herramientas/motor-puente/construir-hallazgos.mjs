// Genera indice_hallazgos.json desde los barridos versionados de 2026-11-13 (b1, b2, b3).
// Todo queda como 'candidato-sin-verificar'. Uso: node construir-hallazgos.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUTAS, REPO, validarIndice } from './nucleo.mjs';

const B = join(REPO, 'motor/escenarios/barridos-2026-11-13');
const leer = (r) => JSON.parse(readFileSync(join(B, r), 'utf8'));
const fecha = '2026-11-13';
const salida = [];

const top = (n, arr) => arr.slice(0, n);
const mejorObj = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
// Escenarios por objetivo de cada barrido: k y n de la confianza tienen que ser del mismo objetivo.
const porObjetivo = (...rutas) => {
  const n = {};
  for (const r of rutas) for (const e of leer(r).escenarios) n[e.objetivo] = (n[e.objetivo] ?? 0) + 1;
  return n;
};
const objetivos = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(' ');

// b1: sitios sin radio -> 50 km (el de los análogos documentados).
// z.ap cuenta apariciones con todos los objetivos; z.obj[objetivo] son las del objetivo con que se mide.
const escB1 = porObjetivo('b1-multivariable-200/escenarios_200.json');
top(20, leer('b1-multivariable-200/sitios_nuevos_top.json')).forEach((z, i) => salida.push({
  id: `HZ-b1-${String(i + 1).padStart(2, '0')}`, lat: z.lat, lon: z.lon, radio_km: 50,
  estado: 'candidato-sin-verificar', fuente: 'motor/escenarios/barridos-2026-11-13/b1-multivariable-200', fecha,
  origen: 'barrido', barrido: 'b1', s_mediana: z.smed, aparece_en: z.ap, objetivo: mejorObj(z.obj), objetivos: z.obj,
  aparece_en_objetivo: z.obj[mejorObj(z.obj)], n_escenarios: escB1[mejorObj(z.obj)],
  etiqueta: `b1 #${i + 1}`, resumen: `S mediana ${z.smed.toFixed(2)}, ${z.ap} apariciones; ${objetivos(z.obj)}`,
}));

// b2 y b3: zonas con radio_km propio (150 km) y s_max
// En las zonas, objetivos[o] suma celdas dentro de la zona y puede pasar del número de escenarios;
// max_apariciones es la mejor celda con todos los objetivos. El mínimo de ambos (y de n) es una cota superior.
const zonas = [['b2', 'b2-minerales-permafrost-200/zonas_top30.json', 30, ['b2-minerales-permafrost-200/escenarios_200.json']],
  ['b3-arcadia', 'b3-hielo-mineral/zonas_arcadia_top20.json', 20, ['b3-hielo-mineral/esc_arcadia.json']],
  ['b3-crateres', 'b3-hielo-mineral/zonas_crateres_top20.json', 20, ['b3-hielo-mineral/esc_crateres.json']],
  ['b3-utopia', 'b3-hielo-mineral/zonas_utopia_top20.json', 20, ['b3-hielo-mineral/esc_utopia.json']]];
for (const [tag, ruta, n, esc] of zonas) {
  const j = leer(ruta);
  const nObj = porObjetivo(...esc);
  top(n, j.zonas).forEach((z, i) => salida.push({
    id: `HZ-${tag}-${String(i + 1).padStart(2, '0')}`, lat: z.lat, lon: z.lon, radio_km: j.radio_km,
    estado: 'candidato-sin-verificar', fuente: `motor/escenarios/barridos-2026-11-13/${ruta}`, fecha,
    origen: 'barrido', barrido: tag, s_max: z.s_max, aparece_en: z.max_apariciones, objetivo: mejorObj(z.objetivos), objetivos: z.objetivos,
    n_escenarios: nObj[mejorObj(z.objetivos)],
    aparece_en_objetivo: Math.min(z.max_apariciones, z.objetivos[mejorObj(z.objetivos)], nObj[mejorObj(z.objetivos)]), aparece_en_es_cota: true,
    etiqueta: `${tag} #${i + 1}`,
    resumen: `S máx ${z.s_max.toFixed(2)}, ${z.max_apariciones} apariciones; ${objetivos(z.objetivos)}`,
  }));
}

// Los hallazgos agregados a mano (b4-bodele-chad, b5-..., guardados desde el panel) no los genera este script: se conservan.
// Solo se regeneran las entradas HZ-* de los barridos b1, b2 y b3.
const manuales = existsSync(RUTAS.hallazgos)
  ? JSON.parse(readFileSync(RUTAS.hallazgos, 'utf8')).filter((e) => !/^HZ-(b1|b2|b3)/.test(e.id))
  : [];
const todos = [...salida, ...manuales.filter((m) => !salida.some((s) => s.id === m.id))];

const idx = JSON.parse(readFileSync(RUTAS.indice43, 'utf8'));
const errs = validarIndice([...idx, ...todos]);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
writeFileSync(RUTAS.hallazgos, JSON.stringify(todos, null, 1) + '\n');
console.log(`${salida.length} hallazgos generados + ${manuales.length} manuales conservados en ${RUTAS.hallazgos}`);
