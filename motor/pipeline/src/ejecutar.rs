//! La corrida completa: abrir la tabla, armar el perfil, barrer, elegir los candidatos y escribir el contrato.
//! La usan el binario y la prueba de humo con datos reales.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use nucleo::{Entrada, Perfil};
use serde::Serialize;

use crate::barrido::{barrer_con_filtros, s_por_fila, Barrido, Config, Cuentas, Filtros};
use crate::entrada::{cargar, Cargado};
use crate::indice::{cargar_y_validar, FiltroIndice, IndiceExclusion};
use crate::salida::{escribir, indice, iso_utc, resultado, Fuentes, Sitios};
use crate::tabla::{Columna, Tabla};

/// Variables de terreno: una celda sin alguna de ellas no se puntúa (las `TERR` del oráculo, `buscar.py`).
pub(crate) const OBLIGATORIAS: [&str; 4] = [
    "slope_mean_deg",
    "slope_std_deg",
    "rug_rms_mean_m",
    "relieve_mean_m",
];
pub(crate) const COLUMNA_NDVI: &str = "ndvi_max_clim";
pub(crate) const COLUMNA_IPIX: &str = "ipix";

#[derive(Debug, Clone)]
pub struct Opciones {
    pub maestro: PathBuf,
    pub analogos: PathBuf,
    pub sitios: PathBuf,
    pub objetivo: String,
    pub perfil: String,
    pub salida: PathBuf,
    pub candidatos: usize,
    /// `None` = todos los hilos lógicos.
    pub hilos: Option<usize>,
    /// Perfil alterno (mismo formato que un perfil de `analogos.json`), por ejemplo con los números sin redondear.
    pub perfil_json: Option<PathBuf>,
    /// Si se da, escribe la S de cada fila (`f32`, `NaN` = no puntuada) para compararla con el oráculo.
    pub volcar_s: Option<PathBuf>,
    /// Solo mide el barrido: no elige candidatos ni escribe archivos (para tiempos en frío, I-43 punto 8).
    pub solo_barrido: bool,
    /// Archivo de escenarios: en vez de una corrida, barre todos de una pasada y escribe `robustez.json`.
    pub escenarios: Option<PathBuf>,
    /// Índice JSON de análogos ya conocidos a excluir por celda.
    pub indice: Option<PathBuf>,
    /// Sustituye el `radio_km` de todas las entradas del índice.
    pub excluir_km: Option<f64>,
    /// Distancia mínima en km entre candidatos elegidos.
    pub separacion_km: Option<f64>,
}

