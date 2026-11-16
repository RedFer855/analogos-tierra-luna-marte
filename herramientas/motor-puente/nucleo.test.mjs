import { existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarIndice, circulo, normalizarParams, robustezAAreas, listarAreas, obtenerArea } from './nucleo.mjs';

const ok = { id: 'X-1', lat: 10, lon: 20, radio_km: 50, estado: 'documentado', fuente: 'f', fecha: '2026-11-13' };

test('validarIndice acepta una entrada correcta y rechaza errores', () => {
  assert.deepEqual(validarIndice([ok]), []);
  assert.ok(validarIndice([ok, ok]).some((e) => e.includes('repetido')));
  assert.ok(validarIndice([{ ...ok, lat: 99 }]).length);
  assert.ok(validarIndice([{ ...ok, estado: 'raro' }]).length);
  assert.ok(validarIndice([{ ...ok, fecha: '13/11' }]).length);
});

test('circulo cierra el anillo y respeta el radio', () => {
  const a = circulo(0, 0, 100, 32);
  assert.equal(a.length, 33);
  assert.deepEqual(a[0], a[32]);
  const km = Math.abs(a[0][1]) * 111.195 + Math.abs(a[0][0]) * 111.195; // punto al norte: |lat| ≈ r/111,195
  assert.ok(Math.abs(km - 100) < 1);
});

test('circulo cruza el antimeridiano sin saltos fuera de rango', () => {
  for (const [lon] of circulo(0, 179.9, 100)) assert.ok(lon >= -180 && lon <= 180);
});

test('normalizarParams rechaza lo que no está en la lista blanca', () => {
  assert.throws(() => normalizarParams({ objetivo: 'SL-99' }), /desconocido/);
  assert.throws(() => normalizarParams({ objetivo: 'SL-12', perfil: 'nada' }), /no existe/);
  assert.throws(() => normalizarParams({ objetivo: 'SL-12', candidatos: 9999 }), /candidatos/);
  assert.throws(() => normalizarParams({ objetivo: 'SL-12', factores: [] }), /factores/);
  const p = normalizarParams({ objetivo: 'SL-12', hilos: 9999 });
  assert.ok(p.hilos >= 1 && p.hilos < 64);
});

test('robustezAAreas arma entradas válidas del índice', () => {
  const rob = { robustez: { 'SL-12': [{ lat: 1, lon: 2, s_mediana: 0.9, fraccion: 0.5, aparece_en: 3 }] } };
  const a = robustezAAreas(rob, { objetivo: 'SL-12', perfil: 'p', radio_km: 50 }, 'BTEST');
  assert.equal(a[0].id, 'BTEST-01');
  assert.deepEqual(validarIndice(a), []);
});

test('listarAreas y obtenerArea sobre el índice real', () => {
  const todas = listarAreas();
  assert.ok(todas.length >= 43);
  assert.ok(todas.some((a) => a.grupo === 'hallado'));
  const f = obtenerArea('ST-01');
  assert.equal(f.geometry.type, 'Polygon');
  assert.equal(obtenerArea('NO-EXISTE'), null);
});

test('entradasAExcluir suma documentados y previos sin repetir y solo con campos del motor', async () => {
  const { entradasAExcluir } = await import('./nucleo.mjs');
  const solo43 = entradasAExcluir({ excluir_indice: true, excluir_previos: false });
  const todo = entradasAExcluir({ excluir_indice: true, excluir_previos: true });
  assert.equal(solo43.length, 43);
  assert.ok(todo.length > 43);
  assert.equal(new Set(todo.map((e) => e.id)).size, todo.length);
  assert.deepEqual(Object.keys(todo[0]).sort(), ['estado', 'fecha', 'fuente', 'id', 'lat', 'lon', 'radio_km']);
  assert.deepEqual(entradasAExcluir({ excluir_indice: false, excluir_previos: false }), []);
});

test('las corridas del barrido suman 801 escenarios y sus archivos existen', async () => {
  const { CORRIDAS } = await import('./nucleo.mjs');
  const { existsSync } = await import('node:fs');
  assert.equal(Object.values(CORRIDAS).reduce((s, c) => s + c.n, 0), 801);
  for (const c of Object.values(CORRIDAS)) assert.ok(existsSync(c.archivo), c.archivo);
});

