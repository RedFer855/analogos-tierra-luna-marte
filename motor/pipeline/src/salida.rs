//! Salida según el contrato de ADR-010 (`contrato/metrics.schema.json` y `contrato/resultado.schema.json`):
//! `metrics.json` (el índice) y `resultados/<perfil>/<SL-NN>.json` (los candidatos de la Tierra).
//!
//! Campos opcionales que este motor agrega (el contrato 1.x los permite y el visor los ignora): `objetivo.variables.*.valor_real`
//! (cuando la Tierra no alcanza el valor del objetivo), `parametros.{gamma, lambda_contraccion, correlacion}`,
//! `parametros.variables[].escala` y `candidatos[].nota_exacta` (la nota sin zona de tolerancia).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use nucleo::Perfil;
use serde::{Deserialize, Serialize};

use crate::barrido::Mejor;
use crate::entrada::{Parametros, PerfilCargado};
use crate::geo::haversine_km;
pub(crate) use crate::geo::normalizar_lon;

pub const VERSION_CONTRATO: &str = "1.0.0";

/// Redondea a `d` decimales (los archivos pesan unos 400 bytes por celda: no hay que guardar 17 cifras).
#[must_use]
pub fn redondear(x: f64, d: i32) -> f64 {
    let f = 10f64.powi(d);
    (x * f).round() / f
}

/// Fecha y hora ISO 8601 en UTC de `segundos` desde 1970-01-01 (algoritmo de días civiles de H. Hinnant).
#[must_use]
pub fn iso_utc(segundos: u64) -> String {
    let dias = i64::try_from(segundos / 86_400).unwrap_or(0);
    let resto = segundos % 86_400;
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dia = doy - (153 * mp + 2) / 5 + 1;
    let mes = if mp < 10 { mp + 3 } else { mp - 9 };
    let anio = yoe + era * 400 + i64::from(mes <= 2);
    format!(
        "{anio:04}-{mes:02}-{dia:02}T{:02}:{:02}:{:02}Z",
        resto / 3600,
        (resto % 3600) / 60,
        resto % 60
    )
}

// ---------------------------------------------------------------- sitios (scripts/etl/sitios.json)

#[derive(Debug, Clone, Deserialize)]
pub struct Sitio {
    pub nombre: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sitios {
    pub luna: BTreeMap<String, Sitio>,
    pub marte: BTreeMap<String, Sitio>,
    pub tierra: BTreeMap<String, Sitio>,
}

impl Sitios {
    pub fn leer(ruta: &Path) -> Result<Self> {
        let t = fs::read_to_string(ruta)
            .with_context(|| format!("no se pudo leer {}", ruta.display()))?;
        serde_json::from_str(&t)
            .with_context(|| format!("{} no tiene el formato de sitios.json", ruta.display()))
    }

    fn objetivo(&self, id: &str) -> Option<&Sitio> {
        self.luna.get(id).or_else(|| self.marte.get(id))
    }
}

// ---------------------------------------------------------------- tipos del contrato

#[derive(Debug, Serialize)]
pub struct Centro {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Serialize)]
struct VarCelda {
    valor: Option<f64>,
    nota: Option<f64>,
    coincide: Option<bool>,
}

#[derive(Debug, Serialize)]
struct Cobertura {
    usadas: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
struct Celda {
    rango: usize,
    ipix: u32,
    centro: Centro,
    /// Cuatro esquinas `[lon, lat]`, de norte a oeste en el sentido del reloj (como el ejemplo del contrato).
    vertices: [[f64; 2]; 4],
    nota: f64,
    nota_exacta: f64,
    variables: BTreeMap<String, VarCelda>,
    cobertura: Cobertura,
    marcas: Vec<&'static str>,
    analogo_conocido: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Serialize)]
struct ValorObjetivo {
    valor: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    valor_real: Option<f64>,
}

#[derive(Debug, Serialize)]
struct ObjetivoJson {
    variables: BTreeMap<String, ValorObjetivo>,
}

#[derive(Debug, Serialize)]
struct VariableParametro {
    id: String,
    peso: f64,
    tolerancia: f64,
    escala: f64,
}

