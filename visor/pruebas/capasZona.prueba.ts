import { deflateSync, inflateSync } from 'node:zlib';
import {
  buildInteriorSamplePoints,
  computePolygonBounds,
  isCoordInPolygon,
} from '../src/layers/geoClipUtils';
import {
  computeSlopeAndTriFromGrid,
  decodeTerrariumHeightM,
} from '../src/layers/providers/terrainRasterProvider';
import { classifyOperationalSoil, parseInt16GeoTiff } from '../src/layers/soilTiffParser';
import { ZONE_SUBLAYER_OPTIONS } from '../src/types/zoneLayers';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle: unknown) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre} -> ${JSON.stringify(detalle)}`);
  if (!cond) fallos++;
}

function buildSyntheticInt16StripTiff(
  width: number,
  height: number,
  values: number[],
  compressedPredictor2: boolean
): ArrayBuffer {
  const raw = new Uint8Array(width * height * 2);
  const rawView = new DataView(raw.buffer);
  for (let y = 0; y < height; y++) {
    let prev = 0;
    for (let x = 0; x < width; x++) {
      const val = values[y * width + x];
      const encoded = compressedPredictor2 ? ((val - prev) << 16) >> 16 : val;
      prev = val;
      rawView.setInt16((y * width + x) * 2, encoded, true);
    }
  }

  const payload = compressedPredictor2 ? new Uint8Array(deflateSync(raw)) : raw;

  // IFD: 8 tags (width=256, height=257, compression=259, stripOffsets=273, rowsPerStrip=278, stripByteCounts=279, predictor=317)
  const tags: Array<[number, number, number, number]> = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [259, 3, 1, compressedPredictor2 ? 8 : 1],
    [273, 4, 1, 8 + 2 + 7 * 12 + 4],
    [278, 4, 1, height],
    [279, 4, 1, payload.byteLength],
    [317, 3, 1, compressedPredictor2 ? 2 : 1],
  ];
  const ifdSize = 2 + tags.length * 12 + 4;
  const dataOffset = 8 + ifdSize;
  tags[3][3] = dataOffset;

  const buf = new ArrayBuffer(dataOffset + payload.byteLength);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Header 'II', 42, IFD at offset 8
  u8[0] = 0x49;
  u8[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, val], idx) => {
    const base = 10 + idx * 12;
    view.setUint16(base, tag, true);
    view.setUint16(base + 2, type, true);
    view.setUint32(base + 4, count, true);
    view.setUint32(base + 8, val, true);
  });
  view.setUint32(10 + tags.length * 12, 0, true);
  u8.set(payload, dataOffset);

  return buf;
}

async function run() {
  // 1. Catálogo de subcapas (7 familias principales)
  const families = new Set(ZONE_SUBLAYER_OPTIONS.map((o) => o.family));
  check(
    'catálogo cubre las 7 familias temáticas',
    ['geology', 'soil', 'radiation', 'elevation', 'slope', 'hydrology', 'ndvi'].every((f) =>
      families.has(f as never)
    ),
    [...families]
  );

  // 2. Geometría de recorte al polígono (Arequipa / Pampa La Joya)
  const poly = [
    { lat: -16.7, lon: -71.9 },
    { lat: -16.7, lon: -71.8 },
    { lat: -16.6, lon: -71.8 },
    { lat: -16.6, lon: -71.9 },
  ];
  const geom = computePolygonBounds(poly);
  check('bounds bbox exacto', Math.abs(geom.bounds.west - -71.9) < 1e-9 && Math.abs(geom.bounds.north - -16.6) < 1e-9, geom.bounds);
  check('punto interior reconocido dentro del polígono', isCoordInPolygon(-16.65, -71.85, geom.unwrapped), true);
  check('punto exterior excluido del polígono', !isCoordInPolygon(-16.5, -71.85, geom.unwrapped), false);
  const samples = buildInteriorSamplePoints(geom, 3);
  check('muestreo interior genera puntos dentro del polígono', samples.length >= 1 && samples.every((p) => isCoordInPolygon(p.lat, p.lon, geom.unwrapped)), samples.length);

  // 3. Parseo GeoTIFF INT16 sin compresión y Deflate + Predictor=2 (como SoilGrids WCS)
  const pixels = [120, 350, -32768, 680, 91, 410];
  const rawTiff = buildSyntheticInt16StripTiff(3, 2, pixels, false);
  const parsedRaw = await parseInt16GeoTiff(rawTiff);
  check(
    'GeoTIFF INT16 sin compresión',
    parsedRaw.width === 3 && parsedRaw.height === 2 && parsedRaw.data[2] === -32768 && parsedRaw.data[3] === 680,
    Array.from(parsedRaw.data)
  );

  const compressedTiff = buildSyntheticInt16StripTiff(3, 2, pixels, true);
  const parsedDeflate = await parseInt16GeoTiff(compressedTiff, async (c) => new Uint8Array(inflateSync(c)));
  check(
    'GeoTIFF INT16 Deflate + Predictor=2 decodificado sin pérdidas',
    pixels.every((v, i) => parsedDeflate.data[i] === v),
    Array.from(parsedDeflate.data)
  );

  // Regresión deadlock Web Streams: tile 256x256 (131 072 bytes descomprimidos) usando browserInflateZlib por defecto
  const largePixels = Array.from({ length: 256 * 256 }, (_, i) => ((i * 7) % 900) + 10);
  const largeTiff = buildSyntheticInt16StripTiff(256, 256, largePixels, true);
  const parsedLarge = await parseInt16GeoTiff(largeTiff);
  check(
    'GeoTIFF INT16 256x256 (131 KB) via DecompressionStream sin deadlock',
    parsedLarge.data.length === 65536 &&
      parsedLarge.data[0] === largePixels[0] &&
      parsedLarge.data[65535] === largePixels[65535],
    { len: parsedLarge.data.length, first: parsedLarge.data[0], last: parsedLarge.data[65535] }
  );

  // 4. Clasificación operativa de suelos
  check('clasifica arena >=65%', classifyOperationalSoil(10, 72, 18).kind === 'arena', classifyOperationalSoil(10, 72, 18));
  check('clasifica limo/polvo >=45%', classifyOperationalSoil(15, 30, 55).kind === 'limo-polvo', classifyOperationalSoil(15, 30, 55));
  check('clasifica arcilla >=35%', classifyOperationalSoil(42, 30, 28).kind === 'arcilla', classifyOperationalSoil(42, 30, 28));
  const franco = classifyOperationalSoil(25, 40, 35);
  check('clasifica franco/mixto residual', franco.kind === 'franco-mixto', franco);
  check(
    'franco/mixto evita colisión cromática con borde Luna (#38bdf8)',
    franco.rgb[0] !== 56 || franco.rgb[1] !== 189 || franco.rgb[2] !== 248,
    franco.rgb
  );

  // 5. Decodificación DEM Terrarium + derivación de Pendientes (N1) y TRI
  check('Terrarium RGB (128,0,0) = 0 m', decodeTerrariumHeightM(128, 0, 0) === 0, decodeTerrariumHeightM(128, 0, 0));
  const h2500 = decodeTerrariumHeightM(137, 196, 0);
  check('Terrarium RGB (137,196,0) = 2500 m', Math.abs(h2500 - 2500) < 1e-6, h2500);

  // Rejilla sintética 4x4 con pendiente exacta de 10 % hacia el este (paso 100 m -> +10 m por columna)
  const demHeights = new Float32Array(16);
  const demMask = new Uint8Array(16).fill(1);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      demHeights[r * 4 + c] = 1000 + c * 10;
    }
  }
  const demStats = computeSlopeAndTriFromGrid(demHeights, 4, 4, 100, 100, demMask);
  check(
    'pendiente planar 10 % y relieve relativo 30 m en DEM',
    Math.abs(demStats.meanSlopePct - 10) < 1e-4 &&
      Math.abs(demStats.reliefDepthM - 30) < 1e-4 &&
      demStats.meanTriM > 5,
    {
      meanSlopePct: demStats.meanSlopePct,
      reliefDepthM: demStats.reliefDepthM,
      meanTriM: demStats.meanTriM,
    }
  );

  if (fallos > 0) {
    console.error(`\nFallaron ${fallos} verificaciones en capasZona.prueba.ts.`);
    process.exit(1);
  }
  console.log('\nTodas las verificaciones de capas temáticas pasaron.');
}

void run();