test('la configuración rechaza claves mal formadas y modelos no permitidos, y nunca devuelve la clave', async () => {
  const { guardarConfig, estadoConfig } = await import('./explicacion.mjs');
  assert.throws(() => guardarConfig({ clave: 'corta' }), /formato/);
  assert.throws(() => guardarConfig({ clave: 'sk-con espacios y mas de dieciseis' }), /formato/);
  assert.throws(() => guardarConfig({ modelo: 'otro-modelo' }), /modelo/);
  assert.deepEqual(Object.keys(estadoConfig()).sort(), ['archivo_env_ignorado_por_git', 'configurada', 'modelo', 'velocidad', 'voces', 'voz', 'voz_configurada']);
});

test('fichaSitio y el enriquecido dan nombre y ubicación a los ST', () => {
  const a = listarAreas().find((x) => x.id === 'ST-26');
  assert.equal(a.nombre, 'Andes argentinos');
  assert.match(a.etiqueta, /Andes argentinos/);
  assert.match(obtenerArea('ST-26').properties.ubicacion, /Carri Laufquen/);
});

test('voz: las marcas ocultas no aparecen en el texto visible y se vuelven ritmo y pausas', async () => {
  const { aGuion, limpiarTexto, paraVoz, guionDesdePlantilla } = await import('./voz.mjs');
  const r = aGuion('Hola. [pausa] Esto es [lento] muy importante: 8.2° y 44 K. [pausa larga] [suave] Es un ensayo. [inventada]');
  assert.equal(r.texto, 'Hola. Esto es muy importante: 8.2° y 44 K. Es un ensayo.');
  assert.ok(!/[\[\]]/.test(r.texto));
  assert.equal(r.guion[0].pausa_ms, 180);
  const lento = r.guion.find((x) => x.t.includes('importante'));
  assert.equal(lento.ritmo, 'lento');
  assert.equal(lento.pausa_ms, 400);
  assert.equal(r.guion.at(-1).ritmo, 'suave');
  assert.match(lento.t, /8,2 grados y 44 kelvin/);
  assert.equal(limpiarTexto('a [x] b'), 'a b');
  assert.equal(paraVoz('**Hola** _mundo_ 3.5 m'), 'Hola mundo 3,5 metros');
  const g = guionDesdePlantilla('**Título**\n\n- uno\n- dos\n\n_nota final._');
  assert.equal(g.at(-1).ritmo, 'suave');
  assert.ok(g.every((x) => x.t && x.pausa_ms >= 0));
});

test('voz: el primer trozo es corto para que la voz arranque rápido', async () => {
  const { aGuion } = await import('./voz.mjs');
  const r = aGuion('Este lugar está en Sinkiang, China, y se parece mucho a Utopia Planitia, en Marte, con un parecido del cien por ciento según el motor.');
  assert.ok(r.guion.length >= 2);
  assert.ok(r.guion[0].t.length <= 115, r.guion[0].t);
  assert.equal(r.guion.map((x) => x.t).join(' ').replace(/\s+/g, ' ').length >= 100, true);
});

test('la configuración de voz valida clave y voz y no devuelve claves', async () => {
  const { guardarConfig, estadoConfig } = await import('./explicacion.mjs');
  assert.throws(() => guardarConfig({ clave_deepgram: 'corta' }), /Deepgram/);
  assert.throws(() => guardarConfig({ voz: 'aura-2-inventada-es' }), /voz/);
  assert.throws(() => guardarConfig({ velocidad: 3 }), /velocidad/);
  const e = estadoConfig();
  assert.ok(Object.keys(e.voces).length === 17 && 'voz_configurada' in e);
  assert.ok(!JSON.stringify(e).match(/key|clave_/i));
});

