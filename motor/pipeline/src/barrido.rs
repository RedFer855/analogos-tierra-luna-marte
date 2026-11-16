#![expect(
    clippy::indexing_slicing,
    reason = "camino caliente de 58,7 millones de filas: todas las columnas miden n filas (se comprueba en `Config::validar` y en `Compartido::validar`) y los índices salen de 0..n"
)]
//! Barrido de la tabla: filtros de elegibilidad, puntaje y la mejor celda de cada región de nivel 6.
//!
//! Filtros de elegibilidad, los de la clase principal de `analogos.json` (`principal_ndvi<=0.30`): la celda debe traer todas
//! las variables de terreno (`obligatorias` del perfil) y un NDVI máximo con dato y no mayor que `ndvi_max`. Una celda sin
//! dato de NDVI no es elegible (el JSON la cuenta aparte en `sin_ndvi`); la versión de `buscar.py` que hay en el repo todavía
//! la deja pasar, y esa diferencia explica por qué sus escalas no coinciden con las del JSON.
//! Determinista con cualquier número de hilos: las sumas son enteros y los máximos usan un orden total.

use std::cmp::Ordering;
use std::ops::Range;

use nucleo::{a_f32, ErrorPerfil, Perfil, MAX_VARS};
use rayon::prelude::*;

use crate::geo::{centro_celda, haversine_km, vector_unitario, RADIO_TIERRA_KM};
use crate::indice::FiltroIndice;

/// Filas por tarea de rayon: 262 144 filas × 4 B = 1 MB por columna.
pub const FILAS_POR_TAREA: usize = 1 << 18;

/// Lo que el barrido necesita. Todas las columnas miden lo mismo (`n` filas).
pub struct Config<'a> {
    pub perfil: &'a Perfil,
    /// Una columna por variable del perfil, en el orden del perfil.
    pub columnas: &'a [&'a [f32]],
    /// `ndvi_max_clim`.
    pub ndvi: &'a [f32],
    pub ipix: &'a [u32],
    /// Las celdas con NDVI mayor que esto, o sin dato (`NaN`), salen.
    pub ndvi_max: f32,
    /// Una celda «coincide» si su S (guardada en `f32`, como en el oráculo) llega a este umbral.
    pub s_coincide: f32,
    /// Nivel de `HEALPix` de las regiones (6 en el ensayo) y de la tabla (12).
    pub nivel_region: u32,
    pub nivel_celda: u32,
}

impl Config<'_> {
    fn n(&self) -> usize {
        self.ipix.len()
    }

    fn n_regiones(&self) -> usize {
        12usize << (2 * self.nivel_region)
    }

    fn desplazamiento(&self) -> u32 {
        2 * (self.nivel_celda - self.nivel_region)
    }

    /// Comprueba que las columnas midan lo mismo y que el perfil y las columnas coincidan en número de variables.
    pub fn validar(&self) -> Result<(), String> {
        let n = self.n();
        if self.columnas.len() != self.perfil.k()
            || self.columnas.is_empty()
            || self.columnas.len() > MAX_VARS
        {
            return Err(format!(
                "{} columnas para un perfil de {} variables",
                self.columnas.len(),
                self.perfil.k()
            ));
        }
        if self.ndvi.len() != n || self.columnas.iter().any(|c| c.len() != n) {
            return Err("las columnas no miden lo mismo".to_owned());
        }
        if u32::try_from(n).is_err() {
            return Err("más filas de las que caben en u32".to_owned());
        }
        if self.nivel_region > self.nivel_celda || self.nivel_celda > 29 {
            return Err("niveles de HEALPix imposibles".to_owned());
        }
        Ok(())
    }
}

/// La mejor celda de una región.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mejor {
    /// S con tolerancia (la nota).
    pub s_tol: f64,
    /// S sin tolerancia: desempata las celdas que la tolerancia deja empatadas en 1.
    pub s_ex: f64,
    pub fila: u32,
    pub ipix: u32,
}

const VACIO: Mejor = Mejor {
    s_tol: f64::NEG_INFINITY,
    s_ex: f64::NEG_INFINITY,
    fila: u32::MAX,
    ipix: u32::MAX,
};

