// Reproduce un guion de voz: pide cada trozo al puente (que llama a Deepgram), lo toca y espera la pausa.
// Pide hasta dos trozos por delante para que no haya huecos. ENSAYO (ADR-005).
// Garantía: nunca suenan dos voces a la vez. Todo Audio creado se registra y `detener()` los pausa TODOS,
// y cualquier instancia de Locutor (p. ej. tras una recarga en caliente) calla a las demás antes de hablar.
import { motorApi, type Segmento } from './api';

const todos = new Set<Locutor>();

export class Locutor {
  private token = 0;
  private activo = false;
  private audios = new Set<HTMLAudioElement>();
  private urls: string[] = [];
  private abortar: AbortController | null = null;
  private liberar = new Set<() => void>(); // promesas de `tocar` pendientes: al detener se liberan

  constructor() {
    todos.add(this);
  }

  get hablando(): boolean {
    return this.activo;
  }

  detener(): void {
    this.activo = false;
    this.token++;
    this.abortar?.abort();
    this.abortar = null;
    for (const a of this.audios) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.audios.clear();
    for (const fin of [...this.liberar]) fin();
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }

  /** Habla el guion completo. Resuelve al terminar o al detenerse; rechaza si el puente o Deepgram fallan. */
  async hablar(guion: Segmento[]): Promise<void> {
    for (const l of todos) l.detener(); // una sola voz en todo el visor
    const yo = ++this.token;
    this.activo = true;
    const ctl = new AbortController();
    this.abortar = ctl;
    // Pide hasta dos trozos por delante: mientras suena uno, los siguientes ya se están sintetizando.
    const cola = new Map<number, Promise<Blob>>();
    const pedirIdx = (i: number): void => {
      if (i < guion.length && !cola.has(i)) {
        const p = motorApi.voz(guion[i].t, guion[i].ritmo, ctl.signal);
        p.catch(() => undefined); // el error se atiende cuando le toque
        cola.set(i, p);
      }
    };
    try {
      for (let i = 0; i < guion.length; i++) {
        pedirIdx(i);
        pedirIdx(i + 1);
        pedirIdx(i + 2);
        const blob = await cola.get(i)!;
        cola.delete(i);
        if (yo !== this.token) return;
        await this.tocar(blob, yo);
        if (yo !== this.token) return;
        if (guion[i].pausa_ms > 0) await new Promise((r) => setTimeout(r, guion[i].pausa_ms));
        if (yo !== this.token) return;
      }
    } catch (e) {
      if (yo !== this.token) return; // detenido a propósito: no es un error
      throw e;
    } finally {
      if (yo === this.token) this.detener();
    }
  }

  private tocar(blob: Blob, yo: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (yo !== this.token) return resolve();
      const url = URL.createObjectURL(blob);
      this.urls.push(url);
      const a = new Audio(url);
      this.audios.add(a);
      const fin = (): void => { this.liberar.delete(fin); resolve(); };
      this.liberar.add(fin);
      a.onended = fin;
      a.onerror = () => (yo === this.token ? reject(new Error('no se pudo reproducir el audio')) : fin());
      a.play().catch((e: unknown) => {
        if (yo !== this.token) return resolve();
        const bloqueado = e instanceof DOMException && e.name === 'NotAllowedError';
        reject(new Error(bloqueado ? 'El navegador bloqueó el audio automático: toca ▶ Escuchar una vez.' : String(e)));
      });
    });
  }
}
