import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG, ENTRY_MODES, GRAVITY_SHAPES } from './config';
import { ParticleSphere } from './ParticleSphere';
import type { Proyecto } from '../../data/proyectos';

export { CONFIG };

type Estado = 'idle' | 'entering' | 'inside' | 'exiting';

export interface EsferasOptions {
  root: HTMLElement; // contenedor a pantalla completa
  canvasHost: HTMLElement; // donde se inserta el <canvas>
  buttons: HTMLElement; // contiene los botones accesibles [data-slug]
  title: HTMLElement; // "capilladelacruz": ninguna esfera lo tapa
  veil: HTMLElement; // velo que oscurece la pantalla al entrar
  proyectos: Proyecto[];
  /** Se ha pulsado una esfera (ratón, tap o teclado). */
  onSelect: (proyecto: Proyecto) => void;
}

const tmpV = new THREE.Vector3();
const tmpHit = new THREE.Vector3();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Escena de esferas de partículas.
 * Se prepara pronto (constructor) y solo empieza a renderizar con start().
 */
export class EsferasScene {
  state: Estado = 'idle';

  readonly spheres: ParticleSphere[] = [];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly look = new THREE.Vector3();

  private readonly pointer = new THREE.Vector2();
  private pointerInside = false;
  private pointerType = 'mouse';
  private touchHover: ParticleSphere | null = null;
  private keyboardFocus: ParticleSphere | null = null;
  private hovered: ParticleSphere | null = null;

  private readonly parallaxTarget = new THREE.Vector2();
  private readonly parallax = new THREE.Vector2();

  private timeline: gsap.core.Timeline | null = null;
  private composition = CONFIG.scene.composition;
  private layoutKey = '';
  /** Rectángulo del título en px (relativo al contenedor), con margen. */
  private titleRect = { cx: 0, cy: 0, hw: 0, hh: 0 };

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private elapsed = 0;
  private last = 0;
  private raf = 0;
  private frame = 0;
  private started = false;
  private inView = true;

  readonly reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  readonly isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;

  constructor(private readonly opts: EsferasOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(CONFIG.look.background, 1);
    opts.canvasHost.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CONFIG.scene.fov, 1, 0.01, 200);
    this.camera.position.set(0, 0, CONFIG.scene.cameraZ);

    opts.proyectos.forEach((proyecto, i) => {
      // Si un proyecto no trae forma de gravedad, cada esfera toma una distinta.
      const fallback = GRAVITY_SHAPES[i % (GRAVITY_SHAPES.length - 1)];
      const sphere = new ParticleSphere(proyecto, this.particleCountFor(proyecto), fallback);
      this.spheres.push(sphere);
      this.scene.add(sphere.group);
    });

