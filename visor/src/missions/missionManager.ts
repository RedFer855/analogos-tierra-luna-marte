import * as Cesium from 'cesium';
import {
  computeSphericalAreaM2,
  computeSphericalPerimeterM,
  PLANET_RADII_M,
} from '../analysis/terrainAnalysis';
import { requestRenderBurst } from '../map/viewer';
import type {
  GeoCoord,
  MissionZone,
  PinCategory,
  SavedPin,
  TerrainSource,
  TopographicMetrics,
} from '../types/mission';
import { formatElevation } from '../util/format';

const STORAGE_KEY = 'analogos_missions_catalog_v2';
const PINS_STORAGE_KEY = 'analogos_pins_catalog_v2';
const LEGACY_STORAGE_KEY = 'analogos_missions_catalog_v1';
const LEGACY_PINS_STORAGE_KEY = 'analogos_pins_catalog_v1';

/**
 * P4: las zonas y pines de demostración del prototipo eran inventados y parecían resultados.
 * Ya no se cargan, y si quedaron guardados de una versión anterior se quitan al migrar.
 */
const LEGACY_DEMO_IDS = new Set([
  'demo-atacama-yungay',
  'demo-licancabur-crater',
  'pin-demo-unah',
  'pin-demo-monturaqui',
]);

/* ------------------------------------------------------------------------------------------
 * Validación de datos que vienen de afuera: archivos importados y localStorage (S1).
 * Nada entra al catálogo sin pasar por aquí.
 * ---------------------------------------------------------------------------------------- */

const MAX_VERTICES = 2000;
const MAX_IMPORT_FEATURES = 5000;
const MAX_ID = 80;
const MAX_NAME = 120;
const MAX_NOTES = 2000;

const KNOWN_SOURCES: TerrainSource[] = [
  'terreno-local',
  'cesium-world-terrain',
  'teselas-cargadas',
  'importado',
  'sin-dato',
];

function cleanHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanCoords(raw: unknown): GeoCoord[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_VERTICES) return null;
  const out: GeoCoord[] = [];
  for (const item of raw) {
    const c = item as Record<string, unknown> | null;
    const lat = finiteOrNull(c?.lat);
    const lon = finiteOrNull(c?.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }
    out.push({ lat, lon });
  }
  return out;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MetricsOrigin = 'stored' | 'legacy' | 'imported';

/**
 * Área y perímetro se recalculan siempre desde la geometría. El relieve se respeta solo si
 * es un número; si falta, queda null (P9). Lo de la v1 hecho con relieve simulado se borra
 * (P1) y su pendiente se descarta porque tenía el error de alturas corridas (P7).
 */
function sanitizeMetrics(
  raw: unknown,
  coords: GeoCoord[],
  origin: MetricsOrigin
): TopographicMetrics {
  const m = (raw ?? {}) as Record<string, unknown>;
  const areaM2 = computeSphericalAreaM2(coords, PLANET_RADII_M.earth);
  const perimeterM = computeSphericalPerimeterM(coords, PLANET_RADII_M.earth);

  const rawSource = typeof m.terrainSource === 'string' ? m.terrainSource : '';
  const wasSimulated = rawSource === 'ellipsoid-estimated';

  let terrainSource: TerrainSource;
  if (origin === 'imported') {
    terrainSource = 'importado';
  } else if (wasSimulated) {
    terrainSource = 'sin-dato';
  } else if ((KNOWN_SOURCES as string[]).includes(rawSource)) {
    terrainSource = rawSource as TerrainSource;
  } else if (rawSource === 'cesium-world-terrain') {
    terrainSource = 'cesium-world-terrain';
  } else {
    terrainSource = 'sin-dato';
  }

  const relief = (key: string): number | null => (wasSimulated ? null : finiteOrNull(m[key]));
  const slopeIsTrustworthy = origin !== 'legacy' && !wasSimulated;

  return {
    areaM2,
    areaHa: areaM2 / 10_000,
    areaKm2: areaM2 / 1_000_000,
    perimeterM,
    perimeterKm: perimeterM / 1_000,
    maxElevationM: relief('maxElevationM'),
    minElevationM: relief('minElevationM'),
    reliefDepthM: relief('reliefDepthM'),
    avgSlopePercent: slopeIsTrustworthy ? finiteOrNull(m.avgSlopePercent) : null,
    slopeSpacingM: slopeIsTrustworthy ? finiteOrNull(m.slopeSpacingM) : null,
    approxVolumeM3: relief('approxVolumeM3'),
    terrainSource,
  };
}