test('minerales: el resumen dice roca, ASTER, EMIT y suelo, y avisa cuando no hay dato', async () => {
  const { resumenMinerales } = await import('./minerales.mjs');
  const con = resumenMinerales({
    roca: { nombre: 'volcánicas básicas (basalto y afines)' },
    aster: [{ nombre: 'Índice máfico (MI)', valor: 1.1, percentil: 90, lectura: 'alto' }],
    emit: { cobertura: true, minerales: [{ nombre: 'Hematita', valor: 0.3 }] },
    suelo: [{ columna: 'arcilla_gkg', valor: 221 }],
  }).join(' ');
  assert.match(con, /basalto/);
  assert.match(con, /máfico \(MI\)|índice máfico/i);
  assert.match(con, /hematita/);
  assert.match(con, /221 g\/kg/);
  const sin = resumenMinerales({ aster: [{ valor: null }], emit: { cobertura: false, minerales: [] }, suelo: [] }).join(' ');
  assert.match(sin, /ASTER no tiene dato/);
  assert.match(sin, /EMIT no cubre/);
});

test('minerales: Atacama (ST-13) con datos reales de la tabla maestra', { skip: !process.env.ANALOGOS_RUN && !existsSync('D:/PP/ANALOGOS-run/etl/maestro/lat.f32') }, async () => {
  const { hechosDeArea } = await import('./explicacion.mjs');
  const h = await hechosDeArea('ST-13');
  assert.ok(h.minerales.roca.nombre);
  assert.equal(h.minerales.aster.length, 3);
  assert.ok(h.minerales.emit.cobertura);
  assert.ok(h.minerales.aster.every((a) => a.percentil >= 0 && a.percentil <= 100));
});

test('confianza: Wilson, niveles y topes del eslabón más débil', async () => {
  const { wilson, puntuar, nivelDe } = await import('./confianza.mjs');
  const w6 = wilson(6, 6), w190 = wilson(190, 200);
  assert.ok(w6.lo > 0.55 && w6.lo < 0.65 && w6.hi > 0.99, JSON.stringify(w6)); // 6 de 6 sigue dejando margen amplio
  assert.ok(w190.lo > 0.9);
  assert.equal(nivelDe(70), 'alta'); assert.equal(nivelDe(50), 'media'); assert.equal(nivelDe(10), 'baja');
  const bueno = puntuar({ ok: 5, n: 5, cerc: 0.95, sin: 0, wideras: 0, k: 190, nEsc: 200, calidad: { alta: 3, media: 2, baja: 0 } });
  assert.equal(bueno.nivel, 'alta');
  assert.ok(bueno.bajo <= bueno.puntaje && bueno.puntaje <= bueno.alto);
  // mismo ajuste perfecto pero con tolerancias anchas y calidad baja: el nivel no puede ser alto
  const flojo = puntuar({ ok: 5, n: 5, cerc: 0.95, sin: 0, wideras: 4, k: 6, nEsc: 6, calidad: { alta: 0, media: 0, baja: 7 } });
  assert.equal(flojo.nivel, 'media');
  assert.ok(flojo.puntaje < 65 && flojo.limitantes.length >= 3);
  // ajuste malo: baja, y el puntaje mostrado no pasa del techo del nivel
  const malo = puntuar({ ok: 1, n: 6, cerc: 0.1, sin: 0, wideras: 0, k: 190, nEsc: 200, calidad: { alta: 3, media: 0, baja: 0 } });
  assert.equal(malo.nivel, 'baja');
  assert.ok(malo.puntaje <= 39 && malo.puntaje_bruto > malo.puntaje);
});

test('confianza: n de escenarios del objetivo, no del barrido ni 200 por defecto', async () => {
  const { escenariosDe } = await import('./confianza.mjs');
  // búsqueda vieja desde el mapa: sin corrida ni n_escenarios, 3 de 3 (antes se medía 3 de 200)
  assert.deepEqual(escenariosDe({ aparece_en: 3, fraccion: 1 }), { k: 3, n: 3, cota: false });
  // b1: 190 apariciones con todos los objetivos, pero 9 de los 10 escenarios de SL-20
  assert.deepEqual(escenariosDe({ aparece_en: 190, aparece_en_objetivo: 9, n_escenarios: 10 }), { k: 9, n: 10, cota: false });
  // zona b2: el conteo de la zona (62) no puede pasar de los 50 escenarios del objetivo
  assert.equal(escenariosDe({ aparece_en_objetivo: 62, n_escenarios: 50, aparece_en_es_cota: true }).k, 50);
  // sin dato: no se inventa n
  assert.equal(escenariosDe({}), null);
  assert.equal(escenariosDe({ aparece_en: 0, fraccion: 0 }), null);
});

