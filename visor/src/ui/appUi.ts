import * as Cesium from 'cesium';
import { analyzePolygonTerrain } from '../analysis/terrainAnalysis';
import {
  BASE_IMAGERY_OPTIONS,
  enableWorldTerrain,
  flyToCoordinates,
  flyToPolygonCoords,
  getCameraHeightAboveGround,
  getEoxYearInUse,
  getSavedIonToken,
  is3DViewActive,
  isDetailImageryOn,
  removeTargetMarker,
  saveIonToken,
  sampleGroundElevation,
  setBaseImagery,
  setTargetMarker,
  toggle3DView,
  updateTargetMarkerElevation,
  zoomToTargetCoord,
  type ImageryKind,
  type TerrainStatus,
} from '../map/viewer';
import { MissionManager } from '../missions/missionManager';
import { SubsueloCrateresLayer, type GeoPinKind } from '../layers/subsueloCrateresLayer';
import { ZoneLayerManager } from '../layers/zoneLayerManager';
import {
  buildCircleFromPerimeter,
  buildSquareFromPerimeter,
  TerritoryDrawer,
} from '../tools/drawer';
import { renderPines, renderZonas } from './catalogo';
import { makePanelDraggable } from './draggable';
import { abrirModalMedirPin, abrirModalPin, abrirModalToken, abrirModalZona } from './modales';
import { ZoneLayerPanel } from './zoneLayerPanel';
import type {
  DrawMode,
  GeoCoord,
  MissionZone,
  PinCategory,
  SavedPin,
  ShapeType,
  TargetBody,
  TopographicMetrics,
} from '../types/mission';
import {
  describeTerrainSource,
  ELEVATION_REFERENCE_LABEL,
  escapeHtml,
  formatElevation,
  formatSlope,
  formatVolume,
} from '../util/format';

