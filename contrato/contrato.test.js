// Prueba del contrato de metrics.json (ADR-010). Sin dependencias: node --test contrato/
// 1) Los ejemplos y el generador cumplen los esquemas JSON (subconjunto de draft 2020-12, ver `validar`).
// 2) Reglas que un esquema no expresa: referencias entre archivos, orden, cobertura y nulos.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generar } = require('./generar-mock.js');

const leer = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8'));
const esquemaIndice = leer('metrics.schema.json');
const esquemaResultado = leer('resultado.schema.json');

function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

// Valida `dato` contra `esq`. Solo las palabras que usan los esquemas de esta carpeta.
function validar(dato, esq, raiz, ruta = '$', errores = []) {
  if (esq.$ref) {
    const nombre = esq.$ref.replace('#/$defs/', '');
    return validar(dato, raiz.$defs[nombre], raiz, ruta, errores);
  }
  const t = tipoDe(dato);
  if (esq.type) {
    const tipos = [].concat(esq.type);
    const ok = tipos.includes(t) || (t === 'integer' && tipos.includes('number'));
    if (!ok) return errores.push(`${ruta}: se esperaba ${tipos.join('|')}, llegó ${t}`), errores;
  }
  if (esq.enum && !esq.enum.includes(dato)) errores.push(`${ruta}: ${JSON.stringify(dato)} no está en ${esq.enum}`);
  if (typeof dato === 'number') {
    if (esq.minimum !== undefined && dato < esq.minimum) errores.push(`${ruta}: ${dato} < ${esq.minimum}`);
    if (esq.maximum !== undefined && dato > esq.maximum) errores.push(`${ruta}: ${dato} > ${esq.maximum}`);
    if (esq.exclusiveMinimum !== undefined && dato <= esq.exclusiveMinimum) errores.push(`${ruta}: ${dato} ≤ mínimo`);
  }
  if (typeof dato === 'string' && esq.pattern && !new RegExp(esq.pattern, 'u').test(dato)) {
    errores.push(`${ruta}: "${dato}" no cumple ${esq.pattern}`);
  }
  if (t === 'array') {
    if (esq.minItems !== undefined && dato.length < esq.minItems) errores.push(`${ruta}: menos de ${esq.minItems}`);
    if (esq.maxItems !== undefined && dato.length > esq.maxItems) errores.push(`${ruta}: más de ${esq.maxItems}`);
    if (esq.items) dato.forEach((x, i) => validar(x, esq.items, raiz, `${ruta}[${i}]`, errores));
  }
  if (t === 'object') {
    for (const r of esq.required ?? []) if (!(r in dato)) errores.push(`${ruta}: falta "${r}"`);
    for (const [k, v] of Object.entries(dato)) {
      if (esq.properties?.[k]) validar(v, esq.properties[k], raiz, `${ruta}.${k}`, errores);
      else if (typeof esq.additionalProperties === 'object') validar(v, esq.additionalProperties, raiz, `${ruta}.${k}`, errores);
    }
  }
  return errores;
}

const cumple = (dato, esq) => assert.deepEqual(validar(dato, esq, esq), []);

