import * as THREE from 'three';
import { CONFIG, GRAVITY_SHAPES, type GravityShape } from './config';
import { createSphereGeometry, mulberry32 } from './geometry';
import { vertexShader, fragmentShader } from './shaders';
import type { Proyecto } from '../../data/proyectos';

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const FAR_AWAY = new THREE.Vector3(999, 999, 999);
const tmpQuat = new THREE.Quaternion();

export interface FrameContext {
  elapsed: number;
  reducedMotion: boolean;
  pixelRatio: number;
  camera: THREE.Camera;
}

/** Una esfera de partículas = un proyecto. */
export class ParticleSphere {
  readonly proyecto: Proyecto;
  readonly group = new THREE.Group();
  /** Esfera invisible para el raycast (más fiable que intersecar los puntos). */
  readonly hit = new THREE.Sphere();

  points!: THREE.Points;
  material: THREE.ShaderMaterial;

  /** Posición de reposo calculada por el layout de la escena. */
  readonly anchor = new THREE.Vector3();
  /** Escala que aplica el layout para que todo quepa en pantalla (deriva). */
  layoutScale = 1;
  /** Radio en reposo (lo fija la composición de la escena). */
  baseRadius = 1;
  /** Fija = sin deriva: se queda en su sitio como un botón (composición en fila). */
  fixed = false;

  hover = 0;
  hoverTarget = 0;
  dim = 0;
  dimTarget = 0;
  /** Valores animados por GSAP en la transición de entrada. */
  readonly enter = { value: 0 };
  readonly fade = { value: 1 };
  enterMode = 0;
  /** Escala que necesita la esfera para cubrir toda la pantalla (se calcula al entrar). */
  fill = 10;
  /** Congelada = no deriva (durante la transición de entrada/salida). */
  frozen = false;

  private flowTime = 0;
  private spin = 0;
  private gravAngle = 0;
  private gravA = 0;
  private gravB = 0;
  private gravMix = 1;
  private readonly phase: THREE.Vector3;
  private readonly tilt: THREE.Quaternion;
  private readonly baseColor: THREE.Color;
  private readonly camLocal = new THREE.Vector3();

