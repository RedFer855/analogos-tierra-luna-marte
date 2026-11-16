import * as Cesium from 'cesium';
import { unwrapLongitudes } from '../analysis/terrainAnalysis';
import type { DrawMode, GeoCoord, ShapeType } from '../types/mission';

export type ShapeCompletedCallback = (
  coords: GeoCoord[],
  shapeType: ShapeType
) => void;

export type PinPlacedCallback = (coord: GeoCoord) => void;

export type DrawStateChangeCallback = (
  mode: DrawMode,
  vertexCount: number,
  hasSelfIntersection?: boolean
) => void;

/** Lleva una longitud al rango [−180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function ccw(a: GeoCoord, b: GeoCoord, c: GeoCoord): boolean {
  return (c.lat - a.lat) * (b.lon - a.lon) > (b.lat - a.lat) * (c.lon - a.lon);
}

export function doSegmentsIntersect(
  a: GeoCoord,
  b: GeoCoord,
  c: GeoCoord,
  d: GeoCoord
): boolean {
  // Ignorar segmentos adyacentes que comparten un vértice
  if (
    (Math.abs(a.lat - c.lat) < 1e-7 && Math.abs(a.lon - c.lon) < 1e-7) ||
    (Math.abs(a.lat - d.lat) < 1e-7 && Math.abs(a.lon - d.lon) < 1e-7) ||
    (Math.abs(b.lat - c.lat) < 1e-7 && Math.abs(b.lon - c.lon) < 1e-7) ||
    (Math.abs(b.lat - d.lat) < 1e-7 && Math.abs(b.lon - d.lon) < 1e-7)
  ) {
    return false;
  }
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

export function checkPolygonSelfIntersects(input: GeoCoord[]): boolean {
  if (input.length < 4) return false;
  const coords = unwrapLongitudes(input);
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const a1 = coords[i];
    const a2 = coords[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const b1 = coords[j];
      const b2 = coords[(j + 1) % n];
      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Reordena vértices en orden perimetral polar alrededor del centroide.
 * Corrige polígonos trazados en "reloj de arena / mariposa" o en zig-zag.
 */
export function autoUntwistPerimeter(input: GeoCoord[]): GeoCoord[] {
  if (input.length < 4 || !checkPolygonSelfIntersects(input)) {
    return input;
  }

  const coords = unwrapLongitudes(input);
  let latSum = 0;
  let lonSum = 0;
  for (const c of coords) {
    latSum += c.lat;
    lonSum += c.lon;
  }
  const centerLat = latSum / coords.length;
  const centerLon = lonSum / coords.length;

  return [...coords]
    .sort((a, b) => {
      const angA = Math.atan2(a.lat - centerLat, a.lon - centerLon);
      const angB = Math.atan2(b.lat - centerLat, b.lon - centerLon);
      return angA - angB;
    })
    .map((c) => ({ lat: c.lat, lon: normalizeLon(c.lon) }));
}

interface PickedPoint {
  coord: GeoCoord;
  /** Punto 3D sobre la superficie que se picó (con su altura de terreno). */
  position: Cesium.Cartesian3;
}

/** Elevación mínima para que la línea de vista previa no quede enterrada en el relieve. */
const PREVIEW_LIFT_M = 3;

/**
 * Cursor de dibujo de alto contraste (borde oscuro + mira cian + centro naranja)
 * para que sea visible sobre nieve/hielo polar y sobre terreno oscuro.
 */
const DRAW_CURSOR_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    '<line x1="14" y1="2" x2="14" y2="11" stroke="#020617" stroke-width="4" stroke-linecap="round"/>' +
    '<line x1="14" y1="17" x2="14" y2="26" stroke="#020617" stroke-width="4" stroke-linecap="round"/>' +
    '<line x1="2" y1="14" x2="11" y2="14" stroke="#020617" stroke-width="4" stroke-linecap="round"/>' +
    '<line x1="17" y1="14" x2="26" y2="14" stroke="#020617" stroke-width="4" stroke-linecap="round"/>' +
    '<line x1="14" y1="2" x2="14" y2="11" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="14" y1="17" x2="14" y2="26" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="2" y1="14" x2="11" y2="14" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="17" y1="14" x2="26" y2="14" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="14" cy="14" r="2.2" fill="#f97316" stroke="#020617" stroke-width="1.2"/>' +
  '</svg>'
);
const HIGH_CONTRAST_DRAW_CURSOR = `url("data:image/svg+xml,${DRAW_CURSOR_SVG}") 14 14, crosshair`;

