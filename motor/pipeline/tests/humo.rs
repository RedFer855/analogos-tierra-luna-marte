//! Prueba de humo con la tabla real (58,7 millones de celdas). Está `ignore` porque necesita `D:/PP/ANALOGOS-run/etl`
//! (o `$RUN`), que no está en git:
//!
//! ```text
//! cargo test -p pipeline --release -- --ignored --nocapture
//! ```
//!
//! Los números de referencia salen de `scripts/motor/comparar_con_oraculo.py` (numpy, independiente del motor), corrido el
//! 2026-11-12 sobre la tabla v2 (`maestro/manifest.json`, generado 2026-11-12 11:46).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use pipeline::ejecutar::{correr, Opciones};
use pipeline::tabla::Tabla;

/// Celdas con S ≥ 0,9 que dan el motor y numpy con los números REDONDEADOS que trae `analogos.json` (y τ, s, y a 4
/// decimales; R a 3). El oráculo cuenta 88 916 con los números sin redondear; la diferencia (+22) es el redondeo.
const COINCIDEN_CON_LOS_NUMEROS_DE_ANALOGOS_JSON: u64 = 88_938;
/// Filas elegibles: `principal_ndvi<=0.30` de `analogos.json > filtros`.
const ELEGIBLES: u64 = 12_262_816;

#[expect(
    clippy::expect_used,
    reason = "ayuda de pruebas: un fallo aquí es un fallo de la prueba"
)]
fn temporal(nombre: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("motor-humo-{}-{nombre}", std::process::id()));
    std::fs::create_dir_all(&d).expect("carpeta temporal");
    d
}

fn opciones(nombre: &str) -> Opciones {
    let mut o = Opciones::por_omision();
    o.salida = temporal(nombre);
    o
}

#[expect(
    clippy::expect_used,
    reason = "ayuda de pruebas: un fallo aquí es un fallo de la prueba"
)]
fn leer(ruta: &Path) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(ruta).expect("archivo")).expect("JSON")
}

#[test]
#[ignore = "necesita la tabla real en $RUN/maestro"]
fn el_barrido_de_58_7_millones_de_celdas_da_lo_medido_con_numpy() {
    let i = correr(&opciones("conteo")).expect("corrida");
    println!("{}", serde_json::to_string_pretty(&i).expect("JSON"));
    assert_eq!(i.n_celdas, 58_700_374);
    assert_eq!(i.elegibles, ELEGIBLES, "filas elegibles");
    assert_eq!(
        i.coinciden, COINCIDEN_CON_LOS_NUMEROS_DE_ANALOGOS_JSON,
        "celdas con S >= 0,9 con los números de analogos.json"
    );
    assert_eq!(i.oraculo_coinciden, 88_916, "lo que dice analogos.json");
    assert_eq!(i.diferencia_con_el_oraculo, 22);
    assert_eq!(i.candidatos_escritos, 200);
    assert!(i.regiones_con_candidato >= 200);
    assert!((i.nota_mejor.expect("hay candidatos") - 1.0).abs() < 1e-12);
}

/// Con los números sin redondear que usó el oráculo (`comparar_con_oraculo.py generar`), el motor da su mismo conteo.
#[test]
#[ignore = "necesita la tabla real y el exacto.json que genera comparar_con_oraculo.py"]
fn con_los_numeros_sin_redondear_el_motor_da_el_conteo_del_oraculo() {
    let mut o = opciones("exacto");
    let exacto = o
        .maestro
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
        .join("motor/verificacion/exacto.json");
    assert!(exacto.exists(), "falta {}: corre `python -I scripts/motor/comparar_con_oraculo.py generar <carpeta>` primero", exacto.display());
    o.perfil_json = Some(exacto);
    let i = correr(&o).expect("corrida");
    assert_eq!(i.oraculo_coinciden, 88_916);
    assert_eq!(
        i.coinciden, 88_916,
        "el motor reproduce el conteo del oráculo con los mismos números"
    );
    assert_eq!(i.diferencia_con_el_oraculo, 0);
}