impl Opciones {
    /// Valores por omisión: `RUN` (como el ETL) o `D:/PP/ANALOGOS-run/etl`; la salida va junto a `etl/`, fuera de git.
    #[must_use]
    pub fn por_omision() -> Self {
        let run = PathBuf::from(
            std::env::var("RUN").unwrap_or_else(|_| "D:/PP/ANALOGOS-run/etl".to_owned()),
        );
        let salida = run
            .parent()
            .map_or_else(|| run.join("motor"), |p| p.join("motor"))
            .join("salida");
        Self {
            maestro: run.join("maestro"),
            analogos: run.join("analogos").join("analogos.json"),
            sitios: Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/etl/sitios.json"),
            objetivo: "SL-12".to_owned(),
            perfil: "terreno_termico".to_owned(),
            salida,
            candidatos: 200,
            hilos: None,
            perfil_json: None,
            volcar_s: None,
            solo_barrido: false,
            escenarios: None,
            indice: None,
            excluir_km: None,
            separacion_km: None,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Tiempos {
    pub abrir_s: f64,
    pub perfil_s: f64,
    pub barrido_s: f64,
    pub candidatos_s: f64,
    pub escribir_s: f64,
    pub total_s: f64,
}

#[derive(Debug, Serialize)]
pub struct Informe {
    pub sitio: String,
    pub perfil: String,
    pub n_celdas: usize,
    pub hilos: usize,
    pub columnas_leidas: usize,
    pub mascaras_precalculadas: usize,
    pub elegibles: u64,
    pub completas: u64,
    pub coinciden: u64,
    pub coinciden_incompletas: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluidos_por_indice: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluidos_por_separacion: Option<u64>,
    pub oraculo_coinciden: u64,
    /// `coinciden − oraculo_coinciden`.
    pub diferencia_con_el_oraculo: i64,
    pub regiones_con_candidato: usize,
    pub candidatos_escritos: usize,
    pub nota_mejor: Option<f64>,
    pub nota_peor_escrita: Option<f64>,
    pub bytes_escritos: u64,
    /// GB leídos de las columnas por el barrido (aprox.: `(k + 2) × 4 × n`).
    pub gb_leidos: f64,
    pub gb_por_s: f64,
    pub tiempos: Tiempos,
    pub salida: PathBuf,
}

pub(crate) fn obligatorias(variables: &[String]) -> u16 {
    variables
        .iter()
        .enumerate()
        .filter(|(_, v)| OBLIGATORIAS.contains(&v.as_str()))
        .fold(0u16, |m, (i, _)| m | (1 << i))
}

fn armar_perfil(c: &Cargado) -> Result<Perfil> {
    let (p, e) = (&c.parametros, &c.perfil);
    Perfil::nuevo(&Entrada {
        objetivo: &e.objetivo,
        tolerancia: &e.tolerancia,
        escala: &e.escala,
        correlacion: &e.correlacion,
        pesos: None,
        gamma: p.gamma,
        lambda: p.lambda_contraccion,
        obligatorias: obligatorias(&e.variables),
    })
    .map_err(|er| anyhow::anyhow!("perfil inválido: {er}"))
}

pub(crate) fn crear_pool(hilos: Option<usize>) -> Result<rayon::ThreadPool> {
    let mut constructor = rayon::ThreadPoolBuilder::new();
    if let Some(h) = hilos {
        constructor = constructor.num_threads(h);
    }
    constructor
        .build()
        .context("no se pudo crear el pool de hilos")
}

/// Barrido de la corrida normal con el índice de exclusión y la separación entre candidatos, si se pidieron.
fn barrer_filtrado(
    cfg: &Config<'_>,
    indice: Option<&IndiceExclusion>,
    opc: &Opciones,
) -> Result<Barrido> {
    let filtro_indice = indice
        .map(|ind| {
            FiltroIndice::nuevo(
                ind,
                cfg.nivel_region,
                cfg.nivel_celda,
                cfg.ipix,
                opc.excluir_km,
            )
        })
        .transpose()?;
    let filtros = Filtros {
        indice: filtro_indice.as_ref(),
        separacion_km: opc.separacion_km,
    };
    barrer_con_filtros(cfg, &filtros).map_err(|er| anyhow::anyhow!("falló el barrido: {er}"))
}

/// Corre todo. Escribe `metrics.json` y el resultado en `opc.salida`.
pub fn correr(opc: &Opciones) -> Result<Informe> {
    let t0 = Instant::now();
    let indice_exc = cargar_y_validar(opc.indice.as_deref(), opc.excluir_km, opc.separacion_km)?;
    let cargado = cargar(
        &opc.analogos,
        &opc.objetivo,
        &opc.perfil,
        opc.perfil_json.as_deref(),
    )?;
    let (p, e) = (&cargado.parametros, &cargado.perfil);
    let tabla = Tabla::abrir(&opc.maestro)?;
    if tabla.n_celdas != cargado.maestro.n_celdas {
        bail!(
            "la tabla tiene {} celdas y analogos.json se calculó sobre {}",
            tabla.n_celdas,
            cargado.maestro.n_celdas
        );
    }
    let cols = e
        .variables
        .iter()
        .map(|v| tabla.f32(v))
        .collect::<Result<Vec<_>>>()?;
    let ndvi = tabla.f32(COLUMNA_NDVI)?;
    let ipix = tabla.u32(COLUMNA_IPIX)?;
    let columnas: Vec<&[f32]> = cols.iter().map(Columna::f32s).collect();
    let t_abrir = t0.elapsed();

    let t1 = Instant::now();
    let perfil = armar_perfil(&cargado)?;
    let cfg = Config {
        perfil: &perfil,
        columnas: &columnas,
        ndvi: ndvi.f32s(),
        ipix: ipix.u32s(),
        ndvi_max: nucleo::a_f32(p.ndvi_max_principal),
        s_coincide: nucleo::a_f32(p.s_coincide),
        nivel_region: p.nivel_region,
        nivel_celda: u32::from(tabla.nivel_healpix),
    };
    cfg.validar().map_err(|m| anyhow::anyhow!(m))?;
    let t_perfil = t1.elapsed();

    let t2 = Instant::now();
    let pool = crear_pool(opc.hilos)?;
    let barrido = pool.install(|| barrer_filtrado(&cfg, indice_exc.as_ref(), opc))?;
    let t_barrido = t2.elapsed();
    if let Some(ruta) = &opc.volcar_s {
        let s = pool
            .install(|| s_por_fila(&cfg))
            .map_err(|er| anyhow::anyhow!("falló el volcado: {er}"))?;
        std::fs::write(ruta, bytemuck::cast_slice::<f32, u8>(&s))
            .with_context(|| format!("no se pudo escribir {}", ruta.display()))?;
    }

    if opc.solo_barrido {
        let tiempos = Tiempos {
            abrir_s: t_abrir.as_secs_f64(),
            perfil_s: t_perfil.as_secs_f64(),
            barrido_s: t_barrido.as_secs_f64(),
            candidatos_s: 0.0,
            escribir_s: 0.0,
            total_s: t0.elapsed().as_secs_f64(),
        };
        return informe(
            &cargado,
            &perfil,
            &barrido,
            opc,
            pool.current_num_threads(),
            0,
            tiempos,
        );
    }

    let (bytes_escritos, candidatos_s, escribir_s) = escribir_candidatos(
        opc,
        &cargado,
        &perfil,
        &columnas,
        tabla.nivel_healpix,
        &barrido,
    )?;
    let tiempos = Tiempos {
        abrir_s: t_abrir.as_secs_f64(),
        perfil_s: t_perfil.as_secs_f64(),
        barrido_s: t_barrido.as_secs_f64(),
        candidatos_s,
        escribir_s,
        total_s: t0.elapsed().as_secs_f64(),
    };
    informe(
        &cargado,
        &perfil,
        &barrido,
        opc,
        pool.current_num_threads(),
        bytes_escritos,
        tiempos,
    )
}

/// Elige los candidatos, arma `metrics.json` y el resultado, y los escribe. Devuelve (bytes, segundos de armar, segundos de escribir).
fn escribir_candidatos(
    opc: &Opciones,
    c: &Cargado,
    perfil: &Perfil,
    columnas: &[&[f32]],
    nivel_healpix: u8,
    barrido: &Barrido,
) -> Result<(u64, f64, f64)> {
    let t0 = Instant::now();
    let sitios = Sitios::leer(&opc.sitios)?;
    let fuentes = Fuentes {
        perfil_nucleo: perfil,
        entrada: &c.perfil,
        parametros: &c.parametros,
        sitios: &sitios,
        columnas,
        nivel_healpix,
        excluidos_por_indice: opc
            .indice
            .as_ref()
            .map(|_| barrido.cuentas.excluidos_por_indice),
        excluidos_por_separacion: opc
            .separacion_km
            .map(|_| barrido.cuentas.excluidos_por_separacion),
    };
    let res = resultado(&fuentes, &barrido.por_region, opc.candidatos)?;
    let generado = iso_utc(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs()),
    );
    let idx = indice(&fuentes, &res, generado)?;
    let armar = t0.elapsed().as_secs_f64();
    let t1 = Instant::now();
    let bytes = escribir(&opc.salida, &idx, &res)?;
    Ok((bytes, armar, t1.elapsed().as_secs_f64()))
}

fn informe(
    c: &Cargado,
    perfil: &Perfil,
    barrido: &Barrido,
    opc: &Opciones,
    hilos: usize,
    bytes_escritos: u64,
    tiempos: Tiempos,
) -> Result<Informe> {
    let e = &c.perfil;
    let Cuentas {
        elegibles,
        completas,
        coinciden,
        coinciden_incompletas,
        excluidos_por_indice,
        excluidos_por_separacion,
    } = barrido.cuentas.clone();
    let k = e.variables.len();
    let gb_leidos =
        f64::from(u32::try_from(k + 2)?) * 4.0 * f64::from(u32::try_from(barrido.n_filas)?) / 1e9;
    let notas: Vec<f64> = barrido
        .por_region
        .iter()
        .take(opc.candidatos)
        .map(|m| m.s_tol)
        .collect();
    Ok(Informe {
        sitio: e.sitio.clone(),
        perfil: e.id_perfil.clone(),
        n_celdas: barrido.n_filas,
        hilos,
        columnas_leidas: k + 2,
        mascaras_precalculadas: perfil.n_mascaras(),
        elegibles,
        completas,
        coinciden,
        coinciden_incompletas,
        excluidos_por_indice: opc.indice.as_ref().map(|_| excluidos_por_indice),
        excluidos_por_separacion: opc.separacion_km.map(|_| excluidos_por_separacion),
        oraculo_coinciden: e.coinciden_oraculo,
        diferencia_con_el_oraculo: i64::try_from(coinciden)? - i64::try_from(e.coinciden_oraculo)?,
        regiones_con_candidato: barrido.por_region.len(),
        candidatos_escritos: notas.len(),
        nota_mejor: notas.first().copied(),
        nota_peor_escrita: notas.last().copied(),
        bytes_escritos,
        gb_leidos,
        gb_por_s: gb_leidos / tiempos.barrido_s.max(1e-9),
        tiempos,
        salida: opc.salida.clone(),
    })
}
