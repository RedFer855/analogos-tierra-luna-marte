//! Muestreo de escenarios por grupos físicos. Con decenas de columnas no se pueden probar todos los subconjuntos de
//! variables (con 77 serían 2^77): se sacan al azar subconjuntos de `k_min` a `k_max` variables repartidas entre los
//! grupos (pendiente, relieve, térmico…), para que un escenario no se llene de variables del mismo proceso físico.
//! Con la misma semilla salen siempre los mismos escenarios.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{ensure, Result};
use serde::Deserialize;

use crate::escenarios::Definicion;

/// El bloque `muestreo` del archivo de escenarios.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Muestreo {
    pub objetivos: Vec<String>,
    pub perfil: String,
    /// Escenarios por objetivo.
    pub n: usize,
    pub semilla: u64,
    pub k_min: usize,
    pub k_max: usize,
    #[serde(default)]
    pub factores_tolerancia: Vec<f64>,
    #[serde(default)]
    pub ndvi_max: Vec<f64>,
    /// Si se da, una variable al azar del subconjunto pesa esto (o ninguna, con la misma probabilidad que cada una).
    #[serde(default)]
    pub peso_realce: Option<f64>,
    /// Grupo físico → columnas. Una variable que no está en ningún grupo forma el suyo.
    pub grupos: BTreeMap<String, Vec<String>>,
}

/// Generador `SplitMix64`: sin dependencias y con la misma secuencia en cualquier máquina.
pub struct Azar(pub u64);

impl Azar {
    fn siguiente(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Entero en `0..n` (0 si n = 0). El sesgo del módulo no pesa con n de decenas.
    fn hasta(&mut self, n: usize) -> usize {
        let n = u64::try_from(n.max(1)).unwrap_or(1);
        usize::try_from(self.siguiente() % n).unwrap_or(0)
    }
}

/// Elige `k` variables repartidas entre los grupos: una de cada grupo, con los grupos en un orden al azar, y vuelve a
/// pasar por ellos hasta juntar k. Dos variables del mismo proceso físico solo coinciden cuando ya se usaron todos los grupos.
fn elegir(azar: &mut Azar, grupos: &[Vec<usize>], k: usize) -> Vec<usize> {
    let mut resto = grupos.to_vec();
    for i in (1..resto.len()).rev() {
        resto.swap(i, azar.hasta(i + 1));
    }
    let mut elegidas = Vec::with_capacity(k);
    while elegidas.len() < k && resto.iter().any(|g| !g.is_empty()) {
        for g in &mut resto {
            if elegidas.len() < k && !g.is_empty() {
                elegidas.push(g.swap_remove(azar.hasta(g.len())));
            }
        }
    }
    elegidas.sort_unstable();
    elegidas
}

impl Muestreo {
    /// Los escenarios de un objetivo, sin repetidos. `variables` son las del perfil base, las únicas con valor objetivo.
    pub fn generar(
        &self,
        objetivo: &str,
        variables: &[String],
        azar: &mut Azar,
    ) -> Result<Vec<Definicion>> {
        let (k_min, k_max) = (
            self.k_min.min(variables.len()),
            self.k_max.min(variables.len()),
        );
        ensure!(
            k_min >= 1 && k_min <= k_max,
            "muestreo: k_min y k_max no forman un rango"
        );
        let mut por_grupo: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        for (i, v) in variables.iter().enumerate() {
            let grupo = self.grupos.iter().find(|(_, cols)| cols.contains(v));
            por_grupo
                .entry(grupo.map_or(v.as_str(), |(g, _)| g.as_str()))
                .or_default()
                .push(i);
        }
        let grupos: Vec<Vec<usize>> = por_grupo.into_values().collect();
        let (mut vistos, mut salida) = (BTreeSet::new(), Vec::new());
        for _ in 0..self.n.saturating_mul(20) {
            if salida.len() == self.n {
                break;
            }
            let k = k_min + azar.hasta(k_max - k_min + 1);
            let elegidas: Vec<String> = elegir(azar, &grupos, k)
                .iter()
                .filter_map(|&i| variables.get(i).cloned())
                .collect();
            let factor = self
                .factores_tolerancia
                .get(azar.hasta(self.factores_tolerancia.len()));
            let ndvi_max = self.ndvi_max.get(azar.hasta(self.ndvi_max.len())).copied();
            let mut pesos = BTreeMap::new();
            if let (Some(w), Some(v)) = (
                self.peso_realce,
                elegidas.get(azar.hasta(elegidas.len() + 1)),
            ) {
                pesos.insert(v.clone(), w);
            }
            let d = Definicion {
                id: format!("{objetivo}-m{:04}", salida.len() + 1),
                objetivo: objetivo.to_owned(),
                perfil: self.perfil.clone(),
                variables: elegidas,
                factor_tolerancia: factor.copied().unwrap_or(1.0),
                pesos,
                ndvi_max,
                radio_exclusion_km: None,
                separacion_km: None,
            };
            let clave = (
                &d.variables,
                d.factor_tolerancia.to_bits(),
                d.ndvi_max.map(f64::to_bits),
                &d.pesos,
            );
            if vistos.insert(format!("{clave:?}")) {
                salida.push(d);
            }
        }
        Ok(salida)
    }
}
