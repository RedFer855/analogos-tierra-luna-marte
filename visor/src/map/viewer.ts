import * as Cesium from 'cesium';
import type { GeoCoord } from '../types/mission';
import { ELEVATION_REFERENCE_LABEL, formatElevation } from '../util/format';

const TOKEN_STORAGE_KEY = 'analogos_cesium_ion_token';

/** Terreno local generado offline (I-40): `public/terreno/layer.json` + teselas `.terrain`. */
const LOCAL_TERRAIN_URL = `${import.meta.env.BASE_URL}terreno/`;

export type TerrainKind = 'local' | 'ion' | 'ninguno';
export interface TerrainStatus {
  kind: TerrainKind;
}

export type ImageryKind =
  | 'sentinel2-eox'
  | 'gibs-bluemarble'
  | 'naturalearth';

export interface BaseImageryOption {
  kind: ImageryKind;
  shortLabel: string;
  description: string;
}

/**
 * Imagen base de la Tierra (I-39 y PR #32):
 * - Esri World Imagery NO se usa: sus condiciones exigen clave y prohíben guardarla offline.
 * - Sentinel-2 cloudless de EOX: ~10 m nativo (nivel 14), sin nubes, CORS abierto. Por defecto
 *   usa 2025 (CC BY-NC-SA 4.0, no comercial); `?imagen=2016` o respaldo cae a 2016 (CC BY 4.0).
 * - Detalle aéreo USGS (~2 m, nivel 16): se activa al enfocar EE. UU. por debajo de 150 km (`?detalle=0` apaga).
 * - NASA GIBS Blue Marble: datos abiertos de NASA, ~500 m (nivel 8), mosaico sin nubes.
 * - NaturalEarthII: dominio público, viene con CesiumJS, funciona sin internet (~19 km/píxel).
 */
const EOX_FIRST_YEAR = 2016;
const EOX_LATEST_YEAR = 2025;
let eoxYearInUse = EOX_LATEST_YEAR;

/** Año de la imagen de EOX que quedó cargada (para mostrarlo en la interfaz). */
export function getEoxYearInUse(): number {
  return eoxYearInUse;
}

export function requestedEoxYear(search?: string): number {
  const qs = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const raw = new URLSearchParams(qs).get('imagen');
  const year = raw === null ? EOX_LATEST_YEAR : Number(raw);
  return Number.isInteger(year) && year >= EOX_FIRST_YEAR && year <= EOX_LATEST_YEAR
    ? year
    : EOX_LATEST_YEAR;
}

export function eoxTemplate(year: number): string {
  const layer = year === EOX_FIRST_YEAR ? 's2cloudless' : `s2cloudless-${year}`;
  return `https://tiles.maps.eox.at/wmts/1.0.0/${layer}_3857/default/g/{z}/{y}/{x}.jpg`;
}

function eoxCredit(year: number): string {
  const data = year === EOX_FIRST_YEAR ? '2016 &amp; 2017' : String(year);
  return (
    '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless - https://s2maps.eu</a> ' +
    'by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> ' +
    `(Contains modified Copernicus Sentinel data ${data})`
  );
}

const GIBS_BLUEMARBLE_TEMPLATE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const GIBS_CREDIT =
  'Imagery provided by services from NASA\'s <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener">Global Imagery Browse Services (GIBS)</a>, part of NASA\'s ESDIS';

type GibsImageryKind = 'gibs-bluemarble';

interface UrlImagerySpec {
  template: string;
  maximumLevel: number;
  creditHtml: string;
  probeTile: { z: string; y: string; x: string };
}

const GIBS_IMAGERY_SPECS: Record<GibsImageryKind, UrlImagerySpec> = {
  'gibs-bluemarble': {
    template: GIBS_BLUEMARBLE_TEMPLATE,
    maximumLevel: 8, // ~500 m: mosaico global sin nubes de GIBS
    creditHtml: GIBS_CREDIT,
    probeTile: { z: '1', y: '0', x: '0' },
  },
};

export const BASE_IMAGERY_OPTIONS: BaseImageryOption[] = [
  { kind: 'sentinel2-eox', shortLabel: 'EOX 2025 · 10 m', description: 'Sentinel-2 cloudless 2025 (EOX, CC BY-NC-SA 4.0, ~10 m)' },
  { kind: 'gibs-bluemarble', shortLabel: 'GIBS Marble · 500 m', description: 'NASA GIBS Blue Marble Next Gen (~500 m, sin nubes, respaldo)' },
  { kind: 'naturalearth', shortLabel: 'NaturalEarth · Offline', description: 'NaturalEarthII sin internet (~19 km, dominio público)' },
];