export class TerritoryDrawer {
  private viewer: Cesium.Viewer;
  private handler: Cesium.ScreenSpaceEventHandler;
  private mode: DrawMode = 'navigate';
  private vertices: GeoCoord[] = [];
  private vertexPositions: Cesium.Cartesian3[] = [];
  private cursorCoord: GeoCoord | null = null;
  private cursorPosition: Cesium.Cartesian3 | null = null;

  private previewLineEntity: Cesium.Entity | null = null;
  private closingGuideEntity: Cesium.Entity | null = null;
  private vertexMarkerEntities: Cesium.Entity[] = [];

  // R2: el movimiento del mouse se procesa como máximo una vez por cuadro
  private pendingMovePosition: Cesium.Cartesian2 | null = null;
  private moveFrameRequested = false;

  private onComplete: ShapeCompletedCallback;
  private onPinPlaced?: PinPlacedCallback;
  private onStateChange: DrawStateChangeCallback;

  constructor(
    viewer: Cesium.Viewer,
    onComplete: ShapeCompletedCallback,
    onStateChange: DrawStateChangeCallback,
    onPinPlaced?: PinPlacedCallback
  ) {
    this.viewer = viewer;
    this.onComplete = onComplete;
    this.onStateChange = onStateChange;
    this.onPinPlaced = onPinPlaced;
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.setupEvents();
  }

  public getMode(): DrawMode {
    return this.mode;
  }

  public getVertexCount(): number {
    return this.vertices.length;
  }

  public setMode(newMode: DrawMode): void {
    this.clearActiveDrawing();
    this.mode = newMode;
    const canvas = this.viewer.scene.canvas;
    canvas.style.cursor = newMode === 'navigate' ? 'default' : HIGH_CONTRAST_DRAW_CURSOR;
    this.onStateChange(this.mode, 0, false);
    this.viewer.scene.requestRender();
  }

  public cancel(): void {
    this.setMode('navigate');
  }

  public undoLastVertex(): void {
    if (this.mode === 'polygon' && this.vertices.length > 0) {
      this.vertices.pop();
      this.vertexPositions.pop();
      const lastMarker = this.vertexMarkerEntities.pop();
      if (lastMarker) {
        this.viewer.entities.remove(lastMarker);
      }
      const hasIntersection =
        this.vertices.length >= 4 ? checkPolygonSelfIntersects(this.vertices) : false;
      this.onStateChange(this.mode, this.vertices.length, hasIntersection);
      this.viewer.scene.requestRender();
    } else if ((this.mode === 'rectangle' || this.mode === 'circle') && this.vertices.length > 0) {
      this.clearActiveDrawing();
      this.onStateChange(this.mode, 0, false);
      this.viewer.scene.requestRender();
    }
  }

  public finishCurrentPolygon(): void {
    if (this.mode === 'polygon' && this.vertices.length >= 3) {
      let finalCoords = [...this.vertices];
      if (checkPolygonSelfIntersects(finalCoords)) {
        finalCoords = autoUntwistPerimeter(finalCoords);
      }
      this.setMode('navigate');
      this.onComplete(finalCoords, 'polygon');
    } else if (this.mode === 'rectangle' && this.vertices.length >= 1 && this.cursorCoord) {
      const rectCoords = this.buildRectangleCoords(this.vertices[0], this.cursorCoord);
      this.setMode('navigate');
      this.onComplete(rectCoords, 'rectangle');
    } else if (this.mode === 'circle' && this.vertices.length >= 1 && this.cursorCoord) {
      const radiusM = geodesicDistanceM(this.vertices[0], this.cursorCoord);
      if (radiusM < 1) return;
      const circleCoords = buildCircleAroundPoint(this.vertices[0].lat, this.vertices[0].lon, radiusM);
      this.setMode('navigate');
      this.onComplete(circleCoords, 'circle');
    }
  }