export function sanitizeMission(raw: unknown, origin: MetricsOrigin): MissionZone | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const coords = cleanCoords(r.coordinates);
  if (!coords) return null;

  return {
    id: cleanText(r.id, MAX_ID, newId(origin === 'imported' ? 'imp' : 'mision')),
    name: cleanText(r.name, MAX_NAME, 'Zona sin nombre'),
    targetBody: r.targetBody === 'moon' ? 'moon' : 'mars',
    analogSiteName: cleanText(r.analogSiteName, MAX_NAME, 'Sin sitio indicado'),
    notes: cleanText(r.notes, MAX_NOTES, ''),
    shapeType:
      r.shapeType === 'rectangle' ? 'rectangle' : r.shapeType === 'circle' ? 'circle' : 'polygon',
    color: cleanHexColor(r.color),
    coordinates: coords,
    metrics: sanitizeMetrics(r.metrics, coords, origin),
    createdAt: cleanText(r.createdAt, 40, new Date().toISOString()),
  };
}

function sanitizePin(raw: unknown, origin: MetricsOrigin): SavedPin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = finiteOrNull(r.lat);
  const lon = finiteOrNull(r.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  const category: PinCategory =
    r.category === 'mars' || r.category === 'moon' ? r.category : 'earth';
  let elevationM = finiteOrNull(r.elevationM);
  // En la v1, "sin altura" se guardaba como 0 (P9): no se puede distinguir de un 0 real.
  if (origin === 'legacy' && elevationM === 0) elevationM = null;

  return {
    id: cleanText(r.id, MAX_ID, newId('pin')),
    name: cleanText(r.name, MAX_NAME, 'Punto sin nombre'),
    category,
    lat,
    lon,
    elevationM,
    notes: cleanText(r.notes, MAX_NOTES, ''),
    createdAt: cleanText(r.createdAt, 40, new Date().toISOString()),
  };
}

function readJsonArray(key: string): unknown[] | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Ícono del pin: círculo de 14 px con borde blanco de 3 px (20 px en total), dibujado al doble
 * de tamaño para que se vea nítido. Se devuelve como data URL para que Cesium lo guarde una
 * sola vez en el atlas y lo comparta entre todos los pines del mismo color.
 */
const pinIconCache = new Map<string, string>();
function pinIcon(cssColor: string): string {
  const cached = pinIconCache.get(cssColor);
  if (cached) return cached;
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 14, 0, Math.PI * 2);
    ctx.fillStyle = cssColor;
    ctx.fill();
  }
  const url = canvas.toDataURL('image/png');
  pinIconCache.set(cssColor, url);
  return url;
}

export class MissionManager {
  private viewer: Cesium.Viewer;
  private missions: MissionZone[] = [];
  private pins: SavedPin[] = [];
  private onChangeCallbacks: Array<(missions: MissionZone[]) => void> = [];
  private onPinsChangeCallbacks: Array<(pins: SavedPin[]) => void> = [];

  // Dibujo por colecciones (R14): en vez de 3 `Entity` por zona o pin, que Cesium actualiza una
  // por una en cada cuadro, todo va en colecciones que se dibujan juntas.
  private readonly pinBillboards: Cesium.BillboardCollection;
  private readonly pinLabels: Cesium.LabelCollection;
  private readonly zoneLabels: Cesium.LabelCollection;
  private renderedPins: Map<string, { billboard: Cesium.Billboard; label: Cesium.Label }> = new Map();
  private renderedZoneLabels: Map<string, Cesium.Label> = new Map();
  private zoneFill: Cesium.GroundPrimitive | null = null;
  private zoneLine: Cesium.GroundPolylinePrimitive | null = null;
  private zonePending: { cancel: () => void } | null = null;
  private zoneRebuildTimer: number | null = null;

