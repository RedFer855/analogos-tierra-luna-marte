# Análogos Tierra · Luna · Marte — NASA Space Apps 2026

**Reto:** *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars* (NASA Space Apps Challenge 2026).
**Equipo:** J4Ks — Tegucigalpa, Honduras.
**Evento:** 14 y 15 de noviembre de 2026.

Busca en la Tierra los lugares que se parecen a los sitios donde NASA planea una base permanente en la Luna y a los sitios de Marte, comparando **varias variables físicas a la vez** (relieve, pendiente, rugosidad, temperatura, inercia térmica, mineralogía, permafrost, hielo, viento, polvo, agua) y diciendo **en qué coincide y en qué difiere** cada candidato, no solo un número de parecido.

Todo el cálculo corre en la PC del que evalúa. El demo no necesita internet, ni cuenta, ni instalar nada.

---

## 1. Qué hace el proyecto

1. **Ingesta offline.** Los GeoTIFF/NetCDF/HDF del PDS de NASA, de Copernicus y de SoilGrids (decenas de GB) se procesan una vez y se agregan a una tabla global de **58 700 374 celdas HEALPix de nivel 12** (~2,5 km² cada una) con 77 columnas. Esa tabla vive fuera del repositorio (23 GB) y se documenta aquí con su procedencia, no se distribuye.
2. **Motor de similitud en Rust.** Para cada celda calcula la distancia de Mahalanobis con zona de tolerancia y la convierte en una nota `S = exp(−γ·D²)`, además de una nota por variable. Devuelve los mejores candidatos agrupados por región y un `metrics.json` con contrato cerrado.
3. **Barrido de escenarios.** Repite la búsqueda con subconjuntos de variables, tolerancias, pesos y cortes de NDVI distintos, y reporta en qué fracción de escenarios aparece cada candidato (`robustez.json`): eso separa lo que aguanta de lo que es casualidad.
4. **Visor 3D.** Globo con CesiumJS, capas de cuevas, cráteres y sitios documentados, panel del motor, ficha por área con cada variable frente a su objetivo, medidor de confianza y explicación en lenguaje simple.
5. **Verificación.** El resultado del motor se contrasta fila a fila contra un oráculo independiente en NumPy, y la salida contra el contrato JSON (pruebas en `contrato/`).

### Lo que el jurado puede ver sin datos

El demo abre el globo 3D con la interfaz completa, las capas de cuevas y cráteres y la ficha de cada área **sin descargar un solo byte de datos crudos**: los artefactos precalculados son pequeños. El catálogo de los 43 análogos documentados y los 110 candidatos de los barridos, y la búsqueda en vivo (que recorre los 23 GB), aparecen cuando está corriendo el puente de la sección 2.2 — el chat con IA, además, necesita una clave propia y es opcional.

---

## 2. Instalación

### 2.1 Demo en una PC Windows — sin instalar nada

Requisitos: **Windows 10 u 11 y nada más**. No hace falta Node, ni Python, ni Rust, ni permisos de administrador, ni conexión a internet.

1. Descargá el ZIP del demo (o cloná el repo y entrá a `demo/`).
2. Descomprimí en cualquier carpeta.
3. Doble clic en **`ABRIR.bat`**. Se abre el navegador en `http://127.0.0.1:8123/`.
4. Para cerrar, cerrá la ventana negra.

Qué pasa por dentro: `ABRIR.bat` lanza `servidor.ps1`, un servidor de archivos estático de ~3 KB escrito en PowerShell (`TcpListener`, sin administrador, sin `netsh urlacl`) que sirve el sitio con los tipos MIME correctos (`application/wasm`, `.glb`, `.terrain`) y bloquea el acceso fuera de la carpeta. Se necesita un servidor porque **abrir `index.html` a doble clic no funciona**: el navegador en `file://` no ejecuta módulos ES ni permite cargar el `.wasm`, y Cesium no puede pedir sus teselas. El servidor de archivos es lo único que corre fuera del navegador; no calcula nada.

> Verificado en Windows 11: la página carga con `Content-Type: application/wasm`, el módulo WebAssembly compilado desde Rust se instancia en el navegador, y las rutas `../`, `..%2f` y `%2e%2e/` se rechazan.

### 2.2 El motor completo (búsqueda en vivo)

