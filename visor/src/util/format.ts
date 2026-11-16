import type { TerrainSource } from '../types/mission';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa texto antes de meterlo en una plantilla HTML (S1).
 * Todo texto que venga del usuario o de un archivo importado pasa por aquí.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export const SIN_DATO = 'sin dato';

/** Número con decimales fijos, o "sin dato" si es null (un faltante nunca es 0). */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return SIN_DATO;
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Altura del terreno. Cesium devuelve alturas sobre el elipsoide WGS84,
 * no sobre el nivel del mar (P8), y así se rotulan.
 */
export function formatElevation(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return SIN_DATO;
  return `${formatNumber(value, 0)} m`;
}

export const ELEVATION_REFERENCE_LABEL = 'sobre el elipsoide WGS84';

export function formatVolume(volumeM3: number | null | undefined): string {
  if (volumeM3 === null || volumeM3 === undefined || !Number.isFinite(volumeM3)) return SIN_DATO;
  if (volumeM3 >= 1_000_000_000) {
    return `${(volumeM3 / 1_000_000_000).toFixed(2)} km³`;
  }
  if (volumeM3 >= 1_000_000) {
    return `${(volumeM3 / 1_000_000).toFixed(2)} hm³`;
  }
  return `${Math.round(volumeM3).toLocaleString('es-ES')} m³`;
}

export function formatSlope(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return SIN_DATO;
  return `${value.toFixed(1)} %`;
}

export function describeTerrainSource(source: TerrainSource): string {
  switch (source) {
    case 'terreno-local':
      return 'Terreno local (Copernicus DEM)';
    case 'cesium-world-terrain':
      return 'Cesium World Terrain';
    case 'teselas-cargadas':
      return 'Teselas de terreno cargadas (menor detalle)';
    case 'importado':
      return 'Importado: relieve no medido aquí';
    case 'sin-dato':
    default:
      return 'Sin terreno: relieve sin dato';
  }
}