#[derive(Debug, Serialize)]
struct ParametrosJson {
    variables: Vec<VariableParametro>,
    filtros: Vec<&'static str>,
    gamma: f64,
    lambda_contraccion: f64,
    correlacion: Vec<Vec<f64>>,
}

#[derive(Debug, Serialize)]
struct Healpix {
    esquema: &'static str,
    nivel: u8,
}

#[derive(Debug, Serialize)]
pub struct ResultadoJson {
    version_contrato: &'static str,
    es_ejemplo: bool,
    perfil: String,
    sitio: String,
    healpix: Healpix,
    objetivo: ObjetivoJson,
    parametros: ParametrosJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    excluidos_por_indice: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    excluidos_por_separacion: Option<u64>,
    candidatos: Vec<Celda>,
}

// ---------------------------------------------------------------- catálogo del índice

struct VarCatalogo {
    id: &'static str,
    codigo: &'static str,
    nombre: &'static str,
    unidad: &'static str,
    aplica_a: &'static [&'static str],
    descripcion: &'static str,
}

/// Las variables del perfil de ensayo `terreno_termico`. Los códigos N12 y N13 son provisionales: la pendiente
/// variable y la amplitud anual no están en la tabla de ADR-008 §3.1 (ver la nota de sesión).
const CATALOGO: [VarCatalogo; 6] = [
    VarCatalogo { id: "slope_mean_deg", codigo: "N1", nombre: "Pendiente media", unidad: "°", aplica_a: &["luna", "marte"], descripcion: "Pendiente de Horn a 200 m (ADR-007), promedio de los ~63 píxeles de la celda de 2,53 km²" },
    VarCatalogo { id: "slope_std_deg", codigo: "N12", nombre: "Variación de la pendiente", unidad: "°", aplica_a: &["luna", "marte"], descripcion: "Desviación estándar de la pendiente dentro de la celda. Código provisional de ensayo: no está en ADR-008 §3.1" },
    VarCatalogo { id: "rug_rms_mean_m", codigo: "N2", nombre: "Rugosidad RMS", unidad: "m", aplica_a: &["luna", "marte"], descripcion: "Rugosidad RMS en ventana de 5 × 5 píxeles de 200 m (ADR-007), promedio por celda" },
    VarCatalogo { id: "relieve_mean_m", codigo: "N3", nombre: "Relieve relativo", unidad: "m", aplica_a: &["luna", "marte"], descripcion: "Desnivel en ventana de 5 × 5 píxeles de 200 m, promedio por celda" },
    VarCatalogo { id: "dtr_k", codigo: "N5", nombre: "Rango térmico diario", unidad: "K", aplica_a: &["luna", "marte"], descripcion: "Tierra: MODIS Aqua, LST de día (13:30) menos de noche (01:30), climatología 2013-2022 (ADR-009)" },
    VarCatalogo { id: "amp_anual_k", codigo: "N13", nombre: "Amplitud térmica anual", unidad: "K", aplica_a: &["marte"], descripcion: "Mes más caliente menos mes más frío de la temperatura media diaria. Código provisional de ensayo: no está en ADR-008 §3.1" },
];

#[derive(Serialize)]
struct CuerpoJson {
    nombre: &'static str,
    radio_m: f64,
    gravedad_ms2: f64,
    presion_superficie_pa: f64,
    atmosfera: &'static str,
    radiacion: &'static str,
    fuente: &'static str,
}

