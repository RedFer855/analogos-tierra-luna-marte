import {
  ZONE_PRESET_COLORS,
  type GeoCoord,
  type MissionZone,
  type PinCategory,
  type SavedPin,
  type ShapeType,
  type TargetBody,
  type TopographicMetrics,
} from '../types/mission';
import {
  ELEVATION_REFERENCE_LABEL,
  escapeHtml,
  formatElevation,
  formatSlope,
  formatVolume,
} from '../util/format';
import { metricsSourceNote } from './catalogo';

/*
 * Ventanas modales del visor. Cada una arma su HTML, valida el formulario y devuelve el
 * resultado por un callback; quien la abre decide qué hacer (guardar, volar, recargar).
 * Todo texto variable pasa por escapeHtml (S1).
 */

export function abrirModalPin(
  container: HTMLElement,
  lat: number,
  lon: number,
  elevationM: number | null,
  onSave: (
    pin: SavedPin,
    measureAround?: { shape: 'rectangle' | 'circle'; perimeterKm: number }
  ) => void
): void {
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h3><span class="css-ico ico-pin"></span> Registrar Punto de Interés / Pin</h3>
          <span>Coordenadas exactas y altitud sobre el relieve 3D</span>
        </div>
        <button id="btnClosePinModal" class="icon-close-btn" title="Cerrar"><span class="css-ico ico-close"></span></button>
      </div>

      <div class="pin-coord-badge-box">
        <div class="pc-item">
          <span>Latitud</span>
          <strong>${lat.toFixed(6)}°</strong>
        </div>
        <div class="pc-item">
          <span>Longitud</span>
          <strong>${lon.toFixed(6)}°</strong>
        </div>
        <div class="pc-item highlight">
          <span>Altura del terreno</span>
          <strong>${formatElevation(elevationM)}</strong>
          <small>${elevationM === null ? 'sin terreno cargado' : ELEVATION_REFERENCE_LABEL}</small>
        </div>
      </div>

      <form id="formNewPin" class="modal-form">
        <div class="form-row">
          <label for="pinName">Nombre del Punto o Lugar *</label>
          <input id="pinName" type="text" required placeholder="Ej. Mi Universidad - UNAH / UNITEC" />
        </div>

        <div class="form-row">
          <label>Categoría y Color del Pin *</label>
          <div class="planet-selector">
            <label class="planet-option">
              <input type="radio" name="pinCategory" value="earth" checked />
              <span class="planet-pill earth-pill"><span class="css-dot dot-earth"></span> Ref. Terrestre</span>
            </label>
            <label class="planet-option">
              <input type="radio" name="pinCategory" value="mars" />
              <span class="planet-pill mars-pill"><span class="css-dot dot-mars"></span> Marte</span>
            </label>
            <label class="planet-option">
              <input type="radio" name="pinCategory" value="moon" />
              <span class="planet-pill moon-pill"><span class="css-dot dot-moon"></span> Luna</span>
            </label>
          </div>
        </div>

        <div class="form-row">
          <label for="pinNotes">Notas o Descripción</label>
          <textarea
            id="pinNotes"
            rows="2"
            placeholder="Ej. Campus universitario, entrada principal, zona de calibración visual..."
          ></textarea>
        </div>

        <div class="form-row pin-measure-box">
          <label class="pin-measure-toggle">
            <input id="pinAlsoMeasure" type="checkbox" />
            <span>Medir zona alrededor de este pin</span>
          </label>
          <div id="pinMeasureOptions" class="pin-measure-options hidden">
            <div class="pin-measure-grid">
              <div class="pin-shape-radios">
                <label class="planet-option">
                  <input type="radio" name="pinMeasureShape" value="rectangle" checked />
                  <span class="planet-pill"><span class="css-ico ico-square"></span> Cuadrado</span>
                </label>
                <label class="planet-option">
                  <input type="radio" name="pinMeasureShape" value="circle" />
                  <span class="planet-pill"><span class="css-ico ico-circle"></span> Círculo</span>
                </label>
              </div>
              <div class="pin-perimeter-field">
                <label for="pinMeasurePerimeter">Perímetro (km)</label>
                <input id="pinMeasurePerimeter" type="number" min="0.2" max="2000" step="0.5" value="16" />
                <small id="pinMeasureHint">Lado: 4.00 km (4×4 km)</small>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" id="btnCancelPinModal" class="btn-secondary-modal">Descartar</button>
          <button type="submit" class="btn-primary-modal"><span class="css-ico ico-check"></span> Guardar Pin en Catálogo</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    container.classList.add('hidden');
    container.innerHTML = '';
  };

  container.querySelector('#btnClosePinModal')!.addEventListener('click', closeModal);
  container.querySelector('#btnCancelPinModal')!.addEventListener('click', closeModal);

  const alsoMeasureEl = container.querySelector('#pinAlsoMeasure') as HTMLInputElement;
  const measureOptionsEl = container.querySelector('#pinMeasureOptions') as HTMLElement;
  const perimeterInputEl = container.querySelector('#pinMeasurePerimeter') as HTMLInputElement;
  const hintEl = container.querySelector('#pinMeasureHint') as HTMLElement;

  const updateMeasureHint = () => {
    const p = parseFloat(perimeterInputEl.value);
    const shape = (container.querySelector('input[name="pinMeasureShape"]:checked') as HTMLInputElement)?.value;
    if (!Number.isFinite(p) || p <= 0) {
      hintEl.textContent = 'Ingresa un perímetro válido (> 0 km)';
      return;
    }
    if (shape === 'circle') {
      const r = p / (2 * Math.PI);
      hintEl.textContent = `Radio: ${r.toFixed(2)} km · Diámetro: ${(r * 2).toFixed(2)} km`;
    } else {
      const side = p / 4;
      hintEl.textContent = `Lado: ${side.toFixed(2)} km (${side.toFixed(2)}×${side.toFixed(2)} km)`;
    }
  };

  alsoMeasureEl.addEventListener('change', () => {
    measureOptionsEl.classList.toggle('hidden', !alsoMeasureEl.checked);
  });
  perimeterInputEl.addEventListener('input', updateMeasureHint);
  container.querySelectorAll('input[name="pinMeasureShape"]').forEach((el) => {
    el.addEventListener('change', updateMeasureHint);
  });

  const form = container.querySelector('#formNewPin') as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (form.querySelector('#pinName') as HTMLInputElement).value.trim();
    const catRadio = form.querySelector('input[name="pinCategory"]:checked') as HTMLInputElement;
    const category: PinCategory = (catRadio?.value as PinCategory) || 'earth';
    const notes = (form.querySelector('#pinNotes') as HTMLTextAreaElement).value.trim();

    const newPin: SavedPin = {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || 'Punto Sin Nombre',
      category,
      lat,
      lon,
      elevationM,
      notes,
      createdAt: new Date().toISOString(),
    };

    let measureAround: { shape: 'rectangle' | 'circle'; perimeterKm: number } | undefined;
    if (alsoMeasureEl.checked) {
      const p = parseFloat(perimeterInputEl.value);
      const shape =
        (form.querySelector('input[name="pinMeasureShape"]:checked') as HTMLInputElement)?.value ===
        'circle'
          ? 'circle'
          : 'rectangle';
      measureAround = {
        shape,
        perimeterKm: Number.isFinite(p) && p > 0 ? p : 16,
      };
    }

    closeModal();
    onSave(newPin, measureAround);
  });
}

