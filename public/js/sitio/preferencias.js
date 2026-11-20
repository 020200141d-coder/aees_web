// ============================================================================
//  sitio/preferencias.js — tema día/noche, invitación de cuenta, burbuja de WhatsApp y campos fáciles
//
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Modo día / noche                                                   */
/*  head.ejs ya puso html[data-tema] antes de pintar (sin parpadeo).   */
/*  Aquí solo se cambia al tocar el botón y se recuerda la elección.   */
/* ------------------------------------------------------------------ */
function initTema() {
  const btn = $('#btn-tema');
  if (!btn) return;
  const raiz = document.documentElement;
  const meta = $('meta[name="theme-color"]');
  const pintar = () => {
    const dia = raiz.dataset.tema === 'dia';
    btn.setAttribute('aria-label', dia ? 'Cambiar a modo noche' : 'Cambiar a modo día');
    btn.setAttribute('aria-pressed', String(dia));
    // Color de la barra del navegador en el celular, acorde al tema.
    if (meta) meta.setAttribute('content', dia ? '#F4F7FB' : '#0D1B2A');
  };
  pintar();
  btn.addEventListener('click', () => {
    const tema = raiz.dataset.tema === 'dia' ? 'noche' : 'dia';
    // Transición suave de colores solo durante el cambio (no en cada hover).
    raiz.classList.add('cambiando-tema');
    raiz.dataset.tema = tema;
    try { localStorage.setItem('aees_tema', tema); } catch (e) { /* sin almacenamiento */ }
    pintar();
    setTimeout(() => raiz.classList.remove('cambiando-tema'), 450);
  });
}

/* ------------------------------------------------------------------ */
/* Invitación "Crea tu cuenta en un toque" (portada, sin sesión)      */
/*  Entra a los 2,5 s; "Ahora no" la oculta 7 días en el dispositivo. */
/* ------------------------------------------------------------------ */
function initAvisoCuenta() {
  const aviso = $('#aviso-cuenta');
  if (!aviso) return;
  const CLAVE = 'aees_aviso_cuenta';
  const SIETE_DIAS = 7 * 24 * 3600 * 1000;
  try {
    const cerradoEn = Number(localStorage.getItem(CLAVE) || 0);
    if (Date.now() - cerradoEn < SIETE_DIAS) { aviso.classList.add('descartado'); return; }
  } catch (e) { /* sin almacenamiento: se muestra igual */ }
  setTimeout(() => aviso.classList.add('visible'), 2500);
  $$('[data-cerrar-aviso]', aviso).forEach(b => b.addEventListener('click', () => {
    aviso.classList.remove('visible');
    try { localStorage.setItem(CLAVE, String(Date.now())); } catch (e) { /* nada */ }
  }));
}

/* ------------------------------------------------------------------ */
/* Burbuja del WhatsApp flotante: "¿Cotizamos tu evento?"             */
/*  Aparece a los 6 s, una vez por visita (sessionStorage), y se va   */
/*  sola a los 14 s para no estorbar.                                 */
/* ------------------------------------------------------------------ */
function initBurbujaWa() {
  const burbuja = $('#wa-burbuja');
  if (!burbuja) return;
  try { if (sessionStorage.getItem('aees_burbuja_wa')) return; } catch (e) { /* nada */ }
  const cerrar = () => {
    burbuja.classList.remove('visible');
    try { sessionStorage.setItem('aees_burbuja_wa', '1'); } catch (e) { /* nada */ }
  };
  setTimeout(() => {
    burbuja.hidden = false;
    requestAnimationFrame(() => burbuja.classList.add('visible'));
    setTimeout(cerrar, 14000);
  }, 6000);
  $('.wa-burbuja-cerrar', burbuja).addEventListener('click', cerrar);
  $('a', burbuja).addEventListener('click', cerrar);
}

/* ------------------------------------------------------------------ */
/* Campos fáciles: fecha/hora se abren tocando en cualquier parte,    */
/* los números llevan botones − / + grandes y el deslizador muestra   */
/* la parte llena en dorado (variable CSS --lleno).                   */
/* ------------------------------------------------------------------ */
function initCamposFaciles() {
  // Fecha y hora: abrir el selector al tocar el campo (no solo el iconito).
  $$('input[type="date"], input[type="time"]').forEach(input => {
    input.addEventListener('click', () => { try { input.showPicker(); } catch (e) { /* navegador antiguo: usa su ícono */ } });
  });

  // Números: envolver con − y +. Se respetan min, max y step, y se avisa con eventos
  // "input" y "change" para que los scripts de cada página recalculen como siempre.
  $$('input[type="number"]').forEach(input => {
    if (input.closest('.numero-facil') || input.closest('.admin')) return;
    const caja = document.createElement('div');
    caja.className = 'numero-facil';
    const boton = (texto, signo) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = texto;
      b.setAttribute('aria-label', signo > 0 ? 'Aumentar' : 'Disminuir');
      b.addEventListener('click', () => {
        const paso = Number(input.step) || 1;
        const min = input.min === '' ? -Infinity : Number(input.min);
        const max = input.max === '' ? Infinity : Number(input.max);
        const actual = input.value === '' ? (signo > 0 ? (Number.isFinite(min) ? min - paso : 0) : 0) : Number(input.value);
        input.value = Math.min(max, Math.max(min, actual + signo * paso));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return b;
    };
    input.replaceWith(caja);
    caja.append(boton('−', -1), input, boton('+', 1));
  });

  // Deslizador: pintar la parte recorrida.
  $$('input[type="range"]').forEach(r => {
    const pintar = () => r.style.setProperty('--lleno', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
    r.addEventListener('input', pintar);
    pintar();
  });
}