/// Valores del ejemplo del contrato (fichas de NASA NSSDC). No verificados todavía (ADR-010 §4).
fn cuerpos() -> BTreeMap<&'static str, CuerpoJson> {
    BTreeMap::from([
        ("tierra", CuerpoJson { nombre: "Tierra", radio_m: 6_371_000.0, gravedad_ms2: 9.80, presion_superficie_pa: 101_400.0, atmosfera: "Densa, con nitrógeno y oxígeno", radiacion: "Campo magnético y atmósfera protegen la superficie", fuente: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html" }),
        ("luna", CuerpoJson { nombre: "Luna", radio_m: 1_737_400.0, gravedad_ms2: 1.62, presion_superficie_pa: 3e-10, atmosfera: "Prácticamente vacío (exosfera)", radiacion: "Sin campo magnético global ni atmósfera: la superficie recibe radiación solar y cósmica directa", fuente: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html" }),
        ("marte", CuerpoJson { nombre: "Marte", radio_m: 3_389_500.0, gravedad_ms2: 3.71, presion_superficie_pa: 636.0, atmosfera: "Muy delgada, casi toda CO₂", radiacion: "Sin campo magnético global y con atmósfera delgada: mucha más radiación en superficie que en la Tierra", fuente: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html" }),
    ])
}

const MARCA_NDVI_BAJO: &str = "ndvi_bajo";

// ---------------------------------------------------------------- construcción de los candidatos

/// Todo lo que hace falta para escribir un candidato.
pub struct Fuentes<'a> {
    pub perfil_nucleo: &'a Perfil,
    pub entrada: &'a PerfilCargado,
    pub parametros: &'a Parametros,
    pub sitios: &'a Sitios,
    /// Una columna por variable del perfil.
    pub columnas: &'a [&'a [f32]],
    pub nivel_healpix: u8,
    pub excluidos_por_indice: Option<u64>,
    pub excluidos_por_separacion: Option<u64>,
}

/// Vértices `[lon, lat]` de la celda, de norte a oeste en el sentido del reloj, con las longitudes continuas respecto
/// del centro (una celda sobre el meridiano 180 trae longitudes que pasan de ±180, para que el polígono no se parta).
fn vertices_de(nivel: u8, ipix: u32, centro_lon: f64) -> [[f64; 2]; 4] {
    let v = cdshealpix::nested::vertices(nivel, u64::from(ipix));
    let punto = |(lon, lat): (f64, f64)| {
        let mut l = normalizar_lon(lon.to_degrees());
        if l - centro_lon > 180.0 {
            l -= 360.0;
        } else if l - centro_lon < -180.0 {
            l += 360.0;
        }
        [redondear(l, 5), redondear(lat.to_degrees(), 5)]
    };
    // cdshealpix devuelve [S, E, N, W]; el contrato usa el orden del ejemplo: N, E, S, W.
    [punto(v[2]), punto(v[1]), punto(v[0]), punto(v[3])]
}

/// El sitio de la Tierra (ST-NN) más cercano a menos de `radio_km`, si lo hay.
fn analogo_conocido(sitios: &Sitios, lat: f64, lon: f64, radio_km: f64) -> Option<String> {
    sitios
        .tierra
        .iter()
        .filter_map(|(id, s)| Some((id, haversine_km(lat, lon, s.lat?, s.lon?))))
        .filter(|(_, d)| *d <= radio_km)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(id, _)| id.clone())
}

fn celda(f: &Fuentes<'_>, rango: usize, m: &Mejor) -> Result<Celda> {
    let fila = usize::try_from(m.fila)?;
    let x: Vec<f64> = f
        .columnas
        .iter()
        .map(|c| {
            c.get(fila)
                .copied()
                .map(f64::from)
                .context("fila fuera de la tabla")
        })
        .collect::<Result<_>>()?;
    let notas = f
        .perfil_nucleo
        .notas_por_variable(&x)?
        .context("la celda candidata no tiene las variables obligatorias")?;
    let coincide = f.perfil_nucleo.coincide(&x)?;
    let nivel = f.nivel_healpix;
    let (lon_c, lat_c) = cdshealpix::nested::center(nivel, u64::from(m.ipix));
    let (lat, lon) = (
        redondear(lat_c.to_degrees(), 5),
        redondear(normalizar_lon(lon_c.to_degrees()), 5),
    );
    let mut variables = BTreeMap::new();
    let mut usadas = 0;
    for (i, nombre) in f.entrada.variables.iter().enumerate() {
        let dato = x.get(i).copied().filter(|v| v.is_finite());
        let nota = notas.get(i).copied().flatten();
        let c = coincide.get(i).copied().flatten();
        // valor, nota y coincide son null juntos (ADR-010, regla 4): se deciden en un solo punto.
        let v = match (dato, nota, c) {
            (Some(v), Some(n), Some(c)) => {
                usadas += 1;
                VarCelda {
                    valor: Some(redondear(v, 4)),
                    nota: Some(redondear(n, 4)),
                    coincide: Some(c),
                }
            }
            _ => VarCelda {
                valor: None,
                nota: None,
                coincide: None,
            },
        };
        variables.insert(nombre.clone(), v);
    }
    Ok(Celda {
        rango,
        ipix: m.ipix,
        centro: Centro { lat, lon },
        vertices: vertices_de(nivel, m.ipix, lon),
        nota: redondear(m.s_tol, 4),
        nota_exacta: redondear(m.s_ex, 4),
        variables,
        cobertura: Cobertura {
            usadas,
            total: f.entrada.variables.len(),
        },
        marcas: vec![MARCA_NDVI_BAJO],
        analogo_conocido: analogo_conocido(f.sitios, lat, lon, f.parametros.radio_documentado_km),
        region: None,
    })
}

/// Arma el resultado del perfil y el sitio con las `n` mejores celdas de `por_region` (ya ordenadas, de mejor a peor).
pub fn resultado(f: &Fuentes<'_>, por_region: &[Mejor], n: usize) -> Result<ResultadoJson> {
    let e = f.entrada;
    let k = e.variables.len();
    let candidatos = por_region
        .iter()
        .take(n)
        .enumerate()
        .map(|(i, m)| celda(f, i + 1, m))
        .collect::<Result<Vec<_>>>()?;
    let mut objetivo = BTreeMap::new();
    let mut variables = Vec::new();
    for (i, nombre) in e.variables.iter().enumerate() {
        let usado = *e.objetivo.get(i).context("objetivo corto")?;
        let real = e
            .fuera_de_alcance
            .iter()
            .find(|(v, _)| v == nombre)
            .map(|(_, r)| redondear(*r, 4));
        objetivo.insert(
            nombre.clone(),
            ValorObjetivo {
                valor: redondear(usado, 4),
                valor_real: real,
            },
        );
        variables.push(VariableParametro {
            id: nombre.clone(),
            peso: 1.0 / f64::from(u32::try_from(k)?),
            tolerancia: redondear(*e.tolerancia.get(i).context("tolerancia corta")?, 4),
            escala: redondear(*e.escala.get(i).context("escala corta")?, 4),
        });
    }
    let correlacion = e.correlacion.chunks(k).map(<[f64]>::to_vec).collect();
    Ok(ResultadoJson {
        version_contrato: VERSION_CONTRATO,
        es_ejemplo: false,
        perfil: e.id_perfil.clone(),
        sitio: e.sitio.clone(),
        healpix: Healpix {
            esquema: "nested",
            nivel: f.nivel_healpix,
        },
        objetivo: ObjetivoJson {
            variables: objetivo,
        },
        parametros: ParametrosJson {
            variables,
            filtros: vec![MARCA_NDVI_BAJO],
            gamma: f.parametros.gamma,
            lambda_contraccion: f.parametros.lambda_contraccion,
            correlacion,
        },
        excluidos_por_indice: f.excluidos_por_indice,
        excluidos_por_separacion: f.excluidos_por_separacion,
        candidatos,
    })
}

// ---------------------------------------------------------------- índice

#[derive(Serialize)]
struct VariableCat {
    id: &'static str,
    codigo: &'static str,
    nombre: &'static str,
    unidad: &'static str,
    aplica_a: &'static [&'static str],
    descripcion: &'static str,
}

#[derive(Serialize)]
struct MarcaCat {
    id: &'static str,
    nombre: &'static str,
    tipo: &'static str,
}

#[derive(Serialize)]
struct PerfilCat {
    id: String,
    nombre: String,
    contra: Vec<String>,
    variables: Vec<String>,
    descripcion: String,
}

#[derive(Serialize)]
struct SitioObjetivoCat {
    id: String,
    nombre: String,
    cuerpo: String,
    centro: Centro,
}

#[derive(Serialize)]
struct AnalogoCat {
    id: String,
    nombre: String,
    centro: Centro,
}

#[derive(Serialize)]
struct Mejora {
    nota: f64,
    centro: Centro,
    region: Option<String>,
}

#[derive(Serialize)]
struct ResumenResultado {
    perfil: String,
    sitio: String,
    archivo: String,
    n_candidatos: usize,
    mejor: Option<Mejora>,
}

#[derive(Serialize)]
struct FuenteCat {
    id: &'static str,
    nombre: &'static str,
    version: &'static str,
    url: &'static str,
    licencia: &'static str,
}

#[derive(Serialize)]
pub struct Indice {
    version_contrato: &'static str,
    generado: String,
    es_ejemplo: bool,
    healpix: Healpix,
    cuerpos: BTreeMap<&'static str, CuerpoJson>,
    variables: Vec<VariableCat>,
    marcas: Vec<MarcaCat>,
    perfiles: Vec<PerfilCat>,
    sitios_objetivo: Vec<SitioObjetivoCat>,
    analogos_conocidos: Vec<AnalogoCat>,
    resultados: Vec<ResumenResultado>,
    fuentes: Vec<FuenteCat>,
}

fn centro_de(s: &Sitio) -> Option<Centro> {
    Some(Centro {
        lat: s.lat?,
        lon: redondear(normalizar_lon(s.lon?), 5),
    })
}

/// Arma `metrics.json` para un solo resultado (un perfil, un sitio).
pub fn indice(f: &Fuentes<'_>, res: &ResultadoJson, generado: String) -> Result<Indice> {
    let e = f.entrada;
    let variables: Vec<VariableCat> = e
        .variables
        .iter()
        .map(|v| {
            CATALOGO
                .iter()
                .find(|c| c.id == v)
                .map(|c| VariableCat {
                    id: c.id,
                    codigo: c.codigo,
                    nombre: c.nombre,
                    unidad: c.unidad,
                    aplica_a: c.aplica_a,
                    descripcion: c.descripcion,
                })
                .with_context(|| format!("la variable `{v}` no está en el catálogo del motor"))
        })
        .collect::<Result<_>>()?;
    let Some(sitio) = f.sitios.objetivo(&e.sitio) else {
        bail!("el sitio {} no está en sitios.json", e.sitio);
    };
    let centro = centro_de(sitio).context("el sitio objetivo no tiene coordenadas")?;
    let primero = res.candidatos.first();
    let archivo = format!("resultados/{}/{}.json", e.id_perfil, e.sitio);
    Ok(Indice {
        version_contrato: VERSION_CONTRATO,
        generado,
        es_ejemplo: false,
        healpix: Healpix { esquema: "nested", nivel: f.nivel_healpix },
        cuerpos: cuerpos(),
        variables,
        marcas: vec![MarcaCat { id: MARCA_NDVI_BAJO, nombre: "NDVI máximo de la climatología con dato y bajo el umbral", tipo: "filtro" }],
        perfiles: vec![PerfilCat {
            id: e.id_perfil.clone(),
            nombre: "Terreno y rango térmico (ensayo)".to_owned(),
            contra: e.contra.clone(),
            variables: e.variables.clone(),
            descripcion: "Perfil del ensayo del ETL (buscar.py): pendiente, rugosidad, relieve, rango térmico diario y amplitud anual. No es uno de los seis perfiles de ADR-008 §3.4.".to_owned(),
        }],
        sitios_objetivo: vec![SitioObjetivoCat { id: e.sitio.clone(), nombre: e.nombre_sitio.clone(), cuerpo: e.cuerpo.clone(), centro }],
        analogos_conocidos: f
            .sitios
            .tierra
            .iter()
            .filter_map(|(id, s)| Some(AnalogoCat { id: id.clone(), nombre: s.nombre.clone(), centro: centro_de(s)? }))
            .collect(),
        resultados: vec![ResumenResultado {
            perfil: e.id_perfil.clone(),
            sitio: e.sitio.clone(),
            archivo,
            n_candidatos: res.candidatos.len(),
            mejor: primero.map(|c| Mejora { nota: c.nota, centro: Centro { lat: c.centro.lat, lon: c.centro.lon }, region: c.region.clone() }),
        }],
        fuentes: vec![
            FuenteCat { id: "glo90", nombre: "Copernicus DEM GLO-90", version: "DGED 2023_1", url: "https://copernicus-dem-90m.s3.amazonaws.com/", licencia: "Licencia de Copernicus DEM (ver contexto/50-referencia)" },
            FuenteCat { id: "myd11c3", nombre: "MODIS Aqua MYD11C3", version: "061", url: "https://lpdaac.usgs.gov/products/myd11c3v061/", licencia: "Dominio público NASA" },
            FuenteCat { id: "mod13c1", nombre: "MODIS Terra MOD13C1", version: "061", url: "https://lpdaac.usgs.gov/products/mod13c1v061/", licencia: "Dominio público NASA" },
        ],
    })
}

/// Escribe `metrics.json` y `resultados/<perfil>/<SL-NN>.json` dentro de `carpeta`. Devuelve los bytes escritos.
pub fn escribir(carpeta: &Path, indice: &Indice, res: &ResultadoJson) -> Result<u64> {
    let ruta_res = carpeta
        .join("resultados")
        .join(&res.perfil)
        .join(format!("{}.json", res.sitio));
    if let Some(padre) = ruta_res.parent() {
        fs::create_dir_all(padre)
            .with_context(|| format!("no se pudo crear {}", padre.display()))?;
    }
    let a = serde_json::to_vec_pretty(indice)?;
    let b = serde_json::to_vec_pretty(res)?;
    fs::write(carpeta.join("metrics.json"), &a).context("no se pudo escribir metrics.json")?;
    fs::write(&ruta_res, &b)
        .with_context(|| format!("no se pudo escribir {}", ruta_res.display()))?;
    Ok(u64::try_from(a.len() + b.len())?)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn fecha_iso_de_instantes_conocidos() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z"); // bisiesto
        assert_eq!(iso_utc(1_793_000_000), "2026-10-26T07:33:20Z");
    }

    #[test]
    fn longitudes_y_distancias() {
        assert!((normalizar_lon(340.8) - (-19.2)).abs() < 1e-12);
        assert!((normalizar_lon(180.0) - (-180.0)).abs() < 1e-12);
        // 1° de latitud ≈ 111,19 km con R = 6371 km.
        assert!((haversine_km(0.0, 0.0, 1.0, 0.0) - 111.19).abs() < 0.01);
    }

    /// `HEALPix`, nivel 0, celda base 0 (casquete polar norte): vértices N en el polo, E y O a 41,8103° (asin 2/3) y S en el
    /// ecuador, con lon 90°, 0° y 45°. Fija el orden [N, E, S, O] y que `cdshealpix` devuelva radianes.
    #[test]
    fn vertices_de_la_celda_base_0() {
        let v = vertices_de(0, 0, 45.0);
        let lat_borde = (2.0_f64 / 3.0).asin().to_degrees();
        assert!((v[0][1] - 90.0).abs() < 1e-4, "N: {:?}", v[0]);
        assert!(
            (v[1][1] - lat_borde).abs() < 1e-4 && (v[1][0] - 90.0).abs() < 1e-4,
            "E: {:?}",
            v[1]
        );
        assert!(
            v[2][1].abs() < 1e-4 && (v[2][0] - 45.0).abs() < 1e-4,
            "S: {:?}",
            v[2]
        );
        assert!(
            (v[3][1] - lat_borde).abs() < 1e-4 && v[3][0].abs() < 1e-4,
            "O: {:?}",
            v[3]
        );
    }

    /// Una celda sobre el meridiano 180 no se parte: las longitudes quedan continuas respecto del centro.
    #[test]
    fn vertices_continuos_sobre_el_meridiano_180() {
        // Celda de nivel 12 que contiene (lat 0, lon 180).
        let ipix = cdshealpix::nested::hash(12, 180.0_f64.to_radians(), 0.0_f64.to_radians());
        let (lon_c, _) = cdshealpix::nested::center(12, ipix);
        let centro = normalizar_lon(lon_c.to_degrees());
        let v = vertices_de(12, u32::try_from(ipix).expect("cabe en u32"), centro);
        let (min, max) = v
            .iter()
            .fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p[0]), b.max(p[0])));
        assert!(
            max - min < 0.1,
            "la celda de ~1,6 km no puede medir {} grados de ancho",
            max - min
        );
    }

    #[test]
    fn redondeo() {
        assert!((redondear(1.234_567, 4) - 1.2346).abs() < 1e-12);
        assert!((redondear(-0.000_04, 4)).abs() < 1e-12);
    }
}
