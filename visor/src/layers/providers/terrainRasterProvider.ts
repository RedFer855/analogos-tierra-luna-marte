import type { MissionZone } from '../../types/mission';
import type { ZoneBounds, ZoneLayerResult } from '../../types/zoneLayers';
import {
  applyPolygonAlphaMask,
  chooseTileZoomForBounds,
  computePolygonBounds,
  isCoordInPolygon,
  latToTileY,
  lonToTileX,
} from '../geoClipUtils';

export interface DecodedDemGrid {
  bounds: ZoneBounds;
  zoom: number;
  width: number;
  height: number;
  cellWidthM: number;
  cellHeightM: number;
  heights: Float32Array;
  maskInside: Uint8Array;
  minElevM: number;
  maxElevM: number;
  meanElevM: number;
  reliefDepthM: number;
  slopePct: Float32Array;
  triM: Float32Array;
  minSlopePct: number;
  maxSlopePct: number;
  meanSlopePct: number;
  meanTriM: number;
  maxTriM: number;
  validPixels: number;
}

const demGridCache = new Map<string, DecodedDemGrid>();

/** Decodifica RGB Mapzen Terrarium a elevación absoluta en metros sobre EGM96/WGS84. */
export function decodeTerrariumHeightM(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface DerivedTerrainStats {
  slopePct: Float32Array;
  triM: Float32Array;
  minElevM: number;
  maxElevM: number;
  meanElevM: number;
  reliefDepthM: number;
  minSlopePct: number;
  maxSlopePct: number;
  meanSlopePct: number;
  meanTriM: number;
  maxTriM: number;
  validPixels: number;
}

/**
 * Calcula pendiente porcentual (variable N1) y TRI (Terrain Ruggedness Index, rugosidad en metros)
 * por diferencias finitas sobre una rejilla métrica regular filtrada al polígono.
 */
export function computeSlopeAndTriFromGrid(
  heights: Float32Array,
  width: number,
  height: number,
  cellWidthM: number,
  cellHeightM: number,
  maskInside: Uint8Array
): DerivedTerrainStats {
  const n = width * height;
  const slopePct = new Float32Array(n);
  const triM = new Float32Array(n);

  let minElevM = Infinity;
  let maxElevM = -Infinity;
  let sumElev = 0;
  let validPixels = 0;

  let minSlopePct = Infinity;
  let maxSlopePct = 0;
  let sumSlope = 0;
  let slopeCount = 0;

  let maxTriM = 0;
  let sumTri = 0;
  let triCount = 0;

  const dxStep = Math.max(1e-3, cellWidthM);
  const dyStep = Math.max(1e-3, cellHeightM);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      if (maskInside[idx] !== 1) continue;
      const h = heights[idx];
      if (!Number.isFinite(h)) continue;

      validPixels++;
      sumElev += h;
      if (h < minElevM) minElevM = h;
      if (h > maxElevM) maxElevM = h;

      const cL = col > 0 && Number.isFinite(heights[row * width + (col - 1)]) ? col - 1 : col;
      const cR = col < width - 1 && Number.isFinite(heights[row * width + (col + 1)]) ? col + 1 : col;
      const rU = row > 0 && Number.isFinite(heights[(row - 1) * width + col]) ? row - 1 : row;
      const rD = row < height - 1 && Number.isFinite(heights[(row + 1) * width + col]) ? row + 1 : row;

      const spanX = Math.max(1, cR - cL) * dxStep;
      const spanY = Math.max(1, rD - rU) * dyStep;
      const dzdx = (heights[row * width + cR] - heights[row * width + cL]) / spanX;
      const dzdy = (heights[rD * width + col] - heights[rU * width + col]) / spanY;
      const sl = 100 * Math.sqrt(dzdx * dzdx + dzdy * dzdy);

      slopePct[idx] = sl;
      sumSlope += sl;
      slopeCount++;
      if (sl < minSlopePct) minSlopePct = sl;
      if (sl > maxSlopePct) maxSlopePct = sl;

      // TRI de Riley (RMS de diferencias respecto a los 8 vecinos válidos)
      let sqSum = 0;
      let nbCount = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          const nh = heights[nr * width + nc];
          if (!Number.isFinite(nh)) continue;
          const diff = nh - h;
          sqSum += diff * diff;
          nbCount++;
        }
      }
      const tri = nbCount > 0 ? Math.sqrt(sqSum / nbCount) : 0;
      triM[idx] = tri;
      sumTri += tri;
      triCount++;
      if (tri > maxTriM) maxTriM = tri;
    }
  }

  return {
    slopePct,
    triM,
    minElevM: validPixels > 0 ? minElevM : 0,
    maxElevM: validPixels > 0 ? maxElevM : 0,
    meanElevM: validPixels > 0 ? sumElev / validPixels : 0,
    reliefDepthM: validPixels > 0 ? maxElevM - minElevM : 0,
    minSlopePct: slopeCount > 0 ? minSlopePct : 0,
    maxSlopePct: slopeCount > 0 ? maxSlopePct : 0,
    meanSlopePct: slopeCount > 0 ? sumSlope / slopeCount : 0,
    meanTriM: triCount > 0 ? sumTri / triCount : 0,
    maxTriM: triCount > 0 ? maxTriM : 0,
    validPixels,
  };
}

