# Motor de similitud en Rust (ensayo)

ENSAYO (ADR-005): sirve para medir tiempos y escribir recetas; el evento lo reconstruye desde cero. Decisiones:
[ADR-003](../contexto/45-decisiones/ADR-003-motor-en-rust-y-webassembly.md) (Rust + Wasm),
[ADR-006](../contexto/45-decisiones/ADR-006-formula-del-parecido.md) y
[ADR-008](../contexto/45-decisiones/ADR-008-vector-de-variables-definitivo.md) §3.5 (la fórmula),
[ADR-010](../contexto/45-decisiones/ADR-010-contrato-de-metrics-json.md) (la salida) y
[ADR-013](../contexto/45-decisiones/ADR-013-motor-de-ensayo-elegibilidad-candidatos-y-contrato.md) (lo que decidió este primer corte).

| Parte | Qué hace |
| :-- | :-- |
| `nucleo/` | El puntaje: `δ` con zona de tolerancia, `R_s = (1 − λ)R + λI` recortada a las variables presentes (Gower), Mahalanobis con pesos, `S = exp(−γ·D²)` y la nota por variable con blanqueo ZCA-cor. Sin E/S, sin `unsafe`, sin dependencias (apto para wasm32; **no se compiló a wasm32**: el target no está instalado). Álgebra propia: Cholesky y Jacobi cíclico (I-42, opción 3). |
| `pipeline/` | Binario nativo: lee por mmap solo las 8 columnas del perfil (1,9 GB de los 18,8 GB), filtra, puntúa con rayon, elige la mejor celda de cada región de nivel 6 y escribe `metrics.json` + `resultados/<perfil>/<SL-NN>.json`. |

## Cómo correrlo

```bash
cd motor
cargo test                                       # 32 pruebas, sin datos
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p pipeline --release                  # SL-12, perfil terreno_termico, 200 candidatos
cargo test -p pipeline --release -- --ignored --nocapture --test-threads=1   # humo con la tabla real
```

Por omisión lee `$RUN/maestro` y `$RUN/analogos/analogos.json` (`RUN` = `D:/PP/ANALOGOS-run/etl`) y escribe en
`D:/PP/ANALOGOS-run/motor/salida` (fuera de git). `pipeline --ayuda` lista las opciones (`--objetivo`, `--perfil`,
`--candidatos`, `--hilos`, `--perfil-json`, `--volcar-s`, `--solo-barrido`, `--escenarios`, `--indice`, `--excluir-km`,
`--separacion-km`).

> [!NOTE]
> **Hilos según la PC (`--hilos`):** sin `--hilos`, `pipeline` usa todos los núcleos lógicos disponibles y puede trabar el equipo durante barridos largos (`--escenarios`). Ajusta `--hilos` a las características de tu PC dejando margen libre (~70–75 % de los hilos; p. ej., `--hilos 10` o `--hilos 12` en una PC de `16` hilos).

Validar la salida contra el contrato:

```bash
METRICS_DIR=D:/PP/ANALOGOS-run/motor/salida node --test contrato/contrato.test.js
```

Contraste con numpy (independiente del motor y de `scripts/etl/buscar.py`), fila a fila sobre las 12,26 M de filas elegibles:

```bash
python -I scripts/motor/comparar_con_oraculo.py generar D:/PP/ANALOGOS-run/motor/verificacion SL-12 terreno_termico
pipeline --volcar-s D:/PP/ANALOGOS-run/motor/verificacion/rust_redondeado.f32
pipeline --perfil-json D:/PP/ANALOGOS-run/motor/verificacion/exacto.json --volcar-s D:/PP/ANALOGOS-run/motor/verificacion/rust_exacto.f32 --salida D:/PP/ANALOGOS-run/motor/verificacion/salida_exacta
python -I scripts/motor/comparar_con_oraculo.py comparar D:/PP/ANALOGOS-run/motor/verificacion
```

