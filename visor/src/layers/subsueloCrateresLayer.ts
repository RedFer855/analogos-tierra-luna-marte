import * as Cesium from 'cesium';
import { requestRenderBurst } from '../map/viewer';

export type GeoPinKind = 'cuevas' | 'crateres';

export interface CuevaPin {
  id: string;
  nombre: string;
  pais: string;
  zona: string;
  nivel: 'A' | 'B';
  lat: number;
  lon: number;
  elevacion_m: number | null;
  radio_m: number | null;
  fuente: string | null;
}

export interface CraterPin {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  diam_km: number | null;
}

export type GeoPinItem =
  | { kind: 'cuevas'; data: CuevaPin }
  | { kind: 'crateres'; data: CraterPin };

export function esCoordenadaValida(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function formatearFuentePin(item: GeoPinItem): { url: string; etiqueta: string; licencia: string } {
  if (item.kind === 'cuevas') {
    return {
      url: item.data.fuente ?? 'https://zenodo.org/records/14535885',
      etiqueta: item.data.fuente ? 'Ficha / fuente verificada' : 'Pyroduct v3.0 (Zenodo)',
      licencia: 'Pyroduct v3.0 (CC BY 4.0) · OpenStreetMap (ODbL 1.0)',
    };
  }
  return {
    url: `https://www.wikidata.org/wiki/${encodeURIComponent(item.data.id)}`,
    etiqueta: `Wikidata (${item.data.id})`,
    licencia: 'Wikidata (CC0 1.0)',
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function crearIconoPin(tipo: GeoPinKind): string {
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d')!;

  if (tipo === 'cuevas') {
    // Arco de roca / entrada de cueva con boca oscura
    g.beginPath();
    g.moveTo(5, 33);
    g.lineTo(10, 14);
    g.lineTo(17, 7);
    g.lineTo(25, 9);
    g.lineTo(32, 16);
    g.lineTo(35, 33);
    g.closePath();
    g.fillStyle = '#06b6d4';
    g.fill();
    g.lineWidth = 2.6;
    g.strokeStyle = '#ffffff';
    g.stroke();

    // Boca oscura de la cueva
    g.beginPath();
    g.moveTo(12.5, 33);
    g.lineTo(12.5, 23);
    g.arc(20, 23, 7.5, Math.PI, 0, false);
    g.lineTo(27.5, 33);
    g.closePath();
    g.fillStyle = '#0b1220';
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = '#a5f3fc';
    g.stroke();
  } else {
    // Cráter de impacto: borde elevado en perspectiva con cuenca sombreada
    g.beginPath();
    g.ellipse(20, 21, 15, 10.5, 0, 0, Math.PI * 2);
    g.fillStyle = '#f97316';
    g.fill();
    g.lineWidth = 2.6;
    g.strokeStyle = '#ffffff';
    g.stroke();

    // Cuenca interior oscura
    g.beginPath();
    g.ellipse(20, 20.5, 9.5, 5.8, 0, 0, Math.PI * 2);
    g.fillStyle = '#0b1220';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#fed7aa';
    g.stroke();

    // Sombra/luz del borde interno
    g.beginPath();
    g.ellipse(20, 21.8, 6.2, 3.2, 0, 0, Math.PI);
    g.strokeStyle = '#fb923c';
    g.lineWidth = 1.4;
    g.stroke();
  }
  return c.toDataURL();
}

export class SubsueloCrateresLayer {
  private cuevasCol: Cesium.BillboardCollection;
  private crateresCol: Cesium.BillboardCollection;
  private popupEl: HTMLDivElement;
  private cargado: Record<GeoPinKind, boolean> = { cuevas: false, crateres: false };
  private visible: Record<GeoPinKind, boolean> = { cuevas: false, crateres: false };
  private conteo: Record<GeoPinKind, number> = { cuevas: 0, crateres: 0 };

  constructor(private viewer: Cesium.Viewer, root: HTMLElement) {
    this.cuevasCol = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.crateresCol = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.cuevasCol.show = false;
    this.crateresCol.show = false;

    this.popupEl = document.createElement('div');
    this.popupEl.id = 'geoPinPopup';
    this.popupEl.className = 'geo-pin-popup hidden';
    root.appendChild(this.popupEl);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const hit = viewer.scene.pick(e.position) as { id?: { geoPin?: GeoPinItem } } | undefined;
      if (hit?.id?.geoPin) {
        this.mostrarPopup(hit.id.geoPin);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  isVisible(kind: GeoPinKind): boolean {
    return this.visible[kind];
  }

  async toggle(kind: GeoPinKind): Promise<boolean> {
    await this.setVisible(kind, !this.visible[kind]);
    return this.visible[kind];
  }

  async setVisible(kind: GeoPinKind, show: boolean): Promise<void> {
    if (show && !this.cargado[kind]) {
      await this.cargar(kind);
    }
    this.visible[kind] = show;
    const col = kind === 'cuevas' ? this.cuevasCol : this.crateresCol;
    col.show = show;
    if (!show) {
      this.ocultarPopup();
    }
    requestRenderBurst(this.viewer);
  }

  private async cargar(kind: GeoPinKind): Promise<void> {
    const base = import.meta.env.BASE_URL ?? '/';
    const url = `${base.endsWith('/') ? base : `${base}/`}capas/${kind}.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`No se pudo cargar ${url} (${res.status})`);
    }
    const items = (await res.json()) as Array<CuevaPin | CraterPin>;
    const icon = crearIconoPin(kind);
    const col = kind === 'cuevas' ? this.cuevasCol : this.crateresCol;
    col.removeAll();

    let count = 0;
    for (const item of items) {
      if (!esCoordenadaValida(item.lat, item.lon)) continue;
      const geoPin: GeoPinItem =
        kind === 'cuevas'
          ? { kind: 'cuevas', data: item as CuevaPin }
          : { kind: 'crateres', data: item as CraterPin };
      col.add({
        id: { geoPin },
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat),
        image: icon,
        scale: 0.65,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 1_000_000,
      });
      count += 1;
    }
    this.conteo[kind] = count;
    this.cargado[kind] = true;
  }

  private mostrarPopup(item: GeoPinItem): void {
    const { url, etiqueta, licencia } = formatearFuentePin(item);
    const d = item.data;
    const titulo = item.kind === 'cuevas' ? 'Cueva / Tubo de lava' : 'Cráter de impacto';
    const detalle =
      item.kind === 'cuevas'
        ? `Nivel ${(d as CuevaPin).nivel} · ${(d as CuevaPin).zona} (${(d as CuevaPin).pais})${
            (d as CuevaPin).elevacion_m != null ? ` · ${(d as CuevaPin).elevacion_m} m` : ''
          }`
        : (d as CraterPin).diam_km != null
          ? `Diámetro aprox.: ${(d as CraterPin).diam_km} km`
          : 'Diámetro: sin dato en Wikidata';

    this.popupEl.innerHTML = `
      <div class="geo-pin-popup-head">
        <span class="geo-pin-badge geo-pin-badge--${item.kind}">${titulo}</span>
        <button type="button" class="geo-pin-close" title="Cerrar">×</button>
      </div>
      <div class="geo-pin-title">${escapeHtml(d.nombre)}</div>
      <div class="geo-pin-meta">${escapeHtml(detalle)}</div>
      <div class="geo-pin-coords">${d.lat.toFixed(4)}°, ${d.lon.toFixed(4)}°</div>
      <div class="geo-pin-actions">
        <button type="button" class="tool-btn btn-secondary geo-pin-fly">Acercar</button>
        <a class="geo-pin-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(etiqueta)}</a>
      </div>
      <div class="geo-pin-license">${escapeHtml(licencia)}</div>
    `;
    this.popupEl.classList.remove('hidden');

    this.popupEl.querySelector('.geo-pin-close')?.addEventListener('click', () => this.ocultarPopup());
    this.popupEl.querySelector('.geo-pin-fly')?.addEventListener('click', () => {
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(d.lon, d.lat, item.kind === 'cuevas' ? 3500 : 35000),
        duration: 1.0,
      });
    });
  }

  private ocultarPopup(): void {
    this.popupEl.classList.add('hidden');
  }
}
