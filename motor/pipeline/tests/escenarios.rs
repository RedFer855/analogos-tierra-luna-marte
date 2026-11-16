//! `--escenarios` de punta a punta con una tabla sintética en disco (sin datos reales) y, con `--ignored`, con la tabla
//! real: `cargo test -p pipeline --release --test escenarios -- --ignored --nocapture`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use pipeline::barrido::{Mejor, ResultadoEscenario};
use pipeline::ejecutar::{correr, Opciones};
use pipeline::escenarios::{correr_escenarios, robustez, InformeEscenarios};
use serde_json::{json, Value};

const N: usize = 6000;
const VARIABLES: [&str; 6] = [
    "slope_mean_deg",
    "slope_std_deg",
    "rug_rms_mean_m",
    "relieve_mean_m",
    "dtr_k",
    "amp_anual_k",
];
#[expect(
    clippy::expect_used,
    reason = "ayuda de pruebas: un fallo aquí es un fallo de la prueba"
)]
fn escribir(ruta: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(ruta.parent().expect("carpeta")).expect("crear carpeta");
    std::fs::write(ruta, bytes).expect("escribir");
}

/// Una tabla de 6000 celdas con las seis variables, NDVI e `ipix`, y un `analogos.json` con un sitio y un perfil.
fn entorno(nombre: &str) -> Opciones {
    let raiz =
        std::env::temp_dir().join(format!("motor-escenarios-{}-{nombre}", std::process::id()));
    let mut estado = 99u64;
    let mut azar = move || {
        estado = estado
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        f32::from(u16::try_from(estado >> 48).unwrap_or(0)) / 65536.0
    };
    let columna =
        |azar: &mut dyn FnMut() -> f32, falta: f32, centro: f32, ancho: f32| -> Vec<f32> {
            (0..N)
                .map(|_| {
                    if azar() < falta {
                        f32::NAN
                    } else {
                        centro + ancho * (azar() - 0.5)
                    }
                })
                .collect()
        };
    for (i, v) in VARIABLES.iter().enumerate() {
        let datos = columna(&mut azar, if i < 4 { 0.02 } else { 0.1 }, 10.0, 4.0);
        escribir(
            &raiz.join(format!("maestro/{v}.f32")),
            bytemuck::cast_slice(&datos),
        );
    }
    let ndvi = columna(&mut azar, 0.05, 0.3, 0.6);
    escribir(
        &raiz.join("maestro/ndvi_max_clim.f32"),
        bytemuck::cast_slice(&ndvi),
    );
    let ipix: Vec<u32> = (0..N)
        .map(|i| 3 * u32::try_from(i).unwrap_or(0) + 5)
        .collect();
    escribir(&raiz.join("maestro/ipix.u32"), bytemuck::cast_slice(&ipix));
    let manifiesto = json!({"n_celdas": N, "healpix": {"nivel": 12}});
    escribir(
        &raiz.join("maestro/manifest.json"),
        manifiesto.to_string().as_bytes(),
    );
    let por_variable = |x: f64| -> Value {
        VARIABLES
            .iter()
            .map(|v| ((*v).to_owned(), json!(x)))
            .collect()
    };
    let correlacion: Vec<Vec<f64>> = (0..6)
        .map(|i| (0..6).map(|j| if i == j { 1.0 } else { 0.2 }).collect())
        .collect();
    let analogos = json!({
        "parametros": {"gamma": 0.5, "lambda_contraccion": 0.1, "ndvi_max_principal": 0.3, "s_coincide": 0.9,
                       "nivel_region": 8, "radio_documentado_km": 50.0},
        "maestro": {"n_celdas": N, "generado": "prueba"},
        "objetivos": {"SL-99": {"nombre": "Sitio de prueba", "cuerpo": "marte", "perfiles": {"p": {
            "variables": VARIABLES, "objetivo": por_variable(10.0), "tolerancia": por_variable(0.8),
            "escala_tierra": por_variable(1.0), "correlacion": correlacion, "celdas_que_coinciden_en_la_tierra": 0}}}}
    });
    escribir(&raiz.join("analogos.json"), analogos.to_string().as_bytes());
    let mut o = Opciones::por_omision();
    (o.maestro, o.analogos, o.salida) = (
        raiz.join("maestro"),
        raiz.join("analogos.json"),
        raiz.join("salida"),
    );
    (o.objetivo, o.perfil, o.candidatos) = ("SL-99".to_owned(), "p".to_owned(), 15);
    o
}

