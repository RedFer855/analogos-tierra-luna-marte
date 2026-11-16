#!/usr/bin/env node
// Genera un resultado falso con N candidatos para la prueba de carga del visor (ADR-010).
// Uso: node contrato/generar-mock.js 10000 > mock-10000.json
// Las celdas caen al azar en el globo (también en el mar): sirve para medir FPS, no para mirar resultados.
'use strict';

// Generador con semilla: la misma N da el mismo archivo.
function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const redondear = (x, d) => Number(x.toFixed(d));

function generar(n, semilla = 1) {
  const azar = mulberry32(semilla);
  const mitad = 0.008; // media diagonal de la celda, ~1 km como HEALPix nivel 12
  const usados = new Set();
  const candidatos = [];
  for (let i = 0; i < n; i++) {
    let ipix;
    do ipix = Math.floor(azar() * 12 * 4 ** 12); while (usados.has(ipix));
    usados.add(ipix);
    const lat = redondear(-60 + azar() * 135, 4);
    const lon = redondear(-180 + mitad + azar() * (360 - 2 * mitad), 4);
    const sinSilice = azar() < 0.1;
    const nSilice = sinSilice ? null : redondear(azar(), 2);
    const nRango = redondear(azar(), 2);
    candidatos.push({
      rango: 0,
      ipix,
      centro: { lat, lon },
      vertices: [
        [lon, redondear(lat + mitad, 4)],
        [redondear(lon + mitad, 4), lat],
        [lon, redondear(lat - mitad, 4)],
        [redondear(lon - mitad, 4), lat],
      ],
      nota: redondear((nSilice ?? 1) * nRango, 3),
      variables: {
        silice: sinSilice
          ? { valor: null, nota: null, coincide: null }
          : { valor: redondear(40 + azar() * 25, 1), nota: nSilice, coincide: nSilice > 0.9 },
        rango_termico: { valor: redondear(5 + azar() * 50, 1), nota: nRango, coincide: nRango > 0.9 },
      },
      cobertura: { usadas: sinSilice ? 1 : 2, total: 2 },
      marcas: azar() < 0.3 ? ['hiperarido'] : [],
      analogo_conocido: null,
      region: null,
    });
  }
  candidatos.sort((a, b) => b.nota - a.nota);
  candidatos.forEach((c, i) => { c.rango = i + 1; });
  return {
    version_contrato: '1.0.0',
    es_ejemplo: true,
    perfil: 'astrobiologia',
    sitio: 'SL-10',
    healpix: { esquema: 'nested', nivel: 12 },
    objetivo: { variables: { silice: { valor: 52.0 }, rango_termico: { valor: 75.0 } } },
    parametros: {
      variables: [
        { id: 'silice', peso: 0.5, tolerancia: 2.0 },
        { id: 'rango_termico', peso: 0.5, tolerancia: 5.0 },
      ],
      filtros: ['hiperarido'],
    },
    candidatos,
  };
}

module.exports = { generar };

if (require.main === module) {
  const n = Number(process.argv[2] ?? 10000);
  if (!Number.isInteger(n) || n < 0) {
    console.error('Uso: node contrato/generar-mock.js <N>');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(generar(n)));
}
