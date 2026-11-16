# Análisis de verificación (ensayo, 2026-11-13)

Scripts de un solo uso que se corrieron en la sesión del puente. No son parte del motor ni de la entrega (ADR-005); sirven para
repetir las mediciones que cambiaron lo que creíamos. Leen la tabla maestra en `D:/PP/ANALOGOS-run/etl/maestro` y los barridos en
`D:/PP/ANALOGOS-run/motor/` (fuera de git). Se corren con `node herramientas/motor-puente/analisis/<archivo>`.

| Script | Qué mide | Resultado de la sesión |
| :-- | :-- | :-- |
| `control-nulo-recuperacion.mjs` | Cuántos de los 43 análogos «recupera» un barrido frente al mismo número de puntos al azar (tierra poco vegetada, ~40 mil celdas de muestra) | 2500 escenarios: 31/43 contra 23/43 al azar (95 %: 20–24). 10 000 escenarios: 33/43 contra 23/43 |
| `ranking-por-ajuste.mjs` | Ordena todos los candidatos del mapa por ajuste con su objetivo (variables dentro de tolerancia y cercanía) y por distancia a los 43 | El mejor no registrado a ≥500 km: Hadramaut (Yemen), 5/5 con Malapert, 94 % |
| `calibracion-contra-registrados.mjs` | Compara un candidato con los 43 registrados para un mismo objetivo (SL-03) | Solo 1 de 36 registrados llega a 5/5; el mejor tiene 81 % frente a 94 % de Yemen |
| `verificar-celda-bodele.mjs` | Valores y percentiles de la celda de Bodélé en la tabla maestra | Emisión de polvo P99,9; viento P95,7; aridez 0,0033; confirma las distancias del reporte |
| `piloto-marte-minerales.mjs` | Jezero, Gale y Mawrth: ¿sumar minerales (TES en Marte, EMIT en la Tierra) mejora el parecido con los análogos documentados de I-26? Compara A (terreno y temperatura) con B (A y minerales) contra 300 ventanas de 50 km al azar | Atacama queda en el 0,3 % y el 1,7 % superior con A para Jezero y Gale; con B baja al 15,7 % y 6 %. Solo 5 pares con cobertura: sin evidencia de mejora (resultado en `resultados/piloto-marte-minerales.json`) |
| `validacion-pares.mjs` | Cada par análogo–objetivo de I-26 (`scripts/etl/analogo_de_i26.json`) contra 300 ventanas de 50 km al azar, para los sitios de Marte con par; A (terreno y temperatura) y B (con minerales) | 5 pares de terreno de 2 análogos: 2 en el 10 % superior con A (los dos de Atacama; esperado 0,5); B no se distingue de A. 50 s |
| `ensayo-procesos-43.mjs` | Etiquetas de procesos de `../procesos.json` en ventanas de 50 km de los 43, frente a `procesos-esperados-43.json` (escrito antes de correr) | v1: volcánico 12/16, hiperárido 3/4, hielo 4/5; evaporitas 2/6, dunas 0/4, polvo 0/2. v2 post hoc: evaporitas 3/6 y el resto igual (`resultados/ensayo-procesos-43.v1.json` y `.json`). 15 s |

Límites: el pool al azar usa `ndvi_media <= 0.3` y `frac_tierra > 0.5` como proxy de las celdas elegibles del motor, así que el
control nulo es aproximado. La «cercanía» es un indicador propio, no del motor.