fn archivo(o: &Opciones, nombre: &str, contenido: &Value) -> PathBuf {
    let ruta = o.salida.join(nombre);
    escribir(&ruta, contenido.to_string().as_bytes());
    ruta
}

#[expect(
    clippy::expect_used,
    clippy::indexing_slicing,
    reason = "ayuda de pruebas: un fallo aquí es un fallo de la prueba"
)]
fn como_json(i: &InformeEscenarios) -> (Value, Value) {
    let v = serde_json::to_value(i).expect("JSON");
    (v["escenarios"].clone(), v["robustez"].clone())
}

#[test]
fn un_escenario_da_lo_mismo_que_la_corrida_normal() {
    let mut o = entorno("uno");
    o.solo_barrido = true;
    let normal = correr(&o).expect("corrida normal");
    assert!(
        normal.coinciden > 0 && normal.regiones_con_candidato > 15,
        "la tabla sintética no sirve"
    );
    let ruta = archivo(
        &o,
        "uno.json",
        &json!({"escenarios": [{"id": "base", "objetivo": "SL-99", "perfil": "p"}]}),
    );
    let i = correr_escenarios(&o, &ruta).expect("escenarios");
    let e = &i.escenarios[0];
    assert_eq!(
        (
            e.elegibles,
            e.completas,
            e.coinciden,
            e.coinciden_incompletas
        ),
        (
            normal.elegibles,
            normal.completas,
            normal.coinciden,
            normal.coinciden_incompletas
        )
    );
    assert_eq!(
        usize::try_from(e.regiones_con_candidato).expect("regiones"),
        normal.regiones_con_candidato
    );
    assert_eq!(
        e.nota_mejor.map(f64::to_bits),
        normal.nota_mejor.map(f64::to_bits)
    );
    assert_eq!(
        e.nota_peor_candidato.map(f64::to_bits),
        normal.nota_peor_escrita.map(f64::to_bits)
    );
    // Con un solo escenario cada candidato aparece en 1 de 1, y el archivo escrito trae los mismos candidatos.
    let candidatos = &i.robustez["SL-99"];
    assert_eq!(candidatos.len(), 15);
    assert!(candidatos
        .iter()
        .all(|c| c.aparece_en == 1 && (c.fraccion - 1.0).abs() < 1e-12));
    let escrito: Value =
        serde_json::from_slice(&std::fs::read(&i.medicion.salida).expect("leer")).expect("JSON");
    let del_archivo: Vec<u64> = escrito["robustez"]["SL-99"]
        .as_array()
        .expect("robustez")
        .iter()
        .filter_map(|c| c["ipix"].as_u64())
        .collect();
    let del_informe: Vec<u64> = candidatos.iter().map(|c| u64::from(c.ipix)).collect();
    assert_eq!(del_archivo, del_informe);
}

#[test]
fn rechaza_variables_que_el_perfil_no_tiene_y_campos_desconocidos() {
    let o = entorno("errores");
    let base = json!({"id": "x", "objetivo": "SL-99", "perfil": "p"});
    for (campo, valor) in [
        ("variables", json!(["aridez_ai"])),
        ("pesos", json!({"aridez_ai": 2.0})),
        ("tolerancias", json!(1)),
    ] {
        let mut e = base.clone();
        e[campo] = valor;
        let error = correr_escenarios(&o, &archivo(&o, "malo.json", &json!({"escenarios": [e]})));
        assert!(error.is_err(), "debería rechazar `{campo}`");
    }
}

#[test]
fn la_robustez_cuenta_en_cuantos_escenarios_aparece_cada_region() {
    let m = |ipix: u32, s_tol: f64| Mejor {
        s_tol,
        s_ex: s_tol,
        fila: ipix,
        ipix,
    };
    let r = |mejores: Vec<Mejor>| ResultadoEscenario {
        mejores,
        ..ResultadoEscenario::default()
    };
    // Regiones de 256 celdas: la 0 sale en los tres escenarios (dos veces con la celda 7) y la 1 solo en uno.
    let (a, b, c) = (
        r(vec![m(7, 1.0), m(300, 0.8)]),
        r(vec![m(9, 0.9)]),
        r(vec![m(7, 0.95)]),
    );
    let rob = robustez(&[&a, &b, &c], 8, 12);
    assert_eq!(rob.len(), 2);
    assert_eq!((rob[0].region, rob[0].ipix, rob[0].aparece_en), (0, 7, 3));
    assert!((rob[0].fraccion - 1.0).abs() < 1e-12 && (rob[0].s_mediana - 0.95).abs() < 1e-12);
    assert!((rob[0].s_min - 0.9).abs() < 1e-12 && (rob[0].s_max - 1.0).abs() < 1e-12);
    assert_eq!((rob[1].region, rob[1].ipix, rob[1].aparece_en), (1, 300, 1));
    assert!((rob[1].fraccion - 1.0 / 3.0).abs() < 1e-12);
}

