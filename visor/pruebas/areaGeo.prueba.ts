// Geometría del área de búsqueda del motor (src/motor/areaGeo.ts). Uso: npm run prueba
import {
  REGIONES, areaAnilloKm2, areaBboxKm2, bboxDeEsquinas, centro, formatoKm2, problemaBbox, radioEfectivoKm,
} from '../src/motor/areaGeo';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle: unknown): void {
  console.log(`${cond ? 'OK ' : 'FALLA'} ${nombre}${cond ? '' : ` → ${JSON.stringify(detalle)}`}`);
  if (!cond) fallos++;
}
const cerca = (a: number, b: number, rel: number): boolean => Math.abs(a - b) <= Math.abs(b) * rel;

// Caja de 1°×1° en el ecuador: (π/180)²·R² ≈ 12 364 km².
const b1 = areaBboxKm2([0, 0, 1, 1]);
check('caja 1°×1° en el ecuador ≈ 12 364 km²', cerca(b1, 12364, 0.002), b1);
// La misma caja a 60° mide aproximadamente la mitad (cos 60°).
const b60 = areaBboxKm2([60, 0, 61, 1]);
check('caja 1°×1° a 60° ≈ mitad que en el ecuador', cerca(b60 / b1, 0.4925, 0.01), b60 / b1);
// Cruce de ±180°: 170 → −170 son 20° de ancho, igual que 0 → 20.
check('caja que cruza ±180° mide lo mismo que su gemela', cerca(areaBboxKm2([64, 170, 69, -170]), areaBboxKm2([64, 0, 69, 20]), 1e-9), null);

// Polígono = caja de 1°×1° (la fórmula aproxima los lados como paralelos; error < 1 %).
const p1 = areaAnilloKm2([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
check('polígono 1°×1° ≈ caja 1°×1°', cerca(p1, b1, 0.01), [p1, b1]);
check('el sentido de giro no cambia el área', cerca(areaAnilloKm2([[0, 0], [0, 1], [1, 1], [1, 0]]), p1, 1e-9), null);
check('polígono que cruza ±180° no da la vuelta al mundo', areaAnilloKm2([[179, 0], [-179, 0], [-179, 1], [179, 1]]) < 30000, null);
check('menos de 3 vértices = 0', areaAnilloKm2([[0, 0], [1, 1]]) === 0, null);

// Esquinas clicadas: el ancho corto, aunque cruce el antimeridiano.
check('esquinas en orden cualquiera', JSON.stringify(bboxDeEsquinas({ lat: -21, lon: -66 }, { lat: -25, lon: -70 })) === JSON.stringify([-25, -70, -21, -66]), bboxDeEsquinas({ lat: -21, lon: -66 }, { lat: -25, lon: -70 }));
const anti = bboxDeEsquinas({ lat: 64, lon: 175 }, { lat: 69, lon: -175 });
check('esquinas a ambos lados de ±180° dan oeste > este', anti[1] === 175 && anti[3] === -175, anti);

check('caja válida', problemaBbox([-25, -70, -21, -66]) === null, null);
check('lat sur ≥ norte se rechaza', problemaBbox([-21, -70, -25, -66]) !== null, null);
check('valor vacío se rechaza', problemaBbox([-25, null, -21, -66]) !== null, null);
check('longitud fuera de rango se rechaza', problemaBbox([-25, -190, -21, -66]) !== null, null);

const c = centro({ tipo: 'bbox', bbox: [64, 170, 69, -170], nombre: null });
check('centro de la caja que cruza ±180°', cerca(c.lat, 66.5, 1e-9) && Math.abs(Math.abs(c.lon) - 180) < 1e-9, c);

check('radio efectivo = min(radio, k·√área)', radioEfectivoKm(300, 40000, 0.15) === 30 && radioEfectivoKm(20, 40000, 0.15) === 20, null);
check('formato de km²', formatoKm2(176_432) === `${(176_000).toLocaleString('es')} km²` && formatoKm2(8_200_000).includes('M km²'), formatoKm2(176_432));

for (const r of REGIONES) {
  check(`región ${r.id}: caja válida y sobre el piso de 40 000 km²`, problemaBbox(r.bbox) === null && areaBboxKm2(r.bbox) >= 40000, areaBboxKm2(r.bbox));
}

if (fallos > 0) {
  console.error(`\nFallaron ${fallos} verificaciones en areaGeo.prueba.ts.`);
  process.exit(1);
}
console.log('\nTodas las verificaciones del área de búsqueda pasaron.');
