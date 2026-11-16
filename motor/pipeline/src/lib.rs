//! Binario nativo del motor: lee la tabla maestra por mmap, filtra, puntúa en paralelo con rayon y escribe el contrato
//! de `metrics.json` (ADR-010). El puntaje vive en `nucleo`; aquí está todo lo que toca disco, hilos y `HEALPix`.

pub mod area;
pub mod barrido;
pub mod ejecutar;
pub mod entrada;
pub mod escenarios;
pub mod geo;
pub mod indice;
pub mod muestreo;
pub mod salida;
pub mod tabla;
