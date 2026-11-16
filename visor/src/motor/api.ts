// Cliente del puente local del motor (herramientas/motor-puente). ENSAYO (ADR-005).
import type { AreaBusqueda } from './areaGeo';

export type Grupo = 'hallado' | 'candidato' | 'nuevo';

export interface AreaPin {
  id: string;
  lat: number;
  lon: number;
  radio_km: number;
  estado: string;
  grupo: Grupo;
  etiqueta: string;
  resumen: string | null;
  nombre: string | null;
  objetivo: string | null;
  objetivo_nombre: string | null;
  parecido_pct: number | null;
}

export interface AreaFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: Record<string, unknown> & { id: string; grupo: Grupo };
}

export interface Objetivo {
  id: string;
  nombre: string;
  cuerpo: string;
  perfiles: string[];
}

export interface VariableHecho {
  variable: string;
  nombre: string;
  unidad: string;
  aqui: number | null;
  objetivo: number;
  tolerancia: number;
  coincide: boolean | null;
  cercania_pct: number | null;
  veces_tolerancia: number | null;
  direccion: string | null;
  el_objetivo_supera_la_tierra: string | null;
}

export interface Minerales {
  fuentes: string;
  roca?: { clase: number; codigo: string; nombre: string; nota: string };
  aster: { columna: string; nombre: string; valor: number | null; percentil?: number; lectura?: string; pista: string }[];
  emit: { cobertura: boolean; nota: string; minerales: { columna: string; nombre: string; valor: number; percentil: number }[] };
  suelo: { columna: string; nombre: string; valor: number | null; unidad: string; percentil: number | null }[];
}

export interface VientoShields {
  cuerpo: string;
  tierra_arrastre_pct: number | null;
  tierra_inicio_pct: number | null;
  tierra_ustar_ms: number | null;
  tierra_tau_pa: number | null;
  marte_arrastre_pct: number | null;
  marte_cota_baja_pct: number | null;
  marte_u_media_ms: number | null;
  marte_u_max_ms: number | null;
  marte_tau_max_pa: number | null;
  /** % con τ > 0,01 Pa si la superficie fuera lisa (z0 0,001 m): el otro extremo del rango. */
  marte_arrastre_z0_liso_pct: number | null;
  /** Por qué el dato de Marte es una cota inferior y no se compara 1:1 con la Tierra. */
  advertencia: string | null;
}

export interface PolvoFinos {
  dod02_pct: number | null;
  dod05_pct: number | null;
  emision_kg_m2_s: number | null;
  arcilla_pct: number | null;
  limo_pct: number | null;
  fino_lt50_pct: number | null;
  nivel_polvo: 'muy-polvoso' | 'moderado' | 'bajo' | null;
}

export type NivelConfianza = 'alta' | 'media' | 'baja' | 'referencia';

export interface Confianza {
  nivel: NivelConfianza;
  puntaje?: number;
  puntaje_bruto?: number;
  bajo_bruto?: number;
  alto_bruto?: number;
  bajo?: number;
  alto?: number;
  limitantes?: string[];
  componentes?: Record<string, number>;
  puntos?: Record<string, number>;
  robustez_rango?: [number, number];
  /** Ajuste (0..1) de la celda central y su reparto en el círculo del área; el puntaje usa la mediana del círculo. */
  ajuste_centro?: number;
  ajuste_zona?: { p25: number; mediana: number; p75: number; celdas: number; cobertura?: number } | null;
  variables_ok?: number;
  variables?: number;
  supuestas?: string[];
  variables_supuestas?: number;
  modeladas?: string[];
  variables_modeladas?: number;
  evidencia_objetivo?: number;
  razones: string[];
}

export interface Hechos {
  id: string;
  etiqueta: string;
  nombre?: string;
  grupo: Grupo;
  estado: string;
  lat: number;
  lon: number;
  radio_km: number;
  lugar: string;
  pais: string | null;
  region: string | null;
  fuente: string;
  fecha: string;
  parecido_motor_pct?: number;
  aparece_en_pct_escenarios?: number;
  aparece_en_n?: number;
  corrida?: string;
  descripcion_del_sitio?: string;
  resumen_del_sitio?: string;
  fuente_url?: string;
  objetivo?: { id: string; nombre: string; cuerpo: string; perfil: string; evaluado_desde_referencia?: boolean };
  evaluacion_zona?: {
    modo: string;
    radio_km: number;
    celdas_elegibles: number;
    celdas_muestra: number;
    s_max_pct: number;
    s_p90_pct: number;
    s_med_pct: number;
  };
  otros_objetivos_que_tambien_coinciden?: Record<string, number>;
  celda_distancia_km?: number;
  variables?: VariableHecho[];
  filtros?: { nombre: string; valor: string; estado: 'pasa' | 'alerta' | 'info' }[];
  minerales?: Minerales;
  polvo_finos?: PolvoFinos;
  viento_shields?: VientoShields;
  confianza?: Confianza | null;
}

export interface Segmento {
  t: string;
  ritmo: string;
  pausa_ms: number;
}

export interface Explicacion {
  id: string;
  hechos: Hechos;
  plantilla: string;
  plantilla_guion: Segmento[];
  ia: { texto: string; guion: Segmento[]; modelo: string } | null;
  ia_disponible: boolean;
  voz_disponible: boolean;
  aviso: string | null;
}

export interface TopItem {
  puesto: number;
  id: string;
  lat: number;
  lon: number;
  lugar: string;
  apariciones: number;
  escenarios: number;
  n_objetivos: number;
  objetivo: string | null;
  objetivo_nombre: string | null;
  veces_objetivo: number;
}

