// P-035: los sitios documentados llevan los pares de I-26 desde scripts/etl/sitios.json y la plantilla los nombra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { listarAreas, obtenerArea, normalizarParams, RUTAS } from './nucleo.mjs';
import { plantilla } from './explicacion.mjs';

test('Death Valley trae sus pares de I-26 con nombre del objetivo', () => {
  if (!listarAreas({ grupo: 'hallado' }).some((a) => a.id === 'ST-07')) return; // sin indice_43 en esta máquina
  const p = obtenerArea('ST-07').properties;
  assert.deepEqual(p.pares_i26.map((q) => q.sl).sort(), ['SL-10', 'SL-11', 'SL-20']);
  assert.equal(p.pares_i26.find((q) => q.sl === 'SL-11').nombre, 'Gale');
  assert.equal(p.pares_i26.find((q) => q.sl === 'SL-11').certeza, 'C');
});

test('la plantilla nombra los pares solo si existen', () => {
  const base = { id: 'ST-99', nombre: 'Prueba', lugar: 'X', lat: 0, lon: 0, radio_km: 50, estado: 'documentado', fuente: 'f', fecha: '2026-11-13' };
  assert.doesNotMatch(plantilla(base), /I-26/);
  const t = plantilla({ ...base, pares_i26: [{ sl: 'SL-11', nombre: 'Gale', categoria: 'terreno', certeza: 'C' }] });
  assert.match(t, /Gale \(SL-11; terreno, confirmado\)/);
});

// P-027 (3): la búsqueda acepta subconjunto de variables y pesos, solo del perfil base.
test('normalizarParams valida variables y pesos contra el perfil', { skip: !existsSync(RUTAS.analogos) }, () => {
  const base = { objetivo: 'SL-11', perfil: 'terreno' };
  const sin = normalizarParams(base);
  assert.deepEqual([sin.variables, sin.pesos], [[], {}]);
  const con = normalizarParams({ ...base, variables: ['slope_mean_deg', 'slope_mean_deg'], pesos: { slope_mean_deg: 2 } });
  assert.deepEqual([con.variables, con.pesos], [['slope_mean_deg'], { slope_mean_deg: 2 }]);
  assert.throws(() => normalizarParams({ ...base, variables: ['nada'] }), /no está en el perfil/);
  assert.throws(() => normalizarParams({ ...base, variables: ['slope_mean_deg'], pesos: { slope_std_deg: 1 } }), /no corresponde/);
  assert.throws(() => normalizarParams({ ...base, pesos: { slope_mean_deg: 20 } }), /fuera de/);
  assert.throws(() => normalizarParams({ ...base, variables: 'slope_mean_deg' }), /lista/);
});
