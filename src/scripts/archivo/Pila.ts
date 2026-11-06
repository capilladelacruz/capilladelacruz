import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../esferas/config';
import type { Foto } from './fotos';

/** Tamaño de cada ficha (todas iguales; la foto se recorta para cubrirla). */
const CARD_W = 1;
const CARD_H = 1.25;
/** Vista isométrica: la pila (eje Z) queda en diagonal subiendo hacia la derecha. */
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();

const easeZoom = gsap.parseEase('power2.inOut');
const tmp = new THREE.Vector3();
const vEnd = new THREE.Vector3();
const vPos = new THREE.Vector3();
const vScale = new THREE.Vector3();

/** Recorte "cover" de la textura en la ficha (repeat/offset). */
interface Crop {
  rx: number;
  ry: number;
  ox: number;
  oy: number;
}
const SIN_RECORTE: Crop = { rx: 1, ry: 1, ox: 0, oy: 0 };

/** Destino de una foto en la columna, en px del viewport (null = no vuela: encoge en la pila). */
export interface Hueco {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Efectos de reorganización de la pila en la columna. */
export type ModoVuelo = 'enderezar' | 'vuelo' | 'recoger' | 'girar';

interface FichaEnVuelo {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  hueco: Hueco | null;
  /** Posición en la cascada (0 = la primera en salir). */
  rank: number;
  start: number;
  dur: number;
  /** Pose inicial: posición en espacio de cámara, rotación y escala en el mundo. */
  c0: THREE.Vector3;
  q0: THREE.Quaternion;
  s0: THREE.Vector3;
}

interface Vuelo {
  t0: number;
  total: number;
  fichas: FichaEnVuelo[];
  modo: ModoVuelo;
  ease: (t: number) => number;
  curve: number;
  split: number;
  /** Centro de la pila en espacio de cámara (x, y). */
  cx: number;
  cy: number;
  resolve: () => void;
}

/**
 * Pila 3D de fotos "de canto", como fichas de archivo, en vista isométrica.
 * progress 0 = cámara muy cerca · 1 = la pila es una barra larga y fina en diagonal.
 */
export class Pila {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
  private cards: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private textures: THREE.Texture[] = [];