## Muchos escenarios de una pasada (`--escenarios`)

```bash
cargo run -p pipeline --release -- --escenarios escenarios/muestreo-sl12.json --salida D:/PP/ANALOGOS-run/motor/escenarios
```

Un escenario = sitio objetivo × subconjunto de variables × tolerancias × pesos × corte de NDVI. El archivo trae escenarios
escritos a mano (`escenarios`) y, si se quiere, un `muestreo` que saca subconjuntos de `k_min` a `k_max` variables repartidas
entre grupos físicos (con la misma `semilla` salen siempre los mismos):

```json
{
  "escenarios": [
    { "id": "base", "objetivo": "SL-12", "perfil": "terreno_termico" },
    { "id": "sin-termico", "objetivo": "SL-12", "perfil": "terreno_termico",
      "variables": ["slope_mean_deg", "slope_std_deg", "rug_rms_mean_m", "relieve_mean_m"],
      "factor_tolerancia": 0.5, "pesos": { "slope_mean_deg": 2.0 }, "ndvi_max": 0.2 }
  ]
}
```

Lo que un escenario no dice queda como en su perfil base de `analogos.json`: todas las variables, `factor_tolerancia` 1,
pesos iguales y el `ndvi_max_principal`. Las columnas se mapean una sola vez; cada bloque de 262 144 filas copia juntas sus
filas elegibles y con ellas se evalúan todos los escenarios (`barrido::barrer_escenarios`). La salida es `robustez.json`:
las cuentas de cada escenario y, por objetivo, cada candidato (una región de nivel 6) con `aparece_en` (en cuántos escenarios
quedó entre los `--candidatos` mejores), `fraccion` y la nota S mínima, mediana y máxima en los escenarios donde aparece.

Límites, a propósito:

- **Solo sirven las variables que el perfil base trae con valor objetivo.** La tabla tiene 77 columnas además de `lat`, `lon` y
  el NDVI del filtro, pero `analogos.json` solo trae 20 variables distintas y a lo sumo 13 por sitio (12 en `caso_C-03` de
  SL-12). El muestreo reparte entre los grupos las que haya; no inventa objetivos.
- **La correlación de un subconjunto es la submatriz de la R del perfil base.** El oráculo la volvería a medir con las celdas que
  traen justo esas variables; aquí no se recalcula (tampoco las escalas).
- **El terreno se exige siempre** (las cuatro variables de `OBLIGATORIAS`), aunque el escenario no las use: así los escenarios
  con el mismo corte de NDVI comparan las mismas celdas. Con un escenario que sí las usa da lo mismo que la corrida normal.
- Cada perfil precalcula sus máscaras (ADR-013 §3): un escenario de 8 variables sin obligatorias ocupa unos 0,6 MB.
- Los perfiles de 13 variables (`caso_C-04`, `caso_C-05`) no entran completos: `MAX_VARS` es 12.

## Exclusión por índice y separación entre candidatos (`--indice`, `--separacion-km`)

```bash
cargo run -p pipeline --release -- --indice escenarios/indice-ejemplo.json --excluir-km 200 --separacion-km 300
```

- `--indice FILE`: arreglo JSON de entradas (`id`, `lat`, `lon`, `radio_km`, `estado`: `documentado` |
  `verificado_remoto` | `verificado_campo`, `fuente`, `fecha`; ejemplo en `escenarios/indice-ejemplo.json`). Se excluye
  por **celda** (antes de elegir la mejor de cada región de nivel 6), preclasificando cada región para evitar calcular
  haversine donde no hace falta. `--excluir-km N` (o `radio_exclusion_km` en un escenario) sustituye `radio_km` de todas
  las entradas.
- `--separacion-km N` (o `separacion_km` en un escenario): después de ordenar todas las regiones de mejor a peor y antes
  de recortar a `--candidatos`, toma el mejor candidato y descarta los que queden a menos de `N` km.