export function abrirModalZona(
  container: HTMLElement,
  coords: GeoCoord[],
  shapeType: ShapeType,
  metrics: TopographicMetrics,
  onSave: (zona: MissionZone) => void
): void {
  const centroidLat = (
    coords.reduce((acc, c) => acc + c.lat, 0) / coords.length
  ).toFixed(4);
  const centroidLon = (
    coords.reduce((acc, c) => acc + c.lon, 0) / coords.length
  ).toFixed(4);

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h3>Nueva Ficha de Zona Análoga</h3>
          <span>Centro: ${centroidLat}°, ${centroidLon}° · ${
            shapeType === 'rectangle'
              ? 'Cuadro / Parcela'
              : shapeType === 'circle'
                ? 'Círculo'
                : `Polígono (${coords.length} vértices)`
          }</span>
        </div>
        <button id="btnCloseModal" class="icon-close-btn" title="Cerrar"><span class="css-ico ico-close"></span></button>
      </div>

      <div class="metrics-summary-box">
        <div class="metric-item">
          <span class="m-label">Superficie (Área)</span>
          <strong class="m-value">${metrics.areaKm2.toFixed(2)} km²</strong>
          <small>${metrics.areaHa.toFixed(1)} ha</small>
        </div>
        <div class="metric-item">
          <span class="m-label">Perímetro</span>
          <strong class="m-value">${metrics.perimeterKm.toFixed(2)} km</strong>
          <small>${Math.round(metrics.perimeterM).toLocaleString('es-ES')} m</small>
        </div>
        <div class="metric-item">
          <span class="m-label">Pico Más Alto</span>
          <strong class="m-value">${formatElevation(metrics.maxElevationM)}</strong>
          <small>Cota máxima</small>
        </div>
        <div class="metric-item">
          <span class="m-label">Punto Más Bajo</span>
          <strong class="m-value">${formatElevation(metrics.minElevationM)}</strong>
          <small>Fondo / Cuenca</small>
        </div>
        <div class="metric-item highlight">
          <span class="m-label">Profundidad / Desnivel</span>
          <strong class="m-value">${formatElevation(metrics.reliefDepthM)}</strong>
          <small>Diferencia vertical</small>
        </div>
        <div class="metric-item">
          <span class="m-label">Pendiente y Volumen</span>
          <strong class="m-value">${formatSlope(metrics.avgSlopePercent)}</strong>
          <small>${formatVolume(metrics.approxVolumeM3)}</small>
        </div>
      </div>
      <p class="metrics-source-note">${escapeHtml(metricsSourceNote(metrics))}</p>

      <form id="formNewMission" class="modal-form">
        <div class="form-row">
          <label for="missionName">Nombre de la Zona Terrestre *</label>
          <input id="missionName" type="text" required placeholder="Ej. Cuenca Salar de Pajonales - Sector A" />
        </div>

        <div class="form-row">
          <label>¿A qué astro es análogo este territorio? *</label>
          <div class="planet-selector">
            <label class="planet-option">
              <input type="radio" name="targetBody" value="mars" checked />
              <span class="planet-pill mars-pill"><span class="css-dot dot-mars"></span> Marte</span>
            </label>
            <label class="planet-option">
              <input type="radio" name="targetBody" value="moon" />
              <span class="planet-pill moon-pill"><span class="css-dot dot-moon"></span> Luna</span>
            </label>
          </div>
        </div>

        <div class="form-row">
          <label for="analogSiteName">Sitio de Marte o la Luna al que se parece *</label>
          <input
            id="analogSiteName"
            type="text"
            list="nasaTargetSites"
            required
            placeholder="Ej. Cráter Jezero, Shackleton, Valle Marineris..."
          />
          <datalist id="nasaTargetSites">
            <option value="Cráter Jezero (Marte)" />
            <option value="Valle Marineris (Marte)" />
            <option value="Cráter Gale · Monte Sharp (Marte)" />
            <option value="Utopia Planitia (Marte)" />
            <option value="Cráter Shackleton · Polo Sur (Luna)" />
            <option value="Macizo Malapert · Artemis III (Luna)" />
            <option value="Connecting Ridge · Polo Sur (Luna)" />
            <option value="Mare Tranquillitatis · Tubos de Lava (Luna)" />
          </datalist>
        </div>

        <div class="form-row">
          <label>Color de la zona en el mapa</label>
          <div class="color-palette-row" id="modalZoneColors">
            ${ZONE_PRESET_COLORS.map(
              (c, idx) =>
                `<button type="button" class="color-swatch-btn ${idx === 0 ? 'selected' : ''}" data-color="${c.hex}" title="${escapeHtml(c.name)}" style="background:${c.hex}"></button>`
            ).join('')}
            <label class="color-custom-picker" title="Elegir cualquier color personalizado">
              <input id="missionCustomColor" type="color" value="#f97316" />
              <span>Otro</span>
            </label>
          </div>
        </div>

        <div class="form-row">
          <label for="missionNotes">Notas Científicas / Justificación</label>
          <textarea
            id="missionNotes"
            rows="3"
            placeholder="Ej. Pendiente similar a las paredes del cráter, aridez extrema, afloramientos basálticos para prueba de rovers..."
          ></textarea>
        </div>

        <div class="modal-actions">
          <button type="button" id="btnCancelModal" class="btn-secondary-modal">Descartar</button>
          <button type="submit" class="btn-primary-modal"><span class="css-ico ico-check"></span> Guardar Zona en Catálogo</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    container.classList.add('hidden');
    container.innerHTML = '';
  };

  container.querySelector('#btnCloseModal')!.addEventListener('click', closeModal);
  container.querySelector('#btnCancelModal')!.addEventListener('click', closeModal);

  let selectedColor = '#f97316';
  let userPickedColor = false;
  const colorPaletteEl = container.querySelector('#modalZoneColors')!;
  const customColorInput = container.querySelector('#missionCustomColor') as HTMLInputElement;

  const setZoneColorUI = (hex: string) => {
    selectedColor = hex.toLowerCase();
    customColorInput.value = selectedColor;
    colorPaletteEl.querySelectorAll<HTMLElement>('.color-swatch-btn').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.color?.toLowerCase() === selectedColor);
    });
  };

  colorPaletteEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.color-swatch-btn');
    if (!btn?.dataset.color) return;
    userPickedColor = true;
    setZoneColorUI(btn.dataset.color);
  });

  customColorInput.addEventListener('input', () => {
    userPickedColor = true;
    setZoneColorUI(customColorInput.value);
  });

  const form = container.querySelector('#formNewMission') as HTMLFormElement;
  form.querySelectorAll('input[name="targetBody"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (userPickedColor) return;
      const val = (form.querySelector('input[name="targetBody"]:checked') as HTMLInputElement)?.value;
      setZoneColorUI(val === 'moon' ? '#38bdf8' : '#f97316');
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (form.querySelector('#missionName') as HTMLInputElement).value.trim();
    const bodyRadio = form.querySelector('input[name="targetBody"]:checked') as HTMLInputElement;
    const targetBody: TargetBody = bodyRadio?.value === 'moon' ? 'moon' : 'mars';
    const analogSiteName = (form.querySelector('#analogSiteName') as HTMLInputElement).value.trim();
    const notes = (form.querySelector('#missionNotes') as HTMLTextAreaElement).value.trim();

    const newMission: MissionZone = {
      id: `mision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || 'Zona Sin Nombre',
      targetBody,
      analogSiteName: analogSiteName || 'Sitio Espacial',
      notes,
      shapeType,
      color: selectedColor,
      coordinates: coords,
      metrics,
      createdAt: new Date().toISOString(),
    };

    closeModal();
    onSave(newMission);
  });
}

export function abrirModalMedirPin(
  container: HTMLElement,
  pinName: string,
  lat: number,
  lon: number,
  defaultPerimeterKm: number,
  onConfirm: (shape: 'rectangle' | 'circle', perimeterKm: number) => void
): void {
  const safeDefault = Number.isFinite(defaultPerimeterKm) && defaultPerimeterKm > 0 ? defaultPerimeterKm : 16;
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="modal-card modal-card-compact">
      <div class="modal-header">
        <div>
          <h3>Medir zona en "${escapeHtml(pinName)}"</h3>
          <span>${lat.toFixed(5)}°, ${lon.toFixed(5)}°</span>
        </div>
        <button id="btnCloseMeasurePinModal" class="icon-close-btn" title="Cerrar"><span class="css-ico ico-close"></span></button>
      </div>

      <form id="formMeasurePin" class="modal-form">
        <div class="form-row">
          <label>Forma a dibujar</label>
          <div class="pin-shape-radios">
            <label class="planet-option">
              <input type="radio" name="measurePinShape" value="rectangle" checked />
              <span class="planet-pill"><span class="css-ico ico-square"></span> Cuadrado</span>
            </label>
            <label class="planet-option">
              <input type="radio" name="measurePinShape" value="circle" />
              <span class="planet-pill"><span class="css-ico ico-circle"></span> Círculo</span>
            </label>
          </div>
        </div>

        <div class="form-row">
          <label for="measurePinPerimeter">Perímetro deseado (km)</label>
          <input id="measurePinPerimeter" type="number" min="0.2" max="2000" step="0.5" value="${safeDefault}" required />
          <small id="measurePinHint" class="metrics-source-note"></small>
        </div>

        <div class="modal-actions">
          <button type="button" id="btnCancelMeasurePinModal" class="btn-secondary-modal">Cancelar</button>
          <button type="submit" class="btn-primary-modal"><span class="css-ico ico-measure"></span> Trazar y Medir</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    container.classList.add('hidden');
    container.innerHTML = '';
  };

  container.querySelector('#btnCloseMeasurePinModal')!.addEventListener('click', closeModal);
  container.querySelector('#btnCancelMeasurePinModal')!.addEventListener('click', closeModal);

  const perimeterEl = container.querySelector('#measurePinPerimeter') as HTMLInputElement;
  const hintEl = container.querySelector('#measurePinHint') as HTMLElement;

  const updateHint = () => {
    const p = parseFloat(perimeterEl.value);
    const shape = (container.querySelector('input[name="measurePinShape"]:checked') as HTMLInputElement)?.value;
    if (!Number.isFinite(p) || p <= 0) {
      hintEl.textContent = 'Ingresa un perímetro válido (> 0 km)';
      return;
    }
    if (shape === 'circle') {
      const r = p / (2 * Math.PI);
      hintEl.textContent = `Radio: ${r.toFixed(2)} km · Diámetro: ${(r * 2).toFixed(2)} km`;
    } else {
      const side = p / 4;
      hintEl.textContent = `Lado: ${side.toFixed(2)} km (${side.toFixed(2)}×${side.toFixed(2)} km)`;
    }
  };
  updateHint();
  perimeterEl.addEventListener('input', updateHint);
  container.querySelectorAll('input[name="measurePinShape"]').forEach((el) => {
    el.addEventListener('change', updateHint);
  });

  container.querySelector('#formMeasurePin')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseFloat(perimeterEl.value);
    if (!Number.isFinite(p) || p <= 0) return;
    const shape =
      (container.querySelector('input[name="measurePinShape"]:checked') as HTMLInputElement)?.value ===
      'circle'
        ? 'circle'
        : 'rectangle';
    closeModal();
    onConfirm(shape, p);
  });
}

export function abrirModalToken(
  container: HTMLElement,
  currentToken: string,
  onSave: (token: string) => Promise<void>
): void {
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h3><span class="css-ico ico-key"></span> Configurar Token de Cesium ion</h3>
          <span>Activa el relieve mundial de Cesium World Terrain</span>
        </div>
        <button id="btnCloseTokenModal" class="icon-close-btn" title="Cerrar"><span class="css-ico ico-close"></span></button>
      </div>

      <form id="formIonToken" class="modal-form">
        <p class="token-help">
          La aplicación funciona sin token: el globo queda liso y el relieve de las zonas sale como
          "sin dato". Si hay un terreno local en <code>/terreno</code>, se usa ese primero.
          Con un token gratuito de
          <a href="https://cesium.com/ion/tokens" target="_blank" rel="noopener">cesium.com/ion/tokens</a>
          se activa Cesium World Terrain (cuenta Community: uso personal y no comercial).
        </p>
        <div class="form-row">
          <label for="ionTokenInput">Access Token de Cesium ion</label>
          <input
            id="ionTokenInput"
            type="text"
            autocomplete="off"
            value="${escapeHtml(currentToken)}"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          />
        </div>

        <div class="modal-actions">
          <button type="button" id="btnCancelTokenModal" class="btn-secondary-modal">Cerrar</button>
          <button type="submit" class="btn-primary-modal">Aplicar y Activar Relieve 3D</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    container.classList.add('hidden');
    container.innerHTML = '';
  };

  container.querySelector('#btnCloseTokenModal')!.addEventListener('click', closeModal);
  container.querySelector('#btnCancelTokenModal')!.addEventListener('click', closeModal);

  const form = container.querySelector('#formIonToken') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tokenVal = (form.querySelector('#ionTokenInput') as HTMLInputElement).value.trim();
    await onSave(tokenVal);
    closeModal();
  });
}
