import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { columnasDe, cuantil, cuantilesPedidos, cumpleCondicion, etiquetarCelda, etiquetarVentana, evaluarRegla } from './procesos.mjs';

const reglas = JSON.parse(readFileSync(new URL('./procesos.json', import.meta.url), 'utf8'));
const celda = (o) => (c) => o[c];

test('procesos.json: ids únicos, operadores válidos y columnas declaradas', () => {
  const ids = [...reglas.procesos, ...reglas.usos].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of [...reglas.procesos, ...reglas.usos]) {
    assert.ok(r.si.length > 0, r.id);
    assert.ok(r.base, `${r.id} sin base`);
    assert.ok(columnasDe(r).length > 0);
  }
  assert.deepEqual(Object.keys(cuantilesPedidos(reglas)).sort(), ['dtr_k', 'polvo_emision_kg_m2_s', 'viento_frac_tau_gt_0p20']);
});

test('condiciones: límites, clases y dato faltante', () => {
  assert.equal(cumpleCondicion('a', { lt: 0.05 }, 0.049), true);
  assert.equal(cumpleCondicion('a', { lt: 0.05 }, 0.05), false);
  assert.equal(cumpleCondicion('a', { gte: 3, lte: 20 }, 20), true);
  assert.equal(cumpleCondicion('a', { gte: 3, lte: 20 }, 20.1), false);
  assert.equal(cumpleCondicion('g', { en: [2, 7] }, 7.0000001), true);
  assert.equal(cumpleCondicion('a', { lt: 1 }, NaN), false);
  assert.equal(cumpleCondicion('a', { lt: 1 }, null), false);
  assert.equal(cumpleCondicion('d', { gte_q: 90 }, 40, { d: { 90: 39 } }), true);
  assert.throws(() => cumpleCondicion('d', { gte_q: 90 }, 40, {}), /cuantil/);
  assert.throws(() => cumpleCondicion('a', { raro: 1 }, 1), /operador/);
});

test('regla con alternativas: basta una, y la evidencia es la que se cumplió', () => {
  const r = reglas.procesos.find((x) => x.id === 'evaporitas');
  const e = evaluarRegla(r, celda({ litologia_glim: 3, humedal_clase: 0, frac_efimero: 0.2, aridez_ai: 0.1 }));
  assert.equal(e.dispara, true);
  assert.deepEqual(e.evidencia, { frac_efimero: 0.2, aridez_ai: 0.1 });
  const n = evaluarRegla(r, celda({ litologia_glim: 3, humedal_clase: 0, frac_efimero: 0.2, aridez_ai: 0.3 }));
  assert.equal(n.dispara, false);
  assert.equal(n.con_dato, true);
  const s = evaluarRegla(r, celda({}));
  assert.equal(s.con_dato, false);
});

test('celda: separa disparadas de sin dato', () => {
  const q = { dtr_k: { 90: 20 }, polvo_emision_kg_m2_s: { 90: 1e-9 }, viento_frac_tau_gt_0p20: { 90: 0.3 } };
  const e = etiquetarCelda(reglas, celda({ aridez_ai: 0.01, ndvi_max_clim: 0.05, dtr_k: 25 }), q);
  assert.deepEqual(e.procesos.map((p) => p.id), ['hiperarido']);
  assert.deepEqual(e.usos.map((p) => p.id).sort(), ['astrobiologia_limite_seco', 'ciclos_termicos']);
  assert.ok(e.sin_dato.includes('volcanico'));
});

test('ventana: fracción mínima y mínimo de celdas con dato', () => {
  const r = { ...reglas, procesos: [reglas.procesos.find((x) => x.id === 'hiperarido')], usos: [] };
  const mk = (n, ai) => Array.from({ length: n }, () => celda({ aridez_ai: ai }));
  assert.equal(etiquetarVentana(r, [...mk(3, 0.01), ...mk(27, 0.5)]).hiperarido.estado, 'si');
  assert.equal(etiquetarVentana(r, [...mk(2, 0.01), ...mk(28, 0.5)]).hiperarido.estado, 'no');
  assert.equal(etiquetarVentana(r, [...mk(5, 0.01), ...mk(5, NaN)]).hiperarido.estado, 'sin_dato');
});

test('cuantil por interpolación lineal', () => {
  assert.equal(cuantil([1, 2, 3, 4, 5], 50), 3);
  assert.equal(cuantil([0, 10], 90), 9);
  assert.ok(Number.isNaN(cuantil([NaN], 50)));
});
