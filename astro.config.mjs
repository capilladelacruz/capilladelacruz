// @ts-check
import { defineConfig } from 'astro/config';
import { guardarConfig } from './tools/guardar-config.mjs';

// https://astro.build/config
export default defineConfig({
  vite: {
    // Botón "guardar como defecto" del panel: solo con el servidor de desarrollo.
    plugins: [guardarConfig()],
  },
});