Requisitos: Node.js 24+, Rust 1.97+ (`cargo`), y la tabla maestra en disco (no está en el repo, ver §5).

```bash
# 1) Puente del motor (API local en 127.0.0.1:5174)
node herramientas/motor-puente/servidor.mjs

# 2) Visor en modo desarrollo (otra terminal)
cd visor && npm ci && npm run dev      # http://localhost:5173

# 3) El motor: pruebas y una corrida
cd motor && cargo test
cargo run -p pipeline --release -- --objetivo SL-12 --perfil terreno_termico --candidatos 200
```

El puente acepta solo orígenes locales (`localhost:5173`) y exige la cabecera `X-Motor-Puente` en las rutas que escriben, para que una web cualquiera no pueda lanzar búsquedas en la máquina de quien lo corre.

Rutas de datos (se pueden cambiar con variables de entorno):

| Variable | Por omisión |
| :-- | :-- |
| `ANALOGOS_RUN` | `D:/PP/ANALOGOS-run` (todo lo generado) |
| `ANALOGOS_MAESTRO` | `$ANALOGOS_RUN/etl/maestro` (la tabla de 23 GB) |
| `ANALOGOS_ANALOGOS` | `$ANALOGOS_RUN/etl/analogos/analogos.json` (objetivos, tolerancias, correlación) |

### 2.3 Reconstruir los datos

El ETL que produce la tabla maestra no forma parte de esta entrega: es el paso pesado (decenas de GB de rasters) y está documentado, no incluido. Lo que el repositorio sí trae es todo lo necesario para **reproducir el resultado a partir de la tabla**: manifiesto con versión, escala y `sha256` de cada columna, la lista de los productos de origen y el motor que los consume.

---

## 3. Qué corre en el navegador y qué no

Honestidad sobre el reparto, porque es la decisión técnica central del proyecto:

- **En el navegador:** el visor 3D, las capas, las fichas, el catálogo, los artefactos precalculados (`metrics.json`, `robustez.json`) y la re-puntuación de candidatos con pesos y tolerancias elegidos por el usuario.
- **Fuera del navegador:** el barrido global. Los 58,7 millones de celdas × 6 variables en `f32` son **1,41 GB por perfil**; con las variables obligatorias y el corte de NDVI quedan 12,26 millones de filas elegibles, todavía **294 MB**. Eso no se descarga en una demo: el recorrido completo se hace offline y el navegador recibe candidatos ya prefilrados.
- El puente local (`herramientas/motor-puente`) existe para eso: lanzar el binario nativo y devolver JSON al visor. El núcleo de puntaje (`motor/nucleo`) está escrito sin dependencias y **compila a `wasm32-unknown-unknown` en 1,4 s**, que es el camino para que esa parte deje de necesitar el puente. `motor/pipeline` no puede: `memmap2` en wasm32 es un stub que devuelve `Unsupported` y `rayon` cae a un solo hilo (verificado leyendo el código de ambos crates; `cargo check` pasa igual, el fallo aparece en ejecución).

---

## 4. Estructura del repositorio

```
motor/            Motor en Rust
  nucleo/           Puntaje puro: Mahalanobis con tolerancia, Gower, S = exp(−γ·D²),
                    nota por variable, Cholesky y Jacobi propios. Sin E/S, sin unsafe,
                    sin dependencias. Apto para wasm32.
  pipeline/         Binario nativo: mmap de la tabla, filtro, puntaje con rayon,
                    candidatos por región HEALPix y escritura del contrato.
  escenarios/       Escenarios de barrido y el índice de análogos ya documentados.
visor/            Visor CesiumJS + TypeScript + Vite (fuente)
herramientas/
  motor-puente/     API local (Node) que conecta el motor con el visor y con MCP
contrato/         Esquemas JSON y pruebas del contrato de salida
demo/             Sitio compilado que corre con ABRIR.bat (sin instalar nada)
```

---

## 5. Datos utilizados (nombre, producto, versión, URL y licencia)

Cada fuente abajo está citada con su producto exacto y su licencia verificada en la fuente oficial. La columna «Uso» dice para qué variable del vector entró.

### Tierra (los análogos)

