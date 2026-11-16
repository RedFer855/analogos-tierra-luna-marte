# Contrato de `metrics.json`

Lo que el motor entrega y lo que el visor (mapa y landing) lee. La decisión completa, con las alternativas
descartadas, está en [`ADR-010`](../contexto/45-decisiones/ADR-010-contrato-de-metrics-json.md).

| Archivo | Qué es |
| :-- | :-- |
| `metrics.schema.json` | Esquema del índice `metrics.json` |
| `resultado.schema.json` | Esquema de `resultados/<perfil>/<SL-NN>.json` |
| `ejemplo/` | Datos inventados que cumplen el contrato (`es_ejemplo: true`). Construyan con estos |
| `generar-mock.js` | `node contrato/generar-mock.js 10000 > mock.json` genera N candidatos para la prueba de carga |
| `contrato.test.js` | `node --test contrato/contrato.test.js` revisa los ejemplos contra los esquemas |

## Cómo leerlo

1. Cargar `metrics.json`. La landing tiene todo ahí: sitios, perfiles y el mejor candidato de cada resultado.
2. Al elegir perfil y sitio, cargar el `archivo` que indica `metrics.json > resultados`.
3. Cada candidato es una celda: dibujar `vertices` (4 pares `[lon, lat]`), colorear por `nota` (de 0 a 1) y mostrar
   el desglose desde `variables` (valor en su unidad, nota y si `coincide` dentro de la tolerancia).

## Reglas para no romperse cuando cambie

- Ignorar campos que no conozcan. En la versión 1.x solo se agregan campos opcionales.
- Variables, marcas y perfiles: recorrerlos desde el catálogo de `metrics.json`; no escribir sus ids en el código
  (salvo para elegir un ícono, con uno por defecto).
- Aceptar `null` en `region`, `analogo_conocido` y en cualquier `valor`, `nota` o `coincide` (sin dato).
- Gravedad, presión y radiación están en `metrics.json > cuerpos`, no en cada celda.
- `lon` va de −180 a 180, positiva al este, también en la Luna y Marte.

## CesiumJS

No usar `viewer.entities.add` ni `GeoJsonDataSource` para las celdas: con 10 000 polígonos caen a 10–15 FPS
([I-13](../contexto/55-investigaciones/I-13-rendimiento-de-poligonos-en-cesium.md)). Usar un solo `Primitive` con un
`GeometryInstance` por celda (`id: celda.ipix`) y recolorear con `primitive.getGeometryInstanceAttributes(ipix)`.
`vertices.flat()` entra directo en `Cartesian3.fromDegreesArray`. La prueba de carga es
[`prueba-rendimiento-visor`](../contexto/60-qa/prueba-rendimiento-visor.md): probar con 10 000 y 50 000.