impl Mejor {
    /// Orden total: mayor S con tolerancia, luego mayor S sin tolerancia, luego menor `ipix`. `Greater` = mejor.
    #[must_use]
    pub fn comparar(&self, otro: &Self) -> Ordering {
        self.s_tol
            .total_cmp(&otro.s_tol)
            .then(self.s_ex.total_cmp(&otro.s_ex))
            .then(otro.ipix.cmp(&self.ipix))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Cuentas {
    /// Filas con todas las variables obligatorias y NDVI con dato que pasa el filtro (la clase principal del oráculo).
    pub elegibles: u64,
    /// De ellas, las que traen las k variables.
    pub completas: u64,
    /// Completas con S ≥ umbral: el número que el oráculo llama `celdas_que_coinciden_en_la_tierra`.
    pub coinciden: u64,
    /// Elegibles con alguna variable faltante y S ≥ umbral (el oráculo las lista aparte).
    pub coinciden_incompletas: u64,
    /// Celdas completas y elegibles descartadas por el índice de exclusión.
    pub excluidos_por_indice: u64,
    /// Regiones candidatas descartadas por separación mínima entre candidatos.
    pub excluidos_por_separacion: u64,
}

impl Cuentas {
    fn sumar(&mut self, otro: &Self) {
        self.elegibles += otro.elegibles;
        self.completas += otro.completas;
        self.coinciden += otro.coinciden;
        self.coinciden_incompletas += otro.coinciden_incompletas;
        self.excluidos_por_indice += otro.excluidos_por_indice;
        self.excluidos_por_separacion += otro.excluidos_por_separacion;
    }
}

/// Filtros opcionales de exclusión por índice y separación entre candidatos.
#[derive(Default, Clone, Copy)]
pub struct Filtros<'a> {
    pub indice: Option<&'a FiltroIndice<'a>>,
    pub separacion_km: Option<f64>,
}

/// Toma candidatos en orden total y descarta los que están a menos de `separacion_km` de otro ya aceptado.
/// Devuelve cuántos fueron descartados.
pub fn suprimir_por_separacion(
    candidatos: &mut Vec<Mejor>,
    separacion_km: f64,
    nivel_celda: u8,
) -> u64 {
    if !separacion_km.is_finite() || separacion_km <= 0.0 || candidatos.len() <= 1 {
        return 0;
    }
    let umbral = separacion_km / RADIO_TIERRA_KM;
    let cos_umbral = (umbral < std::f64::consts::PI).then(|| umbral.cos() - 1e-6);
    let mut aceptados = Vec::with_capacity(candidatos.len());
    let mut coords: Vec<(f64, f64, [f64; 3])> = Vec::with_capacity(candidatos.len());
    let mut excluidos = 0u64;
    for m in candidatos.drain(..) {
        let (lat, lon) = centro_celda(nivel_celda, m.ipix);
        let u = vector_unitario(lat, lon);
        let cerca = coords.iter().any(|&(alat, alon, au)| {
            if let Some(c) = cos_umbral {
                let dot = u[0] * au[0] + u[1] * au[1] + u[2] * au[2];
                if dot < c {
                    return false;
                }
            }
            haversine_km(lat, lon, alat, alon) < separacion_km
        });
        if cerca {
            excluidos += 1;
        } else {
            aceptados.push(m);
            coords.push((lat, lon, u));
        }
    }
    *candidatos = aceptados;
    excluidos
}

struct Acum {
    cuentas: Cuentas,
    mejores: Vec<Mejor>,
}

impl Acum {
    fn nuevo(n_regiones: usize) -> Self {
        Self {
            cuentas: Cuentas::default(),
            mejores: vec![VACIO; n_regiones],
        }
    }

    fn unir(mut self, otro: &Self) -> Self {
        self.cuentas.sumar(&otro.cuentas);
        for (a, b) in self.mejores.iter_mut().zip(&otro.mejores) {
            if b.comparar(a) == Ordering::Greater {
                *a = *b;
            }
        }
        self
    }

