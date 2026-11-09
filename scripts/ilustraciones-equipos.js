// ============================================================================
//  scripts/ilustraciones-equipos.js — ilustraciones propias (SVG) de los equipos
//  que no tienen una foto libre de buena calidad en Wikimedia Commons.
//
//  Por qué SVG: pesan poco (2–6 KB), se ven nítidas en cualquier pantalla y
//  son dibujos originales del proyecto (sin problemas de licencia).
//  Todas miden 800×600 (4:3), igual que la caja de foto de las tarjetas,
//  sobre un fondo de "estudio" para que se vean parejas junto a las fotos.
//
//  Uso:  node scripts/ilustraciones-equipos.js
//        → escribe public/img/equipos/<id>.svg
//  Luego el panel (Admin → Equipos) o scripts/fotos-equipos.js las asigna.
// ============================================================================
const fs = require('node:fs');
const path = require('node:path');
const DESTINO = path.join(__dirname, '..', 'public', 'img', 'equipos');

// Fondo común: degradado suave con una luz de escenario arriba y sombra en el piso.
const fondo = (id, tono = '#1a3350') => `
  <defs>
    <radialGradient id="luz-${id}" cx="50%" cy="8%" r="85%"><stop offset="0" stop-color="#2d5680"/><stop offset=".55" stop-color="${tono}"/><stop offset="1" stop-color="#0b1726"/></radialGradient>
    <radialGradient id="piso-${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="800" height="600" fill="url(#luz-${id})"/>
  <ellipse cx="400" cy="540" rx="300" ry="34" fill="url(#piso-${id})"/>`;

const svg = (contenido) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">${contenido}</svg>\n`;

// ── Micrófono vocal de mano (dinámico): rejilla en bola, anillo, cuerpo y conector XLR.
// cuerpo / anillo / rejilla cambian para distinguir cada modelo. inclinado = rotación.
function microfono(id, { cuerpo, cuerpoLuz, anillo, rejilla = '#c9d2db', interruptor = false, giro = -32 }) {
  // Agujeros de la rejilla: un patrón de rombos dentro de la bola.
  return svg(`${fondo(id)}
  <defs>
    <linearGradient id="cuerpo-${id}" x1="0" x2="1"><stop offset="0" stop-color="${cuerpo}"/><stop offset=".45" stop-color="${cuerpoLuz}"/><stop offset="1" stop-color="${cuerpo}"/></linearGradient>
    <radialGradient id="bola-${id}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="${rejilla}"/><stop offset="1" stop-color="#4a5560"/></radialGradient>
    <pattern id="malla-${id}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="none"/><path d="M0 0h9M0 0v9" stroke="#2b333b" stroke-width="1.6" opacity=".55"/></pattern>
    <clipPath id="recorte-${id}"><circle cx="0" cy="-150" r="78"/></clipPath>
  </defs>
  <g transform="translate(405 300) rotate(${giro}) scale(.98)">
    <!-- cable -->
    <path d="M0 250 C 0 330, 120 330, 160 380" fill="none" stroke="#111a22" stroke-width="16" stroke-linecap="round"/>
    <!-- conector XLR -->
    <rect x="-24" y="200" width="48" height="56" rx="8" fill="#1d252d"/>
    <rect x="-24" y="210" width="48" height="6" fill="#3a4550"/>
    <!-- cuerpo cónico -->
    <path d="M-50 -78 L50 -78 L30 205 L-30 205 Z" fill="url(#cuerpo-${id})"/>
    <path d="M-50 -78 L50 -78 L46 -40 L-46 -40 Z" fill="#000" opacity=".18"/>
    ${interruptor ? `<rect x="-11" y="20" width="22" height="46" rx="5" fill="#0d1318"/><rect x="-7" y="26" width="14" height="18" rx="3" fill="#59636d"/>` : ''}
    <!-- anillo -->
    <rect x="-60" y="-92" width="120" height="22" rx="6" fill="${anillo}"/>
    <rect x="-60" y="-92" width="120" height="6" rx="3" fill="#fff" opacity=".25"/>
    <!-- rejilla en bola -->
    <circle cx="0" cy="-150" r="78" fill="url(#bola-${id})"/>
    <g clip-path="url(#recorte-${id})"><rect x="-80" y="-230" width="160" height="160" fill="url(#malla-${id})"/></g>
    <path d="M-78 -150 a78 78 0 0 0 156 0" fill="#000" opacity=".12"/>
    <ellipse cx="-26" cy="-188" rx="22" ry="12" fill="#fff" opacity=".45" transform="rotate(-30 -26 -188)"/>
  </g>`);
}

