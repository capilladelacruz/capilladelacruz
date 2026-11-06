/**
 * Shaders de las esferas de partículas.
 *
 * Todo el movimiento se calcula en la GPU, sin estado: cada partícula parte de
 * su posición base (esfera de radio 1) y en cada frame se le aplica:
 *   1. torsión de vórtice alrededor del eje Y (los conos giran como un remolino)
 *   2. advección por curl noise 3D animado (vetas, remolinos y pliegues)
 *   3. la cáscara se vuelve a pegar a la superficie → los pliegues se ven como vetas
 *   4. respiración, repulsión del cursor y expansión al entrar
 */

// Simplex noise 3D con gradiente analítico (Ashima Arts / Stefan Gustavson, licencia MIT).
const noise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));

  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;

  return 105.0 * dot(m4, pdotx);
}

// Curl de un potencial vectorial (n1, n2, n3): campo sin divergencia → flujo tipo fluido.
vec3 curlNoise(vec3 p) {
  vec3 g1, g2, g3;
  snoise(p, g1);
  snoise(p + vec3(31.416, -47.853, 12.679), g2);
  snoise(p + vec3(-233.145, -113.408, -185.31), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}
`;

export const vertexShader = /* glsl */ `
uniform float uTime;         // tiempo de flujo (integrado en JS: acelera con el hover)
uniform float uClock;        // tiempo real (respiración)
uniform vec3  uSeed;
uniform float uNoiseScale;
uniform float uFlowAmp;
uniform float uSwirl;
uniform float uShellPull;
uniform float uDensity;
uniform float uBreath;
uniform float uSize;
uniform float uMaxSize;
uniform float uPixelRatio;
uniform float uSizeRef;
uniform float uOpacity;
uniform float uDepthFade;
uniform float uHover;
uniform vec3  uMouse;        // cursor en espacio local de la esfera
uniform float uRepelRadius;
uniform float uRepelStrength;

// Gravedad central
uniform float uGravA;        // forma anterior (índice de GRAVITY_SHAPES)
uniform float uGravB;        // forma actual
uniform float uGravMix;      // 0 → A · 1 → B (fundido al cambiar de forma)
uniform float uGravStrength;
uniform float uGravCore;
uniform float uGravTwist;
uniform float uGravTilt;     // radianes
uniform float uGravAngle;    // giro acumulado (velocidad de giro de la gravedad)
uniform float uFunnelAngle;

// Entrada en la esfera
uniform float uEnter;        // 0 → 1
uniform float uEnterMode;    // índice de ENTRY_MODES
uniform float uFill;         // escala que hace falta para cubrir toda la pantalla
uniform float uFinalDensity;
uniform vec3  uCamLocal;     // cámara en espacio local de la esfera

attribute vec4 aRand;        // x: tamaño · y: alfa · z: fase · w: capa (0 cáscara, 1 interior, 2 núcleo, 3 halo)
attribute vec3 aGrav;        // aleatorios para colocar la partícula sobre la forma de gravedad

varying float vAlpha;

${noise}

const float TAU = 6.28318530718;

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 rotAxis(vec3 p, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c);
}
vec3 randDir() {
  float z = aGrav.y * 2.0 - 1.0;
  float a = aGrav.z * TAU;
  float r = sqrt(1.0 - z * z);
  return vec3(r * cos(a), z, r * sin(a));
}

