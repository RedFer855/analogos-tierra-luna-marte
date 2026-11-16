import assert from 'node:assert/strict';
import {
  calcularBonoCercania,
  distanciaKm,
  evaluarCercaniaArea,
  type PuntoGeologico,
} from '../src/motor/bonoCercania';

const puntos: PuntoGeologico[] = [
  { id: 'CV-1', nombre: 'Indian Tunnel', lat: 43.4614, lon: -113.5594, tipo: 'cueva' },
  { id: 'Q1', nombre: 'Barringer', lat: 35.0272, lon: -111.0225, tipo: 'crater' },
];

assert.ok(distanciaKm(43.4614, -113.5594, 43.4614, -113.5594) < 0.01);

// Sitio alto con muchas variables cerca de un cráter/cueva sube bastante más que un sitio bajo
const alto = calcularBonoCercania(85, 6, 5);
const bajo = calcularBonoCercania(25, 2, 5);
assert.ok(alto.bonoPct > 5, `Esperaba bono alto > 5, dio ${alto.bonoPct}`);
assert.ok(bajo.bonoPct < 0.5, `Esperaba bono bajo < 0.5, dio ${bajo.bonoPct}`);
assert.ok(alto.bonoPct > bajo.bonoPct * 15);

// Fuera de 50 km: 0
assert.equal(calcularBonoCercania(90, 6, 60).bonoPct, 0);

// Evaluación contra puntos reales
const res = evaluarCercaniaArea(43.48, -113.55, 85, 6, puntos);
assert.ok(res !== null);
assert.equal(res.punto.nombre, 'Indian Tunnel');
assert.ok(res.totalPct > 85 && res.totalPct <= 100);

console.log('OK bonoCercania: fórmula proporcional y evaluación espacial verificadas.');
