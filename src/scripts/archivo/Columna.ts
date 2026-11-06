import { CONFIG } from '../esferas/config';
import type { Foto } from './fotos';

const PAUSA_MS = 2000;

/**
 * Columna vertical de fotos que baja sola en bucle infinito.
 * Rueda, arrastre o dedo la mueven; al tocarla se pausa y a los 2 s sigue sola.
 */
export class Columna {
  private readonly track: HTMLElement;
  private fotos: Foto[] = [];
  private sets: HTMLElement[] = [];
  private setH = 0;
  private offset = 0;
  /** Velocidad actual (px/s), con inercia tras arrastrar. */
  private vel = 0;
  private lastInteraction = -Infinity;
  private dragging = false;
  private dragY = 0;
  private dragT = 0;
  private running = false;
  private raf = 0;
  private last = 0;
  private key = '';

  constructor(private readonly root: HTMLElement) {
    this.track = root.querySelector('[data-track]')!;

    root.addEventListener(
      'wheel',
      (e) => {
        if (!this.running) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        this.offset += e.deltaY * k;
        this.vel = 0;
        this.touch();
      },
      { passive: false },
    );
    root.addEventListener('pointerdown', (e) => {
      if (!this.running) return;
      this.dragging = true;
      this.dragY = e.clientY;
      this.dragT = performance.now();
      this.vel = 0;
      root.setPointerCapture(e.pointerId);
      root.classList.add('arrastrando');
      this.touch();
    });
    root.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dy = e.clientY - this.dragY;
      const dt = Math.max(1, now - this.dragT) / 1000;
      this.offset -= dy;
      // velocidad para la inercia al soltar (suavizada)
      this.vel = this.vel * 0.6 + (-dy / dt) * 0.4;
      this.dragY = e.clientY;
      this.dragT = now;
      this.touch();
    });
    const fin = () => {
      if (!this.dragging) return;
      this.dragging = false;
      root.classList.remove('arrastrando');
      if (performance.now() - this.dragT > 80) this.vel = 0;
      this.touch();
    };
    root.addEventListener('pointerup', fin);
    root.addEventListener('pointercancel', fin);
    window.addEventListener('resize', () => this.running && this.measure(true));
  }

  private touch() {
    this.lastInteraction = performance.now();
  }

  setFotos(fotos: Foto[]) {
    this.fotos = fotos;
    this.track.textContent = '';
    this.sets = [];
    this.key = '';
    this.offset = 0;
  }

  private ancho() {
    const { columnWidth, columnWidthMobile } = CONFIG.archivo;
    const movil = window.innerWidth < 700;
    return Math.max(56, Math.round(window.innerWidth * (movil ? columnWidthMobile : columnWidth)));
  }

  private crearSet() {
    const set = document.createElement('div');
    set.className = 'archivo__set';
    const sizes = `${this.ancho()}px`;
    for (const f of this.fotos) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.width = f.w;
      img.height = f.h;
      img.style.aspectRatio = `${f.w} / ${f.h}`;
      if (f.srcset) {
        img.sizes = sizes;
        img.srcset = f.srcset;
      }
      img.src = f.src;
      set.appendChild(img);
    }
    return set;
  }

  /** Recalcula ancho, separación y nº de copias cuando cambian (pantalla o panel). */
  private measure(force = false) {
    const w = this.ancho();
    const key = `${w}|${CONFIG.archivo.columnGap}|${window.innerHeight}`;
    if (!force && key === this.key) return;
    this.key = key;
    this.root.style.setProperty('--col-w', `${w}px`);
    this.root.style.setProperty('--col-gap', `${CONFIG.archivo.columnGap}px`);
    if (!this.sets.length && this.fotos.length) {
      this.sets.push(this.crearSet());
      this.track.appendChild(this.sets[0]);
    }
    if (!this.sets.length) return;
    const prev = this.setH;
    this.setH = this.sets[0].getBoundingClientRect().height || 1;
    if (prev) this.offset *= this.setH / prev;
    // Copias suficientes para cubrir la pantalla sin hueco al dar la vuelta.
    const copias = Math.max(2, Math.ceil(window.innerHeight / this.setH) + 1);
    while (this.sets.length < copias) {
      const s = this.sets[0].cloneNode(true) as HTMLElement;
      s.setAttribute('aria-hidden', 'true');
      this.sets.push(s);
      this.track.appendChild(s);
    }
  }

  /**
   * Coloca la columna (aún invisible) en su posición inicial y devuelve, para cada foto,
   * su rectángulo en el viewport: el destino exacto del vuelo desde la pila.
   */
  prepararVuelo(): DOMRect[] {
    this.stop();
    this.offset = 0;
    this.vel = 0;
    this.measure(true);
    this.track.style.transform = 'translate3d(-50%, 0px, 0)';
    if (!this.sets.length) return [];
    const imgs = [...this.sets[0].querySelectorAll('img')];
    // La columna arranca centrada: la foto del medio queda en el centro de la pantalla
    // (igual que el centro de la pila), las primeras por encima y las últimas por debajo.
    const mid = imgs[Math.floor((imgs.length - 1) / 2)]?.getBoundingClientRect();
    if (mid) this.offset = Math.max(0, mid.top + mid.height / 2 - window.innerHeight / 2);
    this.track.style.transform = `translate3d(-50%, ${-this.offset}px, 0)`;
    return imgs.map((img) => img.getBoundingClientRect());
  }

  /** Espera a que las fotos visibles de la columna estén decodificadas (para el relevo sin salto). */
  listas(indices: number[], timeout = 1500): Promise<void> {
    const imgs = this.sets[0] ? [...this.sets[0].querySelectorAll('img')] : [];
    const decodes = indices.map((i) => imgs[i]?.decode().catch(() => {}));
    return Promise.race([Promise.all(decodes).then(() => {}), new Promise<void>((r) => setTimeout(r, timeout))]);
  }

  start() {
    this.root.style.visibility = 'visible';
    if (this.running) return;
    this.running = true;
    this.measure(true);
    this.vel = CONFIG.archivo.autoscroll;
    this.lastInteraction = -Infinity;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.measure();
      if (!this.dragging) {
        const auto = now - this.lastInteraction > PAUSA_MS ? CONFIG.archivo.autoscroll : 0;
        // Vuelve suave a la velocidad automática (o frena la inercia).
        this.vel += (auto - this.vel) * (1 - Math.exp(-(auto ? 1.2 : 3.5) * dt));
        this.offset += this.vel * dt;
      }
      const y = ((this.offset % this.setH) + this.setH) % this.setH;
      this.track.style.transform = `translate3d(-50%, ${-y}px, 0)`;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.dragging = false;
    cancelAnimationFrame(this.raf);
  }

  hide() {
    this.stop();
    this.root.style.visibility = 'hidden';
  }
}
