import assert from 'node:assert/strict';
import {
  calcularValorSitio,
  ordenarPorRanking,
  PERFILES_RANKING,
  type EntradaValor,
} from '../src/motor/valorSitio';
import type { PuntoGeologico } from '../src/motor/bonoCercania';

const puntos: PuntoGeologico[] = [
  { id: 'CV-1', nombre: 'Indian Tunnel', lat: 43.4614, lon: -113.5594, tipo: 'cueva' },
  { id: 'Q1', nombre: 'Barringer', lat: 35.0272, lon: -111.0225, tipo: 'crater' },
];

const altoCercaCueva: EntradaValor = {
  id: 'A1',
  etiqueta: 'Sitio Alto Cueva',
  lat: 43.48,
  lon: -113.55,
  grupo: 'candidato',
  objetivo: 'SL-12',
  parecido_pct: 88,
  solidez_pct: 72,
};

const bajoCercaCueva: EntradaValor = {
  id: 'A2',
  etiqueta: 'Sitio Bajo Cueva',
  lat: 43.47,
  lon: -113.55,
  grupo: 'candidato',
  objetivo: 'SL-12',
  parecido_pct: 20,
  solidez_pct: 30,
};

const perfilCuevas = PERFILES_RANKING.find((p) => p.id === 'cuevas')!;
const rAlto = calcularValorSitio(altoCercaCueva, perfilCuevas, puntos);
const rBajo = calcularValorSitio(bajoCercaCueva, perfilCuevas, puntos);

assert.ok(rAlto.valor > 75, `Valor esperado > 75, dio ${rAlto.valor}`);
assert.ok(rBajo.valor < 30, `Valor bajo esperado < 30, dio ${rBajo.valor}`);
assert.ok(rAlto.desglose.cuevas > rBajo.desglose.cuevas * 3);

const ordenados = ordenarPorRanking([bajoCercaCueva, altoCercaCueva], perfilCuevas, puntos);
assert.equal(ordenados[0].entrada.id, 'A1');

console.log('OK valorSitio: cálculo compuesto, protección contra falsos positivos y ordenamiento verificados.');