/** Fecha UTC desplazada `lagDays` atrás para asegurar órbitas globales completas en GIBS diario. */
export function getGibsRecentDateIso(nowMs: number = Date.now(), lagDays: number = 2): string {
  const safeLag = Math.max(0, Math.floor(lagDays));
  return new Date(nowMs - safeLag * 86_400_000).toISOString().slice(0, 10);
}

const CAPA_ALIASES: Record<string, ImageryKind> = {
  eox: 'sentinel2-eox',
  eox2016: 'sentinel2-eox',
  eox2025: 'sentinel2-eox',
  sentinel2: 'sentinel2-eox',
  'sentinel2-eox': 'sentinel2-eox',
  bluemarble: 'gibs-bluemarble',
  gibs: 'gibs-bluemarble',
  'gibs-bluemarble': 'gibs-bluemarble',
  naturalearth: 'naturalearth',
  offline: 'naturalearth',
};

export function parseImageryChoice(search: string): ImageryKind | null {
  const raw = new URLSearchParams(search).get('capa')?.trim().toLowerCase();
  if (!raw) return null;
  return CAPA_ALIASES[raw] ?? null;
}

export function buildBaseImageryUrl(kind: Exclude<ImageryKind, 'naturalearth'>, gibsDateIso: string, eoxYear?: number): string {
  if (kind === 'sentinel2-eox') {
    return eoxTemplate(eoxYear ?? eoxYearInUse);
  }
  return GIBS_IMAGERY_SPECS[kind].template.replace('{date}', gibsDateIso);
}

export function getSavedIonToken(): string {
  const fromLocal = localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? '';
  if (fromLocal) return fromLocal;
  const fromEnv = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim() ?? '';
  return fromEnv;
}

export function saveIonToken(token: string): void {
  const clean = token.trim();
  if (clean) {
    localStorage.setItem(TOKEN_STORAGE_KEY, clean);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

/** Pide un recurso con tiempo límite. Sirve para saber si hay internet o terreno local. */
async function probe(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function tryBuildEoxProvider(): Promise<Cesium.ImageryProvider | null> {
  // Primero el año pedido (por defecto 2025); si no responde, cae al de 2016 (CC BY 4.0).
  const years = [requestedEoxYear(), EOX_FIRST_YEAR].filter((y, i, all) => all.indexOf(y) === i);
  for (const year of years) {
    const template = eoxTemplate(year);
    const eoxProbe = template.replace('{z}', '0').replace('{y}', '0').replace('{x}', '0');
    if (await probe(eoxProbe, 4000)) {
      eoxYearInUse = year;
      return new Cesium.UrlTemplateImageryProvider({
        url: template,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 14, // ~10 m: la resolución nativa de Sentinel-2
        credit: new Cesium.Credit(eoxCredit(year), true),
      });
    }
  }
  return null;
}

async function tryBuildImageryProvider(
  kind: ImageryKind,
  gibsDateIso: string
): Promise<Cesium.ImageryProvider | null> {
  if (kind === 'naturalearth') {
    try {
      return await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
      );
    } catch (err) {
      console.warn('No se pudo cargar NaturalEarthII:', err);
      return null;
    }
  }

  if (kind === 'sentinel2-eox') {
    return tryBuildEoxProvider();
  }

  const spec = GIBS_IMAGERY_SPECS[kind];
  const url = buildBaseImageryUrl(kind, gibsDateIso);
  const probeUrl = url
    .replace('{z}', spec.probeTile.z)
    .replace('{y}', spec.probeTile.y)
    .replace('{x}', spec.probeTile.x);

  if (!(await probe(probeUrl, 4000))) return null;

  return new Cesium.UrlTemplateImageryProvider({
    url,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: spec.maximumLevel,
    credit: new Cesium.Credit(spec.creditHtml, true),
  });
}

/* ------------------------------------------------------------------------------------------
 * Detalle de imagen al enfocar un análogo (solo EE. UU., extraído de main #32).
 * Sentinel-2 llega a ~10 m por píxel: al acercarse del todo se ve borroso. USGS publica imagen aérea
 * de ~2 m (nivel 16) sin clave y con CORS abierto, pero solo cubre EE. UU.; en el resto del mundo
 * responde 404. Por eso la capa se enciende solo al enfocar un punto dentro de su cobertura y se apaga
 * al alejarse. Se apaga del todo con `?detalle=0`.
 * ---------------------------------------------------------------------------------------- */

const USGS_TEMPLATE =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const USGS_CREDIT =
  'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USDA, USGS The National Map: Orthoimagery</a>';
/** Por encima de esta altura de cámara la capa se apaga: de lejos no aporta nada. */
const DETAIL_HIDE_ABOVE_M = 150_000;

/** Cajas aproximadas de la cobertura de USGS: 48 estados, Alaska y Hawái. Fuera de ellas da 404. */
const USGS_BOXES: Array<{ west: number; south: number; east: number; north: number }> = [
  { west: -125.0, south: 24.4, east: -66.9, north: 49.4 },
  { west: -170.0, south: 51.0, east: -129.9, north: 71.6 },
  { west: -161.0, south: 18.5, east: -154.5, north: 22.5 },
];

/**
 * Fuera de su cobertura USGS no siempre da 404: en niveles bajos devuelve una tesela de blanco puro
 * (medido en Sonora, México, niveles 10 a 12) que taparía a Sentinel-2. Se descartan las teselas
 * cuyos píxeles son todos blancos; la imagen real, incluida una salina, nunca llega a 255 en todo.
 * `minimumLevel` no sirve aquí: con él Cesium intenta armar millones de teselas y se cuelga.
 */
const blankCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (blankCanvas) {
  blankCanvas.width = 16;
  blankCanvas.height = 16;
}
const blankTilePolicy = {
  isReady: (): boolean => true,
  shouldDiscardImage: (image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): boolean => {
    if (!blankCanvas) return false;
    const ctx = blankCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(image, 0, 0, 16, 16);
    const px = ctx.getImageData(0, 0, 16, 16).data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 254 || px[i + 1] < 254 || px[i + 2] < 254) return false;
    }
    return true;
  },
};

