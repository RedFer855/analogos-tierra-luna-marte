import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { createCesiumViewer } from './map/viewer';
import { MissionManager } from './missions/missionManager';
import { AppUI } from './ui/appUi';
import { CapaMotor } from './motor/capaMotor';
import { PanelMotor } from './motor/panelMotor';
import { AreaDibujo } from './motor/areaDibujo';

async function bootstrap(): Promise<void> {
  const uiRoot = document.getElementById('uiRoot');
  if (!uiRoot) {
    throw new Error('No se encontró el contenedor #uiRoot');
  }

  const { viewer, terrain, imagery } = await createCesiumViewer('cesiumContainer');
  const missionManager = new MissionManager(viewer);
  const appUi = new AppUI(uiRoot, viewer, missionManager, terrain, imagery);
  // Ensayo (ADR-005): panel del motor; si el puente local está apagado, solo avisa.
  const capaMotor = new CapaMotor(viewer);
  const dibujo = new AreaDibujo(viewer, uiRoot);
  capaMotor.bloqueada = () => dibujo.dibujando;
  const panelMotor = new PanelMotor(uiRoot, capaMotor, dibujo);
  appUi.onZonaSeleccionada = (zona) => panelMotor.setZonaMapa(zona);

  // Solo con ?debug: deja el visor a mano en la consola para medir y probar (R11).
  if (new URLSearchParams(window.location.search).has('debug')) {
    (window as unknown as { __visor: unknown }).__visor = { viewer, missionManager, terrain, imagery, capaMotor };
  }
}

bootstrap().catch((err) => {
  console.error('Error al inicializar el Visor 3D de Análogos:', err);
});