export interface Config {
  configurada: boolean;
  modelo: string;
  voz_configurada: boolean;
  voz: string;
  velocidad: number;
  voces: Record<string, string>;
}

export interface ParamsBusqueda {
  objetivo: string;
  perfil: string;
  factores: number[];
  ndvi_max: number;
  candidatos: number;
  excluir_indice: boolean;
  excluir_previos: boolean;
  excluir_km: number;
  /** Sin área busca en toda la Tierra; con área, el motor recibe --bbox o --region (GeoJSON). */
  area?: AreaBusqueda;
  k_area?: number;
  min_area_km2?: number;
}

/** Lo que el motor contó dentro del área (robustez.json) más el área pedida. */
export type ResumenArea = AreaBusqueda & {
  k_area: number;
  min_area_km2: number;
  celdas_en_area: number;
  regiones_con_tierra: number;
  sin_celdas_por_ndvi: number | null;
  tierra_km2: number;
};

export interface EstadoBusqueda {
  id: string;
  estado: 'corriendo' | 'terminado' | 'error';
  n_areas: number;
  segundos?: number;
  error?: string;
  corridas?: { corrida: string; estado: string; areas: number; escenarios: number }[];
  escenarios?: number;
  area?: ResumenArea | null;
}

export interface ZonaMapaActiva {
  id?: string;
  nombre: string;
  area_km2: number | null;
  coords: { lat: number; lon: number }[];
}

export interface PropuestaChat {
  tipo: 'busqueda' | 'barrido' | 'guardar_area';
  titulo: string;
  explicacion_simple: string;
  rigor_cientifico: string;
  es_exploracion_creativa: boolean;
  params: Record<string, unknown>;
  estado?: 'pendiente' | 'aprobada' | 'descartada';
}

export interface AccionMapaChat {
  tipo: 'enfocar_area' | 'volar' | 'capa_cuevas' | 'capa_crateres';
  id?: string;
  lat?: number;
  lon?: number;
  visible?: boolean;
}

export interface MensajeChat {
  rol: 'user' | 'assistant';
  texto: string;
  guion?: Segmento[]; // marcas de voz, nunca se muestran
  propuesta?: PropuestaChat;
}

const BASE: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MOTOR_API ?? 'http://127.0.0.1:5174';

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + ruta, init);
  const cuerpo = await r.json();
  if (!r.ok) throw new Error((cuerpo as { error?: string }).error ?? `HTTP ${r.status}`);
  return cuerpo as T;
}

// Las rutas que escriben llevan una cabecera propia: obliga a una petición CORS previa.
const post = (cuerpo: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Motor-Puente': '1' },
  body: JSON.stringify(cuerpo),
});

export const motorApi = {
  salud: () => pedir<{ ok: boolean; ia_disponible: boolean }>('/api/salud'),
  areas: () => pedir<AreaPin[]>('/api/areas'),
  area: (id: string) => pedir<AreaFeature>(`/api/areas/${encodeURIComponent(id)}`),
  explicacion: (id: string, ia: boolean) =>
    pedir<Explicacion>(`/api/areas/${encodeURIComponent(id)}/explicacion${ia ? '?ia=1' : ''}`),
  objetivos: () => pedir<Objetivo[]>('/api/objetivos'),
  confianza: () => pedir<Record<string, Confianza>>('/api/confianza'),
  top: (n = 3) => pedir<TopItem[]>(`/api/top?n=${n}`),
  lanzar: (p: ParamsBusqueda | Record<string, unknown>) => pedir<{ id: string }>('/api/busquedas', post(p)),
  lanzarBarrido: (excluirKm: number, maxEscenarios?: number) =>
    pedir<{ id: string; escenarios: number; corridas: string[] }>(
      '/api/barridos',
      post({ excluir_km: excluirKm, ...(maxEscenarios ? { max_escenarios: maxEscenarios } : {}) })
    ),
  estado: (id: string) => pedir<EstadoBusqueda>(`/api/busquedas/${id}`),
  guardar: (area: Record<string, unknown>) => pedir<unknown>('/api/areas', post(area)),
  limpiarRegistros: () => pedir<{ ok: boolean; movidas: number; respaldo: string | null }>('/api/areas/limpiar', post({})),
  config: () => pedir<Config>('/api/config'),
  guardarConfig: (c: { clave?: string; modelo?: string; clave_deepgram?: string; voz?: string; velocidad?: number }) => pedir<Config>('/api/config', post(c)),
  borrarClave: (cual: 'deepseek' | 'deepgram') => pedir<Config>('/api/config/borrar', post({ cual })),
  voz: async (texto: string, ritmo: string, signal?: AbortSignal): Promise<Blob> => {
    const r = await fetch(BASE + '/api/voz', { ...post({ texto, ritmo }), signal });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    return r.blob();
  },
  chat: (mensajes: Pick<MensajeChat, 'rol' | 'texto'>[], areaId: string | null, ranking?: unknown, zonaMapa?: ZonaMapaActiva | null) =>
    pedir<{ texto: string; guion: Segmento[]; modelo: string; propuesta?: PropuestaChat; acciones_mapa?: AccionMapaChat[]; busqueda_id?: string }>(
      '/api/chat',
      post({ mensajes, area_id: areaId, ...(ranking ? { ranking } : {}), ...(zonaMapa ? { zona_mapa: zonaMapa } : {}) })
    ),
};
