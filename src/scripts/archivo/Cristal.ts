import { gsap } from 'gsap';
import { CONFIG } from '../esferas/config';

/**
 * Contraseña de los proyectos sobre un cristal esmerilado.
 * Se comprueba en el navegador (no es seguridad real). Una vez acertada no se vuelve
 * a pedir durante la visita (sessionStorage). Se quita con CONFIG.password.enabled = false.
 */
const CLAVE_ACCESO = 'capilla:acceso';
const normaliza = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/**
 * En la web publicada el acceso se recuerda durante la visita (sessionStorage: sobrevive a
 * recargas en la misma pestaña). En local (npm run dev) NO se recuerda: la pide cada vez
 * que se entra en un proyecto, para poder probar el cristal siempre.
 */
const RECORDAR_EN_PESTANA = !import.meta.env.DEV;
let accesoEnMemoria = false;

/** ¿Hay que pedir la contraseña? */
export function hayQuePedir() {
  if (!CONFIG.password.enabled || accesoEnMemoria) return false;
  if (!RECORDAR_EN_PESTANA) return true;
  try {
    return sessionStorage.getItem(CLAVE_ACCESO) !== '1';
  } catch {
    return true;
  }
}

function recordarAcceso() {
  if (!RECORDAR_EN_PESTANA) return;
  accesoEnMemoria = true;
  try {
    sessionStorage.setItem(CLAVE_ACCESO, '1');
  } catch {}
}

/** Olvida que ya se puso la contraseña en esta visita (botón del panel de desarrollo). */
export function olvidarAcceso() {
  accesoEnMemoria = false;
  try {
    sessionStorage.removeItem(CLAVE_ACCESO);
  } catch {}
}

export class Cristal {
  private readonly vidrio: HTMLElement;
  private readonly barra: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private resolver: ((ok: boolean) => void) | null = null;
  private ocupado = false;
  private tl: gsap.core.Timeline | null = null;