let activeImageryKind: ImageryKind = 'sentinel2-eox';
let detailLayer: Cesium.ImageryLayer | null = null;
const detailListenerAttached = new WeakSet<Cesium.Viewer>();
/** Vuelos de enfoque en curso: mientras haya uno, la cámara aún no llegó y no se apaga el detalle. */
let activeFlights = 0;

function trackedFlight(complete?: () => void): { complete: () => void; cancel: () => void } {
  activeFlights++;
  let done = false;
  const finish = (): void => {
    if (!done) {
      done = true;
      activeFlights = Math.max(0, activeFlights - 1);
    }
  };
  return {
    complete: () => {
      finish();
      complete?.();
    },
    cancel: finish,
  };
}

export function isInDetailCoverage(lon: number, lat: number): boolean {
  return USGS_BOXES.some(
    (b) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north
  );
}

/** Estado de la capa de detalle, para mostrarlo en la interfaz. */
export function isDetailImageryOn(): boolean {
  return detailLayer?.show === true;
}

/** Llamar al enfocar un punto. Enciende el detalle si el punto está en EE. UU. y lo apaga si no. */
export function focusDetailImagery(viewer: Cesium.Viewer, lon: number, lat: number): void {
  if (new URLSearchParams(window.location.search).get('detalle') === '0') return;
  if (activeImageryKind !== 'sentinel2-eox') return;

  if (!isInDetailCoverage(lon, lat)) {
    if (detailLayer?.show) {
      detailLayer.show = false;
      viewer.scene.requestRender();
    }
    return;
  }

  if (!detailLayer) {
    detailLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: USGS_TEMPLATE,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 16, // el nivel 17 da 404; ~2 m por píxel a 36° de latitud
        tileDiscardPolicy: blankTilePolicy,
        credit: new Cesium.Credit(USGS_CREDIT, true),
      })
    );
  }
  if (!detailListenerAttached.has(viewer)) {
    detailListenerAttached.add(viewer);
    viewer.camera.moveEnd.addEventListener(() => {
      // Mientras hay un vuelo en curso la cámara aún está lejos: no se apaga a mitad de camino.
      if (
        detailLayer?.show &&
        activeFlights === 0 &&
        viewer.camera.positionCartographic.height > DETAIL_HIDE_ABOVE_M
      ) {
        detailLayer.show = false;
        viewer.scene.requestRender();
      }
    });
  }
  detailLayer.show = true;
  viewer.scene.requestRender();
}