| Recurso | Producto / versión | URL | Licencia | Uso |
| :-- | :-- | :-- | :-- | :-- |
| Copernicus DEM | GLO-90 y GLO-30, release 2024_1 | https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM · https://registry.opendata.aws/copernicus-dem/ | Copernicus DEM: libre uso con atribución (ESA, política de datos abiertos de Copernicus) | Relieve, pendiente, rugosidad |
| Copernicus DEM WBM | Máscara de agua en `AUXFILES/` de cada tesela | ídem | ídem | Máscara de agua |
| NASA POWER | `ALLSKY_SFC_SW_DWN` (1°) | https://power.larc.nasa.gov/docs/referencing/ | **No publica licencia**: se cita el servicio, versión y fecha de acceso | Radiación solar |
| Global-AI_PET | v3.1 (1 km, 2025-07-16), Zomer et al. 2022 | https://figshare.com/articles/dataset/Global_Aridity_Index_and_Potential_Evapotranspiration_ET0_Climate_Database_v2/7504448 | Campo de licencia: **CC BY 4.0**; la descripción dice «provided for non-commercial use» (se anota la restricción; uso del hackathon: sin fines de lucro) | Aridez, ET0 |
| SoilGrids 2.0 | Arcilla y limo, 250 m | https://www.isric.org/explore/soilgrids | **CC BY 4.0** | Fracción fina del suelo |
| JRC Global Surface Water | v1.5 (30 m, 1984–2024) | https://global-surface-water.appspot.com/download | Régimen abierto de Copernicus («free of charge, without restriction of use»); atribución «Source: EC JRC/Google», Pekel et al. 2016 | Agua, salares |
| GLWD | v2 (15″, ~500 m) | https://www.hydrosheds.org/products/glwd | **CC BY 4.0** | Humedales y clases de agua |
| GSDS30 / GSDP30 | 30 m, arena móvil y tipos de duna (Zenodo 10441041 y 13907012) | https://zenodo.org/api/records/10441041 · https://zenodo.org/api/records/13907012 | **CC BY 4.0** | Dunas y arena móvil |
| GLiM | v1.0, malla 0.5° y polígonos 1:3 750 000 | https://doi.pangaea.de/10.1594/PANGAEA.888600 | **CC-BY-3.0** | Litología |
| Obu et al. 2018 | Permafrost, 1 km, hemisferio norte | https://doi.pangaea.de/10.1594/PANGAEA.788537 | **CC-BY-3.0** | Permafrost |
| Karjalainen et al. 2022 | Contenido de hielo del suelo v1.1, 1 km (DOI 10.5281/zenodo.7009875) | https://doi.org/10.5281/zenodo.7009875 | **CC BY 4.0** | Hielo en el suelo |
| Pyroduct Digital Catalog | v3.0, 115 tubos de lava (DOI concepto 10.5281/zenodo.14535885) | https://zenodo.org/records/23456401 | **CC BY 4.0** | Subsuelo (tubos de lava) |
| MODIS (Terra/Aqua) | MOD11A1/MYD11C3 V061 (LST), MOD13Q1/MOD13C1 V061 (NDVI), MOD10A1/MOD10CM V061 (nieve), MCD19A2 V061 (aerosoles), AST_07XT/AST_05 V004 y ASTER GED AG1km V003 (emisividad) | https://ladsweb.modaps.eosdis.nasa.gov/ · https://lpdaac.usgs.gov/ | Datos abiertos de NASA EOSDIS: sin restricciones de uso, con atribución y agradecimiento al DAAC | Temperatura, NDVI, nieve, aerosoles, emisividad |
| MERRA-2 | M2T1NXSLV / M2T1NXFLX / M2T1NXAER (0,625° × 0,5°) | https://disc.gsfc.nasa.gov/ | Datos abiertos de NASA GES DISC: sin restricciones de uso, con atribución | Viento, número de Shields, polvo (`DUEXTTAU`) |
| EMIT | EMITL2BMIN V002 (60 m) y EMITL3ASA V002 (0,5°) | https://earthdata.nasa.gov/ | Datos abiertos de NASA (requiere cuenta Earthdata para descargar) | Mineralogía por clases |
| GRACE / SMAP | JPL Mascon CRI RL06.3; SPL4SMGP V008 y SPL3SMP V009 | https://grace.jpl.nasa.gov/ · https://smap.jpl.nasa.gov/ | Datos abiertos de NASA: sin restricciones de uso, con atribución | Agua subterránea, humedad del suelo |
| SRTM / NASADEM | SRTMGL1, NASADEM_HGT, SRTMGL30 | https://lpdaac.usgs.gov/ | Dominio público (NASA/USGS) | Relieve (alternativa) |

