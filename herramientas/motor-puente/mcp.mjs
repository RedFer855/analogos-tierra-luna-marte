// Servidor MCP (stdio, JSON-RPC por líneas, sin dependencias). Mismas funciones que la API HTTP.
import { createInterface } from 'node:readline';
import { explicar } from './explicacion.mjs';
import { listarAreas, obtenerArea, agregarArea, listarObjetivos, lanzarBusqueda, lanzarBarrido, estadoBusqueda } from './nucleo.mjs';

const esquema = (props, req = []) => ({ type: 'object', properties: props, required: req });
const HERRAMIENTAS = {
  listar_areas: {
    descripcion: 'Lista los pines de áreas análogas (hallado = documentado/verificado, candidato = barridos previos sin verificar, nuevo = búsquedas hechas aquí). Filtro opcional por grupo.',
    esquema: esquema({ grupo: { type: 'string', enum: ['hallado', 'candidato', 'nuevo'] } }),
    f: (a) => listarAreas(a),
  },
  obtener_area: {
    descripcion: 'Devuelve un área con su polígono (Feature GeoJSON) y sus métricas.',
    esquema: esquema({ id: { type: 'string' } }, ['id']),
    f: (a) => obtenerArea(a.id) ?? { error: 'área no encontrada' },
  },
  explicar_area: {
    descripcion: 'Explica un área en lenguaje natural: lugar y país, parecido del motor en %, en qué coincide y en qué difiere (datos reales de la tabla maestra). ia=true usa DeepSeek si hay clave en .env.',
    esquema: esquema({ id: { type: 'string' }, ia: { type: 'boolean' } }, ['id']),
    f: async (a) => (await explicar(a.id, { ia: a.ia === true })) ?? { error: 'área no encontrada' },
  },
  agregar_area: {
    descripcion: 'Guarda un hallazgo como candidato-sin-verificar en indice_hallazgos.json. No toca indice_43.json.',
    esquema: esquema({ id: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, radio_km: { type: 'number' },
      fuente: { type: 'string' }, etiqueta: { type: 'string' }, resumen: { type: 'string' } }, ['id', 'lat', 'lon', 'radio_km', 'fuente']),
    f: (a) => agregarArea({ ...a, origen: 'mcp' }),
  },
  listar_objetivos: {
    descripcion: 'Sitios objetivo (SL-NN) y perfiles disponibles para una búsqueda.',
    esquema: esquema({}),
    f: () => listarObjetivos(),
  },
  lanzar_busqueda: {
    descripcion: 'Lanza pipeline.exe con parámetros validados (un trabajo a la vez, hilos limitados). variables: subconjunto del perfil (vacío = todas); pesos: {variable: 0..10}, las no nombradas pesan 1. Devuelve un id; consulta estado_busqueda.',
    esquema: esquema({ objetivo: { type: 'string' }, perfil: { type: 'string' }, factores: { type: 'array', items: { type: 'number' } },
      ndvi_max: { type: 'number' }, candidatos: { type: 'number' }, separacion_km: { type: 'number' }, excluir_indice: { type: 'boolean' },
      radio_km: { type: 'number' }, variables: { type: 'array', items: { type: 'string' } },
      pesos: { type: 'object', additionalProperties: { type: 'number' } } }, ['objetivo']),
    f: (a) => lanzarBusqueda(a),
  },
  lanzar_barrido: {
    descripcion: 'Varias corridas seguidas con los escenarios ya medidos (hasta 1000), cada una con variables o casos distintos, excluyendo lo ya hallado por excluir_km (500 por defecto). Consulta estado_busqueda con el id.',
    esquema: esquema({ excluir_km: { type: 'number' }, max_escenarios: { type: 'number' }, top_por_objetivo: { type: 'number' }, corridas: { type: 'array', items: { type: 'string' } } }),
    f: (a) => lanzarBarrido(a),
  },
  estado_busqueda: {
    descripcion: 'Estado de una búsqueda; al terminar, sus áreas aparecen en listar_areas con grupo "nuevo".',
    esquema: esquema({ id: { type: 'string' } }, ['id']),
    f: (a) => estadoBusqueda(a.id) ?? { error: 'búsqueda no encontrada' },
  },
};

const enviar = (o) => process.stdout.write(JSON.stringify(o) + '\n');

createInterface({ input: process.stdin }).on('line', async (linea) => {
  let m;
  try { m = JSON.parse(linea); } catch { return; }
  const { id, method, params } = m;
  if (id === undefined) return; // notificaciones
  const ok = (result) => enviar({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') {
    return ok({ protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'motor-puente', version: '0.1.0-ensayo' } });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') {
    return ok({ tools: Object.entries(HERRAMIENTAS).map(([name, h]) => ({ name, description: h.descripcion, inputSchema: h.esquema })) });
  }
  if (method === 'tools/call') {
    const h = HERRAMIENTAS[params?.name];
    if (!h) return enviar({ jsonrpc: '2.0', id, error: { code: -32602, message: 'herramienta desconocida' } });
    try {
      return ok({ content: [{ type: 'text', text: JSON.stringify(await h.f(params.arguments ?? {})) }] });
    } catch (e) {
      return ok({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] });
    }
  }
  enviar({ jsonrpc: '2.0', id, error: { code: -32601, message: 'método no soportado' } });
});