#[test]
#[ignore = "necesita la tabla real en $RUN/maestro"]
fn el_resultado_es_el_mismo_con_1_y_con_4_hilos() {
    let (mut a, mut b) = (opciones("h1"), opciones("h4"));
    a.hilos = Some(1);
    b.hilos = Some(4);
    let (ia, ib) = (correr(&a).expect("1 hilo"), correr(&b).expect("4 hilos"));
    assert_eq!(
        (ia.elegibles, ia.completas, ia.coinciden),
        (ib.elegibles, ib.completas, ib.coinciden)
    );
    let ruta = |o: &Opciones| o.salida.join("resultados/terreno_termico/SL-12.json");
    assert_eq!(
        leer(&ruta(&a))["candidatos"],
        leer(&ruta(&b))["candidatos"],
        "mismos candidatos, mismo orden"
    );
}

/// I-42: `cdshealpix::nested::center` devuelve radianes con la longitud en [0, 2π); comprobado contra las columnas lat/lon
/// de la tabla (que salieron del paquete de Python `cdshealpix`) en una fila de cada 50 000.
#[test]
#[ignore = "necesita la tabla real en $RUN/maestro"]
fn cdshealpix_en_rust_coincide_con_lat_lon_de_la_tabla() {
    let o = Opciones::por_omision();
    let t = Tabla::abrir(&o.maestro).expect("tabla");
    let (ipix, lat, lon) = (
        t.u32("ipix").expect("ipix"),
        t.f32("lat").expect("lat"),
        t.f32("lon").expect("lon"),
    );
    let (mut max_lat, mut max_lon): (f64, f64) = (0.0, 0.0);
    for i in (0..t.n_celdas).step_by(50_000) {
        let (lon_r, lat_r) = cdshealpix::nested::center(t.nivel_healpix, u64::from(ipix.u32s()[i]));
        let lon_d = (lon_r.to_degrees() + 180.0).rem_euclid(360.0) - 180.0;
        max_lat = max_lat.max((lat_r.to_degrees() - f64::from(lat.f32s()[i])).abs());
        max_lon = max_lon.max((lon_d - f64::from(lon.f32s()[i])).abs());
    }
    println!("máxima diferencia con la tabla: lat {max_lat:.2e}°, lon {max_lon:.2e}°");
    assert!(max_lat < 1e-4 && max_lon < 1e-4);
}

/// La salida cumple los esquemas y las reglas del contrato (`contrato/contrato.test.js`, con `METRICS_DIR`).
#[test]
#[ignore = "necesita la tabla real en $RUN/maestro y node"]
fn la_salida_cumple_el_contrato_de_adr_010() {
    let o = opciones("contrato");
    correr(&o).expect("corrida");
    let raiz = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let salida = Command::new("node")
        .args(["--test", "contrato/contrato.test.js"])
        .current_dir(&raiz)
        .env("METRICS_DIR", &o.salida)
        .output()
        .expect("node en el PATH");
    let texto = String::from_utf8_lossy(&salida.stdout);
    assert!(
        salida.status.success(),
        "el contrato falló:\n{texto}\n{}",
        String::from_utf8_lossy(&salida.stderr)
    );
    assert!(
        texto.contains("salida del motor"),
        "la prueba no llegó a validar la salida:\n{texto}"
    );

    // Además: 200 candidatos distintos, vértices cerca del centro y valores nulos juntos.
    let res = leer(&o.salida.join("resultados/terreno_termico/SL-12.json"));
    let c = res["candidatos"].as_array().expect("candidatos");
    assert_eq!(c.len(), 200);
    let ipix: HashSet<u64> = c
        .iter()
        .map(|x| x["ipix"].as_u64().expect("ipix"))
        .collect();
    assert_eq!(ipix.len(), 200, "una celda por región: sin repetidas");
}