test('confianza: el tope del nivel no colapsa el rango', async () => {
  const { puntuar } = await import('./confianza.mjs');
  // ajuste flojo (nivel media) con buena robustez: el puntaje mostrado se recorta, el rango conserva su ancho
  const r = puntuar({ ok: 3, n: 6, cerc: 0.9, sin: 0, wideras: 0, k: 50, nEsc: 66, calidad: { alta: 3, media: 0, baja: 0 }, margenCelda: 6 });
  assert.equal(r.nivel, 'media');
  assert.ok(r.puntaje <= 64 && r.puntaje_bruto > r.puntaje, JSON.stringify(r));
  assert.ok(r.alto - r.bajo >= 12, JSON.stringify(r));
  assert.ok(r.bajo <= r.puntaje_bruto && r.puntaje_bruto <= r.alto);
});

test('confianza: el ajuste se mide en el círculo, no solo en la celda del centro', async () => {
  const { puntuar, ajusteDeZona } = await import('./confianza.mjs');
  // perfil de 2 variables; 4 celdas: una perfecta, una a medias, dos fuera y una sin dato en b
  const pf = { variables: ['a', 'b'], objetivo: { a: 0, b: 10 }, tolerancia: { a: 1, b: 2 } };
  const z = ajusteDeZona(pf, { a: [0, 0.5, 5, 5], b: [10, 10, 30, null] });
  assert.equal(z.celdas, 4);
  assert.ok(z.p75 >= z.mediana && z.mediana >= z.p25, JSON.stringify(z));
  assert.equal(z.p25, 0);
  // centro perfecto pero círculo flojo: el puntaje sigue al círculo y el nivel baja
  const base = { ok: 6, n: 6, cerc: 0.9, sin: 0, wideras: 0, k: 56, nEsc: 66, calidad: { alta: 3, media: 0, baja: 0 } };
  const centro = puntuar(base), circulo = puntuar({ ...base, zona: { p25: 0.1, mediana: 0.2, p75: 0.45, celdas: 400 } });
  assert.equal(centro.nivel, 'alta');
  assert.equal(circulo.nivel, 'baja');
  assert.ok(circulo.puntaje_bruto < centro.puntaje_bruto);
  assert.equal(circulo.ajuste_centro, 0.95);
  assert.equal(circulo.ajuste_zona.mediana, 0.2);
  // el rango usa P25–P75 del círculo: ancho al menos 40 × (0.45 − 0.1) = 14 puntos más la robustez
  assert.ok(circulo.alto_bruto - circulo.bajo_bruto >= 14, JSON.stringify(circulo));
});

