//! La tabla maestra del ETL: una columna por archivo (`<nombre>.f32` o `.u32`, little-endian), 58,7 millones de filas.
//! Se leen por mmap: nunca se carga la tabla (18,8 GB); solo las columnas que usa el perfil.

use std::fs::File;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use memmap2::Mmap;
use serde::Deserialize;

#[derive(Deserialize)]
struct Manifiesto {
    n_celdas: usize,
    healpix: HealpixInfo,
}

#[derive(Deserialize)]
struct HealpixInfo {
    nivel: u8,
}

/// Una columna mapeada en memoria, solo lectura.
pub struct Columna {
    mapa: Mmap,
    nombre: String,
}

pub struct Tabla {
    carpeta: PathBuf,
    pub n_celdas: usize,
    pub nivel_healpix: u8,
}

#[expect(
    unsafe_code,
    reason = "Mmap::map es unsafe: el archivo no debe truncarse ni modificarse mientras vive el mapa"
)]
fn mapear(archivo: &File) -> std::io::Result<Mmap> {
    // SAFETY: la tabla se abre en solo lectura y es un producto terminado del ETL; la regla operativa (I-43, punto 1)
    // es no correr el ETL mientras corre el motor, así que nadie trunca ni escribe estos archivos durante el mapa.
    unsafe { Mmap::map(archivo) }
}

impl Tabla {
    /// Abre la carpeta de la tabla y lee `manifest.json` (número de celdas y nivel de `HEALPix`).
    pub fn abrir(carpeta: &Path) -> Result<Self> {
        let ruta = carpeta.join("manifest.json");
        let texto = std::fs::read_to_string(&ruta)
            .with_context(|| format!("no se pudo leer {}", ruta.display()))?;
        let m: Manifiesto = serde_json::from_str(&texto)
            .with_context(|| format!("{} no tiene el formato esperado", ruta.display()))?;
        Ok(Self {
            carpeta: carpeta.to_path_buf(),
            n_celdas: m.n_celdas,
            nivel_healpix: m.healpix.nivel,
        })
    }

    fn columna(&self, archivo: &str) -> Result<Columna> {
        let ruta = self.carpeta.join(archivo);
        let f =
            File::open(&ruta).with_context(|| format!("no se pudo abrir {}", ruta.display()))?;
        let mapa = mapear(&f).with_context(|| format!("no se pudo mapear {}", ruta.display()))?;
        if mapa.len() != self.n_celdas * 4 {
            bail!(
                "{archivo}: {} bytes, se esperaban {} (4 × {} celdas)",
                mapa.len(),
                self.n_celdas * 4,
                self.n_celdas
            );
        }
        // La alineación y el largo se comprueban una vez aquí; `f32s` y `u32s` ya no pueden fallar.
        bytemuck::try_cast_slice::<u8, f32>(&mapa)
            .map_err(|e| anyhow::anyhow!("{archivo}: {e}"))?;
        Ok(Columna {
            mapa,
            nombre: archivo.to_owned(),
        })
    }

    /// Columna `f32` (`NaN` = dato faltante).
    pub fn f32(&self, nombre: &str) -> Result<Columna> {
        self.columna(&format!("{nombre}.f32"))
    }

    /// Columna `u32` (por ejemplo `ipix`).
    pub fn u32(&self, nombre: &str) -> Result<Columna> {
        self.columna(&format!("{nombre}.u32"))
    }
}

impl Columna {
    /// Los valores como `f32`. Se validó el largo y la alineación al abrir.
    #[must_use]
    pub fn f32s(&self) -> &[f32] {
        bytemuck::cast_slice(&self.mapa)
    }

    /// Los valores como `u32`.
    #[must_use]
    pub fn u32s(&self) -> &[u32] {
        bytemuck::cast_slice(&self.mapa)
    }

    #[must_use]
    pub fn nombre(&self) -> &str {
        &self.nombre
    }
}
