//! El núcleo contra valores de referencia de numpy (el oráculo de ADR-004), sobre filas reales de la tabla maestra.
//! `referencia_numpy.txt` lo genera `scripts/motor/comparar_con_oraculo.py referencia`; corre sin datos y sin Python.

use nucleo::{Entrada, Perfil};

const REFERENCIA: &str = include_str!("referencia_numpy.txt");

#[expect(
    clippy::expect_used,
    reason = "ayuda de pruebas: un número mal escrito es un fallo de la prueba"
)]
fn numeros(linea: &str, clave: &str) -> Vec<f64> {
    let resto = linea.strip_prefix(clave).expect("clave");
    resto
        .split_whitespace()
        .map(|t| t.parse::<f64>().expect("número"))
        .collect()
}

fn casi(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol * (1.0 + a.abs().max(b.abs()))
}

#[test]
fn el_nucleo_coincide_con_numpy_en_filas_reales() {
    let mut p: [Vec<f64>; 7] = Default::default(); // gamma, lambda, objetivo, tolerancia, escala, correlacion, (reserva)
    let mut filas = Vec::new();
    for linea in REFERENCIA
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
    {
        match linea.split_whitespace().next().expect("clave") {
            "gamma" => p[0] = numeros(linea, "gamma"),
            "lambda" => p[1] = numeros(linea, "lambda"),
            "objetivo" => p[2] = numeros(linea, "objetivo"),
            "tolerancia" => p[3] = numeros(linea, "tolerancia"),
            "escala" => p[4] = numeros(linea, "escala"),
            "correlacion" => p[5] = numeros(linea, "correlacion"),
            "fila" => filas.push(linea.strip_prefix("fila ").expect("fila")),
            _ => {}
        }
    }
    assert_eq!(filas.len(), 9);
    let k = p[2].len();
    let perfil = Perfil::nuevo(&Entrada {
        objetivo: &p[2],
        tolerancia: &p[3],
        escala: &p[4],
        correlacion: &p[5],
        pesos: None,
        gamma: p[0][0],
        lambda: p[1][0],
        obligatorias: 0b1111,
    })
    .expect("perfil");

    for (n, fila) in filas.iter().enumerate() {
        let partes: Vec<&str> = fila.split('|').collect();
        let x: Vec<f32> = partes[0]
            .split_whitespace()
            .map(|t| t.parse::<f32>().expect("f32"))
            .collect();
        let s: Vec<f64> = partes[1]
            .split_whitespace()
            .map(|t| t.parse().expect("S"))
            .collect();
        let notas: Vec<f64> = partes[2]
            .split_whitespace()
            .map(|t| t.parse().expect("nota"))
            .collect();
        assert_eq!((x.len(), notas.len()), (k, k));

        let tolerante = perfil.puntuar_tolerante(&x).unwrap().expect("puntuable");
        let exacta = perfil.puntuar_exacta(&x).unwrap().expect("puntuable");
        assert!(
            casi(tolerante.s, s[0], 1e-12),
            "fila {n}: S con tolerancia {} frente a numpy {}",
            tolerante.s,
            s[0]
        );
        assert!(
            casi(exacta.s, s[1], 1e-12),
            "fila {n}: S sin tolerancia {} frente a numpy {}",
            exacta.s,
            s[1]
        );

        let x64: Vec<f64> = x.iter().map(|v| f64::from(*v)).collect();
        let mias = perfil.notas_por_variable(&x64).unwrap().expect("puntuable");
        for (i, (mia, suya)) in mias.iter().zip(&notas).enumerate() {
            match mia {
                Some(m) => assert!(
                    casi(*m, *suya, 1e-12),
                    "fila {n}, variable {i}: nota {m} frente a numpy {suya}"
                ),
                None => assert!(
                    suya.is_nan(),
                    "fila {n}, variable {i}: el motor no da nota y numpy sí"
                ),
            }
        }
    }
}
