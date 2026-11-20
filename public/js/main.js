// ============================================================================
//  main.js — arranque de las interacciones del sitio público (sin frameworks)
//
//  Antes este archivo tenía ~930 líneas con todo el JavaScript del sitio.
//  Ahora cada responsabilidad vive en su módulo dentro de public/js/sitio/
//  y este archivo solo los pone en marcha cuando la página está lista:
//
//   sitio/base.js          $ y $$, soles, alertas (se carga primero)
//   sitio/navegacion.js    header, menú móvil, scroll suave, scroll spy, progreso
//   sitio/animaciones.js   reveal, contadores, texto escrito, tilt, cursor, canvas, parallax
//   sitio/catalogo.js      filtros, modal de equipo, agregar a "Mi evento", disponibilidad
//   sitio/galeria.js       lightbox de eventos realizados
//   sitio/carrusel.js      carrusel de servicios
//   sitio/contacto.js      copiar correo y formulario de contacto
//   sitio/sonido-ui.js     botón de volumen y títulos que suenan
//   sitio/preferencias.js  tema día/noche, invitación de cuenta, burbuja WhatsApp, campos fáciles
//
//  Orden de carga (views/partials/footer.ejs): librerías CDN → sonido.js →
//  evento.js → sitio/*.js → main.js → scripts propios de cada página.
//  Flujo: DOMContentLoaded → se enganchan los init*() y se añade
//  body.cargado, que dispara la entrada animada del hero en el CSS.
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Pequeña pausa para que se note la entrada animada del hero.
  setTimeout(marcarCargado, 120);
  initHeader();
  const cerrarMenu = initMenuMovil();
  initScrollSuave(cerrarMenu);
  initScrollSpy();
  initProgreso();
  initReveal();
  initContadores();
  initFiltros();
  initModalEquipo();
  initGaleria();
  initCarrusel();
  initTilt();
  initMagneticos();
  initCursor();
  initCanvasHero();
  initParallax();
  initCopiarEmail();
  initAgregar();
  initCombos();
  initDisponibilidad();
  initFormulario();
  initSonidoUI();
  initPalabrasSonoras();
  initTema();
  initAvisoCuenta();
  initBurbujaWa();
  initCamposFaciles();
});
