import { CONFIG } from '../esferas/config';
import type { Proyecto } from '../../data/proyectos';

export interface Foto {
  /** Tamaño original (para la proporción). */
  w: number;
  h: number;
  /** Miniatura (textura de la pila y src de la columna). */
  src: string;
  /** Variantes para la columna ("url 128w, url 256w…"). */
  srcset?: string;
}

/** Aleatorio con semilla (sin importar three.js). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Promise<Foto[]>>();

/** Fotos de un proyecto: las de src/assets/proyectos/<slug>/ o, si no hay, de relleno. */
export function cargarFotos(proyecto: Proyecto): Promise<Foto[]> {
  let p = cache.get(proyecto.slug);
  if (!p) {
    p = fetch(`/archivo/${proyecto.slug}.json`)
      .then((r) => (r.ok ? r.json() : { fotos: [] }))
      .catch(() => ({ fotos: [] }))
      .then(({ fotos }: { fotos: Foto[] }) => (fotos.length ? fotos : relleno(proyecto.seed, CONFIG.archivo.placeholderCount)));
    cache.set(proyecto.slug, p);
  }
  return p;
}

/**
 * Fotos de relleno generadas en el navegador (parecen fotos: cielo, suelo, manchas, grano).
 * Desaparecen solas en cuanto haya fotos en la carpeta del proyecto.
 */
function relleno(seed: number, n: number): Foto[] {
  const rand = mulberry32(seed * 977 + 13);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fotos: Foto[] = [];
  const hsl = (h: number, s: number, l: number) => `hsl(${h % 360} ${s}% ${l}%)`;

  for (let i = 0; i < n; i++) {
    const vertical = rand() < 0.25;
    const w = 192;
    const h = Math.round(vertical ? w * 1.33 : w * 0.67);
    canvas.width = w;
    canvas.height = h;

    const base = rand() * 360;
    const sat = 15 + rand() * 55;
    const horizon = h * (0.3 + rand() * 0.4);

    // cielo / pared
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, hsl(base + 180 + rand() * 40, sat * 0.6, 55 + rand() * 35));
    g.addColorStop(1, hsl(base + 200, sat * 0.4, 70 + rand() * 25));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon);
    // suelo
    g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, hsl(base, sat, 25 + rand() * 40));
    g.addColorStop(1, hsl(base + 20, sat, 8 + rand() * 25));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, w, h - horizon);

    // manchas: gente, objetos, ventanas…
    const manchas = 3 + Math.floor(rand() * 9);
    for (let k = 0; k < manchas; k++) {
      ctx.globalAlpha = 0.35 + rand() * 0.6;
      ctx.fillStyle = hsl(base + (rand() - 0.5) * 160, 10 + rand() * 70, 10 + rand() * 80);
      const mw = w * (0.04 + rand() * 0.35);
      const mh = h * (0.05 + rand() * 0.45);
      const x = rand() * w;
      const y = horizon - mh * rand() * 0.8;
      if (rand() < 0.5) ctx.fillRect(x, y, mw, mh);
      else {
        ctx.beginPath();
        ctx.ellipse(x, y, mw / 2, mh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // grano
    const img = ctx.getImageData(0, 0, w, h);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (rand() - 0.5) * 22;
      img.data[p] += n;
      img.data[p + 1] += n;
      img.data[p + 2] += n;
    }
    ctx.putImageData(img, 0, 0);

    fotos.push({ w, h, src: canvas.toDataURL('image/jpeg', 0.72) });
  }
  return fotos;
}
