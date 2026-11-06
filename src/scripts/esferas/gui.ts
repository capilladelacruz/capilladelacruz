import GUI from 'lil-gui';
import { CONFIG, COMPOSITIONS, ENTRY_MODES, GRAVITY_SHAPES } from './config';
import type { EsferasScene } from './EsferasScene';

/** Panel para ajustar CONFIG en vivo. Solo se carga en desarrollo (npm run dev). */
export function initGui(scene: EsferasScene) {
  const gui = new GUI({ title: 'Esferas · dev' });
  gui.domElement.style.zIndex = '50';

  // ── Aspecto
  const look = gui.addFolder('Aspecto');
  look.add(CONFIG.look, 'pointSize', 0.5, 4, 0.05).name('tamaño de punto');
  look.add(CONFIG.look, 'opacity', 0.05, 1, 0.01).name('opacidad');
  look.add(CONFIG.look, 'depthFade', 0, 1, 0.01).name('fundido de fondo');
  look.add(CONFIG.look, 'maxPointSize', 1, 20, 0.5).name('tamaño máx.');

  // ── Reparto (requiere regenerar la geometría)
  const dist = gui.addFolder('Reparto').close();
  const rebuild = () => scene.rebuild();
  dist.add(CONFIG.distribution, 'shell', 0, 1, 0.01).name('cáscara').onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'interior', 0, 1, 0.01).onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'funnel', 0, 1, 0.01).name('núcleo').onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'halo', 0, 1, 0.01).onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'shellThickness', 0, 0.2, 0.001).name('grosor cáscara').onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'funnelAngle', 0.1, 1.4, 0.01).name('apertura conos').onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'funnelRays', 0, 200, 1).name('vetas').onFinishChange(rebuild);
  dist.add(CONFIG.distribution, 'haloSpread', 0, 1, 0.01).name('alcance halo').onFinishChange(rebuild);

  // ── Flujo
  const flow = gui.addFolder('Flujo').close();
  flow.add(CONFIG.flow, 'speed', 0, 0.6, 0.005).name('velocidad');
  flow.add(CONFIG.flow, 'noiseScale', 0.2, 4, 0.01).name('escala del noise');
  flow.add(CONFIG.flow, 'amplitude', 0, 0.6, 0.005).name('amplitud');
  flow.add(CONFIG.flow, 'swirl', 0, 4, 0.01).name('torsión');
  flow.add(CONFIG.flow, 'shellPull', 0, 1, 0.01).name('cáscara pegada');
  flow.add(CONFIG.flow, 'density', 0, 1, 0.01).name('contraste densidad');
  flow.add(CONFIG.flow, 'breath', 0, 0.1, 0.001).name('respiración');
  flow.add(CONFIG.flow, 'rotationSpeed', 0, 0.5, 0.005).name('giro');

  // ── Gravedad
  const grav = gui.addFolder('Gravedad');
  for (const s of scene.spheres) {
    grav.add(CONFIG.gravity.shapes, s.proyecto.slug, [...GRAVITY_SHAPES]).name(`forma · ${s.proyecto.year}`);
  }
  grav.add(CONFIG.gravity, 'strength', 0, 2, 0.01).name('fuerza de atracción');
  grav.add(CONFIG.gravity, 'coreRadius', 0.05, 0.6, 0.01).name('radio del núcleo');
  grav.add(CONFIG.gravity, 'twist', -4, 4, 0.01).name('torsión del remolino');
  grav.add(CONFIG.gravity, 'tilt', -90, 90, 1).name('inclinación del eje (°)');
  grav.add(CONFIG.gravity, 'spinSpeed', -3, 3, 0.01).name('velocidad de giro');

  // ── Entrada
  const entry = gui.addFolder('Entrada');
  entry.add(CONFIG.entry, 'mode', [...ENTRY_MODES]).name('modo');
  entry.add(CONFIG.entry, 'duration', 0.4, 4, 0.05).name('duración (s)');
  entry
    .add(CONFIG.entry, 'ease', ['expo.inOut', 'expo.in', 'power2.inOut', 'power3.in', 'power4.inOut', 'sine.inOut', 'circ.inOut', 'none'])
    .name('easing');
  entry.add(CONFIG.entry, 'finalDensity', 0, 1, 0.01).name('densidad final');
  entry.add(CONFIG.entry, 'darkness', 0, 1, 0.01).name('oscurecimiento máx.');
  const test = { esfera: scene.spheres[0]?.proyecto.slug ?? '' };
  entry
    .add(test, 'esfera', Object.fromEntries(scene.spheres.map((s) => [String(s.proyecto.year), s.proyecto.slug])))
    .name('esfera de prueba');
  entry.add({ probar: () => scene.preview(test.esfera) }, 'probar').name('▶ probar entrada');

  // ── Hover
  const hover = gui.addFolder('Hover').close();
  hover.add(CONFIG.hover, 'scale', 1, 1.3, 0.01).name('crecimiento');
  hover.add(CONFIG.hover, 'flowBoost', 0, 6, 0.1).name('aceleración flujo');
  hover.add(CONFIG.hover, 'ampBoost', 0, 3, 0.05).name('agitación');
  hover.add(CONFIG.hover, 'repelRadius', 0.05, 1, 0.01).name('radio repulsión');
  hover.add(CONFIG.hover, 'repelStrength', 0, 1, 0.01).name('fuerza repulsión');
  hover.add(CONFIG.hover, 'dimOthers', 0, 1, 0.01).name('atenuar otras');

  // ── Escena
  // La escena detecta los cambios y recoloca las esferas en vivo.
  const comp = gui.addFolder('Escena');
  comp
    .add(CONFIG.scene, 'composition', { 'fila fija': COMPOSITIONS[0], flotando: COMPOSITIONS[1] })
    .name('composición');
  comp.add(CONFIG.scene.row, 'size', 0.15, 1.2, 0.01).name('tamaño de las bolas');
  comp.add(CONFIG.scene.row, 'gap', 0, 2, 0.01).name('separación entre bolas');
  comp.add(CONFIG.scene.row, 'titleGap', 0, 200, 1).name('nombre ↔ fila (px)');
  const floating = comp.addFolder('Solo «flotando»').close();
  floating.add(CONFIG.scene, 'parallax', 0, 2, 0.01);
  floating.add(CONFIG.scene, 'drift', 0, 1, 0.01).name('deriva');
  floating.add(CONFIG.scene, 'driftSpeed', 0, 0.1, 0.001).name('velocidad deriva');
  floating.add(CONFIG.scene, 'titlePadding', 0, 120, 1).name('margen del título (px)');
  return gui;
}