test('confianza: el círculo solo cuenta celdas elegibles, propaga Manski y cobertura de huella', async () => {
  const { puntuar, ajusteDeZona } = await import('./confianza.mjs');
  const pf = { variables: ['a', 'b'], objetivo: { a: 0, b: 10 }, tolerancia: { a: 1, b: 2 } };
  // celda 0 perfecta; celda 1 perfecta en a y sin dato en b ni NDVI; celda 2 perfecta pero con vegetación (NDVI 0,8)
  const z = ajusteDeZona(pf, { a: [0, 0, 0], b: [10, null, 10], ndvi_media: [0.1, null, 0.8] }, 0.3);
  assert.equal(z.no_elegibles, 1);
  assert.equal(z.celdas, 2);
  assert.equal(z.sin_ndvi, 1);
  assert.equal(z.mediana, 1, 'la variable sin dato no cuenta como fallo en la mediana: se promedia sobre las observadas');
  assert.equal(z.p25, 0.5, 'p25 abre con la cota inferior de Manski cuando faltan variables');
  assert.equal(z.p75, 1, 'p75 conserva la cota superior de Manski');
  // cobertura media: (1 + 0,5)/2 = 0,75; 1 de 2 sin NDVI -> descuento 1 - 0,25*0,5 = 0,875 -> 0,656
  assert.equal(z.cobertura, 0.656);
  // menos de la mitad de las variables con dato: la celda no entra al ajuste pero sí cuenta en la cobertura de huella
  const z2 = ajusteDeZona({ ...pf, variables: ['a', 'b', 'c'], objetivo: { ...pf.objetivo, c: 0 }, tolerancia: { ...pf.tolerancia, c: 1 } },
    { a: [0], b: [null], c: [null] });
  assert.equal(z2.celdas, 0);
  assert.equal(z2.sin_datos, 1);
  // sin regiones clasificadas la calidad es neutra (0,5), pero propaga incertidumbre [0,1..1,0] (9 pts) al rango
  const base = { ok: 5, n: 5, cerc: 0.9, sin: 0, wideras: 0, k: 50, nEsc: 60 };
  const sinCal = puntuar({ ...base, calidad: { alta: 0, media: 0, baja: 0 } });
  const conCal = puntuar({ ...base, calidad: { alta: 1, media: 2, baja: 0 } }); // q = 2/3 != 0.5, pero probemos q = 0.5 exacto:
  const conCalMedia = puntuar({ ...base, calidad: { alta: 0, media: 1, baja: 0 } });
  assert.equal(sinCal.componentes.calidad, 5);
  assert.equal(conCalMedia.componentes.calidad, 5);
  assert.ok(sinCal.alto - sinCal.bajo >= (conCalMedia.alto - conCalMedia.bajo) + 8, 'sin regiones clasificadas el rango abre por calidad [0,1..1,0]');
  assert.ok(conCal.bajo <= conCal.puntaje_bruto && conCal.puntaje_bruto <= conCal.alto);
  // cobertura sesgada (75 % completas, 25 % a medias): bajo <= puntaje_bruto <= alto se mantiene
  const sesgada = ajusteDeZona(pf, { a: [0, 0, 0, 0], b: [10, 10, 10, null], ndvi_media: [0.1, 0.1, 0.1, 0.1] }, 0.3);
  const rSesg = puntuar({ ...base, k: 200, nEsc: 200, calidad: { alta: 3, media: 0, baja: 0 }, zona: sesgada });
  assert.ok(rSesg.bajo <= rSesg.puntaje_bruto && rSesg.puntaje_bruto <= rSesg.alto, JSON.stringify(rSesg));
  // pocas celdas elegibles: aunque el ajuste sea alto, el nivel no pasa de media
  const zonaBuena = { p25: 0.9, mediana: 0.95, p75: 1, celdas: 14 };
  const r = puntuar({ ...base, k: 58, calidad: { alta: 3, media: 0, baja: 0 }, zona: zonaBuena, pocasElegibles: true });
  assert.equal(r.nivel, 'media');
  assert.equal(puntuar({ ...base, k: 58, calidad: { alta: 3, media: 0, baja: 0 }, zona: zonaBuena }).nivel, 'alta');
});

test('robustezAAreas guarda los escenarios del objetivo', async () => {
  const { robustezAAreas, robustezTodosAAreas } = await import('./nucleo.mjs');
  const rob = { n_escenarios: 5, escenarios: [{ objetivo: 'SL-20' }, { objetivo: 'SL-20' }, { objetivo: 'SL-20' }, { objetivo: 'SL-12' }, { objetivo: 'SL-12' }],
    robustez: { 'SL-20': [{ lat: 1, lon: 2, s_mediana: 1, fraccion: 1, aparece_en: 3 }], 'SL-12': [{ lat: 3, lon: 4, s_mediana: 1, fraccion: 0.5, aparece_en: 1 }] } };
  assert.equal(robustezAAreas(rob, { objetivo: 'SL-20', radio_km: 50 }, 'B1')[0].n_escenarios, 3);
  const todas = robustezTodosAAreas(rob, { id: 'G', corrida: 'x', radio_km: 50, top: 1 });
  assert.deepEqual(todas.map((a) => a.n_escenarios), [3, 2]);
});