  // Control de visibilidad del color de relleno y resaltado de borde al mostrar capa temática
  private globalFillsVisible = true;
  private hiddenFillMissionIds: Set<string> = new Set();
  private activeLayerHighlightId: string | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    const scene = viewer.scene;
    this.pinBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.pinLabels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    this.zoneLabels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    this.loadFromStorage();
    this.renderAll();
    this.renderAllPins();
  }

  public areGlobalFillsVisible(): boolean {
    return this.globalFillsVisible;
  }

  /** R13: solo cambia la visibilidad del relleno; no borra ni vuelve a crear las zonas. */
  private applyFillVisibility(id: string): void {
    // Si la capa de zonas todavía se está construyendo, nace con la visibilidad de ahora:
    // se reinicia la construcción en vez de tocar atributos que aún no existen.
    if (this.zonePending || !this.zoneFill?.ready) {
      this.scheduleZoneRebuild();
      return;
    }
    const attrs = this.zoneFill.getGeometryInstanceAttributes(id);
    if (attrs) {
      attrs.show = Cesium.ShowGeometryInstanceAttribute.toValue(
        this.isMissionFillVisible(id),
        attrs.show
      );
    }
  }

  public toggleGlobalFills(): boolean {
    this.globalFillsVisible = !this.globalFillsVisible;
    for (const m of this.missions) {
      this.applyFillVisibility(m.id);
    }
    this.viewer.scene.requestRender();
    this.notify();
    return this.globalFillsVisible;
  }

  public isMissionFillVisible(id: string): boolean {
    return this.globalFillsVisible && !this.hiddenFillMissionIds.has(id);
  }

  public toggleMissionFill(id: string): boolean {
    if (this.hiddenFillMissionIds.has(id)) {
      this.hiddenFillMissionIds.delete(id);
    } else {
      this.hiddenFillMissionIds.add(id);
    }
    this.applyFillVisibility(id);
    this.viewer.scene.requestRender();
    this.notify();
    return this.isMissionFillVisible(id);
  }

  public setMissionFillVisible(id: string, visible: boolean): void {
    const currentlyHidden = this.hiddenFillMissionIds.has(id);
    if (visible && currentlyHidden) {
      this.hiddenFillMissionIds.delete(id);
    } else if (!visible && !currentlyHidden) {
      this.hiddenFillMissionIds.add(id);
    } else {
      return;
    }
    this.applyFillVisibility(id);
    this.viewer.scene.requestRender();
    requestRenderBurst(this.viewer, 1200);
    this.notify();
  }

  /**
   * Cambia el contorno de la zona activa a blanco (#ffffff) mientras proyecta una capa
   * temática, evitando colisiones cromáticas con los bordes naranja (#f97316) de Marte
   * o cian (#38bdf8) de Luna, y lo restaura al limpiar la capa.
   */
  public setMissionLayerHighlight(id: string | null): void {
    const prevId = this.activeLayerHighlightId;
    if (prevId === id) return;
    this.activeLayerHighlightId = id;

    if (this.zonePending || !this.zoneLine?.ready) {
      this.scheduleZoneRebuild();
      return;
    }

    if (prevId) {
      const prevMission = this.getMissionById(prevId);
      const prevAttrs = this.zoneLine.getGeometryInstanceAttributes(prevId);
      if (prevMission && prevAttrs) {
        prevAttrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(
          this.zoneColor(prevMission),
          prevAttrs.color
        );
      }
    }

    if (id) {
      const nextAttrs = this.zoneLine.getGeometryInstanceAttributes(id);
      if (nextAttrs) {
        nextAttrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(
          Cesium.Color.WHITE,
          nextAttrs.color
        );
      }
    }

    this.viewer.scene.requestRender();
    requestRenderBurst(this.viewer, 800);
  }

  public onChange(cb: (missions: MissionZone[]) => void): void {
    this.onChangeCallbacks.push(cb);
  }

  public onPinsChange(cb: (pins: SavedPin[]) => void): void {
    this.onPinsChangeCallbacks.push(cb);
  }

  private notify(): void {
    for (const cb of this.onChangeCallbacks) {
      cb(this.missions);
    }
  }

  private notifyPins(): void {
    for (const cb of this.onPinsChangeCallbacks) {
      cb(this.pins);
    }
  }

  public getMissions(): MissionZone[] {
    return this.missions;
  }

  public getPins(): SavedPin[] {
    return this.pins;
  }

  public getMissionById(id: string): MissionZone | undefined {
    return this.missions.find((m) => m.id === id);
  }

  public getPinById(id: string): SavedPin | undefined {
    return this.pins.find((p) => p.id === id);
  }

  public addMission(mission: MissionZone): void {
    this.missions.unshift(mission);
    this.saveToStorage();
    this.renderMission(mission);
    this.notify();
  }

  public addPin(pin: SavedPin): void {
    this.pins.unshift(pin);
    this.savePinsToStorage();
    this.renderPin(pin);
    this.notifyPins();
  }

  public deleteMission(id: string): void {
    this.missions = this.missions.filter((m) => m.id !== id);
    this.removeRenderedMission(id);
    this.viewer.scene.requestRender();
    this.saveToStorage();
    this.notify();
  }

  public updateMissionColor(id: string, color: string): void {
    const clean = cleanHexColor(color);
    if (!clean) return;
    const mission = this.missions.find((m) => m.id === id);
    if (!mission) return;
    mission.color = clean;
    this.saveToStorage();
    this.scheduleZoneRebuild();
    this.viewer.scene.requestRender();
    this.notify();
  }

  public deletePin(id: string): void {
    this.pins = this.pins.filter((p) => p.id !== id);
    this.removeRenderedPin(id);
    this.viewer.scene.requestRender();
    this.savePinsToStorage();
    this.notifyPins();
  }

  private loadFromStorage(): void {
    const current = readJsonArray(STORAGE_KEY);
    const legacy = current ? null : readJsonArray(LEGACY_STORAGE_KEY);
    const missionOrigin: MetricsOrigin = current ? 'stored' : 'legacy';
    this.missions = (current ?? legacy ?? [])
      .filter((m) => !LEGACY_DEMO_IDS.has(String((m as { id?: unknown })?.id)))
      .map((m) => sanitizeMission(m, missionOrigin))
      .filter((m): m is MissionZone => m !== null);

    const currentPins = readJsonArray(PINS_STORAGE_KEY);
    const legacyPins = currentPins ? null : readJsonArray(LEGACY_PINS_STORAGE_KEY);
    const pinOrigin: MetricsOrigin = currentPins ? 'stored' : 'legacy';
    this.pins = (currentPins ?? legacyPins ?? [])
      .filter((p) => !LEGACY_DEMO_IDS.has(String((p as { id?: unknown })?.id)))
      .map((p) => sanitizePin(p, pinOrigin))
      .filter((p): p is SavedPin => p !== null);

    // La migración escribe en la clave v2 y deja la v1 intacta como respaldo.
    if (!current) this.saveToStorage();
    if (!currentPins) this.savePinsToStorage();
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.missions));
    } catch (err) {
      console.error('Error al guardar misiones en localStorage:', err);
      alert('No se pudo guardar el catálogo: el almacenamiento del navegador está lleno.');
    }
  }

  private savePinsToStorage(): void {
    try {
      localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(this.pins));
    } catch (err) {
      console.error('Error al guardar pines en localStorage:', err);
      alert('No se pudo guardar el pin: el almacenamiento del navegador está lleno.');
    }
  }

  private computeCentroid(coords: GeoCoord[]): GeoCoord {
    if (coords.length === 0) return { lat: 0, lon: 0 };
    let latSum = 0;
    let lonSum = 0;
    for (const c of coords) {
      latSum += c.lat;
      lonSum += c.lon;
    }
    return {
      lat: latSum / coords.length,
      lon: lonSum / coords.length,
    };
  }

  private zoneColor(mission: MissionZone): Cesium.Color {
    const css = mission.color ?? (mission.targetBody === 'mars' ? '#f97316' : '#38bdf8');
    return Cesium.Color.fromCssColorString(css);
  }

  private addZoneLabel(mission: MissionZone): void {
    const isMars = mission.targetBody === 'mars';
    const centroid = this.computeCentroid(mission.coordinates);
    // Etiqueta solo a distancia de trabajo (R6): las etiquetas son de lo más caro en Cesium.
    const badge = isMars ? 'MARTE' : 'LUNA';
    const relief =
      mission.metrics.reliefDepthM === null
        ? 'Desnivel: sin dato'
        : `Desnivel: ${formatElevation(mission.metrics.reliefDepthM)}`;
    const label = this.zoneLabels.add({
      id: mission.id,
      position: Cesium.Cartesian3.fromDegrees(centroid.lon, centroid.lat),
      text: `[${badge}] ${mission.name}\n${mission.metrics.areaKm2.toFixed(2)} km² · ${relief}`,
      font: '600 13px Inter, system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0f172acc'),
      backgroundPadding: new Cesium.Cartesian2(10, 6),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -12),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 300_000),
    });
    this.renderedZoneLabels.set(mission.id, label);
  }

  /** Una zona nueva: su etiqueta sale al instante y el relleno y contorno se arman juntos. */
  private renderMission(mission: MissionZone): void {
    this.removeZoneLabel(mission.id);
    this.addZoneLabel(mission);
    this.scheduleZoneRebuild();
    requestRenderBurst(this.viewer);
  }

  private removeZoneLabel(id: string): void {
    const label = this.renderedZoneLabels.get(id);
    if (label) {
      this.zoneLabels.remove(label);
      this.renderedZoneLabels.delete(id);
    }
  }

  private removeRenderedMission(id: string): void {
    this.removeZoneLabel(id);
    this.scheduleZoneRebuild();
  }

  public renderAll(): void {
    this.zoneLabels.removeAll();
    this.renderedZoneLabels.clear();
    for (const m of this.missions) {
      this.addZoneLabel(m);
    }
    this.scheduleZoneRebuild();
    requestRenderBurst(this.viewer);
  }

  /** Junta varios cambios en una sola reconstrucción (importar 1 000 zonas = 1 rebuild). */
  private scheduleZoneRebuild(): void {
    if (this.zoneRebuildTimer !== null) return;
    this.zoneRebuildTimer = window.setTimeout(() => {
      this.zoneRebuildTimer = null;
      this.rebuildZoneGeometry();
    }, 0);
  }

  /**
   * Relleno y contorno de TODAS las zonas en dos primitivas (una `GroundPrimitive` y una
   * `GroundPolylinePrimitive`), con color y visibilidad por instancia. Se arman en segundo
   * plano y la capa vieja solo se quita cuando la nueva está lista, así no parpadea.
   */
  private rebuildZoneGeometry(): void {
    this.zonePending?.cancel();
    this.zonePending = null;
    const scene = this.viewer.scene;

    if (this.missions.length === 0) {
      this.swapZonePrimitives(null, null);
      scene.requestRender();
      return;
    }

    const fillInstances: Cesium.GeometryInstance[] = [];
    const lineInstances: Cesium.GeometryInstance[] = [];
    for (const m of this.missions) {
      const color = this.zoneColor(m);
      const positions = m.coordinates.map((c) => Cesium.Cartesian3.fromDegrees(c.lon, c.lat));
      fillInstances.push(
        new Cesium.GeometryInstance({
          id: m.id,
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(positions),
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.32)),
            show: new Cesium.ShowGeometryInstanceAttribute(this.isMissionFillVisible(m.id)),
          },
        })
      );
      const lineColor = m.id === this.activeLayerHighlightId ? Cesium.Color.WHITE : color;
      lineInstances.push(
        new Cesium.GeometryInstance({
          id: m.id,
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...positions, positions[0]],
            width: 3.5,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(lineColor) },
        })
      );
    }

    const fill = new Cesium.GroundPrimitive({
      geometryInstances: fillInstances,
      classificationType: Cesium.ClassificationType.TERRAIN,
    });
    const line = Cesium.GroundPolylinePrimitive.isSupported(scene)
      ? new Cesium.GroundPolylinePrimitive({
          geometryInstances: lineInstances,
          appearance: new Cesium.PolylineColorAppearance(),
        })
      : null;
    scene.groundPrimitives.add(fill);
    if (line) scene.groundPrimitives.add(line);

    // Con requestRenderMode, Cesium solo avanza la construcción si dibuja: se pide un cuadro
    // por vez hasta que ambas primitivas estén listas (con tope por si algo falla).
    const giveUpAt = performance.now() + 60_000;
    let stop: () => void = () => {};
    const cancel = (): void => {
      stop();
      scene.groundPrimitives.remove(fill);
      if (line) scene.groundPrimitives.remove(line);
    };
    stop = scene.preRender.addEventListener(() => {
      if (performance.now() > giveUpAt) {
        console.warn('Las zonas tardaron más de 60 s en construirse; se descarta esta capa.');
        cancel();
        this.zonePending = null;
        return;
      }
      if (!fill.ready || (line && !line.ready)) {
        scene.requestRender();
        return;
      }
      stop();
      this.zonePending = null;
      this.swapZonePrimitives(fill, line);
    });
    this.zonePending = { cancel };
    scene.requestRender();
  }

  private swapZonePrimitives(
    fill: Cesium.GroundPrimitive | null,
    line: Cesium.GroundPolylinePrimitive | null
  ): void {
    const groundPrimitives = this.viewer.scene.groundPrimitives;
    if (this.zoneFill) groundPrimitives.remove(this.zoneFill);
    if (this.zoneLine) groundPrimitives.remove(this.zoneLine);
    this.zoneFill = fill;
    this.zoneLine = line;
  }

  public renderPin(pin: SavedPin): void {
    this.removeRenderedPin(pin.id);
    this.addPinParts(pin);
    requestRenderBurst(this.viewer);
  }

  private addPinParts(pin: SavedPin): void {
    const isMars = pin.category === 'mars';
    const isMoon = pin.category === 'moon';
    const baseColor = isMars ? '#f97316' : isMoon ? '#38bdf8' : '#10b981';
    const categoryLabel = isMars ? 'MARTE' : isMoon ? 'LUNA' : 'REF. TIERRA';
    const altText =
      pin.elevationM === null ? 'Alt: sin dato' : `Alt: ${formatElevation(pin.elevationM)} (elipsoide)`;
    const position = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat);

    // Mismo punto de antes (14 px de relleno y 3 px de borde blanco), pero como imagen que
    // comparten todos los pines de la misma categoría.
    const billboard = this.pinBillboards.add({
      id: pin.id,
      position,
      image: pinIcon(baseColor),
      scale: 0.5,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const label = this.pinLabels.add({
      id: pin.id,
      position,
      text: `📍 [${categoryLabel}] ${pin.name}\n${altText}`,
      font: '600 12px Inter, system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0f172acc'),
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      pixelOffset: new Cesium.Cartesian2(0, -24),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 400_000),
    });

    this.renderedPins.set(pin.id, { billboard, label });
  }

  public removeRenderedPin(id: string): void {
    const parts = this.renderedPins.get(id);
    if (parts) {
      this.pinBillboards.remove(parts.billboard);
      this.pinLabels.remove(parts.label);
      this.renderedPins.delete(id);
    }
  }

  public renderAllPins(): void {
    this.pinBillboards.removeAll();
    this.pinLabels.removeAll();
    this.renderedPins.clear();
    for (const p of this.pins) {
      this.addPinParts(p);
    }
    requestRenderBurst(this.viewer);
  }

  public exportPinGeoJSON(id: string): void {
    const pin = this.getPinById(id);
    if (!pin) return;

    const coordinates: number[] = [Number(pin.lon.toFixed(6)), Number(pin.lat.toFixed(6))];
    if (pin.elevationM !== null) coordinates.push(pin.elevationM);

    const feature = {
      type: 'Feature',
      id: pin.id,
      properties: {
        name: pin.name,
        category: pin.category,
        lat: pin.lat,
        lon: pin.lon,
        elevationM: pin.elevationM,
        heightReference: 'WGS84 ellipsoid',
        notes: pin.notes,
        createdAt: pin.createdAt,
      },
      geometry: {
        type: 'Point',
        coordinates,
      },
    };

    this.downloadJsonFile(feature, `pin-${this.safeFileName(pin.name) || pin.id}.geojson`);
  }

  private safeFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Convierte una misión individual a un objeto Feature GeoJSON estándar (RFC 7946).
   * Los faltantes salen como null, no como 0.
   */
  public toGeoJSONFeature(mission: MissionZone): Record<string, unknown> {
    const ring = mission.coordinates.map((c) => [
      Number(c.lon.toFixed(6)),
      Number(c.lat.toFixed(6)),
    ]);
    if (ring.length > 0) {
      ring.push([...ring[0]]);
    }

    return {
      type: 'Feature',
      id: mission.id,
      properties: {
        name: mission.name,
        targetBody: mission.targetBody,
        analogSiteName: mission.analogSiteName,
        notes: mission.notes,
        shapeType: mission.shapeType,
        areaM2: Math.round(mission.metrics.areaM2),
        areaHa: Number(mission.metrics.areaHa.toFixed(2)),
        areaKm2: Number(mission.metrics.areaKm2.toFixed(4)),
        perimeterM: Math.round(mission.metrics.perimeterM),
        perimeterKm: Number(mission.metrics.perimeterKm.toFixed(3)),
        maxElevationM: mission.metrics.maxElevationM,
        minElevationM: mission.metrics.minElevationM,
        reliefDepthM: mission.metrics.reliefDepthM,
        avgSlopePercent: mission.metrics.avgSlopePercent,
        slopeSpacingM: mission.metrics.slopeSpacingM,
        approxVolumeM3: mission.metrics.approxVolumeM3,
        heightReference: 'WGS84 ellipsoid',
        terrainSource: mission.metrics.terrainSource,
        createdAt: mission.createdAt,
        missionDataInternal: mission,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    };
  }

  public exportMissionGeoJSON(id: string): void {
    const mission = this.getMissionById(id);
    if (!mission) return;
    const feature = this.toGeoJSONFeature(mission);
    this.downloadJsonFile(
      feature,
      `mision-${this.safeFileName(mission.name) || mission.id}.geojson`
    );
  }

  public exportCatalogGeoJSON(): void {
    const collection = {
      type: 'FeatureCollection',
      metadata: {
        application: 'Visor 3D de Misiones Análogas — NASA Space Apps',
        exportedAt: new Date().toISOString(),
        totalMissions: this.missions.length,
      },
      features: this.missions.map((m) => this.toGeoJSONFeature(m)),
    };

    this.downloadJsonFile(collection, 'catalogo-misiones-analogas.geojson');
  }

  /**
   * Importa zonas desde un GeoJSON o un arreglo de zonas. Todo pasa por `sanitizeMission` (S1):
   * se validan tipos, coordenadas y largos; área y perímetro se recalculan; el relieve queda
   * marcado como "importado" porque no se midió en este visor.
   */
  public importCatalogFromObject(data: unknown): { imported: number; rejected: number } {
    let imported = 0;
    let rejected = 0;
    if (!data || typeof data !== 'object') return { imported, rejected };

    const obj = data as Record<string, unknown>;
    let candidates: unknown[] = [];
    if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
      candidates = obj.features;
    } else if (obj.type === 'Feature') {
      candidates = [obj];
    } else if (Array.isArray(data)) {
      candidates = data;
    }

    for (const item of candidates.slice(0, MAX_IMPORT_FEATURES)) {
      const mission = this.extractMissionFromItem(item);
      if (mission) {
        this.upsertMission(mission);
        imported++;
      } else {
        rejected++;
      }
    }
    rejected += Math.max(0, candidates.length - MAX_IMPORT_FEATURES);

    if (imported > 0) {
      this.saveToStorage();
      this.renderAll();
      this.notify();
    }
    return { imported, rejected };
  }

  private extractMissionFromItem(item: unknown): MissionZone | null {
    if (!item || typeof item !== 'object') return null;
    const f = item as Record<string, unknown>;

    // Arreglo de zonas propio
    if ('coordinates' in f && Array.isArray(f.coordinates) && f.type === undefined) {
      return sanitizeMission(f, 'imported');
    }

    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.missionDataInternal && typeof props.missionDataInternal === 'object') {
      return sanitizeMission(props.missionDataInternal, 'imported');
    }

    // GeoJSON externo: Polygon con su primer anillo [lon, lat]
    const geometry = f.geometry as Record<string, unknown> | undefined;
    if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return null;
    const ring = geometry.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4) return null;

    const coords = ring.slice(0, ring.length - 1).map((pt: unknown) => {
      const p = Array.isArray(pt) ? pt : [];
      return { lon: p[0], lat: p[1] };
    });

    return sanitizeMission(
      {
        id: typeof f.id === 'string' || typeof f.id === 'number' ? String(f.id) : undefined,
        name: props.name,
        targetBody: props.targetBody,
        analogSiteName: props.analogSiteName,
        notes: props.notes,
        shapeType: props.shapeType,
        coordinates: coords,
        metrics: props,
        createdAt: props.createdAt,
      },
      'imported'
    );
  }

  private upsertMission(mission: MissionZone): void {
    const idx = this.missions.findIndex((m) => m.id === mission.id);
    if (idx >= 0) {
      this.missions[idx] = mission;
    } else {
      this.missions.unshift(mission);
    }
  }

  private downloadJsonFile(payload: unknown, filename: string): void {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/geo+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