// ── Trípode para parlante: tubo telescópico, 3 patas abiertas y la base que recibe el parlante.
const tripode = svg(`${fondo('tripode')}
  <defs><linearGradient id="tubo" x1="0" x2="1"><stop offset="0" stop-color="#2a3138"/><stop offset=".5" stop-color="#6b7884"/><stop offset="1" stop-color="#2a3138"/></linearGradient></defs>
  <!-- patas -->
  <g stroke="#2f373f" stroke-width="14" stroke-linecap="round">
    <path d="M400 360 L250 540"/><path d="M400 360 L550 540"/><path d="M400 360 L420 560"/>
  </g>
  <g stroke="#56616c" stroke-width="6" stroke-linecap="round"><path d="M330 455 L400 410 L470 455"/><path d="M400 410 L410 470"/></g>
  <!-- tubo inferior y superior -->
  <rect x="384" y="210" width="32" height="160" rx="6" fill="url(#tubo)"/>
  <rect x="390" y="70" width="20" height="150" rx="5" fill="url(#tubo)"/>
  <!-- perilla de ajuste -->
  <rect x="372" y="206" width="56" height="20" rx="6" fill="#151b21"/>
  <circle cx="440" cy="216" r="14" fill="#151b21"/><circle cx="440" cy="216" r="6" fill="#3a444e"/>
  <!-- base del parlante -->
  <rect x="380" y="56" width="40" height="22" rx="4" fill="#151b21"/>
  <!-- parlante fantasma, para entender el uso -->
  <g opacity=".22"><rect x="300" y="-120" width="200" height="180" rx="14" fill="#c8dcf0"/></g>
  <!-- flecha de altura -->
  <g stroke="#f5a623" stroke-width="3" fill="#f5a623" opacity=".9">
    <path d="M600 90 V520" fill="none" stroke-dasharray="8 8"/><path d="M592 104 L600 86 L608 104 Z"/><path d="M592 506 L600 524 L608 506 Z"/>
  </g>
  <text x="616" y="312" fill="#f5a623" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700">1,2–2 m</text>`);

// ── Matrix LED: panel con 5×5 focos cálidos encendidos (efecto de pared de luces).
function matrix() {
  let focos = '';
  for (let f = 0; f < 5; f++) for (let c = 0; c < 5; c++) {
    const x = 240 + c * 80, y = 140 + f * 80;
    const fuerte = (f + c) % 2 === 0;
    focos += `<circle cx="${x}" cy="${y}" r="34" fill="#0c1116"/><circle cx="${x}" cy="${y}" r="27" fill="url(#foco)" opacity="${fuerte ? 1 : .7}"/>`;
  }
  return svg(`${fondo('matrix')}
  <defs>
    <radialGradient id="foco"><stop offset="0" stop-color="#fffbe8"/><stop offset=".35" stop-color="#ffd27a"/><stop offset=".75" stop-color="#f5a623"/><stop offset="1" stop-color="#7a4b0a"/></radialGradient>
    <radialGradient id="halo"><stop offset="0" stop-color="#ffcf70" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf70" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="400" cy="300" rx="330" ry="270" fill="url(#halo)"/>
  <!-- marco y lira de colgar -->
  <path d="M190 300 C 150 300, 150 520, 190 520 M610 300 C 650 300, 650 520, 610 520" fill="none" stroke="#1f272f" stroke-width="12"/>
  <rect x="190" y="90" width="420" height="420" rx="18" fill="#161d24" stroke="#2a343e" stroke-width="6"/>
  ${focos}`);
}