test('confianza: variablesSupuestas y variablesModeladas detectan casos_agy, casos_orquestador y barrido 3', async () => {
  const { variablesSupuestas, variablesModeladas, HIELO_PERFILES } = await import('./confianza.mjs');
  const casos = [
    {
      id: 'X-1',
      a_priori: [
        { variable: 'aridez_ai', razon: 'Suposición: hiperárido sin lluvia' },
        { variable: 'aster_mi', razon: 'suposicion sin tilde y en minúsculas' },
        { variable: 'viento_frac_tau_gt_0p05', razon: 'Modelo, no medición (2026-11-13)' },
        { variable: 'polvo_frec_dod0p2_pct', razon: 'Marte tiene polvo (supuesto aparte)' },
        { variable: 'permafrost_prob', razon: 'Sitio con hielo somero (supuesto, no verificado).' },
        { variable: 'arcilla_gkg', razon: 'Sitio con hielo somero' },
      ],
    },
  ];
  assert.deepEqual(variablesSupuestas('caso_X-1', casos, HIELO_PERFILES), ['aridez_ai', 'aster_mi', 'permafrost_prob']);
  assert.deepEqual(variablesModeladas('caso_X-1', casos), ['viento_frac_tau_gt_0p05']);
  assert.deepEqual(variablesSupuestas('terreno_termico', casos, HIELO_PERFILES), []);
  assert.deepEqual(variablesModeladas('terreno_termico', casos), []);
  const varsB3 = ['slope_mean_deg', 'rug_rms_mean_m', 'relieve_p90_m', 'dtr_k', 'amp_anual_k', 'permafrost_prob', 'hielo_suelo_gam', 'aster_mi'];
  assert.deepEqual(variablesSupuestas('hielo_basalto', [], HIELO_PERFILES, varsB3), ['permafrost_prob', 'hielo_suelo_gam', 'aster_mi']);
  assert.deepEqual(variablesSupuestas('crater_hielo_alterado', [], HIELO_PERFILES), ['permafrost_prob', 'hielo_suelo_gam', 'arcilla_gkg', 'aster_ci']);
});

test('confianza: topes epistémicos (supuestas y modeladas) y robustez sin doble castigo', async () => {
  const { puntuar } = await import('./confianza.mjs');
  const base = { ok: 6, n: 6, cerc: 0.95, sin: 0, wideras: 0, k: 190, nEsc: 200, calidad: { alta: 3, media: 2, baja: 0 } };
  const sinSup = puntuar(base);
  assert.deepEqual(puntuar({ ...base, supuestas: 0, modeladas: 0 }), sinSup);
  assert.equal(sinSup.nivel, 'alta');
  assert.equal(sinSup.evidencia_objetivo, 1);

  // Robustez 3/3 da 20/20 en el puntaje bruto, pero Wilson inferior (<0,7) sigue limitando a media y abre el rango
  const r3 = puntuar({ ...base, k: 3, nEsc: 3 });
  assert.equal(r3.componentes.robustez, 20);
  assert.equal(r3.nivel, 'media');
  assert.ok(r3.alto - r3.bajo >= 10, JSON.stringify(r3));

  const conMod = puntuar({ ...base, modeladas: 2 });
  assert.equal(conMod.nivel, 'media');
  assert.ok(conMod.puntaje <= 64 && conMod.puntaje_bruto > 64);
  assert.ok(conMod.limitantes.some((l) => /2 de 6.*modelo climático/.test(l)));

  const con1 = puntuar({ ...base, supuestas: 1 });
  assert.equal(con1.nivel, 'media');
  assert.ok(con1.puntaje <= 64 && con1.puntaje_bruto > 64);
  assert.ok(con1.limitantes.some((l) => /1 de 6.*supuesto/.test(l)));

  // Caso mixto tipo A-07: 1 supuesta + 2 modeladas de 6. Lo modelado no cuenta como supuesto: queda en media, no baja.
  const mixto = puntuar({ ...base, supuestas: 1, modeladas: 2 });
  assert.equal(mixto.nivel, 'media');
  assert.ok(mixto.puntaje <= 64);
  assert.equal(mixto.evidencia_objetivo, 0.717);
  // pasar dos supuestos a modelo nunca empeora el nivel
  assert.ok(['baja', 'media', 'alta'].indexOf(puntuar({ ...base, supuestas: 3 }).nivel) <= ['baja', 'media', 'alta'].indexOf(mixto.nivel));

  const con3 = puntuar({ ...base, supuestas: 3 });
  assert.equal(con3.nivel, 'baja');
  assert.ok(con3.puntaje <= 39 && con3.puntaje_bruto > 64);
  assert.ok(con3.limitantes.some((l) => /3 de 6.*supuesto/.test(l)));
});