    fn procesar(
        &mut self,
        cfg: &Config<'_>,
        indice: Option<&FiltroIndice<'_>>,
        filas: Range<usize>,
    ) -> Result<(), ErrorPerfil> {
        let k = cfg.perfil.k();
        let completa = (1u16 << k) - 1;
        let desplazamiento = cfg.desplazamiento();
        let mut x = [f32::NAN; MAX_VARS];
        for i in filas {
            if cfg.ndvi[i].is_nan() || cfg.ndvi[i] > cfg.ndvi_max {
                continue;
            }
            for (valor, col) in x.iter_mut().zip(cfg.columnas) {
                *valor = col[i];
            }
            let Some(p) = cfg.perfil.puntuar_tolerante(&x[..k])? else {
                continue;
            };
            self.cuentas.elegibles += 1;
            let es_completa = p.mascara == completa;
            if es_completa {
                self.cuentas.completas += 1;
            }
            if a_f32(p.s) >= cfg.s_coincide {
                if es_completa {
                    self.cuentas.coinciden += 1;
                } else {
                    self.cuentas.coinciden_incompletas += 1;
                }
            }
            if !es_completa {
                continue;
            }
            let ipix = cfg.ipix[i];
            if indice.is_some_and(|f| f.excluye_celda(ipix)) {
                self.cuentas.excluidos_por_indice += 1;
                continue;
            }
            let Some(hueco) = self
                .mejores
                .get_mut(usize::try_from(ipix >> desplazamiento).unwrap_or(usize::MAX))
            else {
                continue;
            };
            if p.s < hueco.s_tol {
                continue;
            }
            let s_ex = cfg
                .perfil
                .puntuar_exacta(&x[..k])?
                .map_or(f64::NEG_INFINITY, |q| q.s);
            let fila = u32::try_from(i).unwrap_or(u32::MAX);
            let candidata = Mejor {
                s_tol: p.s,
                s_ex,
                fila,
                ipix,
            };
            if candidata.comparar(hueco) == Ordering::Greater {
                *hueco = candidata;
            }
        }
        Ok(())
    }
}

/// Resultado del barrido.
#[derive(Debug)]
pub struct Barrido {
    pub n_filas: usize,
    pub cuentas: Cuentas,
    /// La mejor celda de cada región que tiene alguna celda completa y elegible, de mejor a peor.
    pub por_region: Vec<Mejor>,
}

/// Recorre las `n` filas en paralelo (en el pool de rayon en uso), sin exclusión ni separación.
pub fn barrer(cfg: &Config<'_>) -> Result<Barrido, ErrorPerfil> {
    barrer_con_filtros(cfg, &Filtros::default())
}

/// Recorre las `n` filas en paralelo aplicando exclusión por índice y separación entre candidatos.
pub fn barrer_con_filtros(cfg: &Config<'_>, filtros: &Filtros<'_>) -> Result<Barrido, ErrorPerfil> {
    let n = cfg.n();
    let tareas: Vec<Range<usize>> = (0..n)
        .step_by(FILAS_POR_TAREA)
        .map(|a| a..(a + FILAS_POR_TAREA).min(n))
        .collect();
    let n_regiones = cfg.n_regiones();
    let mut total = tareas
        .par_iter()
        .try_fold(
            || Acum::nuevo(n_regiones),
            |mut acum, filas| {
                acum.procesar(cfg, filtros.indice, filas.clone())?;
                Ok::<_, ErrorPerfil>(acum)
            },
        )
        .try_reduce(|| Acum::nuevo(n_regiones), |a, b| Ok(a.unir(&b)))?;
    let mut por_region: Vec<Mejor> = total
        .mejores
        .into_iter()
        .filter(|m| m.fila != u32::MAX)
        .collect();
    por_region.sort_by(|a, b| b.comparar(a));
    if let Some(sep) = filtros.separacion_km {
        let nivel = u8::try_from(cfg.nivel_celda).unwrap_or(12);
        total.cuentas.excluidos_por_separacion =
            suprimir_por_separacion(&mut por_region, sep, nivel);
    }
    Ok(Barrido {
        n_filas: n,
        cuentas: total.cuentas,
        por_region,
    })
}

/// S con tolerancia de cada fila, en `f32` (`NaN` si la fila no pasa los filtros o no se puede puntuar). Es para
/// compararla fila a fila con el oráculo, no para el camino normal.
pub fn s_por_fila(cfg: &Config<'_>) -> Result<Vec<f32>, ErrorPerfil> {
    let k = cfg.perfil.k();
    let mut salida = vec![f32::NAN; cfg.n()];
    salida
        .par_chunks_mut(FILAS_POR_TAREA)
        .enumerate()
        .try_for_each(|(c, trozo)| {
            let base = c * FILAS_POR_TAREA;
            let mut x = [f32::NAN; MAX_VARS];
            for (d, s) in trozo.iter_mut().enumerate() {
                let i = base + d;
                if cfg.ndvi[i].is_nan() || cfg.ndvi[i] > cfg.ndvi_max {
                    continue;
                }
                for (valor, col) in x.iter_mut().zip(cfg.columnas) {
                    *valor = col[i];
                }
                if let Some(p) = cfg.perfil.puntuar_tolerante(&x[..k])? {
                    *s = a_f32(p.s);
                }
            }
            Ok::<_, ErrorPerfil>(())
        })?;
    Ok(salida)
}

/// Lo que comparten los escenarios de un barrido: las columnas de la tabla (cada una se mapea una sola vez) y los filtros
/// de la celda.
pub struct Compartido<'a> {
    /// Columnas distintas; cada escenario nombra las suyas por posición.
    pub columnas: &'a [&'a [f32]],
    /// Posiciones en `columnas` que la celda debe traer con dato para ser elegible (el terreno), las use o no el
    /// escenario: así todos los escenarios con el mismo corte de NDVI comparan las mismas celdas.
    pub requeridas: &'a [usize],
    pub ndvi: &'a [f32],
    /// Ascendente (lo dice `manifest.json`): las celdas de una región ocupan filas contiguas.
    pub ipix: &'a [u32],
    pub s_coincide: f32,
    pub nivel_region: u32,
    pub nivel_celda: u32,
    /// Cuántas regiones se guardan de cada escenario (las mejores).
    pub candidatos: usize,
    /// Filas por tarea de rayon: `FILAS_POR_TAREA` salvo en las pruebas, que usan tablas chicas.
    pub filas_por_tarea: usize,
}

