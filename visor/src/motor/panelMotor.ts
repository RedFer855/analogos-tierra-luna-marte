// Panel flotante del motor: Mapa (lista + ficha), Buscar, Chat y Ajustes (clave). ENSAYO (ADR-005).
import './motor.css';
import { makePanelDraggable } from '../ui/draggable';
import { COLOR_GRUPO, COLOR_NIVEL, NOMBRE_GRUPO, type CapaMotor } from './capaMotor';
import { evaluarCercaniaArea, type CercaniaResultado, type PuntoGeologico } from './bonoCercania';
import {
  guardarSnapshotRanking,
  leerRankingsGuardados,
  ordenarPorRanking,
  PERFILES_RANKING,
  type RankingGuardado,
  type RankingId,
  type ResultadoValor,
} from './valorSitio';
import { Locutor } from './locutor';
import type { AreaDibujo, EstadoDibujo } from './areaDibujo';
import { REGIONES, areaKm2, formatoKm2, problemaBbox, radioEfectivoKm, type AreaBusqueda, type Bbox } from './areaGeo';
import {
  motorApi, type AccionMapaChat, type ResumenArea, type Confianza, type TopItem, type AreaFeature, type AreaPin, type Config, type Explicacion, type Grupo, type MensajeChat, type Minerales, type Objetivo, type PolvoFinos, type PropuestaChat, type Segmento, type VientoShields, type ZonaMapaActiva,
} from './api';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const GRUPOS: Grupo[] = ['hallado', 'candidato', 'nuevo'];
/** Filtro por nivel de confianza: null = todas; 'sin' = áreas sin sitio objetivo (no hay confianza que medir). */
const NIVELES: [string | null, string][] = [[null, 'Todas'], ['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja'], ['referencia', 'Documentado'], ['sin', 'Sin dato']];
const PRESETS: Record<string, { texto: string; factores: number[] }> = {
  estricta: { texto: 'Estricta ×0,5', factores: [0.5] },
  normal: { texto: 'Normal ×1', factores: [1] },
  amplia: { texto: 'Amplia ×2', factores: [2] },
  todas: { texto: 'Las tres', factores: [0.5, 1, 2] },
};
const GRUPO_TXT: Record<Grupo, string> = {
  hallado: 'Ya encontrado',
  candidato: 'Candidato sin verificar',
  nuevo: 'Búsqueda nueva',
};
const ESTADO_TXT: Record<string, string> = {
  documentado: 'Documentado en la bibliografía',
  verificado_remoto: 'Verificado con datos remotos',
  verificado_campo: 'Verificado en campo',
  'candidato-sin-verificar': 'Hallado por el motor, aún sin verificar',
};
const SUGERENCIAS = ['¿Por qué se parece?', '¿En qué difiere?', '¿Qué tan confiable es este resultado?', 'Explícamelo como si tuviera 12 años'];
const ESCENARIOS_CHAT: [string, string][] = [
  ['Entrenar un rover', 'Quiero entrenar un rover en la Tierra para preparar una misión. Ayúdame a elegir qué buscar en el motor.'],
  ['Ensayar aterrizajes', 'Quiero buscar zonas seguras en la Tierra para ensayar aterrizajes de una nave.'],
  ['Establecer una colonia', 'Quiero buscar lugares análogos para establecer una colonia o base permanente.'],
  ['Refugio en cuevas/cráteres', 'Muéstrame cuevas y cráteres en el mapa y ayúdame a buscar zonas análogas de refugio subterráneo.'],
];
type Pestana = 'mapa' | 'rankings' | 'buscar' | 'chat' | 'ajustes';
/** Dónde busca el motor: toda la Tierra, una región sugerida, una caja escrita o un área dibujada en el globo. */
type ModoArea = 'tierra' | 'region' | 'caja' | 'dibujo';
const MODOS_AREA: [ModoArea, string, string][] = [
  ['tierra', 'Toda la Tierra', '◍'], ['region', 'Región', '◈'], ['caja', 'Coordenadas', '⌗'], ['dibujo', 'Dibujar', '✎'],
];
const PISO_KM2 = 40000; // piso provisional del motor (--min-area-km2)
const K_AREA = 0.15; // k provisional del motor (--k-area)
const TABS: [Pestana, string][] = [['mapa', 'Mapa'], ['rankings', 'Rankings'], ['buscar', 'Buscar'], ['chat', 'Copiloto'], ['ajustes', 'Ajustes']];

export class PanelMotor {
  private el = document.createElement('aside');
  private restorePill = document.createElement('button');
  private oculto = false;
  private areas: AreaPin[] = [];
  private objetivos: Objetivo[] = [];
  private activos = new Set<Grupo>(GRUPOS);
  private pestana: Pestana = 'mapa';
  private texto = '';
  private seleccion: AreaFeature | null = null;
  private expl: { id: string; cargando: boolean; datos: Explicacion | null; iaCargando: boolean; error: string | null } | null = null;
  private preset = 'todas';
  private ndvi = 0.3;
  /** Filtro de vegetación activo. Apagado, el motor busca también bajo bosque (ndvi_max = 1). */
  private filtroVeg = true;
  private candidatos = 30;
  private excluir = true;
  private previos = true;
  private excKm = 0;
  private objetivoSel = 'SL-12';
  private perfilSel = 'terreno_termico';
  private busqueda: { fase: 'libre' | 'corriendo' | 'terminado' | 'error'; msg: string } = { fase: 'libre', msg: '' };
  private areaModo: ModoArea = 'tierra';
  private area: AreaBusqueda | null = null;
  /** Lo último dibujado a mano: se recupera al volver al modo Dibujar. */
  private areaDibujada: AreaBusqueda | null = null;
  private regionSel = REGIONES[0].id;
  private caja: (number | null)[] = [...REGIONES[0].bbox];
  private kArea = K_AREA;
  private pisoKm2 = PISO_KM2;
  private dibujoEstado: EstadoDibujo = { modo: null, vertices: 0, cruza: false };
  /** Lo que contó el motor dentro del área en la última búsqueda (celdas, regiones, km² de tierra). */
  private ultimaArea: ResumenArea | null = null;
  private conectado: boolean | null = null;
  private plegado = false;
  private expandido = false;
  private config: Config = { configurada: false, modelo: 'deepseek-chat', voz_configurada: false, voz: 'aura-2-selena-es', velocidad: 1.15, voces: {} };
  private locutor = new Locutor();
  // Preferencia de interfaz (no es un secreto): hablar solo al abrir un área o recibir una respuesta.
  private autoVoz = (() => { try { return localStorage.getItem('motor.autoVoz') !== '0'; } catch { return true; } })();
  private suena: { clave: string; error: string | null } | null = null;
  private guiones = new Map<string, Segmento[]>();
  // La voz automática lee cada área una sola vez por sesión; volver a oírla es con «▶ Escuchar».
  private yaLeidas = new Set<string>();
  private top: TopItem[] = [];
  private conf: Record<string, Confianza> = {};
  private colorModo: 'grupo' | 'confianza' = 'grupo';
  /** Nivel de confianza elegido (null = todos). */
  private nivel: string | null = null;
  private bonoCercania = false;
  private puntosGeo: PuntoGeologico[] | null = null;
  private cargandoPuntosGeo = false;
  private rankingSel: RankingId = 'integral';
  private rankingsGuardados: Partial<Record<RankingId, RankingGuardado>> = leerRankingsGuardados();
  private rankingMsg: string | null = null;
  private corridaVoz = 0; // identifica la lectura vigente: una lectura vieja que termina tarde no toca el estado
  private ajustesMsg: { tipo: 'ok' | 'error'; texto: string } | null = null;
  private chat: { mensajes: MensajeChat[]; enviando: boolean; error: string | null; borrador: string; conArea: boolean } =
    { mensajes: [], enviando: false, error: null, borrador: '', conArea: true };
  private zonaMapa: ZonaMapaActiva | null = null;
  private conZona = true;

