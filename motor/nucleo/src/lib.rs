#![forbid(unsafe_code)]
//! Núcleo del motor: el puntaje de similitud entre una celda de la Tierra y el objetivo de la Luna o Marte.
//!
//! Fórmula de [ADR-006] con la zona de tolerancia de [ADR-008] §3.5:
//!
//! ```text
//! δᵢ = signo(xᵢ − yᵢ) · max(0, |xᵢ − yᵢ| − τᵢ) / sᵢ
//! D² = δᵀ · W^½ · R_s⁻¹ · W^½ · δ        R_s = (1 − λ)·R + λ·I, recortada a las variables presentes
//! S  = exp(−γ · D²)
//! ```
//!
//! Sin entrada/salida, sin `unsafe` y sin dependencias, para compilar a WebAssembly más adelante (ADR-003).
//! Un valor faltante es `NaN` (nunca 0): la variable no cuenta y su peso se reparte (regla de Gower, ADR-006 fila 5).
//!
//! [ADR-006]: ../../../contexto/45-decisiones/ADR-006-formula-del-parecido.md
//! [ADR-008]: ../../../contexto/45-decisiones/ADR-008-vector-de-variables-definitivo.md

pub mod algebra;
pub mod perfil;

pub use algebra::{ErrorAlgebra, MAX_VARS};
pub use perfil::{a_f32, Entrada, ErrorPerfil, Perfil, Puntuacion};
