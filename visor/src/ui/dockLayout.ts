export type DockZone = 'left' | 'right' | 'top' | 'bottom';

export const DOCK_EDGE_GAP = 12;
export const DOCK_BOTTOM_GAP = 22;
export const DOCK_PANEL_GAP = 12;
export const SNAP_THRESHOLD_X = 72;
export const SNAP_THRESHOLD_Y = 84;

export interface DockBoundsInput {
  viewportWidth: number;
  viewportHeight: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
}

export interface DockBounds {
  edgeGap: number;
  bottomGap: number;
  leftReserved: number;
  rightReserved: number;
  bottomMaxWidth: number;
}

/**
 * Detecta si el puntero está sobre una zona de anclaje predeterminada.
 * Prioriza los bordes laterales (izquierda/derecha) sobre el borde inferior.
 */
export function detectDockZone(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number
): DockZone | null {
  if (clientX <= SNAP_THRESHOLD_X) return 'left';
  if (clientX >= viewportWidth - SNAP_THRESHOLD_X) return 'right';
  if (clientY <= SNAP_THRESHOLD_Y) return 'top';
  if (clientY >= viewportHeight - SNAP_THRESHOLD_Y) return 'bottom';
  return null;
}

/**
 * Calcula los márgenes reservados y el ancho disponible para la zona inferior
 * entre las zonas laterales izquierda y derecha.
 */
export function computeDockBounds(input: DockBoundsInput): DockBounds {
  const leftReserved =
    input.leftPanelWidth > 0
      ? DOCK_EDGE_GAP + input.leftPanelWidth + DOCK_PANEL_GAP
      : DOCK_EDGE_GAP;

  const rightReserved =
    input.rightPanelWidth > 0
      ? DOCK_EDGE_GAP + input.rightPanelWidth + DOCK_PANEL_GAP
      : DOCK_EDGE_GAP;

  const bottomMaxWidth = Math.max(240, input.viewportWidth - leftReserved - rightReserved);

  return {
    edgeGap: DOCK_EDGE_GAP,
    bottomGap: DOCK_BOTTOM_GAP,
    leftReserved,
    rightReserved,
    bottomMaxWidth,
  };
}
