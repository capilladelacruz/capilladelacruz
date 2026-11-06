import * as THREE from 'three';
import { CONFIG } from './config';

/** Generador pseudoaleatorio con semilla (mulberry32): misma semilla → misma esfera. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Crea la nube de puntos base de una esfera (radio 1, eje de los conos = Y).
 * Capas:
 *   0 · cáscara   → borde denso y definido
 *   1 · interior  → relleno vaporoso
 *   2 · núcleo    → la gravedad central (aquí se hornea el reloj de arena con vetas;
 *                   el resto de formas se calculan en el shader)
 *   3 · halo      → partículas sueltas que se disuelven hacia fuera
 */
export function createSphereGeometry(count: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 7919 + 13);
  const gauss = () => {
    const u = Math.max(rand(), 1e-7);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const unit = (out: THREE.Vector3) => {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), z, r * Math.sin(a));
  };

  const d = CONFIG.distribution;
  const total = d.shell + d.interior + d.funnel + d.halo;
  const tShell = d.shell / total;
  const tInterior = tShell + d.interior / total;
  const tFunnel = tInterior + d.funnel / total;

  // Vetas de los conos: cada una con su dirección y su anchura.
  const rays = Array.from({ length: d.funnelRays }, () => ({
    azimuth: rand() * Math.PI * 2,
    polar: d.funnelAngle * Math.sqrt(rand()),
    width: 0.02 + rand() * 0.06,
    sign: rand() < 0.5 ? 1 : -1,
  }));

  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 4);
  // Aleatorios para colocar cada partícula sobre la forma de gravedad (en el shader).
  const gravity = new Float32Array(count * 3);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const pick = rand();
    let layer: number;
    let alpha: number;

    if (pick < tShell) {
      layer = 0;
      unit(v).multiplyScalar(1 - Math.abs(gauss()) * d.shellThickness);
      alpha = 0.55 + rand() * 0.45;
    } else if (pick < tInterior) {
      layer = 1;
      unit(v).multiplyScalar(Math.pow(rand(), 0.55) * 0.97);
      alpha = 0.2 + rand() * 0.35;
    } else if (pick < tFunnel) {
      layer = 2;
      let azimuth: number;
      let polar: number;
      let sign: number;
      if (rand() < 0.55) {
        // sobre una veta
        const ray = rays[Math.floor(rand() * rays.length)];
        azimuth = ray.azimuth + gauss() * ray.width;
        polar = Math.max(0, ray.polar + gauss() * ray.width);
        sign = ray.sign;
      } else {
        // relleno del cono
        azimuth = rand() * Math.PI * 2;
        polar = d.funnelAngle * Math.pow(rand(), 0.8);
        sign = rand() < 0.5 ? 1 : -1;
      }
      const r = (0.04 + Math.pow(rand(), 0.85) * 0.93);
      v.set(
        Math.sin(polar) * Math.cos(azimuth) * r,
        Math.cos(polar) * r * sign,
        Math.sin(polar) * Math.sin(azimuth) * r,
      );
      alpha = 0.8 + rand() * 0.2;
    } else {
      layer = 3;
      const e = -Math.log(Math.max(1 - rand(), 1e-7));
      unit(v).multiplyScalar(1 + e * d.haloSpread * 0.5);
      alpha = 0.06 + 0.3 * Math.exp(-e);
    }

    positions.set([v.x, v.y, v.z], i * 3);
    randoms.set([rand(), alpha, rand(), layer], i * 4);
    gravity.set([rand(), rand(), rand()], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(randoms, 4));
  geometry.setAttribute('aGrav', new THREE.BufferAttribute(gravity, 3));
  // Caja generosa: las partículas se desplazan en el shader.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return geometry;
}