  constructor(proyecto: Proyecto, particleCount: number, defaultShape: GravityShape) {
    this.proyecto = proyecto;
    const rand = mulberry32(proyecto.seed * 31 + 5);

    this.phase = new THREE.Vector3(rand(), rand(), rand()).multiplyScalar(Math.PI * 2);
    // Cada esfera inclina su eje de forma distinta.
    this.tilt = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.7, rand() * Math.PI * 2, (rand() - 0.5) * 0.7),
    );
    this.baseColor = new THREE.Color(proyecto.color ?? CONFIG.look.color);
    this.flowTime = rand() * 50;

    // La forma de gravedad vive en CONFIG para que el panel la cambie y "copiar CONFIG" la incluya.
    CONFIG.gravity.shapes[proyecto.slug] ??= proyecto.gravity ?? defaultShape;
    this.gravA = this.gravB = this.shapeIndex();

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      // Sobre blanco, AdditiveBlending no se vería: NormalBlending con alfa bajo
      // hace que donde se acumulan puntos se oscurezca de verdad.
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uClock: { value: 0 },
        uSeed: { value: new THREE.Vector3(rand() * 100, rand() * 100, rand() * 100) },
        uNoiseScale: { value: 1 },
        uFlowAmp: { value: 0 },
        uSwirl: { value: 0 },
        uShellPull: { value: 1 },
        uDensity: { value: 0 },
        uBreath: { value: 0 },
        uSize: { value: 1 },
        uMaxSize: { value: 6 },
        uPixelRatio: { value: 1 },
        uSizeRef: { value: CONFIG.scene.cameraZ },
        uOpacity: { value: 1 },
        uDepthFade: { value: 0 },
        uHover: { value: 0 },
        uMouse: { value: FAR_AWAY.clone() },
        uRepelRadius: { value: 0.3 },
        uRepelStrength: { value: 0 },
        uGravA: { value: 0 },
        uGravB: { value: 0 },
        uGravMix: { value: 1 },
        uGravStrength: { value: 1 },
        uGravCore: { value: 0.35 },
        uGravTwist: { value: 0 },
        uGravTilt: { value: 0 },
        uGravAngle: { value: 0 },
        uFunnelAngle: { value: 0.6 },
        uEnter: { value: 0 },
        uEnterMode: { value: 0 },
        uFill: { value: 10 },
        uFinalDensity: { value: 0.5 },
        uCamLocal: { value: new THREE.Vector3(0, 0, 10) },
        // Color de las partículas (preparado para una variante clara sobre negro).
        uColor: { value: this.baseColor.clone() },
      },
    });

    this.buildPoints(particleCount);

    // Punto de extensión: render propio en lugar de partículas.
    if (proyecto.asset) {
      // TODO: cargar proyecto.asset (webm con alfa en un plano orientado a cámara,
      // o un .glb con GLTFLoader) y añadirlo a this.group en lugar de this.points.
      console.info(`[esferas] "${proyecto.slug}" tiene asset (${proyecto.asset.type}); de momento se usan partículas.`);
    }
  }

  private shapeIndex() {
    const i = GRAVITY_SHAPES.indexOf(CONFIG.gravity.shapes[this.proyecto.slug]);
    return i < 0 ? 0 : i;
  }

  /** (Re)genera los puntos; se usa también desde el panel de desarrollo. */
  buildPoints(particleCount: number) {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
    }
    this.points = new THREE.Points(createSphereGeometry(particleCount, this.proyecto.seed), this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Posición del cursor sobre la esfera (en mundo), o null si no hay hover. */
  setMouse(worldPoint: THREE.Vector3 | null) {
    const u = this.material.uniforms.uMouse.value as THREE.Vector3;
    if (worldPoint) this.group.worldToLocal(u.copy(worldPoint));
    else u.copy(FAR_AWAY);
  }

  update(dt: number, ctx: FrameContext) {
    const { flow, hover: H, look, scene, gravity: G, entry, distribution, performance: perf } = CONFIG;
    const motion = ctx.reducedMotion ? perf.reducedMotionFactor : 1;

    const k = 1 - Math.exp(-H.damping * dt);
    this.hover += (this.hoverTarget - this.hover) * k;
    this.dim += (this.dimTarget - this.dim) * k;

    this.flowTime += dt * flow.speed * motion * (1 + this.hover * H.flowBoost) * (1 - this.dim * 0.5);
    this.spin += dt * flow.rotationSpeed * motion * (1 + this.hover * 0.8);
    this.gravAngle += dt * G.spinSpeed * motion;

    // Cambio de forma de gravedad: fundido entre la anterior y la nueva.
    const want = this.shapeIndex();
    if (want !== this.gravB) {
      this.gravA = this.gravMix < 0.5 ? this.gravA : this.gravB;
      this.gravB = want;
      this.gravMix = 0;
    }
    this.gravMix = Math.min(1, this.gravMix + dt * 0.8);

    // Deriva lenta (suma de senos desfasados: orgánica y acotada).
    if (!this.frozen) {
      const a = ctx.reducedMotion || this.fixed ? 0 : scene.drift * this.layoutScale;
      const t = ctx.elapsed * scene.driftSpeed * Math.PI * 2;
      const ph = this.phase;
      this.group.position.set(
        this.anchor.x + a * (Math.sin(t + ph.x) * 0.7 + Math.sin(t * 0.53 + ph.y) * 0.3),
        this.anchor.y + a * (Math.sin(t * 0.81 + ph.y) * 0.6 + Math.sin(t * 0.37 + ph.z) * 0.4),
        this.anchor.z + a * 0.8 * Math.sin(t * 0.61 + ph.z),
      );
    }

    const scale = this.baseRadius * (1 + (H.scale - 1) * this.hover);
    this.group.scale.setScalar(scale);
    this.group.quaternion.copy(this.tilt).multiply(tmpQuat.setFromAxisAngle(AXIS_Y, this.spin));
    this.group.updateMatrixWorld();

    this.hit.center.copy(this.group.position);
    this.hit.radius = scale * 1.02;

    const u = this.material.uniforms;
    u.uTime.value = this.flowTime;
    u.uClock.value = ctx.elapsed;
    u.uNoiseScale.value = flow.noiseScale;
    u.uFlowAmp.value = flow.amplitude * (1 + this.hover * H.ampBoost);
    u.uSwirl.value = flow.swirl;
    u.uShellPull.value = flow.shellPull;
    u.uDensity.value = flow.density;
    u.uBreath.value = ctx.reducedMotion ? 0 : flow.breath;
    u.uSize.value = look.pointSize;
    u.uMaxSize.value = look.maxPointSize;
    u.uPixelRatio.value = ctx.pixelRatio;
    u.uSizeRef.value = scene.cameraZ;
    u.uOpacity.value = look.opacity * this.fade.value * (1 - this.dim * H.dimOthers);
    u.uDepthFade.value = look.depthFade;
    u.uHover.value = this.hover;
    u.uRepelRadius.value = H.repelRadius;
    u.uRepelStrength.value = H.repelStrength;

    u.uGravA.value = this.gravA;
    u.uGravB.value = this.gravB;
    u.uGravMix.value = this.gravMix;
    u.uGravStrength.value = G.strength;
    u.uGravCore.value = G.coreRadius;
    u.uGravTwist.value = G.twist;
    u.uGravTilt.value = THREE.MathUtils.degToRad(G.tilt);
    u.uGravAngle.value = this.gravAngle;
    u.uFunnelAngle.value = distribution.funnelAngle;

    u.uEnter.value = this.enter.value;
    u.uEnterMode.value = this.enterMode;
    u.uFill.value = this.fill;
    u.uFinalDensity.value = entry.finalDensity;
    (u.uCamLocal.value as THREE.Vector3).copy(this.group.worldToLocal(this.camLocal.copy(ctx.camera.position)));
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
