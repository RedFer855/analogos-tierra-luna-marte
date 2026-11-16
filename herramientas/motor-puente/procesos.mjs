// Etiquetas de procesos y usos por reglas declaradas en procesos.json (ensayo, ADR-005). Sin E/S: funciones puras.
// Una etiqueta se dispara si se cumple alguna alternativa de `si`; cada alternativa exige todas sus condiciones.
// Un dato faltante (null, undefined o NaN) nunca cumple.

const finito = (x) => typeof x === 'number' && Number.isFinite(x);

/** Columnas que usa una regla (para leerlas y para saber si hubo dato). */
export function columnasDe(regla) {
  return [...new Set(regla.si.flatMap((alt) => Object.keys(alt)))];
}

/** Cuantiles terrestres que piden las reglas: { columna: [q, ...] }. */
export function cuantilesPedidos(reglas) {
  const out = {};
  for (const r of [...reglas.procesos, ...reglas.usos])
    for (const alt of r.si)
      for (const [col, ops] of Object.entries(alt))
        for (const op of ['gte_q', 'lt_q']) if (op in ops) (out[col] ??= new Set()).add(ops[op]);
  return Object.fromEntries(Object.entries(out).map(([c, s]) => [c, [...s].sort((a, b) => a - b)]));
}

/** ¿Cumple el valor x las operaciones de una condición? `q` = { columna: { cuantil: valor } }. */
export function cumpleCondicion(col, ops, x, q = {}) {
  if (!finito(x)) return false;
  for (const [op, v] of Object.entries(ops)) {
    if (op === 'lt' && !(x < v)) return false;
    if (op === 'lte' && !(x <= v)) return false;
    if (op === 'gt' && !(x > v)) return false;
    if (op === 'gte' && !(x >= v)) return false;
    if (op === 'en' && !v.includes(Math.round(x))) return false;
    if (op === 'gte_q' || op === 'lt_q') {
      const umbral = q[col]?.[v];
      if (!finito(umbral)) throw new Error(`falta el cuantil ${v} de ${col}`);
      if (op === 'gte_q' && !(x >= umbral)) return false;
      if (op === 'lt_q' && !(x < umbral)) return false;
    }
    if (!['lt', 'lte', 'gt', 'gte', 'en', 'gte_q', 'lt_q'].includes(op)) throw new Error(`operador desconocido: ${op}`);
  }
  return true;
}

/**
 * Evalúa una regla en una celda. `valor(col)` devuelve el dato de la celda.
 * Devuelve { dispara, con_dato, evidencia }: con_dato = alguna alternativa tuvo todas sus columnas;
 * evidencia = valores de la primera alternativa que se cumplió.
 */
export function evaluarRegla(regla, valor, q = {}) {
  let conDato = false;
  for (const alt of regla.si) {
    const cols = Object.keys(alt);
    const vals = Object.fromEntries(cols.map((c) => [c, valor(c)]));
    if (cols.every((c) => finito(vals[c]))) conDato = true;
    if (cols.every((c) => cumpleCondicion(c, alt[c], vals[c], q))) return { dispara: true, con_dato: true, evidencia: vals };
  }
  return { dispara: false, con_dato: conDato, evidencia: null };
}

/** Todas las etiquetas de una celda: { procesos: [{id, evidencia}], usos: [...], sin_dato: [ids] }. */
export function etiquetarCelda(reglas, valor, q = {}) {
  const out = { procesos: [], usos: [], sin_dato: [] };
  for (const [tipo, lista] of [['procesos', reglas.procesos], ['usos', reglas.usos]])
    for (const r of lista) {
      const e = evaluarRegla(r, valor, q);
      if (e.dispara) out[tipo].push({ id: r.id, evidencia: e.evidencia });
      else if (!e.con_dato) out.sin_dato.push(r.id);
    }
  return out;
}

/**
 * Etiquetas de una ventana: cuenta celdas con dato y celdas que disparan por regla.
 * Dispara si frac >= ventana.frac_min con al menos ventana.celdas_min_con_dato celdas con dato; si no hay bastantes, 'sin_dato'.
 */
export function etiquetarVentana(reglas, celdas, q = {}) {
  const { frac_min, celdas_min_con_dato } = reglas.ventana;
  const res = {};
  for (const r of [...reglas.procesos, ...reglas.usos]) {
    let con = 0, si = 0;
    for (const valor of celdas) {
      const e = evaluarRegla(r, valor, q);
      if (e.con_dato) con++;
      if (e.dispara) si++;
    }
    const frac = con ? si / con : 0;
    res[r.id] = { con_dato: con, disparan: si, frac, estado: con < celdas_min_con_dato ? 'sin_dato' : frac >= frac_min ? 'si' : 'no' };
  }
  return res;
}

/** Cuantil q (0 a 100) de una muestra, por interpolación lineal entre órdenes. */
export function cuantil(muestra, q) {
  const v = muestra.filter(finito).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const p = (q / 100) * (v.length - 1), i = Math.floor(p), f = p - i;
  return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i];
}