### Luna (los sitios objetivo)

| Recurso | Producto | URL | Licencia | Uso |
| :-- | :-- | :-- | :-- | :-- |
| LRO LOLA | GDR `LDEM_128`…`LDEM_1024` V3.0, SLDEM2015, `LDEM_80S_20M`, `LDEM_875S_5M`, iluminación y sombra permanente (Mazarico et al. 2011) | https://imbrium.mit.edu/DATA/LOLA_GDR/ · https://pgda.gsfc.nasa.gov/products/78 | Datos abiertos de NASA PDS | Relieve, pendiente, iluminación, PSR |
| LRO Diviner | GDR L2 (2009-07 a 2016-10), nivel 3 polar, Polar Resource Product V2.0, parámetro H de Hayne et al. 2017 | https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/ | Datos abiertos de NASA PDS | Temperatura, inercia térmica |
| LRO LROC | WAC GLD100 y mosaico global 643 nm; mosaico polar NAC | https://lroc.im-ldi.com/images/downloads | Datos abiertos de NASA PDS (sin co-registro entre imágenes NAC: solo para ver, no para medir) | Imagen y modelo |
| Chandrayaan-1 M3 | Nivel 2 (`CH1M3_0004`) | https://ode.rsl.wustl.edu/moon/ | Datos abiertos de NASA PDS | Mineralogía |
| LRO Mini-RF | Mosaico polar sur CPR (`LRO-L-MRFLRO-5-CDR-MOSAIC-V1.0`) | https://pds-geosciences.wustl.edu/lro/lro-l-mrflro-4-cdr-v1/ | Datos abiertos de NASA PDS | Proxy de rugosidad en ficha (excluido del vector de variables) |
| USGS — regiones Artemis III | «Down Selected Artemis III Candidate Landing Site Navigational Grids» (DOI 10.5066/P1MEQ6UK, 2024-12-05) | https://doi.org/10.5066/P1MEQ6UK | Dominio público EE. UU. (USGS) | Contornos de las 9 regiones candidatas |

### Marte (los sitios objetivo)

| Recurso | Producto | URL | Licencia | Uso |
| :-- | :-- | :-- | :-- | :-- |
| MGS MOLA | MEGDR 128 ppd; HRSC-MOLA blended DEM v2 (200 m) | https://pds-geosciences.wustl.edu/ · https://astrogeology.usgs.gov/ | Datos abiertos de NASA PDS / USGS | Relieve |
| Mars Odyssey THEMIS | Global Thermal Inertia Mosaic, cuadrángulos Quantitative 32 bits (bucket público `asc-astropedia`) | https://astrogeology.usgs.gov/ | Dominio público EE. UU. (NASA/USGS Astrogeology) | Inercia térmica |
| TES | Putzig y Mellon 2007; mapas minerales de Bandfield 2002 | https://tes.asu.edu/ | Datos abiertos de NASA PDS | Inercia térmica global, minerales |
| MRO CRISM | MTRDR (`MROCR_4001`) | https://pds-geosciences.wustl.edu/ | Datos abiertos de NASA PDS | Mineralogía |
| HiRISE / CTX | DTM (1 m y 20 m), colecciones USGS STAC | https://astrogeology.usgs.gov/ | Datos abiertos de NASA PDS / USGS | Relieve local |
| SWIM 2.0 | Mapas de consistencia de hielo (Morgan et al. 2021) | https://doi.org/10.1029/2020JE006763 | **No publica licencia**: se cita Morgan et al. 2021 | Hielo subterráneo |
| Mars Climate Database | v6.2 | http://www-mars.lmd.jussieu.fr/ | Uso moderado, con registro para la versión completa | Clima (contraste) |
| Montabone | Climatología de profundidad óptica MY24–MY36 | https://doi.org/10.1016/j.icarus.2019.113526 | Según publicación y archivo: se cita el autor | Polvo en el aire |
| MGC³ | Mars Global Cave Candidate Catalog (DOI 10.17189/1519222, Cushing 2015) | https://pds-geosciences.wustl.edu/ | Dominio público EE. UU. / acceso abierto NASA PDS | Capa de cuevas |

