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
const vRight = new THREE.Vector3();
const vUp = new THREE.Vector3();
const vFwd = new THREE.Vector3();
const vEnd = new THREE.Vector3();
const vCtrl = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vPerp = new THREE.Vector3();
const vScale = new THREE.Vector3();

/** Recorte "cover" de la textura en la ficha (repeat/offset). */
interface Crop {
  rx: number;
  ry: number;
  ox: number;
  oy: number;
}
const SIN_RECORTE: Crop = { rx: 1, ry: 1, ox: 0, oy: 0 };

/** Destino de una foto en la columna, en px del viewport (null o fuera de pantalla = no vuela). */
export interface Hueco {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FichaEnVuelo {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  hueco: Hueco | null;
  start: number;
  dur: number;
  empezada: boolean;
  p0: THREE.Vector3;
  q0: THREE.Quaternion;
  s0: THREE.Vector3;
}

interface Vuelo {
  t0: number;
  total: number;
  fichas: FichaEnVuelo[];
  ease: (t: number) => number;
  curve: number;
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

  // ───────────── Vuelo de la pila a la columna ─────────────

  /**
   * Cada foto vuela desde su sitio en la pila hasta su hueco en la columna (px del viewport),
   * girando hasta quedar plana y de frente. `orden` = posición de cada foto en la cascada.
   * Las que no tienen hueco visible no vuelan: encogen en su sitio a lo largo del vuelo.
   */
  volar(huecos: (Hueco | null)[], orden: number[]): Promise<void> {
    this.terminarVuelo();
    const { flightDuration: T, flightStagger, flightEase, flightCurve } = CONFIG.archivo;
    const visibles = orden.filter((i) => huecos[i]);
    const n = visibles.length;
    // La cascada cabe siempre en la duración total.
    const minDur = Math.min(0.4, T);
    const stagger = n > 1 ? Math.min(flightStagger, (T - minDur) / (n - 1)) : 0;
    const dur = Math.max(minDur, T - stagger * Math.max(0, n - 1));
    const N = orden.length;
    const fichas: FichaEnVuelo[] = [];
    let kVis = 0;
    orden.forEach((i, rank) => {
      const mesh = this.cards[i];
      if (!mesh) return;
      const hueco = huecos[i] ?? null;
      const start = hueco ? stagger * kVis++ : (rank / Math.max(1, N - 1)) * Math.max(0, T - 0.35);
      fichas.push({
        mesh,
        hueco,
        start,
        dur: hueco ? dur : Math.min(0.35, T),
        empezada: false,
        p0: new THREE.Vector3(),
        q0: new THREE.Quaternion(),
        s0: new THREE.Vector3(1, 1, 1),
      });
    });
    this.canvas.style.visibility = 'visible';
    this.start();
    return new Promise((resolve) => {
      this.vuelo = {
        t0: performance.now(),
        total: T,
        fichas,
        ease: gsap.parseEase(flightEase) ?? ((t: number) => t),
        curve: flightCurve,
        resolve,
      };
    });
  }

  private terminarVuelo() {
    const v = this.vuelo;
    this.vuelo = null;
    v?.resolve();
  }

  /** Px del viewport → punto del mundo en un plano frente a la cámara. */
  private pxAMundo(x: number, y: number, out: THREE.Vector3) {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((x - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((y - r.top) / r.height) * 2;
    const m = this.camera.matrixWorld;
    vRight.setFromMatrixColumn(m, 0);
    vUp.setFromMatrixColumn(m, 1);
    vFwd.setFromMatrixColumn(m, 2).negate();
    // 60 unidades delante de la cámara: por delante de toda la pila.
    return out
      .copy(this.camera.position)
      .addScaledVector(vFwd, 60)
      .addScaledVector(vRight, (nx * this.camera.right) / this.camera.zoom)
      .addScaledVector(vUp, (ny * this.camera.top) / this.camera.zoom);
  }

  private pasoVuelo() {
    const v = this.vuelo!;
    const t = (performance.now() - v.t0) / 1000;
    const r = this.canvas.getBoundingClientRect();
    const mundoPorPx = (2 * this.camera.top) / this.camera.zoom / r.height;

    for (const f of v.fichas) {
      if (t < f.start) continue;
      const card = f.mesh;
      const k = Math.min(1, (t - f.start) / f.dur);

      if (!f.hueco) {
        // Sin hueco visible: encoge en su sitio de la pila y desaparece.
        card.scale.setScalar(1 - k);
        if (k >= 1) card.visible = false;
        continue;
      }

      if (!f.empezada) {
        f.empezada = true;
        card.updateMatrixWorld();
        this.scene.attach(card); // conserva su pose en el mundo
        card.userData.vuela = true;
        f.p0.copy(card.position);
        f.q0.copy(card.quaternion);
        f.s0.copy(card.scale);
      }
      const e = v.ease(k);
      const h = f.hueco;
      this.pxAMundo(h.left + h.width / 2, h.top + h.height / 2, vEnd);

      // Recorrido: curva de Bézier con el punto de control desplazado en perpendicular.
      vDir.subVectors(vEnd, f.p0);
      const dist = vDir.length();
      vCtrl.addVectors(f.p0, vEnd).multiplyScalar(0.5);
      if (dist > 1e-6 && v.curve > 0) {
        vFwd.setFromMatrixColumn(this.camera.matrixWorld, 2);
        vPerp.crossVectors(vDir, vFwd).normalize();
        vUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
        if (vPerp.dot(vUp) < 0) vPerp.negate();
        vCtrl.addScaledVector(vPerp, v.curve * dist * 0.5);
      }
      const u = 1 - e;
      card.position
        .copy(f.p0)
        .multiplyScalar(u * u)
        .addScaledVector(vCtrl, 2 * u * e)
        .addScaledVector(vEnd, e * e);

      // Gira hasta quedar de frente y toma el tamaño exacto del hueco.
      card.quaternion.slerpQuaternions(f.q0, this.camera.quaternion, e);
      vScale.set((h.width * mundoPorPx) / CARD_W, (h.height * mundoPorPx) / CARD_H, 1);
      card.scale.lerpVectors(f.s0, vScale, e);

      // La textura pasa de recortada (ficha) a completa (como en la columna).
      const crop: Crop = card.userData.crop ?? SIN_RECORTE;
      const map = card.material.map;
      if (map) {
        map.repeat.set(crop.rx + (1 - crop.rx) * e, crop.ry + (1 - crop.ry) * e);
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