/** Carga o cambia la imagen base abierta probando primero `preferred` y luego los respaldos acordados. */
export async function setBaseImagery(
  viewer: Cesium.Viewer,
  preferred?: ImageryKind | null
): Promise<ImageryKind> {
  const gibsDateIso = getGibsRecentDateIso();
  const candidates: ImageryKind[] = [];
  const pushUnique = (k: ImageryKind) => {
    if (!candidates.includes(k)) candidates.push(k);
  };
  if (preferred) pushUnique(preferred);
  pushUnique('sentinel2-eox');
  pushUnique('gibs-bluemarble');
  pushUnique('naturalearth');

  for (const kind of candidates) {
    const provider = await tryBuildImageryProvider(kind, gibsDateIso);
    if (provider) {
      detailLayer = null;
      viewer.imageryLayers.removeAll(true);
      viewer.imageryLayers.addImageryProvider(provider);
      activeImageryKind = kind;
      if (kind === 'sentinel2-eox') {
        const cam = viewer.camera.positionCartographic;
        if (cam.height <= DETAIL_HIDE_ABOVE_M) {
          focusDetailImagery(viewer, Cesium.Math.toDegrees(cam.longitude), Cesium.Math.toDegrees(cam.latitude));
        }
      }
      viewer.scene.requestRender();
      return kind;
    }
  }

  return 'naturalearth';
}

async function addBaseImagery(viewer: Cesium.Viewer): Promise<ImageryKind> {
  const requested = parseImageryChoice(window.location.search);
  return setBaseImagery(viewer, requested);
}

/**
 * Calidad (extraída de main #32). Por defecto el mapa se dibuja a la nitidez completa de la pantalla:
 * - Dibuja con los píxeles reales, con tope de 2× para no ahogar la GPU en pantallas muy densas.
 * - El detalle del terreno e imagen no baja al mover la cámara.
 * `?calidad=alta` pide el doble de detalle de teselas (`maximumScreenSpaceError` = 1).
 * `?calidad=ligera` es la opción para equipos débiles: píxeles CSS, escala 0,85 y mitad de detalle en movimiento.
 */
function setupAdaptiveQuality(viewer: Cesium.Viewer): void {
  const mode = new URLSearchParams(window.location.search).get('calidad');
  const globe = viewer.scene.globe;

  if (mode === 'ligera') {
    viewer.useBrowserRecommendedResolution = true;
    viewer.resolutionScale = 0.85;
    const restError = globe.maximumScreenSpaceError;
    viewer.camera.moveStart.addEventListener(() => {
      globe.maximumScreenSpaceError = restError * 2;
    });
    viewer.camera.moveEnd.addEventListener(() => {
      globe.maximumScreenSpaceError = restError;
      viewer.scene.requestRender();
    });
    return;
  }

  viewer.useBrowserRecommendedResolution = false;
  const dpr = window.devicePixelRatio || 1;
  viewer. resolutionScale = dpr > 2 ? 2 / dpr : 1;
  if (mode === 'alta') globe.maximumScreenSpaceError = 1;
}

/**
 * Calcula el pitch máximo permitido (en radianes, negativo hacia el suelo) al alejar la cámara,
 * enderezando progresivamente la vista hacia el nadir (-90°) para que la Tierra nunca se pierda
 * hacia abajo de la pantalla.
 */
export function maxZoomOutPitchRad(heightM: number): number {
  const MIN_H = 300_000;
  const MAX_H = 2_500_000;
  const SHALLOW_PITCH = Cesium.Math.toRadians(-15);
  const NADIR_PITCH = Cesium.Math.toRadians(-89.5);
  if (!Number.isFinite(heightM) || heightM <= MIN_H) {
    return SHALLOW_PITCH;
  }
  if (heightM >= MAX_H) {
    return NADIR_PITCH;
  }
  const t = Math.log(heightM / MIN_H) / Math.log(MAX_H / MIN_H);
  return SHALLOW_PITCH + t * (NADIR_PITCH - SHALLOW_PITCH);
}

export function computeStabilizedPitchRad(heightM: number, currentPitchRad: number): number {
  const limit = maxZoomOutPitchRad(heightM);
  return Math.min(currentPitchRad, limit);
}

/**
 * Rota la cámara alrededor del punto del terreno en el centro de la pantalla (si existe)
 * para cambiar el pitch sin que el mapa dé un salto brusco.
 */
