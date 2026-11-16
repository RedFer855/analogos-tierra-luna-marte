#![expect(
    clippy::indexing_slicing,
    reason = "matrices en la pila de MAX_VARS × MAX_VARS; cada función pública comprueba 1 <= m <= MAX_VARS antes de indexar"
)]
//! Álgebra lineal mínima para matrices simétricas definidas positivas de hasta `MAX_VARS` × `MAX_VARS` (I-42, opción 3):
//! inversa por Cholesky, autovalores por Jacobi cíclico y raíz inversa simétrica `U·diag(1/√w)·Uᵀ`. Todo en la pila.

use core::fmt;

/// Máximo de variables de un perfil. ADR-008 §3.7: no hay tope de diseño; 12 es el del ensayo (I-42, I-43).
pub const MAX_VARS: usize = 12;

const TAM: usize = MAX_VARS * MAX_VARS;
const MAX_BARRIDOS: usize = 100;

/// Matriz cuadrada guardada por filas con paso `MAX_VARS`: el elemento (i, j) está en `i * MAX_VARS + j`.
pub type Matriz = [f64; TAM];
/// Vector de hasta `MAX_VARS` elementos.
pub type Vector = [f64; MAX_VARS];

/// Posición del elemento (i, j) en una [`Matriz`].
#[inline]
#[must_use]
pub const fn pos(i: usize, j: usize) -> usize {
    i * MAX_VARS + j
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorAlgebra {
    /// `m` es 0 o pasa de `MAX_VARS`.
    Dimension,
    /// La matriz no es definida positiva (pivote no positivo o no finito).
    NoDefinidaPositiva,
    /// Jacobi no convergió en `MAX_BARRIDOS` barridos.
    SinConvergencia,
}

impl fmt::Display for ErrorAlgebra {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Dimension => write!(f, "dimensión fuera de 1..={MAX_VARS}"),
            Self::NoDefinidaPositiva => write!(f, "la matriz no es definida positiva"),
            Self::SinConvergencia => write!(f, "Jacobi no convergió en {MAX_BARRIDOS} barridos"),
        }
    }
}

impl core::error::Error for ErrorAlgebra {}

fn comprobar(m: usize) -> Result<(), ErrorAlgebra> {
    if m == 0 || m > MAX_VARS {
        Err(ErrorAlgebra::Dimension)
    } else {
        Ok(())
    }
}

/// Matriz identidad de orden `m` (el resto en cero).
#[must_use]
pub fn identidad(m: usize) -> Matriz {
    let mut a = [0.0; TAM];
    for i in 0..m.min(MAX_VARS) {
        a[pos(i, i)] = 1.0;
    }
    a
}

/// Inversa de una matriz simétrica definida positiva `m × m` por Cholesky (`A = L·Lᵀ`, `A⁻¹ = L⁻ᵀ·L⁻¹`).
/// Solo lee el triángulo inferior de `a`.
pub fn inversa_cholesky(a: &Matriz, m: usize) -> Result<Matriz, ErrorAlgebra> {
    comprobar(m)?;
    let mut l = [0.0; TAM];
    for i in 0..m {
        for j in 0..=i {
            let mut suma = a[pos(i, j)];
            for k in 0..j {
                suma -= l[pos(i, k)] * l[pos(j, k)];
            }
            if i == j {
                if !suma.is_finite() || suma <= 0.0 {
                    return Err(ErrorAlgebra::NoDefinidaPositiva);
                }
                l[pos(i, i)] = suma.sqrt();
            } else {
                l[pos(i, j)] = suma / l[pos(j, j)];
            }
        }
    }
    // L⁻¹, triangular inferior, por sustitución hacia adelante.
    let mut li = [0.0; TAM];
    for i in 0..m {
        li[pos(i, i)] = 1.0 / l[pos(i, i)];
        for j in 0..i {
            let mut suma = 0.0;
            for k in j..i {
                suma += l[pos(i, k)] * li[pos(k, j)];
            }
            li[pos(i, j)] = -suma / l[pos(i, i)];
        }
    }
    let mut inv = [0.0; TAM];
    for i in 0..m {
        for j in 0..=i {
            let mut suma = 0.0;
            for k in i..m {
                suma += li[pos(k, i)] * li[pos(k, j)];
            }
            inv[pos(i, j)] = suma;
            inv[pos(j, i)] = suma;
        }
    }
    Ok(inv)
}

