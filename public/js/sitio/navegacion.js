// ============================================================================
//  sitio/navegacion.js — header, menú móvil, scroll suave y progreso de lectura
//
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* ------------------------------------------------------------------ */
/* Entrada del hero: body.cargado dispara las animaciones del CSS      */
/* ------------------------------------------------------------------ */
function marcarCargado() {
  if (document.body.classList.contains('cargado')) return;
  document.body.classList.add('cargado');
  initTyped();
}

/* ------------------------------------------------------------------ */
/* Header: fondo al bajar, se esconde al bajar rápido y vuelve al subir */
/* ------------------------------------------------------------------ */
function initHeader() {
  const header = $('#header');
  const menu = $('#nav-links');
  if (!header) return;
  let ultimoY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    header.classList.toggle('con-fondo', y > 20);
    header.classList.toggle('escondido', y > ultimoY && y > 400 && !menu.classList.contains('abierto'));
    ultimoY = y;
  }, { passive: true });
}

function initMenuMovil() {
  const boton = $('#nav-toggle');
  const menu = $('#nav-links');
  const cerrar = () => { menu?.classList.remove('abierto'); boton?.setAttribute('aria-expanded', 'false'); };
  if (!boton || !menu) return cerrar;
  boton.addEventListener('click', () => boton.setAttribute('aria-expanded', String(menu.classList.toggle('abierto'))));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  document.addEventListener('click', e => {
    if (menu.classList.contains('abierto') && !menu.contains(e.target) && !boton.contains(e.target)) cerrar();
  });
  return cerrar;
}

/* ------------------------------------------------------------------ */
/* Scroll suave para [data-scroll] + "Cotizar <servicio>" rellena el mensaje */
/* ------------------------------------------------------------------ */
function initScrollSuave(cerrarMenu) {
  document.addEventListener('click', e => {
    const enlace = e.target.closest('a[data-scroll]');
    if (!enlace) return;
    const hash = new URL(enlace.href).hash;
    const destino = hash && document.querySelector(hash);
    if (!destino) return;
    e.preventDefault();
    cerrarMenu();
    destino.scrollIntoView({ behavior: reducirMovimiento ? 'auto' : 'smooth' });
    history.replaceState(null, '', hash);
    if (enlace.dataset.servicio) prellenarMensaje(`Hola AeeS, quiero cotizar ${enlace.dataset.servicio.toLowerCase()} para mi evento. `);
  });
}

function prellenarMensaje(texto) {
  const area = $('#mensaje');
  if (!area) return;
  area.value = texto;
  area.dispatchEvent(new Event('input'));
  setTimeout(() => { area.focus({ preventScroll: true }); area.setSelectionRange(texto.length, texto.length); }, 700);
  toast('success', 'Te dejamos el mensaje empezado ✍️');
}

function initScrollSpy() {
  const enlaces = $$('.nav-links a[data-scroll]');
  if (!enlaces.length) return;
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) enlaces.forEach(a => a.classList.toggle('activo', a.hash === `#${entrada.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => observador.observe(s));
}

/* Progreso de lectura (barra superior + anillo del botón subir) */
function initProgreso() {
  const barra = $('.progreso-lectura span');
  const botonSubir = $('#volver-arriba');
  let pendiente = false;
  const actualizar = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progreso = max > 0 ? window.scrollY / max : 0;
    barra?.style.setProperty('--progreso', progreso.toFixed(4));
    botonSubir?.style.setProperty('--progreso', progreso.toFixed(4));
    botonSubir?.classList.toggle('visible', window.scrollY > 500);
    pendiente = false;
  };
  window.addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } }, { passive: true });
  actualizar();
  botonSubir?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducirMovimiento ? 'auto' : 'smooth' }));
}
