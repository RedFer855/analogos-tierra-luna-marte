// API HTTP local para el visor. Solo 127.0.0.1. ENSAYO (ADR-005).
// Uso: node servidor.mjs   (puerto 5174, o PUERTO=...)
import { createServer } from 'node:http';
import { confianzas } from './confianza.mjs';
import { explicar, iaDisponible, estadoConfig, guardarConfig, borrarClave, chat, hablar, topMultivariable, analizarZonaMapa } from './explicacion.mjs';
import { listarAreas, obtenerArea, agregarArea, limpiarBusquedas, listarObjetivos, lanzarBusqueda, lanzarBarrido, estadoBusqueda, RUTAS } from './nucleo.mjs';

const PUERTO = Number(process.env.PUERTO || 5174);
const ORIGENES = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const ES_ORIGEN_LOCAL = (o) =>
  typeof o === 'string' && (ORIGENES.has(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));

function responder(res, origen, codigo, cuerpo) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' };
  if (ES_ORIGEN_LOCAL(origen)) {
    h['Access-Control-Allow-Origin'] = origen;
    h['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Motor-Puente';
  }
  res.writeHead(codigo, h);
  res.end(JSON.stringify(cuerpo));
}

const leerCuerpo = (req) => new Promise((ok, mal) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 200000) { mal(new Error('cuerpo muy grande')); req.destroy(); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { mal(e); } });
});

createServer(async (req, res) => {
  const origen = req.headers.origin;
  // Un sitio web cualquiera no debe poder lanzar búsquedas en la PC: se exige origen local del visor o ninguno (curl/MCP).
  if (origen && !ES_ORIGEN_LOCAL(origen)) return responder(res, origen, 403, { error: 'origen no permitido' });
  if (req.method === 'OPTIONS') return responder(res, origen, 204, {});
  const url = new URL(req.url, 'http://x');
  const ruta = url.pathname;
  try {
    if (req.method === 'GET' && ruta === '/api/salud') return responder(res, origen, 200, { ok: true, pipeline: RUTAS.pipeline, ia_disponible: iaDisponible() });
    if (req.method === 'GET' && ruta === '/api/areas') return responder(res, origen, 200, listarAreas({ grupo: url.searchParams.get('grupo') ?? undefined }));
    if (req.method === 'GET' && ruta === '/api/top') return responder(res, origen, 200, await topMultivariable(Number(url.searchParams.get('n') ?? 3)));
    if (req.method === 'GET' && ruta === '/api/confianza') return responder(res, origen, 200, confianzas());
    if (req.method === 'GET' && ruta === '/api/objetivos') return responder(res, origen, 200, listarObjetivos());
    let m;
    if (req.method === 'GET' && (m = ruta.match(/^\/api\/areas\/([\w.-]+)$/))) {
      const a = obtenerArea(m[1]);
      return a ? responder(res, origen, 200, a) : responder(res, origen, 404, { error: 'área no encontrada' });
    }
    if (req.method === 'GET' && (m = ruta.match(/^\/api\/areas\/([\w.-]+)\/explicacion$/))) {
      const e = await explicar(m[1], { ia: url.searchParams.get('ia') === '1' });
      return e ? responder(res, origen, 200, e) : responder(res, origen, 404, { error: 'área no encontrada' });
    }
    if (req.method === 'GET' && ruta === '/api/config') return responder(res, origen, 200, estadoConfig());
    if (req.method === 'POST' && (ruta === '/api/config' || ruta === '/api/config/borrar' || ruta === '/api/chat' || ruta === '/api/voz' || ruta === '/api/zona/analizar')) {
      // Cabecera propia: obliga a una petición CORS previa y descarta formularios de otras páginas.
      if (req.headers['x-motor-puente'] !== '1') return responder(res, origen, 400, { error: 'falta la cabecera X-Motor-Puente' });
      const c = await leerCuerpo(req);
      if (ruta === '/api/zona/analizar') return responder(res, origen, 200, await analizarZonaMapa(c));
      if (ruta === '/api/config') return responder(res, origen, 200, guardarConfig({ clave: c.clave, modelo: c.modelo, clave_deepgram: c.clave_deepgram, voz: c.voz, velocidad: c.velocidad }));
      if (ruta === '/api/config/borrar') return responder(res, origen, 200, borrarClave(c.cual));
      if (ruta === '/api/voz') {
        const { audio, tipo } = await hablar(c.texto, c.ritmo);
        const h = { 'Content-Type': tipo, 'Cache-Control': 'no-store', Vary: 'Origin' };
        if (ES_ORIGEN_LOCAL(origen)) h['Access-Control-Allow-Origin'] = origen;
        res.writeHead(200, h);
        return res.end(audio);
      }
      return responder(res, origen, 200, await chat(c.mensajes, { areaId: c.area_id, ranking: c.ranking ?? null, zonaMapa: c.zona_mapa ?? null }));
    }
    if (req.method === 'POST' && ruta === '/api/areas/limpiar') {
      if (req.headers['x-motor-puente'] !== '1') return responder(res, origen, 400, { error: 'falta la cabecera X-Motor-Puente' });
      return responder(res, origen, 200, { ok: true, ...limpiarBusquedas() });
    }
    if (req.method === 'POST' && ruta === '/api/areas') return responder(res, origen, 201, agregarArea(await leerCuerpo(req)));
    if (req.method === 'POST' && ruta === '/api/barridos') return responder(res, origen, 202, lanzarBarrido(await leerCuerpo(req)));
    if (req.method === 'POST' && ruta === '/api/busquedas') return responder(res, origen, 202, lanzarBusqueda(await leerCuerpo(req)));
    if (req.method === 'GET' && (m = ruta.match(/^\/api\/busquedas\/(\w+)$/))) {
      const e = estadoBusqueda(m[1]);
      return e ? responder(res, origen, 200, e) : responder(res, origen, 404, { error: 'búsqueda no encontrada' });
    }
    responder(res, origen, 404, { error: 'ruta desconocida' });
  } catch (e) {
    responder(res, origen, 400, { error: String(e.message ?? e) });
  }
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`puente del motor en http://127.0.0.1:${PUERTO}`);
  setImmediate(() => {
    try { confianzas(); } catch (e) { console.warn('[motor-puente] precarga de confianzas:', e?.message ?? e); }
  });
});