  private pickGlobePoint(windowPosition: Cesium.Cartesian2): PickedPoint | null {
    const scene = this.viewer.scene;
    let cartesian: Cesium.Cartesian3 | undefined;

    const ray = this.viewer.camera.getPickRay(windowPosition);
    if (ray) {
      cartesian = scene.globe.pick(ray, scene);
    }
    if (!cartesian) {
      cartesian = this.viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
    }
    if (!cartesian) return null;

    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      coord: {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
      },
      position: Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        (carto.height ?? 0) + PREVIEW_LIFT_M
      ),
    };
  }

  /** P10: si las dos esquinas están a lados opuestos del antimeridiano, va por el lado corto. */
  private buildRectangleCoords(p1: GeoCoord, p2: GeoCoord): GeoCoord[] {
    let lon2 = p2.lon;
    while (lon2 - p1.lon > 180) lon2 -= 360;
    while (lon2 - p1.lon < -180) lon2 += 360;

    const minLat = Math.min(p1.lat, p2.lat);
    const maxLat = Math.max(p1.lat, p2.lat);
    const minLon = Math.min(p1.lon, lon2);
    const maxLon = Math.max(p1.lon, lon2);

    return [
      { lat: minLat, lon: normalizeLon(minLon) },
      { lat: minLat, lon: normalizeLon(maxLon) },
      { lat: maxLat, lon: normalizeLon(maxLon) },
      { lat: maxLat, lon: normalizeLon(minLon) },
    ];
  }

  /** Altura de una esquina que no se picó: la de las teselas cargadas, o 0 sin terreno. */
  private surfacePosition(coord: GeoCoord): Cesium.Cartesian3 {
    const h = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(coord.lon, coord.lat));
    return Cesium.Cartesian3.fromDegrees(
      coord.lon,
      coord.lat,
      (h !== undefined && Number.isFinite(h) ? h : 0) + PREVIEW_LIFT_M
    );
  }

  private getPreviewPositions(): Cesium.Cartesian3[] {
    if (this.mode === 'rectangle') {
      if (this.vertices.length === 1 && this.cursorCoord) {
        const rect = this.buildRectangleCoords(this.vertices[0], this.cursorCoord);
        const pts = rect.map((c) => this.surfacePosition(c));
        return [...pts, pts[0]];
      }
      return [];
    }

    if (this.mode === 'circle') {
      if (this.vertices.length === 1 && this.cursorCoord) {
        const radiusM = geodesicDistanceM(this.vertices[0], this.cursorCoord);
        if (radiusM >= 1) {
          const circle = buildCircleAroundPoint(this.vertices[0].lat, this.vertices[0].lon, radiusM, 48);
          const pts = circle.map((c) => this.surfacePosition(c));
          return [...pts, pts[0]];
        }
      }
      return [];
    }

    if (this.mode === 'polygon') {
      const pts = [...this.vertexPositions];
      if (this.cursorPosition) {
        pts.push(this.cursorPosition);
      }
      return pts;
    }

    return [];
  }

  /**
   * R12: la vista previa NO va pegada al relieve (`clampToGround: false`). Una línea pegada
   * al relieve con CallbackProperty se reconstruye en cada movimiento del mouse. Aquí la
   * línea pasa por los puntos 3D picados y, si el relieve la tapa, se ve atenuada.
   */
  private ensureDynamicPreviewEntity(): void {
    if (this.previewLineEntity) return;

    const mainColor = Cesium.Color.fromCssColorString('#38bdf8');
    this.previewLineEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.getPreviewPositions(), false),
        width: 3.5,
        material: new Cesium.PolylineDashMaterialProperty({ color: mainColor, dashLength: 14 }),
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: mainColor.withAlpha(0.45),
          dashLength: 14,
        }),
        clampToGround: false,
      },
    });

    const guideColor = Cesium.Color.fromCssColorString('#f59e0b');
    this.closingGuideEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (
            this.mode === 'polygon' &&
            this.vertexPositions.length >= 2 &&
            this.cursorPosition
          ) {
            return [this.cursorPosition, this.vertexPositions[0]];
          }
          return [];
        }, false),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({ color: guideColor, dashLength: 8 }),
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: guideColor.withAlpha(0.45),
          dashLength: 8,
        }),
        clampToGround: false,
      },
    });
  }

  private addVertexMarker(coord: GeoCoord, index: number): void {
    const marker = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(coord.lon, coord.lat),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#0284c7'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `P${index + 1}`,
        font: 'bold 11px Inter, system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0f172acc'),
        backgroundPadding: new Cesium.Cartesian2(4, 3),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    this.vertexMarkerEntities.push(marker);
  }

  private clearActiveDrawing(): void {
    this.vertices = [];
    this.vertexPositions = [];
    this.cursorCoord = null;
    this.cursorPosition = null;
    this.pendingMovePosition = null;

    if (this.previewLineEntity) {
      this.viewer.entities.remove(this.previewLineEntity);
      this.previewLineEntity = null;
    }
    if (this.closingGuideEntity) {
      this.viewer.entities.remove(this.closingGuideEntity);
      this.closingGuideEntity = null;
    }
    for (const ent of this.vertexMarkerEntities) {
      this.viewer.entities.remove(ent);
    }
    this.vertexMarkerEntities = [];
  }

  /** R2: se llama una vez por cuadro con la última posición del mouse. */
  private processPendingMove(): void {
    this.moveFrameRequested = false;
    const position = this.pendingMovePosition;
    this.pendingMovePosition = null;
    if (!position || this.mode === 'navigate') return;

    const picked = this.pickGlobePoint(position);
    if (!picked) return;

    this.cursorCoord = picked.coord;
    this.cursorPosition = picked.position;
    if (this.mode === 'polygon' && this.vertices.length >= 2) {
      const hasIntersection = checkPolygonSelfIntersects([...this.vertices, picked.coord]);
      this.onStateChange(this.mode, this.vertices.length, hasIntersection);
    }
    // R1: con requestRenderMode, la línea elástica necesita pedir el cuadro.
    this.viewer.scene.requestRender();
  }

  private setupEvents(): void {
    this.viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    this.handler.setInputAction(
      (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (this.mode === 'navigate') return;

        const picked = this.pickGlobePoint(click.position);
        if (!picked) return;
        const coord = picked.coord;

        if (this.mode === 'pin') {
          this.setMode('navigate');
          if (this.onPinPlaced) {
            this.onPinPlaced(coord);
          }
          return;
        }

        this.ensureDynamicPreviewEntity();

        if (this.mode === 'rectangle') {
          if (this.vertices.length === 0) {
            this.vertices.push(coord);
            this.vertexPositions.push(picked.position);
            this.addVertexMarker(coord, 0);
            this.onStateChange(this.mode, 1, false);
            this.viewer.scene.requestRender();
          } else {
            const first = this.vertices[0];
            if (
              Math.abs(first.lat - coord.lat) < 1e-5 &&
              Math.abs(first.lon - coord.lon) < 1e-5
            ) {
              return;
            }
            const rectCoords = this.buildRectangleCoords(first, coord);
            this.setMode('navigate');
            this.onComplete(rectCoords, 'rectangle');
          }
          return;
        }

        if (this.mode === 'circle') {
          if (this.vertices.length === 0) {
            this.vertices.push(coord);
            this.vertexPositions.push(picked.position);
            this.addVertexMarker(coord, 0);
            this.onStateChange(this.mode, 1, false);
            this.viewer.scene.requestRender();
          } else {
            const center = this.vertices[0];
            const radiusM = geodesicDistanceM(center, coord);
            if (radiusM < 1) {
              return;
            }
            const circleCoords = buildCircleAroundPoint(center.lat, center.lon, radiusM, 64);
            this.setMode('navigate');
            this.onComplete(circleCoords, 'circle');
          }
          return;
        }

        if (this.mode === 'polygon') {
          const last = this.vertices[this.vertices.length - 1];
          if (
            last &&
            Math.abs(last.lat - coord.lat) < 1e-6 &&
            Math.abs(last.lon - coord.lon) < 1e-6
          ) {
            return;
          }
          const newIndex = this.vertices.length;
          this.vertices.push(coord);
          this.vertexPositions.push(picked.position);
          this.addVertexMarker(coord, newIndex);

          const hasIntersection =
            this.vertices.length >= 4 ? checkPolygonSelfIntersects(this.vertices) : false;
          this.onStateChange(this.mode, this.vertices.length, hasIntersection);
          this.viewer.scene.requestRender();
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    this.handler.setInputAction(
      (movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
        if (this.mode === 'navigate') return;
        this.pendingMovePosition = Cesium.Cartesian2.clone(movement.endPosition);
        if (!this.moveFrameRequested) {
          this.moveFrameRequested = true;
          requestAnimationFrame(() => this.processPendingMove());
        }
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );

    this.handler.setInputAction(() => {
      if (this.mode === 'polygon' && this.vertices.length >= 3) {
        this.finishCurrentPolygon();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // No robar teclas mientras se escribe en un campo de texto
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape' && this.mode !== 'navigate') {
        this.cancel();
      } else if (e.key === 'Enter' && this.mode === 'polygon' && this.vertices.length >= 3) {
        this.finishCurrentPolygon();
      } else if (
        (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) &&
        this.mode === 'polygon' &&
        this.vertices.length > 0
      ) {
        e.preventDefault();
        this.undoLastVertex();
      }
    });
  }
}

/** Distancia geodésica aproximada en metros entre dos coordenadas sobre la Tierra. */
export function geodesicDistanceM(a: GeoCoord, b: GeoCoord): number {
  const R = 6_371_000;
  const lat1 = Cesium.Math.toRadians(a.lat);
  const lat2 = Cesium.Math.toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = Cesium.Math.toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Genera las 4 esquinas de un cuadro centrado en (lat, lon) dado el lado en km.
 */
export function buildSquareAroundPoint(
  lat: number,
  lon: number,
  sideKm: number = 4
): GeoCoord[] {
  const halfKm = sideKm / 2;
  const dLat = halfKm / 111.32;
  const cosLat = Math.max(0.1, Math.cos(Cesium.Math.toRadians(lat)));
  const dLon = halfKm / (111.32 * cosLat);
  const clampLat = (v: number) => Math.max(-90, Math.min(90, v));

  return [
    { lat: clampLat(lat - dLat), lon: normalizeLon(lon - dLon) },
    { lat: clampLat(lat - dLat), lon: normalizeLon(lon + dLon) },
    { lat: clampLat(lat + dLat), lon: normalizeLon(lon + dLon) },
    { lat: clampLat(lat + dLat), lon: normalizeLon(lon - dLon) },
  ];
}

/**
 * Genera un cuadro centrado en (lat, lon) a partir del perímetro total en km.
 */
export function buildSquareFromPerimeter(
  lat: number,
  lon: number,
  perimeterKm: number = 16
): GeoCoord[] {
  const safePerimeter = Number.isFinite(perimeterKm) && perimeterKm > 0 ? perimeterKm : 16;
  return buildSquareAroundPoint(lat, lon, safePerimeter / 4);
}

/**
 * Genera un polígono circular aproximado centrado en (lat, lon) dado el radio en metros.
 */
export function buildCircleAroundPoint(
  lat: number,
  lon: number,
  radiusM: number,
  segments: number = 64
): GeoCoord[] {
  const R = 6_371_000;
  const d = Math.max(1, radiusM) / R;
  const lat1 = Cesium.Math.toRadians(lat);
  const lon1 = Cesium.Math.toRadians(lon);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);

  const coords: GeoCoord[] = [];
  for (let i = 0; i < segments; i++) {
    const bearing = (2 * Math.PI * i) / segments;
    const lat2 = Math.asin(
      Math.max(-1, Math.min(1, sinLat1 * cosD + cosLat1 * sinD * Math.cos(bearing)))
    );
    const lon2 =
      lon1 +
      Math.atan2(Math.sin(bearing) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
    coords.push({
      lat: Cesium.Math.toDegrees(lat2),
      lon: normalizeLon(Cesium.Math.toDegrees(lon2)),
    });
  }
  return coords;
}

/**
 * Genera un círculo centrado en (lat, lon) a partir del perímetro (circunferencia) en km.
 */
export function buildCircleFromPerimeter(
  lat: number,
  lon: number,
  perimeterKm: number = 16,
  segments: number = 64
): GeoCoord[] {
  const safePerimeter = Number.isFinite(perimeterKm) && perimeterKm > 0 ? perimeterKm : 16;
  const radiusM = (safePerimeter * 1000) / (2 * Math.PI);
  return buildCircleAroundPoint(lat, lon, radiusM, segments);
}
