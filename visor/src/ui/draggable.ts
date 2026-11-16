import {
  computeDockBounds,
  detectDockZone,
  DOCK_BOTTOM_GAP,
  DOCK_EDGE_GAP,
  type DockZone,
} from './dockLayout';

const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, label, .no-drag, .mission-card, .filter-tab, .main-tab, .layer-pill, .sublayer-btn';

const LAYOUT_STORAGE_KEY = 'visor.panelLayout.v1';

export interface DraggableOptions {
  /** Si es true, conserva la altura actual al soltar el anclaje `bottom`. */
  preserveHeight?: boolean;
  /** Identificador único para persistir posición y zona fijada en localStorage. */
  panelId?: string;
  /** Zona predeterminada inicial cuando no hay estado guardado. */
  defaultDock?: DockZone;
  /** Ancho preferido (en px) al fijar la tarjeta en la zona izquierda o derecha. */
  dockWidth?: number;
  /** Devuelve true si el panel está oculto/colapsado y no debe reservar espacio lateral. */
  isHidden?: () => boolean;
}

interface SavedPanelState {
  dock: DockZone | null;
  left?: number;
  top?: number;
}

interface PanelEntry {
  el: HTMLElement;
  options: DraggableOptions;
  dock: DockZone | null;
}

const registry: PanelEntry[] = [];
let dropPreviewEl: HTMLElement | null = null;
let resizeBound = false;
let isRefreshingDock = false;

function setClassState(el: HTMLElement, className: string, active: boolean): void {
  if (active) {
    if (!el.classList.contains(className)) el.classList.add(className);
  } else if (el.classList.contains(className)) {
    el.classList.remove(className);
  }
}

function readSavedLayout(): Record<string, SavedPanelState> {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SavedPanelState>) : {};
  } catch {
    return {};
  }
}

function savePanelState(panelId: string | undefined, state: SavedPanelState): void {
  if (!panelId) return;
  try {
    const all = readSavedLayout();
    all[panelId] = state;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignorar errores de almacenamiento (modo privado / cuota)
  }
}

function isPanelHidden(entry: PanelEntry): boolean {
  if (entry.options.isHidden?.()) return true;
  const cl = entry.el.classList;
  return cl.contains('hidden') || cl.contains('collapsed') || cl.contains('minimized');
}

function getDockWidth(entry: PanelEntry): number {
  if (entry.options.dockWidth) return entry.options.dockWidth;
  const measured = entry.el.getBoundingClientRect().width;
  return measured > 80 ? Math.round(measured) : 320;
}

function clearDockStyles(el: HTMLElement): void {
  el.classList.remove('is-docked', 'is-docked-left', 'is-docked-right', 'is-docked-top', 'is-docked-bottom');
  el.style.marginLeft = '';
  el.style.marginRight = '';
  el.style.maxWidth = '';
  el.style.maxHeight = '';
  el.style.width = '';
}

function applyFloatingPosition(el: HTMLElement, left: number, top: number): void {
  const maxLeft = Math.max(0, window.innerWidth - Math.min(el.offsetWidth || 240, 140));
  const maxTop = Math.max(0, window.innerHeight - 48);
  el.style.position = 'fixed';
  el.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
  el.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';
}

function getDropPreviewEl(): HTMLElement {
  if (dropPreviewEl && document.body.contains(dropPreviewEl)) return dropPreviewEl;
  const el = document.createElement('div');
  el.className = 'dock-drop-preview hidden';
  el.innerHTML = '<span class="dock-drop-label"></span>';
  document.body.appendChild(el);
  dropPreviewEl = el;
  return el;
}