/// Un escenario: un perfil (con su objetivo, sus tolerancias, sus pesos y su subconjunto de variables) y un corte de NDVI.
pub struct Escenario {
    pub perfil: Perfil,
    /// Posición en `Compartido::columnas` de cada variable del perfil, en el orden del perfil.
    pub columnas: Vec<usize>,
    pub ndvi_max: f32,
}

/// Lo que deja un escenario: las cuentas de [`barrer`] y sus mejores regiones, de mejor a peor.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ResultadoEscenario {
    pub cuentas: Cuentas,
    /// Regiones con alguna celda completa y elegible (las que [`barrer`] devuelve en `por_region`).
    pub regiones: u64,
    pub mejores: Vec<Mejor>,
}

impl ResultadoEscenario {
    /// Cierra una región: la cuenta y la guarda.
    fn cerrar(&mut self, m: Mejor, tope: Option<usize>) {
        if m.fila != u32::MAX {
            self.regiones += 1;
            self.mejores.push(m);
            if let Some(t) = tope {
                self.recortar_si_sobra(t);
            }
        }
    }

    /// Al juntar el doble de las que caben, se queda con las mejores.
    fn recortar_si_sobra(&mut self, tope: usize) {
        if self.mejores.len() >= 2 * tope.max(1) {
            self.recortar(tope);
        }
    }

    /// El orden de [`Mejor::comparar`] es estricto entre regiones distintas (cambia el `ipix`): las `tope` mejores son
    /// las mismas se recorte cuando se recorte, y por eso el resultado no depende de los hilos.
    fn recortar(&mut self, tope: usize) {
        self.mejores.sort_unstable_by(|a, b| b.comparar(a));
        self.mejores.truncate(tope);
    }
}

