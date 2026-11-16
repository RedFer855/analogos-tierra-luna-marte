# Visor 3D CesiumJS · Mapa de la Tierra y Análogos Planetarios
> **NASA Space Apps Challenge 2026**  
> **Reto:** *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*  
> **Equipo:** J4Ks (Tegucigalpa)  
> **Proyecto:** ARES-TWIN

---

## 🚀 ¿Cómo Ejecutar el Proyecto? (En 1 Clic)

Tienes dos formas sencillas de correr el proyecto una vez descomprimido el archivo `.zip`:

### Opción 1: Ejecución Inmediata (Recomendada - Sin Descargar Librerías)
Este paquete ya incluye la versión lista para producción en la carpeta `/dist`. No necesitas esperar a que se descarguen librerías pesadas.

* **En Windows:**  
  Haz doble clic en:  
  📁 **`1-EJECUTAR-VISOR-DIRECTO.bat`**  
  *(Se abrirá tu navegador automáticamente en `http://localhost:5173`)*.

* **En macOS o Linux:**  
  Abre una terminal en esta carpeta y ejecuta:
  ```bash
  chmod +x ejecutar.sh
  ./ejecutar.sh
  ```

---

### Opción 2: Modo Desarrollo (Para Modificar o Agregar Código)
Si quieres editar el código fuente TypeScript o estilos CSS con recarga en vivo (*hot-reload*):

* **En Windows:**  
  Haz doble clic en:  
  📁 **`2-MODO-DESARROLLO.bat`**  
  *(Instalará las dependencias automáticamente si es la primera vez y abrirá Vite)*.

* **Por Consola / Terminal (Cualquier Sistema Operativo):**
  ```bash
  # 1. Instalar dependencias
  npm install

  # 2. Iniciar servidor de desarrollo
  npm run dev
  ```
  Abre tu navegador en: `http://localhost:5173`

---

## 🌍 ¿Qué Hace Este Visor 3D?

1. **Globo 3D de la Tierra en Alta Resolución:**
   - Imagen base: Sentinel-2 cloudless de EOX, 2025 por defecto (CC BY-NC-SA 4.0, no comercial) o 2016 con `?imagen=2016` (CC BY 4.0), con respaldo en NASA GIBS y NaturalEarthII sin internet. Esri World Imagery se quitó porque exige clave (ver `CAMBIOS-2026-11-10.md`).
   - Respaldo integrado sin conexión con texturas NaturalEarthII.
   - Compatibilidad completa con Cesium Ion para activar relieve montañoso 3D de la Tierra (World Terrain).

2. **Herramientas Interactivas de Dibujo Geográfico:**
   - **Polígonos Libres:** Dibuja áreas complejas delimitando zonas de estudio punto a punto.
   - **Rectángulos y Cuadros:** Arrastra y suelta para definir cuadrículas de análisis.
   - **Triángulos de Muestreo:** Dibuja transectos triangulares para estudios de campo.
   - **Pines y Waypoints:** Marca coordenadas exactas para campamentos, puntos de muestreo o aterrizaje.

3. **Motor de Análisis Topográfico 3D en Tiempo Real:**
   - Cálculo instantáneo de **Área** ($m^2$, Hectáreas, $km^2$).
   - **Perímetro total** en metros y kilómetros.
   - **Elevación Máxima, Mínima y Desnivel** (Relieve vertical).
   - Estimación de **Volumen aproximado de relieve**.
   - Estimación de **Pendiente media** y **Rugosidad del terreno**.

4. **Catálogo de Misiones y Análogos Integrado:**
   - Sin zonas de ejemplo: las demos inventadas se quitaron para no confundirlas con resultados.
   - Clasificación por cuerpo celeste objetivo: **Tierra**, **Luna** y **Marte**.
   - Persistencia local automática en el navegador (no se pierden tus zonas al recargar la página).

5. **Exportación e Importación GIS (GeoJSON):**
   - Exporta con un solo clic todas tus zonas y pines a formato estándar `.geojson` para abrirlos en **QGIS**, **ArcGIS** o **Google Earth**.
   - Importa archivos GeoJSON de misiones anteriores directamente al mapa.

6. **Configuración de Token Cesium Ion (Opcional):**
   - Puedes ingresar tu token de Cesium Ion directamente desde la interfaz del visor o agregarlo en el archivo `.env` (`VITE_CESIUM_ION_TOKEN=tu_token`).
   - El token activa el Geocodificador global (búsqueda de lugares por nombre) y el relieve 3D de Cesium World Terrain.

---

## 📂 Estructura de Archivos

```
CesiumJS-Mapa-Tierra-Equipo/
│
├── 1-EJECUTAR-VISOR-DIRECTO.bat   # Lanzador directo 1-clic (sin dependencias)
├── 2-MODO-DESARROLLO.bat          # Lanzador modo desarrollo (Vite + TypeScript)
├── 3-RECONSTRUIR-PROYECTO.bat     # Recompila cambios a la carpeta dist/
├── ejecutar.sh                    # Script lanzador para macOS y Linux
├── servidor-local.cjs              # Servidor HTTP nativo en Node.js
│
├── dist/                          # Build de producción compilado y listo para usar
│   ├── index.html
│   ├── assets/                    # JavaScript y CSS empaquetados
│   └── cesiumStatic/              # Assets, Shaders, Web Workers de CesiumJS
│
├── src/                           # Código fuente TypeScript
│   ├── analysis/                  # Análisis matemático de relieve y terreno
│   │   └── terrainAnalysis.ts
│   ├── map/                       # Inicialización del globo 3D y capas satelitales
│   │   └── viewer.ts
│   ├── missions/                  # Gestor del catálogo de zonas y waypoints
│   │   └── missionManager.ts
│   ├── tools/                     # Herramientas interactivas de dibujo
│   │   └── drawer.ts
│   ├── types/                     # Definiciones de tipos TypeScript
│   │   └── mission.ts
│   ├── ui/                        # Interfaz gráfica de usuario moderna
│   │   └── appUi.ts
│   ├── main.ts                    # Punto de entrada de la aplicación
│   └── style.css                  # Estilos glassmorphism y paleta espacial
│
├── index.html                     # HTML principal
├── package.json                   # Dependencias (Cesium, Vite, TypeScript)
├── package-lock.json              # Bloqueo de versiones
├── tsconfig.json                  # Configuración del compilador TypeScript
├── vite.config.ts                 # Configuración de Vite y copia estática de Cesium
├── .env.example                   # Plantilla de variables de entorno
├── .env                           # Variables de entorno locales
├── FLUJO_Y_ARQUITECTURA_TECNICA.md# Arquitectura completa del pipeline satelital
└── PROMPT_PARA_EL_EQUIPO.md       # Mensaje/Prompt listo para copiar a tu equipo
```

---

## 🛠️ Requisitos del Sistema

* **Navegador Web:** Google Chrome, Microsoft Edge, Brave, Firefox u Opera (con aceleración por hardware WebGL habilitada).
* **Entorno de Ejecución:**
  * Para la opción 1 (Lanzador directo): Tener instalado **Node.js** (v18+) o **Python** (3.8+).
  * Para la opción 2 (Desarrollo): Tener instalado **Node.js** (v18+) y **npm**.

---

## 👨‍🚀 Créditos
* **Equipo J4Ks** · Tegucigalpa, Honduras.
* **NASA Space Apps Challenge 2026**.