  constructor(private readonly root: HTMLElement) {
    this.vidrio = root.querySelector('[data-vidrio]')!;
    this.barra = root.querySelector('[data-barra]')!;
    this.input = root.querySelector('[data-input]')!;

    this.barra.addEventListener('submit', (e) => {
      e.preventDefault();
      this.comprobar();
    });

    // En móvil el teclado encoge el viewport visible: la barra se recentra en lo que queda.
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

  /** Aplica blur y tinte de CONFIG (también en vivo desde el panel). Con prefijo -webkit- para Safari. */
  // Nota: el cristal aparece/desaparece variando el blur, no la opacidad del contenedor
  // (un padre con opacidad < 1 deja al backdrop-filter sin nada que desenfocar).
  private nivel = { k: 1 };

  aplicarAjustes(k = this.nivel.k) {
    this.nivel.k = k;
    const f = `blur(${(CONFIG.password.blur * k).toFixed(2)}px) saturate(${1 + 0.15 * k})`;
    this.vidrio.style.setProperty('-webkit-backdrop-filter', f);
    this.vidrio.style.setProperty('backdrop-filter', f);
    this.vidrio.style.backgroundColor = `rgba(255,255,255,${CONFIG.password.tint * k})`;
  }

  private fundido(hasta: 0 | 1, duration: number, onComplete?: () => void) {
    gsap.killTweensOf(this.nivel);
    gsap.to(this.nivel, { k: hasta, duration, ease: 'power1.inOut', onUpdate: () => this.aplicarAjustes(), onComplete });
  }

  /**
   * Muestra el cristal y la barra. Se cumple con true cuando el cristal ya se ha retirado
   * (contraseña correcta) o con false si se cancela.
   * auto = demostración: desbloquea solo, sin escribir ni guardar nada.
   */
  pedir({ auto = false } = {}): Promise<boolean> {
    this.terminar(false);
    this.reset();
    this.aplicarAjustes(0);
    this.root.hidden = false;
    this.fundido(1, 0.7);
    gsap.fromTo(this.barra, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.9, delay: 0.2, ease: 'expo.out' });
    if (auto) setTimeout(() => this.resolver && this.acierto(false), 900);
    else if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => this.input.focus({ preventScroll: true }), 400);
    return new Promise((r) => (this.resolver = r));
  }

  /** Cierra sin entrar (BACK, botón atrás…). */
  cancelar() {
    if (!this.abierto) return;
    this.tl?.kill();
    this.input.blur();
    this.terminar(false);
    gsap.to(this.barra, { opacity: 0, duration: 0.3 });
    this.fundido(0, 0.4, () => this.ocultar());
  }

  private ocultar() {
    this.root.hidden = true;
    this.reset();
  }

  private terminar(ok: boolean) {
    const r = this.resolver;
    this.resolver = null;
    r?.(ok);
  }

  private reset() {
    this.tl?.kill();
    this.ocupado = false;
    gsap.killTweensOf([this.barra, this.input, this.vidrio, this.nivel]);
    gsap.set([this.barra, this.input, this.vidrio], { clearProps: 'all' });
    this.vidrio.style.removeProperty('mask-image');
    this.vidrio.style.removeProperty('-webkit-mask-image');
    this.input.value = '';
    this.input.disabled = false;
    this.aplicarAjustes(1);
  }

  private comprobar() {
    if (this.ocupado || !this.resolver) return;
    const valor = normaliza(this.input.value);
    if (!valor) return;
    if (valor === normaliza(CONFIG.password.value)) this.acierto(true);
    else this.fallo();
  }

  /** Temblor suave y el campo se vacía. */
  private fallo() {
    this.input.value = '';
    gsap.killTweensOf(this.barra, 'x');
    gsap.fromTo(this.barra, { x: 0 }, { keyframes: { x: [0, -9, 8, -5, 3, -1.5, 0] }, duration: 0.5, ease: 'none' });
  }

  /** Barra → círculo → brillo → el cristal se retira en degradado radial desde el centro. */
  private acierto(guardar: boolean) {
    this.ocupado = true;
    if (guardar) recordarAcceso();
    this.input.disabled = true;
    this.input.blur();

    const { morphDuration, glow, revealDuration } = CONFIG.password;
    if (this.reduced) {
      gsap.to(this.barra, { opacity: 0, duration: 0.3 });
      this.fundido(0, 0.5, () => (this.ocultar(), this.terminar(true)));
      return;
    }

    const h = this.barra.getBoundingClientRect().height;
    const W = this.vidrio.clientWidth;
    const H = this.vidrio.clientHeight;
    const maxR = Math.hypot(W, H) / 2;
    const feather = Math.max(W, H) * 0.35;
    const mask = { r: -feather };
    const pintaMascara = () => {
      // Transparente (sin cristal) en el centro → cristal hacia los bordes.
      const m = `radial-gradient(circle at 50% 50%, transparent ${mask.r}px, #000 ${mask.r + feather}px)`;
      this.vidrio.style.setProperty('-webkit-mask-image', m);
      this.vidrio.style.setProperty('mask-image', m);
    };

    this.tl = gsap.timeline({
      onComplete: () => {
        this.ocultar();
        this.terminar(true);
      },
    });
    this.tl
      // 1 · El texto desaparece y la barra se junta desde los lados hasta ser un círculo.
      .to(this.input, { opacity: 0, duration: 0.25, ease: 'power1.out' }, 0)
      .to(this.barra, { width: h, duration: morphDuration, ease: 'expo.inOut' }, 0.1)
      // 2 · El círculo se ilumina.
      .to(
        this.barra,
        {
          backgroundColor: `rgba(255,255,255,${Math.min(1, 0.55 + 0.35 * glow)})`,
          borderColor: 'rgba(255,255,255,1)',
          boxShadow: `0 0 ${30 * glow}px ${10 * glow}px rgba(255,255,255,${Math.min(1, 0.7 * glow)}), inset 0 0 ${12 * glow}px rgba(255,255,255,0.9)`,
          scale: 1 + 0.12 * glow,
          duration: 0.6,
          ease: 'power2.out',
        },
        0.1 + morphDuration,
      )
      // 3 · El cristal se retira desde el círculo hacia los bordes.
      .add(pintaMascara, 0.45 + morphDuration)
      .to(mask, { r: maxR + 10, duration: revealDuration, ease: 'power2.in', onUpdate: pintaMascara }, 0.45 + morphDuration)
      .to(this.barra, { scale: 3, opacity: 0, duration: revealDuration * 0.45, ease: 'power2.in' }, 0.5 + morphDuration)
      // Por si el navegador no aplica la máscara: el cristal también se desvanece al final.
      .to(this.vidrio, { opacity: 0, duration: revealDuration * 0.35, ease: 'power1.in' }, 0.45 + morphDuration + revealDuration * 0.65);
  }

  /** Demostración desde el panel de desarrollo. */
  probar() {
    return this.pedir({ auto: true });
  }
}