export function parseCoordinatesInput(text: string): { lat: number; lon: number } | null {
  const clean = text.trim();
  if (!clean) return null;

  // Permite separar por comas, espacios, punto y coma o barras (ej. 14.0540, -87.2489)
  const parts = clean
    .split(/[,;\s/]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (
      !Number.isNaN(lat) &&
      !Number.isNaN(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      return { lat, lon };
    }
  }

  // Fallback con regex para extraer los dos primeros números flotantes válidos
  const matches = clean.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (matches && matches.length >= 2) {
    const lat = parseFloat(matches[0]);
    const lon = parseFloat(matches[1]);
    if (
      !Number.isNaN(lat) &&
      !Number.isNaN(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      return { lat, lon };
    }
  }

  return null;
}

export class AppUI {
  private root: HTMLElement;
  private viewer: Cesium.Viewer;
  private drawer: TerritoryDrawer;
  private missionManager: MissionManager;
  private subsueloCrateresLayer!: SubsueloCrateresLayer;
  private zoneLayerManager: ZoneLayerManager;
  private zoneLayerPanel!: ZoneLayerPanel;
  private terrain: TerrainStatus;
  private imagery: ImageryKind;
  public onZonaSeleccionada?: (zona: MissionZone | null) => void;

  // Estado del catálogo y paneles
  private activeMainTab: 'missions' | 'pins' = 'missions';
  private activeFilter: 'all' | TargetBody = 'all';
  private activePinFilter: 'all' | PinCategory = 'all';
  private isSidebarCollapsed = false;
  private openColorPaletteMissionId: string | null = null;

  // Seguimiento de coordenadas y zoom progresivo sobre el suelo real
  private currentTargetCoords: GeoCoord | null = null;
  private currentTargetElevationM: number | null = null;
  private currentZoomAltitudeM = 1200;

  // Elementos clave del DOM
  private topToolbarEl!: HTMLElement;
  private topFiltersBarEl!: HTMLElement;
  private restoreFiltersBtnEl!: HTMLElement;
  private restoreToolbarBtnEl!: HTMLButtonElement;
  private coordInputEl!: HTMLInputElement;
  private statusBannerEl!: HTMLElement;
  private missionListEl!: HTMLElement;
  private filterButtonsContainer!: HTMLElement;
  private modalContainerEl!: HTMLElement;
  private finishBtnEl!: HTMLButtonElement;
  private undoBtnEl!: HTMLButtonElement;
  private cancelBtnEl!: HTMLButtonElement;
  private toggle3DBtnEl!: HTMLButtonElement;
  private toggleGlobalFillBtnEl!: HTMLButtonElement;
  private terrainBadgeEl!: HTMLElement;
  private zoomInBtnEl!: HTMLButtonElement;
  private zoomOutBtnEl!: HTMLButtonElement;
  private altitudeBadgeEl!: HTMLElement;
  private clearMarkerBtnEl!: HTMLButtonElement;
  private tabMissionsBtn!: HTMLElement;
  private tabPinsBtn!: HTMLElement;

  constructor(
    root: HTMLElement,
    viewer: Cesium.Viewer,
    missionManager: MissionManager,
    terrain: TerrainStatus,
    imagery: ImageryKind
  ) {
    this.root = root;
    this.viewer = viewer;
    this.missionManager = missionManager;
    this.terrain = terrain;
    this.imagery = imagery;

    this.drawer = new TerritoryDrawer(
      this.viewer,
      (coords, shapeType) => this.handleShapeCompleted(coords, shapeType),
      (mode, count, hasIntersection) => this.updateToolbarState(mode, count, hasIntersection),
      (coord) => this.handlePinPlaced(coord)
    );

    this.renderLayout();

    this.subsueloCrateresLayer = new SubsueloCrateresLayer(this.viewer, this.root);
    this.zoneLayerManager = new ZoneLayerManager(this.viewer);
    let activeOverlayZoneId: string | null = null;
    this.zoneLayerPanel = new ZoneLayerPanel(this.root, this.zoneLayerManager, {
      onLayerActivated: (zone, _subLayerId, result) => {
        if (activeOverlayZoneId && activeOverlayZoneId !== zone.id) {
          this.missionManager.setMissionFillVisible(activeOverlayZoneId, true);
        }
        if (result.canvas) {
          activeOverlayZoneId = zone.id;
          // Ocultar el relleno sólido para no teñir la capa temática y resaltar el borde en blanco
          this.missionManager.setMissionFillVisible(zone.id, false);
          this.missionManager.setMissionLayerHighlight(zone.id);
        } else {
          activeOverlayZoneId = null;
          this.missionManager.setMissionFillVisible(zone.id, true);
          this.missionManager.setMissionLayerHighlight(null);
        }
      },
      onLayerCleared: (zone) => {
        const restoreId = zone?.id ?? activeOverlayZoneId;
        if (restoreId) {
          this.missionManager.setMissionFillVisible(restoreId, true);
        }
        activeOverlayZoneId = null;
        this.missionManager.setMissionLayerHighlight(null);
      },
    });

    this.missionManager.onChange(() => this.renderSidebarContent());
    this.missionManager.onPinsChange(() => this.renderSidebarContent());

    this.renderSidebarContent();
    this.updateToolbarState('navigate', 0);
  }

  private renderLayout(): void {
    this.root.innerHTML = `
      <!-- Botón flotante para restaurar filtros arriba -->
      <button id="btnRestoreFilters" class="toolbar-restore-pill filters-restore-pill hidden" title="Mostrar barra superior de filtros">
        <strong>Filtros</strong>
        <span class="css-chevron down"></span>
      </button>

      <!-- Barra Superior de Filtros (Cuevas, Cráteres, Motor y Limpiar) -->
      <header id="topFiltersBar" class="top-toolbar top-filters-bar">
        <div class="toolbar-group brand-group" title="Arrastra aquí para mover la barra de filtros">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <div class="brand-titles">
            <h1>Filtros</h1>
            <span>Capas y resultados</span>
          </div>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group geo-filter-tools">
          <button id="btnToggleCuevas" class="tool-btn btn-geo-layer" title="Mostrar u ocultar cuevas y tubos de lava verificados (Niveles A y B · Pyroduct/OSM)" aria-pressed="false">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M3 20L7 8L12 4L17 7L21 20Z" fill="#06b6d4" stroke="#fff" stroke-width="1.6"/><path d="M8.5 20V14.5A3.5 3.5 0 0 1 15.5 14.5V20Z" fill="#0b1220" stroke="#a5f3fc" stroke-width="1.2"/></svg>Cuevas (50)
          </button>
          <button id="btnToggleCrateres" class="tool-btn btn-geo-layer" title="Mostrar u ocultar cráteres de impacto terrestres (Wikidata)" aria-pressed="false">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><ellipse cx="12" cy="13" rx="9" ry="6" fill="#f97316" stroke="#fff" stroke-width="1.6"/><ellipse cx="12" cy="12.5" rx="5.5" ry="3.2" fill="#0b1220" stroke="#fed7aa" stroke-width="1.2"/></svg>Cráteres (202)
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div id="motorFiltersSlot" class="toolbar-group motor-filters-slot"></div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group collapse-group">
          <button id="btnMinimizeFilters" class="tool-btn btn-minimize-toolbar" title="Ocultar barra de filtros">
            <span class="css-chevron up"></span> Ocultar
          </button>
        </div>
      </header>

      <!-- Botón flotante para restaurar la barra cuando esté minimizada -->
      <button id="btnRestoreToolbar" class="toolbar-restore-pill hidden" title="Mostrar barra de herramientas completa">
        <span class="css-ico ico-orbit"></span>
        <strong>Análogos 3D</strong> · Herramientas
        <span class="css-chevron up"></span>
      </button>

      <!-- Barra Flotante Inferior de Herramientas (Dock Minimalista) -->
      <header id="topToolbar" class="top-toolbar">
        <div class="toolbar-group brand-group" title="Arrastra aquí para mover la barra de herramientas">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <span class="brand-logo"><span class="css-ico ico-orbit"></span></span>
          <div class="brand-titles">
            <h1>Análogos 3D</h1>
            <span>Tierra · Luna · Marte</span>
          </div>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group draw-tools">
          <button id="btnModeNavigate" class="tool-btn active" title="Mover y explorar el globo">
            <span class="css-ico ico-compass"></span> Navegar
          </button>
          <button id="btnModePin" class="tool-btn" title="Hacer clic en el mapa para plantar y guardar un Pin">
            <span class="css-ico ico-pin"></span> Marcar Pin
          </button>
          <button id="btnModeRectangle" class="tool-btn" title="Dibujar recuadro con 2 clics sobre el terreno">
            <span class="css-ico ico-square"></span> Dibujar Cuadro
          </button>
          <button id="btnModeCircle" class="tool-btn" title="Dibujar círculo desde el centro hasta el radio (2 clics)">
            <span class="css-ico ico-circle"></span> Dibujar Círculo
          </button>
          <button id="btnModePolygon" class="tool-btn" title="Dibujar polígono punto por punto (doble clic para cerrar)">
            <span class="css-ico ico-polygon"></span> Dibujar Polígono
          </button>
          <button id="btnFinishDraw" class="tool-btn btn-success hidden" title="Cerrar y medir figura actual">
            <span class="css-ico ico-check"></span> Terminar
          </button>
          <button id="btnUndoDraw" class="tool-btn btn-undo hidden" title="Deshacer el último punto colocado (o pulsa tecla Borrar/Backspace)">
            <span class="css-ico ico-undo"></span> Deshacer punto
          </button>
          <button id="btnCancelDraw" class="tool-btn btn-danger hidden" title="Cancelar dibujo (Esc)">
            <span class="css-ico ico-close"></span> Cancelar
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group view-tools">
          <button id="btnToggle3D" class="tool-btn btn-zoom btn-3d-toggle" title="Alternar vista 3D inclinada / 2D cenital (también puedes inclinar con clic derecho + arrastrar)" aria-pressed="false">
            <span class="css-ico ico-cube"></span> <span id="labelToggle3D">3D</span>
          </button>
          <button id="btnToggleGlobalFill" class="tool-btn btn-toggle-fill" title="Alternar entre relleno de color y solo líneas perimetrales para ver el terreno con nitidez">
            <span class="css-ico ico-fill"></span> Relleno: ON
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group coord-search">
          <input
            id="inputCoords"
            type="text"
            placeholder="Lat, Lon (ej. 14.0540, -87.2489)"
            title="Copia y pega desde Google Maps: primero Latitud, luego Longitud separadas por coma"
            class="input-coords-unified"
          />
          <button id="btnFlyCoord" class="tool-btn btn-secondary" title="Volar a estas coordenadas (1.200 m sobre suelo)">
            <span class="css-ico ico-go"></span> Ir
          </button>
          <button id="btnSaveCoordAsPin" class="tool-btn btn-pin-save" title="Guardar estas coordenadas como un Pin con nombre">
            <span class="css-ico ico-pin"></span> Guardar Pin
          </button>
          <button id="btnZoomInCoord" class="tool-btn btn-zoom hidden" title="Acercar zoom (+50%) al punto exacto">
            <span class="css-ico ico-zoom-in"></span> Acercar
          </button>
          <button id="btnZoomOutCoord" class="tool-btn btn-zoom hidden" title="Alejar zoom (-50%) desde el punto">
            <span class="css-ico ico-zoom-out"></span> Alejar
          </button>
          <span id="altitudeBadge" class="altitude-badge hidden" title="Altura real de la cámara sobre el suelo (o sobre el elipsoide si no hay terreno)">—</span>
          <button id="btnClearMarker" class="tool-btn btn-icon-clear hidden" title="Quitar marcador temporal del mapa">
            <span class="css-ico ico-close"></span>
          </button>
          <div class="pin-measure-toolbar-group">
            <select id="selectPinMeasureShape" class="tool-select compact-select" aria-label="Forma de medición del pin" title="Forma a dibujar al medir pin">
              <option value="rectangle">Cuadrado</option>
              <option value="circle">Círculo</option>
            </select>
            <input
              id="inputPinPerimeterKm"
              type="number"
              min="0.2"
              max="2000"
              step="0.5"
              value="16"
              aria-label="Perímetro en kilómetros"
              title="Perímetro en km de la zona a trazar alrededor del pin (16 km = cuadro 4×4 km)"
              class="input-perimeter-km"
            />
            <span class="perimeter-unit">km</span>
            <button id="btnBoxCoord" class="tool-btn btn-accent" title="Generar un cuadrado o círculo con el perímetro indicado en estas coordenadas y medir su relieve">
              <span class="css-ico ico-measure"></span> Medir Pin
            </button>
          </div>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group token-group">
          <label class="imagery-picker" title="Cambiar imagen satelital abierta base (EOX o NASA GIBS)">
            <span class="css-ico ico-layers"></span>
            <select id="selectBaseImagery" class="tool-select" aria-label="Imagen satelital base">
              ${BASE_IMAGERY_OPTIONS.map((opt) => {
                const label =
                  opt.kind === 'sentinel2-eox' ? `EOX ${getEoxYearInUse()} · 10 m` : opt.shortLabel;
                return `<option value="${escapeHtml(opt.kind)}"${opt.kind === this.imagery ? ' selected' : ''}>${escapeHtml(label)}</option>`;
              }).join('')}
            </select>
          </label>
          <button id="btnTokenConfig" class="tool-btn token-btn" title="Configurar Token de Cesium ion para Relieve 3D">
            <span id="terrainStatusDot" class="status-dot"></span>
            <span id="terrainStatusText">Relieve 3D</span>
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group collapse-group">
          <button id="btnMinimizeToolbar" class="tool-btn btn-minimize-toolbar" title="Minimizar barra de herramientas para ver más mapa">
            <span class="css-chevron down"></span> Ocultar
          </button>
        </div>
      </header>

      <!-- Banner flotante de instrucciones de dibujo -->
      <div id="drawStatusBanner" class="draw-status-banner hidden"></div>

      <!-- Botón flotante para restaurar el Panel Lateral cuando esté oculto -->
      <button id="btnToggleSidebar" class="sidebar-toggle-btn collapsed hidden" title="Mostrar Catálogo">
        <span class="css-chevron right"></span> Catálogo
      </button>

      <!-- Panel Lateral Retráctil (Sidebar) -->
      <aside id="appSidebar" class="app-sidebar">
        <div class="sidebar-header" title="Arrastra aquí para mover el panel de catálogo">
          <div class="sidebar-header-left">
            <span class="drag-handle" aria-hidden="true">⠿</span>
            <div>
              <h2>Catálogo y Misiones</h2>
              <p>Parcelas delimitadas y Puntos de Referencia</p>
            </div>
          </div>
          <button id="btnCollapseSidebar" class="tool-btn btn-minimize-toolbar" title="Ocultar panel de catálogo">
            <span class="css-chevron left"></span> Ocultar
          </button>
        </div>

        <!-- Pestañas Principales: Zonas vs Pines -->
        <div class="sidebar-main-tabs">
          <button id="tabMissions" class="main-tab active" title="Zonas poligonales delimitadas">
            <span class="css-ico ico-polygon"></span>
            <span>Zonas Poligonales</span>
            <span class="tab-count">(<span id="countMissions">0</span>)</span>
          </button>
          <button id="tabPins" class="main-tab" title="Puntos y pines de referencia">
            <span class="css-ico ico-pin"></span>
            <span>Puntos y Pines</span>
            <span class="tab-count">(<span id="countPins">0</span>)</span>
          </button>
        </div>

        <div id="filterTabs" class="filter-tabs"></div>

        <div id="missionList" class="mission-list"></div>

        <div class="sidebar-footer">
          <button id="btnExportCatalog" class="footer-btn" title="Descargar elementos en archivo GeoJSON">
            <span class="css-ico ico-export"></span> Exportar GeoJSON
          </button>
          <label class="footer-btn file-label" title="Cargar archivo GeoJSON o JSON con zonas">
            <span class="css-ico ico-import"></span> Importar
            <input id="inputImportCatalog" type="file" accept=".geojson,.json" hidden />
          </label>
        </div>
      </aside>

      <!-- Contenedor de Ventanas Modales -->
      <div id="modalContainer" class="modal-backdrop hidden"></div>
    `;

    this.topToolbarEl = this.root.querySelector('#topToolbar')!;
    this.topFiltersBarEl = this.root.querySelector('#topFiltersBar')!;
    this.restoreFiltersBtnEl = this.root.querySelector('#btnRestoreFilters')!;
    this.restoreToolbarBtnEl = this.root.querySelector('#btnRestoreToolbar')!;
    this.coordInputEl = this.root.querySelector('#inputCoords')!;
    this.statusBannerEl = this.root.querySelector('#drawStatusBanner')!;
    this.missionListEl = this.root.querySelector('#missionList')!;
    this.filterButtonsContainer = this.root.querySelector('#filterTabs')!;
    this.modalContainerEl = this.root.querySelector('#modalContainer')!;
    this.finishBtnEl = this.root.querySelector('#btnFinishDraw')!;
    this.undoBtnEl = this.root.querySelector('#btnUndoDraw')!;
    this.cancelBtnEl = this.root.querySelector('#btnCancelDraw')!;
    this.toggle3DBtnEl = this.root.querySelector('#btnToggle3D')!;
    this.toggleGlobalFillBtnEl = this.root.querySelector('#btnToggleGlobalFill')!;
    this.terrainBadgeEl = this.root.querySelector('#btnTokenConfig')!;
    this.zoomInBtnEl = this.root.querySelector('#btnZoomInCoord')!;
    this.zoomOutBtnEl = this.root.querySelector('#btnZoomOutCoord')!;
    this.altitudeBadgeEl = this.root.querySelector('#altitudeBadge')!;
    this.clearMarkerBtnEl = this.root.querySelector('#btnClearMarker')!;
    this.tabMissionsBtn = this.root.querySelector('#tabMissions')!;
    this.tabPinsBtn = this.root.querySelector('#tabPins')!;

    this.updateTerrainIndicator();
    this.update3DButtonState();
    this.bindToolbarEvents();
    this.bindListDelegation();

    const sidebarEl = this.root.querySelector('#appSidebar') as HTMLElement;
    makePanelDraggable(sidebarEl, '.sidebar-header', {
      preserveHeight: true,
      panelId: 'sidebar',
      defaultDock: 'left',
      dockWidth: 300,
      isHidden: () => sidebarEl.classList.contains('collapsed'),
    });
    makePanelDraggable(this.topFiltersBarEl, '.brand-group', {
      panelId: 'filtersBar',
      defaultDock: 'top',
      isHidden: () => this.topFiltersBarEl.classList.contains('minimized'),
    });
    makePanelDraggable(this.topToolbarEl, '.brand-group', {
      panelId: 'toolbar',
      defaultDock: 'bottom',
      isHidden: () => this.topToolbarEl.classList.contains('minimized'),
    });

    // P11: la etiqueta muestra la altura real de la cámara cuando termina de moverse.
    this.viewer.camera.moveEnd.addEventListener(() => {
      this.updateAltitudeBadge();
      this.updateTerrainIndicator();
      this.update3DButtonState();
    });
    this.viewer.scene.morphComplete.addEventListener(() => {
      this.update3DButtonState();
    });
  }

  private update3DButtonState(forced?: boolean): void {
    const active = forced ?? is3DViewActive(this.viewer);
    this.toggle3DBtnEl.classList.toggle('active', active);
    this.toggle3DBtnEl.setAttribute('aria-pressed', active ? 'true' : 'false');
    const label = this.toggle3DBtnEl.querySelector('#labelToggle3D');
    if (label) label.textContent = active ? '3D' : '2D';
    this.toggle3DBtnEl.title = active
      ? 'Vista 3D inclinada activa (clic para vista 2D cenital; también clic derecho + arrastrar)'
      : 'Vista 2D cenital (clic para activar perspectiva 3D; también clic derecho + arrastrar)';
  }

  private updateAltitudeBadge(): void {
    const { meters, overGround } = getCameraHeightAboveGround(this.viewer);
    const value =
      meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
    this.altitudeBadgeEl.textContent = `Cámara: ${value} ${overGround ? 'sobre el suelo' : 'sobre el elipsoide'}`;
  }

  private updateTerrainIndicator(): void {
    const dot = this.root.querySelector('#terrainStatusDot')!;
    const text = this.root.querySelector('#terrainStatusText')!;
    const eoxYear = getEoxYearInUse();
    const imageryDesc =
      this.imagery === 'sentinel2-eox'
        ? `Sentinel-2 cloudless ${eoxYear} (EOX, ${eoxYear === 2016 ? 'CC BY 4.0' : 'CC BY-NC-SA 4.0, no comercial'}, ~10 m)`
        : (BASE_IMAGERY_OPTIONS.find((opt) => opt.kind === this.imagery)?.description ??
          'Imagen satelital abierta');
    const detailSuffix = isDetailImageryOn() ? ' + Detalle aéreo USGS (~2 m)' : '';
    const imageryNote = `Imagen: ${imageryDesc}${detailSuffix}`;

    const eoxOption = this.root.querySelector(
      '#selectBaseImagery option[value="sentinel2-eox"]'
    ) as HTMLOptionElement | null;
    if (eoxOption) {
      eoxOption.textContent = `EOX ${eoxYear} · 10 m`;
    }

    if (this.terrain.kind === 'local') {
      dot.className = 'status-dot online';
      text.textContent = 'Relieve local';
    } else if (this.terrain.kind === 'ion') {
      dot.className = 'status-dot online';
      text.textContent = 'Relieve Cesium ion';
    } else {
      dot.className = 'status-dot simulated';
      text.textContent = 'Sin relieve · Token';
    }
    this.terrainBadgeEl.title = `${imageryNote}. Clic para configurar el token de Cesium ion.`;
  }

  private bindToolbarEvents(): void {
    this.root.querySelector('#btnModeNavigate')!.addEventListener('click', () => {
      this.drawer.setMode('navigate');
    });

    this.root.querySelector('#btnModePin')!.addEventListener('click', () => {
      this.drawer.setMode('pin');
    });

    this.root.querySelector('#btnModeRectangle')!.addEventListener('click', () => {
      this.drawer.setMode('rectangle');
    });

    this.root.querySelector('#btnModeCircle')!.addEventListener('click', () => {
      this.drawer.setMode('circle');
    });

    this.root.querySelector('#btnModePolygon')!.addEventListener('click', () => {
      this.drawer.setMode('polygon');
    });

    this.finishBtnEl.addEventListener('click', () => {
      this.drawer.finishCurrentPolygon();
    });

    this.undoBtnEl.addEventListener('click', () => {
      this.drawer.undoLastVertex();
    });

    this.cancelBtnEl.addEventListener('click', () => {
      this.drawer.cancel();
    });

    this.toggle3DBtnEl.addEventListener('click', () => {
      const enabled = toggle3DView(this.viewer);
      this.update3DButtonState(enabled);
    });

    const bindGeoToggle = (id: string, kind: GeoPinKind) => {
      const btn = this.root.querySelector<HTMLButtonElement>(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        void this.subsueloCrateresLayer
          .toggle(kind)
          .then((activo) => {
            btn.classList.toggle('active', activo);
            btn.setAttribute('aria-pressed', String(activo));
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`No se pudo cargar ${kind}:`, err);
            this.statusBannerEl.classList.remove('hidden');
            this.statusBannerEl.classList.add('banner-warning');
            this.statusBannerEl.textContent = `No se pudo cargar ${kind}: ${msg}`;
          })
          .finally(() => {
            btn.disabled = false;
          });
      });
    };
    bindGeoToggle('#btnToggleCuevas', 'cuevas');
    bindGeoToggle('#btnToggleCrateres', 'crateres');

    this.root.querySelector('#btnMinimizeFilters')?.addEventListener('click', () => {
      this.topFiltersBarEl.classList.add('minimized');
      this.restoreFiltersBtnEl.classList.remove('hidden');
    });
    this.restoreFiltersBtnEl.addEventListener('click', () => {
      this.topFiltersBarEl.classList.remove('minimized');
      this.restoreFiltersBtnEl.classList.add('hidden');
    });

    this.toggleGlobalFillBtnEl.addEventListener('click', () => {
      const isVisible = this.missionManager.toggleGlobalFills();
      this.toggleGlobalFillBtnEl.innerHTML = isVisible
        ? '<span class="css-ico ico-fill"></span> Relleno: ON'
        : '<span class="css-ico ico-fill off"></span> Relleno: OFF';
      this.toggleGlobalFillBtnEl.classList.toggle('off', !isVisible);
      this.toggleGlobalFillBtnEl.title = isVisible
        ? 'Relleno de color activo. Haz clic para ocultar el relleno y ver el satélite nítido.'
        : 'Solo líneas perimetrales activas. Haz clic para volver a mostrar el color de relleno.';
    });

    const imagerySelectEl = this.root.querySelector('#selectBaseImagery') as HTMLSelectElement;
    imagerySelectEl.addEventListener('change', async () => {
      const chosen = imagerySelectEl.value as ImageryKind;
      imagerySelectEl.disabled = true;
      try {
        const applied = await setBaseImagery(this.viewer, chosen);
        this.imagery = applied;
        imagerySelectEl.value = applied;
        const dbg = (window as unknown as { __visor?: { imagery?: ImageryKind } }).__visor;
        if (dbg) dbg.imagery = applied;
        this.updateTerrainIndicator();
      } finally {
        imagerySelectEl.disabled = false;
      }
    });

    // Minimizar y restaurar la barra superior flotante
    const minimizeBtn = this.root.querySelector('#btnMinimizeToolbar')!;
    minimizeBtn.addEventListener('click', () => {
      this.topToolbarEl.classList.add('minimized');
      this.restoreToolbarBtnEl.classList.remove('hidden');
    });

    this.restoreToolbarBtnEl.addEventListener('click', () => {
      this.topToolbarEl.classList.remove('minimized');
      this.restoreToolbarBtnEl.classList.add('hidden');
    });

    // Pestañas principales del Sidebar (Zonas vs Pines)
    this.tabMissionsBtn.addEventListener('click', () => {
      this.activeMainTab = 'missions';
      this.renderSidebarContent();
    });

    this.tabPinsBtn.addEventListener('click', () => {
      this.activeMainTab = 'pins';
      this.renderSidebarContent();
    });

    // Búsqueda y vuelo a coordenadas unificadas (Latitud, Longitud)
    const doFlyToCoordinates = async () => {
      const parsed = parseCoordinatesInput(this.coordInputEl.value);
      if (!parsed) {
        alert(
          'Ingresa o pega las coordenadas en formato "Latitud, Longitud" (ej. 14.0540, -87.2489), tal como se copian directamente de Google Maps.'
        );
        return;
      }

      const { lat, lon } = parsed;
      this.coordInputEl.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      this.currentTargetCoords = { lat, lon };
      this.currentZoomAltitudeM = 1200;
      this.currentTargetElevationM = null;

      // R4: la cámara sale de inmediato; la altura detallada llega después y corrige.
      setTargetMarker(this.viewer, lat, lon, undefined);
      this.zoomInBtnEl.classList.remove('hidden');
      this.zoomOutBtnEl.classList.remove('hidden');
      this.altitudeBadgeEl.classList.remove('hidden');
      this.clearMarkerBtnEl.classList.remove('hidden');

      const elevation = await flyToCoordinates(this.viewer, lat, lon, this.currentZoomAltitudeM);
      if (this.currentTargetCoords?.lat === lat && this.currentTargetCoords?.lon === lon) {
        this.currentTargetElevationM = elevation;
        updateTargetMarkerElevation(this.viewer, lat, lon, elevation);
      }
    };

    this.root.querySelector('#btnFlyCoord')!.addEventListener('click', doFlyToCoordinates);
    this.coordInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        doFlyToCoordinates();
      }
    });

    this.root.querySelector('#btnSaveCoordAsPin')!.addEventListener('click', async () => {
      let target = this.currentTargetCoords;
      if (!target) {
        const parsed = parseCoordinatesInput(this.coordInputEl.value);
        if (parsed) {
          target = parsed;
          this.currentTargetCoords = target;
        }
      }
      if (!target) {
        alert(
          'Ingresa primero las coordenadas (Latitud, Longitud) en el buscador para guardar el Pin.'
        );
        return;
      }
      const sampled = await sampleGroundElevation(this.viewer, target.lat, target.lon);
      const elevation = sampled === null ? null : Math.round(sampled);
      this.currentTargetElevationM = elevation;
      this.openNewPinModal(target.lat, target.lon, elevation);
    });

    this.zoomInBtnEl.addEventListener('click', () => {
      if (!this.currentTargetCoords) {
        const parsed = parseCoordinatesInput(this.coordInputEl.value);
        if (parsed) {
          this.currentTargetCoords = parsed;
          setTargetMarker(this.viewer, parsed.lat, parsed.lon, this.currentTargetElevationM);
        } else {
          return;
        }
      }
      // Paso de acercamiento: reduce a la mitad pero con límite suave en 80m sobre el suelo real
      this.currentZoomAltitudeM = Math.max(80, Math.round(this.currentZoomAltitudeM * 0.5));
      zoomToTargetCoord(
        this.viewer,
        this.currentTargetCoords.lat,
        this.currentTargetCoords.lon,
        this.currentZoomAltitudeM,
        this.currentTargetElevationM
      );
    });

    this.zoomOutBtnEl.addEventListener('click', () => {
      if (!this.currentTargetCoords) {
        const parsed = parseCoordinatesInput(this.coordInputEl.value);
        if (parsed) {
          this.currentTargetCoords = parsed;
          setTargetMarker(this.viewer, parsed.lat, parsed.lon, this.currentTargetElevationM);
        } else {
          return;
        }
      }
      // Paso de alejamiento: duplica la distancia
      this.currentZoomAltitudeM = Math.min(25000, Math.round(this.currentZoomAltitudeM * 2.0));
      zoomToTargetCoord(
        this.viewer,
        this.currentTargetCoords.lat,
        this.currentTargetCoords.lon,
        this.currentZoomAltitudeM,
        this.currentTargetElevationM
      );
    });

    this.clearMarkerBtnEl.addEventListener('click', () => {
      removeTargetMarker(this.viewer);
      this.currentTargetCoords = null;
      this.coordInputEl.value = '';
      this.currentZoomAltitudeM = 1200;
      this.zoomInBtnEl.classList.add('hidden');
      this.zoomOutBtnEl.classList.add('hidden');
      this.altitudeBadgeEl.classList.add('hidden');
      this.clearMarkerBtnEl.classList.add('hidden');
    });

    this.root.querySelector('#btnBoxCoord')!.addEventListener('click', () => {
      let target = this.currentTargetCoords;
      if (!target) {
        const parsed = parseCoordinatesInput(this.coordInputEl.value);
        if (parsed) {
          target = parsed;
          this.currentTargetCoords = target;
        }
      }
      if (!target) {
        alert(
          'Ingresa o vuela primero a unas coordenadas (Latitud, Longitud) para trazar la zona alrededor del pin.'
        );
        return;
      }
      const shapeSelect = this.root.querySelector('#selectPinMeasureShape') as HTMLSelectElement;
      const perimeterInput = this.root.querySelector('#inputPinPerimeterKm') as HTMLInputElement;
      const shape: 'rectangle' | 'circle' =
        shapeSelect?.value === 'circle' ? 'circle' : 'rectangle';
      const rawPerimeter = parseFloat(perimeterInput?.value ?? '16');
      if (!Number.isFinite(rawPerimeter) || rawPerimeter <= 0) {
        alert('Ingresa un perímetro válido mayor a 0 km.');
        return;
      }
      const coords =
        shape === 'circle'
          ? buildCircleFromPerimeter(target.lat, target.lon, rawPerimeter)
          : buildSquareFromPerimeter(target.lat, target.lon, rawPerimeter);
      flyToPolygonCoords(this.viewer, coords);
      this.handleShapeCompleted(coords, shape);
    });

    // Sidebar toggle
    const sidebarEl = this.root.querySelector('#appSidebar')!;
    const toggleBtn = this.root.querySelector('#btnToggleSidebar')!;
    const collapseBtn = this.root.querySelector('#btnCollapseSidebar')!;
    const setSidebarCollapsed = (collapsed: boolean) => {
      this.isSidebarCollapsed = collapsed;
      sidebarEl.classList.toggle('collapsed', collapsed);
      toggleBtn.classList.toggle('hidden', !collapsed);
    };
    collapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
    toggleBtn.addEventListener('click', () => setSidebarCollapsed(false));

    // Exportar e Importar catálogo
    this.root.querySelector('#btnExportCatalog')!.addEventListener('click', () => {
      this.missionManager.exportCatalogGeoJSON();
    });

    const importInput = this.root.querySelector('#inputImportCatalog') as HTMLInputElement;
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const { imported, rejected } = this.missionManager.importCatalogFromObject(json);
        alert(
          `Se importaron ${imported} zona(s).` +
            (rejected > 0 ? ` Se descartaron ${rejected} por datos inválidos.` : '') +
            ' El relieve importado queda marcado como "importado": no se midió en este visor.'
        );
      } catch {
        alert('No se pudo leer el archivo seleccionado. Verifica que sea un JSON o GeoJSON válido.');
      }
      importInput.value = '';
    });

    // Modal de Token Cesium Ion
    this.terrainBadgeEl.addEventListener('click', () => {
      this.openTokenModal();
    });
  }

  private updateToolbarState(
    mode: DrawMode,
    vertexCount: number,
    hasSelfIntersection: boolean = false
  ): void {
    const navBtn = this.root.querySelector('#btnModeNavigate')!;
    const pinBtn = this.root.querySelector('#btnModePin')!;
    const rectBtn = this.root.querySelector('#btnModeRectangle')!;
    const circleBtn = this.root.querySelector('#btnModeCircle')!;
    const polyBtn = this.root.querySelector('#btnModePolygon')!;

    navBtn.classList.toggle('active', mode === 'navigate');
    pinBtn.classList.toggle('active', mode === 'pin');
    rectBtn.classList.toggle('active', mode === 'rectangle');
    circleBtn.classList.toggle('active', mode === 'circle');
    polyBtn.classList.toggle('active', mode === 'polygon');

    if (mode === 'navigate') {
      this.statusBannerEl.classList.add('hidden');
      this.statusBannerEl.classList.remove('banner-warning');
      this.finishBtnEl.classList.add('hidden');
      this.undoBtnEl.classList.add('hidden');
      this.cancelBtnEl.classList.add('hidden');
      return;
    }

    this.cancelBtnEl.classList.remove('hidden');
    this.statusBannerEl.classList.remove('hidden');

    if (mode === 'pin') {
      this.finishBtnEl.classList.add('hidden');
      this.undoBtnEl.classList.add('hidden');
      this.statusBannerEl.classList.remove('banner-warning');
      this.statusBannerEl.innerHTML =
        '<span class="css-ico ico-pin"></span> <strong>Modo Pin:</strong> Haz clic en cualquier punto del mapa para colocar un marcador y registrarlo.';
    } else if (mode === 'rectangle') {
      this.finishBtnEl.classList.add('hidden');
      this.undoBtnEl.classList.toggle('hidden', vertexCount === 0);
      this.statusBannerEl.classList.remove('banner-warning');
      this.statusBannerEl.innerHTML =
        vertexCount === 0
          ? '<span class="css-ico ico-square"></span> <strong>Modo Cuadro:</strong> Haz clic en el mapa para fijar la 1.ª esquina de la parcela.'
          : '<span class="css-ico ico-square"></span> <strong>Modo Cuadro:</strong> Mueve el ratón y haz clic en la esquina opuesta para generar el recuadro.';
    } else if (mode === 'circle') {
      this.finishBtnEl.classList.add('hidden');
      this.undoBtnEl.classList.toggle('hidden', vertexCount === 0);
      this.statusBannerEl.classList.remove('banner-warning');
      this.statusBannerEl.innerHTML =
        vertexCount === 0
          ? '<span class="css-ico ico-circle"></span> <strong>Modo Círculo:</strong> Haz clic en el mapa para fijar el centro del círculo.'
          : '<span class="css-ico ico-circle"></span> <strong>Modo Círculo:</strong> Mueve el ratón para definir el radio y haz clic para cerrar el círculo.';
    } else if (mode === 'polygon') {
      this.finishBtnEl.classList.toggle('hidden', vertexCount < 3);
      this.undoBtnEl.classList.toggle('hidden', vertexCount === 0);

      if (hasSelfIntersection) {
        this.statusBannerEl.classList.add('banner-warning');
        this.statusBannerEl.innerHTML =
          '<span class="css-ico ico-warn"></span> <strong>¡Línea cruzada detectada!</strong> Las líneas se cruzan en forma de "X". Sigue el borde del perímetro en orden continuo (como una cerca). Pulsa <strong>«Deshacer»</strong> o al terminar se auto-enderezará.';
      } else {
        this.statusBannerEl.classList.remove('banner-warning');
        if (vertexCount === 0) {
          this.statusBannerEl.innerHTML =
            '<span class="css-ico ico-polygon"></span> <strong>Modo Polígono:</strong> Haz clic sobre el terreno para marcar la primera esquina (P1).';
        } else if (vertexCount < 3) {
          this.statusBannerEl.innerHTML =
            `<span class="css-ico ico-polygon"></span> <strong>Modo Polígono (${vertexCount} pts):</strong> Continúa haciendo clics <strong>siguiendo el borde perimetral</strong> en orden continuo (como una cerca).`;
        } else {
          this.statusBannerEl.innerHTML =
            `<span class="css-ico ico-polygon"></span> <strong>Modo Polígono (${vertexCount} pts):</strong> Haz <strong>doble clic</strong> o pulsa "Terminar" para cerrar la figura.`;
        }
      }
    }
  }

  private async handlePinPlaced(coord: GeoCoord): Promise<void> {
    this.currentTargetCoords = coord;
    this.coordInputEl.value = `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`;
    const sampled = await sampleGroundElevation(this.viewer, coord.lat, coord.lon);
    const elevation = sampled === null ? null : Math.round(sampled);
    this.currentTargetElevationM = elevation;
    this.openNewPinModal(coord.lat, coord.lon, elevation);
  }

  private async handleShapeCompleted(
    coords: GeoCoord[],
    shapeType: ShapeType
  ): Promise<void> {
    this.statusBannerEl.classList.remove('hidden');
    this.statusBannerEl.innerHTML =
      this.terrain.kind === 'ninguno'
        ? '<span class="css-ico ico-spinner"></span> <strong>Midiendo:</strong> área y perímetro. Sin terreno cargado, el relieve queda "sin dato".'
        : '<span class="css-ico ico-spinner"></span> <strong>Analizando relieve 3D:</strong> Calculando área, perímetro, elevaciones y pendiente...';

    const metrics = await analyzePolygonTerrain(this.viewer, coords, this.terrain);
    this.statusBannerEl.classList.add('hidden');
    this.openNewMissionModal(coords, shapeType, metrics);
  }

  private openNewPinModal(lat: number, lon: number, elevationM: number | null): void {
    abrirModalPin(this.modalContainerEl, lat, lon, elevationM, (pin, measureAround) => {
      this.missionManager.addPin(pin);
      this.activeMainTab = 'pins';
      this.renderSidebarContent();
      if (measureAround) {
        const coords =
          measureAround.shape === 'circle'
            ? buildCircleFromPerimeter(lat, lon, measureAround.perimeterKm)
            : buildSquareFromPerimeter(lat, lon, measureAround.perimeterKm);
        flyToPolygonCoords(this.viewer, coords);
        void this.handleShapeCompleted(coords, measureAround.shape);
      } else {
        flyToCoordinates(this.viewer, lat, lon, 800);
      }
    });
  }

  private openNewMissionModal(
    coords: GeoCoord[],
    shapeType: ShapeType,
    metrics: TopographicMetrics
  ): void {
    abrirModalZona(this.modalContainerEl, coords, shapeType, metrics, (zona) => {
      this.missionManager.addMission(zona);
      this.activeMainTab = 'missions';
      this.renderSidebarContent();
      this.onZonaSeleccionada?.(zona);
    });
  }

  private openTokenModal(): void {
    abrirModalToken(this.modalContainerEl, getSavedIonToken(), async (token) => {
      saveIonToken(token);
      const ionActive = await enableWorldTerrain(this.viewer, token);
      this.terrain = { kind: ionActive ? 'ion' : 'ninguno' };
      this.updateTerrainIndicator();
    });
  }

  private renderSidebarContent(): void {
    const allMissions = this.missionManager.getMissions();
    const allPins = this.missionManager.getPins();

    const countMissionsEl = this.root.querySelector('#countMissions');
    const countPinsEl = this.root.querySelector('#countPins');
    if (countMissionsEl) countMissionsEl.textContent = String(allMissions.length);
    if (countPinsEl) countPinsEl.textContent = String(allPins.length);

    this.tabMissionsBtn.classList.toggle('active', this.activeMainTab === 'missions');
    this.tabPinsBtn.classList.toggle('active', this.activeMainTab === 'pins');

    if (this.activeMainTab === 'missions') {
      this.renderMissionsTab(allMissions);
    } else {
      this.renderPinsTab(allPins);
    }
  }

  /**
   * R9: un solo listener por contenedor (delegación) en vez de uno por botón en cada repintado.
   */
  private bindListDelegation(): void {
    this.filterButtonsContainer.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-tab');
      if (!btn) return;
      if (btn.dataset.filter) {
        this.activeFilter = btn.dataset.filter as 'all' | TargetBody;
      } else if (btn.dataset.pinfilter) {
        this.activePinFilter = btn.dataset.pinfilter as 'all' | PinCategory;
      }
      this.renderSidebarContent();
    });

    this.missionListEl.addEventListener('click', (e) => {
      const targetEl = e.target as HTMLElement;
      const swatchBtn = targetEl.closest<HTMLElement>('.card-swatch-btn');
      if (swatchBtn) {
        e.stopPropagation();
        const id = swatchBtn.dataset.id ?? '';
        const color = swatchBtn.dataset.color ?? '';
        if (id && color) {
          this.missionManager.updateMissionColor(id, color);
        }
        return;
      }

      const btn = targetEl.closest<HTMLElement>('.card-btn');
      if (!btn) {
        const card = targetEl.closest<HTMLElement>('.mission-card');
        const cid = card?.dataset.id;
        if (cid) {
          const mission = this.missionManager.getMissionById(cid);
          if (mission) this.onZonaSeleccionada?.(mission);
        }
        return;
      }
      e.stopPropagation();
      const id = btn.dataset.id ?? '';
      const action = btn.dataset.action;

      if (action === 'fly') {
        const mission = this.missionManager.getMissionById(id);
        if (mission) {
          flyToPolygonCoords(this.viewer, mission.coordinates);
          this.onZonaSeleccionada?.(mission);
        }
      } else if (action === 'layers') {
        const mission = this.missionManager.getMissionById(id);
        if (mission) {
          flyToPolygonCoords(this.viewer, mission.coordinates);
          this.zoneLayerPanel.openForZone(mission);
          this.onZonaSeleccionada?.(mission);
        }
      } else if (action === 'toggle-fill') {
        this.missionManager.toggleMissionFill(id);
      } else if (action === 'toggle-color') {
        this.openColorPaletteMissionId = this.openColorPaletteMissionId === id ? null : id;
        const palette = this.missionListEl.querySelector<HTMLElement>(
          `[data-palette-for="${CSS.escape(id)}"]`
        );
        if (palette) palette.classList.toggle('hidden', this.openColorPaletteMissionId !== id);
      } else if (action === 'export') {
        this.missionManager.exportMissionGeoJSON(id);
      } else if (action === 'delete') {
        if (confirm('¿Eliminar esta zona del catálogo?')) {
          this.zoneLayerPanel.handleZoneDeleted(id);
          this.missionManager.deleteMission(id);
          this.onZonaSeleccionada?.(null);
        }
      } else if (action === 'fly-pin') {
        const pin = this.missionManager.getPinById(id);
        if (!pin) return;
        removeTargetMarker(this.viewer);
        this.currentTargetCoords = { lat: pin.lat, lon: pin.lon };
        this.currentTargetElevationM = pin.elevationM;
        this.currentZoomAltitudeM = 800;
        this.coordInputEl.value = `${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)}`;
        flyToCoordinates(this.viewer, pin.lat, pin.lon, 800, pin.elevationM);
        this.zoomInBtnEl.classList.remove('hidden');
        this.zoomOutBtnEl.classList.remove('hidden');
        this.altitudeBadgeEl.classList.remove('hidden');
        this.clearMarkerBtnEl.classList.remove('hidden');
      } else if (action === 'measure-pin') {
        const pin = this.missionManager.getPinById(id);
        if (!pin) return;
        const perimeterInput = this.root.querySelector('#inputPinPerimeterKm') as HTMLInputElement | null;
        const defaultPerimeter = parseFloat(perimeterInput?.value ?? '16') || 16;
        abrirModalMedirPin(
          this.modalContainerEl,
          pin.name,
          pin.lat,
          pin.lon,
          defaultPerimeter,
          (shape, perimeterKm) => {
            const coords =
              shape === 'circle'
                ? buildCircleFromPerimeter(pin.lat, pin.lon, perimeterKm)
                : buildSquareFromPerimeter(pin.lat, pin.lon, perimeterKm);
            flyToPolygonCoords(this.viewer, coords);
            void this.handleShapeCompleted(coords, shape);
          }
        );
      } else if (action === 'export-pin') {
        this.missionManager.exportPinGeoJSON(id);
      } else if (action === 'delete-pin') {
        if (confirm('¿Eliminar este pin del catálogo?')) this.missionManager.deletePin(id);
      }
    });

    this.missionListEl.addEventListener('change', (e) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('.card-color-custom');
      if (!input) return;
      const id = input.dataset.id ?? '';
      if (id && input.value) {
        this.missionManager.updateMissionColor(id, input.value);
      }
    });
  }

  private renderMissionsTab(allMissions: MissionZone[]): void {
    renderZonas(
      this.filterButtonsContainer,
      this.missionListEl,
      allMissions,
      this.activeFilter,
      (id) => this.missionManager.isMissionFillVisible(id),
      this.openColorPaletteMissionId
    );
  }

  private renderPinsTab(allPins: SavedPin[]): void {
    renderPines(this.filterButtonsContainer, this.missionListEl, allPins, this.activePinFilter);
  }
}