### Navegador y herramientas

| Recurso | Versión | URL | Licencia |
| :-- | :-- | :-- | :-- |
| CesiumJS | 1.147.0 | https://github.com/CesiumGS/cesium | Apache-2.0 |
| Sentinel-2 cloudless (imagen de fondo por omisión) | edición 2025, ~10 m | https://s2maps.eu | **CC BY-NC-SA 4.0** de EOX IT Services GmbH, con atribución en el globo («Contains modified Copernicus Sentinel data 2025»). Uso no comercial: el proyecto es un hackathon sin fines de lucro y **no redistribuye las teselas**, las pide al servicio en tiempo de ejecución |
| NASA GIBS (imagen de fondo alternativa y respaldo) | Blue Marble Next Generation, ~500 m | https://nasa-gibs.github.io/gibs-api-docs/ | Datos abiertos de NASA: sin restricciones de uso, con atribución |

> Sobre la imagen de fondo: el visor trae dos proveedores conmutables. El de EOX es el que se ve por omisión porque da ~10 m sin nubes; el de NASA GIBS es de dominio público y libre de restricciones. Si se prefiere no depender de una licencia no comercial, se cambia al de GIBS desde la propia interfaz. Ninguna de las dos se empaqueta en este repositorio: son servicios remotos, y sin internet el globo queda con el relieve y las capas, que sí son locales.


Los archivos crudos de las fuentes listadas (GeoTIFF, NetCDF, HDF, IMG del PDS) **no se redistribuyen** en este repositorio: se descargan de su origen con las instrucciones de cada enlace. Lo que sí se distribuye son resultados derivados y agregados por el equipo (una tabla de celdas HEALPix con estadísticos por celda y los JSON del motor), citando arriba la fuente de cada columna. La tabla maestra completa (23 GB), adicionalmente, no se publica por tamaño.

---

## 6. Licencias del software

- **Código propio de este repositorio:** **Apache License 2.0** (ver [`LICENSE`](LICENSE)). Es la licencia que NASA Space Apps aplica por omisión cuando el equipo no especifica otra (§7).
- **Rust:** el crate `nucleo` no tiene dependencias de producción. `pipeline` usa `anyhow`, `bytemuck`, `cdshealpix`, `memmap2`, `rayon`, `serde`, `serde_json` (todas MIT y/o Apache-2.0); en pruebas, `nalgebra` y `proptest` (Apache-2.0 / MIT). El inventario completo con versión y licencia de los **134 crates** que entran en la compilación está fijado en `motor/Cargo.lock` y se puede volcar con `cargo metadata`.
- **JavaScript/TypeScript:** `cesium` (Apache-2.0), `vite` (MIT), `typescript` (Apache-2.0), `vite-plugin-static-copy` (MIT), más sus dependencias transitivas (**121 paquetes**) fijadas en `visor/package-lock.json`. Los binarios opcionales de `esbuild` y `rollup` son MIT.
- **CesiumJS** incluye en `demo/cesiumStatic` sus propios `Workers`, `Assets`, `Widgets` y `ThirdParty` bajo Apache-2.0 y las licencias de terceros que Cesium distribuye en `ThirdParty`; no se modificaron.
- **Datos:** cada dataset conserva su licencia original (sección 5). El resultado derivado que produce este código se distribuye bajo Apache-2.0 y mantiene la atribución de las fuentes.

---

## 7. Requisitos del evento y cómo se cumplen