function updateDropPreview(zone: DockZone | null, draggingEntry: PanelEntry): void {
  const preview = getDropPreviewEl();
  if (!zone) {
    preview.classList.add('hidden');
    return;
  }

  const leftEntry = registry.find(
    (e) => e !== draggingEntry && e.dock === 'left' && !isPanelHidden(e)
  );
  const rightEntry = registry.find(
    (e) => e !== draggingEntry && e.dock === 'right' && !isPanelHidden(e)
  );
  const bounds = computeDockBounds({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    leftPanelWidth: leftEntry ? getDockWidth(leftEntry) : 0,
    rightPanelWidth: rightEntry ? getDockWidth(rightEntry) : 0,
  });

  const labelEl = preview.querySelector('.dock-drop-label');
  preview.classList.remove('hidden');

  if (zone === 'left') {
    const w = getDockWidth(draggingEntry);
    preview.style.left = `${DOCK_EDGE_GAP}px`;
    preview.style.top = `${DOCK_EDGE_GAP}px`;
    preview.style.right = 'auto';
    preview.style.bottom = `${DOCK_EDGE_GAP}px`;
    preview.style.width = `${w}px`;
    preview.style.height = 'auto';
    if (labelEl) labelEl.textContent = 'Fijar a la izquierda';
  } else if (zone === 'right') {
    const w = getDockWidth(draggingEntry);
    preview.style.left = 'auto';
    preview.style.top = `${DOCK_EDGE_GAP}px`;
    preview.style.right = `${DOCK_EDGE_GAP}px`;
    preview.style.bottom = `${DOCK_EDGE_GAP}px`;
    preview.style.width = `${w}px`;
    preview.style.height = 'auto';
    if (labelEl) labelEl.textContent = 'Fijar a la derecha';
  } else if (zone === 'top') {
    const h = Math.min(130, Math.max(54, draggingEntry.el.getBoundingClientRect().height));
    preview.style.left = `${bounds.leftReserved}px`;
    preview.style.right = `${bounds.rightReserved}px`;
    preview.style.top = `${DOCK_EDGE_GAP}px`;
    preview.style.bottom = 'auto';
    preview.style.width = 'auto';
    preview.style.height = `${h}px`;
    if (labelEl) labelEl.textContent = 'Fijar arriba (entre laterales)';
  } else {
    const h = Math.min(130, Math.max(64, draggingEntry.el.getBoundingClientRect().height));
    preview.style.left = `${bounds.leftReserved}px`;
    preview.style.right = `${bounds.rightReserved}px`;
    preview.style.top = 'auto';
    preview.style.bottom = `${DOCK_BOTTOM_GAP}px`;
    preview.style.width = 'auto';
    preview.style.height = `${h}px`;
    if (labelEl) labelEl.textContent = 'Fijar abajo (entre laterales)';
  }
}

/**
 * Recalcula las dimensiones y posición de todas las tarjetas fijadas en zonas predeterminadas.
 * La zona inferior se ajusta automáticamente entre la tarjeta izquierda y la derecha visibles.
 */
export function refreshDockLayout(): void {
  if (isRefreshingDock) return;
  isRefreshingDock = true;
  try {
    const leftEntry = registry.find((e) => e.dock === 'left' && !isPanelHidden(e));
    const rightEntry = registry.find((e) => e.dock === 'right' && !isPanelHidden(e));

    const bounds = computeDockBounds({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      leftPanelWidth: leftEntry ? getDockWidth(leftEntry) : 0,
      rightPanelWidth: rightEntry ? getDockWidth(rightEntry) : 0,
    });

    for (const entry of registry) {
      if (!entry.dock) continue;
      const el = entry.el;
      const isFolded = el.classList.contains('plegado');

      setClassState(el, 'is-docked', true);
      setClassState(el, 'is-docked-left', entry.dock === 'left');
      setClassState(el, 'is-docked-right', entry.dock === 'right');
      setClassState(el, 'is-docked-top', entry.dock === 'top');
      setClassState(el, 'is-docked-bottom', entry.dock === 'bottom');

    el.style.position = 'fixed';
    el.style.transform = 'none';

    if (entry.dock === 'left') {
      el.style.left = `${bounds.edgeGap}px`;
      el.style.right = 'auto';
      el.style.top = `${bounds.edgeGap}px`;
      el.style.bottom = isFolded ? 'auto' : `${bounds.edgeGap}px`;
      el.style.width = `${getDockWidth(entry)}px`;
      el.style.maxWidth = '';
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.marginLeft = '';
      el.style.marginRight = '';
    } else if (entry.dock === 'right') {
      el.style.right = `${bounds.edgeGap}px`;
      el.style.left = 'auto';
      el.style.top = '56px';
      el.style.bottom = isFolded ? 'auto' : `${bounds.edgeGap}px`;
      el.style.width = `${getDockWidth(entry)}px`;
      el.style.maxWidth = '';
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.marginLeft = '';
      el.style.marginRight = '';
    } else if (entry.dock === 'top') {
      el.style.top = `${bounds.edgeGap}px`;
      el.style.bottom = 'auto';
      el.style.left = `${bounds.leftReserved}px`;
      el.style.right = `${bounds.rightReserved}px`;
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
      el.style.width = 'auto';
      el.style.maxWidth = `${bounds.bottomMaxWidth}px`;
      el.style.height = 'auto';
      el.style.maxHeight = '36vh';
    } else {
      el.style.top = 'auto';
      el.style.bottom = `${bounds.bottomGap}px`;
      el.style.left = `${bounds.leftReserved}px`;
      el.style.right = `${bounds.rightReserved}px`;
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
      el.style.width = 'auto';
      el.style.maxWidth = `${bounds.bottomMaxWidth}px`;
      el.style.height = 'auto';
      el.style.maxHeight = '42vh';
    }
  }
  } finally {
    isRefreshingDock = false;
  }
}

