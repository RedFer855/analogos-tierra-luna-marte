import {
  ZONE_PRESET_COLORS,
  type MissionZone,
  type PinCategory,
  type SavedPin,
  type TargetBody,
  type TopographicMetrics,
} from '../types/mission';
import {
  describeTerrainSource,
  ELEVATION_REFERENCE_LABEL,
  escapeHtml,
  formatElevation,
  formatSlope,
  formatVolume,
} from '../util/format';

/*
 * Listas del catálogo lateral (zonas y pines). Solo arman el HTML; los clics los atiende
 * un único listener en AppUI (R9). Todo texto del usuario o importado pasa por escapeHtml (S1).
 */

/** Línea que explica de dónde salió el relieve y cómo se estimó la pendiente. */
export function metricsSourceNote(metrics: TopographicMetrics): string {
  const source = describeTerrainSource(metrics.terrainSource);
  const slope =
    metrics.slopeSpacingM !== null
      ? ` · Pendiente estimada en vivo cada ${metrics.slopeSpacingM} m (la oficial sale del ETL)`
      : '';
  const ref = metrics.maxElevationM !== null ? ` · Alturas ${ELEVATION_REFERENCE_LABEL}` : '';
  return `${source}${ref}${slope}`;
}

export function renderZonas(
  filtros: HTMLElement,
  lista: HTMLElement,
  allMissions: MissionZone[],
  activeFilter: 'all' | TargetBody,
  isFillVisible: (id: string) => boolean,
  openPaletteId: string | null = null
): void {
  const marsCount = allMissions.filter((m) => m.targetBody === 'mars').length;
  const moonCount = allMissions.filter((m) => m.targetBody === 'moon').length;

  filtros.innerHTML = `
    <button class="filter-tab ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">
      Todas (${allMissions.length})
    </button>
    <button class="filter-tab ${activeFilter === 'mars' ? 'active' : ''}" data-filter="mars">
      <span class="css-dot dot-mars"></span> Marte (${marsCount})
    </button>
    <button class="filter-tab ${activeFilter === 'moon' ? 'active' : ''}" data-filter="moon">
      <span class="css-dot dot-moon"></span> Luna (${moonCount})
    </button>
  `;

  const filtered =
    activeFilter === 'all'
      ? allMissions
      : allMissions.filter((m) => m.targetBody === activeFilter);

  if (filtered.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <p>No hay zonas en esta categoría.</p>
        <small>Usa "Dibujar Cuadro", "Dibujar Círculo" o "Dibujar Polígono" en la barra de herramientas para trazar una zona.</small>
      </div>
    `;
    return;
  }

  // S1: todo texto del usuario o de un archivo importado pasa por escapeHtml.
  lista.innerHTML = filtered
    .map((m) => {
      const isMars = m.targetBody === 'mars';
      const id = escapeHtml(m.id);
      const zoneColor = m.color ?? (isMars ? '#f97316' : '#38bdf8');
      const shapeLabel =
        m.shapeType === 'rectangle'
          ? 'Cuadro'
          : m.shapeType === 'circle'
            ? 'Círculo'
            : 'Polígono';
      return `
        <article class="mission-card ${isMars ? 'card-mars' : 'card-moon'}" data-id="${id}" style="border-left-color: ${escapeHtml(zoneColor)}">
          <div class="card-top">
            <span class="body-badge ${isMars ? 'badge-mars' : 'badge-moon'}">
              <span class="css-dot ${isMars ? 'dot-mars' : 'dot-moon'}"></span>
              ${isMars ? 'Análogo Marte' : 'Análogo Luna'}
            </span>
            <span class="shape-tag">${shapeLabel}</span>
          </div>

          <h3 class="card-title">${escapeHtml(m.name)}</h3>
          <div class="card-target">
            <span class="css-ico ico-target"></span>
            <span>Se parece a: <strong>${escapeHtml(m.analogSiteName)}</strong></span>
          </div>

          <div class="card-metrics-grid">
            <div class="cm-cell">
              <span>Superficie</span>
              <strong>${m.metrics.areaKm2.toFixed(2)} km² (${m.metrics.areaHa.toFixed(0)} ha)</strong>
            </div>
            <div class="cm-cell">
              <span>Perímetro</span>
              <strong>${m.metrics.perimeterKm.toFixed(2)} km</strong>
            </div>
            <div class="cm-cell">
              <span>Montaña / Pico</span>
              <strong>${formatElevation(m.metrics.maxElevationM)}</strong>
            </div>
            <div class="cm-cell">
              <span>Fondo / Cuenca</span>
              <strong>${formatElevation(m.metrics.minElevationM)}</strong>
            </div>
            <div class="cm-cell highlight-cell">
              <span>Desnivel / Cráter</span>
              <strong>${formatElevation(m.metrics.reliefDepthM)}</strong>
            </div>
            <div class="cm-cell">
              <span>Pendiente / Vol.</span>
              <strong>${formatSlope(m.metrics.avgSlopePercent)} · ${formatVolume(m.metrics.approxVolumeM3)}</strong>
            </div>
          </div>
          <p class="metrics-source-note">${escapeHtml(metricsSourceNote(m.metrics))}</p>

          ${m.notes ? `<p class="card-notes">${escapeHtml(m.notes)}</p>` : ''}

          <div class="card-actions">
            <button class="card-btn btn-fly" data-action="fly" data-id="${id}">
              <span class="css-ico ico-target"></span> Volar
            </button>
            <button class="card-btn btn-layers" data-action="layers" data-id="${id}" title="Capas temáticas (Geología, Suelos/Polvo, Radiación)">
              <span class="css-ico ico-layers"></span> Capas
            </button>
            <button class="card-btn btn-toggle-fill-card" data-action="toggle-fill" data-id="${id}" title="Alternar relleno para ver terreno nítido">
              ${
                isFillVisible(m.id)
                  ? '<span class="css-ico ico-fill"></span> Relleno'
                  : '<span class="css-ico ico-fill off"></span> Contorno'
              }
            </button>
            <button class="card-btn btn-export" data-action="export" data-id="${id}">
              <span class="css-ico ico-export"></span> GeoJSON
            </button>
            <button class="card-btn btn-color" data-action="toggle-color" data-id="${id}" title="Cambiar color de la zona">
              <span class="color-dot-preview" style="background: ${escapeHtml(zoneColor)}"></span>
            </button>
            <button class="card-btn btn-delete" data-action="delete" data-id="${id}" title="Eliminar zona">
              <span class="css-ico ico-trash"></span>
            </button>
          </div>
          <div class="card-color-palette ${openPaletteId === m.id ? '' : 'hidden'}" data-palette-for="${id}">
            ${ZONE_PRESET_COLORS.map(
              (c) =>
                `<button type="button" class="card-swatch-btn ${c.hex.toLowerCase() === zoneColor.toLowerCase() ? 'active' : ''}" data-action="set-color" data-id="${id}" data-color="${c.hex}" title="${escapeHtml(c.name)}" style="background: ${c.hex}"></button>`
            ).join('')}
            <label class="card-custom-color-label" title="Color personalizado">
              <input type="color" class="card-color-custom" data-id="${id}" value="${escapeHtml(zoneColor)}" />
              <span>+</span>
            </label>
          </div>
        </article>
      `;
    })
    .join('');
}

export function renderPines(
  filtros: HTMLElement,
  lista: HTMLElement,
  allPins: SavedPin[],
  activePinFilter: 'all' | PinCategory
): void {
  const earthCount = allPins.filter((p) => p.category === 'earth').length;
  const marsCount = allPins.filter((p) => p.category === 'mars').length;
  const moonCount = allPins.filter((p) => p.category === 'moon').length;

  filtros.innerHTML = `
    <button class="filter-tab ${activePinFilter === 'all' ? 'active' : ''}" data-pinfilter="all">
      Todos (${allPins.length})
    </button>
    <button class="filter-tab ${activePinFilter === 'earth' ? 'active' : ''}" data-pinfilter="earth">
      <span class="css-dot dot-earth"></span> Tierra (${earthCount})
    </button>
    <button class="filter-tab ${activePinFilter === 'mars' ? 'active' : ''}" data-pinfilter="mars">
      <span class="css-dot dot-mars"></span> Marte (${marsCount})
    </button>
    <button class="filter-tab ${activePinFilter === 'moon' ? 'active' : ''}" data-pinfilter="moon">
      <span class="css-dot dot-moon"></span> Luna (${moonCount})
    </button>
  `;

  const filtered =
    activePinFilter === 'all'
      ? allPins
      : allPins.filter((p) => p.category === activePinFilter);

  if (filtered.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <p>No hay pines registrados en esta categoría.</p>
        <small>Usa "Marcar Pin" en la barra de herramientas o escribe coordenadas y presiona "Guardar Pin".</small>
      </div>
    `;
    return;
  }

  lista.innerHTML = filtered
    .map((p) => {
      const isMars = p.category === 'mars';
      const isMoon = p.category === 'moon';
      const badgeClass = isMars ? 'badge-mars' : isMoon ? 'badge-moon' : 'badge-earth';
      const dotClass = isMars ? 'dot-mars' : isMoon ? 'dot-moon' : 'dot-earth';
      const badgeText = isMars ? 'Análogo Marte' : isMoon ? 'Análogo Luna' : 'Ref. Terrestre';
      const id = escapeHtml(p.id);

      return `
        <article class="mission-card ${isMars ? 'card-mars' : isMoon ? 'card-moon' : 'card-earth'}" data-id="${id}">
          <div class="card-top">
            <span class="body-badge ${badgeClass}">
              <span class="css-dot ${dotClass}"></span> ${badgeText}
            </span>
            <span class="shape-tag">Punto Pin</span>
          </div>

          <h3 class="card-title">${escapeHtml(p.name)}</h3>

          <div class="card-metrics-grid">
            <div class="cm-cell">
              <span>Latitud</span>
              <strong>${p.lat.toFixed(5)}°</strong>
            </div>
            <div class="cm-cell">
              <span>Longitud</span>
              <strong>${p.lon.toFixed(5)}°</strong>
            </div>
            <div class="cm-cell highlight-cell" style="grid-column: span 2;">
              <span>Altura del terreno</span>
              <strong>${formatElevation(p.elevationM)}${p.elevationM === null ? '' : ` ${ELEVATION_REFERENCE_LABEL}`}</strong>
            </div>
          </div>

          ${p.notes ? `<p class="card-notes">${escapeHtml(p.notes)}</p>` : ''}

          <div class="card-actions">
            <button class="card-btn btn-fly" data-action="fly-pin" data-id="${id}">
              <span class="css-ico ico-target"></span> Volar
            </button>
            <button class="card-btn btn-measure-pin" data-action="measure-pin" data-id="${id}" title="Medir cuadrado o círculo alrededor de este pin">
              <span class="css-ico ico-measure"></span> Medir
            </button>
            <button class="card-btn btn-export" data-action="export-pin" data-id="${id}">
              <span class="css-ico ico-export"></span> GeoJSON
            </button>
            <button class="card-btn btn-delete" data-action="delete-pin" data-id="${id}" title="Eliminar pin">
              <span class="css-ico ico-trash"></span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}