test('normalizarArea valida caja y polígono', async () => {
  const { normalizarArea } = await import('./nucleo.mjs');
  assert.equal(normalizarArea(undefined), null);
  assert.deepEqual(normalizarArea({ tipo: 'bbox', bbox: [-25, -70, -21, -66] }).bbox, [-25, -70, -21, -66]);
  assert.ok(normalizarArea({ tipo: 'bbox', bbox: [60, 170, 70, -170] }), 'cruza ±180°');
  assert.throws(() => normalizarArea({ tipo: 'bbox', bbox: [-21, -70, -25, -66] }), /lat1/);
  assert.throws(() => normalizarArea({ tipo: 'bbox', bbox: [-25, -70, 95, -66] }), /bbox/);
  const pol = normalizarArea({ tipo: 'poligono', anillo: [[0, 0], [10, 0], [10, 10]] });
  assert.equal(pol.anillo.length, 4, 'se cierra el anillo');
  assert.deepEqual(pol.anillo[0], pol.anillo[3]);
  assert.equal(normalizarArea({ tipo: 'poligono', anillo: [[0, 0], [10, 0], [10, 10], [0, 0]] }).anillo.length, 4);
  assert.throws(() => normalizarArea({ tipo: 'poligono', anillo: [[0, 0], [1, 1]] }), /vértices/);
  assert.throws(() => normalizarArea({ tipo: 'poligono', anillo: [[0, 0], [1, 1], [200, 0]] }), /lon, lat/);
  assert.throws(() => normalizarArea({ tipo: 'circulo' }), /desconocido/);
});

test('argsArea arma las banderas del motor y errorDelMotor extrae el mensaje', async () => {
  const { argsArea, errorDelMotor, resumenArea } = await import('./nucleo.mjs');
  assert.deepEqual(argsArea({ area: null }, '.'), []);
  assert.deepEqual(argsArea({ area: { tipo: 'bbox', bbox: [-25, -70, -21, -66] }, k_area: 0.15, min_area_km2: 40000 }, '.'),
    ['--bbox', '-25,-70,-21,-66', '--k-area', '0.15', '--min-area-km2', '40000']);
  assert.equal(errorDelMotor('cargando…\nError: área demasiado pequeña: 900 km²\n', 1), 'motor: área demasiado pequeña: 900 km²');
  assert.equal(errorDelMotor('nada', 3), 'pipeline salió con código 3');
  assert.equal(resumenArea({ celdas_en_area: 10 }, { area: null }), null);
  const r = resumenArea({ celdas_en_area: 1000, regiones_con_tierra: 5, sin_celdas_por_ndvi: 2 }, { area: { tipo: 'bbox', bbox: [0, 0, 1, 1] }, k_area: 0.15, min_area_km2: 0 });
  assert.equal(r.regiones_con_tierra, 5);
  assert.ok(r.tierra_km2 > 2000 && r.tierra_km2 < 3000, 'nivel 12: ~2,5 km² por celda');
});

