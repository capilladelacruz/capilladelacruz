import type { GravityShape } from '../scripts/esferas/config';

/**
 * Proyectos de Capilladelacruz. Cada proyecto es una esfera de partículas.
 *
 * Para añadir una esfera nueva basta con añadir un objeto a PROYECTOS:
 * la escena, las etiquetas, los botones accesibles y la página
 * /proyectos/[slug] se generan solos a partir de este array.
 * Su posición en pantalla sale de CONFIG.scene.layout (por orden).
 */

/** Render propio que sustituirá a las partículas en el futuro (aún no implementado). */
export interface ProyectoAsset {
  /** 'video' = webm con canal alfa · 'glb' = modelo 3D */
  type: 'video' | 'glb';
  src: string;
}

export interface Proyecto {
  /** Identificador de URL: /proyectos/<slug> */
  slug: string;
  /** Nombre del proyecto (aria-label y página del proyecto) */
  title: string;
  /** Año: es lo único que muestra la etiqueta junto a la esfera */
  year: number;
  /** Radio de la esfera en unidades de escena (la más grande ≈ 0,9) */
  size: number;
  /** Semilla: cambia el patrón de remolinos, la inclinación y la deriva */
  seed: number;
  /** Nº de partículas en escritorio (en móvil se usa la mitad) */
  particleCount: number;
  /** Color de las partículas (opcional, por defecto CONFIG.look.color) */
  color?: string;
  /** Forma de la gravedad central por defecto (se cambia en vivo en el panel) */
  gravity?: GravityShape;
  /** Opcional: render propio que sustituirá a la esfera de partículas */
  asset?: ProyectoAsset;
}

// Nombres provisionales.
// size y particleCount se usan en la composición «flotando»; en «fila» las tres
// esferas usan CONFIG.scene.row (mismo tamaño y mismo nº de partículas).
export const PROYECTOS: Proyecto[] = [
  {
    slug: 'materia-oscura',
    title: 'Materia oscura',
    year: 2023,
    size: 0.9,
    seed: 7,
    particleCount: 45000,
    gravity: 'columna',
  },
  {
    slug: 'humo-atrapado',
    title: 'Humo atrapado',
    year: 2024,
    size: 0.68,
    seed: 23,
    particleCount: 30000,
    color: '#0b0d12',
    gravity: 'espiral',
  },
  {
    slug: 'nucleo-blanco',
    title: 'Núcleo blanco',
    year: 2025,
    size: 0.5,
    seed: 41,
    particleCount: 20000,
    gravity: 'punto',
  },
];
