// Pruebas unitarias de zonas de anclaje predeterminadas (src/ui/dockLayout.ts).
import assert from 'node:assert/strict';
import { computeDockBounds, detectDockZone } from '../src/ui/dockLayout';

function probar(nombre: string, fn: () => void): void {
  fn();
  console.log(`OK    ${nombre}`);
}

probar('detecta zona izquierda cerca del borde izquierdo', () => {
  assert.equal(detectDockZone(20, 400, 1440, 900), 'left');
  assert.equal(detectDockZone(72, 890, 1440, 900), 'left');
});

probar('detecta zona derecha cerca del borde derecho', () => {
  assert.equal(detectDockZone(1420, 400, 1440, 900), 'right');
  assert.equal(detectDockZone(1368, 890, 1440, 900), 'right');
});

probar('detecta zona superior en el borde de arriba entre laterales', () => {
  assert.equal(detectDockZone(720, 30, 1440, 900), 'top');
  assert.equal(detectDockZone(720, 84, 1440, 900), 'top');
});

probar('detecta zona inferior en el borde de abajo entre laterales', () => {
  assert.equal(detectDockZone(720, 860, 1440, 900), 'bottom');
  assert.equal(detectDockZone(720, 816, 1440, 900), 'bottom');
});

probar('devuelve null en el centro para dejar la tarjeta flotante', () => {
  assert.equal(detectDockZone(500, 400, 1440, 900), null);
});

probar('calcula márgenes de la zona inferior entre izquierda y derecha', () => {
  const b = computeDockBounds({
    viewportWidth: 1440,
    viewportHeight: 900,
    leftPanelWidth: 300,
    rightPanelWidth: 396,
  });
  assert.equal(b.leftReserved, 324);
  assert.equal(b.rightReserved, 420);
  assert.equal(b.bottomMaxWidth, 696);
});

probar('libera espacio inferior si un panel lateral está oculto o sin fijar', () => {
  const b = computeDockBounds({
    viewportWidth: 1440,
    viewportHeight: 900,
    leftPanelWidth: 0,
    rightPanelWidth: 396,
  });
  assert.equal(b.leftReserved, 12);
  assert.equal(b.rightReserved, 420);
  assert.equal(b.bottomMaxWidth, 1008);
});

console.log('\nTodas las verificaciones de zonas de anclaje pasaron.');
