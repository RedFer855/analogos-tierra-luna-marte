// Dibuja y muestra en el globo el área de búsqueda del motor: caja (dos clics) o polígono (clics; doble clic,
// Enter o clic en el primer vértice para cerrar). Un área a la vez. ENSAYO (ADR-005).
import * as Cesium from 'cesium';
import { checkPolygonSelfIntersects } from '../tools/drawer';
import { areaKm2, bboxDeEsquinas, centro, formatoKm2, normLon, type AreaBusqueda } from './areaGeo';

const MAGENTA = Cesium.Color.fromCssColorString('#e879f9');
type Punto = { lat: number; lon: number };
export type ModoDibujo = 'caja' | 'poligono';

export interface EstadoDibujo {
  modo: ModoDibujo | null;
  vertices: number;
  cruza: boolean;
}

export class AreaDibujo {
  private handler: Cesium.ScreenSpaceEventHandler;
  private entidades: Cesium.Entity[] = [];
  private modo: ModoDibujo | null = null;
  private pts: Punto[] = [];
  private cursor: Punto | null = null;
  private aviso = document.createElement('div');
  private dblClickOriginal: unknown = null;
  /** Se llama con el área terminada o con null si se canceló. */
  public alTerminar: (a: AreaBusqueda | null) => void = () => {};
  public alCambiar: (e: EstadoDibujo) => void = () => {};