/// Con la tabla real: un solo escenario da lo mismo que la corrida normal (88 938 celdas con S ≥ 0,9 con los números
/// redondeados de `analogos.json` y los mismos 200 candidatos), y el informe no cambia con el número de hilos.
#[test]
#[ignore = "necesita la tabla real en $RUN/maestro"]
fn con_la_tabla_real_un_escenario_da_lo_mismo_que_la_corrida_normal() {
    let mut o = Opciones::por_omision();
    o.salida = std::env::temp_dir().join(format!("motor-escenarios-{}-real", std::process::id()));
    let normal = correr(&o).expect("corrida normal");
    let escrito =
        std::fs::read(o.salida.join("resultados/terreno_termico/SL-12.json")).expect("resultado");
    let resultado: Value = serde_json::from_slice(&escrito).expect("JSON");
    let de_la_corrida: BTreeSet<u64> = resultado["candidatos"]
        .as_array()
        .expect("candidatos")
        .iter()
        .filter_map(|c| c["ipix"].as_u64())
        .collect();

    let base = json!({"id": "base", "objetivo": "SL-12", "perfil": "terreno_termico"});
    let solo = correr_escenarios(
        &o,
        &archivo(&o, "base.json", &json!({"escenarios": [base]})),
    )
    .expect("escenarios");
    let e = &solo.escenarios[0];
    assert_eq!((e.elegibles, e.coinciden), (12_262_816, 88_938));
    assert_eq!(
        (
            e.elegibles,
            e.completas,
            e.coinciden,
            e.coinciden_incompletas
        ),
        (
            normal.elegibles,
            normal.completas,
            normal.coinciden,
            normal.coinciden_incompletas
        )
    );
    assert_eq!(
        usize::try_from(e.regiones_con_candidato).expect("regiones"),
        normal.regiones_con_candidato
    );
    let del_escenario: BTreeSet<u64> = solo.robustez["SL-12"]
        .iter()
        .map(|c| u64::from(c.ipix))
        .collect();
    assert_eq!(del_escenario.len(), 200);
    assert_eq!(del_escenario, de_la_corrida, "los mismos 200 candidatos");

    // Tres escenarios distintos (subconjunto, tolerancia, pesos y NDVI): el informe es igual con 1 y con 4 hilos.
    let terreno = &VARIABLES[..4];
    let variantes = json!({"escenarios": [
        {"id": "base", "objetivo": "SL-12", "perfil": "terreno_termico"},
        {"id": "terreno", "objetivo": "SL-12", "perfil": "terreno_termico", "variables": terreno,
         "factor_tolerancia": 0.5, "ndvi_max": 0.2},
        {"id": "pesa-dtr", "objetivo": "SL-12", "perfil": "terreno_termico", "pesos": {"dtr_k": 3.0}, "ndvi_max": 0.4}]});
    let ruta = archivo(&o, "variantes.json", &variantes);
    let con = |hilos: usize| {
        let mut o = o.clone();
        o.hilos = Some(hilos);
        correr_escenarios(&o, &ruta).expect("escenarios")
    };
    let (uno, cuatro) = (con(1), con(4));
    println!(
        "{}",
        serde_json::to_string_pretty(&cuatro.medicion).expect("JSON")
    );
    assert_eq!(como_json(&uno), como_json(&cuatro));
    assert_eq!(como_json(&uno).0[0]["coinciden"], json!(88_938));
    assert!(uno
        .escenarios
        .iter()
        .all(|e| e.coinciden > 0 && e.regiones_con_candidato > 200));
}

// --- Muestreo por grupos físicos ---

const GRUPOS: [(&str, &[&str]); 3] = [
    ("pendiente", &["slope_mean_deg", "slope_std_deg"]),
    ("termico", &["dtr_k", "amp_anual_k"]),
    ("sin_uso", &["aridez_ai"]),
];