function setPitchAroundScreenCenter(
  viewer: Cesium.Viewer,
  nextPitchRad: number,
  maxRangeM?: number
): void {
  const cam = viewer.camera;
  const canvas = viewer.scene.canvas;
  const centerPx = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const ray = cam.getPickRay(centerPx);
  const target =
    (ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined) ??
    cam.pickEllipsoid(centerPx, viewer.scene.globe.ellipsoid);

  if (target) {
    const currentRange = Cesium.Cartesian3.distance(cam.positionWC, target);
    const nextRange = maxRangeM !== undefined ? Math.min(currentRange, maxRangeM) : currentRange;
    if (Number.isFinite(nextRange) && nextRange > 1) {
      const heading = cam.heading;
      cam.lookAt(target, new Cesium.HeadingPitchRange(heading, nextPitchRad, nextRange));
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
  }

  if (maxRangeM !== undefined) {
    const carto = cam.positionCartographic;
    if (carto) {
      cam.setView({
        destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, maxRangeM),
        orientation: {
          heading: cam.heading,
          pitch: nextPitchRad,
          roll: 0,
        },
      });
      return;
    }
  }

  cam.setView({
    orientation: {
      heading: cam.heading,
      pitch: nextPitchRad,
      roll: 0,
    },
  });
}

export function is3DViewActive(viewer: Cesium.Viewer): boolean {
  return (
    viewer.scene.mode === Cesium.SceneMode.SCENE3D &&
    viewer.camera.pitch > Cesium.Math.toRadians(-72)
  );
}

export function toggle3DView(viewer: Cesium.Viewer, force3D?: boolean): boolean {
  const enable3D = force3D ?? !is3DViewActive(viewer);
  const applyPitch = () => {
    if (enable3D) {
      const height = viewer.camera.positionCartographic?.height ?? 450_000;
      const maxRange = height > 1_200_000 ? 350_000 : undefined;
      setPitchAroundScreenCenter(viewer, Cesium.Math.toRadians(-38), maxRange);
    } else {
      setPitchAroundScreenCenter(viewer, Cesium.Math.toRadians(-89.5));
    }
    requestRenderBurst(viewer, 1200);
  };

  if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
    const remove = viewer.scene.morphComplete.addEventListener(() => {
      remove();
      applyPitch();
    });
    viewer.scene.morphTo3D(0);
  } else {
    applyPitch();
  }
  return enable3D;
}

/**
 * Evita que al acercarse al terreno la colisión levante la cámara por encima del horizonte y
 * endereza progresivamente el ángulo (pitch -> -90°) solo al alejarse a escala continental.
 */
function setupCameraStabilizer(viewer: Cesium.Viewer): void {
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 25;
  controller.maximumZoomDistance = 22_000_000;
  controller.enableCollisionDetection = true;
  controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
  controller.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.RIGHT_DRAG,
    Cesium.CameraEventType.PINCH,
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT },
  ];

  let isUserTilting = false;
  const canvas = viewer.scene.canvas;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 1 || e.button === 2 || e.ctrlKey || e.metaKey || e.shiftKey) {
      isUserTilting = true;
    }
  };
  const onPointerUp = () => {
    isUserTilting = false;
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  let prevHeight = viewer.camera.positionCartographic?.height ?? 450_000;

  viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
    if (activeFlights > 0 || isUserTilting) {
      prevHeight = viewer.camera.positionCartographic?.height ?? prevHeight;
      return;
    }
    const cam = viewer.camera;
    const carto = cam.positionCartographic;
    if (!carto) return;
    const height = carto.height;
    const zoomingOut = height > 300_000 && height > prevHeight + Math.max(500, prevHeight * 0.005);
    prevHeight = height;

    // 1. Cerca del suelo: impedir que el choque con el relieve levante la cámara por encima del horizonte
    if (cam.pitch > Cesium.Math.toRadians(-8)) {
      setPitchAroundScreenCenter(viewer, Cesium.Math.toRadians(-8));
      return;
    }

    // 2. Al alejarse a escala continental: enderezar suavemente alrededor del punto central hacia -90°
    if (zoomingOut) {
      const stabilized = computeStabilizedPitchRad(height, cam.pitch);
      if (cam.pitch > stabilized + 1e-4) {
        const nextPitch = cam.pitch + (stabilized - cam.pitch) * 0.25;
        setPitchAroundScreenCenter(viewer, Math.max(nextPitch, stabilized));
      } else if (Math.abs(cam.roll) > 1e-3) {
        cam.setView({
          orientation: {
            heading: cam.heading,
            pitch: cam.pitch,
            roll: 0,
          },
        });
      }
    }
  });
}

/**
 * Con `requestRenderMode` Cesium solo dibuja cuando algo cambia. Las figuras pegadas al
 * relieve se construyen en segundo plano; esta ráfaga asegura que se vean al terminar.
 */
