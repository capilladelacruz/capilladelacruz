/**
 * Manifiesto de fotos de cada proyecto: /archivo/<slug>.json
 *
 * Lee las fotos de src/assets/proyectos/<slug>/ (orden = nombre de archivo) y
 * genera al compilar miniaturas WebP en varios anchos. La misma miniatura de 256 px
 * sirve de textura para la pila 3D y para la columna (se descarga una sola vez).
 */
import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { PROYECTOS } from '../../data/proyectos';

const fotos = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/proyectos/*/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP}',
  { eager: true },
);

/** Anchos generados (px). 256 es el de la textura de la pila. */
const ANCHOS = [128, 256, 384];
const ANCHO_TEXTURA = 256;

export function getStaticPaths() {
  return PROYECTOS.map((p) => ({ params: { slug: p.slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const entradas = Object.entries(fotos)
    .filter(([ruta]) => ruta.split('/').at(-2) === params.slug)
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));

  const items = await Promise.all(
    entradas.map(async ([, mod]) => {
      const img = mod.default;
      const anchos = [...new Set(ANCHOS.map((w) => Math.min(w, img.width)))];
      const variantes = await Promise.all(
        anchos.map(async (w) => ({ w, src: (await getImage({ src: img, width: w, format: 'webp', quality: 72 })).src })),
      );
      const textura = variantes.find((v) => v.w === Math.min(ANCHO_TEXTURA, img.width)) ?? variantes.at(-1)!;
      return {
        w: img.width,
        h: img.height,
        src: textura.src,
        srcset: variantes.map((v) => `${v.src} ${v.w}w`).join(', '),
      };
    }),
  );

  return new Response(JSON.stringify({ fotos: items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