// ── Minibrut (blinder): marco con 2×2 lámparas tipo PAR muy brillantes que "ciegan" al público.
const minibrut = svg(`${fondo('minibrut')}
  <defs>
    <radialGradient id="lampara"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#fff2c6"/><stop offset=".7" stop-color="#ffbf47"/><stop offset="1" stop-color="#8a5a12"/></radialGradient>
    <radialGradient id="destello"><stop offset="0" stop-color="#fff4d0" stop-opacity=".8"/><stop offset="1" stop-color="#fff4d0" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="400" cy="300" rx="360" ry="250" fill="url(#destello)"/>
  <!-- lira -->
  <path d="M220 300 C 170 300, 170 500, 220 500 M580 300 C 630 300, 630 500, 580 500" fill="none" stroke="#1f272f" stroke-width="12"/>
  <rect x="210" y="140" width="380" height="330" rx="18" fill="#151c23" stroke="#2a343e" stroke-width="6"/>
  ${[[305, 225], [495, 225], [305, 385], [495, 385]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="78" fill="#0b1015"/><circle cx="${x}" cy="${y}" r="66" fill="url(#lampara)"/><circle cx="${x}" cy="${y}" r="66" fill="none" stroke="#c9a15a" stroke-width="4" opacity=".6"/>`).join('')}
  <g stroke="#fff7dc" stroke-width="5" stroke-linecap="round" opacity=".55">
    <path d="M400 70 V20M300 90 L270 45M500 90 L530 45M150 240 H90M650 240 H710"/>
  </g>`);

// ── Tacho LED (PAR): lata redonda con LEDs RGB, lira con perilla y 54 LEDs de 3 W.
function tacho() {
  const colores = ['#ff4d4d', '#4dff88', '#4d8bff'];
  let leds = '';
  let n = 0;
  for (let anillo = 0; anillo < 4; anillo++) {
    const r = 18 + anillo * 30, cantidad = anillo === 0 ? 6 : 10 + anillo * 6;
    for (let i = 0; i < cantidad; i++) {
      const a = (i / cantidad) * Math.PI * 2;
      leds += '<circle cx="' + (400 + r * Math.cos(a)).toFixed(1) + '" cy="' + (290 + r * Math.sin(a)).toFixed(1) + '" r="7" fill="' + colores[n++ % 3] + '"/>';
    }
  }
  return svg(`${fondo('tacho')}
  <defs>
    <linearGradient id="lata" x1="0" x2="1"><stop offset="0" stop-color="#1a2027"/><stop offset=".5" stop-color="#4b5560"/><stop offset="1" stop-color="#1a2027"/></linearGradient>
    <radialGradient id="haz"><stop offset="0" stop-color="#b98cff" stop-opacity=".5"/><stop offset="1" stop-color="#b98cff" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="400" cy="290" rx="300" ry="240" fill="url(#haz)"/>
  <!-- lira (soporte en U) y perillas -->
  <path d="M250 290 C 230 470, 570 470, 550 290" fill="none" stroke="#1f272f" stroke-width="16"/>
  <circle cx="250" cy="290" r="20" fill="#11161b"/><circle cx="550" cy="290" r="20" fill="#11161b"/>
  <rect x="380" y="440" width="40" height="70" rx="6" fill="#1f272f"/>
  <!-- lata con los LEDs rojo, verde y azul -->
  <circle cx="400" cy="290" r="150" fill="url(#lata)"/>
  <circle cx="400" cy="290" r="132" fill="#0a0e12"/>
  ${leds}
  <circle cx="400" cy="290" r="132" fill="none" stroke="#8b96a1" stroke-width="4" opacity=".5"/>`);
}

const archivos = {
  'tacho-54': tacho(),
  // Micrófonos alámbricos: mismo tipo (dinámico vocal), distinto acabado para reconocerlos.
  sv100: microfono('sv100', { cuerpo: '#15191d', cuerpoLuz: '#3b434b', anillo: '#2a3036', giro: -30 }),
  e832: microfono('e832', { cuerpo: '#1b1f23', cuerpoLuz: '#4a525a', anillo: '#9aa4ad', giro: -34 }),
  e935: microfono('e935', { cuerpo: '#2a2f35', cuerpoLuz: '#68727c', anillo: '#b8c1c9', rejilla: '#aab4bd', giro: -28 }),
  e945: microfono('e945', { cuerpo: '#25292e', cuerpoLuz: '#5d666f', anillo: '#c43a2f', rejilla: '#aab4bd', interruptor: false, giro: -36 }),
  tripode,
  matrix: matrix(),
  minibrut
};

for (const [id, contenido] of Object.entries(archivos)) {
  fs.writeFileSync(path.join(DESTINO, `${id}.svg`), contenido);
  console.log(`✓ public/img/equipos/${id}.svg (${(contenido.length / 1024).toFixed(1)} KB)`);
}
