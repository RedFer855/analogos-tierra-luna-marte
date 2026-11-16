// Capa de pines del motor: un pin por área (liviano) y UN polígono a la vez, al tocar el pin.
import * as Cesium from 'cesium';
import { flyToPolygonCoords, requestRenderBurst } from '../map/viewer';
import { motorApi, type AreaFeature, type AreaPin, type Confianza, type Grupo } from './api';

export const COLOR_GRUPO: Record<Grupo, string> = {
  hallado: '#3b82f6', // azul: documentado / verificado
  candidato: '#f59e0b', // ámbar: barridos previos, sin verificar
  nuevo: '#e879f9', // magenta: búsqueda hecha desde el panel
};
export const COLOR_NIVEL: Record<string, string> = {
  alta: '#22c55e', // verde
  media: '#eab308', // amarillo
  baja: '#ef4444', // rojo
  referencia: '#60a5fa', // azul claro: análogo documentado
  sin: '#94a3b8', // gris: sin sitio objetivo, no hay confianza que medir
};
export const NOMBRE_GRUPO: Record<Grupo, string> = {
  hallado: 'Ya encontrados',
  candidato: 'Candidatos previos',
  nuevo: 'Búsqueda nueva',
};

const iconos = new Map<string, string>();
function icono(css: string): string {
  const hit = iconos.get(css);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(20, 20, 15, 0, Math.PI * 2);
  g.fillStyle = css;
  g.fill();
  g.lineWidth = 3.5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.beginPath();
  g.arc(20, 20, 5, 0, Math.PI * 2);
  g.fillStyle = '#0b1220';
  g.fill();
  const url = c.toDataURL();
  iconos.set(css, url);
  return url;
}

export class CapaMotor {
  private pines: Cesium.BillboardCollection;
  private porId = new Map<string, { pin: AreaPin; bb: Cesium.Billboard }>();
  private poligono: Cesium.GroundPrimitive | null = null;
  private borde: Cesium.GroundPolylinePrimitive | null = null;
  private visibles = new Set<Grupo>(['hallado', 'candidato', 'nuevo']);
  private seleccionId: string | null = null;
  private turno = 0;
  private modo: 'grupo' | 'confianza' = 'grupo';
  private conf: Record<string, Confianza> = {};
  /** Nivel de confianza visible (null = todos). */
  private nivel: string | null = null;
  public alSeleccionar: (a: AreaFeature | null) => void = () => {};
  /** Mientras se dibuja el área de búsqueda, un clic en el globo no abre pines. */
  public bloqueada: () => boolean = () => false;

  constructor(private viewer: Cesium.Viewer) {
    this.pines = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    const manejador = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    manejador.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      if (this.bloqueada()) return;
      const hit = viewer.scene.pick(e.position) as { id?: { motorId?: string } } | undefined;
      if (hit?.id?.motorId) void this.seleccionar(hit.id.motorId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  get todas(): AreaPin[] {
    return [...this.porId.values()].map((x) => x.pin);
  }

  /** Reemplaza todos los pines (se llama al abrir y al terminar una búsqueda). */
  async cargar(): Promise<AreaPin[]> {
    const lista = await motorApi.areas();
    this.pines.removeAll();
    this.porId.clear();
    for (const pin of lista) {
      const bb = this.pines.add({
        id: { motorId: pin.id },
        position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat),
        image: icono(this.colorDe(pin)),
        scale: 0.55,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // Finito: de cerca no se hunde en el relieve, pero el planeta tapa los pines de la cara oculta.
        disableDepthTestDistance: 1_000_000,
        show: this.esVisible(pin),
      });
      this.porId.set(pin.id, { pin, bb });
    }
    requestRenderBurst(this.viewer);
    return lista;
  }

  private colorDe(pin: AreaPin): string {
    if (this.modo === 'grupo') return COLOR_GRUPO[pin.grupo];
    return COLOR_NIVEL[this.conf[pin.id]?.nivel ?? 'sin'];
  }

  /** Cambia el color de los pines: por grupo (azul/ámbar/magenta) o por nivel de confianza (verde/amarillo/rojo). */
  colorear(modo: 'grupo' | 'confianza', conf: Record<string, Confianza> = this.conf): void {
    this.modo = modo;
    this.conf = conf;
    for (const { pin, bb } of this.porId.values()) { bb.image = icono(this.colorDe(pin)); bb.show = this.esVisible(pin); }
    requestRenderBurst(this.viewer);
  }

  /** Muestra solo los pines de los grupos activos y, si se pasa, de un nivel de confianza ('alta', 'media', 'baja', 'referencia', 'sin'). */
  filtrar(grupos: Set<Grupo>, nivel: string | null = this.nivel): void {
    this.visibles = grupos;
    this.nivel = nivel;
    for (const { pin, bb } of this.porId.values()) bb.show = this.esVisible(pin);
    requestRenderBurst(this.viewer);
  }

  private esVisible(pin: AreaPin): boolean {
    return this.visibles.has(pin.grupo) && (!this.nivel || (this.conf[pin.id]?.nivel ?? 'sin') === this.nivel);
  }

  /** Pide el polígono del área, lo dibuja (reemplaza el anterior) y vuela hacia él. */
  async seleccionar(id: string): Promise<void> {
    if (id === this.seleccionId && this.poligono) return; // mismo pin: nada que repetir
    const turno = ++this.turno;
    const f = await motorApi.area(id);
    if (turno !== this.turno) return; // se tocó otro pin mientras llegaba esta respuesta
    this.limpiarPoligono();
    const anillo = f.geometry.coordinates[0];
    const color = Cesium.Color.fromCssColorString(COLOR_GRUPO[f.properties.grupo]);
    const pos = Cesium.Cartesian3.fromDegreesArray(anillo.flatMap(([lon, lat]) => [lon, lat]));
    this.poligono = this.viewer.scene.primitives.add(
      new Cesium.GroundPrimitive({
        asynchronous: false,
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(pos) }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.3)) },
        }),
      }),
    );
    this.borde = this.viewer.scene.primitives.add(
      new Cesium.GroundPolylinePrimitive({
        asynchronous: false,
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions: pos, width: 3 }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
        }),
        appearance: new Cesium.PolylineColorAppearance(),
      }),
    );
    this.seleccionId = id;
    flyToPolygonCoords(this.viewer, anillo.map(([lon, lat]) => ({ lon, lat })));
    requestRenderBurst(this.viewer, 4000);
    this.alSeleccionar(f);
  }

  /** Agranda y pone al frente los pines dados (p. ej. el top 3); el resto vuelve a su tamaño normal. */
  destacar(ids: string[]): void {
    const set = new Set(ids);
    for (const [id, { bb }] of this.porId) {
      bb.scale = set.has(id) ? 1.05 : 0.55;
      bb.eyeOffset = set.has(id) ? new Cesium.Cartesian3(0, 0, -50) : Cesium.Cartesian3.ZERO;
    }
    requestRenderBurst(this.viewer);
  }

  deseleccionar(): void {
    this.turno++;
    this.limpiarPoligono();
    this.seleccionId = null;
    this.alSeleccionar(null);
  }

  get seleccionActual(): string | null {
    return this.seleccionId;
  }

  private limpiarPoligono(): void {
    for (const p of [this.poligono, this.borde]) if (p) this.viewer.scene.primitives.remove(p);
    this.poligono = this.borde = null;
    requestRenderBurst(this.viewer);
  }
}