  constructor(root: HTMLElement, private capa: CapaMotor, private dibujo: AreaDibujo) {
    this.el.className = 'motor-panel';
    root.appendChild(this.el);
    this.restorePill.type = 'button';
    this.restorePill.className = 'motor-restore-pill hidden';
    this.restorePill.textContent = 'Motor ◂';
    this.restorePill.title = 'Mostrar panel del motor';
    this.restorePill.addEventListener('click', () => {
      this.oculto = false;
      this.pintar();
    });
    root.appendChild(this.restorePill);
    makePanelDraggable(this.el, '.mp-cab', {
      panelId: 'motor',
      defaultDock: 'right',
      dockWidth: 396,
      isHidden: () => this.oculto,
    });
    this.bindTopFiltersSlot();
    this.capa.alSeleccionar = (a) => {
      this.seleccion = a;
      this.expl = null;
      this.corridaVoz++;
      this.locutor.detener();
      this.suena = null;
      if (a) this.pestana = 'mapa';
      this.pintar();
      if (a) void this.cargarExplicacion(String(a.properties.id), false);
    };
    this.dibujo.alTerminar = (a) => {
      if (a && this.areaModo === 'caja' && a.tipo === 'bbox') {
        this.caja = [...a.bbox]; // las esquinas marcadas llenan las coordenadas
        this.aplicarArea();
      } else if (a) {
        this.areaModo = 'dibujo';
        this.areaDibujada = a;
        this.area = a;
      } else {
        this.dibujo.mostrar(this.areaModo === 'tierra' ? null : this.area); // cancelado: vuelve el área de antes
      }
      this.pestana = 'buscar';
      this.plegado = false;
      this.pintar();
    };
    this.dibujo.alCambiar = (e) => {
      const cambio = e.modo !== this.dibujoEstado.modo;
      this.dibujoEstado = e;
      if (cambio) this.pintar();
    };
    this.el.addEventListener('click', (e) => this.alClic(e));
    this.el.addEventListener('change', (e) => this.alSoltar(e));
    this.el.addEventListener('input', (e) => this.alCambio(e));
    this.el.addEventListener('keydown', (e) => this.alTecla(e));
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      if ((e.target as HTMLElement).id === 'mp-form-voz') void this.guardarVoz(); else void this.guardarClave();
    });
    this.pintar();
    void this.iniciar();
  }

  /** Conecta una zona dibujada o elegida desde el mapa/catálogo directamente al Copiloto. */
  public setZonaMapa(zona: { id?: string; name?: string; metrics?: { areaKm2?: number }; coordinates?: { lat: number; lon: number }[] } | null): void {
    if (!zona || !Array.isArray(zona.coordinates) || zona.coordinates.length < 3) {
      this.zonaMapa = null;
      this.pintar();
      return;
    }
    const raw = zona.coordinates;
    const step = raw.length > 64 ? Math.ceil(raw.length / 64) : 1;
    const coords = raw.filter((_, i) => i % step === 0).slice(0, 64).map((c) => ({ lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)) }));
    this.zonaMapa = {
      id: zona.id,
      nombre: zona.name ?? 'Zona del mapa',
      area_km2: typeof zona.metrics?.areaKm2 === 'number' ? Number(zona.metrics.areaKm2.toFixed(2)) : null,
      coords,
    };
    this.conZona = true;
    this.pintar();
  }

  private async iniciar(): Promise<void> {
    const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let listo = false;
    for (let intento = 0; intento < 5; intento++) {
      try {
        await motorApi.salud();
        listo = true;
        break;
      } catch {
        if (intento < 4) await esperar(700);
      }
    }
    if (!listo) {
      this.conectado = false;
      this.pintar();
      return;
    }
    try {
      this.conectado = true;
      [this.areas, this.objetivos, this.config] = await Promise.all([this.capa.cargar(), motorApi.objetivos(), motorApi.config()]);
      this.top = await motorApi.top(3).catch(() => []);
      this.conf = await motorApi.confianza().catch(() => ({}));
      this.capa.colorear(this.colorModo, this.conf); // la capa necesita la confianza para filtrar pines por nivel
      this.capa.destacar(this.top.map((t) => t.id));
    } catch {
      this.conectado = false;
    }
    this.pintar();
  }

  private conteo(g: Grupo): number {
    return this.areas.filter((a) => a.grupo === g).length;
  }

  // ---------- armazón ----------
  private pintar(): void {
    const foco = document.activeElement as HTMLElement | null;
    const idFoco = foco && this.el.contains(foco) ? foco.id : '';
    const pos = (foco as HTMLInputElement | null)?.selectionStart ?? null;
    const scroll = this.el.querySelector('.mp-scroll')?.scrollTop ?? 0;
    const lista = this.el.querySelector('.mp-lista')?.scrollTop ?? 0;
    const estado = this.conectado === null ? 'conectando…' : this.conectado ? 'puente conectado' : 'puente apagado';
    const clase = this.conectado ? 'ok' : this.conectado === false ? 'mal' : '';
    this.el.classList.toggle('plegado', this.plegado);
    this.el.classList.toggle('expandido', this.expandido && !this.plegado);
    this.el.classList.toggle('hidden', this.oculto);
    this.restorePill.classList.toggle('hidden', !this.oculto);
    const tabs = TABS.map(([k, t]) =>
      `<button role="tab" aria-selected="${this.pestana === k}" class="${this.pestana === k ? 'on' : ''}" data-a="tab" data-t="${k}">${t}${k === 'chat' && this.chat.mensajes.length ? `<b>${this.chat.mensajes.length}</b>` : k === 'chat' && this.zonaMapa && this.conZona ? '<b>•</b>' : ''}</button>`).join('');
    this.el.innerHTML = `
      <header class="mp-cab">
        <div class="mp-tit"><strong>Motor de análogos</strong><span class="mp-ensayo">ensayo</span></div>
        <div class="mp-cab-der"><button class="mp-auto ${this.autoVoz ? 'on' : ''}" data-a="auto-voz" aria-pressed="${this.autoVoz}" title="Leer en voz alta al abrir un área o recibir una respuesta">Voz auto: ${this.autoVoz ? 'sí' : 'no'}</button><span class="mp-estado ${clase}"><i></i>${estado}</span>
          <button class="mp-btn-icono" data-a="expandir" title="${this.expandido ? 'Vista compacta' : 'Ampliar chat'}" aria-label="${this.expandido ? 'Compactar' : 'Ampliar'} panel">${this.expandido ? '⤡' : '⤢'}</button>
          <button class="mp-btn-icono" data-a="plegar" aria-label="${this.plegado ? 'Expandir' : 'Plegar'} panel">${this.plegado ? '▾' : '▴'}</button>
          <button class="mp-btn-icono mp-btn-ocultar" data-a="ocultar" title="Ocultar panel del motor" aria-label="Ocultar panel">Ocultar</button></div>
      </header>
      ${this.conectado === false ? this.htmlApagado() : `<nav class="mp-tabs" role="tablist">${tabs}</nav>
      <div class="mp-scroll">${this.htmlPestana()}</div>`}`;
    const s = this.el.querySelector('.mp-scroll');
    if (s) s.scrollTop = scroll;
    const l = this.el.querySelector('.mp-lista');
    if (l) l.scrollTop = lista;
    if (this.pestana === 'chat') { const m = this.el.querySelector('.mp-msgs'); if (m) m.scrollTop = m.scrollHeight; }
    if (idFoco) {
      const n = this.el.querySelector<HTMLInputElement>(`#${idFoco}`);
      n?.focus();
      if (n && pos !== null && n.type !== 'password' && n.setSelectionRange) try { n.setSelectionRange(pos, pos); } catch { /* tipo sin selección */ }
    }
    this.pintarTopFiltersSlot();
  }

  private htmlApagado(): string {
    return `<div class="mp-vacio"><p><strong>No encuentro el motor.</strong></p><p>El visor funciona igual. Para ver las áreas hay que encender el puente en otra terminal:</p>
      <code>node herramientas/motor-puente/servidor.mjs</code>
      <button class="mp-btn" data-a="reintentar">Reintentar</button></div>`;
  }

  private htmlPestana(): string {
    switch (this.pestana) {
      case 'rankings': return this.htmlRankings();
      case 'buscar': return this.htmlBuscar();
      case 'chat': return this.htmlChat();
      case 'ajustes': return this.htmlAjustes();
      default: return this.seleccion ? this.htmlFicha(this.seleccion) : this.htmlMapa();
    }
  }

  // ---------- pestaña Mapa ----------
  private htmlMapa(): string {
    const chips = GRUPOS.map((g) => `<button class="mp-chip ${this.activos.has(g) ? 'on' : ''}" data-a="grupo" data-g="${g}" aria-pressed="${this.activos.has(g)}">
        <i style="background:${COLOR_GRUPO[g]}"></i>${NOMBRE_GRUPO[g]}<b>${this.conteo(g)}</b></button>`).join('');
    const q = this.texto.trim().toLowerCase();
    const nivelDe = (id: string): string => this.conf[id]?.nivel ?? 'sin';
    const enGrupo = this.areas.filter((a) => this.activos.has(a.grupo));
    const lista = enGrupo.filter((a) => (!this.nivel || nivelDe(a.id) === this.nivel) &&
      (!q || `${a.id} ${a.etiqueta} ${a.resumen ?? ''} ${a.objetivo_nombre ?? ''}`.toLowerCase().includes(q)));
    // Con un nivel elegido, la de mayor confianza primero; el puntaje sin tope desempata las que comparten tope.
    const pj = (id: string, k: 'puntaje' | 'puntaje_bruto'): number => this.conf[id]?.[k] ?? -1;
    if (this.nivel) {
      lista.sort((x, y) => (pj(y.id, 'puntaje') - pj(x.id, 'puntaje')) || (pj(y.id, 'puntaje_bruto') - pj(x.id, 'puntaje_bruto')));
    } else if (this.bonoCercania && this.puntosGeo) {
      const notaAdj = (a: AreaPin): number => this.cercaniaDe(a)?.totalPct ?? (a.parecido_pct ?? -1);
      lista.sort((x, y) => notaAdj(y) - notaAdj(x));
    }
    const nChips = NIVELES.map(([k, t]) => {
      const n = k ? enGrupo.filter((a) => nivelDe(a.id) === k).length : enGrupo.length;
      const on = this.nivel === k;
      const punto = k ? `<i style="background:${COLOR_NIVEL[k]}"></i>` : '';
      return `<button class="${on ? 'on' : ''}" data-a="nivel" data-n="${k ?? ''}" aria-pressed="${on}">${punto}${t} <b>${n}</b></button>`;
    }).join('');
    const filtroNivel = `<div class="mp-modo mp-niveles" role="group" aria-label="Filtrar por nivel de solidez del ajuste"><span>Solidez</span>${nChips}</div>`;
    const bonoCtrl = `<div class="mp-bono-wrap">
      <button class="mp-bono-btn ${this.bonoCercania ? 'on' : ''}" data-a="bono-cercania" aria-pressed="${this.bonoCercania}" ${this.cargandoPuntosGeo ? 'disabled' : ''}>
        ${this.cargandoPuntosGeo ? 'Cargando cuevas/cráteres…' : `Bono cercanía cuevas/cráteres: ${this.bonoCercania ? 'ON' : 'OFF'}`}
      </button>
      <p class="mp-nota">${this.bonoCercania
        ? '<b>Activo:</b> sube el % mostrado si el sitio está a ≤ 50 km de una cueva A/B o cráter (proporcional a su similitud base y n.º de variables); no cambia la fórmula física del motor.'
        : 'Al activarlo, sube el % mostrado si el área está cerca (≤ 50 km) de cuevas A/B o cráteres.'}</p>
    </div>`;
    const filas = lista.slice(0, 150).map((a) => {
      const resBono = this.bonoCercania ? this.cercaniaDe(a) : null;
      const pctHtml = resBono
        ? `<b>${resBono.totalPct} %</b> <em class="mp-bono-tag" title="${esc(a.parecido_pct)} % base + ${resBono.bonoPct} % por cercanía a ${esc(resBono.punto.nombre)} (${resBono.distKm} km)">+${resBono.bonoPct}%</em>`
        : `<b>${a.parecido_pct} %</b>`;
      const sub = a.parecido_pct != null
        ? `Se parece a ${esc(a.objetivo_nombre ?? a.objetivo)} · ${pctHtml}`
        : esc(a.resumen ?? ESTADO_TXT[a.estado] ?? a.estado);
      const c = this.conf[a.id];
      const nv = c && c.puntaje != null ? `<em class="mp-nv n-${c.nivel}" title="Solidez del ajuste ${c.nivel}: ${c.puntaje} %${(c.puntaje_bruto ?? c.puntaje) > c.puntaje ? ` (sin el tope del nivel: ${c.puntaje_bruto} %, rango ${c.bajo}–${c.alto})` : ` (rango ${c.bajo}–${c.alto})`}">${c.puntaje}</em>` : '';
      return `<li><button class="mp-fila" data-a="ir" data-id="${esc(a.id)}"><i style="background:${this.colorModo === 'confianza' ? COLOR_NIVEL[c?.nivel ?? 'sin'] : COLOR_GRUPO[a.grupo]}"></i>
        <span><b>${esc(a.etiqueta)}</b><small>${sub}</small></span>${nv}</button></li>`;
    }).join('');
    const topHtml = this.top.length && !this.nivel
      ? `<div class="mp-top"><div class="mp-sec-t">★ Top 3 multivariable</div>${this.top.map((t) => `<button class="mp-top-fila" data-a="ir" data-id="${esc(t.id)}"><b>${t.puesto}</b><span><strong>${esc(t.lugar)}</strong><small>Aparece en ${t.apariciones} de ${t.escenarios} escenarios · se parece a ${t.n_objetivos} sitios (sobre todo ${esc(t.objetivo)} ×${t.veces_objetivo})</small></span></button>`).join('')}</div>`
      : '';
    const leyenda = this.colorModo === 'confianza'
      ? `<div class="mp-leyenda">${(['alta', 'media', 'baja'] as const).map((n) => `<span><i style="background:${COLOR_NIVEL[n]}"></i>${n}</span>`).join('')}<span><i style="background:${COLOR_NIVEL.referencia}"></i>documentado</span><span><i style="background:${COLOR_NIVEL.sin}"></i>sin dato</span></div>`
      : '';
    const modo = `<div class="mp-modo" role="group" aria-label="Colorear pines"><span>Colorear por</span><button class="${this.colorModo === 'grupo' ? 'on' : ''}" data-a="modo" data-m="grupo">Grupo</button><button class="${this.colorModo === 'confianza' ? 'on' : ''}" data-a="modo" data-m="confianza">Solidez</button></div>${leyenda}`;
    return `<div class="mp-chips">${chips}</div>${modo}${filtroNivel}${bonoCtrl}${topHtml}
      <input id="mp-q" class="mp-input" type="search" placeholder="Buscar por nombre, sitio objetivo o id" value="${esc(this.texto)}" aria-label="Filtrar áreas">
      <p class="mp-nota">${lista.length} de ${this.areas.length} áreas${this.nivel ? ', de mayor a menor solidez del ajuste' : ''}${lista.length > 150 ? ' · se muestran 150' : ''}. Toca un pin en el mapa o una fila para ver el área, su lugar y por qué se parece.</p>
      <ul class="mp-lista">${filas || '<li class="mp-vacio">Sin áreas con este filtro.</li>'}</ul>`;
  }

  // ---------- ficha ----------
  private htmlFicha(f: AreaFeature): string {
    const p = f.properties as Record<string, unknown>;
    const g = f.properties.grupo;
    const h = this.expl?.datos?.hechos;
    // Con nombre propio (ST-NN) va el nombre; los candidatos se titulan por el lugar donde caen.
    const titulo = String(p.nombre ?? (h ? h.lugar : (p.etiqueta ?? p.id)));
    const lugar = h ? esc(h.lugar) : '<span class="mp-cargando">buscando el lugar…</span>';
    const idTxt = `<span class="mp-id">${esc(p.nombre ? p.id : (p.etiqueta ?? p.id))}</span>`;
    let cuerpo = '';
    if (h?.objetivo) {
      const cuerpoTxt = h.objetivo.cuerpo === 'luna' ? 'la Luna' : h.objetivo.cuerpo === 'marte' ? 'Marte' : h.objetivo.cuerpo;
      cuerpo += `<div class="mp-sec"><div class="mp-sec-t">${h.objetivo.evaluado_desde_referencia ? 'Evaluación del motor (referencia)' : 'Se parece a'}</div>
        <div class="mp-objetivo"><strong>${esc(h.objetivo.nombre)}</strong><small>${esc(h.objetivo.id)} · ${esc(cuerpoTxt)} · perfil ${esc(h.objetivo.perfil)}</small></div>
        ${h.parecido_motor_pct != null ? this.medidor('Parecido del motor', h.parecido_motor_pct, `${h.parecido_motor_pct} %`) : ''}
        ${h.evaluacion_zona ? `<p class="mp-nota">ADR-008 en radio ${esc(h.evaluacion_zona.radio_km)} km (${esc(h.evaluacion_zona.celdas_elegibles)}/${esc(h.evaluacion_zona.celdas_muestra)} celdas elegibles por NDVI): mejor celda <b>${h.evaluacion_zona.s_max_pct} %</b> · P90 <b>${h.evaluacion_zona.s_p90_pct} %</b> · mediana <b>${h.evaluacion_zona.s_med_pct} %</b>. Las variables de abajo muestran esa mejor celda (no un afloramiento puntual del centro).</p>` : ''}
        ${h.aparece_en_pct_escenarios != null ? this.medidor('Salió entre los mejores en', h.aparece_en_pct_escenarios, `${h.aparece_en_pct_escenarios} % de los escenarios`) : ''}
        ${h.otros_objetivos_que_tambien_coinciden ? `<p class="mp-nota">También aparece cerca de: ${Object.entries(h.otros_objetivos_que_tambien_coinciden).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${esc(k)} (${v})`).join(', ')}</p>` : ''}</div>`;
    }
    if (h?.variables?.length) {
      const filas = h.variables.map((v) => {
        const clase = v.coincide === null ? 'sd' : v.coincide ? 'ok' : 'no';
        const tag = v.coincide === null ? 'Sin dato' : v.coincide ? 'Coincide' : `Difiere · ${v.direccion}`;
        const u = esc(v.unidad);
        const num = (x: number | null) => (x == null ? '—' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(2));
        return `<li class="mp-var ${clase}"><div class="mp-var-t"><span>${esc(v.nombre)}</span><em>${tag}</em></div>
          <div class="mp-barra dev" title="La marca central es el límite de la tolerancia"><i style="width:${Math.min(100, (v.veces_tolerancia ?? 0) * 50)}%"></i></div>
          <div class="mp-var-n">aquí <b>${num(v.aqui)}${u}</b> · objetivo <b>${num(v.objetivo)}${u}</b> ± ${num(v.tolerancia)}${u}· ${v.veces_tolerancia == null ? '' : v.coincide ? 'dentro de la tolerancia' : `${v.direccion} que el objetivo (${v.veces_tolerancia}× la tolerancia)`}</div>
          ${v.el_objetivo_supera_la_tierra ? `<div class="mp-var-aviso">${esc(v.el_objetivo_supera_la_tierra)}</div>` : ''}</li>`;
      }).join('');
      cuerpo += `<div class="mp-sec"><div class="mp-sec-t">Variable por variable</div><ul class="mp-vars">${filas}</ul>
        <p class="mp-nota">Valores de la celda de la tabla maestra más cercana al centro (a ${h.celda_distancia_km} km). La barra mide cuánto se aleja del objetivo: la marca central es el límite de la tolerancia. «Difiere» no es un error, es un valor fuera de ese margen. El % del motor es el mejor caso entre muchos escenarios; esta tabla usa la tolerancia base y la celda del centro, por eso puede mostrar diferencias aunque el motor diga 100 %.</p></div>`;
    }
    if (h?.filtros?.length) cuerpo += this.htmlFiltros(h.filtros);
    if (h?.minerales) cuerpo += this.htmlMinerales(h.minerales);
    if (h?.viento_shields) cuerpo += this.htmlVientoShields(h.viento_shields, h.objetivo?.nombre ?? null);
    if (h?.polvo_finos) cuerpo += this.htmlPolvoFinos(h.polvo_finos, h.objetivo?.cuerpo ?? null);
    if (h && !h.objetivo && (h.resumen_del_sitio || h.descripcion_del_sitio)) {
      cuerpo += `<div class="mp-sec"><div class="mp-sec-t">Sobre este sitio</div>
        ${h.resumen_del_sitio ? `<p>${esc(h.resumen_del_sitio)}</p>` : ''}${h.descripcion_del_sitio ? `<p>${esc(h.descripcion_del_sitio)}</p>` : ''}
        <p class="mp-nota">Es un análogo documentado: no tiene sitio objetivo asociado, así que no hay un porcentaje de parecido.</p></div>`;
    }
    return `<article class="mp-det" style="--c:${COLOR_GRUPO[g]}">
      <button class="mp-volver" data-a="cerrar">← Volver a la lista</button>
      <div class="mp-det-cab"><h3>${esc(titulo)}</h3>${idTxt}</div>
      <div class="mp-badges"><span class="mp-badge"><i></i>${GRUPO_TXT[g]}</span><span class="mp-estado-t">${esc(ESTADO_TXT[String(p.estado)] ?? p.estado)}</span></div>
      <div class="mp-lugar"><span aria-hidden="true">◎</span><div><strong>${lugar}</strong>
        <small>${Number(p.lat).toFixed(3)}°, ${Number(p.lon).toFixed(3)}° · radio ${esc(p.radio_km)} km <em>(círculo, no contorno real)</em></small></div></div>
      ${this.htmlBonoDetalle(p)}
      ${this.htmlConfianza(h?.confianza ?? this.conf[String(p.id)])}
      ${cuerpo}${this.htmlExplicacion()}
      <div class="mp-acciones">
        <button class="mp-btn pri" data-a="uso-nasa">¿Para qué la NASA podría usar exactamente este lugar según los datos recuperados?</button>
        <button class="mp-btn" data-a="preguntar">Preguntar al chat</button>
        ${g === 'nuevo' ? '<button class="mp-btn" data-a="guardar">Guardar como hallazgo</button>' : ''}
      </div>
      <p class="mp-fuente">Fuente: ${esc(p.fuente)} · ${esc(p.fecha)}</p>
    </article>`;
  }

  private cercaniaDe(a: { id: string; lat: number; lon: number; parecido_pct?: number | null }): CercaniaResultado | null {
    if (!this.puntosGeo || a.parecido_pct == null) return null;
    const nVars = this.conf[a.id]?.variables ?? 4;
    return evaluarCercaniaArea(a.lat, a.lon, a.parecido_pct, nVars, this.puntosGeo);
  }

  private htmlBonoDetalle(p: Record<string, unknown>): string {
    if (!this.bonoCercania) return '';
    const base = typeof p.s_mediana === 'number' ? Math.round(p.s_mediana * 100) : typeof p.s_max === 'number' ? Math.round(p.s_max * 100) : null;
    const res = base == null ? null : this.cercaniaDe({ id: String(p.id), lat: Number(p.lat), lon: Number(p.lon), parecido_pct: base });
    if (!res) return '';
    const tipo = res.punto.tipo === 'cueva' ? 'cueva/tubo de lava' : 'cráter';
    return `<div class="mp-bono-det"><b>${res.totalPct} %</b> (${base} % base + <b>${res.bonoPct} %</b> por cercanía a ${tipo} <em>${esc(res.punto.nombre)}</em> a ${res.distKm} km)</div>`;
  }

  private async asegurarPuntosGeo(): Promise<boolean> {
    if (this.puntosGeo) return true;
    this.cargandoPuntosGeo = true;
    this.pintar();
    try {
      const base = import.meta.env.BASE_URL ?? '/';
      const pfx = base.endsWith('/') ? base : `${base}/`;
      const [cuevas, crateres] = await Promise.all([
        fetch(`${pfx}capas/cuevas.json`).then((r) => r.json()) as Promise<Array<{ id: string; nombre: string; lat: number; lon: number }>>,
        fetch(`${pfx}capas/crateres.json`).then((r) => r.json()) as Promise<Array<{ id: string; nombre: string; lat: number; lon: number }>>,
      ]);
      this.puntosGeo = [
        ...cuevas.map((c) => ({ ...c, tipo: 'cueva' as const })),
        ...crateres.map((c) => ({ ...c, tipo: 'crater' as const })),
      ];
      this.cargandoPuntosGeo = false;
      return true;
    } catch (err) {
      this.cargandoPuntosGeo = false;
      this.aviso(err);
      this.pintar();
      return false;
    }
  }

  private async toggleBonoCercania(): Promise<void> {
    if (!this.bonoCercania && !(await this.asegurarPuntosGeo())) return;
    this.bonoCercania = !this.bonoCercania;
    this.pintar();
  }

  private calcularRankingActual(): { perfil: (typeof PERFILES_RANKING)[number]; resultados: ResultadoValor[] } {
    const perfil = PERFILES_RANKING.find((p) => p.id === this.rankingSel) ?? PERFILES_RANKING[0];
    const entradas = this.areas.map((a) => {
      const c = this.conf[a.id];
      return {
        id: a.id,
        etiqueta: a.etiqueta,
        lat: a.lat,
        lon: a.lon,
        grupo: a.grupo,
        objetivo: a.objetivo_nombre ?? a.objetivo,
        parecido_pct: a.parecido_pct,
        solidez_pct: c?.puntaje ?? null,
        es_referencia: c?.nivel === 'referencia',
      };
    });
    return { perfil, resultados: ordenarPorRanking(entradas, perfil, this.puntosGeo ?? []) };
  }

  private htmlRankings(): string {
    const { perfil, resultados } = this.calcularRankingActual();
    const pills = PERFILES_RANKING.map((p) => {
      const on = p.id === this.rankingSel;
      const nSaved = this.rankingsGuardados[p.id]?.items.length ?? 0;
      return `<button class="mp-rk-pill ${on ? 'on' : ''}" data-a="ranking-perfil" data-r="${p.id}" aria-pressed="${on}">${esc(p.nombre)}${nSaved ? ` <b>${nSaved}</b>` : ''}</button>`;
    }).join('');

    const filas = resultados.slice(0, 20).map((r, i) => {
      const d = r.desglose;
      const extra = r.rasgoCercano ? ` · ${r.rasgoCercano.tipo === 'cueva' ? 'Cueva' : 'Cráter'}: ${esc(r.rasgoCercano.nombre)} (${r.rasgoCercano.distKm} km)` : '';
      return `<li class="mp-rk-fila-wrap"><button class="mp-fila" data-a="ir" data-id="${esc(r.entrada.id)}">
        <em class="mp-rk-pos">${i + 1}</em>
        <span><b>${esc(r.entrada.etiqueta)}</b><small>Par ${d.parecido}% · Sol ${d.solidez}%${extra}</small></span>
        <em class="mp-nv ${r.valor >= 70 ? 'n-alta' : r.valor >= 45 ? 'n-media' : 'n-baja'}">${r.valor}</em>
      </button><button class="mp-rk-exp" data-a="explicar-ranking-item" data-id="${esc(r.entrada.id)}" title="Abrir ficha completa y explicar todas sus variables">Explicar</button></li>`;
    }).join('');

    const guardado = this.rankingsGuardados[perfil.id];
    const guardadoHtml = guardado
      ? `<div class="mp-rk-saved">
          <div class="mp-sec-t">Guardado en «${esc(guardado.nombreRanking)}» (${guardado.items.length} sitios · ${guardado.fechaIso.slice(0, 10)})</div>
          <ol class="mp-rk-ol">${guardado.items.slice(0, 10).map((it) =>
            `<li><button class="mp-rk-link" data-a="ir" data-id="${esc(it.id)}">#${it.puesto} ${esc(it.etiqueta)} — <b>${it.valor}/100</b>${it.rasgo ? ` <small>(${esc(it.rasgo)})</small>` : ''}</button></li>`
          ).join('')}</ol>
        </div>`
      : '<p class="mp-nota">Aún no has guardado un Top para este ranking.</p>';

    return `<div class="mp-sec">
      <div class="mp-sec-t">Rankings por valor del sitio (0–100)</div>
      <div class="mp-rk-pills">${pills}</div>
      <p class="mp-nota">${esc(perfil.descripcion)}${(perfil.pesoCuevas > 0 || perfil.pesoCrateres > 0) && !this.puntosGeo ? ' · <i>cargando cuevas/cráteres…</i>' : ''}</p>
      <div class="mp-rk-acciones">
        <button class="mp-btn" data-a="guardar-ranking">Guardar Top 15</button>
        <button class="mp-btn pri" data-a="chat-ranking">Explicar en Chat</button>
        <button class="mp-btn sec" data-a="exportar-ranking">JSON</button>
      </div>
      ${this.rankingMsg ? `<p class="mp-nota">${esc(this.rankingMsg)}</p>` : ''}
    </div>
    <ul class="mp-lista">${filas || '<li class="mp-vacio">Sin áreas cargadas.</li>'}</ul>
    ${guardadoHtml}`;
  }

  /** Viento comparable Tierra-Marte como fracción del tiempo sobre el umbral de arrastre de arena (I-28, Shields). */
  private htmlVientoShields(vs: VientoShields, objNombre: string | null): string {
    const tPct = vs.tierra_arrastre_pct ?? 0;
    if (vs.cuerpo === 'marte' && vs.marte_arrastre_pct != null) {
      const mPct = vs.marte_arrastre_pct;
      const rango = vs.marte_arrastre_z0_liso_pct != null && vs.marte_arrastre_z0_liso_pct !== mPct ? ` (${vs.marte_arrastre_z0_liso_pct} % si la superficie es lisa)` : '';
      return `<div class="mp-sec mp-polvo">
        <div class="mp-sec-t">Viento por umbral de arrastre (I-28 · Shields)</div>
        <div class="mp-polvo-head"><span class="mp-polvo-tag mp-polvo-tag--medio">Marte: cota inferior de modelo</span><small>Arena 100–200 µm</small></div>
        <div class="mp-var-n">Tierra aquí (τ &gt; 0,05 Pa, MERRA-2 horario): <b>${vs.tierra_arrastre_pct ?? '—'} % del tiempo</b>${vs.tierra_ustar_ms != null ? ` · u* media ${vs.tierra_ustar_ms} m/s` : ''}</div>
        <div class="mp-polvo-barra"><span style="width:${Math.min(100, tPct)}%;background:#38bdf8;height:100%"></span></div>
        <div class="mp-var-n">Marte en ${esc(objNombre ?? 'objetivo')} (τ &gt; 0,01 Pa, Ayoub 2014): <b>al menos ${mPct} % del tiempo</b>${rango} · U media ${vs.marte_u_media_ms ?? '—'} m/s, máx ${vs.marte_u_max_ms ?? '—'} m/s</div>
        <div class="mp-polvo-barra"><span style="width:${Math.min(100, mPct)}%;background:#f97316;height:100%"></span></div>
        <p class="mp-nota">No se comparan m/s (la atmósfera de Marte es ~100× menos densa) sino el % del tiempo sobre el umbral de impacto de cada planeta. El dato de Marte es el ciclo medio de la MCD 6.2, sin ráfagas: es un mínimo y no permite decir si coinciden.</p>
      </div>`;
    }
    return `<div class="mp-sec mp-polvo">
      <div class="mp-sec-t">Viento por umbral de arrastre (I-28 · Shields)</div>
      <div class="mp-var-n">Tierra aquí (τ &gt; 0,05 Pa): <b>${vs.tierra_arrastre_pct ?? '—'} % del tiempo</b>${vs.tierra_ustar_ms != null ? ` · u* media ${vs.tierra_ustar_ms} m/s` : ''} · Luna: <b>0 %</b> (vacío sin atmósfera)</div>
    </div>`;
  }

  /** Polvo suspendido en atmósfera y fracción fina (< 50 µm) frente al regolito lunar en micras. */
  private htmlPolvoFinos(pf: PolvoFinos, cuerpo: string | null): string {
    const etq =
      pf.nivel_polvo === 'muy-polvoso'
        ? { texto: 'Muy polvoso', cls: 'alto' }
        : pf.nivel_polvo === 'moderado'
          ? { texto: 'Polvo moderado', cls: 'medio' }
          : { texto: 'Poco polvo suspendido', cls: 'bajo' };
    const dod = pf.dod02_pct != null ? `${pf.dod02_pct.toFixed(1)} % días DOD > 0.2` : 'sin dato DOD';
    const dod05 = pf.dod05_pct != null ? ` · ${pf.dod05_pct.toFixed(1)} % DOD > 0.5` : '';
    const emi = pf.emision_kg_m2_s != null && pf.emision_kg_m2_s > 0 ? ` · emisión ${pf.emision_kg_m2_s.toExponential(1)} kg/m²/s` : '';
    const finos =
      pf.fino_lt50_pct != null
        ? `<div class="mp-polvo-barra" title="Fracción fina del suelo (SoilGrids 0–5 cm): arcilla < 2 µm + limo 2–50 µm">
            <span style="width:${Math.min(100, pf.arcilla_pct ?? 0)}%" class="mp-polvo-arcilla"></span>
            <span style="width:${Math.min(100 - Math.min(100, pf.arcilla_pct ?? 0), pf.limo_pct ?? 0)}%" class="mp-polvo-limo"></span>
          </div>
          <div class="mp-var-n">Suelo muy fino (&lt; 50 µm): <b>${pf.fino_lt50_pct.toFixed(1)} %</b> (arcilla &lt; 2 µm: <b>${(pf.arcilla_pct ?? 0).toFixed(1)} %</b> · limo 2–50 µm: <b>${(pf.limo_pct ?? 0).toFixed(1)} %</b>)</div>`
        : '<div class="mp-nota">Sin dato de granulometría SoilGrids en esta celda.</div>';
    const contraste =
      cuerpo === 'marte'
        ? 'En Marte hay tormentas finas globales (~1–5 µm en suspensión) con baja densidad atmosférica (~6 mbar).'
        : 'En la Luna hay <b>0 % polvo suspendido por aire</b> (vacío); su regolito tiene tamaño medio ~70 µm con <b>10–20 % ultrafino &lt; 20 µm</b> (hasta 20–100 nm), muy angular y electrostático por falta de erosión hídrica o eólica (NASA Apollo).';
    return `<div class="mp-sec mp-polvo">
      <div class="mp-sec-t">Polvo suspendido y granulometría (µm)</div>
      ${pf.nivel_polvo ? `<div class="mp-polvo-head"><span class="mp-polvo-tag mp-polvo-tag--${etq.cls}">${etq.texto}</span><small>${dod}${dod05}${emi}</small></div>` : ''}
      ${finos}
      <p class="mp-nota">${contraste}</p>
    </div>`;
  }

  private htmlFiltros(filtros: NonNullable<Explicacion['hechos']['filtros']>): string {
    const items = filtros
      .map((f) => `<li class="mp-filtro mp-filtro--${f.estado}"><span>${esc(f.nombre)}</span><b>${esc(f.valor)}</b></li>`)
      .join('');
    return `<div class="mp-sec"><div class="mp-sec-t">Filtros y contexto (no son variables de puntaje)</div><ul class="mp-filtros">${items}</ul></div>`;
  }

  /** Roca, índices ASTER, minerales EMIT y suelo de la celda, cada valor frente al resto de la Tierra. */
  private htmlMinerales(m: Minerales): string {
    const num = (x: number, d = 2): string => x.toFixed(d);
    const roca = m.roca
      ? `<div class="mp-roca"><strong>${esc(m.roca.nombre)}</strong><small>${esc(m.roca.nota)}</small></div>`
      : '<p class="mp-nota">Sin dato de roca para esta celda.</p>';
    const aster = m.aster.some((a) => a.valor != null)
      ? m.aster.map((a) => a.valor == null
        ? `<li class="mp-min sd"><div class="mp-var-t"><span>${esc(a.nombre)}</span><em>Sin dato</em></div></li>`
        : `<li class="mp-min"><div class="mp-var-t"><span>${esc(a.nombre)}</span><em class="l-${esc(a.lectura)}">${esc(a.lectura)}</em></div>
          <div class="mp-barra"><i style="width:${a.percentil}%"></i></div>
          <div class="mp-var-n"><b>${num(a.valor, 3)}</b> · más alto que el <b>${a.percentil} %</b> de la Tierra. ${esc(a.pista)}</div></li>`).join('')
      : '<li class="mp-nota">ASTER no tiene dato en esta celda (agua, costa o fuera de cobertura).</li>';
    const emit = m.emit.cobertura
      ? m.emit.minerales.filter((x) => x.valor > 0).slice(0, 6).map((x) => `<li class="mp-min"><div class="mp-var-t"><span>${esc(x.nombre)}</span><em>${num(x.valor)}</em></div>
          <div class="mp-barra"><i style="width:${Math.min(100, x.valor * 100)}%"></i></div>
          <div class="mp-var-n">más alto que el <b>${x.percentil} %</b> de las zonas áridas con dato</div></li>`).join('')
        || '<li class="mp-nota">EMIT cubre la zona pero no detecta ninguno de los 11 minerales.</li>'
      : '<li class="mp-nota">EMIT no cubre esta zona (no es árida o queda fuera de la malla): no hay minerales por espectroscopía.</li>';
    const suelo = m.suelo.filter((s) => s.valor != null)
      .map((s) => `<span class="mp-dato"><small>${esc(s.nombre)}</small><b>${Math.round(s.valor!)} ${esc(s.unidad)}</b></span>`).join('');
    return `<div class="mp-sec"><div class="mp-sec-t">Minerales y roca</div>${roca}
      <div class="mp-sub">Índices espectrales (ASTER, ~1 km)</div><ul class="mp-vars">${aster}</ul>
      <div class="mp-sub">Minerales en superficie (EMIT)</div><ul class="mp-vars">${emit}</ul>
      <p class="mp-nota">${esc(m.emit.nota)}</p>
      ${suelo ? `<div class="mp-sub">Suelo (SoilGrids)</div><div class="mp-datos">${suelo}</div>` : ''}
      <p class="mp-nota">Fuentes: ${esc(m.fuentes)}. Es un análisis de la celda del centro, sin verificar en campo.</p></div>`;
  }

  /** Nivel, puntaje y rango de confianza: barra de 0 a 100 con el rango sombreado y la marca del puntaje. */
  private htmlConfianza(c: Confianza | null | undefined): string {
    if (!c) return '';
    if (c.nivel === 'referencia') {
      return `<div class="mp-conf n-referencia"><div class="mp-conf-t"><span class="mp-sec-t">Solidez del ajuste</span><b>Referencia documentada</b></div><p class="mp-nota">${esc(c.razones[0])}</p></div>`;
    }
    const nombres: Record<string, string> = { ajuste: 'Ajuste con el objetivo', discriminacion: 'Variables que discriminan', robustez: 'Robustez entre escenarios', calidad: 'Calidad del perfil', cobertura: 'Cobertura de datos' };
    const comp = Object.entries(c.componentes ?? {}).map(([k, v]) => {
      const max = c.puntos?.[k] ?? 10;
      return `<li><span>${esc(nombres[k] ?? k)}</span><div class="mp-barra"><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v.toFixed(0)}/${max}</b></li>`;
    }).join('');
    const bajo = c.bajo ?? 0, alto = c.alto ?? 0, p = c.puntaje ?? 0;
    const bruto = c.puntaje_bruto ?? p, limitado = bruto > p;
    const sup = c.supuestas ?? [];
    const nSup = c.variables_supuestas ?? sup.length;
    const mod = c.modeladas ?? [];
    const nMod = c.variables_modeladas ?? mod.length;
    const badgeSup = nSup >= 1
      ? `<span class="mp-pill mp-supuesto" title="${esc(sup.join(', '))}">objetivo supuesto (${nSup} de ${c.variables ?? 0} variables)</span>`
      : '';
    const badgeMod = nMod >= 1
      ? `<span class="mp-pill mp-supuesto" title="${esc(mod.join(', '))}">objetivo modelado (${nMod} de ${c.variables ?? 0} variables)</span>`
      : '';
    const badgesEp = badgeSup || badgeMod ? `<div class="mp-badges">${badgeSup}${badgeMod}</div>` : '';
    return `<div class="mp-conf n-${c.nivel}">
      <div class="mp-conf-t"><span class="mp-sec-t">Solidez del ajuste</span><b>${c.nivel.toUpperCase()} · ${p} % <small>${limitado ? `(sin el tope del nivel: ${bruto} %, rango ${bajo}–${alto} %)` : `(rango ${bajo}–${alto} %)`}</small></b></div>
      <div class="mp-regla" role="img" aria-label="Solidez del ajuste ${p} por ciento${limitado ? `, ${bruto} sin el tope del nivel` : ''}, rango ${bajo} a ${alto}">
        <span class="z baja"></span><span class="z media"></span><span class="z alta"></span>
        <i class="rango" style="left:${bajo}%;width:${Math.max(1, alto - bajo)}%"></i>${limitado ? `<i class="marca bruta" style="left:${bruto}%"></i>` : ''}<i class="marca" style="left:${p}%"></i>
      </div>
      <div class="mp-regla-e"><span>0</span><span>40</span><span>65</span><span>100</span></div>
      ${badgesEp}
      ${c.limitantes?.length ? `<p class="mp-limite">Nivel limitado: ${c.limitantes.map(esc).join('; ')}.</p>` : ''}
      <details><summary>Cómo se calcula</summary><ul class="mp-conf-comp">${comp}</ul>
        <ul class="mp-seg-lista">${c.razones.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="mp-nota">Es un índice orientativo de solidez del ajuste (no una probabilidad calibrada ni una verificación). La robustez puntual usa la fracción de escenarios (k/n) y deja Wilson al 95 % para el rango y el tope; el rango propaga ajuste del círculo (P25–P75 con cotas por faltantes), cobertura de la huella, calidad y robustez, sobre el puntaje sin tope; la marca tenue es ese puntaje cuando el nivel lo limita.</p></details>
    </div>`;
  }

  private medidor(titulo: string, pct: number, texto: string): string {
    return `<div class="mp-med"><div class="mp-med-t"><span>${esc(titulo)}</span><b>${esc(texto)}</b></div><div class="mp-barra grande"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></div>`;
  }

  private md(t: string): string {
    // Markdown mínimo (negritas, cursivas, viñetas) sobre texto ya escapado.
    let html = '';
    let lista = false;
    for (const l of esc(t).split('\n')) {
      const it = l.startsWith('- ');
      if (it && !lista) { html += '<ul>'; lista = true; }
      if (!it && lista) { html += '</ul>'; lista = false; }
      const x = (it ? l.slice(2) : l)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;])/g, '$1<em>$2</em>');
      html += it ? `<li>${x}</li>` : x ? `<p>${x}</p>` : '';
    }
    return html + (lista ? '</ul>' : '');
  }

  private htmlExplicacion(): string {
    const x = this.expl;
    if (!x) return '';
    if (x.cargando && !x.datos) return '<div class="mp-sec"><p class="mp-cargando">Leyendo los datos del motor…</p></div>';
    const d = x.datos;
    if (!d) return x.error ? `<p class="mp-error">${esc(x.error)}</p>` : '';
    const origen = d.ia ? `Redactado por DeepSeek (${esc(d.ia.modelo)}) con los datos del motor` : 'Resumen con los datos reales del motor';
    const boton = d.ia_disponible
      ? `<button class="mp-btn" data-a="ia" ${x.iaCargando ? 'disabled' : ''}>${x.iaCargando ? 'Redactando…' : d.ia ? 'Volver a redactar con IA' : 'Explicar con IA'}</button>`
      : '<button class="mp-btn" data-a="ir-ajustes">Conectar DeepSeek para explicarlo con IA</button>';
    const oir = this.botonOir('expl', d.ia?.guion ?? d.plantilla_guion, d.voz_disponible);
    const errVoz = this.suena?.clave === 'expl' && this.suena.error ? `<p class="mp-error">${esc(this.suena.error)}</p>` : '';
    return `<details class="mp-sec mp-expl" ${d.ia ? 'open' : ''}><summary><span class="mp-sec-t">En palabras simples</span><small>${origen}</small></summary>
      ${d.ia ? this.md(d.ia.texto) : this.md(d.plantilla)}${x.error ? `<p class="mp-error">${esc(x.error)}</p>` : ''}<div class="mp-fila-btn">${oir}${boton}</div>${errVoz}</details>`;
  }

  /** Botón de escuchar / detener. `clave` identifica qué suena; el guion queda en un mapa, no en el HTML. */
  private botonOir(clave: string, guion: Segmento[], disponible: boolean): string {
    if (!disponible) return '<button class="mp-btn" data-a="ir-ajustes" title="Conecta Deepgram en Ajustes">▶ Escuchar (conectar voz)</button>';
    this.guiones.set(clave, guion);
    const activo = this.suena?.clave === clave && !this.suena.error;
    return activo
      ? '<button class="mp-btn" data-a="parar">■ Detener</button>'
      : `<button class="mp-btn" data-a="oir" data-k="${esc(clave)}">▶ Escuchar</button>`;
  }

  private async oir(clave: string): Promise<void> {
    const guion = this.guiones.get(clave);
    if (!guion?.length) return;
    if (this.suena?.clave === clave && !this.suena.error && this.locutor.hablando) return; // ya está sonando: no reiniciar
    const corrida = ++this.corridaVoz;
    this.suena = { clave, error: null };
    this.pintar();
    try {
      await this.locutor.hablar(guion);
      if (corrida === this.corridaVoz) this.suena = null;
    } catch (err) {
      if (corrida === this.corridaVoz) this.suena = { clave, error: err instanceof Error ? err.message : String(err) };
    }
    if (corrida === this.corridaVoz) this.pintar();
  }

  private alternarAutoVoz(): void {
    this.autoVoz = !this.autoVoz;
    try { localStorage.setItem('motor.autoVoz', this.autoVoz ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (!this.autoVoz) this.parar(); else this.pintar();
  }

  private parar(): void {
    this.corridaVoz++;
    this.locutor.detener();
    this.suena = null;
    this.pintar();
  }

  private async cargarExplicacion(id: string, ia: boolean): Promise<void> {
    const previo = this.expl?.id === id ? this.expl.datos : null;
    this.expl = { id, cargando: !ia, datos: previo, iaCargando: ia, error: null };
    this.pintar();
    try {
      const d = await motorApi.explicacion(id, ia);
      if (this.expl?.id !== id) return;
      this.expl = { id, cargando: false, datos: d, iaCargando: false, error: d.aviso };
      this.pintar();
      // Lectura automática: una vez por área (la regeneración con IA, al pedirla, siempre se lee).
      const nueva = ia || !this.yaLeidas.has(id);
      if (this.autoVoz && d.voz_disponible && nueva && this.seleccion?.properties.id === id) {
        this.yaLeidas.add(id);
        void this.oir('expl');
        return;
      }
    } catch (err) {
      if (this.expl?.id !== id) return;
      this.expl = { id, cargando: false, datos: previo, iaCargando: false, error: err instanceof Error ? err.message : String(err) };
    }
    this.pintar();
  }

  // ---------- pestaña Buscar ----------
  private htmlBuscar(): string {
    const obj = this.objetivos.find((o) => o.id === this.objetivoSel);
    const grupos = ['luna', 'marte'].map((c) => `<optgroup label="${c === 'luna' ? 'Luna' : 'Marte'}">${this.objetivos
      .filter((o) => o.cuerpo === c)
      .map((o) => `<option value="${o.id}" ${o.id === this.objetivoSel ? 'selected' : ''}>${esc(o.id)} · ${esc(o.nombre)}</option>`).join('')}</optgroup>`).join('');
    const perfiles = (obj?.perfiles ?? []).map((p) => `<option ${p === this.perfilSel ? 'selected' : ''}>${esc(p)}</option>`).join('');
    const presets = Object.entries(PRESETS).map(([k, v]) => `<button class="${this.preset === k ? 'on' : ''}" data-a="preset" data-k="${k}">${v.texto}</button>`).join('');
    const corriendo = this.busqueda.fase === 'corriendo';
    const bloqueo = this.bloqueoArea();
    return `<div class="mp-card"><div class="mp-card-t">Búsqueda nueva</div>
      <p class="mp-nota">Elige un sitio de la Luna o de Marte y el motor busca en la Tierra lugares con terreno parecido.</p>
      <label class="mp-campo">Sitio objetivo<select id="mp-obj" class="mp-input">${grupos}</select></label>
      <label class="mp-campo">Perfil (qué variables se comparan)<select id="mp-perfil" class="mp-input">${perfiles}</select></label>
      ${this.htmlArea()}
      <div class="mp-campo">Tolerancia<div class="mp-seg">${presets}</div></div>
      <label class="mp-check"><input id="mp-veg" type="checkbox" ${this.filtroVeg ? 'checked' : ''}>Filtro de vegetación (sin él busca también bajo bosque)</label>
      <label class="mp-campo">NDVI máximo (vegetación) <output>${this.filtroVeg ? this.ndvi.toFixed(2) : 'sin filtro'}</output>
        <input id="mp-ndvi" type="range" min="0" max="0.6" step="0.05" value="${this.ndvi}" ${this.filtroVeg ? '' : 'disabled'}></label>
      ${!this.filtroVeg ? '<p class="mp-nota">Sin filtro, los minerales y la temperatura del día miden hojas, no suelo: conviene el perfil <b>bajo_vegetacion</b> (forma, roca y permafrost).</p>' : ''}
      <label class="mp-campo">Candidatos <output>${this.candidatos}</output>
        <input id="mp-cand" type="range" min="5" max="100" step="5" value="${this.candidatos}"></label>
      <label class="mp-check"><input id="mp-excl" type="checkbox" ${this.excluir ? 'checked' : ''}>Excluir los 43 ya encontrados</label>
      <label class="mp-check"><input id="mp-prev" type="checkbox" ${this.previos ? 'checked' : ''}>Excluir candidatos previos y búsquedas anteriores</label>
      <label class="mp-campo">Radio de exclusión <output>${this.excKm === 0 ? 'el de cada área' : this.excKm + ' km'}</output>
        <input id="mp-exkm" type="range" min="0" max="500" step="25" value="${this.excKm}"></label>
      <button class="mp-btn primario" data-a="lanzar" ${corriendo || bloqueo ? 'disabled' : ''} title="${esc(bloqueo ?? '')}">${corriendo ? 'Buscando…' : this.area && this.areaModo !== 'tierra' ? 'Buscar en esta área' : 'Lanzar búsqueda'}</button>
      ${bloqueo && !corriendo ? `<p class="mp-nota mp-ojo">${esc(bloqueo)}</p>` : ''}</div>
      <div class="mp-card"><div class="mp-card-t">Barrido completo</div>
        ${this.area && this.areaModo !== 'tierra' ? '<p class="mp-nota mp-ojo">El barrido es siempre global: no usa el área de arriba.</p>' : ''}
        <p class="mp-nota">Corre los 801 escenarios ya medidos en 6 corridas con variables y casos distintos, excluyendo lo hallado por el radio de arriba (500 km si está en 0). Tarda unos 3–4 minutos.</p>
        <button class="mp-btn" data-a="barrido" ${corriendo ? 'disabled' : ''}>Lanzar barrido de 801 escenarios</button></div>
      <p class="mp-estado-b ${this.busqueda.fase}" role="status">${esc(this.busqueda.msg)}</p>`;
  }

  /** Si el área elegida no se puede mandar al motor, el porqué (y el botón de lanzar queda apagado). */
  private bloqueoArea(): string | null {
    if (this.areaModo === 'tierra') return null;
    if (this.dibujo.dibujando) return 'Termina o cancela el dibujo en el globo.';
    if (this.areaModo === 'caja') { const p = problemaBbox(this.caja); if (p) return p; }
    if (!this.area) return this.areaModo === 'dibujo' ? 'Dibuja el área en el globo.' : 'Elige un área.';
    if (this.pisoKm2 > 0 && areaKm2(this.area) < this.pisoKm2) return `El área mide menos que el piso de ${formatoKm2(this.pisoKm2)}: el motor la rechazaría.`;
    return null;
  }

  // ---------- sección Dónde buscar ----------
  private htmlArea(): string {
    const modos = MODOS_AREA.map(([k, t, ico]) => `<button role="radio" aria-checked="${this.areaModo === k}" class="${this.areaModo === k ? 'on' : ''}" data-a="area-modo" data-m="${k}"><span aria-hidden="true">${ico}</span>${t}</button>`).join('');
    let cuerpo = '';
    if (this.areaModo === 'tierra') {
      cuerpo = '<p class="mp-nota">Busca en todas las celdas de tierra del maestro. Para mirar solo una zona, elige una región, escribe las coordenadas o dibújala en el globo.</p>';
    } else if (this.areaModo === 'region') {
      const ops = REGIONES.map((r) => `<option value="${r.id}" ${r.id === this.regionSel ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('');
      const r = REGIONES.find((x) => x.id === this.regionSel)!;
      cuerpo = `<select id="mp-region" class="mp-input" aria-label="Región sugerida">${ops}</select>
        <p class="mp-nota">${esc(r.nota)}. Caja aproximada, no es un límite oficial.</p>`;
    } else if (this.areaModo === 'caja') {
      const v = (i: number): string => (this.caja[i] == null ? '' : String(this.caja[i]));
      const campo = (i: number, id: string, t: string, min: number, max: number, cls: string): string =>
        `<label class="mp-coord ${cls}"><span>${t}</span><input id="${id}" class="mp-input" type="number" inputmode="decimal" step="0.1" min="${min}" max="${max}" value="${v(i)}"></label>`;
      const prob = problemaBbox(this.caja);
      cuerpo = `<div class="mp-caja" role="group" aria-label="Caja en grados decimales">
          ${campo(2, 'mp-c-n', 'Lat norte', -90, 90, 'n')}${campo(1, 'mp-c-o', 'Lon oeste', -180, 180, 'o')}
          <span class="mp-caja-c" aria-hidden="true"></span>${campo(3, 'mp-c-e', 'Lon este', -180, 180, 'e')}${campo(0, 'mp-c-s', 'Lat sur', -90, 90, 's')}
        </div>
        ${prob ? `<p class="mp-error">${esc(prob)}</p>` : '<p class="mp-nota">Grados decimales (sur y oeste en negativo). Si el oeste es mayor que el este, la caja cruza ±180°.</p>'}
        <button class="mp-btn mp-btn-sec" data-a="dibujar" data-m="caja">▭ Marcar las esquinas en el globo</button>`;
    } else {
      const d = this.dibujoEstado;
      const activo = (m: string): string => (d.modo === m ? 'on' : '');
      cuerpo = `<div class="mp-seg mp-seg-dib">
          <button class="${activo('caja')}" data-a="dibujar" data-m="caja"><b aria-hidden="true">▭</b>Caja<small>dos esquinas</small></button>
          <button class="${activo('poligono')}" data-a="dibujar" data-m="poligono"><b aria-hidden="true">⬠</b>Polígono<small>un clic por vértice</small></button></div>
        ${d.modo ? `<p class="mp-nota mp-vivo"><i></i>Dibujando en el globo${d.modo === 'poligono' ? ` · ${d.vertices} vértice${d.vertices === 1 ? '' : 's'}` : ''}. <button class="mp-link" data-a="cancelar-dibujo">Cancelar</button></p>`
          : !this.area ? '<p class="mp-nota">Elige la forma y haz clic en el globo. Puedes girar y acercar la cámara mientras dibujas.</p>' : ''}`;
    }
    const conArea = this.areaModo !== 'tierra';
    return `<fieldset class="mp-area"><legend>Dónde buscar</legend>
      <div class="mp-seg mp-seg-4" role="radiogroup" aria-label="Dónde buscar">${modos}</div>
      ${cuerpo}${conArea && this.area && !this.dibujo.dibujando ? this.htmlResumenArea(this.area) : ''}
      ${conArea ? this.htmlAjustesArea() : ''}</fieldset>`;
  }

  /** Tarjeta del área elegida: forma, tamaño frente al piso del motor y, si ya se buscó ahí, lo que contó el motor. */
  private htmlResumenArea(a: AreaBusqueda): string {
    const km2 = areaKm2(a);
    const piso = this.pisoKm2;
    const corto = piso > 0 && km2 < piso;
    const escala = Math.max(km2 * 1.15, piso * 2.5, 1);
    const forma = a.tipo === 'bbox'
      ? `${this.grados(a.bbox[0], 'lat')} a ${this.grados(a.bbox[2], 'lat')} · ${this.grados(a.bbox[1], 'lon')} a ${this.grados(a.bbox[3], 'lon')}${a.bbox[1] > a.bbox[3] ? ' · cruza ±180°' : ''}`
      : `${a.anillo.length - 1} vértices`;
    const titulo = a.nombre ?? (a.tipo === 'bbox' ? (this.areaModo === 'caja' ? 'Caja por coordenadas' : 'Caja dibujada') : 'Polígono dibujado');
    const u = this.ultimaArea && this.mismaArea(this.ultimaArea, a) ? this.ultimaArea : null;
    const conteo = u ? `<div class="mp-area-cuenta">
        <span class="mp-dato"><small>Tierra elegible</small><b>${formatoKm2(u.tierra_km2)}</b></span>
        <span class="mp-dato"><small>Celdas</small><b>${u.celdas_en_area.toLocaleString('es')}</b></span>
        <span class="mp-dato"><small>Regiones</small><b>${u.regiones_con_tierra}</b></span>
        <span class="mp-dato"><small>Fuera por NDVI</small><b>${(u.sin_celdas_por_ndvi ?? 0).toLocaleString('es')}</b></span></div>
        <p class="mp-nota">Lo contó el motor en la última búsqueda en esta área.</p>` : '';
    const nota = corto
      ? `<b class="mp-mal-t">Más chica que el piso de ${formatoKm2(piso)}.</b> Agrándala o baja el piso en los ajustes del área.`
      : piso > 0
        ? `Medida de la ${a.tipo === 'bbox' ? 'caja' : 'figura'} completa, mar incluido. El motor solo cuenta la tierra elegible: si no llega a ${formatoKm2(piso)} o a 4 regiones con tierra, avisa.`
        : 'Sin piso de área: el motor solo exige 4 regiones con tierra.';
    return `<div class="mp-area-res ${corto ? 'corta' : ''}">
      <div class="mp-area-cab"><span class="mp-area-ico" aria-hidden="true">${a.tipo === 'bbox' ? '▭' : '⬠'}</span>
        <div><strong>${esc(titulo)}</strong><small>${esc(forma)}</small></div>
        <b class="mp-area-km">≈ ${formatoKm2(km2)}</b></div>
      <div class="mp-piso" role="img" aria-label="Área de ${formatoKm2(km2)} frente al piso de ${formatoKm2(piso)}">
        <i style="width:${Math.min(100, (km2 / escala) * 100)}%"></i>${piso > 0 ? `<em style="left:${(piso / escala) * 100}%"></em>` : ''}</div>
      ${piso > 0 ? `<div class="mp-piso-e"><span>0</span><span style="left:${(piso / escala) * 100}%">piso ${formatoKm2(piso)}</span></div>` : ''}
      <p class="mp-nota">${nota}</p>
      ${conteo}
      <div class="mp-fila-btn"><button class="mp-btn mp-btn-sec" data-a="area-ver">◎ Ver en el globo</button><button class="mp-btn mp-btn-sec" data-a="area-quitar">Quitar área</button></div></div>`;
  }

  private htmlAjustesArea(): string {
    const u = this.ultimaArea && this.area && this.mismaArea(this.ultimaArea, this.area) ? this.ultimaArea : null;
    const km2 = u ? u.tierra_km2 : this.area ? areaKm2(this.area) : null;
    const radio = km2 != null ? Math.round(radioEfectivoKm(this.excKm || 300, km2, this.kArea)) : null;
    return `<details class="mp-area-aj"><summary>Ajustes del área <span class="mp-pill">provisionales</span></summary>
      <label class="mp-campo">Factor k del radio de exclusión <output>${this.kArea.toFixed(2)}</output>
        <input id="mp-karea" type="range" min="0.05" max="1" step="0.05" value="${this.kArea}"></label>
      <p class="mp-nota">En un área chica, el radio de exclusión se acorta a k·√área${radio != null ? `: aquí, hasta <b data-r="radio">${radio} km</b>${u ? '' : ' (con el área de la figura)'}` : ''}. ${K_AREA.toFixed(2)} es el valor del motor, pendiente de decisión.</p>
      <label class="mp-campo">Piso de tierra elegible <output>${this.pisoKm2 === 0 ? 'sin piso' : formatoKm2(this.pisoKm2)}</output>
        <input id="mp-piso" type="range" min="0" max="200000" step="10000" value="${this.pisoKm2}"></label>
      <p class="mp-nota">Por debajo del piso el motor rechaza el área: con pocas celdas la comparación no es estable. ${formatoKm2(PISO_KM2)} es provisional; 0 lo desactiva.</p></details>`;
  }

  private grados(x: number, eje: 'lat' | 'lon'): string {
    const h = eje === 'lat' ? (x >= 0 ? 'N' : 'S') : x >= 0 ? 'E' : 'O';
    return `${Math.abs(x).toLocaleString('es', { maximumFractionDigits: 2 })}° ${h}`;
  }

  private mismaArea(u: ResumenArea, a: AreaBusqueda): boolean {
    const forma = (x: ResumenArea | AreaBusqueda): string => JSON.stringify(x.tipo === 'bbox' ? x.bbox : x.anillo);
    return u.tipo === a.tipo && forma(u) === forma(a);
  }

  /** Recalcula el área según el modo y la muestra en el globo (vuela si se pide). */
  private aplicarArea(volar = false): void {
    if (this.areaModo === 'tierra') this.area = null;
    else if (this.areaModo === 'region') {
      const r = REGIONES.find((x) => x.id === this.regionSel)!;
      this.area = { tipo: 'bbox', bbox: [...r.bbox] as Bbox, nombre: r.nombre };
    } else if (this.areaModo === 'caja') {
      this.area = problemaBbox(this.caja) ? null : { tipo: 'bbox', bbox: [...this.caja] as Bbox, nombre: null };
    }
    this.dibujo.mostrar(this.areaModo === 'tierra' ? null : this.area, volar && !!this.area);
  }

  // ---------- pestaña Copiloto ----------
  private htmlChat(): string {
    const ctxPin = this.seleccion
      ? `<label class="mp-check ctx"><input id="mp-ctx" type="checkbox" ${this.chat.conArea ? 'checked' : ''}>Pin activo: <b>${esc(this.seleccion.properties.nombre ?? this.seleccion.properties.etiqueta ?? this.seleccion.properties.id)}</b></label>`
      : '';
    const ctxZona = this.zonaMapa
      ? `<div class="mp-zona-ctx"><label class="mp-check ctx"><input id="mp-ctx-zona" type="checkbox" ${this.conZona ? 'checked' : ''}>Recuadro: <b>${esc(this.zonaMapa.nombre)}</b>${this.zonaMapa.area_km2 != null ? ` (${this.zonaMapa.area_km2.toLocaleString('es', { maximumFractionDigits: 1 })} km²)` : ''}</label>
        <button class="mp-btn pri" data-a="analizar-zona">Analizar zona</button></div>`
      : '';
    const ctx = (ctxPin || ctxZona)
      ? `${ctxZona}${ctxPin}`
      : '<p class="mp-nota">Toca un pin o dibuja/selecciona un cuadro del mapa abajo para que el Copiloto analice esa zona.</p>';
    const msgs = this.chat.mensajes.map((m, i) => {
      if (m.rol === 'user') return `<div class="mp-msg user"><p>${esc(m.texto)}</p></div>`;
      const clave = `chat:${i}`;
      const oir = m.guion?.length ? `<div class="mp-oir">${this.botonOir(clave, m.guion, this.config.voz_configurada)}</div>` : '';
      const prop = m.propuesta ? this.htmlPropuestaChat(m.propuesta, i) : '';
      const err = this.suena?.clave === clave && this.suena.error ? `<p class="mp-error">${esc(this.suena.error)}</p>` : '';
      return `<div class="mp-msg assistant">${this.md(m.texto)}${prop}${oir}${err}</div>`;
    }).join('');
    const escBtns = ESCENARIOS_CHAT.map(([tit, prompt]) => `<button class="mp-chip on" data-a="sug" data-s="${esc(prompt)}">${esc(tit)}</button>`).join('');
    const vacio = this.chat.mensajes.length ? '' : `<div class="mp-msg assistant"><p>Hola. Dime en palabras simples qué buscas probar (un rover, aterrizajes, una colonia, cuevas…) o toca un escenario. Yo te explico cada dato, su rigor científico y te pido confirmar antes de correr el motor.</p></div>
      <div class="mp-sugs mp-sugs-esc">${escBtns}</div>
      <div class="mp-sugs">${SUGERENCIAS.map((s) => `<button class="mp-chip" data-a="sug" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    const sinClave = !this.config.configurada
      ? '<div class="mp-aviso">Falta la clave de DeepSeek. <button class="mp-link" data-a="ir-ajustes">Configurarla</button></div>' : '';
    const corriendo = this.busqueda.fase === 'corriendo'
      ? `<div class="mp-chat-loading" role="status"><span class="mp-spin"></span><span>${esc(this.busqueda.msg || 'Motor corriendo…')} Puedes seguir preguntando, pero no lanzar otra corrida hasta que termine.</span></div>` : '';
    return `${ctx}${sinClave}<div class="mp-msgs" aria-live="polite">${vacio}${msgs}${this.chat.enviando ? '<div class="mp-msg assistant"><p class="mp-cargando">Pensando…</p></div>' : ''}</div>
      ${corriendo}
      ${this.chat.error ? `<p class="mp-error">${esc(this.chat.error)}</p>` : ''}
      <div class="mp-envio"><textarea id="mp-chat" rows="2" placeholder="Escribe tu pregunta (Enter envía)" ${this.chat.enviando ? 'disabled' : ''}>${esc(this.chat.borrador)}</textarea>
        <button class="mp-btn primario" data-a="enviar" ${this.chat.enviando ? 'disabled' : ''}>Enviar</button></div>
      ${this.chat.mensajes.length ? '<button class="mp-link" data-a="limpiar-chat">Borrar conversación</button>' : ''}`;
  }

  // ---------- pestaña Ajustes ----------
  private htmlAjustes(): string {
    const m = this.ajustesMsg ? `<p class="${this.ajustesMsg.tipo === 'ok' ? 'mp-ok' : 'mp-error'}" role="status">${esc(this.ajustesMsg.texto)}</p>` : '';
    return `<div class="mp-card"><div class="mp-card-t">DeepSeek <span class="mp-pill ${this.config.configurada ? 'ok' : ''}">${this.config.configurada ? 'clave guardada' : 'sin clave'}</span></div>
      <p class="mp-nota">Para el texto en lenguaje natural y el chat. Sin clave todo lo demás funciona con la plantilla.</p>
      <form id="mp-form-clave" autocomplete="off" data-a-submit="clave">
        <label class="mp-campo">Clave API
          <input id="mp-clave" class="mp-input" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off"
            placeholder="${this.config.configurada ? 'Guardada (escribe otra para reemplazarla)' : 'Pega aquí tu clave'}"></label>
        <label class="mp-campo">Modelo<select id="mp-modelo" class="mp-input">
          ${['deepseek-chat', 'deepseek-reasoner'].map((x) => `<option ${x === this.config.modelo ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <div class="mp-fila-btn"><button class="mp-btn primario" type="submit">Guardar</button>
          ${this.config.configurada ? '<button class="mp-btn" type="button" data-a="borrar-clave">Borrar clave</button>' : ''}</div>
      </form>${m}</div>
      <div class="mp-card"><div class="mp-card-t">Voz (Deepgram) <span class="mp-pill ${this.config.voz_configurada ? 'ok' : ''}">${this.config.voz_configurada ? 'clave guardada' : 'sin clave'}</span></div>
      <p class="mp-nota">Para escuchar las explicaciones y las respuestas del chat. Hace falta una clave de API normal de Deepgram (no un «Voice Agent»).</p>
      <form id="mp-form-voz" autocomplete="off">
        <label class="mp-campo">Clave API de Deepgram
          <input id="mp-clave-dg" class="mp-input" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off"
            placeholder="${this.config.voz_configurada ? 'Guardada (escribe otra para reemplazarla)' : 'Pega aquí tu clave'}"></label>
        <label class="mp-campo">Voz<select id="mp-voz" class="mp-input">
          ${Object.entries(this.config.voces).map(([k, v]) => `<option value="${esc(k)}" ${k === this.config.voz ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="mp-campo">Energía (velocidad de la voz) <output>${this.config.velocidad.toFixed(2)}×</output>
          <input id="mp-vel" type="range" min="0.8" max="1.4" step="0.05" value="${this.config.velocidad}"></label>
        <div class="mp-fila-btn"><button class="mp-btn primario" type="submit">Guardar</button>
          ${this.config.voz_configurada ? `<button class="mp-btn" type="button" data-a="probar-voz">${this.suena?.clave === 'prueba' && !this.suena.error ? '■ Detener' : '▶ Probar voz'}</button><button class="mp-btn" type="button" data-a="borrar-voz">Borrar clave</button>` : ''}</div>
        ${this.suena?.clave === 'prueba' && this.suena.error ? `<p class="mp-error">${esc(this.suena.error)}</p>` : ''}
      </form></div>
      <div class="mp-card"><div class="mp-card-t">Cómo se protege la clave</div>
        <ul class="mp-seg-lista"><li>Se guarda en el archivo <code>.env</code> de tu PC, que git ignora: no se sube.</li>
          <li>Solo la lee el puente local (127.0.0.1); el visor nunca la vuelve a recibir ni la muestra.</li>
          <li>La de DeepSeek recibe las coordenadas y los datos del área que preguntes; la de Deepgram, solo el texto que se va a leer en voz alta.</li>
          <li>Este es un ensayo: borra la clave aquí cuando termines.</li></ul></div>`;
  }

  // ---------- eventos ----------
  private alClic(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    switch (a) {
      case 'auto-voz': this.alternarAutoVoz(); break;
      case 'modo':
        this.colorModo = b.dataset.m as 'grupo' | 'confianza';
        this.capa.colorear(this.colorModo, this.conf);
        this.pintar();
        break;
      case 'plegar': this.plegado = !this.plegado; this.pintar(); break;
      case 'ocultar': this.oculto = true; this.pintar(); break;
      case 'expandir': this.expandido = !this.expandido; this.plegado = false; this.pintar(); break;
      case 'reintentar': this.conectado = null; this.pintar(); void this.iniciar(); break;
      case 'tab':
        this.pestana = b.dataset.t as Pestana;
        if (this.pestana === 'rankings' && !this.puntosGeo) void this.asegurarPuntosGeo().then(() => this.pintar());
        this.pintar();
        break;
      case 'ranking-perfil':
        this.rankingSel = b.dataset.r as RankingId;
        this.rankingMsg = null;
        if ((this.rankingSel === 'cuevas' || this.rankingSel === 'crateres' || this.rankingSel === 'integral') && !this.puntosGeo) {
          void this.asegurarPuntosGeo().then(() => this.pintar());
        }
        this.pintar();
        break;
      case 'guardar-ranking': {
        const { perfil, resultados } = this.calcularRankingActual();
        this.rankingsGuardados = guardarSnapshotRanking(perfil, resultados, 15);
        this.rankingMsg = `Top 15 guardado en «${perfil.nombre}».`;
        this.pintar();
        break;
      }
      case 'exportar-ranking': {
        const { perfil, resultados } = this.calcularRankingActual();
        const blob = new Blob([JSON.stringify({ ranking: perfil, top: resultados.slice(0, 30) }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ranking-${perfil.id}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
      case 'chat-ranking': {
        const { perfil } = this.calcularRankingActual();
        this.pestana = 'chat';
        this.chat.borrador = `¿Cuáles son los mejores sitios en mi ranking "${perfil.nombre}" y por qué? Explícame todas sus variables.`;
        this.pintar();
        void this.enviar();
        break;
      }
      case 'explicar-ranking-item': {
        const id = b.dataset.id;
        if (id) {
          this.pestana = 'mapa';
          void this.capa.seleccionar(id).catch((err) => this.aviso(err));
        }
        break;
      }
      case 'ver-rankings':
        this.pestana = 'rankings';
        if (!this.puntosGeo) void this.asegurarPuntosGeo().then(() => this.pintar());
        this.pintar();
        break;
      case 'ir-ajustes': this.pestana = 'ajustes'; this.pintar(); break;
      case 'nivel':
        this.nivel = b.dataset.n || null;
        this.capa.filtrar(this.activos, this.nivel);
        this.pintar();
        break;
      case 'bono-cercania':
        void this.toggleBonoCercania();
        break;
      case 'grupo': {
        const g = b.dataset.g as Grupo;
        if (this.activos.has(g)) this.activos.delete(g); else this.activos.add(g);
        this.capa.filtrar(this.activos);
        this.pintar();
        break;
      }
      case 'ir': void this.capa.seleccionar(b.dataset.id!).catch((err) => this.aviso(err)); break;
      case 'cerrar': this.capa.deseleccionar(); break;
      case 'preset': this.preset = b.dataset.k!; this.pintar(); break;
      case 'lanzar': void this.lanzar(); break;
      case 'area-modo': {
        if (this.dibujo.dibujando) this.dibujo.cancelar(false);
        this.areaModo = b.dataset.m as ModoArea;
        if (this.areaModo === 'dibujo') { this.area = this.areaDibujada; this.dibujo.mostrar(this.area, !!this.area); }
        else this.aplicarArea(this.areaModo !== 'tierra');
        this.pintar();
        break;
      }
      case 'dibujar':
        this.dibujo.empezar(b.dataset.m as 'caja' | 'poligono');
        this.pintar();
        break;
      case 'cancelar-dibujo': this.dibujo.cancelar(); break;
      case 'area-ver': if (this.area) this.dibujo.mostrar(this.area, true); break;
      case 'area-quitar':
        this.areaModo = 'tierra';
        this.area = null;
        this.areaDibujada = null;
        this.dibujo.mostrar(null);
        this.pintar();
        break;
      case 'barrido': void this.lanzarBarrido(); break;
      case 'ia': if (this.expl) void this.cargarExplicacion(this.expl.id, true); break;
      case 'guardar': void this.guardar(); break;
      case 'preguntar': this.pestana = 'chat'; this.chat.conArea = true; this.pintar(); this.el.querySelector<HTMLElement>('#mp-chat')?.focus(); break;
      case 'uso-nasa': {
        this.pestana = 'chat';
        this.chat.conArea = true;
        this.chat.borrador =
          '¿Para qué la NASA podría usar exactamente este lugar según los datos recuperados? Analiza todos los casos posibles (movilidad de rovers, aterrizaje/navegación, ISRU/hielo/permafrost, polvo/sellos en µm, astrobiología/salares, entrenamiento de geología o refugio en cuevas/cráteres) usando todas las variables, minerales, filtros y diferencias físicas reales de este sitio, y dame una explicación bien detallada.';
        this.pintar();
        void this.enviar();
        break;
      }
      case 'sug': this.chat.borrador = b.dataset.s ?? ''; void this.enviar(); break;
      case 'analizar-zona':
        if (!this.zonaMapa) break;
        this.pestana = 'chat';
        this.conZona = true;
        this.chat.borrador = `Analiza el recuadro seleccionado "${this.zonaMapa.nombre}" (${this.zonaMapa.area_km2 != null ? `${this.zonaMapa.area_km2} km²` : 'zona del mapa'}) usando solo las celdas dentro de él: dime si sirve para entrenar un rover, buscar sitios de aterrizaje, terreno accidentado o colonia/hielo, qué filtros y rasgos tiene (incluyendo cuevas o cráteres cercanos) y con qué sitios de la Luna o Marte resulta compatible.`;
        this.pintar();
        void this.enviar();
        break;
      case 'aprobar-propuesta': void this.aprobarPropuesta(Number(b.dataset.i)); break;
      case 'descartar-propuesta': {
        const m = this.chat.mensajes[Number(b.dataset.i)];
        if (m?.propuesta && (m.propuesta.estado ?? 'pendiente') === 'pendiente') { m.propuesta.estado = 'descartada'; this.pintar(); }
        break;
      }
      case 'enviar': void this.enviar(); break;
      case 'limpiar-chat': this.chat = { ...this.chat, mensajes: [], error: null, borrador: '' }; this.pintar(); break;
      case 'borrar-clave': void this.borrarClave('deepseek'); break;
      case 'borrar-voz': void this.borrarClave('deepgram'); break;
      case 'oir': void this.oir(b.dataset.k!); break;
      case 'parar': this.parar(); break;
      case 'probar-voz':
        if (this.suena?.clave === 'prueba' && !this.suena.error) { this.parar(); break; }
        this.guiones.set('prueba', [
          { t: '¡Hola! Soy la voz del motor de análogos.', ritmo: 'animado', pausa_ms: 200 },
          { t: 'Esta zona se parece a Marte, con un parecido del noventa por ciento.', ritmo: 'normal', pausa_ms: 150 },
          { t: 'Es un ensayo.', ritmo: 'suave', pausa_ms: 0 },
        ]);
        void this.oir('prueba');
        break;
      default: break;
    }
  }

  private alTecla(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.id === 'mp-chat' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.enviar(); }
    if (t.id === 'mp-clave' && e.key === 'Enter') { e.preventDefault(); void this.guardarClave(); }
  }

  private alCambio(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id === 'mp-q') { this.texto = t.value; this.pintar(); }
    else if (t.id === 'mp-chat') this.chat.borrador = t.value;
    else if (t.id === 'mp-ctx') this.chat.conArea = t.checked;
    else if (t.id === 'mp-ctx-zona') this.conZona = t.checked;
    else if (t.id === 'mp-obj') {
      this.objetivoSel = t.value;
      const o = this.objetivos.find((x) => x.id === t.value);
      if (o && !o.perfiles.includes(this.perfilSel)) this.perfilSel = o.perfiles.includes('terreno_termico') ? 'terreno_termico' : o.perfiles[0];
      this.pintar();
    } else if (t.id === 'mp-perfil') this.perfilSel = t.value;
    else if (t.id === 'mp-veg') { this.filtroVeg = t.checked; this.pintar(); }
    else if (t.id === 'mp-ndvi') { this.ndvi = Number(t.value); this.salida(t, this.ndvi.toFixed(2)); }
    else if (t.id === 'mp-cand') { this.candidatos = Number(t.value); this.salida(t, String(this.candidatos)); }
    else if (t.id === 'mp-exkm') { this.excKm = Number(t.value); this.salida(t, this.excKm === 0 ? 'el de cada área' : `${this.excKm} km`); }
    else if (t.id === 'mp-vel') this.salida(t, `${Number(t.value).toFixed(2)}×`);
    else if (t.id === 'mp-region') { this.regionSel = t.value; this.aplicarArea(true); this.pintar(); }
    else if (t.id.startsWith('mp-c-')) {
      const i = { 'mp-c-s': 0, 'mp-c-o': 1, 'mp-c-n': 2, 'mp-c-e': 3 }[t.id]!;
      this.caja[i] = t.value.trim() === '' ? null : Number(t.value);
      this.aplicarArea();
      this.pintar();
    } else if (t.id === 'mp-karea') { this.kArea = Number(t.value); this.salida(t, this.kArea.toFixed(2)); }
    else if (t.id === 'mp-piso') { this.pisoKm2 = Number(t.value); this.salida(t, this.pisoKm2 === 0 ? 'sin piso' : formatoKm2(this.pisoKm2)); }
    else if (t.id === 'mp-excl') this.excluir = t.checked;
    else if (t.id === 'mp-prev') this.previos = t.checked;
    else if (t.id === 'mp-modelo') void this.guardarModelo(t.value);
  }

  /** Al soltar un deslizador del área se repinta (radio efectivo, piso y botón de lanzar dependen de él). */
  private alSoltar(e: Event): void {
    const id = (e.target as HTMLElement).id;
    if (id === 'mp-karea' || id === 'mp-piso') this.pintar();
  }

  private salida(t: HTMLElement, texto: string): void {
    const o = t.parentElement?.querySelector('output');
    if (o) o.value = texto;
  }

  private aviso(err: unknown): void {
    this.busqueda = { fase: 'error', msg: err instanceof Error ? err.message : String(err) };
    this.pintar();
  }

  // ---------- acciones ----------
  private async recargarAreas(): Promise<void> {
    this.areas = await this.capa.cargar();
    this.conf = await motorApi.confianza().catch(() => this.conf);
    this.capa.colorear(this.colorModo, this.conf);
    this.activos.add('nuevo');
    this.capa.filtrar(this.activos);
  }

  private async lanzar(): Promise<void> {
    const area = this.areaModo !== 'tierra' ? this.area : null;
    const donde = area ? ` en ${area.nombre ?? (area.tipo === 'bbox' ? 'la caja' : 'el polígono')}` : '';
    this.busqueda = { fase: 'corriendo', msg: `Buscando análogos de ${this.objetivoSel}${donde}…` };
    this.pintar();
    try {
      const { id } = await motorApi.lanzar({
        objetivo: this.objetivoSel, perfil: this.perfilSel, factores: PRESETS[this.preset].factores,
        ndvi_max: this.filtroVeg ? this.ndvi : 1, candidatos: this.candidatos, excluir_indice: this.excluir, excluir_previos: this.previos, excluir_km: this.excKm,
        ...(area ? { area, k_area: this.kArea, min_area_km2: this.pisoKm2 } : {}),
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const s = await motorApi.estado(id);
        if (s.estado === 'corriendo') continue;
        if (s.estado === 'error') throw new Error(s.error ?? 'falló la búsqueda');
        await this.recargarAreas();
        this.ultimaArea = s.area ?? null;
        const enArea = s.area ? ` dentro de ${formatoKm2(s.area.tierra_km2)} de tierra elegible (${s.area.regiones_con_tierra} regiones)` : '';
        const { perfil, resultados } = this.calcularRankingActual();
        const mejoresCorrida = resultados.filter((r) => r.entrada.id.startsWith(id)).slice(0, 3);
        const resumenRk = mejoresCorrida.length
          ? ` Top en «${perfil.nombre}»: ${mejoresCorrida.map((r, i) => `#${i + 1} ${r.entrada.id} (${r.valor}/100)`).join(', ')}.`
          : '';
        this.busqueda = { fase: 'terminado', msg: `Listo en ${(s.segundos ?? 0).toFixed(1)} s: ${s.n_areas} áreas nuevas (magenta)${enArea}.${resumenRk}` };
        if (area) this.dibujo.mostrar(area); // el área queda dibujada junto a los pines nuevos
        if (s.area && s.n_areas === 0) { this.pintar(); return; } // nada que mostrar: se queda en Buscar con el conteo
        this.pestana = 'mapa';
        this.texto = id;
        this.pintar();
        const primera = this.areas.find((a) => a.id.startsWith(id));
        if (primera) await this.capa.seleccionar(primera.id);
        return;
      }
    } catch (err) {
      this.aviso(err);
    }
  }

  private async lanzarBarrido(): Promise<void> {
    this.busqueda = { fase: 'corriendo', msg: 'Barrido en marcha…' };
    this.pintar();
    try {
      const { id, escenarios, corridas } = await motorApi.lanzarBarrido(this.excKm || 500);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const s = await motorApi.estado(id);
        const hechas = (s.corridas ?? []).filter((c) => c.estado !== 'corriendo').length;
        if (s.estado === 'corriendo') {
          this.busqueda = { fase: 'corriendo', msg: `Corrida ${Math.min(hechas + 1, corridas.length)} de ${corridas.length} (${escenarios} escenarios en total)…` };
          this.pintar();
          continue;
        }
        if (s.estado === 'error') throw new Error(s.error ?? 'falló el barrido');
        await this.recargarAreas();
        this.busqueda = { fase: 'terminado', msg: `Barrido listo en ${((s.segundos ?? 0) / 60).toFixed(1)} min: ${this.conteo('nuevo')} áreas nuevas.` };
        this.pestana = 'mapa';
        this.pintar();
        return;
      }
    } catch (err) {
      this.aviso(err);
    }
  }

  private async guardar(): Promise<void> {
    const p = this.seleccion?.properties as Record<string, unknown> | undefined;
    if (!p) return;
    try {
      await motorApi.guardar({
        id: `HZ-${String(p.id)}`, lat: p.lat, lon: p.lon, radio_km: p.radio_km, fuente: p.fuente,
        etiqueta: p.etiqueta, resumen: p.resumen, objetivo: p.objetivo, perfil: p.perfil,
      });
      this.areas = await this.capa.cargar();
      this.busqueda = { fase: 'terminado', msg: `Guardado como HZ-${String(p.id)} (candidato sin verificar).` };
    } catch (err) {
      this.aviso(err);
      return;
    }
    this.pintar();
  }

  private async enviar(): Promise<void> {
    const texto = this.chat.borrador.trim();
    if (!texto || this.chat.enviando) return;
    this.chat.mensajes.push({ rol: 'user', texto });
    this.chat.borrador = '';
    this.chat.enviando = true;
    this.chat.error = null;
    this.pintar();
    try {
      const areaId = this.chat.conArea && this.seleccion ? String(this.seleccion.properties.id) : null;
      const { perfil, resultados } = this.calcularRankingActual();
      const rankingCtx = {
        perfil: { id: perfil.id, nombre: perfil.nombre, descripcion: perfil.descripcion },
        top_actual: resultados.slice(0, 10).map((r, idx) => ({
          puesto: idx + 1,
          id: r.entrada.id,
          etiqueta: r.entrada.etiqueta,
          objetivo: r.entrada.objetivo,
          valor: r.valor,
          parecido_pct: r.desglose.parecido,
          solidez_pct: r.desglose.solidez,
          rasgo: r.rasgoCercano ? `${r.rasgoCercano.nombre} (${r.rasgoCercano.distKm} km)` : null,
        })),
        guardados: Object.values(this.rankingsGuardados).map((g) => ({
          id: g.rankingId,
          nombre: g.nombreRanking,
          fecha: g.fechaIso.slice(0, 10),
          top5: g.items.slice(0, 5),
        })),
      };
      const r = await motorApi.chat(
        this.chat.mensajes.slice(-12).map(({ rol, texto }) => ({ rol, texto })),
        areaId,
        rankingCtx,
        this.conZona ? this.zonaMapa : null
      );
      this.chat.mensajes.push({ rol: 'assistant', texto: r.texto, guion: r.guion, ...(r.propuesta ? { propuesta: { ...r.propuesta, estado: 'pendiente' } } : {}) });
      this.chat.enviando = false;
      this.pintar();
      if (r.acciones_mapa?.length) this.aplicarAccionesMapa(r.acciones_mapa);
      if (r.busqueda_id) void this.vigilarBusquedaChat(r.busqueda_id);
      if (this.autoVoz && this.config.voz_configurada) void this.oir(`chat:${this.chat.mensajes.length - 1}`);
      return;
    } catch (err) {
      this.chat.error = err instanceof Error ? err.message : String(err);
    }
    this.chat.enviando = false;
    this.pintar();
  }

  private htmlPropuestaChat(p: PropuestaChat, i: number): string {
    const est = p.estado ?? 'pendiente';
    const bloqueado = this.busqueda.fase === 'corriendo';
    const badge = p.es_exploracion_creativa ? '<span class="mp-pill">exploración creativa</span>' : '<span class="mp-pill">guarda previa</span>';
    const botones = est === 'pendiente'
      ? `<div class="mp-prop-btns"><button class="mp-btn pri" data-a="aprobar-propuesta" data-i="${i}" ${bloqueado ? 'disabled title="Espera a que termine la corrida actual"' : ''}>Aprobar y correr</button><button class="mp-btn" data-a="descartar-propuesta" data-i="${i}">Descartar</button></div>`
      : `<p class="mp-nota">${est === 'aprobada' ? 'Aprobada y enviada al motor.' : 'Descartada por el usuario.'}</p>`;
    return `<div class="mp-propuesta">
      <div class="mp-prop-head"><strong>${esc(p.titulo)}</strong>${badge}</div>
      ${p.explicacion_simple ? `<p>${esc(p.explicacion_simple)}</p>` : ''}
      ${p.rigor_cientifico ? `<p class="mp-prop-rigor"><b>Rigor científico:</b> ${esc(p.rigor_cientifico)}</p>` : ''}
      ${botones}
    </div>`;
  }

  private aplicarAccionesMapa(acciones: AccionMapaChat[]): void {
    for (const a of acciones) {
      if (a.tipo === 'enfocar_area' && a.id) void this.capa.seleccionar(a.id);
      else if (a.tipo === 'capa_cuevas' || a.tipo === 'capa_crateres') {
        const btn = document.querySelector<HTMLButtonElement>(a.tipo === 'capa_cuevas' ? '#btnToggleCuevas' : '#btnToggleCrateres');
        if (btn) {
          const actual = btn.getAttribute('aria-pressed') === 'true';
          if (a.visible === undefined || a.visible !== actual) btn.click();
        }
      }
    }
  }

  private async aprobarPropuesta(i: number): Promise<void> {
    if (this.busqueda.fase === 'corriendo') return;
    const m = this.chat.mensajes[i];
    const p = m?.propuesta;
    if (!p || (p.estado ?? 'pendiente') !== 'pendiente') return;
    p.estado = 'aprobada';
    this.pintar();
    try {
      if (p.tipo === 'busqueda') {
        const { id } = await motorApi.lanzar(p.params);
        void this.vigilarBusquedaChat(id);
      } else if (p.tipo === 'barrido') {
        const { id } = await motorApi.lanzarBarrido(Number(p.params.excluir_km ?? 500), Number(p.params.max_escenarios ?? 500));
        void this.vigilarBusquedaChat(id);
      } else if (p.tipo === 'guardar_area') {
        await motorApi.guardar(p.params);
        await this.recargarAreas();
        this.chat.mensajes.push({ rol: 'assistant', texto: `Hallazgo ${String(p.params.id ?? '')} guardado en el mapa.` });
        this.pintar();
      }
    } catch (err) {
      this.chat.error = err instanceof Error ? err.message : String(err);
      this.pintar();
    }
  }

  private bindTopFiltersSlot(): void {
    const slot = document.getElementById('motorFiltersSlot');
    if (!slot) return;
    slot.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-f]');
      if (!btn) return;
      if (btn.dataset.f === 'grupo') {
        const g = btn.dataset.g as Grupo;
        if (this.activos.has(g)) this.activos.delete(g); else this.activos.add(g);
        this.capa.filtrar(this.activos, this.nivel);
        this.pintar();
      } else if (btn.dataset.f === 'limpiar') {
        void this.limpiarRegistros();
      }
    });
    slot.addEventListener('change', (e) => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('#topFiltroNivel');
      if (!sel) return;
      this.nivel = sel.value || null;
      this.capa.filtrar(this.activos, this.nivel);
      this.pintar();
    });
  }

  private pintarTopFiltersSlot(): void {
    const slot = document.getElementById('motorFiltersSlot');
    if (!slot) return;
    if (!this.conectado) {
      slot.innerHTML = '';
      return;
    }
    const chips = GRUPOS.map((g) => `<button type="button" class="mp-chip ${this.activos.has(g) ? 'on' : ''}" data-f="grupo" data-g="${g}"><i class="mp-dot" style="background:${COLOR_GRUPO[g]}"></i>${NOMBRE_GRUPO[g]} (${this.conteo(g)})</button>`).join('');
    const opts = NIVELES.map(([v, t]) => `<option value="${v ?? ''}" ${(this.nivel ?? '') === (v ?? '') ? 'selected' : ''}>Solidez: ${t}</option>`).join('');
    const nNuevos = this.conteo('nuevo');
    const deshab = this.busqueda.fase === 'corriendo' || nNuevos === 0;
    slot.innerHTML = `${chips}<select id="topFiltroNivel" class="mp-select-mini" title="Filtrar pines por solidez del ajuste">${opts}</select><button type="button" class="tool-btn btn-limpiar-reg" data-f="limpiar" ${deshab ? 'disabled' : ''} title="Mover las búsquedas nuevas a una carpeta de respaldo y limpiar el mapa">Limpiar registros (${nNuevos})</button>`;
  }

  private async limpiarRegistros(): Promise<void> {
    if (this.busqueda.fase === 'corriendo') return;
    const nNuevos = this.conteo('nuevo');
    if (!nNuevos) return;
    if (!window.confirm(`¿Mover las ${nNuevos} áreas de búsquedas nuevas a un respaldo con fecha y limpiar el mapa? (Conserva los 43 análogos documentados y barridos previos.)`)) return;
    try {
      const r = await motorApi.limpiarRegistros();
      await this.recargarAreas();
      if (this.seleccion && !this.areas.some((a) => a.id === String(this.seleccion!.properties.id))) {
        this.seleccion = null;
      }
      this.busqueda = { fase: 'terminado', msg: `Limpiadas ${r.movidas} corridas (respaldadas).` };
      this.pintar();
    } catch (err) {
      this.aviso(err);
    }
  }

  private async vigilarBusquedaChat(id: string): Promise<void> {
    this.busqueda = { fase: 'corriendo', msg: `Corrida ${id} en curso…` };
    this.pintar();
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        const s = await motorApi.estado(id);
        if (s.estado === 'corriendo') continue;
        if (s.estado === 'error') throw new Error(s.error ?? 'falló la búsqueda');
        await this.recargarAreas();
        const seg = (s.segundos ?? 0).toFixed(1);
        this.busqueda = { fase: 'terminado', msg: `Listo (${id}) en ${seg} s: ${s.n_areas} áreas nuevas (magenta).` };
        this.chat.mensajes.push({
          rol: 'assistant',
          texto: `Listo: la corrida **${id}** terminó en **${seg} s** y encontró **${s.n_areas}** áreas nuevas (pines magenta) en el mapa. Si quieres analizar alguna o lanzar otra con pesos/filtros distintos, dime.`,
        });
        this.pintar();
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.busqueda = { fase: 'error', msg };
      this.chat.mensajes.push({ rol: 'assistant', texto: `La corrida **${id}** falló: ${msg}` });
      this.pintar();
    }
  }

  private async guardarClave(): Promise<void> {
    const campo = this.el.querySelector<HTMLInputElement>('#mp-clave');
    const modelo = this.el.querySelector<HTMLSelectElement>('#mp-modelo')?.value;
    const clave = campo?.value.trim() ?? '';
    try {
      this.config = await motorApi.guardarConfig({ ...(clave ? { clave } : {}), modelo });
      this.ajustesMsg = { tipo: 'ok', texto: clave ? 'Clave guardada en .env. No se vuelve a mostrar.' : 'Modelo actualizado.' };
    } catch (err) {
      this.ajustesMsg = { tipo: 'error', texto: err instanceof Error ? err.message : String(err) };
    }
    if (campo) campo.value = '';
    this.pintar();
  }

  private async guardarModelo(modelo: string): Promise<void> {
    try { this.config = await motorApi.guardarConfig({ modelo }); this.ajustesMsg = { tipo: 'ok', texto: `Modelo: ${modelo}` }; }
    catch (err) { this.ajustesMsg = { tipo: 'error', texto: err instanceof Error ? err.message : String(err) }; }
    this.pintar();
  }

  private async guardarVoz(): Promise<void> {
    const campo = this.el.querySelector<HTMLInputElement>('#mp-clave-dg');
    const voz = this.el.querySelector<HTMLSelectElement>('#mp-voz')?.value;
    const velocidad = Number(this.el.querySelector<HTMLInputElement>('#mp-vel')?.value ?? this.config.velocidad);
    const clave = campo?.value.trim() ?? '';
    try {
      this.config = await motorApi.guardarConfig({ ...(clave ? { clave_deepgram: clave } : {}), voz, velocidad });
      this.ajustesMsg = { tipo: 'ok', texto: clave ? 'Clave de Deepgram guardada en .env. No se vuelve a mostrar.' : 'Voz actualizada.' };
    } catch (err) {
      this.ajustesMsg = { tipo: 'error', texto: err instanceof Error ? err.message : String(err) };
    }
    if (campo) campo.value = '';
    this.pintar();
  }

  private async borrarClave(cual: 'deepseek' | 'deepgram'): Promise<void> {
    try { this.config = await motorApi.borrarClave(cual); this.ajustesMsg = { tipo: 'ok', texto: 'Clave borrada de .env.' }; }
    catch (err) { this.ajustesMsg = { tipo: 'error', texto: err instanceof Error ? err.message : String(err) }; }
    this.pintar();
  }
}