  constructor(private viewer: Cesium.Viewer, raizUi: HTMLElement) {
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.aviso.className = 'mp-dibujo-aviso';
    this.aviso.setAttribute('role', 'status');
    this.aviso.hidden = true;
    raizUi.appendChild(this.aviso);
    this.aviso.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-d]')?.dataset.d;
      if (a === 'cancelar') this.cancelar();
      if (a === 'cerrar') this.cerrarPoligono();
      if (a === 'deshacer') this.deshacer();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.modo) return;
      if (e.key === 'Escape') { e.preventDefault(); this.cancelar(); }
      if (e.key === 'Enter' && this.modo === 'poligono') { e.preventDefault(); this.cerrarPoligono(); }
      if (e.key === 'Backspace' && this.modo === 'poligono' && !(e.target as HTMLElement).closest('input, textarea')) { e.preventDefault(); this.deshacer(); }
    });
  }

  get dibujando(): boolean {
    return this.modo !== null;
  }

  /** Empieza a dibujar: borra el área mostrada y escucha el globo. */
  empezar(modo: ModoDibujo): void {
    this.cancelar(false);
    this.limpiar();
    this.modo = modo;
    this.pts = [];
    this.cursor = null;
    // El doble clic de Cesium sigue entidades; mientras se dibuja, cierra el polígono.
    const w = this.viewer.cesiumWidget.screenSpaceEventHandler;
    this.dblClickOriginal = w.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    w.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.handler.setInputAction((e: { position: Cesium.Cartesian2 }) => this.clic(e.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
      const p = this.tomar(e.endPosition);
      if (!p) return;
      this.cursor = p;
      this.viewer.scene.requestRender();
      if (this.modo === 'poligono' && this.pts.length >= 2) this.avisar();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => { if (this.modo === 'poligono') this.cerrarPoligono(); }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.viewer.scene.canvas.style.cursor = 'crosshair';
    this.previa();
    this.avisar();
  }

  /** Muestra un área ya hecha (de la lista, de la caja escrita a mano o al volver a abrir el panel). */
  mostrar(a: AreaBusqueda | null, volar = false): void {
    this.limpiar();
    if (!a) { this.viewer.scene.requestRender(); return; }
    const borde = this.anilloGrados(a);
    this.entidades.push(this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(borde.flat())),
        material: MAGENTA.withAlpha(0.14),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    }));
    this.entidades.push(this.viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([...borde, borde[0]].flat()),
        width: 2.5, clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({ color: MAGENTA, dashLength: 14 }),
      },
    }));
    const c = centro(a);
    this.entidades.push(this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
      label: {
        text: `${a.nombre ?? (a.tipo === 'bbox' ? 'Caja de búsqueda' : 'Polígono de búsqueda')}\n≈ ${formatoKm2(areaKm2(a))}`,
        font: '600 13px Inter, system-ui, sans-serif', fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1a0b22'), outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE, showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#1a0b22').withAlpha(0.72),
        backgroundPadding: new Cesium.Cartesian2(9, 6),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER,
      },
    }));
    if (volar) this.volar(a);
    this.viewer.scene.requestRender();
  }

  volar(a: AreaBusqueda): void {
    const borde = this.anilloGrados(a);
    const lats = borde.map((p) => p[1]);
    const lons = borde.map((p) => p[0]);
    const margen = 0.25;
    const [s, n] = [Math.min(...lats), Math.max(...lats)];
    const [o, e] = [Math.min(...lons), Math.max(...lons)];
    const dLat = (n - s) * margen, dLon = (e - o) * margen;
    this.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(normLon(o - dLon), Math.max(-90, s - dLat), normLon(e + dLon), Math.min(90, n + dLat)),
      duration: 1.4,
    });
  }

  cancelar(avisar = true): void {
    if (!this.modo) return;
    this.terminarEscucha();
    this.limpiar();
    if (avisar) this.alTerminar(null);
  }

  // ---------- internos ----------
  private clic(pos: Cesium.Cartesian2): void {
    const p = this.tomar(pos);
    if (!p || !this.modo) return;
    if (this.modo === 'caja') {
      this.pts.push(p);
      if (this.pts.length === 2) {
        const bbox = bboxDeEsquinas(this.pts[0], this.pts[1]);
        this.terminar({ tipo: 'bbox', bbox, nombre: null });
        return;
      }
    } else {
      // Clic cerca del primer vértice: cierra.
      if (this.pts.length >= 3 && this.cercaDelPrimero(pos)) { this.cerrarPoligono(); return; }
      const ultimo = this.pts[this.pts.length - 1];
      if (!ultimo || Math.abs(ultimo.lat - p.lat) + Math.abs(ultimo.lon - p.lon) > 1e-6) this.pts.push(p);
    }
    this.viewer.scene.requestRender();
    this.avisar();
  }

  private cerrarPoligono(): void {
    if (this.modo !== 'poligono' || this.pts.length < 3) return;
    if (checkPolygonSelfIntersects(this.pts)) { this.avisar('Los lados se cruzan: deshaz el último vértice o mueve el siguiente.'); return; }
    const anillo = this.pts.map((p) => [Number(normLon(p.lon).toFixed(3)), Number(p.lat.toFixed(3))] as [number, number]);
    this.terminar({ tipo: 'poligono', anillo: [...anillo, anillo[0]], nombre: null });
  }

  private deshacer(): void {
    if (this.modo !== 'poligono' || !this.pts.length) return;
    this.pts.pop();
    this.viewer.scene.requestRender();
    this.avisar();
  }

  private terminar(a: AreaBusqueda): void {
    this.terminarEscucha();
    this.mostrar(a);
    this.alTerminar(a);
  }

  private terminarEscucha(): void {
    this.modo = null;
    this.pts = [];
    this.cursor = null;
    for (const t of [Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.ScreenSpaceEventType.MOUSE_MOVE, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK]) this.handler.removeInputAction(t);
    if (this.dblClickOriginal) {
      this.viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(this.dblClickOriginal as () => void, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      this.dblClickOriginal = null;
    }
    this.viewer.scene.canvas.style.cursor = '';
    this.aviso.hidden = true;
    this.alCambiar({ modo: null, vertices: 0, cruza: false });
  }

  private limpiar(): void {
    for (const e of this.entidades) this.viewer.entities.remove(e);
    this.entidades = [];
  }

  /** Vista previa elástica mientras se dibuja (se recalcula en cada cuadro). */
  private previa(): void {
    const puntos = (): Punto[] => {
      if (this.modo === 'caja') {
        if (this.pts.length !== 1 || !this.cursor) return [];
        const [s, o, n, e] = bboxDeEsquinas(this.pts[0], this.cursor);
        return [{ lat: s, lon: o }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: o }];
      }
      return this.cursor ? [...this.pts, this.cursor] : [...this.pts];
    };
    const aCart = (ps: Punto[], cerrar: boolean): Cesium.Cartesian3[] => {
      const lons = ps.map((p) => p.lon);
      // Longitudes continuas para que la línea no dé la vuelta al mundo al cruzar ±180°.
      for (let i = 1; i < lons.length; i++) { while (lons[i] - lons[i - 1] > 180) lons[i] -= 360; while (lons[i] - lons[i - 1] < -180) lons[i] += 360; }
      const c = ps.map((p, i) => Cesium.Cartesian3.fromDegrees(lons[i], p.lat));
      return cerrar && c.length > 2 ? [...c, c[0]] : c;
    };
    this.entidades.push(this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => aCart(puntos(), true), false),
        width: 2.5, clampToGround: true, material: MAGENTA,
      },
    }));
    this.entidades.push(this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          const ps = puntos();
          return ps.length > 2 ? new Cesium.PolygonHierarchy(aCart(ps, false)) : undefined;
        }, false) as unknown as Cesium.PolygonHierarchy,
        material: MAGENTA.withAlpha(0.12),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    }));
    this.entidades.push(this.viewer.entities.add({
      position: new Cesium.CallbackProperty(() => (this.pts[0] ? Cesium.Cartesian3.fromDegrees(this.pts[0].lon, this.pts[0].lat) : undefined), false) as unknown as Cesium.PositionProperty,
      point: { pixelSize: 11, color: MAGENTA, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
  }

  private avisar(error?: string): void {
    const n = this.pts.length;
    const cruza = this.modo === 'poligono' && n >= 2 && !!this.cursor && checkPolygonSelfIntersects([...this.pts, this.cursor]);
    let paso: string;
    if (this.modo === 'caja') paso = n === 0 ? 'Haz clic en una esquina de la caja.' : 'Ahora en la esquina opuesta.';
    else paso = n < 3 ? `Haz clic para poner vértices (${n} de al menos 3).` : `${n} vértices · doble clic, Enter o clic en el primero para cerrar.`;
    const msg = error ?? (cruza ? 'Con este punto los lados se cruzan.' : paso);
    const botones = this.modo === 'poligono'
      ? `<button data-d="deshacer" ${n ? '' : 'disabled'}>Deshacer</button><button data-d="cerrar" class="prim" ${n >= 3 && !cruza ? '' : 'disabled'}>Cerrar polígono</button>`
      : '';
    this.aviso.hidden = false;
    this.aviso.classList.toggle('mal', !!error || cruza);
    this.aviso.innerHTML = `<span class="ico" aria-hidden="true">${this.modo === 'caja' ? '▭' : '⬠'}</span>
      <div><strong>${this.modo === 'caja' ? 'Dibujando una caja' : 'Dibujando un polígono'}</strong><small>${msg}</small></div>
      <div class="acc">${botones}<button data-d="cancelar">Cancelar <kbd>Esc</kbd></button></div>`;
    this.alCambiar({ modo: this.modo, vertices: n, cruza });
  }

  private cercaDelPrimero(pos: Cesium.Cartesian2): boolean {
    const p0 = this.pts[0];
    const w = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, Cesium.Cartesian3.fromDegrees(p0.lon, p0.lat));
    return !!w && Cesium.Cartesian2.distance(w, pos) < 14;
  }

  private tomar(pos: Cesium.Cartesian2): Punto | null {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(pos);
    const c = (ray && scene.globe.pick(ray, scene)) || this.viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
    if (!c) return null;
    const g = Cesium.Cartographic.fromCartesian(c);
    return { lat: Cesium.Math.toDegrees(g.latitude), lon: Cesium.Math.toDegrees(g.longitude) };
  }

  /** Borde en grados [lon, lat] con longitudes continuas (una caja que cruza ±180° sigue siendo una caja). */
  private anilloGrados(a: AreaBusqueda): [number, number][] {
    if (a.tipo === 'poligono') {
      const pts = a.anillo.slice(0, -1);
      const out: [number, number][] = [];
      for (const [lo, la] of pts) {
        let x = lo;
        if (out.length) { const prev = out[out.length - 1][0]; while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; }
        out.push([x, la]);
      }
      return out;
    }
    const [s, o, n, e0] = a.bbox;
    const e = e0 > o ? e0 : e0 + 360;
    // Lados densificados: los paralelos no son geodésicas, así que se parte cada lado en tramos.
    const pasos = Math.max(2, Math.ceil((e - o) / 2));
    const sur: [number, number][] = [], norte: [number, number][] = [];
    for (let i = 0; i <= pasos; i++) { const lo = o + ((e - o) * i) / pasos; sur.push([lo, s]); norte.unshift([lo, n]); }
    return [...sur, ...norte];
  }
}