impl Compartido<'_> {
    fn desplazamiento(&self) -> u32 {
        2 * (self.nivel_celda - self.nivel_region)
    }

    /// Comprueba las dimensiones, que cada escenario nombre columnas que existen y que `ipix` venga ascendente.
    pub fn validar(&self, escenarios: &[Escenario]) -> Result<(), String> {
        let n = self.ipix.len();
        if self.columnas.is_empty()
            || self.ndvi.len() != n
            || self.columnas.iter().any(|c| c.len() != n)
        {
            return Err("faltan columnas o no miden lo mismo".to_owned());
        }
        if u32::try_from(n).is_err()
            || self.nivel_region > self.nivel_celda
            || self.nivel_celda > 13
        {
            return Err("demasiadas filas o niveles de HEALPix imposibles".to_owned());
        }
        let fuera = |c: &usize| *c >= self.columnas.len();
        let malo = |e: &Escenario| {
            e.columnas.len() != e.perfil.k()
                || e.columnas.iter().any(fuera)
                || !e.ndvi_max.is_finite()
        };
        if self.filas_por_tarea == 0
            || self.requeridas.iter().any(fuera)
            || escenarios.iter().any(malo)
        {
            return Err(
                "un escenario nombra columnas que no existen o trae un corte de NDVI sin valor"
                    .to_owned(),
            );
        }
        let n_celdas = 12u32 << (2 * self.nivel_celda);
        if !self.ipix.par_windows(2).all(|p| p[0] < p[1])
            || self.ipix.last().is_some_and(|u| *u >= n_celdas)
        {
            return Err("`ipix` no viene ascendente o se sale de la malla: el barrido de escenarios lo necesita".to_owned());
        }
        Ok(())
    }

    /// Parte las filas en tareas de unas `filas_por_tarea` que terminan donde termina una región. Ninguna región queda
    /// entre dos tareas: cada tarea cierra las suyas y guarda solo las mejores, sin una tabla de 49 152 regiones por escenario.
    fn tareas(&self) -> Vec<Range<usize>> {
        let (n, d) = (self.ipix.len(), self.desplazamiento());
        let mut tareas = Vec::new();
        let mut a = 0;
        while a < n {
            let mut b = (a + self.filas_por_tarea).min(n);
            while b < n && self.ipix[b] >> d == self.ipix[b - 1] >> d {
                b += 1;
            }
            tareas.push(a..b);
            a = b;
        }
        tareas
    }
}

/// Las filas de una tarea que pasan el filtro más flojo, copiadas juntas (los valores de una fila, seguidos): cada
/// escenario las recorre en la caché, sin volver a las columnas de la tabla.
#[derive(Default)]
struct Bloque {
    fila: Vec<u32>,
    ipix: Vec<u32>,
    ndvi: Vec<f32>,
    /// `columnas.len()` valores por fila.
    x: Vec<f32>,
}

impl Bloque {
    fn llenar(&mut self, comp: &Compartido<'_>, ndvi_tope: f32, filas: Range<usize>) {
        self.fila.clear();
        self.ipix.clear();
        self.ndvi.clear();
        self.x.clear();
        for i in filas {
            let v = comp.ndvi[i];
            if v.is_nan()
                || v > ndvi_tope
                || comp
                    .requeridas
                    .iter()
                    .any(|&c| !comp.columnas[c][i].is_finite())
            {
                continue;
            }
            self.fila.push(u32::try_from(i).unwrap_or(u32::MAX));
            self.ipix.push(comp.ipix[i]);
            self.ndvi.push(v);
            self.x.extend(comp.columnas.iter().map(|c| c[i]));
        }
    }

    /// Puntúa el bloque para un escenario, con las mismas reglas que [`barrer`].
    fn puntuar(
        &self,
        comp: &Compartido<'_>,
        e: &Escenario,
        indice: Option<&FiltroIndice<'_>>,
        tope: Option<usize>,
        r: &mut ResultadoEscenario,
    ) -> Result<(), ErrorPerfil> {
        let k = e.perfil.k();
        let completa = (1u16 << k) - 1;
        let desplazamiento = comp.desplazamiento();
        let mut x = [f32::NAN; MAX_VARS];
        let (mut region, mut actual) = (u32::MAX, VACIO);
        for (j, valores) in self.x.chunks_exact(comp.columnas.len()).enumerate() {
            if self.ndvi[j] > e.ndvi_max {
                continue;
            }
            for (valor, &c) in x.iter_mut().zip(&e.columnas) {
                *valor = valores[c];
            }
            let Some(p) = e.perfil.puntuar_tolerante(&x[..k])? else {
                continue;
            };
            r.cuentas.elegibles += 1;
            let es_completa = p.mascara == completa;
            if a_f32(p.s) >= comp.s_coincide {
                if es_completa {
                    r.cuentas.coinciden += 1;
                } else {
                    r.cuentas.coinciden_incompletas += 1;
                }
            }
            if !es_completa {
                continue;
            }
            r.cuentas.completas += 1;
            let ipix = self.ipix[j];
            if ipix >> desplazamiento != region {
                r.cerrar(actual, tope);
                (region, actual) = (ipix >> desplazamiento, VACIO);
            }
            if indice.is_some_and(|f| f.excluye_celda(ipix)) {
                r.cuentas.excluidos_por_indice += 1;
                continue;
            }
            if p.s < actual.s_tol {
                continue;
            }
            let s_ex = e
                .perfil
                .puntuar_exacta(&x[..k])?
                .map_or(f64::NEG_INFINITY, |q| q.s);
            let candidata = Mejor {
                s_tol: p.s,
                s_ex,
                fila: self.fila[j],
                ipix,
            };
            if candidata.comparar(&actual) == Ordering::Greater {
                actual = candidata;
            }
        }
        r.cerrar(actual, tope);
        Ok(())
    }
}