export function requestRenderBurst(viewer: Cesium.Viewer, durationMs = 3000): void {
  const until = performance.now() + durationMs;
  const tick = () => {
    if (viewer.isDestroyed()) return;
    viewer.scene.requestRender();
    if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number];
  };
}

/** Convierte un resultado GeoJSON de Photon (OSM) en destino válido para el buscador de Cesium. */
export function parsePhotonFeature(feature: PhotonFeature): Cesium.GeocoderService.Result | null {
  const coords = feature.geometry?.coordinates;
  const p = feature.properties;
  if (!p || !Array.isArray(coords) || coords.length < 2) return null;

  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  const labelParts = [p.name, p.city, p.state, p.country].filter(
    (part, idx, arr): part is string => Boolean(part) && arr.indexOf(part) === idx
  );
  const displayName = labelParts.join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  if (Array.isArray(p.extent) && p.extent.length === 4 && p.extent.every(Number.isFinite)) {
    const west = Math.max(-180, Math.min(p.extent[0], p.extent[2]));
    const east = Math.min(180, Math.max(p.extent[0], p.extent[2]));
    const south = Math.max(-89.9, Math.min(p.extent[1], p.extent[3]));
    const north = Math.min(89.9, Math.max(p.extent[1], p.extent[3]));
    if (east - west >= 0.002 && north - south >= 0.002) {
      return { displayName, destination: Cesium.Rectangle.fromDegrees(west, south, east, north) };
    }
  }

  return { displayName, destination: Cesium.Cartesian3.fromDegrees(lon, lat, 15_000) };
}

