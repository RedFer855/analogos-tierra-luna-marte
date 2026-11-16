//! Utilidades geodésicas compartidas: normalización de longitudes, haversine y centros `HEALPix`.

/// Radio medio de la Tierra en km (como el oráculo de `buscar.py`).
pub const RADIO_TIERRA_KM: f64 = 6371.0;

/// Longitud en `[−180, 180)`.
#[must_use]
pub fn normalizar_lon(lon: f64) -> f64 {
    (lon + 180.0).rem_euclid(360.0) - 180.0
}

/// Distancia de círculo máximo en km entre dos puntos en grados.
#[must_use]
pub fn haversine_km(lat_a: f64, lon_a: f64, lat_b: f64, lon_b: f64) -> f64 {
    let (dl, dn) = ((lat_b - lat_a).to_radians(), (lon_b - lon_a).to_radians());
    let h = (dl / 2.0).sin().powi(2)
        + lat_a.to_radians().cos() * lat_b.to_radians().cos() * (dn / 2.0).sin().powi(2);
    2.0 * RADIO_TIERRA_KM * h.sqrt().min(1.0).asin()
}

/// Centro `(lat, lon)` en grados de la celda `ipix` al nivel `HEALPix` indicado.
#[must_use]
pub fn centro_celda(nivel: u8, ipix: u32) -> (f64, f64) {
    let (lon, lat) = cdshealpix::nested::center(nivel, u64::from(ipix));
    (lat.to_degrees(), normalizar_lon(lon.to_degrees()))
}

/// Vector unitario cartesiano de `(lat, lon)` en grados, para cota rápida por producto punto.
#[must_use]
pub fn vector_unitario(lat_deg: f64, lon_deg: f64) -> [f64; 3] {
    let (lat, lon) = (lat_deg.to_radians(), lon_deg.to_radians());
    let cos_lat = lat.cos();
    [cos_lat * lon.cos(), cos_lat * lon.sin(), lat.sin()]
}