/// Barre la tabla una sola vez para todos los escenarios: rayon reparte las tareas (bloques de filas) y cada tarea lee
/// sus filas de las columnas una vez y evalúa con ellas todos los escenarios.
///
/// Con un escenario da lo mismo que [`barrer`]: sus cuentas y sus primeras `candidatos` regiones. Es determinista con
/// cualquier número de hilos por lo mismo que él: las sumas son enteros y las mejores regiones salen de un orden total.
pub fn barrer_escenarios(
    comp: &Compartido<'_>,
    escenarios: &[Escenario],
) -> Result<Vec<ResultadoEscenario>, String> {
    let filtros = vec![Filtros::default(); escenarios.len()];
    barrer_escenarios_con_filtros(comp, escenarios, &filtros)
}

/// Como [`barrer_escenarios`], aplicando por escenario la exclusión por índice y la separación entre candidatos.
pub fn barrer_escenarios_con_filtros(
    comp: &Compartido<'_>,
    escenarios: &[Escenario],
    filtros: &[Filtros<'_>],
) -> Result<Vec<ResultadoEscenario>, String> {
    comp.validar(escenarios)?;
    if filtros.len() != escenarios.len() {
        return Err("número de filtros distinto al de escenarios".to_owned());
    }
    let ndvi_tope = escenarios
        .iter()
        .map(|e| e.ndvi_max)
        .fold(f32::NEG_INFINITY, f32::max);
    let nuevo = || {
        (
            Bloque::default(),
            vec![ResultadoEscenario::default(); escenarios.len()],
        )
    };
    let (_, mut total) = comp
        .tareas()
        .par_iter()
        .try_fold(nuevo, |(mut bloque, mut acum), filas| {
            bloque.llenar(comp, ndvi_tope, filas.clone());
            for ((r, e), f) in acum.iter_mut().zip(escenarios).zip(filtros) {
                let tope = f.separacion_km.is_none().then_some(comp.candidatos);
                bloque.puntuar(comp, e, f.indice, tope, r)?;
            }
            Ok::<_, ErrorPerfil>((bloque, acum))
        })
        .try_reduce(nuevo, |(bloque, mut a), (_, b)| {
            for ((x, y), f) in a.iter_mut().zip(b).zip(filtros) {
                x.cuentas.sumar(&y.cuentas);
                x.regiones += y.regiones;
                x.mejores.extend(y.mejores);
                if f.separacion_km.is_none() {
                    x.recortar_si_sobra(comp.candidatos);
                }
            }
            Ok((bloque, a))
        })
        .map_err(|e| e.to_string())?;
    let nivel = u8::try_from(comp.nivel_celda).map_err(|_| "nivel_celda inválido".to_owned())?;
    for (r, f) in total.iter_mut().zip(filtros) {
        r.mejores.sort_unstable_by(|a, b| b.comparar(a));
        if let Some(sep) = f.separacion_km {
            r.cuentas.excluidos_por_separacion =
                suprimir_por_separacion(&mut r.mejores, sep, nivel);
            r.regiones = u64::try_from(r.mejores.len()).unwrap_or(u64::MAX);
        }
        r.mejores.truncate(comp.candidatos);
    }
    Ok(total)
}