function interpolatePalette(t: number, stops: Array<[number, number, number]>): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  const scaled = c * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - idx;
  const a = stops[idx];
  const b = stops[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

async function fetchTileBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal, mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function loadOrComputeDemGrid(
  zone: MissionZone,
  signal?: AbortSignal
): Promise<DecodedDemGrid | null> {
  const geom = computePolygonBounds(zone.coordinates);
  const { bounds, unwrapped, centerLat } = geom;
  const cacheKey = `${zone.id}|${bounds.west.toFixed(5)},${bounds.south.toFixed(5)},${bounds.east.toFixed(5)},${bounds.north.toFixed(5)}`;
  const cached = demGridCache.get(cacheKey);
  if (cached) return cached;

  const zoom = chooseTileZoomForBounds(bounds, 5, 13, 3);
  const n = Math.pow(2, zoom);
  const xStart = Math.floor(lonToTileX(bounds.west, zoom));
  const xEnd = Math.floor(lonToTileX(bounds.east - 1e-9, zoom));
  const yStart = Math.max(0, Math.floor(latToTileY(bounds.north, zoom)));
  const yEnd = Math.min(n - 1, Math.floor(latToTileY(bounds.south + 1e-9, zoom)));

  const tilesX = xEnd - xStart + 1;
  const tilesY = yEnd - yStart + 1;

  const mercCanvas = document.createElement('canvas');
  mercCanvas.width = tilesX * 256;
  mercCanvas.height = tilesY * 256;
  const mercCtx = mercCanvas.getContext('2d', { willReadFrequently: true })!;

  let loadedTiles = 0;
  const jobs: Array<Promise<void>> = [];
  for (let ty = yStart; ty <= yEnd; ty++) {
    for (let tx = xStart; tx <= xEnd; tx++) {
      const wrappedX = ((tx % n) + n) % n;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${wrappedX}/${ty}.png`;
      const dx = (tx - xStart) * 256;
      const dy = (ty - yStart) * 256;
      jobs.push(
        fetchTileBitmap(url, signal).then((img) => {
          if (img) {
            mercCtx.drawImage(img, dx, dy, 256, 256);
            loadedTiles++;
            if ('close' in img && typeof img.close === 'function') img.close();
          }
        })
      );
    }
  }
  await Promise.all(jobs);
  if (signal?.aborted) return null;
  if (loadedTiles === 0) return null;

  const mercData = mercCtx.getImageData(0, 0, mercCanvas.width, mercCanvas.height).data;
  const mercW = mercCanvas.width;
  const mercH = mercCanvas.height;

  const sampleMercHeightBilinear = (fx: number, fy: number): number => {
    const x0 = Math.max(0, Math.min(mercW - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(mercH - 1, Math.floor(fy)));
    const x1 = Math.min(mercW - 1, x0 + 1);
    const y1 = Math.min(mercH - 1, y0 + 1);
    const wx = Math.max(0, Math.min(1, fx - x0));
    const wy = Math.max(0, Math.min(1, fy - y0));

    const readPx = (px: number, py: number): number | null => {
      const p = (py * mercW + px) * 4;
      return mercData[p + 3] >= 128
        ? decodeTerrariumHeightM(mercData[p], mercData[p + 1], mercData[p + 2])
        : null;
    };

    const h00 = readPx(x0, y0);
    if (h00 === null) return Number.NaN;
    const h10 = readPx(x1, y0) ?? h00;
    const h01 = readPx(x0, y1) ?? h00;
    const h11 = readPx(x1, y1) ?? h00;
    return (
      h00 * (1 - wx) * (1 - wy) +
      h10 * wx * (1 - wy) +
      h01 * (1 - wx) * wy +
      h11 * wx * wy
    );
  };

  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const spanLonM = Math.max(30, (bounds.east - bounds.west) * mPerDegLon);
  const spanLatM = Math.max(30, (bounds.north - bounds.south) * mPerDegLat);

  // Evita sobremuestrear por debajo de la resolución nativa (~18-25 m) para no crear falsas pendientes por escalón
  const gridW = Math.max(12, Math.min(128, Math.round(spanLonM / 20)));
  const gridH = Math.max(12, Math.min(128, Math.round(spanLatM / 20)));
  const heights = new Float32Array(gridW * gridH);
  const maskInside = new Uint8Array(gridW * gridH);

  for (let row = 0; row < gridH; row++) {
    const lat = bounds.north - ((bounds.north - bounds.south) * (row + 0.5)) / gridH;
    const fy = (latToTileY(lat, zoom) - yStart) * 256;

    for (let col = 0; col < gridW; col++) {
      const lon = bounds.west + ((bounds.east - bounds.west) * (col + 0.5)) / gridW;
      const fx = (lonToTileX(lon, zoom) - xStart) * 256;

      const idx = row * gridW + col;
      heights[idx] = sampleMercHeightBilinear(fx, fy);
      maskInside[idx] = isCoordInPolygon(lat, lon, unwrapped) ? 1 : 0;
    }
  }

  const cellWidthM = spanLonM / gridW;
  const cellHeightM = spanLatM / gridH;

  const stats = computeSlopeAndTriFromGrid(
    heights,
    gridW,
    gridH,
    cellWidthM,
    cellHeightM,
    maskInside
  );

  if (stats.validPixels === 0) return null;

  const result: DecodedDemGrid = {
    bounds,
    zoom,
    width: gridW,
    height: gridH,
    cellWidthM,
    cellHeightM,
    heights,
    maskInside,
    ...stats,
  };
  demGridCache.set(cacheKey, result);
  return result;
}

export async function loadTerrainRasterLayer(
  zone: MissionZone,
  mode: 'elevation-dem' | 'slope-percent' | 'slope-ruggedness',
  signal?: AbortSignal
): Promise<ZoneLayerResult> {
  const geom = computePolygonBounds(zone.coordinates);
  const grid = await loadOrComputeDemGrid(zone, signal);

  if (!grid) {
    return {
      subLayerId: mode,
      title: 'Modelo Digital de Elevación (30 m)',
      role: mode === 'elevation-dem' ? 'contexto' : 'comparable',
      roleLabel:
        mode === 'elevation-dem'
          ? 'Altitud / Referencia hipsométrica (D1)'
          : 'Comparable N1 / Rugosidad (ADR-008)',
      unit: mode === 'slope-percent' ? '%' : 'm',
      resolutionLabel: 'DEM abierto 30 m (AWS Terrarium)',
      sourceLabel: 'Mapzen / AWS Terrarium DEM (SRTM + Copernicus)',
      note: 'No se pudo descargar la cobertura DEM para esta zona.',
      minLabel: 'sin dato',
      maxLabel: 'sin dato',
      meanLabel: 'sin dato',
      legendStops: [],
      metricsRows: [],
      canvas: null,
      bounds: geom.bounds,
      available: false,
      unavailableReason: 'Sin respuesta de teselas DEM Terrarium.',
    };
  }

  const { width, height, bounds, maskInside } = grid;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d')!;
  const imgData = srcCtx.createImageData(width, height);

  // Paletas científicas libres de conflicto con borde Marte (#f97316) y Luna (#38bdf8)
  const elevStops: Array<[number, number, number]> = [
    [30, 27, 75],   // #1e1b4b índigo profundo
    [13, 148, 136], // #0d9488 teal
    [217, 119, 6],  // #d97706 ocre
    [254, 243, 199],// #fef3c7 marfil cumbre
  ];
  const slopeStops: Array<[number, number, number]> = [
    [16, 185, 129], // #10b981 seguro <=5%
    [132, 204, 22], // #84cc16 suave
    [234, 179, 8],  // #eab308 precaución ~12%
    [220, 38, 38],  // #dc2626 empinado ~25%
    [192, 38, 211], // #c026d3 extremo >=40%
  ];
  const triStops: Array<[number, number, number]> = [
    [59, 7, 100],   // #3b0764 plano liso
    [124, 58, 237], // #7c3aed rugosidad media
    [232, 121, 249],// #e879f9 quebrado
    [250, 232, 255],// #fae8ff muy rugoso
  ];

  const elevSpan = Math.max(1, grid.maxElevM - grid.minElevM);
  const triMaxScale = Math.max(5, grid.maxTriM);

  for (let i = 0; i < width * height; i++) {
    const pIdx = i * 4;
    if (maskInside[i] !== 1 || !Number.isFinite(grid.heights[i])) {
      imgData.data[pIdx + 3] = 0;
      continue;
    }

    let rgb: [number, number, number];
    if (mode === 'elevation-dem') {
      const t = (grid.heights[i] - grid.minElevM) / elevSpan;
      rgb = interpolatePalette(t, elevStops);
    } else if (mode === 'slope-percent') {
      const t = grid.slopePct[i] / 40;
      rgb = interpolatePalette(t, slopeStops);
    } else {
      const t = grid.triM[i] / triMaxScale;
      rgb = interpolatePalette(t, triStops);
    }

    imgData.data[pIdx] = rgb[0];
    imgData.data[pIdx + 1] = rgb[1];
    imgData.data[pIdx + 2] = rgb[2];
    imgData.data[pIdx + 3] = 235;
  }

  srcCtx.putImageData(imgData, 0, 0);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = 256;
  outCanvas.height = 256;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.drawImage(srcCanvas, 0, 0, 256, 256);
  applyPolygonAlphaMask(outCtx, 256, 256, bounds, geom.unwrapped);

  const cellStepLabel = `${Math.round((grid.cellWidthM + grid.cellHeightM) / 2)} m/celda`;

  if (mode === 'elevation-dem') {
    return {
      subLayerId: mode,
      title: 'Elevación DEM Absoluto',
      role: 'contexto',
      roleLabel: 'Altitud / Referencia hipsométrica (D1)',
      unit: 'm s.n.m.',
      resolutionLabel: `Terrarium z=${grid.zoom} · ${cellStepLabel}`,
      sourceLabel: 'Mapzen / AWS Terrarium DEM (SRTM + ASTER/Copernicus)',
      note: 'Altitud absoluta sobre el nivel del mar; sirve para contexto barométrico, líneas base geológicas y drenaje.',
      minLabel: `${Math.round(grid.minElevM)} m`,
      maxLabel: `${Math.round(grid.maxElevM)} m`,
      meanLabel: `${Math.round(grid.meanElevM)} m`,
      gradientCss: 'linear-gradient(90deg, #1e1b4b, #0d9488, #d97706, #fef3c7)',
      legendStops: [
        { color: '#1e1b4b', label: `${Math.round(grid.minElevM)} m` },
        { color: '#fef3c7', label: `${Math.round(grid.maxElevM)} m` },
      ],
      metricsRows: [
        { label: 'Desnivel absoluto (Δh)', value: `${Math.round(grid.reliefDepthM)} m` },
        { label: 'Altitud media', value: `${Math.round(grid.meanElevM)} m` },
        { label: 'Pendiente media (N1)', value: `${grid.meanSlopePct.toFixed(1)} %` },
        { label: 'Malla muestreada', value: `${grid.validPixels} celdas` },
      ],
      canvas: outCanvas,
      bounds,
      available: true,
      creditText: 'Elevation: AWS Open Data Terrarium DEM',
    };
  }

  if (mode === 'slope-percent') {
    const roverRisk =
      grid.meanSlopePct < 10
        ? 'Transitable (<10 %)'
        : grid.meanSlopePct < 20
          ? 'Moderado (10–20 %)'
          : 'Escarpado (≥20 %)';
    return {
      subLayerId: mode,
      title: 'Pendientes Superficiales (N1)',
      role: 'comparable',
      roleLabel: 'Comparable N1 · Movilidad (ADR-008)',
      unit: '% pendiente',
      resolutionLabel: `Terrarium z=${grid.zoom} · ${cellStepLabel}`,
      sourceLabel: 'Derivado DEM Mapzen / AWS Terrarium',
      note: 'Variable comparable N1 (ADR-008): inclinación real del terreno clave para tracción de rovers, aterrizaje y alunizajes.',
      minLabel: `${grid.minSlopePct.toFixed(1)} %`,
      maxLabel: `${grid.maxSlopePct.toFixed(1)} %`,
      meanLabel: `${grid.meanSlopePct.toFixed(1)} %`,
      gradientCss: 'linear-gradient(90deg, #10b981, #84cc16, #eab308, #dc2626, #c026d3)',
      legendStops: [
        { color: '#10b981', label: '0 % (plano)' },
        { color: '#c026d3', label: '≥40 % (escarpe)' },
      ],
      metricsRows: [
        { label: 'Evaluación rover', value: roverRisk },
        { label: 'Pendiente máxima', value: `${grid.maxSlopePct.toFixed(1)} %` },
        { label: 'Desnivel interno (Δh)', value: `${Math.round(grid.reliefDepthM)} m` },
        { label: 'Rugosidad media (TRI)', value: `${grid.meanTriM.toFixed(1)} m` },
      ],
      canvas: outCanvas,
      bounds,
      available: true,
      creditText: 'Slope N1: AWS Terrarium DEM',
    };
  }

  return {
    subLayerId: mode,
    title: 'Relieve Relativo y Rugosidad (TRI)',
    role: 'comparable',
    roleLabel: 'Comparable N2 / Rugosidad (ADR-008)',
    unit: 'm (TRI)',
    resolutionLabel: `Terrarium z=${grid.zoom} · ${cellStepLabel}`,
    sourceLabel: 'Derivado DEM Mapzen / AWS Terrarium',
    note: 'Índice de Rugosidad del Terreno (TRI): mide quiebres locales entre celdas adyacentes frente al desnivel relativo total de la zona.',
    minLabel: `0.0 m`,
    maxLabel: `${grid.maxTriM.toFixed(1)} m`,
    meanLabel: `${grid.meanTriM.toFixed(1)} m`,
    gradientCss: 'linear-gradient(90deg, #3b0764, #7c3aed, #e879f9, #fae8ff)',
    legendStops: [
      { color: '#3b0764', label: '0 m (liso)' },
      { color: '#fae8ff', label: `${grid.maxTriM.toFixed(0)} m (abrupto)` },
    ],
    metricsRows: [
      { label: 'Relieve relativo total', value: `${Math.round(grid.reliefDepthM)} m` },
      { label: 'Rugosidad TRI media', value: `${grid.meanTriM.toFixed(1)} m` },
      { label: 'Pico rugosidad local', value: `${grid.maxTriM.toFixed(1)} m` },
      { label: 'Pendiente media (N1)', value: `${grid.meanSlopePct.toFixed(1)} %` },
    ],
    canvas: outCanvas,
    bounds,
    available: true,
    creditText: 'Relief/TRI: AWS Terrarium DEM',
  };
}