/// Autovalores y autovectores de una matriz simétrica `m × m` por rotaciones cíclicas de Jacobi.
/// Devuelve `(w, U)` con los autovectores en las columnas de `U` (`A = U·diag(w)·Uᵀ`), sin ordenar.
pub fn eigh_jacobi(a: &Matriz, m: usize) -> Result<(Vector, Matriz), ErrorAlgebra> {
    comprobar(m)?;
    let mut s = *a;
    let mut u = identidad(m);
    let mut total = 0.0;
    for i in 0..m {
        for j in 0..m {
            total += s[pos(i, j)] * s[pos(i, j)];
        }
    }
    let mut convergio = false;
    for _ in 0..MAX_BARRIDOS {
        let mut fuera = 0.0;
        for p in 0..m {
            for q in (p + 1)..m {
                fuera += s[pos(p, q)] * s[pos(p, q)];
            }
        }
        if fuera <= 1e-32 * total {
            convergio = true;
            break;
        }
        for p in 0..m {
            for q in (p + 1)..m {
                let apq = s[pos(p, q)];
                if apq == 0.0 {
                    continue;
                }
                let theta = (s[pos(q, q)] - s[pos(p, p)]) / (2.0 * apq);
                let t = 1.0f64.copysign(theta) / (theta.abs() + theta.hypot(1.0));
                let c = 1.0 / t.hypot(1.0);
                let sn = t * c;
                // S ← S·J, luego S ← Jᵀ·S, con J = rotación de Givens en el plano (p, q); U ← U·J.
                for r in 0..m {
                    let (arp, arq) = (s[pos(r, p)], s[pos(r, q)]);
                    s[pos(r, p)] = c * arp - sn * arq;
                    s[pos(r, q)] = sn * arp + c * arq;
                }
                for r in 0..m {
                    let (apr, aqr) = (s[pos(p, r)], s[pos(q, r)]);
                    s[pos(p, r)] = c * apr - sn * aqr;
                    s[pos(q, r)] = sn * apr + c * aqr;
                }
                s[pos(p, q)] = 0.0;
                s[pos(q, p)] = 0.0;
                for r in 0..m {
                    let (urp, urq) = (u[pos(r, p)], u[pos(r, q)]);
                    u[pos(r, p)] = c * urp - sn * urq;
                    u[pos(r, q)] = sn * urp + c * urq;
                }
            }
        }
    }
    if !convergio {
        return Err(ErrorAlgebra::SinConvergencia);
    }
    let mut w = [0.0; MAX_VARS];
    for i in 0..m {
        w[i] = s[pos(i, i)];
    }
    Ok((w, u))
}

/// Raíz inversa simétrica `A^(-1/2) = U·diag(1/√w)·Uᵀ` de una matriz simétrica definida positiva (blanqueo ZCA-cor).
/// Es única: no depende del signo de cada autovector (I-42, riesgos).
pub fn raiz_inversa(a: &Matriz, m: usize) -> Result<Matriz, ErrorAlgebra> {
    let (w, u) = eigh_jacobi(a, m)?;
    let mut factor = [0.0; MAX_VARS];
    for k in 0..m {
        if !w[k].is_finite() || w[k] <= 0.0 {
            return Err(ErrorAlgebra::NoDefinidaPositiva);
        }
        factor[k] = 1.0 / w[k].sqrt();
    }
    let mut r = [0.0; TAM];
    for i in 0..m {
        for j in 0..=i {
            let mut suma = 0.0;
            for k in 0..m {
                suma += u[pos(i, k)] * factor[k] * u[pos(j, k)];
            }
            r[pos(i, j)] = suma;
            r[pos(j, i)] = suma;
        }
    }
    Ok(r)
}