function dockPanel(entry: PanelEntry, zone: DockZone): void {
  for (const other of registry) {
    if (other !== entry && other.dock === zone) {
      other.dock = null;
      clearDockStyles(other.el);
      const offset = 48 + registry.indexOf(other) * 18;
      applyFloatingPosition(other.el, offset, offset);
      savePanelState(other.options.panelId, { dock: null, left: offset, top: offset });
    }
  }
  entry.dock = zone;
  savePanelState(entry.options.panelId, { dock: zone });
  refreshDockLayout();
}

/**
 * Permite arrastrar un panel completo desde su cabecera, asa de arrastre o cualquier espacio
 * libre del panel, y fijarlo al soltar en las zonas predeterminadas (izquierda, derecha, abajo).
 */
export function makePanelDraggable(
  panelEl: HTMLElement,
  _handle?: string | HTMLElement,
  options: DraggableOptions = {}
): void {
  const entry: PanelEntry = {
    el: panelEl,
    options,
    dock: null,
  };

  const saved = options.panelId ? readSavedLayout()[options.panelId] : undefined;
  if (saved) {
    if (saved.dock === 'left' || saved.dock === 'right' || saved.dock === 'top' || saved.dock === 'bottom') {
      entry.dock = saved.dock;
    } else if (typeof saved.left === 'number' && typeof saved.top === 'number') {
      applyFloatingPosition(panelEl, saved.left, saved.top);
    }
  } else if (options.defaultDock) {
    entry.dock = options.defaultDock;
  }

  registry.push(entry);

  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', () => refreshDockLayout());
  }

  let lastHidden = isPanelHidden(entry);
  let lastFolded = panelEl.classList.contains('plegado');
  const observer = new MutationObserver(() => {
    if (isRefreshingDock) return;
    const nowHidden = isPanelHidden(entry);
    const nowFolded = panelEl.classList.contains('plegado');
    if (nowHidden !== lastHidden || nowFolded !== lastFolded) {
      lastHidden = nowHidden;
      lastFolded = nowFolded;
      refreshDockLayout();
    }
  });
  observer.observe(panelEl, { attributes: true, attributeFilter: ['class'] });

  refreshDockLayout();

  let dragging = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  let pendingZone: DockZone | null = null;

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxLeft = Math.max(0, window.innerWidth - Math.min(panelEl.offsetWidth, 100));
    const maxTop = Math.max(0, window.innerHeight - 44);
    const nextLeft = Math.max(0, Math.min(maxLeft, origLeft + dx));
    const nextTop = Math.max(0, Math.min(maxTop, origTop + dy));
    panelEl.style.left = `${nextLeft}px`;
    panelEl.style.top = `${nextTop}px`;

    pendingZone = detectDockZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    updateDropPreview(pendingZone, entry);
  };

  const stopDrag = (e?: PointerEvent) => {
    if (!dragging) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;
    dragging = false;
    if (activePointerId !== null) {
      try {
        panelEl.releasePointerCapture(activePointerId);
      } catch {
        // Ignorar si el puntero ya fue liberado
      }
    }
    activePointerId = null;
    panelEl.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);

    updateDropPreview(null, entry);

    if (pendingZone) {
      const targetZone = pendingZone;
      pendingZone = null;
      dockPanel(entry, targetZone);
    } else {
      const rect = panelEl.getBoundingClientRect();
      savePanelState(options.panelId, {
        dock: null,
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      });
    }
  };

  panelEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Si hizo clic en el asa explícita (.drag-handle), siempre permitir arrastrar
    const isExplicitHandle = Boolean(target.closest('.drag-handle'));
    if (!isExplicitHandle && target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const rect = panelEl.getBoundingClientRect();
    const wasDocked = entry.dock !== null;
    if (wasDocked) {
      entry.dock = null;
      clearDockStyles(panelEl);
      refreshDockLayout();
      if (options.preserveHeight) {
        const floatingHeight = Math.min(rect.height, Math.max(360, window.innerHeight - 160));
        panelEl.style.height = `${floatingHeight}px`;
      } else {
        panelEl.style.height = '';
      }
    } else if (options.preserveHeight && !panelEl.style.height) {
      panelEl.style.height = `${rect.height}px`;
    }

    panelEl.style.position = 'fixed';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    panelEl.style.transform = 'none';

    const naturalRect = panelEl.getBoundingClientRect();
    let initialLeft = rect.left;
    if (e.clientX > initialLeft + naturalRect.width) {
      initialLeft = Math.max(0, e.clientX - naturalRect.width / 2);
    }
    panelEl.style.left = `${initialLeft}px`;
    panelEl.style.top = `${rect.top}px`;

    dragging = true;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = initialLeft;
    origTop = rect.top;
    pendingZone = null;
    panelEl.classList.add('is-dragging');

    try {
      panelEl.setPointerCapture(e.pointerId);
    } catch {
      // Fallback a listeners globales en window
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  });
}
