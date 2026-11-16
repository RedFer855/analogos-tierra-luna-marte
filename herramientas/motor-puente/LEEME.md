# motor-puente (ENSAYO, ADR-005)

Conecta el motor Rust (`motor/target/release/pipeline.exe`) con el visor Cesium y con una IA (MCP). Es un ensayo: el
evento (2026-11-14/15) reconstruye desde cero; vale por las recetas y los tiempos, no por el código.

| Archivo | Qué hace |
| :-- | :-- |
| `nucleo.mjs` | Única lógica: índice, polígonos, validación, lanzar `pipeline.exe`, leer `robustez.json`. |
| `servidor.mjs` | API HTTP en `127.0.0.1:5174` para el visor (rechaza otros orígenes que no sean `localhost:5173`). |
| `mcp.mjs` | Servidor MCP por stdio: `listar_areas`, `obtener_area`, `agregar_area`, `listar_objetivos`, `lanzar_busqueda`, `estado_busqueda`. |
| `construir-hallazgos.mjs` | Regenera `indice_hallazgos.json` desde los barridos de `motor/escenarios/barridos-2026-11-13/`. |
| `indice_hallazgos.json` | 110 hallazgos `candidato-sin-verificar` (b1 20, b2 30, b3 3×20). No toca `indice_43.json`. |
| `procesos.json`, `procesos.mjs` | Etiquetas de procesos y usos por reglas declaradas (banderas por celda y por ventana, sin puntaje). Aún no se muestran en el visor (P-036). |

## Probar en local

```bash
node herramientas/motor-puente/servidor.mjs
```

```bash
cd visor && npm install && npm run dev
```

Abre `http://localhost:5173`: panel «Motor de análogos» a la derecha. Azul = ya encontrados (43), ámbar = candidatos
de barridos previos (110), magenta = búsqueda nueva. Al tocar un pin se dibuja solo su polígono.

## Límites

- El polígono es un **círculo** de `radio_km` (50 km los documentados y los de búsqueda, 150 km los de `b2`/`b3`):
  ni `indice_43.json` ni `robustez.json` traen contorno.
- La búsqueda usa `--escenarios` con 1–3 factores de tolerancia sobre un perfil de `analogos.json`; no expone pesos ni
  subconjuntos de variables.
- Exclusión: cada búsqueda excluye los 43, los candidatos previos y las búsquedas anteriores (radio propio de cada área, o `excluir_km` si se fija); se escribe en `indice_exclusion.json` dentro de la búsqueda.
- Un trabajo a la vez; `--hilos` se recorta al 70 % de los núcleos.
- Los resultados de cada búsqueda quedan en `D:/PP/ANALOGOS-run/motor/ui/<id>/` (fuera de git).
- `ANALOGOS_RUN` cambia la raíz de `ANALOGOS-run`.

## Pruebas

```bash
node --test herramientas/motor-puente/nucleo.test.mjs
```

## Explicación, chat y clave de DeepSeek

- Al tocar un área, `explicacion.mjs` junta datos reales: lugar y país (geocodificación inversa con Nominatim, solo se envían
  las coordenadas), el parecido del motor en %, y el valor de cada variable en la celda más cercana de la tabla maestra frente
  al objetivo y su tolerancia. De ahí sale una plantilla en lenguaje simple; con clave, DeepSeek la redacta sin salirse de esos datos.
- Pestaña **Chat**: preguntas libres con el área seleccionada como contexto.
- Pestaña **Ajustes**: la clave se escribe en el campo (tipo contraseña) y el puente la guarda en `.env` (git lo ignora). El
  visor nunca la recibe de vuelta (`/api/config` solo dice si hay una). Se puede borrar desde ahí. Las rutas que escriben
  exigen la cabecera `X-Motor-Puente: 1`; el MCP no maneja la clave.
- La clave solo viaja a `api.deepseek.com`, junto con las coordenadas y los datos del área que se pregunte.
- Sin verificar con la API real de DeepSeek (aún no hay clave): el modelo por omisión es `deepseek-chat`; se cambia en Ajustes.

## Voz (Deepgram Aura-2) y marcas ocultas

- Hace falta una **clave de API normal** de Deepgram (no un Voice Agent: ese producto trae su propio reconocimiento, modelo y
  voz; aquí el modelo es DeepSeek y solo se usa la síntesis de voz). Se pega en Ajustes; va a `.env` como `DEEPGRAM_API_KEY`.
- Deepgram Aura-2 **no tiene** SSML, etiquetas de emoción ni control de pausas (documentación leída 2026-11-13). Solo ofrece
  `speed`. Por eso la «emoción» se hace así: el modelo escribe marcas ocultas (`[pausa]`, `[pausa larga]`, `[lento]`, `[suave]`,
  `[animado]`), `voz.mjs` las quita del texto visible y las convierte en un guion (`[{t, ritmo, pausa_ms}]`): cada frase se
  pide con su `speed` y el visor espera la pausa entre frases. Nada de esto aparece en el chat.
- Sin IA, el guion sale de la plantilla (pausas por párrafo y viñeta, notas en tono suave).
- Sin verificar con la API real: que `speed` funcione con las voces en español (si Deepgram responde 400, se repite sin `speed`).

## Minerales y roca

`minerales.mjs` lee, en la celda de la tabla maestra más cercana al centro del área: roca dominante (GLiM, 0,5°), índices ASTER de
cuarzo, carbonato y máficos (~1 km), los 11 minerales de EMIT L3 ASA (0,5°, solo zonas áridas) y arcilla/limo (SoilGrids). Cada valor
se sitúa frente al resto de la Tierra con un percentil sobre una muestra de la columna (caché en `ANALOGOS-run/motor/cache-explicacion`).
La sección sale en la ficha, en la plantilla, en la voz y en el contexto que recibe DeepSeek. Límites: es la celda del centro, EMIT es
abundancia espectral (no % en peso) y no cubre zonas no áridas, y no se compara con minerales de la Luna o Marte (la tabla no los trae).

## Confianza y su rango

`confianza.mjs` da a cada candidato un puntaje de 0 a 100, un rango y un nivel (alta, media, baja). Mide cuánto creer que el ajuste
con su sitio objetivo es real; no es una verificación (todos los candidatos están sin verificar).

- **Puntos:** ajuste con el objetivo 40 (variables dentro de tolerancia y cercanía), variables que discriminan 20 (tolerancia no
  mayor que 5 veces la escala natural de la Tierra), robustez 20 (en cuántos escenarios aparece), calidad del perfil 10 (resumen de
  calidad del motor) y cobertura de datos 10.
- **Rango:** sale de la incertidumbre de la robustez (intervalo de Wilson al 95 % sobre «aparece en k de n escenarios»); 6 de 6 deja
  un margen de 61 % a 100 %. En zonas de 150 km medidas en una sola celda se ensancha 6 puntos.
- **Topes (eslabón más débil):** el nivel baja a media o baja si el ajuste es flojo, si la mitad o más de las variables no discriminan,
  si la calidad del perfil es baja o si la robustez tiene margen amplio. El puntaje mostrado respeta el tope; el bruto y su rango
  siguen disponibles.
- Los umbrales (40 y 65) y los pesos son una decisión de ensayo, no calibrados contra casos verificados. En el visor: pestaña Mapa,
  «Colorear por Confianza», y el medidor de la ficha.