Según las *2026 NASA Space Apps Participant Terms and Conditions* (https://www.spaceappschallenge.org/legal/):

| Requisito del evento (texto oficial) | Cómo se cumple aquí |
| :-- | :-- |
| «any original content … is freely available without restriction or is licensed as open source as defined by the Open Source Initiative»; si no se especifica licencia, «NASA will distribute your original content under an Apache 2.0 license» | `LICENSE` = Apache-2.0, en la raíz del repositorio |
| «Any licenses applicable to your Solution Materials must be identified in the documentation» | Sección 6: licencias de Rust y JavaScript con sus archivos de bloqueo |
| «NASA will not accept or post any Solutions that do not include appropriate license documentation» | Todo el software de terceros es OSI (MIT/Apache-2.0/BSD/Zlib/0BSD/ISC/MPL-2.0); ninguno con cláusulas que impidan la redistribución |
| «You must cite every source that is used in the creation of your project, even if it is open source or freely available» | Sección 5: cada dataset y cada librería, con producto, versión, URL y licencia |
| Identificar las herramientas de IA y otros recursos usados | Sección 8 |
| Solución accesible públicamente sin registro para el jurado | El demo se distribuye como ZIP y corre sin cuenta, sin claves y sin internet; el repositorio es público |

Los datos de NASA usados son de dominio público o de acceso abierto; los productos de terceros (Copernicus, SoilGrids, Zenodo, PANGAEA) se citan con su licencia CC correspondiente. **Todos los recursos, incluso los de código abierto, están citados.**

---

## 8. Uso de inteligencia artificial (declaración)

El código se escribió durante el evento con agentes de IA como herramienta, bajo revisión e integración humana del equipo. Cada sesión quedó registrada en la bitácora del proyecto con el agente que la hizo:

| Herramienta / agente | Sesiones registradas | Para qué se usó |
| :-- | --: | :-- |
| Claude Code (Anthropic) | 44 | Redacción del motor en Rust (`nucleo`, `pipeline`), del puente y del visor; investigaciones técnicas y revisión de decisiones |
| Antigravity (Google, con Gemini) | 13 | Interfaz del visor: panel, capas, fichas, disposición de ventanas |
| Hermes Agent (Nous Research) | 2 | Verificación de la ruta `wasm32`, del servidor de entrega y de este paquete de publicación |

El equipo definió el reto, el vector de variables, la fórmula del parecido, las decisiones de arquitectura (documentadas como ADR), revisó cada cambio y validó los resultados contra un oráculo independiente en NumPy. Ninguna cifra de este repositorio sale de un modelo: sale de los datasets citados en la sección 5. Los agentes no tienen acceso a claves ni a datos privados; las claves de API (opcionales, para el chat y la voz) van en `.env`, que está ignorado por git y **no viaja en el ZIP**.

---

## 9. Límites, dicho sin adornos

- Los candidatos están **sin verificar en campo**. Son celdas de ~2,5 km que se parecen en las variables medidas; ninguna afirmación de este proyecto dice «aquí hay un análogo confirmado».
- El parecido **no es visual**: se compara por procesos y se declara en qué difiere cada candidato (gravedad, atmósfera, presión, escala).
- Hay variables sin dato global comparable: no existe inercia térmica global de la Tierra (se calcula aparente con MODIS día/noche y albedo) y la mineralogía se compara por clases, no por bandas.
- La tabla maestra cubre menos de la mitad del planeta con datos completos; las celdas sin NDVI o sin variables obligatorias quedan fuera del barrido y se reportan como tales.
- El motor de esta entrega es un **ensayo medido**: sirve para demostrar tiempos y reproducir el método. Los tiempos están en `motor/LEEME.md` (0,25 s para 58,7 millones de celdas con 16 hilos).
- El ETL que construye la tabla no está incluido (§2.3).

---

## 10. Equipo

| Alias | GitHub | Rol |
| :-- | :-- | :-- |
| Fernando | [@RedFer855](https://github.com/RedFer855) | Integración, motor en Rust, arquitectura y decisiones |
| Guillermo | [@IngGuillermoRosa](https://github.com/IngGuillermoRosa) | Visor e interfaz |

Equipo **J4Ks**, NASA Space Apps Challenge 2026 — Tegucigalpa, Honduras.

---

## 11. Verificación rápida (para quien revisa)

```bash
cd motor && cargo test                                  # 32 pruebas del núcleo y del pipeline, sin datos
cd motor && cargo clippy --workspace --all-targets -- -D warnings
node --test herramientas/motor-puente/nucleo.test.mjs   # puente: índice, áreas y validación
METRICS_DIR=<carpeta con metrics.json> node --test contrato/contrato.test.js
```

Si el demo abre y el globo gira, la parte web está bien; si `cargo test` pasa, la matemática está bien. Lo que no se puede verificar sin los 23 GB es el barrido completo.