// Reglas de un resultado frente al índice.
function revisarResultado(res, indice) {
  const sitio = indice.sitios_objetivo.find((s) => s.id === res.sitio);
  const perfil = indice.perfiles.find((p) => p.id === res.perfil);
  assert.ok(sitio, `sitio ${res.sitio} no está en el índice`);
  assert.ok(perfil, `perfil ${res.perfil} no está en el índice`);
  assert.ok(perfil.contra.includes(sitio.cuerpo), `${res.perfil} no se usa contra ${sitio.cuerpo}`);

  // Solo las variables del perfil que aplican al cuerpo del sitio (ADR-008 §3.1).
  const vars = perfil.variables.filter((id) => indice.variables.find((v) => v.id === id).aplica_a.includes(sitio.cuerpo));
  const orden = (a) => [...a].sort();
  assert.deepEqual(orden(Object.keys(res.objetivo.variables)), orden(vars));
  assert.deepEqual(orden(res.parametros.variables.map((v) => v.id)), orden(vars));

  const marcas = new Set(indice.marcas.map((m) => m.id));
  for (const f of res.parametros.filtros) assert.ok(marcas.has(f), `filtro ${f} no está en marcas`);

  const ipix = new Set();
  res.candidatos.forEach((c, i) => {
    assert.equal(c.rango, i + 1, 'rango consecutivo desde 1');
    if (i > 0) assert.ok(c.nota <= res.candidatos[i - 1].nota, 'ordenados por nota, de mayor a menor');
    assert.ok(!ipix.has(c.ipix), `ipix ${c.ipix} repetido`);
    ipix.add(c.ipix);
    assert.deepEqual(orden(Object.keys(c.variables)), orden(vars));
    let usadas = 0;
    for (const v of Object.values(c.variables)) {
      const nulos = [v.valor, v.nota, v.coincide].filter((x) => x === null).length;
      assert.ok(nulos === 0 || nulos === 3, 'valor, nota y coincide son null juntos');
      if (nulos === 0) usadas++;
    }
    assert.deepEqual(c.cobertura, { usadas, total: vars.length });
    for (const m of c.marcas) assert.ok(marcas.has(m), `marca ${m} no está en el índice`);
    if (c.analogo_conocido) {
      assert.ok(indice.analogos_conocidos.some((a) => a.id === c.analogo_conocido), `${c.analogo_conocido} no está`);
    }
    for (const [lon, lat] of c.vertices) {
      assert.ok(Math.abs(lat - c.centro.lat) < 1 && Math.abs(lon - c.centro.lon) < 1, 'vértice lejos del centro');
    }
  });
}

// Las mismas pruebas para los ejemplos y, si METRICS_DIR apunta a una carpeta con metrics.json y resultados/, para la
// salida real del motor: METRICS_DIR=<carpeta> node --test contrato/contrato.test.js
function probarIndice(etiqueta, indice, leerArchivo) {
  test(`${etiqueta}metrics.json cumple el esquema`, () => cumple(indice, esquemaIndice));

  test(`${etiqueta}el índice es coherente`, () => {
    const ids = indice.variables.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, 'ids de variables repetidos');
    for (const p of indice.perfiles) for (const v of p.variables) assert.ok(ids.includes(v), `${p.id}: ${v} no existe`);
  });

  for (const r of indice.resultados) {
    test(`${etiqueta}resultado ${r.archivo} cumple el esquema y el índice`, () => {
      const res = leerArchivo(r.archivo);
      cumple(res, esquemaResultado);
      assert.equal(res.perfil, r.perfil);
      assert.equal(res.sitio, r.sitio);
      assert.equal(res.candidatos.length, r.n_candidatos);
      const primero = res.candidatos[0];
      if (primero) {
        assert.deepEqual(r.mejor, { nota: primero.nota, centro: primero.centro, region: primero.region });
      } else {
        assert.equal(r.mejor, null);
      }
      revisarResultado(res, indice);
    });
  }
}

const indice = leer('ejemplo/metrics.json');
probarIndice('', indice, (archivo) => leer(path.join('ejemplo', archivo)));

if (process.env.METRICS_DIR) {
  const dir = process.env.METRICS_DIR;
  const deSalida = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
  const salida = deSalida('metrics.json');
  test('salida del motor: no es un ejemplo', () => assert.equal(salida.es_ejemplo, false));
  probarIndice('salida del motor: ', salida, deSalida);
}

test('el generador de carga cumple el contrato', () => {
  const res = generar(2000, 7);
  cumple(res, esquemaResultado);
  revisarResultado(res, indice);
  assert.deepEqual(generar(50, 3), generar(50, 3), 'misma semilla, mismo archivo');
});

test('el validador detecta errores', () => {
  const malo = structuredClone(leer('ejemplo/resultados/astrobiologia/SL-10.json'));
  malo.candidatos[0].nota = 1.5;
  delete malo.candidatos[1].ipix;
  const errores = validar(malo, esquemaResultado, esquemaResultado);
  assert.ok(errores.some((e) => e.includes('1.5 > 1')));
  assert.ok(errores.some((e) => e.includes('falta "ipix"')));
});