// Forma de gravedad en su marco canónico (eje = Y).
vec3 gravityShape(float shape, bool isCore) {
  float u1 = aGrav.x, u2 = aGrav.y, u3 = aGrav.z;
  float k = uGravCore / 0.35;
  if (shape < 0.5) {
    // reloj de arena / doble cono (las vetas vienen horneadas en position)
    vec3 v;
    if (isCore) {
      v = position * vec3(k, 1.0, k);
    } else {
      float polar = uFunnelAngle * pow(u1, 0.8);
      float r = 0.04 + pow(u3, 0.85) * 0.93;
      float sgn = aRand.z < 0.5 ? -1.0 : 1.0;
      float az = u2 * TAU;
      v = vec3(sin(polar) * cos(az) * r * k, cos(polar) * r * sgn, sin(polar) * sin(az) * r * k);
    }
    float l = length(v);
    return l > 0.97 ? v / l * 0.97 : v;
  }
  if (shape < 1.5) {
    // punto: agujero negro
    return randDir() * uGravCore * pow(u1, 2.0) * 0.9;
  }
  if (shape < 2.5) {
    // anillo
    float a = u2 * TAU;
    float R = clamp(0.2 + uGravCore * 1.4, 0.1, 0.9);
    float dr = (u1 - 0.5) * 0.14 * u3;
    float dy = (fract(u3 * 13.7) - 0.5) * 0.08;
    return vec3(cos(a) * (R + dr), dy, sin(a) * (R + dr));
  }
  if (shape < 3.5) {
    // espiral / vórtice de tres brazos
    float arm = floor(u3 * 3.0);
    float r = pow(u1, 0.6) * clamp(0.3 + uGravCore * 1.8, 0.2, 0.95);
    float a = arm * TAU / 3.0 + r * 5.5 + (fract(u2 * 7.31) - 0.5) * 0.6 * (1.0 - r * 0.5);
    float y = (fract(u2 * 3.17) - 0.5) * 0.08 * (1.0 - r);
    return vec3(cos(a) * r, y, sin(a) * r);
  }
  if (shape < 4.5) {
    // columna: eje vertical
    float y = (u1 * 2.0 - 1.0) * 0.95;
    float rr = uGravCore * 0.4 * sqrt(u2) * (1.0 - 0.4 * abs(y));
    float a = u3 * TAU;
    return vec3(cos(a) * rr, y, sin(a) * rr);
  }
  // ninguna: el núcleo se reparte por todo el volumen
  return isCore ? randDir() * pow(u1, 0.45) * 0.95 : position;
}

// Forma orientada: torsión + giro alrededor de su eje, e inclinación.
vec3 gravityTarget(float shape, bool isCore) {
  vec3 t = gravityShape(shape, isCore);
  if (shape > 4.5) return t;
  float r = clamp(length(t), 0.0, 1.0);
  t = rotY(t, uGravTwist * (1.0 - r) * 2.0 + uGravAngle);
  // Anillo y espiral se ven mejor casi de frente.
  float baseTilt = (shape > 1.5 && shape < 3.5) ? 1.2 : 0.0;
  return rotX(t, baseTilt + uGravTilt);
}

