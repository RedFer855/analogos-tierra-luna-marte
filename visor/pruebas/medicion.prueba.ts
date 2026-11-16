import * as Cesium from 'cesium';
import {
  analyzePolygonTerrain,
  computeSphericalAreaM2,
} from '../src/analysis/terrainAnalysis';
import {
  buildCircleFromPerimeter,
  buildSquareAroundPoint,
  buildSquareFromPerimeter,
} from '../src/tools/drawer';
import { sanitizeMission } from '../src/missions/missionManager';
import { escapeHtml } from '../src/util/format';
import {
  buildBaseImageryUrl,
  computeStabilizedPitchRad,
  eoxTemplate,
  getGibsRecentDateIso,
  isInDetailCoverage,
  maxZoomOutPitchRad,
  parseImageryChoice,
  parsePhotonFeature,
  requestedEoxYear,
} from '../src/map/viewer';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle: unknown) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre} -> ${JSON.stringify(detalle)}`);
  if (!cond) fallos++;
}

const LAT0 = -24.1;
const LON0 = -69.9;
const M_PER_DEG = 111_320;

/** Visor falso: sin `availability` => usa globe.getHeight (camino 'teselas-cargadas'). */
function fakeViewer(heightFn: (latDeg: number, lonDeg: number) => number | undefined) {
  return {
    terrainProvider: { availability: undefined },
    scene: {
      globe: {
        getHeight: (c: Cesium.Cartographic) =>
          heightFn(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude)),
      },
    },
  } as unknown as Cesium.Viewer;
}

const eastM = (lat: number, lon: number) =>
  (lon - LON0) * M_PER_DEG * Math.cos(Cesium.Math.toRadians(lat));
const northM = (lat: number) => (lat - LAT0) * M_PER_DEG;

const square = buildSquareAroundPoint(LAT0, LON0, 4);

// 1. Plano inclinado 10 % hacia el este
const m1 = await analyzePolygonTerrain(
  fakeViewer((lat, lon) => 1000 + 0.1 * eastM(lat, lon)),
  square,
  { kind: 'ion' }
);
check('plano 10 % este: pendiente ≈ 10', Math.abs((m1.avgSlopePercent ?? 0) - 10) < 0.3, m1.avgSlopePercent);
check('plano 10 % este: desnivel ≈ 400 m', Math.abs((m1.reliefDepthM ?? 0) - 400) < 15, m1.reliefDepthM);
check('plano 10 % este: área ≈ 16 km²', Math.abs(m1.areaKm2 - 16) < 0.2, m1.areaKm2);
check('plano 10 % este: separación informada', m1.slopeSpacingM !== null && m1.slopeSpacingM >= 30, m1.slopeSpacingM);

// 2. Plano inclinado 10 % hacia el norte
const m2 = await analyzePolygonTerrain(
  fakeViewer((lat) => 1000 + 0.1 * northM(lat)),
  square,
  { kind: 'ion' }
);
check('plano 10 % norte: pendiente ≈ 10', Math.abs((m2.avgSlopePercent ?? 0) - 10) < 0.3, m2.avgSlopePercent);

// 3. Terreno a 0 m (costa): el 0 es un dato, no un faltante
const m3 = await analyzePolygonTerrain(fakeViewer(() => 0), square, { kind: 'ion' });
check('terreno a 0 m: cota máx = 0 (no null)', m3.maxElevationM === 0, m3.maxElevationM);
check('terreno a 0 m: pendiente = 0', m3.avgSlopePercent === 0, m3.avgSlopePercent);
check('terreno a 0 m: fuente con dato', m3.terrainSource === 'teselas-cargadas', m3.terrainSource);

// 4. Mitad oeste sin dato: no se corren las alturas (P7)
const m4 = await analyzePolygonTerrain(
  fakeViewer((lat, lon) => (lon < LON0 ? undefined : 1000 + 0.1 * eastM(lat, lon))),
  square,
  { kind: 'ion' }
);
check('huecos al oeste: pendiente sigue ≈ 10', Math.abs((m4.avgSlopePercent ?? 0) - 10) < 0.3, m4.avgSlopePercent);
check('huecos al oeste: cota mín ≈ 1000', Math.abs((m4.minElevationM ?? 0) - 1000) < 15, m4.minElevationM);

// 5. Sin terreno: relieve null, área real
const m5 = await analyzePolygonTerrain(fakeViewer(() => 0), square, { kind: 'ninguno' });
check(
  'sin terreno: relieve null',
  m5.maxElevationM === null && m5.avgSlopePercent === null && m5.approxVolumeM3 === null,
  { max: m5.maxElevationM, slope: m5.avgSlopePercent, vol: m5.approxVolumeM3 }
);
check('sin terreno: fuente sin-dato', m5.terrainSource === 'sin-dato', m5.terrainSource);
check('sin terreno: área sigue real', Math.abs(m5.areaKm2 - 16) < 0.2, m5.areaKm2);

// 6. Antimeridiano: cuadro de 4 km centrado en lon 180
const anti = buildSquareAroundPoint(-17, 179.99, 4);
const areaAnti = computeSphericalAreaM2(anti) / 1e6;
check('antimeridiano: área ≈ 16 km² (no medio planeta)', Math.abs(areaAnti - 16) < 0.3, areaAnti);

// 7. Validación al importar (S1) y migración de la v1 (P1, P7, P9)
const malicioso = sanitizeMission(
  {
    id: 'x" onmouseover="alert(1)',
    name: '<img src=x onerror=alert(1)>',
    coordinates: square,
    metrics: { maxElevationM: '5000', terrainSource: 'cesium-world-terrain' },
  },
  'imported'
);
check('import: fuente marcada importado', malicioso?.metrics.terrainSource === 'importado', malicioso?.metrics.terrainSource);
check('import: área recalculada', Math.abs((malicioso?.metrics.areaKm2 ?? 0) - 16) < 0.2, malicioso?.metrics.areaKm2);
check('escapeHtml neutraliza la etiqueta', !escapeHtml(malicioso?.name).includes('<img'), escapeHtml(malicioso?.name));
check('escapeHtml neutraliza comillas del id', !escapeHtml(malicioso?.id).includes('"'), escapeHtml(malicioso?.id));
check(
  'import: coordenadas fuera de rango se rechazan',
  sanitizeMission({ coordinates: [{ lat: 95, lon: 0 }, { lat: 0, lon: 0 }, { lat: 1, lon: 1 }] }, 'imported') === null,
  'null'
);
const simulada = sanitizeMission(
  { coordinates: square, metrics: { maxElevationM: 1185, avgSlopePercent: 6.4, terrainSource: 'ellipsoid-estimated' } },
  'legacy'
);
check('v1 simulada: relieve borrado', simulada?.metrics.maxElevationM === null && simulada?.metrics.terrainSource === 'sin-dato', simulada?.metrics);
const v1real = sanitizeMission(
  { coordinates: square, metrics: { maxElevationM: 1185, avgSlopePercent: 6.4, terrainSource: 'cesium-world-terrain' } },
  'legacy'
);
check('v1 con terreno: cota se queda, pendiente se descarta', v1real?.metrics.maxElevationM === 1185 && v1real?.metrics.avgSlopePercent === null, v1real?.metrics);

// 8. Parseo de geocoder Photon (país/ciudad sin token)
const cityRes = parsePhotonFeature({
  geometry: { coordinates: [-87.2047, 14.1058] },
  properties: { name: 'Tegucigalpa', city: 'Tegucigalpa', state: 'Francisco Morazán', country: 'Honduras', extent: [-87.28, 14.14, -87.13, 14.0] },
});
check(
  'geocoder: ciudad con extent válido y nombre deduplicado',
  cityRes?.displayName === 'Tegucigalpa, Francisco Morazán, Honduras' &&
    cityRes.destination instanceof Cesium.Rectangle &&
    cityRes.destination.south < cityRes.destination.north &&
    cityRes.destination.west < cityRes.destination.east,
  cityRes?.displayName
);
const pointRes = parsePhotonFeature({
  geometry: { coordinates: [-69.42, -24.55] },
  properties: { name: 'Desierto de Atacama', country: 'Chile' },
});
check(
  'geocoder: punto sin extent usa Cartesian3',
  pointRes?.displayName === 'Desierto de Atacama, Chile' && pointRes.destination instanceof Cesium.Cartesian3,
  pointRes?.displayName
);
check(
  'geocoder: coordenada fuera de rango se rechaza',
  parsePhotonFeature({ geometry: { coordinates: [220, 95] }, properties: { name: 'Inválido' } }) === null,
  'null'
);

// 9. Selector de capas abiertas (EOX + NASA GIBS BlueMarble, sin VIIRS/MODIS)
const dateIso = getGibsRecentDateIso(Date.UTC(2026, 10, 12, 4, 30, 0), 2);
check('gibs: fecha reciente UTC menos 2 días', dateIso === '2026-11-10', dateIso);
check('capa: ?capa=viirs ya no existe', parseImageryChoice('?debug&capa=viirs') === null, parseImageryChoice('?debug&capa=viirs'));
check('capa: ?capa=modis ya no existe', parseImageryChoice('?capa=MODIS') === null, parseImageryChoice('?capa=MODIS'));
check('capa: desconocida devuelve null', parseImageryChoice('?capa=esri') === null, parseImageryChoice('?capa=esri'));

// 10. Mapa y nitidez extraídos de main (#32): EOX 2025 por defecto y cobertura USGS ~2 m
check('eox: año por defecto 2025', requestedEoxYear('') === 2025, requestedEoxYear(''));
check('eox: ?imagen=2016 vuelve a 2016', requestedEoxYear('?imagen=2016') === 2016, requestedEoxYear('?imagen=2016'));
check(
  'eox: plantilla 2025 usa s2cloudless-2025_3857',
  eoxTemplate(2025).includes('s2cloudless-2025_3857'),
  eoxTemplate(2025)
);
check('usgs: Atacama queda fuera de cobertura 2 m', !isInDetailCoverage(-68.25, -23.5), isInDetailCoverage(-68.25, -23.5));
check('usgs: Hanksville Utah entra en cobertura 2 m', isInDetailCoverage(-110.71, 38.37), isInDetailCoverage(-110.71, 38.37));

// 11. Cuadrado y círculo por perímetro + color personalizado
const sqPerim = buildSquareFromPerimeter(LAT0, LON0, 20);
const sqAreaKm2 = computeSphericalAreaM2(sqPerim) / 1e6;
check('cuadro perímetro 20 km: área ≈ 25 km²', Math.abs(sqAreaKm2 - 25) < 0.3, sqAreaKm2);

const circPerim = buildCircleFromPerimeter(LAT0, LON0, 20);
const circAreaKm2 = computeSphericalAreaM2(circPerim) / 1e6;
const expectedCircArea = (20 * 20) / (4 * Math.PI);
check('círculo perímetro 20 km: área ≈ 31.83 km²', Math.abs(circAreaKm2 - expectedCircArea) < 0.4, circAreaKm2);

const circMission = sanitizeMission(
  { coordinates: circPerim, shapeType: 'circle', color: '#10B981' },
  'stored'
);
check(
  'sanitizeMission conserva shapeType circle y color hex válido',
  circMission?.shapeType === 'circle' && circMission?.color === '#10b981',
  { shapeType: circMission?.shapeType, color: circMission?.color }
);
const badColorMission = sanitizeMission(
  { coordinates: circPerim, color: 'javascript:alert(1)' },
  'stored'
);
check('sanitizeMission rechaza color inválido', badColorMission?.color === undefined, badColorMission?.color);

// 12. Estabilización de cámara al alejarse (evita que la Tierra se pierda hacia abajo)
const pitchCloseDeg = Cesium.Math.toDegrees(maxZoomOutPitchRad(100));
const pitchZoneDeg = Cesium.Math.toDegrees(maxZoomOutPitchRad(80_000));
const pitchMidDeg = Cesium.Math.toDegrees(maxZoomOutPitchRad(1_000_000));
const pitchFarDeg = Cesium.Math.toDegrees(maxZoomOutPitchRad(3_000_000));
check('cámara: límite cerca (100 m) permite vista 3D (-15°)', Math.abs(pitchCloseDeg - -15) < 0.1, pitchCloseDeg);
check('cámara: zona local (80 km) mantiene libertad 3D (-15°)', Math.abs(pitchZoneDeg - -15) < 0.1, pitchZoneDeg);
check('cámara: escala continental (1000 km) endereza progresivamente', pitchMidDeg < -40 && pitchMidDeg > -75, pitchMidDeg);
check('cámara: límite lejano (3000 km) endereza al nadir (-89.5°)', Math.abs(pitchFarDeg - -89.5) < 0.1, pitchFarDeg);
const preservedDeg = Cesium.Math.toDegrees(
  computeStabilizedPitchRad(80_000, Cesium.Math.toRadians(-25))
);
check('cámara: pitch oblicuo (-25°) a 80 km se conserva para explorar en 3D', Math.abs(preservedDeg - -25) < 0.1, preservedDeg);

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBA(S) FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
