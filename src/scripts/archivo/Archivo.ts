import { gsap } from 'gsap';
import { CONFIG } from '../esferas/config';
import { Columna } from './Columna';
import { Cristal, hayQuePedir } from './Cristal';
import { cargarFotos } from './fotos';
import type { Pila } from './Pila';
import type { Proyecto } from '../../data/proyectos';

export { hayQuePedir };

/** 'pedir' = cristal y contraseña · 'auto' = demostración del desbloqueo · 'no' = directo a la entrada. */
export type ModoCandado = 'pedir' | 'auto' | 'no';

/**
 * Archivo de fotos de un proyecto:
 * cristal (si hay contraseña) → pila 3D con ola y cámara alejándose → corte seco → columna infinita.
 */
export class Archivo {
  readonly cristal: Cristal;
  private readonly columna: Columna;
  private readonly titulo: HTMLElement;
  private readonly pilaHost: HTMLElement;
  pila: Pila | null = null;
  private pilaCargando: Promise<Pila | null> | null = null;
  private proyecto: Proyecto | null = null;
  /** Se incrementa en cada apertura/cierre: cancela secuencias anteriores. */
  private turno = 0;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly root: HTMLElement) {
    this.cristal = new Cristal(root.querySelector('[data-cristal]')!);
    this.columna = new Columna(root.querySelector('[data-columna]')!);
    this.titulo = root.querySelector('[data-titulo]')!;
    this.pilaHost = root.querySelector('[data-pila]')!;
  }

  get abierto() {
    return !this.root.hidden && this.proyecto !== null;
  }

  get actual() {
    return this.proyecto;
  }

  /** Three.js se carga solo cuando hace falta. */
  private cargarPila() {
    this.pilaCargando ??= import('./Pila')
      .then(({ Pila }) => (this.pila = new Pila(this.pilaHost)))
      .catch((err) => {
        console.error('[archivo] WebGL no disponible', err);
        return null;
      });
    return this.pilaCargando;
  }

  /** Precarga Three.js y las fotos (p. ej. mientras la esfera se expande). */
  precargar(proyecto: Proyecto) {
    this.cargarPila();
    cargarFotos(proyecto);
  }

  async abrir(proyecto: Proyecto, modo: ModoCandado = hayQuePedir() ? 'pedir' : 'no') {
    const turno = ++this.turno;
    this.proyecto = proyecto;
    this.titulo.textContent = proyecto.title;
    this.root.classList.remove('con-columna');
    this.columna.hide();
    this.root.hidden = false;
    gsap.killTweensOf(this.root);
    gsap.fromTo(this.root, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out' });

    const [pila, fotos] = await Promise.all([this.cargarPila(), cargarFotos(proyecto)]);
    if (turno !== this.turno) return;
    this.columna.setFotos(fotos);
    const texturas = pila?.setFotos(fotos) ?? Promise.resolve();
    pila?.idle();

    if (modo !== 'no') {
      this.root.classList.add('con-cristal');
      const ok = await this.cristal.pedir({ auto: modo === 'auto' });
      this.root.classList.remove('con-cristal');
      if (!ok || turno !== this.turno) return;
    }
    await texturas;
    if (turno !== this.turno) return;
    await this.entrada(turno);
  }

  /** Entrada de la pila y paso a la columna (vuelo o corte). */
  private async entrada(turno: number) {
    this.columna.hide();
    this.root.classList.remove('con-columna');
    if (this.pila && !this.reduced) {
      await this.pila.play();
      if (turno !== this.turno) return;
      if (CONFIG.archivo.transition === 'vuelo') {
        await this.vuelo(this.pila, turno);
        return;
      }
    }
    // Corte de golpe: un solo frame en blanco y aparece la columna.
    this.pila?.hide();
    requestAnimationFrame(() => {
      if (turno !== this.turno) return;
      this.mostrarColumna();
    });
  }

  private mostrarColumna() {
    this.root.classList.add('con-columna');
    this.columna.start();
  }

  /** Cada foto vuela de la pila a su hueco en la columna; luego relevo invisible a la columna real. */
  private async vuelo(pila: Pila, turno: number) {
    const rects = this.columna.prepararVuelo();
    const H = window.innerHeight;
    // Todas vuelan a su hueco (ninguna desaparece): las de fuera de pantalla salen por arriba o por abajo.
    const huecos = rects.map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
    const orden = ordenCascada(rects, CONFIG.archivo.flightOrder, H);
    const visibles = rects.flatMap((r, i) => (r.bottom > 0 && r.top < H ? [i] : []));
    const listas = this.columna.listas(visibles);

    await new Promise((r) => setTimeout(r, CONFIG.archivo.flightPause * 1000));
    if (turno !== this.turno) return;
    await pila.volar(huecos, orden);
    if (turno !== this.turno) return;
    await listas;
    if (turno !== this.turno) return;
    // Relevo en el mismo frame: las posiciones coinciden al píxel.
    this.mostrarColumna();
    pila.hide();
  }

  /** Panel de desarrollo: vuelve a poner el cristal y lo desbloquea solo. */
  async probarDesbloqueo() {
    if (!this.proyecto) return false;
    await this.abrir(this.proyecto, 'auto');
    return true;
  }

  /** Panel de desarrollo: repite la entrada de la pila. */
  repetirEntrada() {
    if (!this.proyecto || this.cristal.abierto) return false;
    const turno = ++this.turno;
    this.pila?.stop();
    this.entrada(turno);
    return true;
  }

  async cerrar() {
    if (this.root.hidden) return;
    ++this.turno;
    this.cristal.cancelar();
    this.columna.stop();
    await new Promise<void>((r) => gsap.to(this.root, { opacity: 0, duration: 0.4, ease: 'power1.in', onComplete: r }));
    this.pila?.hide();
    this.columna.hide();
    this.root.hidden = true;
    this.root.classList.remove('con-columna', 'con-cristal');
    this.proyecto = null;
  }
}

/** Orden de salida de cada foto en la cascada del vuelo. */
function ordenCascada(rects: DOMRect[], modo: string, H: number): number[] {
  const idx = rects.map((_, i) => i);
  switch (modo) {
    case 'abajo-arriba':
      return idx.sort((a, b) => rects[b].top - rects[a].top);
    case 'centro': {
      const c = (r: DOMRect) => Math.abs(r.top + r.height / 2 - H / 2);
      return idx.sort((a, b) => c(rects[a]) - c(rects[b]));
    }
    case 'aleatorio': {
      let seed = 1234567;
      const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return idx;
    }
    default: // 'arriba-abajo'
      return idx.sort((a, b) => rects[a].top - rects[b].top);
  }
}