    this.bindEvents();
    this.resize();
    this.updateFrame(0);
    this.renderer.compile(this.scene, this.camera);
  }

  get reducedMotion() {
    return this.reducedMotionQuery.matches;
  }

  particleCountFor(p: Proyecto) {
    const factor = this.isMobile ? CONFIG.performance.mobileParticleFactor : 1;
    const count = CONFIG.scene.composition === 'fila' ? CONFIG.scene.row.particleCount : p.particleCount;
    return Math.round(count * factor);
  }

  private get isRow() {
    return CONFIG.scene.composition === 'fila';
  }

  /** Empieza a renderizar (cuando aparece la página final). */
  start() {
    this.started = true;
    this.measureTitle();
    this.syncLoop();
  }

  // ───────────────────────────── eventos ─────────────────────────────

  private bindEvents() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      if (e.pointerType === 'mouse') this.parallaxTarget.copy(this.pointer);
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.parallaxTarget.set(0, 0);
    });
    // En táctil no hay hover: la esfera reacciona mientras se pulsa.
    canvas.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      if (e.pointerType !== 'mouse') this.touchHover = this.pick()?.sphere ?? null;
    });
    const endTouch = () => (this.touchHover = null);
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
    canvas.addEventListener('click', (e) => {
      if (this.state !== 'idle') return;
      this.setPointer(e as PointerEvent);
      const hit = this.pick();
      if (hit) this.opts.onSelect(hit.sphere.proyecto);
    });

    // Botones invisibles para teclado / lectores de pantalla.
    for (const sphere of this.spheres) {
      const button = this.opts.buttons.querySelector<HTMLButtonElement>(`[data-slug="${sphere.proyecto.slug}"]`);
      button?.addEventListener('focus', () => (this.keyboardFocus = sphere));
      button?.addEventListener('blur', () => {
        if (this.keyboardFocus === sphere) this.keyboardFocus = null;
      });
      button?.addEventListener('click', () => {
        if (this.state === 'idle') this.opts.onSelect(sphere.proyecto);
      });
    }

    // Giroscopio (Android; en iOS requiere permiso explícito y se ignora).
    if (this.isMobile) {
      window.addEventListener('deviceorientation', (e) => {
        if (e.gamma == null || e.beta == null) return;
        this.parallaxTarget.set(
          THREE.MathUtils.clamp(e.gamma / 30, -1, 1),
          THREE.MathUtils.clamp((e.beta - 45) / 30, -1, 1),
        );
      });
    }

    new ResizeObserver(() => this.resize()).observe(this.opts.root);
    document.addEventListener('visibilitychange', () => this.syncLoop());
    new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.syncLoop();
    }).observe(this.opts.root);
  }

  private setPointer(e: PointerEvent | MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerInside = true;
    this.pointerType = 'pointerType' in e ? e.pointerType || 'mouse' : 'mouse';
  }

  /** Raycast contra la esfera invisible de cada proyecto; devuelve la más cercana. */
  private pick(): { sphere: ParticleSphere; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let best: { sphere: ParticleSphere; point: THREE.Vector3 } | null = null;
    let bestDist = Infinity;
    for (const sphere of this.spheres) {
      if (!this.raycaster.ray.intersectSphere(sphere.hit, tmpHit)) continue;
      const dist = tmpHit.distanceTo(this.raycaster.ray.origin);
      if (dist < bestDist) {
        bestDist = dist;
        best = { sphere, point: tmpHit.clone() };
      }
    }
    return best;
  }

  // ───────────────────────────── layout ─────────────────────────────

  private resize() {
    const rect = this.opts.root.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.performance.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.measureTitle();
    this.layout();
    if (this.started && !this.raf) this.render();
  }

  private measureTitle() {
    const root = this.opts.root.getBoundingClientRect();
    const t = this.opts.title.getBoundingClientRect();
    const pad = CONFIG.scene.titlePadding;
    this.titleRect = {
      cx: t.left - root.left + t.width / 2,
      cy: t.top - root.top + t.height / 2,
      hw: t.width / 2 + pad,
      hh: t.height / 2 + pad,
    };
  }

  /** Coloca las esferas según la composición elegida. */
  layout() {
    this.layoutKey = this.currentLayoutKey();
    if (this.isRow) this.layoutRow();
    else this.layoutFloating();
  }

  /** Cambia si cambia la composición o algún ajuste de la fila (panel en vivo). */
  private currentLayoutKey() {
    const { composition, row } = CONFIG.scene;
    return `${composition}|${row.size}|${row.gap}|${row.titleGap}|${row.sideMargin}|${this.width}x${this.height}`;
  }

  /**
   * Composición en fila: el nombre fijo en el centro exacto de la pantalla y la fila
   * de esferas debajo, a `row.titleGap` px. Las esferas se colocan según el nombre.
   * Las esferas están fijas, a la misma profundidad y con el mismo tamaño; en
   * pantallas estrechas se encogen (radio y separación) para que quepan en fila.
   */
  private layoutRow() {
    const { scene } = CONFIG;
    const { row } = scene;
    const n = this.spheres.length;
    const tan = Math.tan(THREE.MathUtils.degToRad(scene.fov / 2));
    const visH = 2 * scene.cameraZ * tan;
    const visW = visH * (this.width / this.height);
    const pxPerWorld = this.height / visH;

    // Ajuste al ancho: n diámetros + (n - 1) separaciones dentro del ancho útil.
    const needed = n * 2 * row.size + (n - 1) * row.gap;
    const available = visW * (1 - 2 * row.sideMargin);
    const fit = Math.min(1, available / needed);
    const radius = row.size * fit;
    const step = 2 * radius + row.gap * fit;

    // El nombre se queda en el centro (CSS: top 50%); la fila va debajo de él.
    const titleH = this.opts.title.offsetHeight || 16;
    const radiusPx = radius * pxPerWorld;
    const rowCenterY = this.height / 2 + titleH / 2 + row.titleGap + radiusPx;

    const y = (this.height / 2 - rowCenterY) / pxPerWorld;
    this.spheres.forEach((s, i) => {
      s.anchor.set((i - (n - 1) / 2) * step, y, 0);
      s.group.position.copy(s.anchor);
      s.baseRadius = radius;
      s.layoutScale = fit;
      s.fixed = true;
    });
  }

  /** Composición «flotando»: cada esfera en su hueco (CONFIG.scene.layout) y con deriva. */
  private layoutFloating() {
    const { scene } = CONFIG;
    const aspect = this.width / this.height;
    const portrait = aspect < 0.85;
    const slots = portrait ? scene.layout.portrait : scene.layout.landscape;
    // En pantallas estrechas las esferas se encogen para que quepan las tres y el texto.
    const fit = portrait ? Math.min(1, aspect / 0.62) : Math.min(1, aspect / 1.35);
    const tan = Math.tan(THREE.MathUtils.degToRad(scene.fov / 2));

    this.spheres.forEach((s, i) => {
      const slot = slots[i % slots.length];
      const z = slot.z - Math.floor(i / slots.length) * 1.5;
      const halfH = (scene.cameraZ - z) * tan;
      s.anchor.set(slot.x * halfH * aspect, slot.y * halfH, z);
      s.layoutScale = fit;
      s.baseRadius = s.proyecto.size * fit;
      s.fixed = false;
    });
    this.measureTitle();
  }

  /** Separa las esferas, las mantiene en el encuadre y fuera del título. */
  private constrain() {
    if (this.isRow) return; // en fila las esferas no se mueven
    const { scene } = CONFIG;
    const free = this.spheres.filter((s) => !s.frozen);

    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i];
        const b = free[j];
        tmpV.subVectors(b.group.position, a.group.position).setZ(0);
        const len = tmpV.length();
        const min = (a.hit.radius + b.hit.radius) * scene.minSeparation;
        if (len < min && len > 1e-4) {
          tmpV.multiplyScalar((min - len) / len / 2);
          a.group.position.sub(tmpV);
          b.group.position.add(tmpV);
        }
      }
    }

    const tan = Math.tan(THREE.MathUtils.degToRad(scene.fov / 2));
    const t = this.titleRect;
    for (const s of free) {
      const p = s.group.position;

      // Dentro del encuadre.
      const halfH = (scene.cameraZ - p.z) * tan;
      const halfW = halfH * this.camera.aspect;
      const r = s.hit.radius * 1.05;
      p.x = THREE.MathUtils.clamp(p.x, Math.min(0, -halfW + r), Math.max(0, halfW - r));
      p.y = THREE.MathUtils.clamp(p.y, Math.min(0, -halfH + r), Math.max(0, halfH - r));

      // Fuera del rectángulo del título (en píxeles de pantalla).
      tmpV.copy(p).project(this.camera);
      const sx = (tmpV.x * 0.5 + 0.5) * this.width;
      const sy = (-tmpV.y * 0.5 + 0.5) * this.height;
      const pxPerWorld = this.height / (2 * p.distanceTo(this.camera.position) * tan);
      const rpx = s.hit.radius * 1.1 * pxPerWorld;
      const qx = THREE.MathUtils.clamp(sx, t.cx - t.hw, t.cx + t.hw);
      const qy = THREE.MathUtils.clamp(sy, t.cy - t.hh, t.cy + t.hh);
      const dx = sx - qx;
      const dy = sy - qy;
      const d = Math.hypot(dx, dy);
      if (d < rpx) {
        let mx = 0;
        let my = 0;
        if (d < 1e-3) {
          // El centro cae dentro del título: sale por arriba o por abajo.
          my = (sy < t.cy ? t.cy - t.hh - rpx : t.cy + t.hh + rpx) - sy;
        } else {
          mx = (dx / d) * (rpx - d);
          my = (dy / d) * (rpx - d);
        }
        p.x += mx / pxPerWorld;
        p.y -= my / pxPerWorld;
      }

      s.group.updateMatrixWorld();
      s.hit.center.copy(p);
    }
  }

  // ───────────────────────────── bucle ─────────────────────────────

  private syncLoop() {
    const shouldRun = this.started && !document.hidden && this.inView && this.state !== 'inside';
    if (shouldRun && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.updateFrame(dt);
    this.render();
  };

  private updateFrame(dt: number) {
    this.elapsed += dt;
    this.frame++;
    const idle = this.state === 'idle';
    if (this.frame % 60 === 0) this.measureTitle(); // por si cambia la fuente o el tamaño

    // Cambios en vivo desde el panel (composición o ajustes de la fila).
    if (idle && this.layoutKey !== this.currentLayoutKey()) {
      if (this.composition !== CONFIG.scene.composition) {
        this.composition = CONFIG.scene.composition;
        this.rebuild(); // cambia el nº de partículas
      }
      this.layout();
    }

    // Hover: teclado > ratón > dedo.
    let hit: { sphere: ParticleSphere; point: THREE.Vector3 } | null = null;
    if (idle) {
      if (this.keyboardFocus) hit = { sphere: this.keyboardFocus, point: this.keyboardFocus.group.position };
      else if (this.pointerInside && this.pointerType === 'mouse') hit = this.pick();
      else if (this.touchHover) hit = this.pick() ?? { sphere: this.touchHover, point: this.touchHover.group.position };
    }
    this.setHovered(hit?.sphere ?? null);
    for (const s of this.spheres) {
      const isHovered = s === this.hovered;
      s.hoverTarget = isHovered ? 1 : 0;
      s.dimTarget = this.hovered && !isHovered ? 1 : 0;
      s.setMouse(isHovered && hit && hit.point !== s.group.position ? hit.point : null);
    }

    // Parallax de cámara (solo en reposo; durante la transición manda GSAP).
    if (idle) {
      // En fila no hay parallax de posición: las esferas se quedan quietas como botones.
      const p = this.reducedMotion || this.isRow ? 0 : CONFIG.scene.parallax;
      this.parallax.lerp(this.parallaxTarget, 1 - Math.exp(-2.5 * dt));
      this.camera.position.set(this.parallax.x * p, this.parallax.y * p * 0.6, CONFIG.scene.cameraZ);
      this.look.set(0, 0, 0);
    }
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();

    const ctx = {
      elapsed: this.elapsed,
      reducedMotion: this.reducedMotion,
      pixelRatio: this.pixelRatio,
      camera: this.camera,
    };
    for (const s of this.spheres) s.update(dt, ctx);
    this.constrain();

    this.renderer.setClearColor(CONFIG.look.background, 1);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private setHovered(sphere: ParticleSphere | null) {
    if (sphere === this.hovered) return;
    this.hovered = sphere;
    this.renderer.domElement.style.cursor = sphere ? 'pointer' : '';
  }

  // ───────────────────────────── transiciones ─────────────────────────────

  /** Escala (en radios de la esfera) que hace falta para cubrir toda la pantalla. */
  private fillScaleFor(s: ParticleSphere) {
    const tan = Math.tan(THREE.MathUtils.degToRad(CONFIG.scene.fov / 2));
    const dist = s.group.position.distanceTo(this.camera.position);
    const halfH = dist * tan;
    const halfW = halfH * this.camera.aspect;
    tmpV.copy(s.group.position).project(this.camera);
    const corner = Math.hypot(halfW + Math.abs(tmpV.x) * halfW, halfH + Math.abs(tmpV.y) * halfH);
    return (corner * 1.15) / Math.max(s.hit.radius, 1e-3);
  }

  /** Entra en la esfera del proyecto: sus partículas llenan la pantalla. Resuelve al terminar. */
  enter(slug: string): Promise<void> {
    const target = this.spheres.find((s) => s.proyecto.slug === slug);
    if (!target || this.state !== 'idle') return Promise.resolve();

    this.state = 'entering';
    this.keyboardFocus = null;
    this.touchHover = null;
    this.setHovered(null);
    for (const s of this.spheres) {
      s.frozen = true;
      s.hoverTarget = 0;
      s.dimTarget = 0;
      s.setMouse(null);
    }
    this.opts.root.classList.add('is-transitioning');
    this.syncLoop();

    const { entry } = CONFIG;
    const veil = this.opts.veil;
    veil.style.background = CONFIG.look.color;
    const tl = gsap.timeline({ paused: true });

    if (this.reducedMotion) {
      // Fundido simple: sin movimiento.
      for (const s of this.spheres) tl.to(s.fade, { value: 0, duration: entry.fadeDuration, ease: 'power2.inOut' }, 0);
    } else {
      const mode = Math.max(0, ENTRY_MODES.indexOf(entry.mode));
      const travels = entry.mode === 'zoom' || entry.mode === 'remolino';
      target.enterMode = mode;
      target.fill = this.fillScaleFor(target);

      const from = this.camera.position.clone();
      const lookFrom = this.look.clone();
      const center = target.group.position.clone();
      const dir = center.clone().sub(from).normalize();
      // zoom / remolino: la cámara viaja al centro. Resto: solo se acerca un poco.
      const camTo = travels ? center : from.clone().lerp(center, 0.12);
      const lookTo = travels ? center.clone().addScaledVector(dir, 20) : center;
      const others = this.spheres.filter((s) => s !== target);
      const p = { t: 0 };

      tl.to(p, {
        t: 1,
        duration: entry.duration,
        ease: entry.ease,
        onUpdate: () => {
          this.camera.position.lerpVectors(from, camTo, p.t);
          this.look.lerpVectors(lookFrom, lookTo, p.t);
          target.enter.value = p.t;
          for (const s of others) s.fade.value = 1 - THREE.MathUtils.smoothstep(p.t, 0, 0.5);
          veil.style.opacity = String(entry.darkness * THREE.MathUtils.smoothstep(p.t, 0.55, 1));
        },
      });
    }

    this.timeline = tl;
    return new Promise((resolve) => {
      tl.eventCallback('onComplete', () => {
        this.state = 'inside';
        this.syncLoop(); // dentro del proyecto no se renderiza
        resolve();
      });
      tl.play();
    });
  }

  /** Transición inversa: las partículas vuelven a su esfera. */
  exit(): Promise<void> {
    const tl = this.timeline;
    if (!tl || this.state === 'idle' || this.state === 'exiting') return Promise.resolve();

    this.state = 'exiting';
    this.syncLoop();
    return new Promise((resolve) => {
      tl.eventCallback('onReverseComplete', () => {
        this.state = 'idle';
        this.timeline = null;
        for (const s of this.spheres) {
          s.frozen = false;
          s.enter.value = 0;
          s.fade.value = 1;
        }
        this.opts.veil.style.opacity = '0';
        this.opts.root.classList.remove('is-transitioning');
        resolve();
      });
      tl.reverse();
    });
  }

  /** Panel de desarrollo: entra y vuelve a salir sin cambiar de página. */
  async preview(slug: string) {
    if (this.state !== 'idle') return;
    await this.enter(slug);
    await wait(600);
    await this.exit();
  }

  /** Regenera las partículas (panel de desarrollo). */
  rebuild() {
    for (const s of this.spheres) s.buildPoints(this.particleCountFor(s.proyecto));
  }
}