void main() {
  float layer = aRand.w;
  bool isShell = layer < 0.5;
  bool isInterior = layer > 0.5 && layer < 1.5;
  bool isCore = layer > 1.5 && layer < 2.5;
  bool isHalo = layer > 2.5;
  vec3 p = position;

  // 0 · Gravedad central.
  if (isCore || isInterior) {
    float m = smoothstep(0.0, 1.0, uGravMix);
    vec3 target = mix(gravityTarget(uGravA, isCore), gravityTarget(uGravB, isCore), m);
    if (isCore) {
      vec3 loose = randDir() * pow(aGrav.x, 0.45) * 0.95;
      p = mix(loose, target, clamp(uGravStrength, 0.0, 1.0));
    } else {
      p = mix(p, target, clamp(uGravStrength - 1.0, 0.0, 1.0) * 0.6);
    }
  }
  float r0 = length(p);

  // 1 · Vórtice: torsión alrededor del eje Y, más intensa hacia el centro.
  float twist = uSwirl * (1.15 - r0) * sin(uTime * 0.9 + p.y * 2.2 + uSeed.x)
              + uSwirl * 0.35 * p.y;
  float c = cos(twist), s = sin(twist);
  p.xz = mat2(c, -s, s, c) * p.xz;

  // 2 · Advección por curl noise (2 pasos). El campo se desplaza en el tiempo.
  vec3 drift = vec3(uTime * 0.6, -uTime * 0.45, uTime * 0.3);
  float amp = uFlowAmp * (isHalo ? 1.6 : (isCore ? 0.55 : 1.0)) * (1.0 + aRand.z * 0.4);
  vec3 q = p;
  q += curlNoise(q * uNoiseScale + uSeed + drift) * amp * 0.5;
  q += curlNoise(q * uNoiseScale * 1.9 + uSeed * 1.7 - drift) * amp * 0.25;

  // 3 · La cáscara vuelve a la superficie: el flujo solo la pliega en tangente.
  if (isShell) {
    float len = length(q);
    q = q / max(len, 1e-4) * mix(len, r0, uShellPull);
  }

  // Zonas más oscuras y huecos que se abren y cierran.
  vec3 gd;
  float dn = snoise(position * 1.4 + uSeed * 0.5 + vec3(0.0, uTime * 0.5, 0.0), gd);
  float density = mix(1.0, smoothstep(-0.65, 0.55, dn) * 1.35, uDensity * (isCore ? 0.3 : 1.0));

  // 4 · Respiración.
  q *= 1.0 + sin(uClock * 0.55 + uSeed.y) * uBreath;

  // Repulsión suave alrededor del cursor (solo con hover).
  vec3 d = q - uMouse;
  float dist2 = dot(d, d);
  float push = exp(-dist2 / (uRepelRadius * uRepelRadius)) * uRepelStrength * uHover;
  q += d / sqrt(dist2 + 1e-4) * push;

  // 5 · Entrada en la esfera: las partículas acaban cubriendo la pantalla.
  float e = uEnter;
  if (e > 0.0) {
    vec3 axis = normalize(uCamLocal);
    float camDist = length(uCamLocal);
    if (uEnterMode < 0.5) {
      // zoom: la cámara atraviesa la esfera y la nube se abre a su alrededor
      q *= 1.0 + smoothstep(0.4, 1.0, e) * (1.5 + aRand.x * 7.0);
    } else if (uEnterMode < 1.5) {
      // expansión: la esfera se infla desde dentro hasta llenar la pantalla
      q *= mix(1.0, uFill * (0.75 + aRand.x * 0.5), e * e);
    } else if (uEnterMode < 2.5) {
      // explosión: las partículas salen disparadas hacia la cámara
      float k = pow(e, 1.6);
      vec3 spread = (aGrav - 0.5) * camDist * 0.9;
      vec3 dir = normalize(uCamLocal + spread - q);
      q += dir * k * camDist * (0.6 + aRand.x * 0.9) + q * k * 1.5;
    } else if (uEnterMode < 3.5) {
      // remolino: giran en espiral alrededor de la cámara mientras entra
      float ang = e * e * (5.0 + aRand.z * 6.0) * (1.2 - clamp(length(q), 0.0, 1.0) * 0.5);
      q = rotAxis(q, axis, ang);
      q *= 1.0 + smoothstep(0.3, 1.0, e) * (1.5 + aRand.x * 6.0);
    } else {
      // tinta: se juntan y luego se extienden como una mancha frente a la cámara
      float c1 = smoothstep(0.0, 0.35, e);
      float c2 = smoothstep(0.25, 1.0, e);
      vec3 flatQ = q - axis * dot(q, axis);
      q = mix(q, q * 0.3, c1 * (1.0 - c2));
      q = mix(q, flatQ * uFill * (0.25 + sqrt(aRand.x) * 0.85), c2);
    }
  }

  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mv;

  // Tamaño según distancia a cámara (y crecimiento al entrar).
  float grow = 1.0 + e * uFinalDensity * 5.0;
  float size = uSize * grow * (0.55 + aRand.x * 0.9) * uPixelRatio * (uSizeRef / max(-mv.z, 0.05));
  gl_PointSize = clamp(size, 1.0, uMaxSize * grow * uPixelRatio);

  // Profundidad: las partículas del fondo de la esfera son más tenues.
  vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float radius = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float rel = (mv.z - center.z) / max(radius, 1e-4);   // -1 fondo · +1 frente
  float depth = mix(1.0 - uDepthFade * (isCore ? 0.4 : 1.0) * (1.0 - e), 1.0, smoothstep(-1.1, 0.9, rel));

  float inkBoost = uEnterMode > 3.5 ? 1.0 + e * 1.5 : 1.0;
  vAlpha = uOpacity * aRand.y * density * depth * (1.0 + uHover * 0.15)
         * (1.0 + e * uFinalDensity * 1.5) * inkBoost;
}
`;

export const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = min(1.0, vAlpha) * smoothstep(0.25, 0.08, d);
  gl_FragColor = vec4(uColor, a);
}
`;