function createOpenGeocoderService(): Cesium.GeocoderService {
  return {
    credit: new Cesium.Credit(
      'Búsqueda: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      false
    ),
    async geocode(query: string): Promise<Cesium.GeocoderService.Result[]> {
      const clean = query.trim();
      if (clean.length < 2) return [];
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(clean)}&limit=6`,
          { signal: controller.signal }
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { features?: PhotonFeature[] };
        const results: Cesium.GeocoderService.Result[] = [];
        for (const f of data.features ?? []) {
          const parsed = parsePhotonFeature(f);
          if (parsed) results.push(parsed);
        }
        return results;
      } catch {
        return [];
      } finally {
        window.clearTimeout(timer);
      }
    },
  };
}

export async function createCesiumViewer(containerId: string): Promise<{
  viewer: Cesium.Viewer;
  terrain: TerrainStatus;
  imagery: ImageryKind;
}> {
  const token = getSavedIonToken();
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
  }

  const viewer = new Cesium.Viewer(containerId, {
    baseLayer: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    vrButton: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    // Buscador abierto por país, ciudad o coordenadas (funciona con o sin token de Ion)
    geocoder: [new Cesium.CartographicGeocoderService(), createOpenGeocoderService()],
    baseLayerPicker: false,
    infoBox: false,
    selectionIndicator: false,
    // R1: dibujar solo cuando algo cambia (en reposo la GPU queda libre)
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    // Preferir GPU dedicada de alto rendimiento para renderizar el visor
    contextOptions: {
      webgl: {
        powerPreference: 'high-performance',
      },
    },
  });

  const geocoderInput = viewer.geocoder?.container.querySelector(
    '.cesium-geocoder-input'
  ) as HTMLInputElement | null;
  if (geocoderInput) {
    geocoderInput.placeholder = 'Buscar país, ciudad o lugar...';
  }
  viewer.geocoder?.viewModel.complete.addEventListener(() => {
    viewer.scene.requestRender();
  });
  viewer.camera.moveEnd.addEventListener(() => {
    if (activeImageryKind === 'sentinel2-eox' && activeFlights === 0) {
      const cam = viewer.camera.positionCartographic;
      if (cam.height <= DETAIL_HIDE_ABOVE_M) {
        focusDetailImagery(viewer, Cesium.Math.toDegrees(cam.longitude), Cesium.Math.toDegrees(cam.latitude));
      }
    }
  });
  window.addEventListener('resize', () => {
    if (!viewer.isDestroyed()) {
      viewer.resize();
      viewer.scene.requestRender();
    }
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.fog.enabled = true; // también descarta teselas lejanas

  // R11: medidor de cuadros por segundo con ?debug
  if (new URLSearchParams(window.location.search).has('debug')) {
    viewer.scene.debugShowFramesPerSecond = true;
  }

  setupAdaptiveQuality(viewer);
  setupCameraStabilizer(viewer);

  const [imagery, terrain] = await Promise.all([
    addBaseImagery(viewer),
    setupTerrain(viewer, token),
  ]);

  // Vista inicial hacia el Desierto de Atacama
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-68.25, -23.5, 450_000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-65),
      roll: 0,
    },
  });
  viewer.scene.requestRender();

  return { viewer, terrain, imagery };
}

/**
 * Orden de terreno: 1) terreno local generado offline (I-40), 2) Cesium World Terrain si hay
 * token, 3) sin terreno (globo liso; el relieve de las zonas queda "sin dato").
 */
export async function setupTerrain(viewer: Cesium.Viewer, token: string): Promise<TerrainStatus> {
  clearElevationCache();

  const layer = await probe(`${LOCAL_TERRAIN_URL}layer.json`, 2000);
  if (layer) {
    let isLayerJson = false;
    try {
      const json = await layer.json();
      isLayerJson = Array.isArray(json?.tiles);
    } catch {
      isLayerJson = false; // el servidor devolvió otra cosa (por ejemplo index.html)
    }
    if (isLayerJson) {
      try {
        viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(LOCAL_TERRAIN_URL);
        return { kind: 'local' };
      } catch (err) {
        console.warn('No se pudo cargar el terreno local de /terreno:', err);
      }
    }
  }

  if (token && (await enableWorldTerrain(viewer, token))) {
    return { kind: 'ion' };
  }

  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  return { kind: 'ninguno' };
}

export async function enableWorldTerrain(
  viewer: Cesium.Viewer,
  token: string
): Promise<boolean> {
  clearElevationCache();
  const clean = token.trim();
  if (!clean) {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    return false;
  }

  try {
    Cesium.Ion.defaultAccessToken = clean;
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
      requestWaterMask: false,
    });
    viewer.scene.requestRender();
    return true;
  } catch (err) {
    console.warn('No se pudo activar Cesium World Terrain con el token proporcionado:', err);
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    return false;
  }
}

/* ------------------------------------------------------------------------------------------
 * Alturas del terreno (sobre el elipsoide WGS84, P8). null = sin dato, nunca 0 (P9).
 * La caché guarda solo alturas de máximo detalle y tiene tope (R5).
 * ---------------------------------------------------------------------------------------- */

const DETAIL_CACHE_MAX = 5000;
const detailCache = new Map<string, number>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function cacheSet(key: string, value: number): void {
  if (detailCache.has(key)) detailCache.delete(key);
  detailCache.set(key, value);
  if (detailCache.size > DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value;
    if (oldest !== undefined) detailCache.delete(oldest);
  }
}

export function clearElevationCache(): void {
  detailCache.clear();
}

export function hasRealTerrain(viewer: Cesium.Viewer): boolean {
  return !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
}

/** Altura rápida con las teselas ya cargadas. No se guarda en caché porque puede ser gruesa. */
export function getGroundElevation(viewer: Cesium.Viewer, lat: number, lon: number): number | null {
  const cached = detailCache.get(cacheKey(lat, lon));
  if (cached !== undefined) return cached;
  if (!hasRealTerrain(viewer)) return null;
  const h = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
  return h !== undefined && Number.isFinite(h) ? h : null;
}

/** Altura de máximo detalle. Solo esta se guarda en caché. */
export async function sampleGroundElevation(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number
): Promise<number | null> {
  const key = cacheKey(lat, lon);
  const cached = detailCache.get(key);
  if (cached !== undefined) return cached;
  if (!hasRealTerrain(viewer)) return null;

  const provider = viewer.terrainProvider;
  if (provider.availability) {
    try {
      const [sampled] = await Cesium.sampleTerrainMostDetailed(provider, [
        Cesium.Cartographic.fromDegrees(lon, lat),
      ]);
      if (sampled?.height !== undefined && Number.isFinite(sampled.height)) {
        cacheSet(key, sampled.height);
        return sampled.height;
      }
    } catch (err) {
      console.warn('sampleTerrainMostDetailed no disponible para esta coordenada:', err);
    }
  }
  return getGroundElevation(viewer, lat, lon);
}

function flyToGround(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  groundH: number,
  range: number,
  duration: number,
  complete?: () => void
): void {
  focusDetailImagery(viewer, lon, lat);
  const safeRange = Math.max(80, range);
  const pitchRad = Math.min(Cesium.Math.toRadians(-50), maxZoomOutPitchRad(safeRange));
  const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, groundH), 1.0);
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new Cesium.HeadingPitchRange(
      viewer.camera.heading,
      pitchRad,
      safeRange
    ),
    duration,
    ...trackedFlight(complete),
  });
}

/**
 * R4: vuela de inmediato con la mejor altura disponible y, si la altura detallada llega
 * distinta, corrige al llegar. Devuelve la altura detallada (o null sin terreno).
 */
export function flyToCoordinates(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  heightAboveGround: number = 1_200,
  knownElevation?: number | null
): Promise<number | null> {
  if (knownElevation !== undefined && knownElevation !== null) {
    flyToGround(viewer, lat, lon, knownElevation, heightAboveGround, 1.2);
    return Promise.resolve(knownElevation);
  }

  const quick = getGroundElevation(viewer, lat, lon) ?? 0;
  let arrived = false;
  let pendingAdjust: (() => void) | null = null;
  flyToGround(viewer, lat, lon, quick, heightAboveGround, 1.2, () => {
    arrived = true;
    pendingAdjust?.();
  });

  return sampleGroundElevation(viewer, lat, lon).then((detailed) => {
    if (detailed !== null && Math.abs(detailed - quick) > 30) {
      const adjust = () => flyToGround(viewer, lat, lon, detailed, heightAboveGround, 0.4);
      if (arrived) adjust();
      else pendingAdjust = adjust;
    }
    return detailed;
  });
}

let currentTargetMarker: Cesium.Entity | null = null;

function markerLabelText(lat: number, lon: number, elevationM: number | null | undefined): string {
  const alt =
    elevationM === undefined
      ? 'calculando…'
      : elevationM === null
        ? 'sin dato (sin terreno)'
        : `${formatElevation(elevationM)} ${ELEVATION_REFERENCE_LABEL}`;
  return `${lat.toFixed(5)}°, ${lon.toFixed(5)}°\nAlt: ${alt}`;
}

/** Marcador temporal. `undefined` en la altura = todavía calculando. */
export function setTargetMarker(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  elevationM?: number | null
): void {
  removeTargetMarker(viewer);

  currentTargetMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: {
      pixelSize: 14,
      color: Cesium.Color.fromCssColorString('#f59e0b'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: markerLabelText(lat, lon, elevationM),
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
    },
  });
  viewer.scene.requestRender();
}

export function updateTargetMarkerElevation(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  elevationM: number | null
): void {
  if (!currentTargetMarker?.label) return;
  currentTargetMarker.label.text = new Cesium.ConstantProperty(
    markerLabelText(lat, lon, elevationM)
  );
  viewer.scene.requestRender();
}

export function removeTargetMarker(viewer: Cesium.Viewer): void {
  if (currentTargetMarker) {
    viewer.entities.remove(currentTargetMarker);
    currentTargetMarker = null;
    viewer.scene.requestRender();
  }
}

export function zoomToTargetCoord(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  heightAboveGround: number,
  knownElevation?: number | null
): void {
  const groundH = knownElevation ?? getGroundElevation(viewer, lat, lon) ?? 0;
  flyToGround(viewer, lat, lon, groundH, heightAboveGround, 0.5);
}

export function flyToPolygonCoords(viewer: Cesium.Viewer, coords: GeoCoord[]): void {
  if (coords.length === 0) return;

  const cartesians = coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lon, c.lat));
  const boundingSphere = Cesium.BoundingSphere.fromPoints(cartesians);
  const radius = Math.max(boundingSphere.radius * 2.6, 2500);
  const center = Cesium.Cartographic.fromCartesian(boundingSphere.center);
  focusDetailImagery(
    viewer,
    Cesium.Math.toDegrees(center.longitude),
    Cesium.Math.toDegrees(center.latitude)
  );

  const pitchRad = Math.min(Cesium.Math.toRadians(-45), maxZoomOutPitchRad(radius * 0.65));
  viewer.camera.flyToBoundingSphere(boundingSphere, {
    offset: new Cesium.HeadingPitchRange(0, pitchRad, radius),
    duration: 1.6,
    ...trackedFlight(),
  });
}

/** P11: altura real de la cámara sobre el suelo (o sobre el elipsoide si no hay terreno). */
export function getCameraHeightAboveGround(viewer: Cesium.Viewer): {
  meters: number;
  overGround: boolean;
} {
  const carto = viewer.camera.positionCartographic;
  const ground = hasRealTerrain(viewer) ? viewer.scene.globe.getHeight(carto) : undefined;
  if (ground !== undefined && Number.isFinite(ground)) {
    return { meters: carto.height - ground, overGround: true };
  }
  return { meters: carto.height, overGround: false };
}
