import { gsap } from 'gsap';
import { CONFIG } from './esferas/config';

/**
 * Contraseña de los proyectos. Se comprueba en el navegador (no es seguridad real).
 * Una vez acertada, no se vuelve a pedir durante la visita (sessionStorage).
 */
export const CLAVE_ACCESO = 'capilla:acceso';

const normaliza = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function guardado() {
  try {
    return sessionStorage.getItem(CLAVE_ACCESO) === '1';
  } catch {
    return false;
  }
}

/** ¿Hay que pedir la contraseña? */
export function hayQuePedir() {
  return CONFIG.password.enabled && !guardado();
}

interface Opciones {
  /** Al pulsar "BACK" (si es un enlace, el navegador ya navega solo). */
  onBack?: () => void;
}

export class Candado {
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly campos: HTMLElement;
  private readonly unido: SVGElement;
  private readonly izq: SVGGElement;
  private readonly der: SVGGElement;
  private readonly lineas: SVGLineElement[];
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private resolver: ((ok: boolean) => void) | null = null;
  private ocupado = false;

  constructor(root: HTMLElement, { onBack }: Opciones = {}) {
    this.root = root;
    this.form = root.querySelector('[data-candado-panel]')!;
    this.input = root.querySelector('[data-candado-input]')!;
    this.campos = root.querySelector('[data-candado-campos]')!;
    this.unido = root.querySelector('[data-candado-unido]')!;
    this.izq = root.querySelector('[data-pieza="izq"]')!;
    this.der = root.querySelector('[data-pieza="der"]')!;
    this.lineas = [...root.querySelectorAll<SVGLineElement>('.candado__linea')];

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.comprobar();
    });
    root.querySelector('[data-candado-back]')?.addEventListener('click', (e) => {
      if (!onBack) return; // enlace normal
      e.preventDefault();
      onBack();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (root.querySelector('[data-candado-back]') as HTMLElement | null)?.click();
    });

    // En móvil el teclado encoge el viewport visible: el panel se recentra en lo que queda.
    const vv = window.visualViewport;
    if (vv) {
      const ajusta = () => {
        root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        root.style.setProperty('--vv-h', `${vv.height}px`);
      };
      vv.addEventListener('resize', ajusta);
      vv.addEventListener('scroll', ajusta);
      ajusta();
    }
  }

  get abierto() {
    return !this.root.hidden;
  }

  /** Muestra el panel. Devuelve true al acertar (al final de la animación del puzzle) o false si se cancela. */
  pedir(): Promise<boolean> {
    this.resolver?.(false);
    this.ocupado = false;
    this.reset();
    this.root.hidden = false;
    // Las piezas llegan desde un poco más lejos y se quedan ligeramente separadas.
    gsap.fromTo(this.izq, { x: -16 }, { x: -5, duration: 1.1, ease: 'expo.out' });
    gsap.fromTo(this.der, { x: 16 }, { x: 5, duration: 1.1, ease: 'expo.out' });
    requestAnimationFrame(() => this.root.classList.add('visible'));
    setTimeout(() => this.input.focus({ preventScroll: true }), 350);
    return new Promise((r) => (this.resolver = r));
  }

  /** Cierra el panel sin entrar (BACK, botón atrás del navegador…). */
  cancelar() {
    if (!this.abierto) return;
    this.input.blur();
    this.root.classList.remove('visible');
    setTimeout(() => {
      if (!this.root.classList.contains('visible')) this.root.hidden = true;
    }, 500);
    this.terminar(false);
  }

  private terminar(ok: boolean) {
    const r = this.resolver;
    this.resolver = null;
    r?.(ok);
  }

  private reset() {
    gsap.killTweensOf([this.form, this.izq, this.der, this.unido, this.campos, ...this.lineas]);
    gsap.set(this.form, { clearProps: 'all' });
    gsap.set([this.campos, ...this.lineas], { clearProps: 'opacity' });
    gsap.set(this.unido, { opacity: 0 });
    gsap.set(this.izq, { x: -5 });
    gsap.set(this.der, { x: 5 });
    this.input.value = '';
    this.input.disabled = false;
  }

  private comprobar() {
    if (this.ocupado || !this.resolver) return;
    const valor = normaliza(this.input.value);
    if (!valor) return;
    if (valor === normaliza(CONFIG.password.value)) this.acierto();
    else this.fallo();
  }

  /** Temblor sutil y el campo se vacía. */
  private fallo() {
    this.input.value = '';
    gsap.killTweensOf(this.form, 'x');
    gsap.fromTo(
      this.form,
      { x: 0 },
      {
        keyframes: { x: [0, -7, 6, -4, 3, -1.5, 0] },
        duration: this.reduced ? 0.2 : 0.45,
        ease: 'none',
      },
    );
  }

  /** Las piezas encajan, el conjunto se abre y deja paso al proyecto. */
  private acierto() {
    this.ocupado = true;
    try {
      sessionStorage.setItem(CLAVE_ACCESO, '1');
    } catch {}
    this.input.disabled = true;
    this.input.blur();

    if (this.reduced) {
      this.root.classList.remove('visible');
      this.terminar(true);
      setTimeout(() => (this.root.hidden = true), 500);
      return;
    }

    const vw = window.innerWidth;
    const ancho = this.form.getBoundingClientRect().width || 340;
    const tl = gsap.timeline({
      onComplete: () => {
        this.root.hidden = true;
        this.root.classList.remove('visible');
        this.ocupado = false;
      },
    });
    tl.to(this.campos, { opacity: 0, duration: 0.35, ease: 'power2.out' }, 0)
      // 1 · Se acercan y encajan.
      .to(this.izq, { x: 0, duration: 0.75, ease: 'power3.inOut' }, 0.1)
      .to(this.der, { x: 0, duration: 0.75, ease: 'power3.inOut' }, 0.1)
      // "clic" del encaje
      .set(this.unido, { opacity: 1 }, 0.85)
      .to(this.form, { scale: 0.985, duration: 0.09, ease: 'power2.out' }, 0.85)
      .to(this.form, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' }, 0.94)
      .to(this.lineas, { opacity: 0, duration: 0.45, ease: 'power2.inOut' }, 1.05)
      // 2 · El conjunto se cierra en un hilo…
      .to(this.form, { scaleY: 0.025, duration: 0.55, ease: 'power3.in' }, 1.45)
      // 3 · …que se abre a lo ancho de la pantalla y se desvanece, dejando paso al proyecto.
      .add(() => this.terminar(true), 1.95)
      .to(this.form, { scaleX: (vw / ancho) * 1.1, duration: 0.9, ease: 'expo.inOut' }, 2.0)
      .to(this.form, { opacity: 0, duration: 0.5, ease: 'power2.in' }, 2.4)
      .to(this.root, { backgroundColor: 'rgba(255,255,255,0)', duration: 0.5, ease: 'power1.inOut' }, 2.4)
      .set(this.root, { clearProps: 'backgroundColor' });
  }
}
