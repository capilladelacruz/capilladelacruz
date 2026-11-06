import type GUI from 'lil-gui';
import { CONFIG, ORDENES_VUELO, TRANSICIONES } from '../esferas/config';
import type { Archivo } from './Archivo';
import { olvidarAcceso } from './Cristal';

interface Acciones {
  /** Abre un proyecto si no hay ninguno abierto (en la home, con la transición de la esfera). */
  abrirPrueba?: (modo: 'auto' | 'no') => void;
}

/** Carpetas "Contraseña" y "Archivo" del panel de desarrollo. */
export function addArchivoFolders(gui: GUI, archivo: Archivo, { abrirPrueba }: Acciones = {}) {
  const pass = gui.addFolder('Contraseña');
  const vivo = () => archivo.cristal.aplicarAjustes();
  pass.add(CONFIG.password, 'blur', 0, 60, 1).name('intensidad del blur (px)').onChange(vivo);
  pass.add(CONFIG.password, 'tint', 0, 0.8, 0.01).name('tinte del cristal').onChange(vivo);
  pass.add(CONFIG.password, 'morphDuration', 0.2, 2.5, 0.05).name('morph a círculo (s)');
  pass.add(CONFIG.password, 'glow', 0, 2, 0.05).name('intensidad del brillo');
  pass.add(CONFIG.password, 'revealDuration', 0.3, 4, 0.05).name('degradado radial (s)');
  pass
    .add(
      {
        probar: async () => {
          if (!(await archivo.probarDesbloqueo())) abrirPrueba?.('auto');
        },
      },
      'probar',
    )
    .name('▶ probar desbloqueo');
  pass
    .add({ olvidar: () => olvidarAcceso() }, 'olvidar')
    .name('olvidar contraseña (volver a pedirla)');

  const arch = gui.addFolder('Archivo');
  arch.add(CONFIG.archivo, 'introDuration', 1, 10, 0.1).name('duración entrada (s)');
  arch.add(CONFIG.archivo, 'wave', 0, 3, 0.05).name('fuerza de la ola');
  arch.add(CONFIG.archivo, 'angle', -60, 60, 1).name('ángulo de la pila (°)');
  arch.add(CONFIG.archivo, 'stackGap', 0.01, 0.3, 0.005).name('separación pila');
  arch.add(CONFIG.archivo, 'columnWidth', 0.03, 0.4, 0.005).name('ancho columna');
  arch.add(CONFIG.archivo, 'columnWidthMobile', 0.1, 0.9, 0.01).name('ancho columna (móvil)');
  arch.add(CONFIG.archivo, 'columnGap', 0, 30, 1).name('separación columna (px)');
  arch.add(CONFIG.archivo, 'autoscroll', -200, 200, 1).name('autoscroll (px/s)');
  arch.add(CONFIG.archivo, 'transition', [...TRANSICIONES]).name('modo de transición');
  arch.add(CONFIG.archivo, 'flightDuration', 0.4, 8, 0.05).name('duración del vuelo (s)');
  arch.add(CONFIG.archivo, 'flightStagger', 0, 0.4, 0.005).name('retraso entre fotos (s)');
  arch
    .add(CONFIG.archivo, 'flightOrder', {
      'de arriba abajo': ORDENES_VUELO[0],
      'de abajo arriba': ORDENES_VUELO[1],
      'desde el centro': ORDENES_VUELO[2],
      aleatorio: ORDENES_VUELO[3],
    })
    .name('orden de la cascada');
  arch
    .add(CONFIG.archivo, 'flightEase', ['power2.inOut', 'power3.inOut', 'power4.inOut', 'expo.inOut', 'sine.inOut', 'circ.inOut', 'power3.out', 'expo.out', 'back.out(1.4)', 'none'])
    .name('easing del vuelo');
  arch.add(CONFIG.archivo, 'flightCurve', 0, 1.5, 0.01).name('curva del recorrido');
  arch.add(CONFIG.archivo, 'flightPause', 0, 3, 0.05).name('pausa pila → vuelo (s)');
  arch
    .add(
      {
        repetir: () => {
          if (!archivo.repetirEntrada()) abrirPrueba?.('no');
        },
      },
      'repetir',
    )
    .name('▶ repetir entrada');
  return { pass, arch };
}
