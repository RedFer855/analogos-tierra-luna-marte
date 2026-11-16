//! Entradas del perfil: lo que el ensayo dejó en `analogos.json` (objetivo y, tolerancia τ, escala s, correlación R) y
//! los parámetros de la búsqueda. El motor no recalcula escalas ni correlación todavía (se lo pidió la tarea).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

fn min_celdas_defecto() -> u64 {
    30
}

/// Parámetros globales de la búsqueda (`parametros` de `analogos.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct Parametros {
    pub gamma: f64,
    pub lambda_contraccion: f64,
    pub ndvi_max_principal: f64,
    pub s_coincide: f64,
    pub nivel_region: u32,
    pub radio_documentado_km: f64,
    #[serde(default = "min_celdas_defecto")]
    pub min_celdas_region: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InfoMaestro {
    pub n_celdas: usize,
    pub generado: String,
}

/// Un perfil de un objetivo, con los mismos nombres que `analogos.json`. Los campos que el motor no usa se ignoran.
#[derive(Debug, Clone, Deserialize)]
pub struct PerfilJson {
    pub variables: Vec<String>,
    pub objetivo: BTreeMap<String, f64>,
    pub tolerancia: BTreeMap<String, f64>,
    pub escala_tierra: BTreeMap<String, f64>,
    pub correlacion: Vec<Vec<f64>>,
    #[serde(default)]
    pub fuera_del_alcance_de_la_tierra: BTreeMap<String, FueraDeAlcance>,
    pub celdas_que_coinciden_en_la_tierra: u64,
}

/// Una variable cuyo valor real del objetivo la Tierra no alcanza: se buscó con el tope de la Tierra.
#[derive(Debug, Clone, Deserialize)]
pub struct FueraDeAlcance {
    pub objetivo_real: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct Objetivo {
    nombre: String,
    cuerpo: String,
    perfiles: BTreeMap<String, PerfilJson>,
}

#[derive(Debug, Clone, Deserialize)]
struct Analogos {
    parametros: Parametros,
    maestro: InfoMaestro,
    objetivos: BTreeMap<String, Objetivo>,
}

/// El perfil de un sitio, con los vectores alineados con `variables`.
#[derive(Debug, Clone)]
pub struct PerfilCargado {
    pub sitio: String,
    pub nombre_sitio: String,
    pub cuerpo: String,
    pub id_perfil: String,
    /// Cuerpos contra los que existe este perfil en `analogos.json` (para el catálogo de perfiles).
    pub contra: Vec<String>,
    pub variables: Vec<String>,
    pub objetivo: Vec<f64>,
    pub tolerancia: Vec<f64>,
    pub escala: Vec<f64>,
    /// k × k por filas.
    pub correlacion: Vec<f64>,
    /// (variable, valor real del objetivo) de las que la Tierra no alcanza.
    pub fuera_de_alcance: Vec<(String, f64)>,
    /// Celdas con S ≥ `s_coincide` que dejó el oráculo (numpy) en este perfil.
    pub coinciden_oraculo: u64,
}

pub struct Cargado {
    pub parametros: Parametros,
    pub maestro: InfoMaestro,
    pub perfil: PerfilCargado,
}

fn por_variable(mapa: &BTreeMap<String, f64>, variables: &[String], que: &str) -> Result<Vec<f64>> {
    variables
        .iter()
        .map(|v| {
            mapa.get(v)
                .copied()
                .with_context(|| format!("falta `{v}` en `{que}`"))
        })
        .collect()
}

/// Lee `analogos.json` y arma el perfil `id_perfil` del sitio `sitio`. Con `perfil_alterno` toma el perfil de ese archivo
/// (mismo formato que un perfil de `analogos.json`) y deja de `analogos.json` solo los parámetros: sirve para probar con
/// los números sin redondear que usó el oráculo.
pub fn cargar(
    analogos: &Path,
    sitio: &str,
    id_perfil: &str,
    perfil_alterno: Option<&Path>,
) -> Result<Cargado> {
    let texto = fs::read_to_string(analogos)
        .with_context(|| format!("no se pudo leer {}", analogos.display()))?;
    let a: Analogos = serde_json::from_str(&texto)
        .with_context(|| format!("{} no tiene el formato esperado", analogos.display()))?;
    let Some(obj) = a.objetivos.get(sitio) else {
        bail!("el sitio {sitio} no está en {}", analogos.display());
    };
    let contra: Vec<String> = {
        let mut c: Vec<String> = a
            .objetivos
            .values()
            .filter(|o| o.perfiles.contains_key(id_perfil))
            .map(|o| o.cuerpo.clone())
            .collect();
        c.sort();
        c.dedup();
        c
    };
    let p: PerfilJson = match perfil_alterno {
        Some(ruta) => {
            let t = fs::read_to_string(ruta)
                .with_context(|| format!("no se pudo leer {}", ruta.display()))?;
            serde_json::from_str(&t)
                .with_context(|| format!("{} no tiene el formato de un perfil", ruta.display()))?
        }
        None => obj
            .perfiles
            .get(id_perfil)
            .with_context(|| format!("el sitio {sitio} no tiene el perfil `{id_perfil}`"))?
            .clone(),
    };
    let k = p.variables.len();
    if p.correlacion.len() != k || p.correlacion.iter().any(|f| f.len() != k) {
        bail!("la correlación de {sitio}/{id_perfil} no es {k} × {k}");
    }
    let perfil = PerfilCargado {
        sitio: sitio.to_owned(),
        nombre_sitio: obj.nombre.clone(),
        cuerpo: obj.cuerpo.clone(),
        id_perfil: id_perfil.to_owned(),
        contra,
        objetivo: por_variable(&p.objetivo, &p.variables, "objetivo")?,
        tolerancia: por_variable(&p.tolerancia, &p.variables, "tolerancia")?,
        escala: por_variable(&p.escala_tierra, &p.variables, "escala_tierra")?,
        correlacion: p.correlacion.iter().flatten().copied().collect(),
        fuera_de_alcance: p
            .fuera_del_alcance_de_la_tierra
            .iter()
            .map(|(v, f)| (v.clone(), f.objetivo_real))
            .collect(),
        coinciden_oraculo: p.celdas_que_coinciden_en_la_tierra,
        variables: p.variables,
    };
    Ok(Cargado {
        parametros: a.parametros,
        maestro: a.maestro,
        perfil,
    })
}