fn muestreo(n: usize, semilla: u64) -> Value {
    let grupos: Value = GRUPOS
        .iter()
        .map(|(g, cols)| ((*g).to_owned(), json!(cols)))
        .collect();
    json!({"muestreo": {"objetivos": ["SL-99"], "perfil": "p", "n": n, "semilla": semilla, "k_min": 2, "k_max": 4,
        "factores_tolerancia": [0.5, 1.0, 2.0], "ndvi_max": [0.2, 0.3, 0.4], "peso_realce": 2.0, "grupos": grupos}})
}

/// El grupo físico de una variable; la que no está en ninguno forma el suyo.
fn grupo(v: &str) -> &str {
    GRUPOS
        .iter()
        .find(|(_, cols)| cols.contains(&v))
        .map_or(v, |(g, _)| g)
}

#[test]
fn el_muestreo_reparte_por_grupos_y_se_repite_con_la_misma_semilla() {
    let o = entorno("muestreo");
    let i = correr_escenarios(&o, &archivo(&o, "m.json", &muestreo(12, 1))).expect("escenarios");
    assert_eq!(i.escenarios.len(), 12);
    let mut distintos = BTreeSet::new();
    for e in &i.escenarios {
        let d = &e.definicion;
        let grupos: BTreeSet<&str> = d.variables.iter().map(|v| grupo(v)).collect();
        // Hay cuatro grupos (dos del archivo y dos variables sueltas): con k ≤ 4 nunca se repite un grupo.
        assert!(
            (2..=4).contains(&d.variables.len()) && grupos.len() == d.variables.len(),
            "{d:?}"
        );
        assert!(d.pesos.keys().all(|v| d.variables.contains(v)), "{d:?}");
        distintos.insert(format!(
            "{:?}",
            (
                &d.variables,
                d.factor_tolerancia.to_bits(),
                d.ndvi_max,
                &d.pesos
            )
        ));
    }
    assert_eq!(distintos.len(), 12, "escenarios repetidos");
    let apariciones: usize = i.robustez["SL-99"].iter().map(|c| c.aparece_en).sum();
    let esperadas: u64 = i
        .escenarios
        .iter()
        .map(|e| e.regiones_con_candidato.min(15))
        .sum();
    assert_eq!(u64::try_from(apariciones).expect("apariciones"), esperadas);
    assert!(i.robustez["SL-99"]
        .windows(2)
        .all(|p| p[0].aparece_en >= p[1].aparece_en));

    let otra_vez =
        correr_escenarios(&o, &archivo(&o, "m.json", &muestreo(12, 1))).expect("escenarios");
    assert_eq!(como_json(&i), como_json(&otra_vez));
    let otra_semilla =
        correr_escenarios(&o, &archivo(&o, "m2.json", &muestreo(12, 2))).expect("escenarios");
    assert_ne!(como_json(&i).0, como_json(&otra_semilla).0);
}

/// El ejemplo del repo (`motor/escenarios/muestreo-sl12.json`) recortado a 6 escenarios muestreados más el base: corre
/// con la tabla real y da lo mismo con 1 y con 4 hilos.
#[test]
#[ignore = "necesita la tabla real en $RUN/maestro"]
fn el_ejemplo_del_repo_corre_con_la_tabla_real_y_no_depende_de_los_hilos() {
    let mut o = Opciones::por_omision();
    o.salida = std::env::temp_dir().join(format!("motor-muestreo-{}-real", std::process::id()));
    let ejemplo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../escenarios/muestreo-sl12.json");
    let mut spec: Value =
        serde_json::from_slice(&std::fs::read(ejemplo).expect("ejemplo")).expect("JSON");
    spec["muestreo"]["n"] = json!(6);
    let ruta = archivo(&o, "ejemplo.json", &spec);
    let con = |hilos: usize| {
        let mut o = o.clone();
        o.hilos = Some(hilos);
        correr_escenarios(&o, &ruta).expect("escenarios")
    };
    let (uno, cuatro) = (con(1), con(4));
    println!(
        "{}",
        serde_json::to_string_pretty(&cuatro.medicion).expect("JSON")
    );
    assert_eq!(uno.escenarios.len(), 7);
    assert_eq!(como_json(&uno), como_json(&cuatro));
    assert_eq!(como_json(&uno).0[0]["coinciden"], json!(88_938));
    let variables = |e: &pipeline::escenarios::FilaEscenario| e.definicion.variables.len();
    assert!(uno
        .escenarios
        .iter()
        .skip(1)
        .all(|e| (4..=8).contains(&variables(e))));
}
