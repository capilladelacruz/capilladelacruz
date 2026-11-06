/**
 * Plugin de Vite SOLO para el servidor de desarrollo (apply: 'serve'):
 * el botón "guardar como defecto" del panel envía el CONFIG actual a
 * POST /__dev/guardar-config y aquí se escriben esos valores en
 * src/scripts/esferas/config.ts, conservando comentarios, tipos y formato.
 * En la compilación de producción este plugin no existe.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CONFIG_TS = fileURLToPath(new URL('../src/scripts/esferas/config.ts', import.meta.url));
const RUTA = '/__dev/guardar-config';

export function guardarConfig() {
  let silenciarHasta = 0;
  return {
    name: 'capilla:guardar-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(RUTA, async (req, res) => {
        const responder = (status, data) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        if (req.method !== 'POST') return responder(405, { ok: false, error: 'POST' });
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          const valores = JSON.parse(body);
          const fuente = await readFile(CONFIG_TS, 'utf8');
          const { texto, faltan } = reescribir(fuente, valores);
          if (faltan.length) return responder(422, { ok: false, error: `No encontrado en config.ts: ${faltan.join(', ')}` });
          // Los valores ya están en memoria en el navegador: no hace falta recargar la página.
          silenciarHasta = Date.now() + 3000;
          if (texto !== fuente) await writeFile(CONFIG_TS, texto);
          responder(200, { ok: true });
        } catch (err) {
          responder(500, { ok: false, error: String(err?.message ?? err) });
        }
      });
    },
    hotUpdate({ file }) {
      if (file === CONFIG_TS && Date.now() < silenciarHasta) return [];
    },
  };
}

// ───────────────────────── reescritura de config.ts ─────────────────────────

const clave = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
const num = (n) => String(Number.isInteger(n) ? n : +n.toFixed(6));

/** Valor JS → literal TS (comillas simples, como el resto del archivo). */
function lit(v) {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${clave(k)}: ${lit(x)}`).join(', ')} }`;
  return 'null';
}

function get(obj, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Rutas de todas las hojas de un objeto (los arrays cuentan como hoja). */
function hojas(obj, path = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) hojas(v, [...path, k], out);
    else out.push([...path, k].join('.'));
  }
  return out;
}

const RE_CLAVE = /^(\s*)(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(.*)$/;
const RE_LITERAL = /^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:e-?\d+)?|-?\.\d+|true|false)(.*)$/;

/**
 * Sustituye en el texto de config.ts cada valor de `export const CONFIG = { … }`.
 * Recorre línea a línea (una clave por línea, objetos anidados con `{`),
 * así que comentarios, `as Tipo` y orden se conservan.
 */
export function reescribir(fuente, valores) {
  const lineas = fuente.split('\n');
  const inicio = lineas.findIndex((l) => /^export const CONFIG\s*=\s*\{\s*$/.test(l));
  if (inicio < 0) throw new Error('No encuentro `export const CONFIG = {`');

  const escritas = new Set();
  const salida = lineas.slice(0, inicio + 1);
  const pila = [];
  let i = inicio + 1;

  for (; i < lineas.length; i++) {
    const linea = lineas[i];
    if (pila.length === 0 && /^\};?\s*$/.test(linea)) break; // fin de CONFIG

    if (/^\s*\}/.test(linea)) {
      pila.pop();
      salida.push(linea);
      continue;
    }
    const m = linea.match(RE_CLAVE);
    if (!m || /^\s*\/\//.test(linea)) {
      salida.push(linea);
      continue;
    }
    const [, sangria, k1, k2, k3, resto] = m;
    const key = k1 ?? k2 ?? k3;
    const ruta = [...pila, key];
    const valor = get(valores, ruta);
    const r = resto.trimEnd();

    // Objeto multilínea → bajar un nivel.
    if (/^\{\s*(\/\/.*)?$/.test(r)) {
      pila.push(key);
      salida.push(linea);
      continue;
    }
    // Array multilínea → se reescribe entero.
    if (/^\[\s*(\/\/.*)?$/.test(r)) {
      let j = i + 1;
      while (j < lineas.length && !/^\s*\]/.test(lineas[j])) j++;
      const sufijo = lineas[j].replace(/^\s*\]/, '');
      if (Array.isArray(valor)) {
        salida.push(`${sangria}${clave(key)}: [`);
        for (const item of valor) salida.push(`${sangria}  ${lit(item)},`);
        salida.push(`${sangria}]${sufijo}`);
        escritas.add(ruta.join('.'));
      } else {
        salida.push(...lineas.slice(i, j + 1));
      }
      i = j;
      continue;
    }
    // Objeto en una sola línea: { … } as Tipo,
    if (r.startsWith('{')) {
      const fin = r.lastIndexOf('}');
      if (valor && typeof valor === 'object' && fin > 0) {
        salida.push(`${sangria}${clave(key)}: ${lit(valor)}${r.slice(fin + 1)}`);
        for (const h of hojas(valor, ruta)) escritas.add(h);
      } else salida.push(linea);
      continue;
    }
    // Valor simple (número, texto, booleano) + lo que siga (as Tipo, coma, comentario).
    const lm = r.match(RE_LITERAL);
    if (lm && valor !== undefined && (typeof valor !== 'object' || valor === null)) {
      salida.push(`${sangria}${clave(key)}: ${lit(valor)}${lm[2]}`);
      escritas.add(ruta.join('.'));
    } else salida.push(linea);
  }
  salida.push(...lineas.slice(i));

  const faltan = hojas(valores).filter((h) => !escritas.has(h) && ![...escritas].some((e) => h.startsWith(e + '.')));
  return { texto: salida.join('\n'), faltan };
}
