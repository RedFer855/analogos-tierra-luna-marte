// Dirección de voz: marcas ocultas ([pausa], [lento]…) que el modelo escribe y que NO se muestran en el chat.
// Deepgram Aura-2 no tiene SSML, etiquetas de emoción ni control de pausas (documentación leída 2026-11-13);
// lo único que expone es `speed`. Por eso las "emociones" se traducen a ritmo por frase y silencios entre frases.
// Funciones puras (sin red ni .env) para poder probarlas.

// Relativos: se multiplican por la velocidad general (Ajustes, 1,15 por omisión). Deepgram admite speed 0.7–1.5.
export const RITMOS = { normal: 1.0, lento: 0.9, suave: 0.95, animado: 1.15 };
export const PAUSAS = { pausa: 180, 'pausa larga': 400 };
const VALIDAS = /^(pausa larga|pausa|lento|suave|animado|normal)$/i;

/** Quita cualquier [marca] corta del texto (las válidas y las que el modelo invente). */
export function limpiarTexto(t) {
  return String(t ?? '').replace(/\[[^\]\n]{1,24}\]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/ {2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim();
}

/** Texto apto para locución: sin markdown, con unidades y decimales dichos como se leen en español. */
export function paraVoz(t) {
  return String(t ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$|[.,;])/g, '$1$2')
    .replace(/^\s*[-•]\s+/gm, '').replace(/^#+\s*/gm, '')
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(/(\d)\s*°/g, '$1 grados').replace(/(\d)\s*K\b/g, '$1 kelvin').replace(/(\d)\s*m\b/g, '$1 metros')
    .replace(/(\d)\s*km\b/g, '$1 kilómetros').replace(/(\d)\s*%/g, '$1 por ciento').replace(/×\s*(\d)/g, 'por $1')
    .replace(/(\d)×/g, '$1 veces').replace(/±/g, 'más o menos ')
    .replace(/\s+/g, ' ').trim();
}

/** Parte un texto en trozos de frases de hasta `max` caracteres (Deepgram admite 2000 por petición). */
export function partirFrases(texto, max = 220) {
  const frases = texto.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const trozos = [];
  let acc = '';
  for (const f of frases) {
    if (acc && (acc + ' ' + f).length > max) { trozos.push(acc); acc = f; } else acc = acc ? `${acc} ${f}` : f;
  }
  if (acc) trozos.push(acc);
  return trozos.flatMap((t) => (t.length > 1800 ? t.match(/.{1,1800}/g) : [t]));
}

/** Parte el primer trozo en una coma o punto cercano (≈1 s de espera por cada 30 caracteres en Deepgram). */
export function afinarPrimero(guion, tope = 90) {
  const p = guion[0];
  if (!p || p.t.length <= tope) return guion;
  const corte = p.t.slice(20, tope + 25).search(/[.;:,]\s/);
  if (corte < 0) return guion;
  const i = 20 + corte + 1;
  return [{ ...p, t: p.t.slice(0, i).trim(), pausa_ms: 0 }, { ...p, t: p.t.slice(i).trim() }, ...guion.slice(1)];
}

/**
 * Texto con marcas -> { texto: lo que se ve, guion: [{ t, ritmo, pausa_ms }] }.
 * Una marca de ritmo vale hasta la siguiente; [pausa]/[pausa larga] añaden silencio tras el trozo anterior.
 */
export function aGuion(conMarcas) {
  const normal = String(conMarcas ?? '').replace(/\[([^\]\n]{1,24})\]/g, (m, x) => (VALIDAS.test(x.trim()) ? `[${x.trim().toLowerCase()}]` : ''));
  const guion = [];
  let ritmo = 'normal';
  for (const parte of normal.split(/(\[(?:pausa larga|pausa|lento|suave|animado|normal)\])/)) {
    const m = parte.match(/^\[(.+)\]$/);
    if (m) {
      if (m[1] in PAUSAS) { if (guion.length) guion.at(-1).pausa_ms = Math.max(guion.at(-1).pausa_ms, PAUSAS[m[1]]); }
      else ritmo = m[1];
    } else {
      const voz = paraVoz(parte);
      if (voz) for (const t of partirFrases(voz)) guion.push({ t, ritmo, pausa_ms: 0 });
    }
  }
  return { texto: limpiarTexto(conMarcas), guion: afinarPrimero(guion) };
}

/** Guion por defecto (sin IA) a partir del markdown de la plantilla: pausas por párrafo y viñeta, notas en tono suave. */
export function guionDesdePlantilla(md) {
  const guion = [];
  for (const linea of String(md ?? '').split('\n')) {
    const l = linea.trim();
    if (!l) continue;
    const viñeta = l.startsWith('- ');
    const nota = /^_.+_$/.test(l);
    const titulo = /^\*\*[^*]+\*\*$/.test(l);
    const t = paraVoz(l);
    if (!t) continue;
    const trozos = partirFrases(t);
    trozos.forEach((x, i) => guion.push({ t: x, ritmo: nota ? 'suave' : 'normal', pausa_ms: i < trozos.length - 1 ? 0 : titulo ? 250 : viñeta ? 150 : 300 }));
  }
  return afinarPrimero(guion);
}