- Contadores opcionales en la salida: `excluidos_por_indice` cuenta **celdas** completas y elegibles descartadas por el
  índice; `excluidos_por_separacion` cuenta candidatos descartados por cercanía entre sí. Si no se pasan las opciones,
  la salida no cambia. Límites de este corte: sin filtro por polígono/área, sin reducción por `√área` y sin modo `marcar`.

## Qué mide (2026-11-12, i5-12500H de 12 núcleos y 16 hilos, 23,6 GB de RAM, NVMe)

Pasada completa de 58 700 374 celdas, perfil `terreno_termico` de SL-12 (6 variables + NDVI + `ipix`), tabla en la caché de Windows:

| Hilos | Barrido (3 corridas) | Lectura efectiva |
| --: | :-- | --: |
| 1 | 0,96 – 1,01 s | 1,9 GB/s |
| 2 | 0,59 s | 3,2 GB/s |
| 4 | 0,37 – 0,39 s | 4,8 – 5,0 GB/s |
| 8 | 0,30 – 0,31 s | 6,0 – 6,3 GB/s |
| 16 | 0,24 – 0,27 s | 7,1 – 7,9 GB/s |

Corrida completa (abrir y mapear 2–4 ms, perfil 0,06 ms, barrido 0,25 s, armar 200 candidatos con vértices 1,3 ms, escribir
2 archivos de 282 KB 1,5–2,6 ms): 0,25–0,3 s de pared. Memoria privada del proceso 9–57 MB (1 a 16 hilos); el working set
observado llega a unos 0,8 GB (páginas de la tabla). **No se midió en frío de verdad**: la caché de Windows no se vació
(hace falta `RAMMap -Et` como administrador); un barrido con 6 columnas que esta sesión no había tocado dio 0,38 s, así que
la lectura desde el NVMe no es el cuello de botella con 16 hilos.

Barrido de escenarios (`--escenarios escenarios/muestreo-sl12.json`, misma máquina y fecha): 201 escenarios, el base de 6
variables y 200 muestreados de 4 a 8 variables de `caso_C-03` con tolerancias ×0,5, ×1 y ×2 y cortes de NDVI de 0,2, 0,3 y 0,4
(14 columnas más NDVI e `ipix`):

| Hilos | Barrido de 201 escenarios | Escenarios por segundo |
| --: | --: | --: |
| 1 | 227,4 s | 0,88 |
| 4 | 82,6 s | 2,4 |
| 8 | 49,7 s | 4,0 |
| 16 | 22,4 – 23,1 s (2 corridas) | 8,7 – 9,0 |

Con 1 y con 16 hilos sale el mismo `robustez.json`. Un escenario solo tarda 0,29–0,32 s por `--escenarios` y 0,23–0,26 s por la
corrida normal (16 hilos): la copia del bloque se paga desde el segundo escenario. El costo es el puntaje: 1,1 s de un núcleo
por escenario. Se probaron bloques de 2 048 a 1 048 576 filas y el tamaño casi no cambia el tiempo.

## Qué falta (no se hizo a propósito)

- No recalcula escalas, correlación ni objetivos: lee `analogos.json` tal cual (redondeado: ver ADR-013 §2.4).
- La corrida normal es de un perfil y un sitio; `--escenarios` barre muchos, pero siempre con los números de `analogos.json`
  (los seis perfiles de ADR-008 no están armados).
- Sin búsqueda dentro de un polígono, área mínima ni modo `marcar` (`contexto/40-arquitectura/motor-escenarios-exclusion-y-region.md`).
- Sin filtros de ADR-008 §3.2 más allá del NDVI (aridez, frío extremo, hielo, mineral…), sin `region` ni `ficha`.
- Sin poda por bloques de nivel 5 (`bloques_n5*`): el barrido completo ya cabe en 0,25 s.
- Sin compilar a wasm32 ni integrar con el visor (I-44); sin `deny.toml` ni CI de Rust (P-020).