test('zona del mapa: prepararArgsBusquedaConZona guarda el piso de 15 000 km² y submuestrea vértices', async () => {
  const { prepararArgsBusquedaConZona } = await import('./explicacion.mjs');
  const chica = { nombre: 'Caja 500 km²', area_km2: 500, coords: [{ lat: -24, lon: -70 }, { lat: -24, lon: -69.5 }, { lat: -23.5, lon: -69.5 }] };
  assert.throws(() => prepararArgsBusquedaConZona({ objetivo: 'SL-12' }, chica), /demasiado pequeña|analizar_zona_mapa/);

  const grandeCoords = Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2;
    return { lat: -24 + Math.sin(a) * 1.2, lon: -69 + Math.cos(a) * 1.2 };
  });
  const conZona = prepararArgsBusquedaConZona({ objetivo: 'SL-12' }, { nombre: 'Grande', area_km2: 45000, coords: grandeCoords });
  assert.equal(conZona.min_area_km2, 0);
  assert.equal(conZona.area.tipo, 'poligono');
  assert.ok(conZona.area.anillo.length <= 180, `vértices submuestreados: ${conZona.area.anillo.length}`);
  assert.equal(normalizarParams(conZona).area.tipo, 'poligono');
});

test('zona del mapa: analizarZonaMapa valida geometría básica', async () => {
  const { analizarZonaMapa } = await import('./explicacion.mjs');
  await assert.rejects(() => analizarZonaMapa({ coords: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] }), /al menos 3/);
  await assert.rejects(() => analizarZonaMapa({ coords: [{ lat: 95, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 0 }] }), /inválidas/);
});

test('zona del mapa: analizarZonaMapa en tabla maestra real (caja pequeña, ultra-chica y ±180°)', { skip: !process.env.ANALOGOS_RUN && !existsSync('D:/PP/ANALOGOS-run/etl/maestro/lat.f32') }, async () => {
  const { analizarZonaMapa } = await import('./explicacion.mjs');
  // 1) Caja pequeña en Atacama (~500 km², menor a 4 regiones de pipeline.exe)
  const atacama = await analizarZonaMapa({
    id: 'z-atacama',
    nombre: 'Cuadro Atacama',
    area_km2: 500,
    coords: [
      { lat: -24.2, lon: -70.2 },
      { lat: -24.2, lon: -70.0 },
      { lat: -24.0, lon: -70.0 },
      { lat: -24.0, lon: -70.2 },
    ],
  });
  assert.equal(atacama.error, undefined);
  assert.equal(atacama.puede_correr_motor_rust_directo, false);
  assert.ok(atacama.muestreo.celdas_muestra >= 1);
  assert.ok(atacama.mejores_objetivos_estandar.length >= 1);
  assert.ok(atacama.mejores_casos_operativos.length >= 1, 'evalúa perfiles caso_* operativos');
  assert.equal(typeof atacama.casos_de_uso_en_zona.rover_celdas_elegibles, 'number');
  assert.notEqual(atacama.resumen_fisico_y_filtros.aster_mi, null, 'incluye índices ASTER y filtros completos');
  assert.ok(atacama.areas_ya_catalogadas_cerca.some((a) => a.id === 'ST-13'), 'encuentra Atacama ST-13');

  // 2) Caja diminuta (< 100 m): cae al respaldo celda_mas_cercana_zona_chica o captura la única celda
  const mini = await analizarZonaMapa({
    nombre: 'Micro-caja',
    area_km2: 0.01,
    coords: [
      { lat: -24.1021, lon: -70.1381 },
      { lat: -24.1021, lon: -70.1380 },
      { lat: -24.1020, lon: -70.1380 },
      { lat: -24.1020, lon: -70.1381 },
    ],
  });
  assert.equal(mini.error, undefined);
  assert.ok(mini.muestreo.celdas_muestra >= 1);
  assert.ok(['poligono', 'celda_mas_cercana_zona_chica'].includes(mini.muestreo.modo));

  // 3) Polígono cruzando el antimeridiano (±180°) en Fiyi / Taveuni — NO debe escanear medio planeta
  const anti = await analizarZonaMapa({
    nombre: 'Antimeridiano ±180',
    area_km2: 1200,
    coords: [
      { lat: -16.95, lon: 179.85 },
      { lat: -16.95, lon: -179.85 },
      { lat: -16.70, lon: -179.85 },
      { lat: -16.70, lon: 179.85 },
    ],
  });
  assert.equal(anti.error, undefined);
  assert.ok(anti.muestreo.total_celdas_en_zona < 2000, `no abarcó la banda global: ${anti.muestreo.total_celdas_en_zona}`);
});