/**
 * Carpeta final del panel (se añade la última, después de todas las demás):
 * - copiar CONFIG: copia TODO el CONFIG (esferas, contraseña y archivo).
 * - guardar como defecto: escribe los valores actuales en src/scripts/esferas/config.ts.
 *   Solo existe con el servidor de desarrollo (lo atiende tools/guardar-config.mjs).
 */
export function addConfigFolder(gui: GUI) {
  const f = gui.addFolder('CONFIG');
  f.add(
    {
      copiar: async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(CONFIG, null, 2));
          aviso('CONFIG copiado');
        } catch {
          aviso('No se pudo copiar', true);
        }
      },
    },
    'copiar',
  ).name('copiar CONFIG');
  if (import.meta.env.DEV) {
    f.add(
      {
        guardar: async () => {
          try {
            const r = await fetch('/__dev/guardar-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(CONFIG),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) throw new Error(j.error ?? r.statusText);
            aviso('Guardado en config.ts');
          } catch (err) {
            console.error('[config] no se pudo guardar', err);
            aviso('No se pudo guardar', true);
          }
        },
      },
      'guardar',
    ).name('guardar como defecto');
  }
  return f;
}

/** Mensaje pequeño que desaparece solo. */
function aviso(texto: string, error = false) {
  const el = document.createElement('div');
  el.textContent = texto;
  Object.assign(el.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '60',
    padding: '7px 12px',
    borderRadius: '6px',
    background: error ? '#a3241b' : '#1f1f1f',
    color: '#fff',
    font: '11px/1.3 system-ui, sans-serif',
    letterSpacing: '0.02em',
    boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
    opacity: '0',
    transition: 'opacity 0.25s ease',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = '1'));
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 1800);
}