  /** 0…1: progreso de la entrada (lo anima play()). */
  progress = 0;
  private time = 0;
  /** Velocidad del tiempo de la ola (despacio detrás del cristal). */
  private timeScale = 0.25;
  private raf = 0;
  private last = 0;
  private running = false;
  private intro: gsap.core.Tween | null = null;
  private aspect = 1;
  private vuelo: Vuelo | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0xffffff, 1);
    this.canvas = this.renderer.domElement;
    host.appendChild(this.canvas);
    this.scene.add(this.group);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.performance.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.left = -this.aspect;
    this.camera.right = this.aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    if (!this.running) this.render();
  };

  /** Crea una ficha por foto. Devuelve una promesa que se cumple al cargar las texturas (o a los `timeout` ms). */
  setFotos(fotos: Foto[], timeout = 2500): Promise<void> {
    this.clear();
    const loader = new THREE.TextureLoader();
    const cardAspect = CARD_W / CARD_H;
    const cargas: Promise<void>[] = [];

    fotos.forEach((foto, i) => {
      const material = new THREE.MeshBasicMaterial({ color: 0xe9e9e9, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.userData.i = i;
      this.group.add(mesh);
      this.cards.push(mesh);

      cargas.push(
        new Promise<void>((resolve) => {
          loader.load(
            foto.src,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = 4;
              // Recorte tipo "cover" dentro de la ficha.
              const a = foto.w / foto.h;
              const crop: Crop =
                a > cardAspect
                  ? { rx: cardAspect / a, ry: 1, ox: (1 - cardAspect / a) / 2, oy: 0 }
                  : { rx: 1, ry: a / cardAspect, ox: 0, oy: (1 - a / cardAspect) / 2 };
              mesh.userData.crop = crop;
              tex.repeat.set(crop.rx, crop.ry);
              tex.offset.set(crop.ox, crop.oy);
              material.map = tex;
              material.color.set(0xffffff);
              material.needsUpdate = true;
              this.textures.push(tex);
              resolve();
            },
            undefined,
            () => resolve(),
          );
        }),
      );
    });

    this.render();
    return Promise.race([Promise.all(cargas).then(() => {}), new Promise<void>((r) => setTimeout(r, timeout))]);
  }

  /** Detrás del cristal: primer momento de la entrada, moviéndose muy despacio. */
  idle() {
    this.intro?.kill();
    this.resetFichas();
    this.progress = 0;
    this.timeScale = 0.25;
    this.canvas.style.visibility = 'visible';
    this.start();
  }

  /** Entrada: la ola recorre la pila y la cámara se aleja. */
  play(): Promise<void> {
    this.intro?.kill();
    this.resetFichas();
    this.progress = 0;
    this.timeScale = 1;
    this.canvas.style.visibility = 'visible';
    this.start();
    return new Promise((resolve) => {
      this.intro = gsap.to(this, {
        progress: 1,
        duration: CONFIG.archivo.introDuration,
        ease: 'none',
        onComplete: () => resolve(),
      });
    });
  }

  /** Pausa el render (cuando ya está la columna). */
  stop() {
    this.intro?.kill();
    this.terminarVuelo();
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  hide() {
    this.stop();
    this.canvas.style.visibility = 'hidden';
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!document.hidden) {
        this.time += dt * this.timeScale;
        this.render();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private layout() {
    const { stackGap: gap, wave, angle } = CONFIG.archivo;
    const n = this.cards.length;
    const t = this.time;
    const p = this.progress;
    // Cresta de la ola que recorre la pila durante la entrada.
    const crest = -0.25 + 1.5 * p;
    const ampCrest = CARD_H * 0.42 * wave * Math.sin(Math.PI * Math.min(1, p * 1.15));

    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5;
      // Ondulación ligera permanente + la ola que la recorre.
      const ond = CARD_H * 0.07 * wave * (Math.sin(Math.PI * 2 * (1.6 * u - 0.12 * t)) * 0.7 + Math.sin(Math.PI * 2 * (3.3 * u + 0.07 * t)) * 0.3);
      const d = (u - crest) / 0.11;
      const ola = ampCrest * Math.exp(-d * d);
      // Pendiente de la ola → las fichas se inclinan un poco con ella.
      const pend = -2 * d * ola / 0.11;
      const card = this.cards[i];
      if (card.userData.vuela) continue;
      card.position.set(0, ond + ola, (i - (n - 1) / 2) * gap);
      card.rotation.set(THREE.MathUtils.clamp(pend * gap * 0.35, -0.5, 0.5), 0, 0);
    }
    this.group.rotation.y = THREE.MathUtils.degToRad(angle);
  }

  /** Zoom para que toda la pila quepa como una barra en diagonal. */
  private zoomLejos() {
    const n = this.cards.length;
    const half = ((n - 1) / 2) * CONFIG.archivo.stackGap;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const m = this.camera.matrixWorldInverse;
    for (const z of [-half, half]) for (const x of [-CARD_W / 2, CARD_W / 2]) for (const y of [-CARD_H, CARD_H]) {
      tmp.set(x, y * 0.5, z).applyMatrix4(this.group.matrixWorld).applyMatrix4(m);
      minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
      minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
    }
    const fill = this.aspect < 1 ? 0.92 : 0.82;
    return Math.min((2 * this.aspect * fill) / (maxX - minX), (2 * fill) / (maxY - minY));
  }

  private render() {
    this.layout();
    this.camera.position.copy(ISO_DIR).multiplyScalar(100);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.group.updateMatrixWorld();

    // De muy cerca (se ven las fichas de canto) a lejos.
    const cerca = 2 / (CARD_H * 0.55);
    const lejos = this.zoomLejos();
    const k = easeZoom(Math.min(1, this.progress * 1.08));
    this.camera.zoom = Math.exp(THREE.MathUtils.lerp(Math.log(cerca), Math.log(lejos), k));
    this.camera.updateProjectionMatrix();
    if (this.vuelo) this.pasoVuelo();
    this.renderer.render(this.scene, this.camera);
  }

  // ───────────── Reorganización de la pila en la columna ─────────────

  /**
   * Lleva cada foto desde su sitio en la pila hasta su hueco en la columna (px del viewport),
   * girando hasta quedar plana y de frente, con el efecto `modo`:
   *  - enderezar: la diagonal gira como un solo bloque hasta ponerse vertical y se abre.
   *  - vuelo:     cada foto vuela por su cuenta a su hueco (con arco opcional).
   *  - recoger:   todas se juntan en un montón en el centro y luego se despliegan arriba y abajo.
   *  - girar:     primero se ponen de frente en su sitio y después se deslizan a la columna.
   * `orden` = orden de salida de la cascada.
   */
  volar(huecos: (Hueco | null)[], orden: number[], modo: ModoVuelo): Promise<void> {
    this.terminarVuelo();
    const { flightDuration: T, flightStagger, flightEase, flightCurve, flightSplit } = CONFIG.archivo;
    const n = orden.length;
    const minDur = Math.min(0.4, T);
    // La cascada cabe siempre en la duración total.
    const stagger = n > 1 ? Math.min(flightStagger, (T - minDur) / (n - 1)) : 0;
    const dur = Math.max(minDur, T - stagger * Math.max(0, n - 1));

    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse;
    const fichas: FichaEnVuelo[] = [];
    let cx = 0;
    let cy = 0;
    orden.forEach((i, rank) => {
      const mesh = this.cards[i];
      if (!mesh) return;
      // Se fija la pose actual de todas las fotos y se sacan de la pila.
      mesh.updateMatrixWorld();
      this.scene.attach(mesh);
      mesh.userData.vuela = true;
      const c0 = mesh.position.clone().applyMatrix4(inv);
      cx += c0.x;
      cy += c0.y;
      fichas.push({
        mesh,
        hueco: huecos[i] ?? null,
        rank,
        start: stagger * rank,
        dur,
        c0,
        q0: mesh.quaternion.clone(),
        s0: mesh.scale.clone(),
      });
    });
    this.canvas.style.visibility = 'visible';
    this.start();
    return new Promise((resolve) => {
      this.vuelo = {
        t0: performance.now(),
        total: T,
        fichas,
        modo,
        ease: gsap.parseEase(flightEase) ?? ((t: number) => t),
        curve: flightCurve,
        split: THREE.MathUtils.clamp(flightSplit, 0.1, 0.9),
        cx: fichas.length ? cx / fichas.length : 0,
        cy: fichas.length ? cy / fichas.length : 0,
        resolve,
      };
    });
  }

  private terminarVuelo() {
    const v = this.vuelo;
    this.vuelo = null;
    v?.resolve();
  }

  private pasoVuelo() {
    const v = this.vuelo!;
    const t = (performance.now() - v.t0) / 1000;
    const r = this.canvas.getBoundingClientRect();
    const zoom = this.camera.zoom;
    const halfW = this.camera.right / zoom; // medio ancho visible (unidades de cámara)
    const halfH = this.camera.top / zoom;
    const mundoPorPx = (2 * halfH) / r.height;
    const Z_FINAL = -60; // plano de la columna: por delante de toda la pila
    const N = v.fichas.length;

    for (const f of v.fichas) {
      const card = f.mesh;
      const k = THREE.MathUtils.clamp((t - f.start) / f.dur, 0, 1);

      if (!f.hueco) {
        // Sin hueco: encoge en su sitio y desaparece.
        card.scale.copy(f.s0).multiplyScalar(1 - v.ease(k));
        card.visible = k < 1;
        continue;
      }

      // Destino en espacio de cámara (la cámara mira hacia -Z).
      const h = f.hueco;
      const ex = (((h.left + h.width / 2 - r.left) / r.width) * 2 - 1) * halfW;
      const ey = (1 - ((h.top + h.height / 2 - r.top) / r.height) * 2) * halfH;
      vEnd.set(ex, ey, Z_FINAL);
      const c0 = f.c0;
      let giro: number; // 0 = pose de la pila · 1 = plana, de frente y a tamaño final

      switch (v.modo) {
        case 'enderezar': {
          // Coordenadas polares respecto al centro de la pila → respecto al centro de la pantalla:
          // el ángulo de la diagonal gira hasta la vertical y las distancias pasan a las de la columna.
          const e = v.ease(k);
          const ax = c0.x - v.cx;
          const ay = c0.y - v.cy;
          const angA = Math.atan2(ay, ax);
          let dAng = Math.atan2(ey, ex) - angA;
          dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng)); // giro más corto
          const ang = angA + dAng * e;
          const rad = THREE.MathUtils.lerp(Math.hypot(ax, ay), Math.hypot(ex, ey), e);
          vPos.set(
            THREE.MathUtils.lerp(v.cx, 0, e) + Math.cos(ang) * rad,
            THREE.MathUtils.lerp(v.cy, 0, e) + Math.sin(ang) * rad,
            THREE.MathUtils.lerp(c0.z, Z_FINAL, e),
          );
          giro = e;
          break;
        }
        case 'recoger': {
          // 1) se juntan en un montón en el centro · 2) se despliegan a sus huecos.
          const k1 = v.ease(Math.min(1, k / v.split));
          const k2 = v.ease(Math.max(0, (k - v.split) / (1 - v.split)));
          const pz = Z_FINAL + (N - f.rank) * 0.01; // la primera en salir queda encima
          vPos.set(THREE.MathUtils.lerp(c0.x, 0, k1), THREE.MathUtils.lerp(c0.y, 0, k1), THREE.MathUtils.lerp(c0.z, pz, k1));
          vPos.lerp(vEnd, k2);
          giro = k1;
          break;
        }
        case 'girar': {
          // 1) se ponen de frente en su sitio · 2) se deslizan hasta la columna.
          const k1 = v.ease(Math.min(1, k / v.split));
          const k2 = v.ease(Math.max(0, (k - v.split) / (1 - v.split)));
          vPos.set(c0.x, c0.y, THREE.MathUtils.lerp(c0.z, Z_FINAL + (N - f.rank) * 0.01, k1));
          vPos.lerp(vEnd, k2);
          giro = k1;
          break;
        }
        default: {
          // 'vuelo': curva de Bézier con el punto de control desplazado en perpendicular.
          const e = v.ease(k);
          const dx = ex - c0.x;
          const dy = ey - c0.y;
          const dist = Math.hypot(dx, dy);
          let px = 0;
          let py = 0;
          if (dist > 1e-6 && v.curve > 0) {
            px = -dy / dist;
            py = dx / dist;
            if (py < 0) (px = -px), (py = -py); // el arco siempre hacia arriba
          }
          const mx = (c0.x + ex) / 2 + px * v.curve * dist * 0.5;
          const my = (c0.y + ey) / 2 + py * v.curve * dist * 0.5;
          const u = 1 - e;
          vPos.set(
            u * u * c0.x + 2 * u * e * mx + e * e * ex,
            u * u * c0.y + 2 * u * e * my + e * e * ey,
            THREE.MathUtils.lerp(c0.z, Z_FINAL, e),
          );
          giro = e;
        }
      }

      card.position.copy(vPos).applyMatrix4(this.camera.matrixWorld);
      card.quaternion.slerpQuaternions(f.q0, this.camera.quaternion, giro);
      vScale.set((h.width * mundoPorPx) / CARD_W, (h.height * mundoPorPx) / CARD_H, 1);
      card.scale.lerpVectors(f.s0, vScale, giro);

      // La textura pasa de recortada (ficha) a completa (como en la columna).
      const crop: Crop = card.userData.crop ?? SIN_RECORTE;
      const map = card.material.map;
      if (map) {
        const u = 1 - giro;
        map.repeat.set(crop.rx + (1 - crop.rx) * giro, crop.ry + (1 - crop.ry) * giro);
        map.offset.set(crop.ox * u, crop.oy * u);
      }
    }
    if (t >= v.total) {
      this.vuelo = null;
      v.resolve();
    }
  }

  /** Devuelve todas las fichas a la pila (tras un vuelo). */
  private resetFichas() {
    this.terminarVuelo();
    for (const card of this.cards) {
      if (card.parent !== this.group) this.group.add(card);
      card.userData.vuela = false;
      card.visible = true;
      card.scale.set(1, 1, 1);
      const crop: Crop | undefined = card.userData.crop;
      if (crop && card.material.map) {
        card.material.map.repeat.set(crop.rx, crop.ry);
        card.material.map.offset.set(crop.ox, crop.oy);
      }
    }
  }

  private clear() {
    this.terminarVuelo();
    for (const c of this.cards) {
      c.removeFromParent();
      c.material.dispose();
    }
    for (const t of this.textures) t.dispose();
    this.cards = [];
    this.textures = [];
  }

  dispose() {
    this.stop();
    this.clear();
    window.removeEventListener('resize', this.resize);
    this.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
