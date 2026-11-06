/**
 * Parámetros visuales de las esferas, agrupados para ajustarlos a ojo.
 * En desarrollo (npm run dev) aparece un panel lil-gui para tocarlos en vivo;
 * cuando des con valores que te gusten, pulsa "copiar CONFIG" y pégalos aquí.
 */

/** Formas de gravedad central disponibles (el orden importa: es el índice en el shader). */
export const GRAVITY_SHAPES = ['reloj', 'punto', 'anillo', 'espiral', 'columna', 'ninguna'] as const;
export type GravityShape = (typeof GRAVITY_SHAPES)[number];

/** Modos de entrada en una esfera (el orden importa: es el índice en el shader). */
export const ENTRY_MODES = ['zoom', 'expansión', 'explosión', 'remolino', 'tinta'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const COMPOSITIONS = ['fila', 'flotando'] as const;
export type Composition = (typeof COMPOSITIONS)[number];

/** Hueco de una esfera: x/y relativas a media pantalla (-1…1) a su profundidad z. */
interface Slot {
  x: number;
  y: number;
  z: number;
}

export const CONFIG = {
  /** Aspecto de los puntos. */
  look: {
    pointSize: 1.45, // px CSS a la distancia de referencia
    maxPointSize: 4, // px CSS máximos (cuando la cámara atraviesa la nube)
    opacity: 0.21, // alfa base de cada punto
    depthFade: 0.08, // 0 = sin efecto · 1 = el fondo de la esfera casi desaparece
    color: '#000000', // partículas
    background: '#ffffff',
    // Variante de color para el futuro (partículas claras sobre negro).
    colorInverse: '#e9eef6',
    backgroundInverse: '#000000',
  },

  /** Reparto de las partículas dentro de cada esfera (proporciones relativas). */
  distribution: {
    shell: 0.94, // cáscara: borde denso y definido
    interior: 0, // relleno vaporoso
    funnel: 0.02, // núcleo: las partículas que forman la gravedad central
    halo: 0.1, // partículas sueltas que se disuelven hacia fuera
    shellThickness: 0.032, // grosor de la cáscara (radio = 1)
    funnelAngle: 0.6, // apertura de los conos del reloj de arena (radianes)
    funnelRays: 60, // nº de vetas radiales del reloj de arena
    haloSpread: 0, // cuánto se aleja el halo
  },

  /** Flujo interno (todo se calcula en el vertex shader). */
  flow: {
    speed: 0.135, // velocidad del flujo de curl noise
    noiseScale: 0.52, // tamaño de los remolinos (más alto = más pequeños)
    amplitude: 0.295, // cuánto desplaza el flujo a cada partícula
    swirl: 3.34, // torsión del vórtice alrededor del eje
    shellPull: 0, // 1 = la cáscara se queda pegada a la superficie
    density: 0.34, // contraste de las zonas oscuras / huecos que se abren y cierran
    breath: 0.021, // pulsación de escala (respiración)
    rotationSpeed: 0.365, // giro lento de la esfera (rad/s)
  },

  /** Gravedad central: la forma hacia la que se atraen las partículas del núcleo. */
  gravity: {
    /** Forma por esfera (slug → forma). Las que falten toman la de proyectos.ts. */
    shapes: { 'materia-oscura': 'columna', 'humo-atrapado': 'espiral', 'nucleo-blanco': 'punto' } as Record<string, GravityShape>,
    strength: 1.17, // fuerza de atracción (0 = sin forma · 1 = forma nítida · 2 = arrastra también el interior)
    coreRadius: 0.45, // tamaño del núcleo (anchura de los conos, radio del anillo, del punto…)
    twist: 1.83, // torsión del remolino alrededor del eje de la gravedad
    tilt: -52, // inclinación del eje (grados)
    spinSpeed: 0.1, // velocidad de giro de la gravedad (rad/s)
  },

  /** Entrada en una esfera (al pulsarla). El fondo se queda blanco. */
  entry: {
    mode: 'expansión' as EntryMode,
    duration: 3.3,
    ease: 'expo.inOut',
    finalDensity: 0.07, // 0…1: cuánto crecen y se densifican las partículas al final
    darkness: 0, // 0…1: cuánto se oscurece la pantalla en el punto máximo
    fadeDuration: 0.8, // con prefers-reduced-motion (fundido simple)
  },

  /** Interacción. */
  hover: {
    scale: 1.22, // la esfera crece
    flowBoost: 0, // el flujo se acelera
    ampBoost: 0.3, // las partículas se agitan más
    dimOthers: 0.61, // cuánto bajan de opacidad las demás
    repelRadius: 0.1, // radio de repulsión del cursor (radio de esfera = 1)
    repelStrength: 0.16, // fuerza de la repulsión
    damping: 5, // suavizado de las transiciones de hover
  },

  /** Composición de la escena. */
  scene: {
    fov: 35,
    cameraZ: 10,
    parallax: 0, // desplazamiento de cámara con ratón / giroscopio (solo «flotando»)
    drift: 0.63, // amplitud de la deriva de cada esfera (solo «flotando»)
    driftSpeed: 0.029, // velocidad de la deriva
    minSeparation: 0.95, // distancia mínima entre centros, en (r1 + r2)
    titlePadding: 0, // px libres alrededor de "capilladelacruz" (solo «flotando»)
    /**
     * Composición:
     *  'fila'     → nombre en el centro exacto y las esferas en fila debajo, fijas, mismo tamaño.
     *  'flotando' → composición anterior: esferas repartidas que derivan (usa `layout`).
     */
    composition: 'flotando' as Composition,
    /** Ajustes de la composición en fila. */
    row: {
      size: 0.23, // radio de cada esfera (unidades de escena)
      gap: 1.13, // separación entre bordes de esferas (unidades de escena)
      titleGap: 200, // px entre el nombre (centro exacto de la pantalla) y la parte de arriba de la fila
      sideMargin: 0.08, // margen mínimo a cada lado, en fracción del ancho (móvil)
      particleCount: 20000, // mismo nº de partículas en todas → misma densidad
    },
    /** Huecos de la composición «flotando» (en el orden de proyectos.ts). */
    layout: {
      landscape: [
        { x: -0.52, y: 0.14, z: 0 },
        { x: 0.5, y: 0.42, z: -2.6 },
        { x: 0.26, y: -0.55, z: 1.6 },
        { x: -0.2, y: -0.62, z: -1.2 },
        { x: -0.15, y: 0.64, z: -3.5 },
      ] as Slot[],
      portrait: [
        { x: -0.2, y: 0.5, z: 0 },
        { x: 0.3, y: -0.55, z: -2.6 },
        { x: -0.42, y: -0.3, z: 1.6 },
        { x: 0.45, y: 0.2, z: -1.2 },
        { x: -0.35, y: -0.78, z: -3.5 },
      ] as Slot[],
    },
  },

  /**
   * Contraseña para entrar en los proyectos (se comprueba en el navegador, sin servidor:
   * no es seguridad real, solo parte de la experiencia). Para quitarla: enabled: false.
   * No distingue mayúsculas ni espacios.
   */
  password: {
    enabled: true,
    value: 'QUESERADENOSOTROS',
  },

  /** Rendimiento. */
  performance: {
    mobileParticleFactor: 0.5,
    maxPixelRatio: 2,
    reducedMotionFactor: 0.15, // velocidad del flujo con prefers-reduced-motion
  },
};

export type Config = typeof CONFIG;
