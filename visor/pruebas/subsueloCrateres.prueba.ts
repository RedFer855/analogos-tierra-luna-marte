import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  esCoordenadaValida,
  formatearFuentePin,
  type CuevaPin,
  type CraterPin,
} from '../src/layers/subsueloCrateresLayer';

const datosDir = path.resolve(process.cwd(), 'public', 'capas');
const cuevas = JSON.parse(fs.readFileSync(path.join(datosDir, 'cuevas.json'), 'utf8')) as CuevaPin[];
const crateres = JSON.parse(fs.readFileSync(path.join(datosDir, 'crateres.json'), 'utf8')) as CraterPin[];

assert.equal(cuevas.length, 50, 'Deben existir 50 cuevas verificadas (niveles A y B)');
assert.equal(crateres.length, 202, 'Deben existir 202 cráteres únicos');

const idsCuevas = new Set<string>();
for (const c of cuevas) {
  assert.ok(c.nivel === 'A' || c.nivel === 'B', `Nivel inesperado en ${c.id}: ${c.nivel}`);
  assert.ok(esCoordenadaValida(c.lat, c.lon), `Coordenada inválida en ${c.id}`);
  assert.ok(!idsCuevas.has(c.id), `ID duplicado en cuevas: ${c.id}`);
  idsCuevas.add(c.id);
}

const idsCrateres = new Set<string>();
for (const cr of crateres) {
  assert.ok(esCoordenadaValida(cr.lat, cr.lon), `Coordenada inválida en ${cr.id}`);
  assert.ok(!idsCrateres.has(cr.id), `QID duplicado en cráteres: ${cr.id}`);
  idsCrateres.add(cr.id);
}

assert.equal(esCoordenadaValida(91, 0), false);
assert.equal(esCoordenadaValida(0, 181), false);
assert.equal(esCoordenadaValida(Number.NaN, 0), false);

const fCueva = formatearFuentePin({ kind: 'cuevas', data: cuevas[0] });
assert.ok(fCueva.licencia.includes('Pyroduct') && fCueva.licencia.includes('ODbL'));

const fCrater = formatearFuentePin({ kind: 'crateres', data: crateres[0] });
assert.ok(fCrater.url.includes('wikidata.org/wiki/'));
assert.ok(fCrater.licencia.includes('CC0'));

console.log(`OK subsueloCrateres: ${cuevas.length} cuevas (A/B) y ${crateres.length} cráteres verificados.`);
